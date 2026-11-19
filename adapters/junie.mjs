// Junie CLI relay: a stdio MCP server for Junie in front of the original runtime, through the shared client.
// Junie's MCP client sends no turn identity, ignores server instructions and cannot answer elicitation, so
// Junie's own command hooks (`junie.mjs --hook`, installed by `lcu setup --agent junie`) reach this relay over a
// private socket named for the Junie process that runs both: they mark the turn boundaries and carry the original
// instructions into the first prompt of each session. When Junie starts the relay only after that prompt's hooks
// (macOS), the session's first call result carries them instead. Native-app approvals cannot be shown in Junie; the call
// result tells the model to run `lcu apps allow <App>` itself (the person approves with Touch ID or their password,
// which allows the app until it is revoked), and to offer `lcu apps revoke <App>` when its task is done.
import { readFileSync } from 'node:fs';
import { isMainModule, nativeAppApprovalOptions } from './client.mjs';
import {
  approvalHint as hookRelayApprovalHint, askRelays, asError, controlDirectory as hookRelayDirectory,
  INSTRUCTIONS_HEADER, launcherOf, runHookRelay, SHUTDOWN_DRAIN_TIMEOUT_MS,
} from './hook-relay.mjs';

export { INSTRUCTIONS_HEADER, launcherOf, SHUTDOWN_DRAIN_TIMEOUT_MS };

/** The Junie hook events LCU registers, with the LCU turn end each one means. */
export const HOOK_EVENTS = {
  SessionStart: null,
  UserPromptSubmit: null,
  Stop: 'Stop',
  StopFailure: 'Interrupt',
  SessionEnd: 'Interrupt',
};
/** Seconds Junie gives each hook (`timeout` in config.json); the hook gives up on the relay a little earlier. */
export const HOOK_TIMEOUTS = { SessionStart: 10, UserPromptSubmit: 30, Stop: 60, StopFailure: 60, SessionEnd: 10 };
/** Ancestors of the hook checked for a relay: `sh -c`, then Junie (one more for a wrapper). */
const HOOK_ANCESTORS = 3;
const APPROVAL_REASON = 'Junie cannot show approval prompts yet';

/** The private directory of relay sockets: `LCU_JUNIE_CONTROL_DIR` (tests), else LCU's state or temporary one. */
export function controlDirectory(options) {
  return hookRelayDirectory('junie', 'LCU_JUNIE_CONTROL_DIR', options);
}

/** The tool-result text that replaces an approval prompt Junie cannot show. `lcu` is the launcher to name. */
export function approvalHint(app, lcu = 'lcu') {
  return hookRelayApprovalHint(app, lcu, APPROVAL_REASON);
}

/**
 * Run the relay on stdio. `hostPid` is the Junie process that started it, which also runs the hooks.
 * `createClient` (tests) replaces createCuaClient.
 */
