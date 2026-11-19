// Hook relay: the parts shared by relays for harnesses whose MCP client cannot carry LCU's turn identity or
// instructions, and whose own command hooks fill the gap (Junie, Antigravity). The relay is a stdio MCP server in
// front of the original runtime, through the shared client; it listens on a private Unix socket named for the
// harness process that started it. That process also runs the hooks, so a hook finds the relay by walking up its
// own ancestors, and tells it where turns start and end. Each harness supplies what differs: how hooks map to
// turns, which session a call belongs to, how approvals are shown, and the JSON its hooks print.
import { execFileSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readdirSync, rmSync, statSync } from 'node:fs';
import { createConnection, createServer } from 'node:net';
import { homedir, tmpdir } from 'node:os';
import { basename, isAbsolute, join } from 'node:path';
import { StringDecoder } from 'node:string_decoder';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { persistAudioContent } from './audio-files.mjs';
import { createCuaClient, MODEL_TOOLS } from './client.mjs';

/** Once the harness is gone, open turns get this long to end upstream before the original server is closed anyway. */
export const SHUTDOWN_DRAIN_TIMEOUT_MS = 2_000;
/** The line above the original instructions when a call result carries them (no hook could). */
export const INSTRUCTIONS_HEADER = 'LCU: Computer Use instructions for this session:';
const REQUEST_LIMIT = 64 * 1024;
/** Longest socket directory: a socket path must fit in 104 bytes on macOS, and its name takes up to 24. */
const MAX_DIRECTORY_BYTES = 78;
// `lcu apps allow` waits this long for Touch ID or the password (AUTH_TIMEOUT in lcu/apps.mjs); a harness's shell
// tool usually ends a command sooner, before most people can approve.
const AUTH_WAIT_SECONDS = 300;

export function asError(error) {
  return error instanceof Error ? error.message : String(error);
}

/**
 * The private directory of relay sockets for harness `name`: `env[override]` (tests), else beside LCU's other
 * state, or in the temporary directory when that path is too long for a socket. The relay and its hooks share the
 * harness's environment, so both choose the same one.
 */
export function controlDirectory(name, override, {
  env = process.env, home = env.HOME || homedir(), temporary = env.TMPDIR || tmpdir(), uid = process.getuid?.(),
} = {}) {
  if (env[override]) return env[override];
  const state = join(env.XDG_STATE_HOME || join(home, '.local', 'state'), 'lcu', name);
  return Buffer.byteLength(state) <= MAX_DIRECTORY_BYTES ? state : join(temporary, `lcu-${name}-${uid}`);
}

const shellWord = (word) => (/^[A-Za-z0-9._\/-]+$/.test(word) ? word : `"${word.replace(/["\\$`]/g, '\\$&')}"`);

/** The absolute `lcu` launcher among the relay's original command (setup passes it), else plain `lcu`. */
export function launcherOf(command = []) {
  return [...command].reverse().find(word => typeof word === 'string' && isAbsolute(word) && basename(word) === 'lcu') ?? 'lcu';
}

/**
 * The tool-result text that replaces an approval prompt the harness did not show. `lcu` is the launcher to name;
 * `reason` says why there was no prompt (for example "Junie cannot show approval prompts yet").
 */
export function approvalHint(app, lcu, reason) {
  const run = (verb) => `\`${shellWord(lcu)} apps ${verb} ${shellWord(app)}\``;
  return `LCU: Computer Use needs the person's approval to control ${app}, and ${reason}. Run ${run('allow')} ` +
    'yourself in a terminal: the person approves with Touch ID or their password, which allows ' +
    `${app} until it is revoked. It waits up to 5 minutes for them, so give the command a timeout of at least ` +
    `${AUTH_WAIT_SECONDS} seconds. Then retry the call. If the command fails, is refused or times out (for example, ` +
    'nobody is there to approve), ask the person to run it themselves and stop. In your final answer, say that ' +
    `${app} stays allowed until revoked, show ${run('revoke')}, and offer to run it for them.`;
}

/**
 * Run a hook relay on stdio. `hostPid` is the harness process that started it, which also runs the hooks;
 * `createClient` (tests) replaces createCuaClient. `harness(relay)` returns the harness's own parts:
 * - `onHook(request)`: answers one parsed hook request; its result goes back to the hook;
 * - `onElicitation(params, extra)`: answers an elicitation of the original runtime;
 * - `sessionOf(callParams)`: the session a tool call belongs to, or undefined for the relay's fallback;
 * - `describeTool(tool)`: the descriptor listed for an original public tool (optional).
 * `relay` holds `client`, `server` (once connected), `sessions`, `fallback` (the session id used before any hook
 * names one), and `stateOf`, `finish`, `noteApproval`.
 */
