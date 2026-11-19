// Local harness packages for Oh My Pi, Hermes and DeepSeek Harness, whose host configuration remains with their native
// installers, and the Junie and Antigravity registrations, which write their JSON config files directly.
import { createHash } from 'node:crypto';
import { accessSync, constants, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

import { MODEL_TOOLS } from './approval.mjs';
import { real, shellQuote } from './fsutil.mjs';
import { applyChanges, change, checked, json, member, parseJson, readFile, regularPath, seams, spacedJson } from './setup.mjs';

const MARKER = '.lcu-generated.json';

/** Replace only our own generated package at `destination` with `files`, run `register`, and restore it if that fails. */
function withPackage(destination, harness, files, register) {
  destination = regularPath(destination);
  const identity = { harness };
  if (existsSync(destination)) {
    const manifest = regularPath(join(destination, MARKER));
    let ours = false;
    try {
      ours = statSync(manifest).isFile() && JSON.stringify(JSON.parse(readFileSync(manifest, 'utf8'))) === JSON.stringify(identity);
    } catch {
      // not ours
    }
    if (!ours) throw new Error(`Refusing to replace an unowned plugin directory: ${destination}`);
    for (const name of readdirSync(destination, { recursive: true })) regularPath(join(destination, name));
  }
  mkdirSync(dirname(destination), { recursive: true });
  const temporary = mkdtempSync(join(dirname(destination), '.lcu-plugin-'));
  try {
    const stage = join(temporary, 'next');
    mkdirSync(stage);
    for (const [name, content] of Object.entries(files)) {
      mkdirSync(dirname(join(stage, name)), { recursive: true });
      writeFileSync(join(stage, name), content);
    }
    writeFileSync(join(stage, MARKER), json(identity));
    const previous = join(temporary, 'previous');
    if (existsSync(destination)) renameSync(destination, previous);
    try {
      renameSync(stage, destination);
      return register(destination);
    } catch (error) {
      rmSync(destination, { recursive: true, force: true });
      if (existsSync(previous)) renameSync(previous, destination);
      throw error;
    }
  } finally {
    rmSync(temporary, { recursive: true, force: true });
  }
}

export function configureOmp(home, command, release, { scope, project, env }) {
  if (scope !== 'user') {
    throw new Error('Oh My Pi native plugin links are profile-scoped. Use --scope user with the intended OMP profile; project scope is not supported.');
  }
  const executable = seams.which('omp', env.PATH);
  if (!executable) throw new Error('Oh My Pi is not on the target account PATH. Install OMP, then rerun `lcu setup --agent omp`.');
  const adapter = join(release, 'adapters/pi/index.ts');
  if (!existsSync(adapter)) throw new Error(`LCU Pi/OMP adapter missing: ${adapter}`);
  // Separate package trees prevent profile setup from changing another registration's selected runtime command
  // or Chrome opt-in. The name derives from the identity as earlier releases wrote it, so it stays the same.
  const identity = [scope, project ? real(project) : '', ...['OMP_PROFILE', 'PI_PROFILE', 'PI_CODING_AGENT_DIR'].map((key) => env[key] ?? '')];
  const suffix = createHash('sha256').update(spacedJson(identity)).digest('hex').slice(0, 16);
  const data = join(home, process.platform === 'win32' ? 'AppData/Local/LCU' : '.local/share/lcu');
  const destination = join(data, 'omp', `${scope}-${suffix}`);
  const manifest = { name: 'lcu-computer-use', version: '0.1.0', private: true, type: 'module', omp: { extensions: ['./index.ts'] } };
  // OMP's compiled loader walks relative imports to resolve transitive npm dependencies. A file:// import
  // bypasses that graph in OMP 18.1.6.
  let specifier = relative(destination, adapter).replaceAll('\\', '/');
  if (isAbsolute(specifier)) throw new Error('OMP requires its generated plugin and the LCU release on the same filesystem drive.');
  if (!specifier.startsWith('.')) specifier = `./${specifier}`;
  const wrapper = `import lcu from ${JSON.stringify(specifier)};\n` +
    `export default pi => lcu(pi, {command: ${JSON.stringify(command)}, connectOnLoad: true, ompEssentialTools: true});\n`;
  withPackage(destination, 'omp', { 'package.json': json(manifest), 'index.ts': wrapper },
    (pkg) => checked('installer', executable, ['plugin', 'link', pkg], { cwd: home, env, timeout: 120_000 }));
}

export function configureHermes(home, command, node, release, { scope, env }) {
  if (scope !== 'user') {
    throw new Error('Hermes native plugins are profile-scoped. Use --scope user with the intended HERMES_HOME; project scope is not supported.');
  }
  const executable = seams.which('hermes', env.PATH);
  if (!executable) throw new Error('Hermes is not on the target account PATH. Install Hermes, then rerun `lcu setup --agent hermes`.');
  const root = env.HERMES_HOME || join(home, '.hermes');
  if (!isAbsolute(root)) throw new Error('HERMES_HOME must be absolute.');
  const source = join(release, 'adapters/hermes');
  const files = {};
  for (const name of ['plugin.yaml', '__init__.py']) {
    if (!existsSync(join(source, name))) throw new Error(`LCU Hermes plugin missing: ${join(source, name)}`);
    files[name] = readFileSync(join(source, name));
  }
  const bridge = join(source, 'bridge.mjs');
  if (!existsSync(bridge)) throw new Error(`LCU Hermes bridge missing: ${bridge}`);
  files['lcu-config.json'] = json({ command, node: String(node), bridge });
  withPackage(join(root, 'plugins/lcu-cua'), 'hermes', files,
    () => checked('installer', executable, ['plugins', 'enable', 'lcu-cua'], { cwd: home, env: { ...env, HERMES_HOME: root }, timeout: 120_000 }));
}


// DeepSeek Harness ------------------------------------------------------------------------------------------

export const DSH_PACKAGE = 'lcu-computer-use';
export const DSH_DEFAULT_PROFILE = 'desktop';
// The DSH runtimes LCU's plugin was written against; DSH refuses the bundle elsewhere unless the user exempts it.
const DSH_ENGINES = '>=0.2.1-rc.2 <0.3';
const DSH_CLI = 'Contents/Resources/runtime/cli/bin/dsh';
// DSH Desktop's main executable. Its `dsh` CLI runs the same binary on `dsh-desktop-host/lib/cli.js`.
const DSH_DESKTOP = /\/DeepSeek Harness\.app\/Contents\/MacOS\/DeepSeek Harness(?: |$)/;

/** DSH's own profile names: one path segment. */
export const validDshProfile = (name) => typeof name === 'string' && /^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(name);

/** The `dsh` CLI: `dsh` on `path`, else the launcher inside an installed DeepSeek Harness app (macOS). */
export function dshExecutable(home, path) {
  const found = seams.which('dsh', path);
  if (found) return found;
  for (const app of seams.dshApps(home)) {
    const candidate = join(app, DSH_CLI);
    try {
      if (!statSync(candidate).isFile()) continue;
      accessSync(candidate, constants.X_OK);
      return candidate;
    } catch {
      // not here
    }
  }
  return null;
}

/** Whether a `ps -axww -o command=` listing shows DSH Desktop (not only the `dsh` CLI on the same binary). */
export const dshDesktopListed = (listing) => listing.split('\n')
  .some((line) => DSH_DESKTOP.test(line) && !line.includes('/dsh-desktop-host/lib/cli.js'));

function dshDesktopRunning() {
  if (process.platform !== 'darwin') return false;
  const result = seams.run('/bin/ps', ['-axww', '-o', 'command='], { timeout: 20_000 });
  if (result.error || result.status !== 0) throw new Error('Could not check whether DeepSeek Harness Desktop is running.');
  return dshDesktopListed(result.stdout ?? '');
}

// An original mark: a pointer over a window.
const DSH_ICON = '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">' +
  '<rect x="6" y="10" width="52" height="40" rx="6" fill="#1f2937"/><rect x="6" y="10" width="52" height="8" rx="4" fill="#4b5563"/>' +
  '<path d="M26 24 L26 50 L32 44 L37 55 L42 53 L37 42 L45 42 Z" fill="#f9fafb" stroke="#111827" stroke-width="2" stroke-linejoin="round"/>' +
  '</svg>\n';

/**
 * Generate LCU's DSH bundle for one profile and install it with DSH's own `dsh plugin --profile P add DIR`, which
 * links the directory into the profile. Its `index.js` imports DSH's MCP tool helper: DSH resolves its own packages
 * for a linked bundle's files that declare them as peers, not for LCU's release files.
 */
export function configureDsh(home, command, release, { scope, env, profile = DSH_DEFAULT_PROFILE }) {
  if (scope !== 'user') {
    throw new Error('DeepSeek Harness plugins are profile-scoped. Use --scope user with --dsh-profile; project scope is not supported.');
  }
  if (!validDshProfile(profile)) throw new Error(`Invalid DeepSeek Harness profile name: ${profile}`);
  const executable = dshExecutable(home, env.PATH);
  if (!executable) {
    throw new Error('DeepSeek Harness was not found: no `dsh` on the target account PATH and no DeepSeek Harness app. ' +
      'Install it, then rerun `lcu setup --agent dsh`.');
  }
  const root = env.DSH_HOME || join(home, '.dsh');
  if (!isAbsolute(root)) throw new Error('DSH_HOME must be absolute.');
  if (profile === DSH_DEFAULT_PROFILE && dshDesktopRunning()) {
    throw new Error('DeepSeek Harness Desktop is running. DSH changes its desktop profile only while the app is closed: ' +
      'quit DeepSeek Harness, rerun `lcu setup --agent dsh`, then open it again.');
  }
  const adapter = join(release, 'adapters/dsh/plugin.mjs');
  if (!existsSync(adapter)) throw new Error(`LCU DSH plugin missing: ${adapter}`);
  const suffix = createHash('sha256').update(spacedJson([profile, real(root)])).digest('hex').slice(0, 16);
  const data = join(home, process.platform === 'win32' ? 'AppData/Local/LCU' : '.local/share/lcu');
  const destination = join(data, 'dsh', `${profile}-${suffix}`);
  // An import specifier is a URL: each relative segment is percent-encoded so `#`, `?` and `%` stay in the path.
  let specifier = relative(destination, adapter);
  if (isAbsolute(specifier)) specifier = pathToFileURL(adapter).href;
  else {
    specifier = specifier.split(/[\\/]/).map(encodeURIComponent).join('/');
    if (!specifier.startsWith('.')) specifier = `./${specifier}`;
  }
  const manifest = {
    name: DSH_PACKAGE, version: '0.1.0', private: true, type: 'module',
    description: 'LCU: computer use through the installed OpenAI computer-use runtime.',
    exports: { '.': './index.js', './locale/*.json': './locale/*.json', './icon': './icon.svg' },
    files: ['index.js', 'cordis.patch.yml', 'locale/*.json', 'icon.svg'],
    engines: { dsh: DSH_ENGINES },
    peerDependencies: { '@deepseek-ai/dsh-mcp-client': '*' },
    dsh: { bundle: { patch: './cordis.patch.yml' } },
  };
  // JSON is YAML: the row's config is the runtime command, as the other generated packages carry it.
  const patch = `- insert:\n    - id: ${DSH_PACKAGE}\n      name: ${DSH_PACKAGE}\n      config: ${JSON.stringify({ command })}\n`;
  const wrapper = '// Generated by `lcu setup --agent dsh`; rerun setup instead of editing.\n' +
    "import { createMcpToolDefinition } from '@deepseek-ai/dsh-mcp-client';\n" +
    `import * as lcu from ${JSON.stringify(specifier)};\n\n` +
    'export const name = lcu.name;\nexport const inject = lcu.inject;\n' +
    // Async: Cordis 4 constructs a plugin function that has a prototype instead of awaiting it, so the first agent
    // request could start before LCU's tools are registered.
    'export async function apply(ctx, config) {\n  return lcu.apply(ctx, config, { createMcpToolDefinition });\n}\n';
  const locale = { meta: { title: 'LCU Computer Use',
    description: 'Controls desktop apps through the computer-use runtime of the installed ChatGPT app.' } };
  withPackage(destination, 'dsh', { 'package.json': json(manifest), 'cordis.patch.yml': patch, 'index.js': wrapper,
    'locale/en.json': json(locale), 'icon.svg': DSH_ICON },
  (pkg) => checked('installer', executable, ['plugin', '--profile', profile, 'add', pkg], { cwd: home, env, timeout: 300_000 }));
  return { profile, destination };
}


// Junie --------------------------------------------------------------------------------------------------

export const JUNIE_SERVER = 'lcu';
/** The Junie hook events the relay's `--hook` mode handles, with Junie's timeout for each, in seconds. */
export const JUNIE_HOOKS = { SessionStart: 10, UserPromptSubmit: 30, Stop: 60, StopFailure: 60, SessionEnd: 10 };
// Junie's default MCP request timeout, 60 s, also bounds each tool call; the relay bounds its own calls.
const JUNIE_MCP_TIMEOUT_MS = 3_600_000;
const JUNIE_HOOK = /(^|[\\/])adapters[\\/]junie\.mjs'? --hook$/;

const isObject = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
/** Whether a Junie hook entry is one LCU wrote, from any release. */
export const isJunieHook = (hook) => isObject(hook) && hook.type === 'command' && typeof hook.command === 'string' &&
  JUNIE_HOOK.test(hook.command);

/**
 * Register the Junie relay as the `lcu` server of `~/.junie/mcp/mcp.json` and its hooks in `~/.junie/config.json`,
 * replacing only LCU's own entries. Junie has no installer for either; it reads both files as written here.
 * Project scope is rejected: Junie ignores a project's config.json hooks unless it is started with that file.
 */
export function configureJunie(home, command, node, release, { scope }) {
  if (process.platform === 'win32') throw new Error('Junie is not supported on Windows yet.');
  if (scope !== 'user') {
    throw new Error('Junie runs hooks only from ~/.junie/config.json, which LCU needs to end its turns. Use --scope user; project scope is not supported.');
  }
  const adapter = join(release, 'adapters/junie.mjs');
  if (!existsSync(adapter)) throw new Error(`LCU Junie relay missing: ${adapter}`);
  const mcpPath = join(home, '.junie/mcp/mcp.json');
  const configPath = join(home, '.junie/config.json');

  const mcpBefore = readFile(mcpPath);
  const mcp = parseJson(mcpBefore);
  if (!isObject(mcp)) throw new Error(`Junie MCP configuration must be an object: ${mcpPath}`);
  const servers = member(mcp, 'mcpServers', {}, `Junie mcpServers must be an object: ${mcpPath}`);
  servers[JUNIE_SERVER] = { command: String(node), args: [adapter, ...command], timeout: JUNIE_MCP_TIMEOUT_MS };

  const configBefore = readFile(configPath);
  const config = parseJson(configBefore);
  if (!isObject(config)) throw new Error(`Junie configuration must be an object: ${configPath}`);
  const hooks = member(config, 'hooks', {}, `Junie hooks must be an object: ${configPath}`);
  const hookCommand = `${shellQuote(String(node))} ${shellQuote(adapter)} --hook`;
  for (const [event, timeout] of Object.entries(JUNIE_HOOKS)) {
    const groups = member(hooks, event, [], `Junie ${event} hooks must be an array of objects`);
    if (!groups.every((group) => isObject(group) && Array.isArray(group.hooks))) {
      throw new Error(`Junie ${event} hooks must be an array of objects with a hooks array: ${configPath}`);
    }
    // An earlier release's entry points at its own adapter path; only LCU's entries are replaced.
    const kept = groups.map((group) => ({ ...group, hooks: group.hooks.filter((hook) => !isJunieHook(hook)) }))
      .filter((group, index) => group.hooks.length || !groups[index].hooks.length);
    kept.push({ hooks: [{ type: 'command', command: hookCommand, timeout }] });
    hooks[event] = kept;
  }
  const changes = [];
  if (mcpBefore === null || !isDeepStrictEqual(parseJson(mcpBefore), mcp)) changes.push(change(mcpPath, mcpBefore, json(mcp)));
  if (configBefore === null || !isDeepStrictEqual(parseJson(configBefore), config)) {
    changes.push(change(configPath, configBefore, json(config)));
  }
  applyChanges(changes);
  return { mcpPath, configPath };
}


// Antigravity --------------------------------------------------------------------------------------------

export const ANTIGRAVITY_SERVER = 'lcu';
export const ANTIGRAVITY_HOOK_NAME = 'lcu';
/** The Antigravity hook events the relay's `--hook` mode handles, with Antigravity's timeout for each, in seconds. */
export const ANTIGRAVITY_HOOKS = { SessionStart: 10, PreInvocation: 30, Stop: 60 };
// Antigravity's default per-tool-call MCP timeout is 180 s; the relay bounds its own calls.
const ANTIGRAVITY_MCP_TIMEOUT_SECONDS = 3_600;
const ANTIGRAVITY_HOOK = /(^|[\\/])adapters[\\/]antigravity\.mjs'? --hook$/;

/** Whether an Antigravity hook handler is one LCU wrote, from any release. */
export const isAntigravityHook = (hook) => isObject(hook) && (hook.type === undefined || hook.type === 'command') &&
  typeof hook.command === 'string' && ANTIGRAVITY_HOOK.test(hook.command);

/**
 * Register the Antigravity relay as the `lcu` server of `mcp_config.json` and its lifecycle hooks under the `lcu`
 * key of `hooks.json` (user scope: `~/.gemini/config/`; project scope: `<project>/.agents/`), replacing only LCU's
 * own entries. Both files are shared by Antigravity CLI, App and IDE.
 */
export function configureAntigravity(home, command, node, release, { scope = 'user', project = null } = {}) {
  if (process.platform === 'win32') throw new Error('Antigravity is not supported on Windows yet.');
  if (scope === 'project' && !project) throw new Error('Antigravity project scope requires a project directory.');
  const adapter = join(release, 'adapters/antigravity.mjs');
  if (!existsSync(adapter)) throw new Error(`LCU Antigravity relay missing: ${adapter}`);
  const root = scope === 'project' ? join(project, '.agents') : join(home, '.gemini/config');
  const mcpPath = join(root, 'mcp_config.json');
  const hooksPath = join(root, 'hooks.json');

  const mcpBefore = readFile(mcpPath);
  const mcp = parseJson(mcpBefore);
  if (!isObject(mcp)) throw new Error(`Antigravity MCP configuration must be an object: ${mcpPath}`);
  const servers = member(mcp, 'mcpServers', {}, `Antigravity mcpServers must be an object: ${mcpPath}`);
  servers[ANTIGRAVITY_SERVER] = {
    command: String(node),
    args: [adapter, ...command],
    timeoutSeconds: ANTIGRAVITY_MCP_TIMEOUT_SECONDS,
    tools: Object.fromEntries(MODEL_TOOLS.map((tool) => [tool, { eager: true }])),
  };

  const hooksBefore = readFile(hooksPath);
  const hooks = parseJson(hooksBefore);
  if (!isObject(hooks)) throw new Error(`Antigravity hooks configuration must be an object: ${hooksPath}`);
  const entry = member(hooks, ANTIGRAVITY_HOOK_NAME, {}, `Antigravity ${ANTIGRAVITY_HOOK_NAME} hook entry must be an object: ${hooksPath}`);
  const hookCommand = `${shellQuote(String(node))} ${shellQuote(adapter)} --hook`;
  for (const [event, timeout] of Object.entries(ANTIGRAVITY_HOOKS)) {
    const handlers = member(entry, event, [], `Antigravity ${event} hooks must be an array of objects: ${hooksPath}`);
    if (!handlers.every(isObject)) {
      throw new Error(`Antigravity ${event} hooks must be an array of objects: ${hooksPath}`);
    }
    const kept = handlers.filter((handler) => !isAntigravityHook(handler));
    kept.push({ type: 'command', command: hookCommand, timeout });
    entry[event] = kept;
  }

  const changes = [];
  if (mcpBefore === null || !isDeepStrictEqual(parseJson(mcpBefore), mcp)) changes.push(change(mcpPath, mcpBefore, json(mcp)));
  if (hooksBefore === null || !isDeepStrictEqual(parseJson(hooksBefore), hooks)) changes.push(change(hooksPath, hooksBefore, json(hooks)));
  applyChanges(changes);
  return { mcpPath, hooksPath };
}
