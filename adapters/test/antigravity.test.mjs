import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ElicitRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import {
  approvalHint,
  CONVERSATION_ID_META,
  controlDirectory,
  INSTRUCTIONS_HEADER,
  launcherOf,
  runAntigravityHook,
  stopEventOf,
} from '../antigravity.mjs';

// Antigravity setup refuses Windows for now: the relay and its hooks meet on a Unix socket.
const unix = { skip: process.platform === 'win32' && 'Antigravity is not supported on Windows' };
const relay = fileURLToPath(new URL('../antigravity.mjs', import.meta.url));
const fixture = fileURLToPath(new URL('./mcp-fixture.mjs', import.meta.url));

/** The relay as Antigravity runs it: a child of this process, which also runs the hooks. */
async function withRelay(run, { elicitation, onElicit, extraEnv = {} } = {}) {
  const directory = mkdtempSync(join(tmpdir(), 'lcu-antigravity-'));
  const control = join(directory, 'control');
  const log = join(directory, 'fixture.jsonl');
  const env = {
    PATH: process.env.PATH ?? '/usr/bin:/bin', HOME: directory, TMPDIR: directory,
    LCU_FIXTURE_LOG: log, LCU_ANTIGRAVITY_CONTROL_DIR: control, LCU_DIAGNOSTIC_LOG: '0',
    ...extraEnv,
  };
  const transport = new StdioClientTransport({
    command: process.execPath, args: [relay, process.execPath, fixture], env, stderr: 'pipe',
  });
  const capabilities = elicitation ? { elicitation } : {};
  const client = new Client({ name: 'antigravity-client', version: '1.0.0' }, { capabilities });
  if (onElicit) client.setRequestHandler(ElicitRequestSchema, onElicit);
  await client.connect(transport);
  const entries = () => existsSync(log) ? readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse) : [];
  const hook = (event, conversationId, extra = {}) => new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [relay, '--hook'], { env, stdio: ['pipe', 'pipe', 'inherit'] });
    let stdout = '';
    child.stdout.on('data', chunk => { stdout += chunk; });
    child.on('error', reject);
    child.on('close', status => resolve({ status, stdout }));
    child.stdin.end(JSON.stringify({ hookEventName: event, conversationId, cwd: directory, ...extra }));
  });
  const js = async (code, conversationId) => (await client.callTool({
    name: 'js',
    arguments: { code },
    ...(conversationId ? { _meta: { [CONVERSATION_ID_META]: conversationId } } : {}),
  })).content.map(item => item.text);
  const until = async predicate => {
    for (let i = 0; i < 200 && !predicate(entries()); i++) await new Promise(resolve => setTimeout(resolve, 10));
    assert.ok(predicate(entries()), JSON.stringify(entries()));
  };
  try {
    return await run({ client, transport, hook, js, entries, until, control, directory });
  } finally {
    await client.close().catch(() => {});
    rmSync(directory, { recursive: true, force: true });
  }
}

const turnOf = entry => entry.meta['x-codex-turn-metadata'];
const INSTRUCTIONS_BLOCK = `${INSTRUCTIONS_HEADER}\n\nOriginal CUA initialization guide.`;

test('Antigravity relay lists only the original js and js_reset with original instructions and rejects host tools', unix, async () => {
  await withRelay(async ({ client, control }) => {
    const { tools } = await client.listTools();
    assert.deepEqual(tools.map(tool => tool.name), ['js', 'js_reset']);
    assert.equal(tools[0].description, 'Original JS description.');
    assert.equal(client.getInstructions(), 'Original CUA initialization guide.');
    const sockets = readdirSync(control);
    assert.deepEqual(sockets, [`${process.pid}-${client.transport.pid}.sock`]);
    const result = await client.callTool({ name: 'turn_ended', arguments: {} });
    assert.equal(result.isError, true);
  });
});

test('SessionStart and PreInvocation inject original instructions once per conversation as injectSteps', unix, async () => {
  await withRelay(async ({ hook, js }) => {
    const start = await hook('SessionStart', 'conv-1');
    assert.equal(start.status, 0);
    assert.deepEqual(JSON.parse(start.stdout), {
      injectSteps: [{ systemMessage: { systemMessage: 'Original CUA initialization guide.' } }],
    });
    // PreInvocation for the same conversation does not repeat instructions.
    assert.deepEqual(JSON.parse((await hook('PreInvocation', 'conv-1', { invocationNum: 0 })).stdout), {});
    assert.deepEqual(await js('one', 'conv-1'), ['one']);
    assert.deepEqual(JSON.parse((await hook('PreInvocation', 'conv-1', { invocationNum: 1 })).stdout), {});
    // A second conversation whose SessionStart missed the relay gets instructions on PreInvocation once.
    const pre = await hook('PreInvocation', 'conv-2', { invocationNum: 0 });
    assert.deepEqual(JSON.parse(pre.stdout), {
      injectSteps: [{ systemMessage: { systemMessage: 'Original CUA initialization guide.' } }],
    });
    assert.deepEqual(JSON.parse((await hook('PreInvocation', 'conv-2', { invocationNum: 1 })).stdout), {});
  });
});