export function runJunieRelay({ env = process.env, directory = controlDirectory({ env }), ...options } = {}) {
  return runHookRelay({
    ...options, env, directory, name: 'junie', host: 'Junie',
    approvalReason: APPROVAL_REASON,
    harness: ({ client, sessions, fallback, stateOf, finish, noteApproval }) => {
      // The session Junie last reported through a hook; calls before any hook use the relay's fallback id.
      let current;

      /** Make `sessionId` the current one; any other session's open turn ended with it (a new or resumed session). */
      async function announce(sessionId) {
        current = sessionId;
        stateOf(sessionId);
        await Promise.all([...sessions].filter(([id, other]) => id !== sessionId && (other.active || other.pending))
          .map(([id]) => finish(id, 'Interrupt').catch(() => {})));
      }

      /** Answer one hook `{hook_event_name, session_id}`: `{additional_context?}`. */
      async function onHook({ hook_event_name: event, session_id: sessionId }) {
        if (!Object.hasOwn(HOOK_EVENTS, event) || typeof sessionId !== 'string' || !sessionId) {
          throw new Error('Expected a Junie hook event and session id');
        }
        if (event === 'SessionStart') {
          await announce(sessionId);
          return {};
        }
        if (event === 'UserPromptSubmit') {
          // A relay Junie started after the first prompt's hooks meets the session here when no ending hook ran (chat
          // mode, an interrupted task): that prompt's turn is over, and instructions its calls carried count.
          const early = current === undefined ? sessions.get(fallback) : undefined;
          if (early) {
            current = sessionId;
            if (early.told) stateOf(sessionId).told = true;
            if (early.active) await finish(fallback, early.active.calls > 0 ? 'Interrupt' : 'Stop').catch(() => {});
          }
          await announce(sessionId);
          const state = stateOf(sessionId);
          // Junie runs Stop only for a successful task, never for chat mode or an interrupted one: a new prompt
          // means the previous turn is over. A call still running means it was interrupted.
          if (state.active) await finish(sessionId, state.active.calls > 0 ? 'Interrupt' : 'Stop').catch(() => {});
          if (state.told) return {};
          state.told = true;
          const instructions = client.instructions;
          return instructions ? { additional_context: instructions } : {};
        }
        // Junie can start this relay only after the session's first SessionStart and UserPromptSubmit hooks, so calls
        // before any hook ran under the relay's own id; the first ending hook ends that turn and names the session.
        if (current === undefined && sessions.has(fallback)) {
          current = sessionId;
          // The instructions a call already carried count for the session the relay now follows.
          if (sessions.get(fallback).told) stateOf(sessionId).told = true;
          await finish(fallback, HOOK_EVENTS[event]);
          return {};
        }
        if (!sessions.has(sessionId)) return {};
        await finish(sessionId, HOOK_EVENTS[event]);
        return {};
      }

      return {
        onHook,
        sessionOf: () => current,
        onElicitation: async (params) => {
          const approval = nativeAppApprovalOptions(params);
          if (approval) noteApproval(approval.resource);
          // Cancel, not decline: nothing is decided, so a retry after `lcu apps allow` is not refused.
          return { action: 'cancel' };
        },
      };
    },
  });
}

/**
 * Junie command hook: tell the relays of the Junie process that runs this hook about `hook_event_name`, and
 * print UserPromptSubmit's additional context. It never blocks or fails Junie: every problem exits 0 silently.
 */
export async function runJunieHook({
  stdin = readFileSync(0, 'utf8'), env = process.env, directory = controlDirectory({ env }),
  parent = process.ppid, write = text => process.stdout.write(text),
} = {}) {
  let input;
  try {
    input = JSON.parse(stdin);
  } catch {
    return;
  }
  const event = input?.hook_event_name;
  if (!Object.hasOwn(HOOK_EVENTS, event) || typeof input.session_id !== 'string' || !input.session_id) return;
  const results = await askRelays({ hook_event_name: event, session_id: input.session_id },
    { directory, parent, ancestors: HOOK_ANCESTORS, timeoutSeconds: HOOK_TIMEOUTS[event] });
  const contexts = results.map(result => result.additional_context)
    .filter(context => typeof context === 'string' && context);
  if (event === 'UserPromptSubmit' && contexts.length) {
    write(JSON.stringify({ hookSpecificOutput: { hookEventName: event, additionalContext: contexts.join('\n\n') } }));
  }
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.length === 1 && argv[0] === '--hook') {
    await runJunieHook().catch(() => {});
    return;
  }
  if (!argv.length) throw new Error('Usage: junie.mjs ORIGINAL_MCP_COMMAND [ARG ...] | junie.mjs --hook');
  const relay = await runJunieRelay({ command: argv, cwd: process.cwd() });
  for (const signal of ['SIGTERM', 'SIGHUP']) {
    process.once(signal, () => { relay.close().finally(() => process.exit(0)); });
  }
}

if (isMainModule(import.meta.url)) {
  main().catch(error => {
    console.error('Junie MCP relay failed:', asError(error));
    process.exitCode = 1;
  });
}
