// Registration boundaries for the Oh My Pi, Hermes and DeepSeek Harness native harness packages and the Junie files.
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readdirSync, readFileSync, realpathSync, symlinkSync } from 'node:fs';
import { ANTIGRAVITY_HOOK_NAME, ANTIGRAVITY_HOOKS, DSH_PACKAGE, dshDesktopListed, isAntigravityHook, isJunieHook, JUNIE_HOOKS } from '../../lcu/harness_setup.mjs';
import { join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

import * as setup from '../../lcu/setup.mjs';
import { output, override, posixTests, REPO, result, temporary, write } from './fixtures.mjs';

const test = posixTests('the fake OMP, Hermes and DSH CLIs are sh scripts');

function fixture(t, releaseName = 'release') {
  const root = temporary(t);
  const home = join(root, 'home');
  const project = join(root, 'project with spaces');
  mkdirSync(home);
  mkdirSync(project);
  const release = join(root, releaseName);
  write(join(release, 'adapters/pi/index.ts'), 'export default function () {}');
  for (const name of ['plugin.yaml', '__init__.py', 'bridge.mjs']) write(join(release, 'adapters/hermes', name), `fixture ${name}`);
  write(join(release, 'adapters/dsh/plugin.mjs'), 'export function apply() {}');
  write(join(release, 'adapters/junie.mjs'), '// relay');
  write(join(release, 'adapters/antigravity.mjs'), '// relay');
  const tools = join(root, 'tools');
  write(join(tools, 'node/bin/node'), '#!/bin/sh\n', 0o755);
  write(join(tools, 'node_modules/skills/bin/cli.mjs'));
  write(join(tools, 'node_modules/add-mcp/dist/index.js'));
  write(join(release, 'installation.json'), '{"app":"app"}');
  mkdirSync(join(release, 'app/resources'), { recursive: true });
  const f = { root, home, project, release, tools, command: ['/opt/lcu/current/bin/lcu', '--audio', '--chrome'], calls: [] };
  f.listing = '';
  f.configure = async (name, { scope = 'user', run, executable = `/bin/${name}`, env = {}, dshProfile, apps = [] } = {}) => {
    override(t, setup.seams, 'which', () => executable);
    override(t, setup.seams, 'dshApps', () => apps);
    override(t, setup.seams, 'run', (command, args, options) => {
      f.calls.push({ argv: [command, ...args], options });
      if (command === '/bin/ps') return result(0, f.listing);
      return run ? run(command, args, options) : result(0);
    });
    f.seen = await output(t);
    return setup.configure([name], home, f.command, tools, release, { scope, project: scope === 'project' ? project : null,
      environ: { PATH: '/bin', ...env }, ...(dshProfile ? { dshProfile } : {}) });
  };
  return f;
}

const files = (root) => Object.fromEntries(readdirSync(root, { recursive: true }).sort()
  .filter((name) => { try { readFileSync(join(root, name)); return true; } catch { return false; } })
  .map((name) => [name, readFileSync(join(root, name), 'utf8')]));

test('detect finds a harness by its executable, and DeepSeek Harness also by its app', (t) => {
  override(t, setup.seams, 'which', (name) => (name === 'omp' ? '/mock/bin/omp' : null));
  override(t, setup.seams, 'dshApps', () => []);
  const home = temporary(t);
  assert.deepEqual(setup.detect(home), ['omp']);
  const app = join(home, 'Applications/DeepSeek Harness.app');
  write(join(app, 'Contents/Resources/runtime/cli/bin/dsh'), '#!/bin/sh\n', 0o755);
  override(t, setup.seams, 'dshApps', () => [app]);
  assert.deepEqual(setup.detect(home), ['omp', 'dsh']);
  assert.equal(setup.harnessInstalled('dsh', home, '/bin'), true);
});

test('detect finds Antigravity from any of its config or app directories even when agy is off PATH', (t) => {
  override(t, setup.seams, 'which', () => null);
  override(t, setup.seams, 'dshApps', () => []);
  assert.deepEqual(setup.detect(temporary(t)), []);
  for (const dir of ['.gemini/antigravity', '.gemini/antigravity-cli', '.gemini/antigravity-ide', '.gemini/config']) {
    const home = temporary(t);
    mkdirSync(join(home, dir), { recursive: true });
    assert.deepEqual(setup.detect(home), ['antigravity'], dir);
  }
});

test('OMP links a per-profile package that imports the adapter relatively, with the command and no skill', async (t) => {
  const f = fixture(t);
  for (const profile of ['blue', 'green']) {
    assert.deepEqual(await f.configure('omp', { env: { OMP_PROFILE: profile } }), []);
    const { argv, options } = f.calls.at(-1);
    assert.deepEqual(argv.slice(0, 3), ['/bin/omp', 'plugin', 'link']);
    const pkg = argv[3];
    assert.deepEqual(JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8')).omp.extensions, ['./index.ts']);
    const wrapper = readFileSync(join(pkg, 'index.ts'), 'utf8');
    const specifier = JSON.parse(wrapper.split('import lcu from ')[1].split(';')[0]);
    assert.ok(specifier.startsWith('.'));
    assert.equal(realpathSync(resolve(pkg, specifier)), join(f.release, 'adapters/pi/index.ts'));
    assert.ok(wrapper.includes(JSON.stringify(f.command)) && wrapper.includes('connectOnLoad: true') && wrapper.includes('ompEssentialTools: true'));
    assert.equal(existsSync(join(pkg, 'skills')), false);
    assert.equal(options.cwd, f.home);
    assert.equal(options.env.HOME, f.home);
  }
  assert.notEqual(f.calls[0].argv.at(-1), f.calls[1].argv.at(-1));
  assert.equal(existsSync(join(f.project, '.pi')), false);
});

test('OMP and Hermes refuse project scope, a missing executable, and relative profiles without installing', async (t) => {
  const f = fixture(t);
  let failures = await f.configure('omp', { scope: 'project' });
  assert.match(failures[0][2], /project scope is not supported/);
  assert.equal(f.calls.length, 0);
  failures = await f.configure('hermes', { scope: 'project' });
  assert.match(failures[0][2], /project scope is not supported/);
  assert.equal(existsSync(join(f.home, '.hermes')), false);
  failures = await f.configure('omp', { executable: null });
  assert.deepEqual(failures[0].slice(0, 2), ['omp', 'plugin']);
  assert.match(failures[0][2], /not on the target account PATH/);
  assert.equal(existsSync(join(f.home, '.local/share/lcu/omp')), false);
  await assert.rejects(f.configure('hermes', { env: { HERMES_HOME: 'relative/profile' } }), /must be absolute/);
  await assert.rejects(f.configure('omp', { env: { PI_CODING_AGENT_DIR: 'relative/profile' } }), /must be absolute/);
  failures = await f.configure('omp', { run: () => result(9, '', 'plugin failed') });
  assert.match(failures[0][2], /plugin failed/);
});

test('Hermes registers its local plugin and command under the selected profile', async (t) => {
  const f = fixture(t);
  assert.deepEqual(await f.configure('hermes'), []);
  assert.deepEqual(f.calls[0].argv, ['/bin/hermes', 'plugins', 'enable', 'lcu-cua']);
  assert.equal(f.calls[0].options.env.HERMES_HOME, join(f.home, '.hermes'));
  const pkg = join(f.home, '.hermes/plugins/lcu-cua');
  assert.deepEqual(JSON.parse(readFileSync(join(pkg, 'lcu-config.json'), 'utf8')),
    { command: f.command, node: join(f.tools, 'node/bin/node'), bridge: join(f.release, 'adapters/hermes/bridge.mjs') });
  const profile = join(f.root, 'custom hermes profile');
  assert.deepEqual(await f.configure('hermes', { env: { HERMES_HOME: profile } }), []);
  assert.ok(existsSync(join(profile, 'plugins/lcu-cua/lcu-config.json')));
  assert.equal(f.calls.at(-1).options.env.HERMES_HOME, profile);
});

test('a symlinked or unowned plugin directory is never replaced', async (t) => {
  const f = fixture(t);
  const other = write(join(f.root, 'other-plugin/keep.txt'), 'untouched');
  mkdirSync(join(f.home, '.hermes/plugins'), { recursive: true });
  symlinkSync(join(f.root, 'other-plugin'), join(f.home, '.hermes/plugins/lcu-cua'));
  assert.match((await f.configure('hermes'))[0][2], /symlink/);
  assert.equal(readFileSync(other, 'utf8'), 'untouched');
  const g = fixture(t);
  const mine = write(join(g.home, '.hermes/plugins/lcu-cua/__init__.py'), 'user plugin');
  assert.match((await g.configure('hermes'))[0][2], /unowned plugin directory/);
  assert.equal(readFileSync(mine, 'utf8'), 'user plugin');
});

test('a failed re-registration restores the previous package', async (t) => {
  const f = fixture(t);
  assert.deepEqual(await f.configure('hermes'), []);
  const pkg = join(f.home, '.hermes/plugins/lcu-cua');
  const previous = files(pkg);
  f.command = ['/changed/runtime'];
  const failures = await f.configure('hermes', { run: () => result(1, '', 'enable failed') });
  assert.match(failures[0][2], /enable failed/);
  assert.deepEqual(files(pkg), previous);
});

const dshCall = (f) => f.calls.filter(({ argv }) => argv[0] !== '/bin/ps').at(-1);

test('DSH links a generated bundle per profile through `dsh plugin add`, importing the adapter and DSH helper', async (t) => {
  const f = fixture(t);
  assert.deepEqual(await f.configure('dsh'), []);
  const { argv, options } = dshCall(f);
  assert.deepEqual(argv.slice(0, 4), ['/bin/dsh', 'plugin', '--profile', 'desktop']);
  assert.equal(argv[4], 'add');
  const pkg = argv[5];
  assert.equal(pkg, join(f.home, '.local/share/lcu/dsh', pkg.split('/').at(-1)));
  assert.match(pkg.split('/').at(-1), /^desktop-[0-9a-f]{16}$/);
  assert.equal(options.cwd, f.home);
  assert.equal(options.env.HOME, f.home);
  const manifest = JSON.parse(readFileSync(join(pkg, 'package.json'), 'utf8'));
  assert.equal(manifest.name, DSH_PACKAGE);
  assert.equal(manifest.type, 'module');
  assert.equal(manifest.engines.dsh, '>=0.2.1-rc.2 <0.3');
  assert.deepEqual(manifest.peerDependencies, { '@deepseek-ai/dsh-mcp-client': '*' });
  assert.deepEqual(manifest.dsh, { bundle: { patch: './cordis.patch.yml' } });
  assert.deepEqual(manifest.exports, { '.': './index.js', './locale/*.json': './locale/*.json', './icon': './icon.svg' });
  for (const name of manifest.files) assert.ok(existsSync(join(pkg, name.replace('*', 'en'))), name);
  const patch = readFileSync(join(pkg, 'cordis.patch.yml'), 'utf8');
  assert.equal(patch, `- insert:\n    - id: lcu-computer-use\n      name: lcu-computer-use\n      config: ${JSON.stringify({ command: f.command })}\n`);
  const wrapper = readFileSync(join(pkg, 'index.js'), 'utf8');
  assert.match(wrapper, /import \{ createMcpToolDefinition \} from '@deepseek-ai\/dsh-mcp-client';/);
  const specifier = JSON.parse(wrapper.split('import * as lcu from ')[1].split(';')[0]);
  assert.ok(specifier.startsWith('.'));
  assert.equal(realpathSync(resolve(pkg, specifier)), join(f.release, 'adapters/dsh/plugin.mjs'));
  assert.match(wrapper, /export async function apply\(ctx, config\) \{\n  return lcu\.apply\(ctx, config, \{ createMcpToolDefinition \}\);/);
  assert.equal(JSON.parse(readFileSync(join(pkg, 'locale/en.json'), 'utf8')).meta.title, 'LCU Computer Use');
  assert.match(readFileSync(join(pkg, 'icon.svg'), 'utf8'), /^<svg xmlns="http:\/\/www.w3.org\/2000\/svg"/);
  assert.match(f.seen.out, /DeepSeek Harness: plugin registered in profile desktop \(remove it with `dsh plugin --profile desktop remove lcu-computer-use`\)/);
  // A rerun replaces the same package; another profile or DSH_HOME gets its own.
  const before = files(pkg);
  assert.deepEqual(await f.configure('dsh'), []);
  assert.equal(dshCall(f).argv[5], pkg);
  assert.deepEqual(files(pkg), before);
  assert.deepEqual(await f.configure('dsh', { dshProfile: 'web' }), []);
  assert.deepEqual(dshCall(f).argv.slice(2, 4), ['--profile', 'web']);
  assert.match(dshCall(f).argv[5], /\/web-[0-9a-f]{16}$/);
  assert.deepEqual(await f.configure('dsh', { env: { DSH_HOME: join(f.root, 'other dsh home') } }), []);
  assert.notEqual(dshCall(f).argv[5], pkg);
  assert.equal(dshCall(f).options.env.DSH_HOME, join(f.root, 'other dsh home'));
});

test('DSH percent-encodes the adapter import so `#`, `?` and `%` in the prefix stay in the path', async (t) => {
  const f = fixture(t, 'lcu#beta?x=%41 b');
  write(join(f.release, 'adapters/dsh/plugin.mjs'), "export const name = 'lcu-fixture';");
  assert.deepEqual(await f.configure('dsh'), []);
  const pkg = dshCall(f).argv[5];
  const wrapper = readFileSync(join(pkg, 'index.js'), 'utf8');
  const specifier = JSON.parse(wrapper.split('import * as lcu from ')[1].split(';')[0]);
  assert.ok(specifier.startsWith('.'));
  const url = new URL(specifier, pathToFileURL(join(pkg, 'index.js')));
  assert.equal(realpathSync(fileURLToPath(url)), realpathSync(join(f.release, 'adapters/dsh/plugin.mjs')));
  assert.equal((await import(url.href)).name, 'lcu-fixture');
});

test('DSH uses the CLI inside the installed app when no dsh is on PATH, and refuses without either', async (t) => {
  const f = fixture(t);
  const app = join(f.root, 'Applications/DeepSeek Harness.app');
  const cli = write(join(app, 'Contents/Resources/runtime/cli/bin/dsh'), '#!/bin/sh\n', 0o755);
  assert.deepEqual(await f.configure('dsh', { executable: null, apps: [join(f.root, 'missing.app'), app] }), []);
  assert.equal(dshCall(f).argv[0], cli);
  const g = fixture(t);
  const failures = await g.configure('dsh', { executable: null });
  assert.deepEqual(failures[0].slice(0, 2), ['dsh', 'plugin']);
  assert.match(failures[0][2], /DeepSeek Harness was not found/);
  assert.equal(existsSync(join(g.home, '.local/share/lcu/dsh')), false);
});

test('DSH refuses project scope, bad profiles, a relative DSH_HOME and a failed install without leaving a package', async (t) => {
  const f = fixture(t);
  assert.match((await f.configure('dsh', { scope: 'project' }))[0][2], /project scope is not supported/);
  assert.match((await f.configure('dsh', { dshProfile: '../desktop' }))[0][2], /Invalid DeepSeek Harness profile/);
  await assert.rejects(f.configure('dsh', { env: { DSH_HOME: 'relative' } }), /DSH_HOME must be absolute/);
  assert.equal(f.calls.filter(({ argv }) => argv[0] === '/bin/dsh').length, 0);
  const failures = await f.configure('dsh', { run: () => result(1, '', 'dsh: plugin command failed') });
  assert.match(failures[0][2], /plugin command failed/);
  assert.deepEqual(readdirSync(join(f.home, '.local/share/lcu/dsh')), []);
});

test('DSH setup refuses the desktop profile while DeepSeek Harness Desktop runs', { skip: process.platform !== 'darwin' && 'macOS only' }, async (t) => {
  const f = fixture(t);
  f.listing = '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness\n';
  const failures = await f.configure('dsh');
  assert.match(failures[0][2], /DeepSeek Harness Desktop is running/);
  assert.equal(f.calls.filter(({ argv }) => argv[0] === '/bin/dsh').length, 0);
  assert.equal(existsSync(join(f.home, '.local/share/lcu/dsh')), false);
  // Other profiles do not touch the app's profile.
  assert.deepEqual(await f.configure('dsh', { dshProfile: 'web' }), []);
});

test('the DSH Desktop check matches the app, not the dsh CLI that runs on the same binary', () => {
  const binary = '/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness';
  assert.equal(dshDesktopListed(`/usr/bin/login\n${binary}\n`), true);
  assert.equal(dshDesktopListed(`${binary} --expose-internals /x/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/index.js /x\n`), true);
  assert.equal(dshDesktopListed(`/Users/me/Applications/DeepSeek Harness.app/Contents/MacOS/DeepSeek Harness\n`), true);
  assert.equal(dshDesktopListed(`${binary} --expose-internals /x/app.asar/dsh/node_modules/@deepseek-ai/dsh-desktop-host/lib/cli.js plugin\n`), false);
  assert.equal(dshDesktopListed(`/Applications/DeepSeek Harness.app/Contents/Frameworks/DeepSeek Harness Helper.app/Contents/MacOS/DeepSeek Harness Helper\n`), false);
  assert.equal(dshDesktopListed('grep DeepSeek Harness\n'), false);
});

const readJson = (path) => JSON.parse(readFileSync(path, 'utf8'));

test('Junie registers the relay in mcp.json and its hooks in config.json, keeping everything else', async (t) => {
  const f = fixture(t);
  const mcpPath = join(f.home, '.junie/mcp/mcp.json');
  const configPath = join(f.home, '.junie/config.json');
  write(mcpPath, JSON.stringify({ mcpServers: { github: { url: 'https://example.invalid/mcp' }, lcu: { command: 'old' } } }));
  const mine = { type: 'command', command: '~/.junie/hooks/check.sh', timeout: 10 };
  write(configPath, JSON.stringify({ model: 'x', hooks: { PreToolUse: [{ matcher: 'Bash', hooks: [mine] }], Stop: [{ hooks: [mine] }] } }));
  assert.deepEqual(await f.configure('junie'), []);
  assert.deepEqual(f.calls, []);
  const node = join(f.tools, 'node/bin/node');
  const adapter = join(f.release, 'adapters/junie.mjs');
  assert.deepEqual(readJson(mcpPath).mcpServers, { github: { url: 'https://example.invalid/mcp' },
    lcu: { command: node, args: [adapter, ...f.command], timeout: 3_600_000 } });
  const config = readJson(configPath);
  assert.equal(config.model, 'x');
  assert.deepEqual(Object.keys(config.hooks), ['PreToolUse', 'Stop', 'SessionStart', 'UserPromptSubmit', 'StopFailure', 'SessionEnd']);
  assert.deepEqual(config.hooks.PreToolUse, [{ matcher: 'Bash', hooks: [mine] }]);
  const ours = (timeout) => ({ hooks: [{ type: 'command', command: `${node} ${adapter} --hook`, timeout }] });
  assert.deepEqual(config.hooks.Stop, [{ hooks: [mine] }, ours(60)]);
  for (const [event, timeout] of Object.entries(JUNIE_HOOKS)) if (event !== 'Stop') assert.deepEqual(config.hooks[event], [ours(timeout)]);
  assert.match(f.seen.out, /Junie: MCP server registered in .*mcp\.json; turn hooks in .*config\.json\./);
  // A second run changes nothing.
  const bytes = [readFileSync(mcpPath, 'utf8'), readFileSync(configPath, 'utf8')];
  assert.deepEqual(await f.configure('junie'), []);
  assert.deepEqual([readFileSync(mcpPath, 'utf8'), readFileSync(configPath, 'utf8')], bytes);
});

test('Junie setup replaces an earlier release\'s hooks, and refuses project scope and malformed files', async (t) => {
  const f = fixture(t, 'release with space');
  const configPath = join(f.home, '.junie/config.json');
  const old = { type: 'command', command: "/old/node '/opt/lcu/0.11.0 x/adapters/junie.mjs' --hook", timeout: 30 };
  assert.ok(isJunieHook(old));
  assert.ok(!isJunieHook({ type: 'command', command: '/x/adapters/junie.mjs --hook --other' }));
  write(configPath, JSON.stringify({ hooks: { Stop: [{ hooks: [old] }, { hooks: [old, { type: 'command', command: 'mine' }] }] } }));
  assert.deepEqual(await f.configure('junie'), []);
  const stop = readJson(configPath).hooks.Stop;
  assert.equal(stop.length, 2);
  assert.deepEqual(stop[0], { hooks: [{ type: 'command', command: 'mine' }] });
  assert.match(stop[1].hooks[0].command, /'[^']*release with space\/adapters\/junie\.mjs' --hook$/);
  const failures = await f.configure('junie', { scope: 'project' });
  assert.deepEqual(failures.map(([name, phase]) => [name, phase]), [['junie', 'MCP']]);
  assert.match(failures[0][2], /--scope user; project scope is not supported/);
  for (const content of ['[]', '{"hooks": []}', '{"hooks": {"Stop": {}}}', '{"hooks": {"Stop": [{"command": "x"}]}}']) {
    write(configPath, content);
    const [[, , message]] = await f.configure('junie');
    assert.match(message, /Junie/);
    assert.equal(readFileSync(configPath, 'utf8'), content);
  }
});

test('the Junie hook table agrees with the relay', () => {
  const relay = readFileSync(join(REPO, 'adapters/junie.mjs'), 'utf8');
  const table = /HOOK_TIMEOUTS = (\{[^}]*\})/.exec(relay)[1].replace(/(\w+):/g, '"$1":');
  assert.deepEqual(JSON.parse(table), JUNIE_HOOKS);
  const events = /HOOK_EVENTS = \{([^}]*)\}/.exec(relay)[1].match(/(\w+):/g).map((key) => key.slice(0, -1));
  assert.deepEqual(events, Object.keys(JUNIE_HOOKS));
});

test('Antigravity registers the relay in mcp_config.json and hooks in hooks.json at user and project scope', async (t) => {
  const f = fixture(t);
  const mcpPath = join(f.home, '.gemini/config/mcp_config.json');
  const hooksPath = join(f.home, '.gemini/config/hooks.json');
  // An empty (0-byte) mcp_config.json, as Antigravity leaves before any server is added, parses cleanly.
  write(mcpPath, '');
  const other = { command: 'cmux-hook' };
  const mine = { type: 'command', command: './my-stop.sh', timeout: 5 };
  write(hooksPath, JSON.stringify({ cmux: { Stop: [other] }, [ANTIGRAVITY_HOOK_NAME]: { Stop: [mine] } }));
  assert.deepEqual(await f.configure('antigravity'), []);
  assert.deepEqual(f.calls, []);
  const node = join(f.tools, 'node/bin/node');
  const adapter = join(f.release, 'adapters/antigravity.mjs');
  assert.deepEqual(readJson(mcpPath).mcpServers, {
    lcu: {
      command: node,
      args: [adapter, ...f.command],
      timeoutSeconds: 3_600,
      tools: { js: { eager: true }, js_reset: { eager: true } },
    },
  });
  const hooks = readJson(hooksPath);
  assert.deepEqual(hooks.cmux, { Stop: [other] });
  const expected = (timeout) => ({ type: 'command', command: `${node} ${adapter} --hook`, timeout });
  assert.deepEqual(hooks[ANTIGRAVITY_HOOK_NAME].Stop, [mine, expected(60)]);
  assert.deepEqual(hooks[ANTIGRAVITY_HOOK_NAME].SessionStart, [expected(10)]);
  assert.deepEqual(hooks[ANTIGRAVITY_HOOK_NAME].PreInvocation, [expected(30)]);
  assert.match(f.seen.out, /Antigravity: MCP server registered in .*mcp_config\.json; turn hooks in .*hooks\.json\./);
  // A second run changes nothing.
  const bytes = [readFileSync(mcpPath, 'utf8'), readFileSync(hooksPath, 'utf8')];
  assert.deepEqual(await f.configure('antigravity'), []);
  assert.deepEqual([readFileSync(mcpPath, 'utf8'), readFileSync(hooksPath, 'utf8')], bytes);
  // Project scope writes under <project>/.agents/ and preserves user files.
  assert.deepEqual(await f.configure('antigravity', { scope: 'project' }), []);
  const projectMcp = join(f.project, '.agents/mcp_config.json');
  const projectHooks = join(f.project, '.agents/hooks.json');
  assert.deepEqual(readJson(projectMcp).mcpServers.lcu.args, [adapter, ...f.command]);
  assert.deepEqual(readJson(projectHooks)[ANTIGRAVITY_HOOK_NAME].Stop, [expected(60)]);
  assert.deepEqual([readFileSync(mcpPath, 'utf8'), readFileSync(hooksPath, 'utf8')], bytes);
});

test('Antigravity setup replaces earlier release hooks and refuses malformed files without editing', async (t) => {
  const f = fixture(t, 'release with space');
  const hooksPath = join(f.home, '.gemini/config/hooks.json');
  const old = { type: 'command', command: "/old/node '/opt/lcu/0.13.9 x/adapters/antigravity.mjs' --hook", timeout: 30 };
  assert.ok(isAntigravityHook(old));
  assert.ok(isAntigravityHook({ command: '/x/adapters/antigravity.mjs --hook' }));
  assert.ok(!isAntigravityHook({ type: 'command', command: '/x/adapters/antigravity.mjs --hook --other' }));
  write(hooksPath, JSON.stringify({ lcu: { Stop: [old, { type: 'command', command: 'mine' }] } }));
  assert.deepEqual(await f.configure('antigravity'), []);
  const stop = readJson(hooksPath).lcu.Stop;
  assert.equal(stop.length, 2);
  assert.deepEqual(stop[0], { type: 'command', command: 'mine' });
  assert.match(stop[1].command, /'[^']*release with space\/adapters\/antigravity\.mjs' --hook$/);
  for (const content of ['[]', '{"lcu": []}', '{"lcu": {"Stop": {}}}', '{"lcu": {"Stop": ["x"]}}']) {
    write(hooksPath, content);
    const [[, , message]] = await f.configure('antigravity');
    assert.match(message, /Antigravity/);
    assert.equal(readFileSync(hooksPath, 'utf8'), content);
  }
});

test('the Antigravity hook table agrees with the relay', () => {
  const relay = readFileSync(join(REPO, 'adapters/antigravity.mjs'), 'utf8');
  const table = /HOOK_TIMEOUTS = (\{[^}]*\})/.exec(relay)[1].replace(/(\w+):/g, '"$1":');
  assert.deepEqual(JSON.parse(table), ANTIGRAVITY_HOOKS);
  const events = /HOOK_EVENTS = \{([^}]*)\}/.exec(relay)[1].match(/(\w+):/g).map((key) => key.slice(0, -1));
  assert.deepEqual(events, Object.keys(ANTIGRAVITY_HOOKS));
});