test('per-call conversation_id keeps concurrent conversations and subagents isolated across Stop and PreInvocation', unix, async () => {
  await withRelay(async ({ hook, js, entries, until }) => {
    await hook('SessionStart', 'parent-conv');
    await hook('PreInvocation', 'parent-conv', { invocationNum: 0 });
    assert.deepEqual(await js('parent-1', 'parent-conv'), ['parent-1']);

    // Starting a subagent conversation must not interrupt the parent's active turn.
    await hook('SessionStart', 'child-conv');
    await hook('PreInvocation', 'child-conv', { invocationNum: 0 });
    assert.deepEqual(await js('child-1', 'child-conv'), ['child-1']);
    await hook('Stop', 'child-conv', { terminationReason: 'NO_TOOL_CALL' });
    await until(list => list.length === 3);

    // Parent continues in its same open turn after a mid-turn PreInvocation (`invocationNum: 1`).
    await hook('PreInvocation', 'parent-conv', { invocationNum: 1 });
    assert.deepEqual(await js('parent-2', 'parent-conv'), ['parent-2']);
    await hook('Stop', 'parent-conv', { terminationReason: 'NO_TOOL_CALL' });
    await until(list => list.length === 5);

    const [p1, c1, cStop, p2, pStop] = entries();
    assert.equal(turnOf(p1).session_id, 'parent-conv');
    assert.equal(turnOf(p2).session_id, 'parent-conv');
    assert.equal(turnOf(p1).turn_id, turnOf(p2).turn_id);
    assert.notEqual(turnOf(p1).call_id, turnOf(p2).call_id);
    assert.equal(turnOf(c1).session_id, 'child-conv');
    assert.notEqual(turnOf(c1).turn_id, turnOf(p1).turn_id);
    assert.deepEqual([cStop.name, cStop.args.hook_event_name, cStop.args.session_id, cStop.args.turn_id],
      ['turn_ended', 'Stop', 'child-conv', turnOf(c1).turn_id]);
    assert.deepEqual([pStop.name, pStop.args.hook_event_name, pStop.args.session_id, pStop.args.turn_id],
      ['turn_ended', 'Stop', 'parent-conv', turnOf(p1).turn_id]);
  });
});

test('Stop maps terminationReason to Stop vs Interrupt and PreInvocation(0) closes a missed prior turn', unix, async () => {
  assert.equal(stopEventOf('NO_TOOL_CALL'), 'Stop');
  assert.equal(stopEventOf(undefined), 'Stop');
  assert.equal(stopEventOf(''), 'Stop');
  assert.equal(stopEventOf('USER_CANCELED'), 'Interrupt');
  assert.equal(stopEventOf('ERROR'), 'Interrupt');
  assert.equal(stopEventOf('MAX_INVOCATIONS'), 'Interrupt');

  await withRelay(async ({ hook, js, entries, until }) => {
    await hook('SessionStart', 'conv-a');
    await js('turn-1', 'conv-a');
    await hook('Stop', 'conv-a', { terminationReason: 'USER_CANCELED' });
    await until(list => list.length === 2);
    assert.equal(entries()[1].args.hook_event_name, 'Interrupt');

    await js('turn-2', 'conv-a');
    await hook('Stop', 'conv-a', { terminationReason: 'ERROR' });
    await until(list => list.length === 4);
    assert.equal(entries()[3].args.hook_event_name, 'Interrupt');

    // Missed Stop: a fresh turn's PreInvocation(0) ends turn-3, whereas PreInvocation(1) keeps it open.
    await js('turn-3', 'conv-a');
    await hook('PreInvocation', 'conv-a', { invocationNum: 1 });
    assert.equal(entries().length, 5);
    await hook('PreInvocation', 'conv-a', { invocationNum: 0 });
    await until(list => list.length === 6);
    assert.deepEqual([entries()[5].args.hook_event_name, entries()[5].args.turn_id], ['Stop', turnOf(entries()[4]).turn_id]);

    // Stop with no LCU call in the turn or for an unknown conversation sends nothing upstream.
    await hook('Stop', 'conv-a', { terminationReason: 'NO_TOOL_CALL' });
    await hook('Stop', 'other-conv', { terminationReason: 'NO_TOOL_CALL' });
    await new Promise(resolve => setTimeout(resolve, 50));
    assert.equal(entries().length, 6);
  });
});