export async function runHookRelay({
  name, host, approvalReason, command, cwd, env = process.env, hostPid = process.ppid, directory,
  shutdownDrainMs = SHUTDOWN_DRAIN_TIMEOUT_MS, createClient = createCuaClient, harness: setup,
}) {
  // Session id -> { active: {turnId, calls}, pending: {turnId, event}, cleaning, told }.
  const sessions = new Map();
  // The launcher named in approval hints, so they work when `lcu` is not on PATH.
  const lcu = launcherOf(command);
  // Calls in flight -> the apps whose approval the harness could not show during them.
  const inFlight = new Set();
  let server;
  let harness;

  const client = createClient({
    command, cwd, env, adapter: name,
    allowedOrigins: env.LCU_APPROVED_ORIGINS ? JSON.parse(env.LCU_APPROVED_ORIGINS) : [],
    onElicitation: (params, extra) => harness.onElicitation(params, extra),
  });

  const stateOf = (sessionId) => {
    let state = sessions.get(sessionId);
    if (!state) sessions.set(sessionId, state = {});
    return state;
  };

  /** End the session's open LCU turn upstream; a failure keeps it pending for the session's next call. */
  async function finish(sessionId, event) {
    const state = sessions.get(sessionId);
    if (!state) return;
    if (state.active) {
      state.pending = { turnId: state.active.turnId, event };
      state.active = undefined;
    }
    if (state.cleaning) return state.cleaning;
    const cleanup = state.pending;
    if (!cleanup) return;
    const attempt = (async () => {
      await client.turnEnded({ sessionId, turnId: cleanup.turnId, event: cleanup.event });
      if (state.pending === cleanup) state.pending = undefined;
    })();
    state.cleaning = attempt;
    try {
      await attempt;
    } finally {
      if (state.cleaning === attempt) state.cleaning = undefined;
    }
  }

  /**
   * The open LCU turn of the session, ending a missed or failed earlier one first. A failed end of any
   * session's turn is retried too, so no call runs while an earlier turn's hooks may still hold the desktop.
   * Other sessions' open turns are left alone.
   */
  async function turnOf(sessionId) {
    const state = stateOf(sessionId);
    const unfinished = [...sessions].filter(([id, other]) => id !== sessionId && (other.pending || other.cleaning));
    if (state.active && !unfinished.length) return state.active;
    try {
      await Promise.all([...unfinished.map(([id]) => finish(id, 'Interrupt')),
        ...(state.active ? [] : [finish(sessionId, 'Interrupt')])]);
    } catch (error) {
      throw new Error('LCU is still finishing the previous turn, so Computer Use actions are paused. ' +
        `Try again in a few seconds. ${asError(error)}`);
    }
    state.active ??= { turnId: randomUUID(), calls: 0 };
    return state.active;
  }

  /**
   * Record that the harness could not show the approval for `app`. An approval request does not name the call it
   * came from, so only a lone call can get the hint; with calls overlapping, the model still sees the runtime's
   * own "not approved" error.
   */
  function noteApproval(app) {
    if (inFlight.size === 1) for (const call of inFlight) call.add(app);
  }

  const relay = {
    client, sessions, fallback: `${name}-${randomUUID()}`, stateOf, finish, noteApproval,
    get server() { return server; },
  };
  harness = setup(relay);
  const describeTool = harness.describeTool ?? (tool => tool);

  // Hook requests: one JSON line in, one `{ok, result|error}` line out.
  mkdirSync(directory, { recursive: true, mode: 0o700 });
  if (statSync(directory).uid !== process.getuid()) throw new Error(`LCU socket directory belongs to another account: ${directory}`);
  chmodSync(directory, 0o700);
  const socketPath = join(directory, `${hostPid}-${process.pid}.sock`);
  rmSync(socketPath, { force: true });
  const control = createServer(socket => {
    let input = '';
    const decoder = new StringDecoder('utf8');
    const reply = (value) => { if (!socket.destroyed) socket.end(`${JSON.stringify(value)}\n`); };
    socket.on('error', () => {});
    socket.on('data', async chunk => {
      if (input === null) return;
      input += decoder.write(chunk);
      if (input.length > REQUEST_LIMIT) {
        input = null;
        reply({ ok: false, error: 'request too large' });
        return;
      }
      const newline = input.indexOf('\n');
      if (newline < 0) return;
      const line = input.slice(0, newline);
      input = null;
      try {
        reply({ ok: true, result: await harness.onHook(JSON.parse(line) ?? {}) });
      } catch (error) {
        reply({ ok: false, error: asError(error) });
      }
    });
  });

  let shutdown;
  const close = () => shutdown ??= (async () => {
    control.close();
    rmSync(socketPath, { force: true });
    let timer;
    const drained = Promise.allSettled([...sessions.keys()].map(id => finish(id, 'Interrupt')));
    await Promise.race([drained, new Promise(resolve => { timer = setTimeout(resolve, shutdownDrainMs); })]);
    clearTimeout(timer);
    await client.close().catch(error => console.error(`${host} MCP relay upstream close failed:`, asError(error)));
    await server?.close().catch(() => {});
  })();

  try {
    await client.connect();
    await new Promise((resolve, reject) => {
      control.once('error', reject);
      control.listen(socketPath, resolve);
    });
    chmodSync(socketPath, 0o600);
    server = new Server({ name: `lcu-${name}-relay`, version: '0.1.0' }, {
      capabilities: { tools: {} },
      instructions: client.instructions,
    });
    server.onerror = error => console.error(`${host} MCP relay server error:`, asError(error));
    server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: client.publicTools().map(describeTool) }));
    server.setRequestHandler(CallToolRequestSchema, async (request, extra) => {
      const { name: tool, arguments: args = {} } = request.params;
      if (!MODEL_TOOLS.has(tool)) return { isError: true, content: [{ type: 'text', text: `Unknown LCU tool: ${tool}` }] };
      const sessionId = harness.sessionOf(request.params) ?? relay.fallback;
      const turn = await turnOf(sessionId);
      const approvals = new Set();
      turn.calls++;
      inFlight.add(approvals);
      try {
        const result = await persistAudioContent(await client.call(tool, args, {
          sessionId, turnId: turn.turnId, toolCallId: randomUUID(), signal: extra.signal,
        }));
        const added = [...approvals].map(app => ({ type: 'text', text: approvalHint(app, lcu, approvalReason) }));
        // A session whose first prompt no hook could reach (the relay started later) gets the original
        // instructions with its first call result instead, once. They go first: a harness may save a long result
        // to a file, and the model may read only its beginning.
        const state = stateOf(sessionId);
        const leading = [];
        if (!state.told && client.instructions) {
          state.told = true;
          leading.push({ type: 'text', text: `${INSTRUCTIONS_HEADER}\n\n${client.instructions}` });
        }
        if (!added.length && !leading.length) return result;
        return { ...result, content: [...leading, ...(result.content ?? []), ...added] };
      } finally {
        inFlight.delete(approvals);
        turn.calls--;
      }
    });
    server.onclose = () => { void close(); };
    await server.connect(new StdioServerTransport());
  } catch (error) {
    await close();
    throw error;
  }
  // The SDK's stdio transport does not surface stdin EOF, which is how the harness closes the server.
  process.stdin.once('end', () => { void close(); });
  return { server, socketPath, sessions, close };
}