test('late-started relay prepends instructions on the first call once and shutdown interrupts open turns', unix, async () => {
  await withRelay(async ({ client, hook, js, entries, until }) => {
    assert.deepEqual(await js('early', 'conv-late'), [INSTRUCTIONS_BLOCK, 'early']);
    assert.deepEqual(await js('again', 'conv-late'), ['again']);
    // Subsequent PreInvocation for the same conversation does not repeat instructions.
    assert.deepEqual(JSON.parse((await hook('PreInvocation', 'conv-late', { invocationNum: 1 })).stdout), {});
    await client.close();
    await until(list => list.length === 3);
    assert.deepEqual([entries()[2].args.hook_event_name, entries()[2].args.session_id, entries()[2].args.turn_id],
      ['Interrupt', 'conv-late', turnOf(entries()[0]).turn_id]);
  });
});

test('calls without conversation_id metadata use the fallback session and Stop adopts it', unix, async () => {
  await withRelay(async ({ hook, js, entries, until }) => {
    assert.deepEqual(await js('early'), [INSTRUCTIONS_BLOCK, 'early']);
    assert.match(turnOf(entries()[0]).session_id, /^antigravity-[0-9a-f-]{36}$/);
    // A mid-turn PreInvocation(1) before Stop leaves the fallback turn open for Stop to adopt and end.
    assert.deepEqual(JSON.parse((await hook('PreInvocation', 'adopted-conv', { invocationNum: 1 })).stdout), {});
    assert.equal(entries().length, 1);
    await hook('Stop', 'adopted-conv', { terminationReason: 'NO_TOOL_CALL' });
    await until(list => list.length === 2);
    assert.deepEqual([entries()[1].args.hook_event_name, entries()[1].args.session_id, entries()[1].args.turn_id],
      ['Stop', turnOf(entries()[0]).session_id, turnOf(entries()[0]).turn_id]);
    assert.deepEqual(JSON.parse((await hook('PreInvocation', 'adopted-conv', { invocationNum: 0 })).stdout), {});
    assert.deepEqual(await js('next'), ['next']);
    assert.equal(turnOf(entries()[2]).session_id, 'adopted-conv');
  });
});

test('a failed turn end is retried before the next call and refuses calls while cleanup still fails', unix, async () => {
  await withRelay(async ({ hook, js, entries }) => {
    await hook('SessionStart', 'fail-once-session');
    await js('one', 'fail-once-session');
    await hook('Stop', 'fail-once-session', { terminationReason: 'NO_TOOL_CALL' });
    await js('two', 'fail-once-session');
    const list = entries();
    assert.deepEqual(list.map(entry => entry.name), ['js', 'turn_ended', 'turn_ended', 'js']);
    assert.equal(list[2].args.turn_id, turnOf(list[0]).turn_id);
    assert.notEqual(turnOf(list[3]).turn_id, turnOf(list[0]).turn_id);

    await hook('SessionStart', 'fail-session');
    await js('three', 'fail-session');
    await hook('Stop', 'fail-session', { terminationReason: 'NO_TOOL_CALL' });
    const refused = await (async () => { try { return await js('four', 'fail-session'); } catch (error) { return error.message; } })();
    assert.match(String(refused), /still finishing the previous turn/);
    assert.equal(entries().some(entry => entry.args?.code === 'four'), false);
  });
});