/** The parent pid of `pid`, or undefined. */
function parentOf(pid) {
  try {
    const parent = Number(execFileSync('/bin/ps', ['-o', 'ppid=', '-p', String(pid)],
      { encoding: 'utf8', timeout: 5_000, stdio: ['ignore', 'pipe', 'ignore'] }).trim());
    return Number.isInteger(parent) && parent > 1 ? parent : undefined;
  } catch {
    return undefined;
  }
}

/** Send one request to a relay socket; resolves to its result, or rejects. */
function ask(socketPath, request, timeoutMs) {
  return new Promise((resolve, reject) => {
    let buffer = '';
    const decoder = new StringDecoder('utf8');
    const socket = createConnection(socketPath);
    const timer = setTimeout(() => { socket.destroy(); reject(new Error('timed out')); }, timeoutMs);
    const done = (error, value) => {
      clearTimeout(timer);
      socket.destroy();
      if (error) reject(error); else resolve(value);
    };
    socket.on('error', error => done(error));
    socket.on('connect', () => socket.write(`${JSON.stringify(request)}\n`));
    socket.on('data', chunk => {
      buffer += decoder.write(chunk);
      const newline = buffer.indexOf('\n');
      if (newline < 0) return;
      try {
        const response = JSON.parse(buffer.slice(0, newline));
        if (response?.ok) done(undefined, response.result ?? {});
        else done(new Error(typeof response?.error === 'string' ? response.error : 'relay refused the hook'));
      } catch (error) {
        done(error);
      }
    });
    socket.on('end', () => done(new Error('relay closed the connection')));
  });
}

/**
 * Hook side: send `request` to the relays of the nearest of the hook's `ancestors` (from `parent` up) that has
 * any, and resolve to their results. A relay that does not answer within `timeoutSeconds` (the harness's hook
 * timeout) minus 2 s is skipped; a socket nobody listens on is removed. Never rejects.
 */
export async function askRelays(request, { directory, parent, ancestors, timeoutSeconds }) {
  let names;
  try {
    if (!statSync(directory).isDirectory()) return [];
    names = readdirSync(directory);
  } catch {
    return [];
  }
  const timeoutMs = (timeoutSeconds - 2) * 1000;
  const results = [];
  for (let pid = parent, depth = 0; pid && depth < ancestors; pid = parentOf(pid), depth++) {
    const sockets = names.filter(name => name.startsWith(`${pid}-`) && name.endsWith('.sock'));
    if (!sockets.length) continue;
    await Promise.all(sockets.map(async name => {
      const socketPath = join(directory, name);
      try {
        results.push(await ask(socketPath, request, timeoutMs));
      } catch (error) {
        // A relay that exited without removing its socket.
        if (['ECONNREFUSED', 'ENOENT'].includes(error?.code)) rmSync(socketPath, { force: true });
      }
    }));
    break;
  }
  return results;
}