test('native-app elicitation forwards form when supported and falls back to `lcu apps allow` hint on cancel', unix, async () => {
  // 1. Host advertises form elicitation and answers with a choice -> mapped cleanly, no hint.
  const seenForms = [];
  await withRelay(async ({ hook, js }) => {
    await hook('SessionStart', 'conv-elicit');
    const [sessionReply] = await js('approval-native', 'conv-elicit');
    assert.deepEqual(JSON.parse(sessionReply), { action: 'accept', content: {}, _meta: { persist: 'session' } });
    assert.deepEqual(seenForms[0].requestedSchema.properties.choice.enum, ['once', 'session', 'always', 'decline']);
    // Agent host app is declined by host-guard before elicitation reaches the host.
    assert.deepEqual(await js('approval-native-host', 'conv-elicit'), [JSON.stringify({ action: 'decline' })]);
    assert.equal(seenForms.length, 1);
  }, {
    elicitation: { form: {}, url: {} },
    onElicit: async (request) => {
      seenForms.push(request.params);
      return { action: 'accept', content: { choice: 'session' } };
    },
  });

  // 2. Host declines -> mapped to decline, no hint.
  await withRelay(async ({ hook, js }) => {
    await hook('SessionStart', 'conv-decline');
    assert.deepEqual(await js('approval-native', 'conv-decline'), [JSON.stringify({ action: 'decline' })]);
  }, {
    elicitation: { form: {} },
    onElicit: async () => ({ action: 'decline' }),
  });

  // 3. Host advertises elicitation but cancels (Antigravity CLI 1.5.11 behavior) -> cancel + approvalHint.
  await withRelay(async ({ hook, js }) => {
    await hook('SessionStart', 'conv-cancel');
    const [decision, hint] = await js('approval-native', 'conv-cancel');
    assert.deepEqual(JSON.parse(decision), { action: 'cancel' });
    assert.equal(hint, approvalHint('dev.lcu.NativeFixture.generated'));
    // Overlapping calls receive no hint because an elicitation does not name which call triggered it.
    const [slow, asked] = await Promise.all([js('sleep-300', 'conv-cancel'), js('approval-native', 'conv-cancel')]);
    assert.deepEqual(slow, ['sleep-300']);
    assert.deepEqual(asked, [JSON.stringify({ action: 'cancel' })]);
  }, {
    elicitation: { form: {}, url: {} },
    onElicit: async () => ({ action: 'cancel' }),
  });

  // 4. Browser origin approval via LCU_APPROVED_ORIGINS works without prompting.
  await withRelay(async ({ hook, js }) => {
    await hook('SessionStart', 'conv-origin');
    assert.deepEqual(await js('approval', 'conv-origin'), ['accept']);
  }, {
    extraEnv: { LCU_APPROVED_ORIGINS: JSON.stringify(['http://127.0.0.1:8080']) },
  });

  // Helper formatting checks.
  const hint = approvalHint('Visual Studio Code');
  assert.match(hint, /Run `lcu apps allow "Visual Studio Code"` yourself in a terminal/);
  assert.match(hint, /timeout of at least 300 seconds/);
  assert.match(hint, /show `lcu apps revoke "Visual Studio Code"`, and offer to run it for them\.$/);
  const launcher = '/home/u/.local/share/lcu/current/bin/lcu';
  assert.equal(launcherOf(['/x/bin/lcu-session', '--user', 'u', '--', launcher, '--chrome']), launcher);
  assert.match(approvalHint('Notes', launcher), new RegExp(`\`${launcher} apps allow Notes\``));
});

test('the hook always prints valid JSON `{}` and never fails without a relay, with bad input, or with a stale socket', unix, async () => {
  const directory = mkdtempSync(join(tmpdir(), 'lcu-antigravity-hook-'));
  try {
    const written = [];
    const write = text => written.push(text);
    await runAntigravityHook({ stdin: 'not json', directory, write });
    await runAntigravityHook({ stdin: JSON.stringify({ hookEventName: 'SessionStart', conversationId: 'c' }),
      directory: join(directory, 'missing'), write });
    await runAntigravityHook({ stdin: JSON.stringify({ hookEventName: 'PreToolUse', conversationId: 'c' }), directory, write });
    const stale = join(directory, `${process.pid}-1.sock`);
    spawnSync(process.execPath, ['-e', `require('node:net').createServer().listen(${JSON.stringify(stale)}, () => process.exit(0))`]);
    assert.equal(existsSync(stale), true);
    await runAntigravityHook({
      stdin: JSON.stringify({ hookEventName: 'Stop', conversationId: 'c', terminationReason: 'NO_TOOL_CALL' }),
      directory, write, parent: process.pid,
    });
    assert.deepEqual(written, ['{}', '{}', '{}', '{}']);
    assert.equal(existsSync(stale), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
  assert.equal(controlDirectory({ env: { HOME: '/home/a' } }), '/home/a/.local/state/lcu/antigravity');
  assert.equal(controlDirectory({ env: { HOME: '/home/a', XDG_STATE_HOME: '/s' } }), '/s/lcu/antigravity');
  assert.equal(controlDirectory({ env: { HOME: `/home/${'a'.repeat(60)}` }, temporary: '/tmp', uid: 501 }), '/tmp/lcu-antigravity-501');
});
