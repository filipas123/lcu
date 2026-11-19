# Installation

Install LCU from the [latest release](https://github.com/amontlabs/lcu/releases/latest), then register it in your harness. For source changes, see [Building from source](DEVELOPMENT.md#building-from-source).

## The `lcu` command

The installer does not add `lcu` to your `PATH`. Invoke it by its installed path:

| Platform | Installed command |
| --- | --- |
| macOS | `~/.local/share/lcu/current/bin/lcu` |
| Linux | `/opt/lcu/current/bin/lcu` (or `<prefix>/current/bin/lcu`) |
| Windows | `%LOCALAPPDATA%\LCU\lcu.cmd` |

Where a command below is written as `lcu ...`, run it through the installed path for your platform. This is the `mcp` server harnesses launch; running it directly in an interactive terminal only prints a hint that it is a stdio MCP server.

## If you are the installing agent

1. Check the OS, architecture, desktop account, and current harness. Adapters are `pi`, `codex`, `claude-code`, `omp` (Oh My Pi), `hermes` (Hermes Agent), `dsh` (DeepSeek Harness), `junie` (JetBrains Junie CLI), and `antigravity` (Google Antigravity); select the user's harness explicitly. OMP, Hermes, DeepSeek Harness, Junie and Antigravity are experimental; inspect their [verification limits](ADAPTERS.md) before claiming desktop behavior. If the harness has no adapter, report that gap and consult [the adapter contract](https://github.com/amontlabs/lcu/blob/main/docs/ADAPTERS.md). Do not substitute another harness.
2. Check the prerequisites below. The official desktop app and the selected harness must already be installed; LCU needs nothing else (no Python). If anything is missing, report the prerequisite and its installation link; LCU does not install or authenticate them.
3. Download the matching archive and SHA-256 sidecar from the latest release, verify the checksum, and extract it. Follow the installation section for that platform from inside the extracted directory.
4. For unattended setup, add `--yes` to the command that selects the harness. Preserve the user's sandbox and approval settings. Enable Chrome or computer-audio recording only if the user requested it. `--approval auto` is for unattended machines (VMs, CI); do not suggest it for a normal desktop.
5. Report the installed path and tell the user to restart their harness and run the platform's `doctor` command from their desktop session. Installation and registration do not prove a desktop action worked; the user completes the first approved screenshot check.

## Prerequisites

- **An existing desktop:** Apple Silicon macOS, or Ubuntu 24.04-compatible glibc Linux on ARM64 or x86-64 with an X11 desktop and D-Bus session owned by the target account. Native Wayland and musl are unsupported; Windows is deferred.
- **The official ChatGPT desktop app:** [install it first](https://chatgpt.com/download/). Default paths are `/Applications/ChatGPT.app` on macOS and `/usr/lib/chatgpt` on Linux. Use `--existing-app /absolute/path` for another location. LCU never downloads or installs the app and does not require ChatGPT sign-in.
- **Nothing else to install:** LCU runs on the Node that ships inside the ChatGPT app (`cua_node`), plus the host's normal sandbox facilities. No Python is needed on any platform. `scripts/install.sh` finds the app (the default path or `--existing-app`), checks its Node before running it (Linux: it and every directory above it owned by root or the installing account and writable by no other account, apart from sticky directories such as `/tmp`; macOS: signed by OpenAI), and runs the installer on it. A root install for another account (`--user`) refuses an app that account owns, because root would run that account's Node: run the installer as that account instead (provision system packages first and pass `--skip-system`), or make the app owned by root. The installer records that Node's path in the release (`node-path`), and the installed `lcu`, `lcu-session` and `lcu-codex-sandbox` launchers run it, so they work with any `PATH`. If the app is moved or removed, the launchers say so; reinstall LCU after reinstalling the app elsewhere.
- **Your installed, authenticated harness:** Pi, Codex CLI, Claude Code, Oh My Pi, Hermes Agent, DeepSeek Harness, Junie, or Antigravity. Codex CLI must support `mcp_tool` lifecycle hooks; update the public standalone CLI if setup reports a parser error. See [harness prerequisites](ADAPTERS.md).

LCU does not install a desktop or create a VM. Native computer use is the default; Chrome and computer-audio recording are opt-in.

## Download the release

Choose the archive for the machine where LCU will run:

| System | Archive suffix |
| --- | --- |
| Apple Silicon macOS | `darwin-arm64.tar.gz` |
| Linux ARM64 | `linux-arm64.tar.gz` |
| Linux x86-64 | `linux-x64.tar.gz` |

Download that archive and its matching `.sha256` file from the [latest release](https://github.com/amontlabs/lcu/releases/latest). Or run this from a terminal on the target machine; it selects the archive, checks its SHA-256, and opens the extracted directory:

~~~sh
case "$(uname -s)-$(uname -m)" in
  Darwin-arm64) LCU_TARGET=darwin-arm64 ;;
  Linux-aarch64|Linux-arm64) LCU_TARGET=linux-arm64 ;;
  Linux-x86_64) LCU_TARGET=linux-x64 ;;
  *) echo "Unsupported LCU platform" >&2; exit 1 ;;
esac
LCU_TAG=$(curl -fsSI -o /dev/null -w '%{redirect_url}' https://github.com/amontlabs/lcu/releases/latest)
LCU_TAG=${LCU_TAG##*/}
LCU_ARCHIVE="lcu-${LCU_TAG#v}-${LCU_TARGET}.tar.gz"
LCU_URL="https://github.com/amontlabs/lcu/releases/download/$LCU_TAG"
mkdir -p lcu-release &&
cd lcu-release &&
curl -fLO "$LCU_URL/$LCU_ARCHIVE" &&
curl -fLO "$LCU_URL/$LCU_ARCHIVE.sha256" &&
if [ "$LCU_TARGET" = darwin-arm64 ]; then
  shasum -a 256 -c "$LCU_ARCHIVE.sha256"
else
  sha256sum -c "$LCU_ARCHIVE.sha256"
fi &&
  tar -xzf "$LCU_ARCHIVE" &&
  cd "${LCU_ARCHIVE%.tar.gz}"
~~~

Continue below only after the checksum reports **OK**. Use the extracted archive's installer; GitHub's automatic source-code downloads are not installable bundles.

## macOS

From the extracted release directory, run as the intended desktop account. Replace `codex` with `pi` or `claude-code` for your harness:

~~~sh
./scripts/install.sh --agent codex
~~~

Interactive installation registers the harness and guides you through desktop permissions. If an agent is running installation unattended, use `./scripts/install.sh --agent codex --yes`, then run this yourself from a desktop terminal:

~~~sh
~/.local/share/lcu/current/bin/lcu doctor
~~~

Restart your harness after setup. Ask it to use LCU to take a screenshot of a harmless window, such as a blank TextEdit document, and approve the request. This is the first check that macOS permissions allow an action.

LCU installs under `~/.local/share/lcu` and reuses the signed app and native helper in place. It validates the official identity/signature, Apple Silicon architecture, runtime manifest, required files, and recognized original host layout, then reports the observed app/runtime versions. The full signature check (`codesign --verify --deep`) runs at install, update, `lcu setup`, `lcu doctor` and `lcu status`, and on the first launch after the app changes; later launches only confirm the signer, which keeps them fast. LCU notices an app update by its version, build and signature seal; edits inside the app that change none of these are not checked at launch. It does not select apps through a repository version or component-hash allowlist. Compatibility still depends on the installed app retaining the host APIs and layout LCU uses. First-use permissions and an independent TextEdit save passed in a fresh guest ([verification](verification/macos-fresh-guest-2026-09-24.md)).

**Home folder length.** The signed helper binds its socket under your real home folder, at `~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/IPC/computeruse.sock`, and refuses a path longer than 103 bytes. That is 13 ASCII characters (bytes) or fewer after `/Users/`. With a longer home folder path only `computeruse.sock.lock` appears and every call fails with `Sky Computer Use native pipe startup failed`; the ChatGPT app has the same limit. LCU cannot change the signed helper, so `lcu doctor` exits 2 with the path and its length, and `lcu setup` prints the same warning at its end without failing. Use an account with a shorter home folder path. If `SKY_CUA_SERVICE_NATIVE_PIPE_PATH` is set in LCU's environment, LCU checks that path instead; it cannot see or set the environment of the helper, which macOS launches.

To add another harness later, run the installed command:

~~~sh
~/.local/share/lcu/current/bin/lcu setup --agent pi
~~~

Use the public standalone Codex CLI on the desktop account's normal `PATH`. If setup reports unsupported `mcp_tool` hooks, update it with `npm install -g @openai/codex@latest`, check `codex --version`, and rerun `~/.local/share/lcu/current/bin/lcu setup --agent codex`. See [Codex CLI setup](ADAPTERS.md#codex-cli) and [the verification record](verification/codex-standalone-cli-2026-09-27.md).

Pi setup uses Pi's package installer to register the bundled native extension. See [Pi approval verification](verification/pi-approval-2026-09-26.md) and [result forwarding](ADAPTERS.md#same-case-result-forwarding).

For Oh My Pi or Hermes Agent, install the harness first, then register its native integration:

```sh
~/.local/share/lcu/current/bin/lcu setup --agent omp
~/.local/share/lcu/current/bin/lcu setup --agent hermes
```

OMP setup calls `omp plugin link` on a generated local package containing the shared Pi extension. Native links use the selected OMP user profile; project scope is rejected because OMP ignores it for local links. Hermes setup writes an LCU-owned plugin to `${HERMES_HOME:-~/.hermes}/plugins/lcu-cua` and calls `hermes plugins enable lcu-cua`. Set an absolute `HERMES_HOME` to select another Hermes profile. Neither native integration supports project scope; setup rejects it. Restart the selected harness after registration. See [OMP](ADAPTERS.md#oh-my-pi) and [Hermes](ADAPTERS.md#hermes-agent) for behavior and evidence.

For DeepSeek Harness (experimental), open DeepSeek Harness Desktop once so it creates its profile, quit it, then run:

~~~sh
~/.local/share/lcu/current/bin/lcu setup --agent dsh
~~~

Setup generates an LCU bundle under `~/.local/share/lcu/dsh/` and installs it with DSH's own `dsh plugin --profile desktop add`, using `dsh` on `PATH` or the CLI inside the installed app. It refuses while DeepSeek Harness Desktop is running, because DSH changes the app's profile only while the app is closed. `--dsh-profile NAME` installs into another DSH profile (for example `web`), and an absolute `DSH_HOME` selects another DSH home. Project scope is rejected. Open DeepSeek Harness again after setup. Things to know:

- App approvals appear as a question card in DeepSeek Harness Desktop or its web UI. `dsh --profile headless` and ACP clients cannot show it, so approval requests there are cancelled (fail closed).
- Screenshots reach the model only when the selected model takes images. OpenRouter's DeepSeek models and `deepseek-v4-pro` are text-only: a screenshot becomes an `[image unavailable]` placeholder, and the model works from the text accessibility state. DSH's direct `deepseek-flash` route takes images.
- `DSH_TOOLS_MODE=ptc` hides native tools from the model, including LCU's `js`.

See [DeepSeek Harness](ADAPTERS.md#deepseek-harness) for behavior and evidence.

For Junie (experimental, macOS and Linux), run:

~~~sh
~/.local/share/lcu/current/bin/lcu setup --agent junie
~~~

Setup adds the `lcu` MCP server to `~/.junie/mcp/mcp.json` and LCU's turn hooks to `~/.junie/config.json`, keeping everything else in both files. Project scope is rejected because Junie reads hooks only from that user file. Restart Junie after setup. Things to know:

- **App approvals are permanent until revoked.** Junie cannot show LCU's "Allow Computer Use to use ...?" prompt (until JetBrains ships elicitation support in Junie's MCP client). For an app that is not allowed yet, the call fails and Junie is told to run `lcu apps allow <App>` itself; macOS then asks you for Touch ID or your password, and approving allows that app, for every agent, until you run `lcu apps revoke <App>`. Junie is asked to offer that revoke when its task is done. List allowed apps with `lcu apps`. You can also allow apps beforehand yourself (for example `lcu apps allow Notes`). Setup prints this warning and, when interactive without `--yes`, asks `Continue? [y/N]` before registering Junie.
- Junie picks the MCP tools it offers for each prompt, so mention the app or computer use in your prompt.
- Junie asks before each MCP call; `--approval auto` adds allowlist rules for exactly LCU's two tools.

See [Junie](ADAPTERS.md#junie) for behavior and evidence.

For Antigravity (experimental, macOS and Linux; alias `agy`), run:

~~~sh
~/.local/share/lcu/current/bin/lcu setup --agent antigravity
~~~

Setup adds the `lcu` MCP server to `~/.gemini/config/mcp_config.json` (project scope: `<project>/.agents/mcp_config.json`) with eager loading for `js` and `js_reset`, and LCU's lifecycle hooks under the `lcu` key of `~/.gemini/config/hooks.json` (project scope: `<project>/.agents/hooks.json`), keeping everything else in both files. Both files are shared by Antigravity CLI (`agy`), Antigravity App and Antigravity IDE. Restart Antigravity after setup. Things to know:

- **App approvals on Antigravity CLI are permanent until revoked.** Antigravity CLI advertises MCP elicitation but currently cancels `elicitation/create` requests immediately. When Antigravity does not show LCU's approval prompt for an app that is not allowed yet, the call fails and the model is told to run `lcu apps allow <App>` itself; macOS then asks you for Touch ID or your password, and approving allows that app, for every agent, until you run `lcu apps revoke <App>`. The model is asked to offer that revoke when its task is done. List allowed apps with `lcu apps`. Setup prints this warning and, when interactive without `--yes`, asks `Continue? [y/N]` before registering Antigravity.
- Antigravity asks before unapproved MCP tool calls under `request-review`/`proceed-in-sandbox`; `--approval auto` (at user scope) adds exact `mcp(lcu/js)` and `mcp(lcu/js_reset)` rules to `~/.gemini/antigravity-cli/settings.json`.

See [Antigravity](ADAPTERS.md#antigravity) for behavior and evidence.

Interactive `lcu setup` runs a guided desktop-readiness check after agent registration. On macOS, the guide reads the selected app and signed helper names and paths and shows the relevant **Accessibility** and **Screen & System Audio Recording** (or **Screen Recording**) panes, opening a pane only after you choose it. The original runtime remains responsible for its normal approval and macOS prompts. See [Desktop and browser](#desktop-and-browser) for what `doctor` verifies per platform, its exit codes, and how first-call readiness is confirmed.

Chrome mode also requires the official browser extension and site approval. The original runtime asks before it first uses each site and remembers the answer for that agent session; see [Chrome site decisions](#chrome-site-decisions) for where and how to undo one. Only the Pi and Oh My Pi extension reads `LCU_APPROVED_ORIGINS`, a JSON array of exact origins the user already authorized, such as `["http://localhost:3000"]`. It accepts a site prompt the runtime actually sends for those origins, never widens access beyond them and cannot lift a saved denial; other harnesses ignore it. The original provider chooses the platform instructions automatically.

## Linux

From the extracted release directory, run this in a terminal owned by the existing desktop account. It uses `/usr/lib/chatgpt`, installs Ubuntu system libraries, and installs the LCU runtime:

~~~sh
sudo ./scripts/install.sh --user "$(id -un)" --runtime-only
~~~

For an app installed elsewhere, add `--existing-app /absolute/path`. LCU uses that installation in place; it does not copy the app. Because the desktop account runs the app's executables, LCU validates the whole tree it executes from: the runtime executables and modules, the directories above them, the complete CUA runtime tree, and the complete Chrome, browser and computer-use plugin trees (including the scripts `lcu browser install` and `lcu browser status` run). Every file and directory must be owned by root or the installing/desktop account and not writable by anyone else. Group write counts only when every account in that group is trusted, and POSIX ACL entries (read from the `system.posix_acl_access` attribute on Linux) that give another user or group write access are refused; group membership is read from the local account database and ACLs from that attribute only, so members supplied by a directory service and ACLs on filesystems that do not expose it are not seen. A link may only point inside the app; its target and the target's contents are validated too, and a link that leaves the app is refused. A read-only mount is checked the same way, because another account could write through a writable view of the same source; a root-owned package install or a root-owned read-only mount (such as Silo's `/opt/silo/chatgpt/<version>-<arch>`) passes. This is a structural check at validation time, not authentication of the app's content.

Then, from a terminal inside the active X11 desktop session, register your harness as the desktop account, without `sudo`. Replace `codex` with `pi` or `claude-code`:

~~~sh
/opt/lcu/current/bin/lcu setup --agent codex --session direct
~~~

Interactive setup includes the desktop-readiness check. If an agent in that desktop session is running setup unattended, add `--yes`, then run this yourself from your desktop terminal:

~~~sh
/opt/lcu/current/bin/lcu doctor
~~~

Restart your harness from the desktop session and ask it to use LCU to take a screenshot of a harmless window. Approve the request and check the returned image. For an agent outside the desktop session, the default discovery mode can attach to an existing XFCE session; see [Desktop and browser](#desktop-and-browser).

If Codex setup reports unsupported `mcp_tool` hooks, update the public standalone CLI for that account with `npm install -g @openai/codex@latest`, check `codex --version`, and rerun setup. See [Codex CLI setup](ADAPTERS.md#codex-cli).

The default managed prefix is `/opt/lcu`. Use `--prefix /absolute/dedicated/path` for another location. A user-owned prefix needs system libraries preinstalled and `--skip-system`; `--offline` also requires `--skip-system`. Without `--skip-system`, apt installs LCU's Ubuntu system dependencies. This does not install ChatGPT. Each LCU release links to the installed app and runs it in place; the prefix holds only LCU itself. `lcu --version`, `lcu status` and `lcu doctor` report the version it observes.

### Updating the in-place app

Stop every agent that uses LCU before upgrading the ChatGPT package (for example with apt), then restart them afterward. LCU validates the app once when it launches the runtime and then runs from the app's live paths. An upgrade replaces those files while a session is running, so a live session can end up mixing the old and new runtime generations (executables, modules and helper processes from different versions). After the upgrade, `lcu status` and `lcu doctor` print a warning when the app on disk differs from the version and runtime recorded at install; rerun the installer to update that record, and refresh the Chrome host with `lcu browser install` if you use it (`lcu browser status` reports a stale copy).

System library installation is a separate apt operation and cannot be rolled back as a single transaction with the LCU selection. Failed app validation or release selection leaves the previous current symlink in place. Existing running processes may still hold old LCU generations; do not remove them until they have exited.

The original package's AppArmor profile names /usr/lib/chatgpt/ChatGPT, its Electron UI. LCU directly launches the selected app's Node and CUA REPL, so that profile does not apply to LCU's native path and is not an LCU install requirement. The [ARM64 and x86-64 Ubuntu AppArmor tests](verification/installed-app-2026-09-23.md) passed native computer use and Chrome actions with AppArmor active; they recorded process labels and nonblocking `bwrap` denials. The x86-64 guest ran under KVM on physical AMD hardware. Keep the browser sandbox enabled; do not alter the system AppArmor policy to make a test pass.

## Account and agent registration

Use `--agent pi`, `codex`, `claude-code`, `omp`, `hermes`, `dsh`, `junie`, or `antigravity` to select agents. Repeat `--agent` for several; `--agent all` selects all eight and fails for each harness whose prerequisite executable is missing (add [`--allow-missing`](#harnesses-installed-later) to defer them instead). OMP, Hermes, DeepSeek Harness and Junie restrict this combination to user scope. `--agent auto` selects detected agents (their executable is on `PATH` or their usual config path exists). With no `--agent`, an interactive setup shows a chooser and marks detected agents, but waits for you to choose. Noninteractive setup requires an explicit selection. Use `--runtime-only` to install LCU without registering an agent. Aliases are `claude`, `oh-my-pi`, `hermes-agent`, `deepseek-harness`, and `agy`. Install and authenticate each selected harness yourself; LCU does neither. Setup runs the native harness registration tools with the release's private `agent-tools` Node runtime: on Linux this is a pinned Node 24.21 downloaded from nodejs.org into `agent-tools` when the archive is built; on macOS the build links the installed app's CUA Node. Setup then creates local byte-identical original instruction references. Pi receives an extension, OMP, Hermes and DeepSeek Harness receive native plugins, and Codex CLI and Claude Code receive MCP registration. Setup preserves unrelated configuration values, although upstream tools can reformat files. `--cross-turn on|off` (with `--unattended` for disposable sandbox machines) sets [cross-turn Computer Use](#cross-turn-computer-use); the Linux and macOS installer forwards both, and rejects them with `--runtime-only` like the other setup options. Root setup drops to the selected account before writing account files. Other harnesses can use the shared client and portable export.

~~~sh
/opt/lcu/current/bin/lcu setup --agent codex --agent claude-code
./scripts/install.sh --list-agents
~~~

Unattended Linux registration skips desktop readiness. Run it from a terminal inside the active X11 desktop session and keep `--session direct`, matching the main Linux flow; without it setup defaults to `--session discover`, which requires an existing XFCE session (see [Desktop and browser](#desktop-and-browser)). Then run `doctor` from that session:

~~~sh
/opt/lcu/current/bin/lcu setup --agent codex --yes --session direct
~~~

Later, from that account's active desktop session:

~~~sh
/opt/lcu/current/bin/lcu doctor
~~~

**Which home setup writes.** Without `--user`, setup (and the installer's setup step) configures the calling account in the home its agents use: `$HOME`, when it is an absolute, existing directory owned by that account, with no symbolic link on its path. Otherwise, such as an unset, relative, linked or another account's `HOME`, it uses the account's home from the user database. So `HOME=/private/tmp/scratch lcu setup --agent codex` writes `/private/tmp/scratch/.codex/config.toml`, the setup lock and `setup.json` under `/private/tmp/scratch/.local/state/lcu`, and nothing in the real home. On macOS, the default `--prefix` is `~/.local/share/lcu` of that same home. `lcu status` and `lcu update` (including its refresh of the Claude Code `lcu-approve` mod) read the same home. `--user ACCOUNT` always uses that account's home from the user database, and root must pass it. On Windows the home is `USERPROFILE`. `lcu apps` and the Computer Use client itself follow `HOME` as the original runtime does. On macOS that has a consequence: the original client looks for the ChatGPT helper's socket under `HOME`, so an agent started with a `HOME` other than the account's home folder fails with `Sky Computer Use native pipe startup failed` unless `SKY_CUA_SERVICE_NATIVE_PIPE_PATH` names the helper's socket, and it reads its approved-app list (`lcu apps`) from that `HOME`. Setup warns when it configures such a home.

For project scope, use --scope project --project /absolute/project. Use --runtime-only to install without registration, then run /opt/lcu/current/bin/lcu setup --agent codex --session direct from inside the desktop session as the desktop account. --export /absolute/new/directory creates a portable LCU bootstrap and host contract, without OpenAI files or producer account paths. Its MCP command resolves /opt/lcu/current on the destination; set LCU_PREFIX for another installed prefix and LCU_SESSION_MODE=direct for an agent already inside the desktop session. On the destination machine, install LCU and a compatible official app and run setup --export again to generate original instruction references locally. Import that new export and the local full skill.

The original host contract advertises model-facing js and js_reset, keeps turn_ended for lifecycle and restricts module-directory injection. Generic MCP consumers must honor the exported visibility, output and lifecycle contract. MCP registration alone cannot enforce all agent-host behavior.

### Native approvals in the Claude app

For the Claude desktop app, register LCU through Claude Code (`lcu setup --agent claude-code`), not through Claude Desktop's Connectors (`claude_desktop_config.json`). A server added there currently breaks identity and approvals ([amontlabs/lcu#3](https://github.com/amontlabs/lcu/issues/3)); remove any `lcu` entry from the Connectors list and use the Code tab.

Claude Code's terminal asks the runtime's per-app approval ("Allow Computer Use to use ...?") itself. The Claude app's Code tab and the VS Code extension cannot render that form and decline it, so on macOS and Windows controlling an app fails there with "Computer Use was not approved". `lcu setup --agent claude-code` therefore also installs the `lcu-approve` mod: a plugin folder at `~/.claude/skills/lcu-approve` (user scope) or `<project>/.claude/skills/lcu-approve` (`--scope project`). Claude Code loads it without a hot-reload question and shows the approval as the engine's own question card in the Claude app (so the app flags the session as needing input), and as a native pane in a terminal (a question dialog on one narrower than 144 columns), with Allow this conversation, Always allow (when the runtime offers it) and Deny. Rerunning setup updates the folder. It needs a Claude Code with mods: 2.1.287 or later, or the 2.1.286 build inside the Claude app. An older terminal `claude` keeps its own form, which works. Details, limits and the safeguards that keep the model from answering are in [Claude native-app approvals](ADAPTERS.md#native-app-approvals-in-claude-code-and-the-claude-app). If your organization restricts plugins or mods, the mod does not load and the host's behavior is unchanged.

### Claude Code plugin

On Apple Silicon macOS, Claude Code's plugin manager can do the installation and registration:

~~~sh
claude plugin marketplace add amontlabs/lcu
claude plugin install lcu@lcu
~~~

The plugin is one `SessionStart` hook, `adapters/claude-plugin/scripts/ensure-lcu.sh`. When a session starts and LCU is not installed, the hook downloads the latest release archive and its `.sha256` file, installs the archive only when its SHA-256 matches, and then runs `lcu setup --agent claude-code --yes`. When LCU is already installed it only runs that setup. It then asks you to restart Claude Code; run `~/.local/share/lcu/current/bin/lcu doctor` from a desktop terminal afterwards, as after any unattended setup. Once an installation is registered, later sessions do nothing unless the `lcu` server is gone from `~/.claude.json`, which they register again.

The plugin has no MCP entry of its own. Claude Code names a plugin's server `plugin:lcu:lcu` and its tools `mcp__plugin_lcu_lcu__js`, while LCU's lifecycle hooks, deny rules, approval entries and `lcu-approve` mod refer to the `lcu` server. Running `lcu setup` keeps one registration: the same MCP command, hooks, rules and mod as the manual path, with saved Chrome, audio and approval choices kept.

The [prerequisites](#prerequisites) are unchanged. The hook checks for the ChatGPT app before it downloads anything and says when it is missing; LCU still never installs the app. Set `LCU_PREFIX` for another prefix or `LCU_APP` for an app outside `/Applications`, in the environment Claude Code starts in. As with `lcu setup`, a redirected `CLAUDE_CONFIG_DIR` is not supported. On Linux and Intel Macs the hook says once that it does not apply and changes nothing; use the sections above. The installer and setup output of the last run is kept as `setup.log` in the plugin's data folder (`~/.claude/plugins/data/lcu-lcu/`).

`claude plugin uninstall lcu@lcu` removes only the plugin. LCU and its registration stay until you [uninstall](#uninstall) them, and updates still come from `lcu update`. The [verification record](verification/claude-plugin-2026-10-06.md) lists what was checked and what was not.

### Harnesses installed later

A harness that is not installed when setup runs is not registered, and one installed afterwards is never picked up. Two options cover this without any new configuration writer: each harness's own CLI (or the already pinned add-mcp for Codex and Claude Code) still writes its registry.

~~~sh
/opt/lcu/current/bin/lcu setup --agent all --allow-missing --session direct --yes --approval auto
/opt/lcu/current/bin/lcu setup --reconcile
~~~

`--allow-missing` works with `--agent all`, `--agent auto` and explicit `--agent` lists. Pi, Oh My Pi, Hermes and DeepSeek Harness need their own executable (on `PATH`, `~/.local/bin`, `~/.bun/bin`, `~/.npm-global/bin` or `~/.cargo/bin`; for DeepSeek Harness also the CLI inside an installed app); when it is absent LCU skips that harness, prints `<Harness>: not installed; will register when it appears`, and records it as pending. Codex, Claude Code, Junie and Antigravity register without their CLI, so they are registered immediately. The run lists what was registered and what is pending, and exits 0 when missing harnesses are the only problem; a real registration failure is still nonzero and its retry command keeps `--allow-missing`. Chrome, audio and approval are saved as usual, plus the pending set and the scope, project and session mode of that run, in `setup.json` (with a `--dsh-profile` other than `desktop` for a pending DeepSeek Harness). The saved state is written even when a registration step fails. Without `--allow-missing` a missing harness is a failure, as before.

`lcu setup --reconcile` registers each pending harness whose executable now exists, with the saved Chrome, audio and approval choices and the saved scope and session, then removes it from pending. It takes no other setup options (`--prefix` and `--user` are accepted) and never prompts. Nothing pending, or no pending executable present, is a silent no-op that reads one small file and takes no lock, so it is safe to run at every login or boot. When it does work it holds the same per-account setup lock as `lcu setup`, re-reads the state under the lock (a concurrent setup or reconcile that finished first leaves nothing to do), and prints what it registered. A harness that fails stays pending, the exit status is nonzero, and the next run retries; harnesses that are not pending are never touched. Typical triggers are a login script such as `/etc/profile.d/lcu-reconcile.sh`, a boot unit, or a call after installing a harness.

Approval and later setups: `lcu setup --approval auto|ask` run after `--allow-missing` updates the saved mode, even when it names only registered harnesses, and reconcile applies the mode saved at that moment to the harness it registers (`auto` adds LCU's own OMP entry; Pi, Hermes and DeepSeek Harness have nothing to add; `ask` adds nothing). Likewise `--chrome`, `--audio` and their `--no-` forms update the saved values. A setup that registers a pending harness explicitly removes it from pending. A later `--allow-missing` run replaces the saved scope and session only when it leaves something pending. `lcu status --json` reports `pending` (and `setup.pending`) for tools that manage LCU. See the [verification note](verification/pending-registration-2026-10-03.md) for what was and was not exercised.

## Desktop and browser

On Linux, the default `--session discover` mode attaches to exactly one existing XFCE session owned by the account. Other X11 desktops use `--session direct` when the agent already has `DISPLAY`, `DBUS_SESSION_BUS_ADDRESS` and, when needed, `XAUTHORITY`. Run setup and the agent from a terminal in that desktop session. macOS uses direct mode automatically.

Interactive setup launches the guided `lcu doctor` flow automatically after registration. `--yes` is unattended setup: it skips desktop readiness and prints the exact `doctor` command to run later. `--check-desktop` runs a bounded noninteractive readiness check (it uses `--require-ready`); it never opens System Settings and exits nonzero when readiness is incomplete or unverifiable, while agent registration remains saved. To repeat the check, run the installed command from the desktop session:

~~~sh
/opt/lcu/current/bin/lcu doctor
~~~

Whatever `doctor` reports, readiness is only confirmed when the reconnected agent makes its first approved screenshot call against a harmless window, such as a blank TextEdit document, and you check the returned image.

On macOS, `doctor` safely checks original runtime metadata and names the selected app/helper entries from their bundle metadata. It does not inspect application content or determine whether Accessibility or screen-capture grants are enabled; its **Open** choices are explicit, and its recheck repeats only the metadata check. `doctor` first checks the helper's socket path length (see [Home folder length](#macos)) and exits 2 when it is too long. It now exits 0 when the original provider loads (permission grants are still reported as not verifiable by LCU) and exits 2 when the provider check fails. `--check-desktop` still exits nonzero on macOS because this check cannot verify the permission grants.

On Linux, `doctor` calls the original runtime's `list_windows` and `get_screenshot` methods. It reports only status and counts; LCU discards the returned image data locally. The original API may create its normal temporary capture files. A successful result verifies these two original runtime calls in the current desktop session, then asks you to verify an agent call.

### Diagnostic log

The adapters keep a local, metadata-only diagnostic log of tool calls and approvals, kept 7 days and at most 20 MB, to help explain a call that hangs. `lcu status` and `lcu doctor` print its directory; set `LCU_DIAGNOSTIC_LOG=0` to turn it off. See [Diagnostic log](ADAPTERS.md#diagnostic-log) for what is and is never recorded.

### Linux sandbox and input notes

**Sandbox: what LCU does by default.** On a machine where bubblewrap works, the original `node_repl` runs the model's JavaScript (its kernel) and the Sky desktop service (its trusted worker) under `codex sandbox`: a read-only filesystem, no network, and a seccomp filter that also refuses `connect(2)` to the X11 Unix socket. Sky could therefore not reach the desktop, and every `js` call failed with `Could not connect to X11 ... Operation not permitted` even though `lcu doctor` passed. macOS is not affected because its native helper is a signed process reached over an allowed pipe. From 0.8.2 to 0.9.2 `lcu` avoided the failure by sending Codex's `disabled` sandbox state, which left the model's JavaScript unsandboxed. From 0.9.3 `lcu` keeps the kernel in the sandbox and runs only the Sky worker outside it, through a small launcher (`bin/lcu-codex-sandbox`) that starts the worker unsandboxed only when it recognises it as the selected runtime's own and refuses to start anything it cannot classify.

The result on such a machine: the model's JavaScript cannot write files, use the network or reach X11 and D-Bus directly, and cannot start synchronous subprocesses; subprocesses it starts asynchronously are confined the same way. Computer use works because it goes through the Sky worker. The kernel can still call the computer-use API, so it can control any application; the original Linux runtime asks no per-app approval (only macOS and Windows do), and your harness's own approval of LCU's tools is the prompt, so keep it on if you want to review each call (and do not use the optional `--approval auto`). Pi and Hermes have no such prompt; see [approval boundary](ADAPTERS.md#approval-boundary). `lcu doctor` prints a `JavaScript sandbox:` line saying whether the kernel is confined on this machine. Where bubblewrap cannot start (many containers, or a host that restricts user namespaces), nothing can sandbox the kernel, and doctor says so: the model's JavaScript then has your account's access to files, network and processes.

If the launcher refuses something it does not recognise (a newer original runtime that changed how `node_repl` starts its processes), the `js` call fails rather than running unsandboxed. A refused kernel start shows the reason in the error; a refused worker start shows only `trusted Node process exited unexpectedly`, and the reason is on the MCP server's stderr in your harness's logs (Claude Code, Codex); Pi, Oh My Pi and Hermes keep that stderr off their terminal and record only an `upstream_stderr` event in the [diagnostic log](ADAPTERS.md#diagnostic-log). Run `lcu update` for a release that knows the runtime.

A host that sends its own `codex/sandbox-state-meta`, per call or in `NODE_REPL_REQUEST_META`, keeps it: a `disabled` profile gives an unsandboxed kernel, and a restricted one gives that sandbox with computer use still working. `LCU_NODE_REPL_SANDBOX=host` restores the original behavior, including the X11 failure where bubblewrap works. `LCU_NODE_REPL_SANDBOX=off` restores the 0.8.2 to 0.9.2 behavior: no sandbox for the kernel or the worker. See [adapters](ADAPTERS.md#linux-sandbox-state).

**Window-targeted input on GTK 4 and Qt.** The original engine delivers a window-targeted `pressKey`, coordinate `click`, `scroll`, `drag` and pointer move with `XSendEvent`. GTK 4 (XInput2 only) ignores all of those, and Qt ignores scroll; both return without error and change nothing. Since 0.8.3 `lcu` re-issues those calls for GTK 4 windows, and scroll for Qt windows, through the engine's own desktop-level calls after activating the window; every other app is untouched. A window is translated only when the X server confirms its local process through the X-Resource extension (without it, or for a remote or other-PID-namespace client, or when the X server is not in LCU's PID namespace (a TCP display, or a server LCU cannot identify through `/proc`, is not), the original behavior stays). `key_down` and `key_up` are not translated: a held key on a GTK 4 window is ignored as in the original engine; activate the window and use the desktop-level `key_down`/`key_up` instead. The consequence is visible: the target window is focused (raised by the window manager if it was not) and the real pointer moves. See [Linux window-targeted input](ADAPTERS.md#linux-window-targeted-input), the [adaptation record](STANDALONE-ADAPTATIONS.md) and the [measurements](verification/linux-input-translation-2026-10-02.md). Calls fail with an explicit error, and send nothing, when the target cannot be focused, when the point is outside the target window's current bounds, when another window (a notification, tooltip or popup) covers the point on the desktop, when another application holds an active pointer grab, or when pointer input targets a window that has a modal dialog (target the dialog). Each queued call to the original engine is bounded (30 s, longer for a long drag or hold, up to 5 minutes); if one hangs, LCU releases the buttons and keys it had pressed, stops the worker and engine, fails the call, and the next request starts fresh. `LCU_LINUX_INPUT_TRANSLATION=off` turns the translation off and restores the engine's behavior.

`typeText` depends on the engine version: ChatGPT 26.928.31416 inserts into a GTK 4 entry through AT-SPI (in some runs the first call to a freshly started app inserted nothing and later calls inserted), while 26.915.31945 returns success without inserting anything. Where it inserts nothing, activate the window (`sky.activate_window`) and use the desktop-level `sky.type_text`, which reaches GTK 4 in both versions (a GTK 4 text view may then log a caret-offset `NotSupported` message after the text was inserted). AT-SPI actions and `paste` do not use the window-targeted path. The [verification record](verification/linux-sandbox-and-gtk4-input-2026-10-02.md) lists the session requirements.

**Setting these variables for your harness.** `LCU_NODE_REPL_SANDBOX` and `LCU_LINUX_INPUT_TRANSLATION` must be in the environment of the `lcu` process, and some harnesses filter what an MCP server inherits. Codex does: `LCU_NODE_REPL_SANDBOX=host codex` does not reach LCU (observed with Codex CLI 0.159.1 by `tests/codex_mcp_env.py`, directly and behind the relay). Set them where each harness expects:

| Harness | Where |
| --- | --- |
| Codex CLI | `~/.codex/config.toml` (or the project `.codex/config.toml`): `[mcp_servers.lcu.env]` with `LCU_NODE_REPL_SANDBOX = "off"` or `"host"` and/or `LCU_LINUX_INPUT_TRANSLATION = "off"`. `lcu setup --agent codex` replaces the `[mcp_servers.lcu]` table, so add the env table again after rerunning setup. |
| Claude Code | The `env` object of the `lcu` entry in its MCP configuration (`claude mcp add --env NAME=value` for a new entry, or edit the entry, then restart the session). |
| Pi, Oh My Pi | Export the variable in the shell before starting the harness; the extension starts `lcu` with the harness process's environment. |
| Hermes | Export the variable in the environment of the Hermes process; the plugin's bridge inherits it. |
| DeepSeek Harness | Export the variable in the environment that starts `dsh` (the plugin starts `lcu` with DSH's environment, minus `DSH_*` and names containing `KEY`, `PASSWORD`, `SECRET` or `TOKEN`). The Desktop app started from the Dock gets the login environment. |
| Junie | The `env` object of `mcpServers.lcu` in `~/.junie/mcp/mcp.json`. `lcu setup --agent junie` replaces that entry, so add it again after rerunning setup. |
| Generic MCP client | The `env` the client gives the `lcu` stdio process. |

**An agent started from an app that Computer Use launched.** The original runtime passes its environment on to the Computer Use service and to the apps that service launches, so a terminal or agent app started that way carries the variables a parent `lcu` derived for its runtime. Since 0.11.9 `lcu` records what it derived in `LCU_PARENT_ENV`, and a nested `lcu` derives those values again for its own release instead of treating them as your overrides; the original runtime's `NODE_REPL_*`, `CUA_REPL_*` and `BROWSER_USE_*` variables return to what the parent's caller set. Variables you set yourself, such as `LCU_NODE_REPL_SANDBOX`, `LCU_LOG_DIR` or `CODEX_HOME`, are kept. An environment from 0.11.8 or earlier, which has no record, is recognized by the launcher's private variables (`LCU_MAC_LIFETIME_SOCKET` and the like), and all of those derived variables are dropped. So a nested `lcu` started from that environment cannot take a `NODE_REPL_*`, `CUA_REPL_*` or `BROWSER_USE_*` value of your own, and unsetting `LCU_PARENT_ENV` does not help: the launcher's private variables are still there, so all of those variables are dropped. To set one, start the agent from an environment that Computer Use did not launch.

For the same reason `lcu` does not pass Claude Code's own variables (`CLAUDECODE`, `CLAUDE_PROJECT_DIR`, `CLAUDE_CODE_*` such as `CLAUDE_CODE_MESSAGING_TOKEN`, `CLAUDE_AGENT_SDK_*`, `CLAUDE_PREVIEW_*`) or Anthropic credentials (`ANTHROPIC_API_KEY`, `ANTHROPIC_AUTH_TOKEN`) to the original runtime, which reads none of them, so apps that Computer Use launches cannot read them either. Other variables, including `CLAUDE_CONFIG_DIR`, still pass.

`lcu setup` does not write these entries: the upstream installers own each harness configuration, and a reversible per-harness environment writer is not a small addition. Remove the entry to return to the default.

On Windows, the existing original window-list check remains available. `doctor` reports that screenshot and Windows permission readiness are unverified; a window list alone is not a screenshot-readiness claim. Across platforms, generic provider errors remain runtime/backend failures unless the original API gives a specific supported error.

Setup remembers these opt-ins per account. After setup or export it saves `{"chrome": bool, "audio": bool, "approval": "ask"|"auto"}` to `~/.local/state/lcu/setup.json` (Windows: `%LOCALAPPDATA%\LCU\setup.json`); a file without `approval` means `ask`. When harnesses are pending it also holds `"pending": [...]` and `"pending_context": {"scope", "project", "session"}`; both are absent otherwise, and a file without them means nothing is pending. Rerunning setup without `--chrome`/`--audio` keeps the saved values, so `setup --agent AGENT --audio` no longer drops a Chrome surface you enabled earlier. Use `--no-chrome` or `--no-audio` to disable a saved opt-in. `lcu status` prints the saved values and any [pending harnesses](#harnesses-installed-later). The interactive Chrome prompt appears only when there is neither a flag nor a saved choice. Setup saves these choices even when a registration step fails, so the printed retry command and `--reconcile` keep them; a failed harness is retried with that command, and a pending harness that fails stays pending.

For computer-audio recording, explicitly opt in when registering the agent, then reconnect it. For example, run `lcu setup --agent pi --audio`. This enables the original recording API and approval flow. LCU adds no audio-specific instructions, and saving audio to a file does not deliver it to the model. See [the audio opt-in verification record](verification/audio-opt-in-2026-09-27.md).

For Chrome, explicitly opt in when registering the agent, then reconnect it. For example, as the desktop account run `lcu setup --agent codex --chrome`. The selected browser and extension must run under that same account. To refresh the original native-host registration, run:

~~~sh
/opt/lcu/current/bin/lcu browser install
/opt/lcu/current/bin/lcu browser status
~~~

The private plugin copy under `~/.local/share/lcu/browser` follows the selected app's Chrome plugin content. `lcu browser install` serializes refreshes with a lock, stages the new copy and its digest, publishes it by rename and recovers an interrupted refresh on the next run. `lcu browser status` reports a connector as outdated when the copy no longer matches the app, and a copy made by 0.8.0 reports outdated until `lcu browser install` is rerun.

The official ChatGPT extension is how the original runtime reads and controls external Chrome tabs. It is required even when LCU runs without Codex sign-in. Desktop applications do not need it. Use your intended Chrome profile; a separate test profile is not an LCU requirement.

`browser install` invokes the original plugin's native-host installer from a user-local copy, then points the account's host manifest at LCU's relay. This command alone does not enable Chrome in an MCP process; direct clients must start `lcu --chrome`. It does not install or enable the Web Store extension. The relay locally enables the official extension's `x-browser-agent` label so Chrome actions do not require Codex sign-in. Sites can see that label; it is not a login credential. Enable the official extension in the intended Chrome profile using [OpenAI's extension setup instructions](https://learn.chatgpt.com/docs/chrome-extension). `browser status` uses the original diagnostics to report whether the extension is enabled and the connector points to this LCU installation; it changes nothing and does not claim a live connection. Without `--browser`, it checks only the browser families whose user data directory exists (as resolved by the original diagnostics module), then reports each one where the original diagnostic finds the extension installed and each check that failed, or says it found none. `--browser FAMILY` checks one browser; the families are those the selected app's diagnostics list (currently `chrome`, `edge`, `brave`, `opera` and `vivaldi`), and `browser install` registers the native host for all of them. Some capabilities come from the browser's extension, not LCU; for example, the original `visibility` capability (hidden tabs) may be unavailable in some browsers. After setup, restart Chrome, or turn the ChatGPT extension off and on in `chrome://extensions`. Chrome reads the native-host manifest only when it launches a host, so an extension that was already connected keeps the original host until it reconnects. Complete the check by asking your agent to use LCU to list Chrome tabs.

[Google's Linux installation guide](https://support.google.com/chrome/answer/95346?hl=en) lists x86-64 and ARM64 Chrome packages. Chrome uses its user configuration for [native messaging host discovery](https://developer.chrome.com/docs/extensions/develop/concepts/native-messaging); a custom `--user-data-dir` profile must have access to the installed host manifest. Browser and extension compatibility with the selected app remains a live test requirement. LCU does not select or change the default browser, browser profile, extension permissions, sign-in or site approvals. Do not use --browser-host, --with-browser-host, or lcu browser serve/protocol; they were IAB-only and now return migration errors.

The native-host manifest belongs to the Linux account, so other apps using this same extension and browser account also reach LCU's relay. The official extension stores the header-on decision in its Chrome profile after an agent session. Installing or removing the relay therefore does not automatically restore the original account-specific header decision in that profile.

Readiness is staged: package installed, desktop ready, extension discovered, then a browser action independently observed on a page under the intended no-sign-in policy. The installed ARM64 and x86-64 builds passed navigation, Unicode input, click, screenshot and tab close in disposable Ubuntu Chrome profiles; the local page observed `x-browser-agent` on browser requests. Site approval is still required. This local override does not reproduce a user-specific Codex feature-gate decision.

Custom harnesses must deliver the original instructions and images, present site approvals, and send completion/interruption events. The shared client and Pi reference adapter are documented in [adapters](ADAPTERS.md). Earlier OpenCode and Goose experiments remain in the [verification record](verification/installed-app-2026-09-23.md); neither is an advertised release integration.

### Chrome extension fails with requires caller identity

Chrome calls fail with `Browser request-header policy requires caller identity.` when the extension is still connected to the original ChatGPT native host instead of LCU's relay. Restart Chrome, or turn the ChatGPT extension off and on in `chrome://extensions`, then list tabs again.

If the `com.openai.codexextension` manifest points somewhere other than LCU's relay, for example at the ChatGPT app's own host, `lcu browser status` prints where it points. Run `lcu browser install`, then reconnect the extension as above.

### Native pipe startup failed after a ChatGPT update

A Computer Use service that was started from the previous ChatGPT version can keep running after the app updates itself. It keeps the socket in the Computer Use service's group container but refuses every client (the system log shows `teamNotFound`, and the app's own service logs `socket lock is unavailable`), so every call fails with `Sky Computer Use native pipe startup failed`. Seen once, on the update from ChatGPT 26.930.21537 to 26.930.61225; it cleared by itself after about 4 minutes.

LCU recovers from this itself. When a call fails this way it looks for exactly one Computer Use service that started before its app bundle was replaced, is one of your own `SkyComputerUseService` processes whose executable is in the app's bundle or in `$CODEX_HOME/computer-use`, is the only process holding the socket lock, and fails `codesign --verify` because the code on disk no longer matches what is running. If all of that still holds when it checks again right before acting, it sends that one process SIGTERM, waits up to 3 seconds for it to exit, and retries the call once, so the original client starts a current service. It logs one line to stderr with the pid and path (in Pi, Oh My Pi and Hermes, the diagnostic log records it as a `stale_service_recovery` event, without the path). It never sends SIGKILL, never asks the same service twice, and does nothing when a custom socket path is configured (even an empty one) or `HOME` is empty or not your account's home folder. It never touches a healthy service, the ChatGPT app or any other process. When any check is inconclusive, or the service does not exit, the original error is returned unchanged; wait a minute without using Computer Use and retry, or quit the service in Activity Monitor. This recovery has not yet been verified on a live app update.

## Approval mode

Normally you do not need this. Your harness's own permission settings decide whether the agent may call LCU's tools (for example Claude's "don't ask again" on the first card), and LCU's per-app approval ("Allow Computer Use to use ...?") holds in every permission mode, including `--approval auto`. `--approval auto` is optional and meant for unattended machines such as VMs and CI, where nobody is there to answer the harness prompt.

By default each harness keeps its own approval behavior for LCU's tools. Claude Code and Codex CLI ask before each `js` call; Oh My Pi's default `yolo` mode does not ask, but a profile set to `always-ask` or `write` does. `lcu setup --approval auto` adds only LCU's own entries, each naming the model-visible tools `js` and `js_reset` exactly (never the whole `lcu` server), so that none of those harness prompts appear and a tool LCU adds in a later version is not allowed in advance; `--approval ask` (the default) reverses exactly what `auto` changed and leaves everything else as it was. LCU records each change (per config path, OMP profile and scope, and the previous Codex value) in `~/.local/state/lcu/approval.json` (Windows: `%LOCALAPPDATA%\LCU\approval.json`) and `ask` undoes only that: an `mcp__lcu__js`, `mcp__lcu__js_reset` or `mcp__lcu` rule, a Codex tool `approval_mode`, or an OMP `allow` entry that was already there is left in place, and a Codex `default_tools_approval_mode` you had set is kept. Versions up to 0.8.9 wrote the server-wide `mcp__lcu` rule and Codex `default_tools_approval_mode = "approve"`; running `--approval auto` again replaces them with the exact entries, and `--approval ask` still removes those old entries (restoring your earlier Codex default) when LCU recorded adding them. A 0.8.0 `auto` left no record, so `ask` cannot tell those entries from yours and leaves them; remove them by hand (see [Uninstall](#uninstall)).

| Harness | `auto` adds | Where |
| --- | --- | --- |
| Claude Code | `"mcp__lcu__js"` and `"mcp__lcu__js_reset"` in `permissions.allow` | `~/.claude/settings.json`; project scope `.claude/settings.local.json` |
| Codex CLI | `approval_mode = "approve"` in `[mcp_servers.lcu.tools.js]` and `[mcp_servers.lcu.tools.js_reset]` | the config setup registers LCU in (`$CODEX_HOME/config.toml`, default `~/.codex`; project scope `.codex/config.toml`) |
| Oh My Pi | `js: allow` and `js_reset: allow` in `tools.approval` | the selected profile's `config.yml`, through `omp config` (`OMP_PROFILE` and `PI_CODING_AGENT_DIR` apply) |
| Pi | nothing: Pi has no permission system | |
| Hermes | nothing: Hermes gates only plugin tools through a `pre_tool_call` hook, which LCU does not register | |
| DeepSeek Harness | nothing: DSH gates plugin tools only through `tools/pre-execute` listeners, which LCU does not register | |
| Junie | `{"pattern": "lcu:js", "action": "allow"}` and `{"pattern": "lcu:js_reset", "action": "allow"}` in `rules.mcpTools.rules` | `~/.junie/allowlist.json` |

~~~sh
/opt/lcu/current/bin/lcu setup --agent claude-code --agent codex --approval auto --session direct
/opt/lcu/current/bin/lcu setup --agent claude-code --agent codex --approval ask --session direct
~~~

The mode applies to the harnesses and scope selected in that run. It is remembered per account, and a later setup that does not name `--approval` keeps `auto` and applies it to whatever it registers; only an explicit `--approval ask` removes entries. Without `--approval` a setup whose remembered mode is `ask` leaves your harness settings alone; Codex setup rewrites the `[mcp_servers.lcu]` table but carries a `default_tools_approval_mode` or tool `approval_mode` you set through it. Only recorded additions are removed: an OMP `js: deny`, `js: prompt` or pre-existing `js: allow` you set is kept, reported, and not removed by `ask`. `--approval` cannot be combined with `--export` or the installer's `--runtime-only`.

This removes only the harness's own prompt about calling LCU. Separately, LCU never approves the app that hosts the agent (Claude desktop, an editor running the agent extension, the terminal running a CLI agent) for computer use, whatever the approval mode; see [agent host apps](ADAPTERS.md#agent-host-apps-are-never-approved). Claude Code's host-only tools stay denied (deny rules win over allow). Native-app permission requests, the original runtime's own approvals and Chrome site approvals come from the original runtime and are unchanged; Chrome stays exact-origin only and nothing here approves a site for you. Choose `auto` only for a machine you control, such as a disposable VM. `tests/codex_approval_mode.py` shows the Codex difference with a scripted local provider, and the other harnesses' entries are covered by `tests/node/approval.test.mjs`. See the [approval boundary](ADAPTERS.md#approval-boundary).

## Manage approved apps

On macOS, Computer Use asks before it first uses each app and offers **Always allow**. `lcu apps` shows and edits that list from the terminal, so you do not need the Codex app.

~~~sh
~/.local/share/lcu/current/bin/lcu apps                 # list approved apps
~/.local/share/lcu/current/bin/lcu apps allow Zed       # always allow an app
~/.local/share/lcu/current/bin/lcu apps revoke Zed      # remove it again
~~~

- `<app>` is an app name (`Zed`), a bundle identifier (`dev.zed.Zed`) or the path to an `.app`. A name that matches several installed apps is refused; pass the bundle identifier.
- `lcu apps` and `lcu apps list` print each app's name and bundle identifier. `--json` prints `{"apps": [{"name", "bundleId", "installed", "risk", "blocked"}], "file": ...}` for scripts.
- `allow` and `revoke` show the system prompt ("always allow Computer Use to control Zed (dev.zed.Zed)"). Touch ID answers it; the login password is the fallback. Listing never asks.
- Changes apply to running sessions at once. Both commands are idempotent and skip the prompt when nothing would change.
- It fails closed: with no graphical login session (an SSH login with nobody at the screen), a cancelled prompt or a missing helper, nothing changes. Run it from a terminal in your desktop session.
- Apps the original runtime never controls (Terminal, iTerm2, ChatGPT/Codex, Notification Center) are refused, because an entry would have no effect. Browsers, password managers, Passwords, Keychain Access and iPhone Mirroring are high risk: `allow` warns, says so in the prompt and still allows them on your authentication. Allowing one means the agent can act on whatever it shows.
- The list is `~/Library/Group Containers/2DC432GLL2.com.openai.sky.CUAService/Library/Application Support/Software/ComputerUseAppApprovals.json`, shared with the Codex app. LCU preserves other keys, replaces the file atomically and retries if the runtime writes at the same moment. A malformed file is reported and left alone.
- The prompt comes from `bin/lcu-owner-auth`, a small helper LCU builds into the macOS archive and signs ad hoc. If macOS blocks it after a browser download, extract with `tar -xzf` or run `xattr -dr com.apple.quarantine` on the extracted folder after checking the checksum.
- This is a convenience guard against an agent approving apps for itself through `lcu`, not a sandbox: the list is an ordinary file in your account.
- On Linux the original runtime has no per-app approval, so `lcu apps` says so; Windows is unsupported.

See the [verification record](verification/apps-command-2026-10-04.md).

## Cross-turn Computer Use

Normally the original service ends Computer Use for a turn when the turn ends, and refuses further calls for that turn id ("Computer Use is unavailable because the current turn ended. It will work again after the next user message."). In Claude Code that also catches a background subagent that is still working after the turn that started it ended, because subagents share their parent's prompt id. `cross-turn` is an opt-in setting that keeps Computer Use available to every turn of a session, including those subagents and a turn that reuses an ended turn id. It is off by default.

~~~sh
~/.local/share/lcu/current/bin/lcu cross-turn            # status (also: status --json)
~/.local/share/lcu/current/bin/lcu cross-turn on         # macOS: Touch ID or your password
~/.local/share/lcu/current/bin/lcu cross-turn off        # no prompt
~/.local/share/lcu/current/bin/lcu cross-turn on --unattended
~~~

- `lcu setup --cross-turn on|off [--unattended]` sets the same thing (not with `--export`), and the Linux and macOS installer forwards both options (not with `--runtime-only`; the Windows installer does not accept them, so on Windows run the installed `lcu setup` or `lcu cross-turn`). On a sandbox VM provisioned without a person: `lcu setup ... --cross-turn on --unattended`. Interactive setup asks once (`[y/N]`) when nothing is stored yet; a stored choice is kept, `--yes` without the option leaves the setting unchanged, and answering no records `off`. A failed or cancelled prompt leaves the setting as it was and does not fail the rest of setup.
- The setting is `~/.local/state/lcu/cross-turn.json` (Windows: `<account home>\AppData\Local\LCU\cross-turn.json`, for example `%USERPROFILE%\AppData\Local\LCU\cross-turn.json`), `{"enabled", "source", "changed_at"}`, beside `setup.json`. The Claude relay reads it on each turn, so running sessions pick the change up without a restart. A missing, damaged or non-boolean file is off.
- On macOS, `on` asks for Touch ID or your login password through `bin/lcu-owner-auth`, the helper `lcu apps allow` uses; it fails closed the same way. `off` never asks, and neither does a command that would change nothing. Linux and Windows have no owner prompt, so `on` takes effect directly.
- `--unattended` skips the prompt, records `"source": "unattended"` and prints a warning. It is for disposable sandbox machines provisioned without a person at the screen (for example Silo computers).
- `lcu status --json` reports `cross_turn: {"enabled", "source"}`.
- This is a guard against an agent turning it on by accident, not a sandbox: anything running as your account can edit the file or pass `--unattended`, as with the approved-apps list.
- It affects the Claude Code relay only. Other agents ignore the setting (Codex hooks carry Codex's own turn id and Pi, which Oh My Pi wraps, generates a new one per turn, as read in code). Per-app approvals (macOS and Windows; the Linux runtime has none) and your harness's tool approvals are unchanged either way.
- Independent of the setting, a foreground subagent finishing no longer makes Computer Use refuse its parent's still-running turn. See [Claude turn identity](ADAPTERS.md#claude-turn-identity-and-cross-turn-computer-use).

See the [verification record](verification/cross-turn-2026-10-10.md).

## Chrome site decisions

When Chrome mode asks `Allow Browser use to access <origin>?`, the original runtime saves your answer for that agent session in `$CODEX_HOME/browser/sessions/<session-id>.toml` (`~/.codex/browser/sessions/` unless `CODEX_HOME` is set) as `[origins]` `allowed` and `denied` lists, and checks it before asking again. The file format is the original runtime's private storage and can change between releases; the [source record](verification/origin-decisions-2026-10-06.md) lists what was checked.

- A site you declined is refused for the rest of that session ("A saved user permission setting blocks this action") without a new prompt.
- The scope is one session. A new session asks again, so Deny is not a lasting block. Subagents have their own session, and their decisions are separate.
- A running agent may keep what it read for up to 5 minutes.

`lcu origins` shows and forgets these decisions without hand-editing the files:

~~~sh
~/.local/share/lcu/current/bin/lcu origins                        # list allowed and denied origins per session
~/.local/share/lcu/current/bin/lcu origins forget https://example.com   # ask about this site again
~~~

- `lcu origins [list] [--session ID] [--json]` prints each session's `allowed` and `denied` origins. `--json` prints `{"codexHome", "sessions": [{"session", "file", "allowed", "denied"}], "problems": [...]}`. A session file that is not valid TOML or does not have the expected `[origins]` lists is skipped, named in `problems` (or on stderr) and makes the command exit 1, so it is never reported as empty.
- `lcu origins forget <origin>` removes a saved decision so the next request for that site asks again. It never allows a site; only the original prompt can. By default it removes the origin from the `denied` list of every saved session. `--session ID` limits it to one session, `--allowed` removes it from the `allowed` list instead (`--allowed --denied` both), and `--all-sessions` states the default. `<origin>` is `scheme://host[:port]`; case, a default port and IPv6 notation are normalized. Pass an internationalized host in its `xn--` form, as the browser reports it.
- After a change, restart the agent or wait up to 5 minutes; then the next request for the site prompts again.
- It edits only simple session files (tables of strings, booleans, integers and string lists), replaces them atomically and keeps their other keys and origins. Concurrent `lcu origins` commands take turns through a lock file (`.lcu-origins.lock`) in the sessions folder. The runtime does not use that lock, so `forget` also re-reads the file before and after the replace and retries or reports a runtime write it sees; a runtime write in the microseconds between the last read and the replace is overwritten unnoticed. That loses a saved answer, so the site is asked about again; it never grants access. A file with comments, nested tables, other value types or invalid TOML is reported and left untouched; a symbolic link is refused. It never writes `browser/config.toml` or the `browser_use` settings in `config.toml`.

Two other places can also block or allow a site, and `lcu origins` does not read or change them: `$CODEX_HOME/browser/config.toml` holds approvals the runtime saves globally when a request is answered with an "always" choice, and `browser_use.origins."<origin>".access = "deny"` in `$CODEX_HOME/config.toml` is the per-site setting that blocks a site in every session. Use that setting, not Deny, when a site should stay blocked.

## Tested app versions

App versions are date stamps (`26.928.31416`) and the CUA runtime is `0.0.x`, so neither signals compatibility. Each release ships [tested-versions.json](../tested-versions.json), a record of the exact platform, architecture, app version and CUA runtime pairs that LCU's checked-in verification covers. Each entry names the LCU version that tested it and its evidence; Linux entries also carry the SHA-256 of the official `.deb` the pair was tested from. The installed tree is not hashed, so that digest is informational and is not matched at run time.

The record never selects or refuses an app. `lcu setup` (before it asks to apply), the installer's `--runtime-only` mode, `lcu doctor` and `lcu status` compare the app they observe with it and report one of three states. An untested or unknown pair prints a warning and the command carries on:

| Status | Meaning |
| --- | --- |
| `tested` | The exact pair is listed for this platform and architecture. |
| `untested` | The record is readable and does not list this pair. The warning names the tested pairs; LCU still uses the app. |
| `unknown` | The record is missing or unreadable, so LCU cannot say. The warning says so; LCU still uses the app. |

`lcu status --json` prints the same state without needing a desktop session, for tools that manage LCU. `compatibility.tested` is `true`, `false` or `null`; `warning` is `null` for a tested pair:

~~~json
{
  "lcu_version": "0.8.0",
  "platform": "linux",
  "architecture": "arm64",
  "app": {"path": "/usr/lib/chatgpt", "version": "26.928.31416", "runtime": "0.0.27/20260927214556-b77d38801cca"},
  "compatibility": {
    "status": "tested", "tested": true, "tested_with_lcu": "0.8.0", "app_sha256": "...",
    "warning": null, "tested_pairs": [{"app_version": "26.928.31416", "runtime": "...", "lcu_version": "0.8.0"}]
  }
}
~~~

The version and runtime are read from the installed app each time, so an app updated in place is judged by what is installed now. Restart agents after an update. See [Development](DEVELOPMENT.md#tested-version-record) for how entries are added.

## Upgrades and rollback

Run `lcu update` to move to the latest LCU release. It reads the latest release tag from the redirect of `https://github.com/amontlabs/lcu/releases/latest`, downloads this platform's archive and its `.sha256` file, verifies the checksum, extracts the archive and runs its installer with `--runtime-only`, the same prefix and the app recorded in `installation.json`. Agent registrations point at `current`, so they keep working and setup is not rerun; saved setup choices are unchanged. The new release then migrates or refreshes existing LCU Claude Code lifecycle hooks in user settings (project scopes need setup again), refreshes the Claude Code `lcu-approve` mod in `~/.claude/skills` if LCU installed it there (a project-scoped mod needs `lcu setup --scope project` again), refreshes the Chrome relay if you had already run `lcu browser install` or `lcu setup --chrome` for this installation (see below), and says when Codex needs `lcu setup --agent codex` to add the update-notice hook. On Linux it adds `--skip-system`: system libraries stay as installed, so when release notes list new system dependencies, run the full installer instead. On a terminal it asks before installing; without a terminal it requires `--yes` and otherwise exits with status 2 and instructions. It never downloads or installs the ChatGPT app. If this account cannot write the prefix (for example a root-owned `/opt/lcu`), it verifies and extracts the release, then prints the `sudo` command to finish instead of escalating. The check and the download use Node's HTTPS client with Node's certificate authorities plus the system's own store; if that request cannot be made (for example behind a proxy only `curl` is configured for), they fall back to the system `curl`. The new installer runs on the same app Node as the installed release. Afterwards, restart the agents that use LCU so they pick up the new release, and run `lcu prune` to reclaim the old one.

The Claude lifecycle helper is copied into account data, outside release directories, so runtime-only rollback
and release pruning leave command hooks silent when an older relay has no lifecycle IPC. Rerun the older
release's setup to restore its MCP lifecycle hooks when downgrading. On Windows the recorded app Node can still
be removed by app-generation pruning; refresh setup after selecting a new app generation and before pruning.

The Chrome relay refresh reuses the `lcu browser install` code path. It runs only when a native-host manifest of this account still points at a relay this installation made (found through the relay's `.lcu-browser-host` marker, from the manifest or from LCU's host directory, so a custom `--directory` and a replaced Windows app generation are found too; a custom directory whose manifest was taken over is not found); it never enables Chrome for an account that did not opt in. The original installer runs against a scratch home (on Windows, which has one manifest and a registry entry, against the real one), and only the manifests that already pointed at the relay are then replaced, so other manifests, browsers that were never set up, and a failed refresh leave the account's browser setup as it was. When the relay or its manifest changed it prints `Refreshed the Chrome relay at ...` and asks you to restart Chrome or turn the ChatGPT extension off and on so it reconnects; when nothing changed it prints only the first line. If a manifest, or on Windows the registry entry, points somewhere else (for example the ChatGPT app took it back), the update leaves it alone and prints `lcu browser install` as the way to point it at LCU again. A refresh failure is a warning, not an update failure, and the update does not refresh the relay when it runs as root; if it finds the desktop account's relay (through `SUDO_USER`) it tells you to run `lcu browser install` as that account.

~~~sh
/opt/lcu/current/bin/lcu update --check   # is a newer release available? (--json for scripts)
/opt/lcu/current/bin/lcu update           # download, verify and install it
~~~

`lcu update --check` contacts GitHub now and exits 1 if it cannot. To update by hand, or to change options, reinstall with the same prefix. The installer keeps LCU generations under releases/ (and, on Windows, app generations under apps/), and atomically changes current only after validating the new release. Agent registrations point at current and should be reloaded after a switch. A failed setup can leave completed agent registrations even when another agent fails; its error lists which to retry. Old generations are retained so live processes do not lose their files.

Reclaim that space with `lcu prune [--keep N] [--yes]`. It removes old LCU release directories under `<prefix>/releases` and the private app generations under `<prefix>/apps` that the kept releases no longer use: Windows copies, and Linux copies made by LCU 0.7.0 and earlier. After upgrading on Linux, prune to reclaim the old app copy. It keeps the current release plus the `N-1` most recent (default `--keep 2`). Without `--yes` it is a dry run that lists the paths and sizes it would remove. Stop or restart any agents still using an older release before pruning, so a live process does not lose its files.

~~~sh
/opt/lcu/current/bin/lcu prune --keep 2
~~~

### Update notices

LCU can tell you when a newer release exists without you running `lcu update --check`. `lcu update --notice` reads only a local cache and never blocks: it prints a notice when a newer release is known, and nothing otherwise. The notice is for you: the agent integrations below show it in the agent's interface, and the model never receives it. When the cache is older than 10 minutes it starts a background refresh (about 1 hour after a failed check, so an offline machine does not retry on every prompt), and concurrent sessions start at most one refresh between them. A release published while sessions are open therefore reaches the first of them to ask within about 10 minutes, at its next prompt. The refresh makes the same single request to the releases redirect as `--check`, then reads that release's `docs/releases/<version>.md` for an optional severity marker; nothing else is sent. The cache is per account: `~/Library/Caches/lcu/update.json` on macOS, `$XDG_CACHE_HOME/lcu/update.json` (default `~/.cache`) on Linux, and `%LOCALAPPDATA%\LCU\cache\update.json` on Windows.

Where the notice appears:

Agent sessions are told about a given release at most once a day per account: once one session (Claude Code, Codex, Pi or Oh My Pi, any project) has shown the notice, the others on the account get nothing about that release for 24 hours. After that, the next session to start or send a prompt is told once, and a session is never told twice about the same release. A newer release is announced at once, then has its own 24-hour cooldown. Security and breaking releases follow the same rule; their notice stays visible in `lcu status`, `lcu doctor` and `lcu update --check`, which are never throttled. What was announced is kept in `announced.json` beside the cache (one `*` entry for the account and one entry per session id, pruned after 7 days). Two sessions starting within the same instant can both be told.

- `lcu status` (text, and the `update` key of `--json`) and `lcu doctor` show the cached notice every time. It is informational and never makes `doctor` fail. So does `lcu update --notice` run by hand.
- Claude Code and the Claude app: the `lcu-approve` mod, installed by `lcu setup --agent claude-code`, runs the notice when a session starts and again on prompts, at most every 10 minutes, under the once-a-day account-wide rule above, and shows it as a toast.
- Codex CLI: `lcu setup --agent codex` adds LCU-owned `SessionStart` (startup and resume) and `UserPromptSubmit` hooks (`lcu update --notice --hook <event>`) that print the same notice as the hook's `systemMessage`, which Codex shows you as a warning, under the same once-a-day account-wide rule. They are separate from the original Stop, Interrupt and SubagentStop hooks, which are unchanged, and are trusted the same way, by exact hash. Codex discovers and trusts them; they, and the warning, have not yet been observed in a live Codex turn.
- Pi and Oh My Pi: the LCU extension runs the notice when an interactive session starts, under the same rule, and shows it as a UI notification. A session without UI does not run it. This has not yet been observed in a live Pi or Oh My Pi session.
- Hermes, DeepSeek Harness, Junie and Antigravity do not show it in the session yet. Their users see the notice in `lcu status` and `lcu doctor`, or by running `lcu update --check`.

A release whose notes carry a severity marker prefixes the notice with "Security update:" or "Breaking update:"; see [Development](DEVELOPMENT.md#release-severity-marker). Set `LCU_NO_UPDATE_CHECK=1` to disable the background check and all notices. A source checkout never reports updates. Offline installs are not recorded, so set the variable on machines without network access; otherwise the check fails quietly and retries about once an hour.

The installer accepts the legacy positional prefix. --offline prohibits installation network calls and requires preinstalled system libraries with --skip-system; model and browser services can still need network during use. --yes confirms a selected noninteractive setup. See --help for the complete option list and [verification](VERIFICATION.md) for exact tested outcomes.

## Uninstall

There is no uninstall command; remove the registrations LCU created, then delete its files. Do this for the desktop account that ran setup.

1. If you ever used `--approval auto`, run `lcu setup --approval ask` for each harness, scope (and project) and OMP profile you used it with, before unregistering. It removes only what LCU recorded adding: the exact `mcp__lcu__js`/`mcp__lcu__js_reset` rules (or the server-wide `mcp__lcu` rule of 0.8.9 and earlier) in Claude Code's `permissions.allow`, the OMP `js`/`js_reset` `allow` entries in the selected profile's `tools.approval` (set `OMP_PROFILE` or `PI_CODING_AGENT_DIR` as for setup), the exact `lcu:js`/`lcu:js_reset` rules in Junie's `~/.junie/allowlist.json`, the exact `mcp(lcu/js)`/`mcp(lcu/js_reset)` rules in Antigravity CLI's `~/.gemini/antigravity-cli/settings.json`, and it removes Codex's per-tool `approval_mode` entries (restoring or dropping the server-wide `default_tools_approval_mode` of 0.8.9 and earlier). A rule you wrote yourself stays. Any LCU-written entry that remains (for example from 0.8.0) can be removed by hand.
2. Remove each harness registration you added:
   - **Codex CLI:** remove the `lcu` MCP server (`codex mcp remove lcu`) and delete the LCU hook entries from `~/.codex/config.toml`.
   - **Claude Code:** if you added the [plugin](#claude-code-plugin), remove it first so it does not register LCU again (`claude plugin uninstall lcu@lcu`, then `claude plugin marketplace remove lcu`). Delete the approval mod folder (`rm -r ~/.claude/skills/lcu-approve`; project scope: `<project>/.claude/skills/lcu-approve`). Remove the `lcu` MCP server (`claude mcp remove lcu`) and delete the LCU hooks and any `mcp__lcu__*` permissions from `~/.claude/settings.json` (project scope: `.claude/settings.local.json`). The exact `mcp__lcu__js` and `mcp__lcu__js_reset` rules belong to approval mode, so reverse that first (below). Lifecycle command hooks invoke the recorded Node with `~/.local/share/lcu/claude/claude-hook.mjs` (Windows: `<home>\AppData\Local\LCU\claude\claude-hook.mjs`); delete that helper folder after removing the hooks. Earlier release-bound commands invoked `current/lcu/claude_hook.mjs` or `windows_launcher.mjs claude-hook` on PreToolUse, Stop, StopFailure and SubagentStop. Older hooks use `mcp_tool`, server `lcu`, and the exact `set_turn_context` or `turn_ended` templates; remove only those LCU handlers and keep neighboring hooks. Close the Claude sessions first so their relays remove their registrations. Stale registrations can be deleted from the account-private `/tmp/lcu-claude-<uid>-<home-hash>` directory (POSIX) or `%USERPROFILE%\AppData\Local\LCU\claude\hooks` (Windows); do not delete another account’s files.
   - **Pi:** `pi remove "$HOME/.local/share/lcu/pi/extension.mjs"` (add `-l` in the project for project scope), then delete `~/.local/share/lcu/pi`.
   - **Oh My Pi:** `omp plugin uninstall lcu-computer-use` (the linked package is staged under `~/.local/share/lcu/omp`).
   - **Hermes:** `hermes plugins remove lcu-cua`; if `${HERMES_HOME:-~/.hermes}/plugins/lcu-cua` remains, delete it.
   - **DeepSeek Harness:** quit DeepSeek Harness Desktop, run `dsh plugin --profile desktop remove lcu-computer-use` (with the CLI inside the app if `dsh` is not on `PATH`: `"/Applications/DeepSeek Harness.app/Contents/Resources/runtime/cli/bin/dsh"`; repeat for each `--dsh-profile` you used), then delete `~/.local/share/lcu/dsh`.
   - **Junie:** delete `mcpServers.lcu` from `~/.junie/mcp/mcp.json` and the hook entries whose command ends in `adapters/junie.mjs --hook` from `~/.junie/config.json`, then delete `~/.local/state/lcu/junie`.
   - **Antigravity:** delete `mcpServers.lcu` from `~/.gemini/config/mcp_config.json` (project scope: `<project>/.agents/mcp_config.json`) and the `lcu` hook handlers whose command ends in `adapters/antigravity.mjs --hook` from `~/.gemini/config/hooks.json` (project scope: `<project>/.agents/hooks.json`), then delete `~/.local/state/lcu/antigravity`.
3. If you set up LCU 0.6.0 or earlier, remove the `lcu` skill copies the skill installer placed in each harness's skill location, and `~/.local/share/lcu/skills`. Running setup from a newer LCU removes them for the selected harnesses.
4. If you ran `lcu browser install`, remove the LCU Chrome native-host manifest (`com.openai.codexextension.json`) from your Chrome profile's `NativeMessagingHosts` directory, along with the relay copy under `~/.local/share/lcu/browser` (macOS: `~/Library/Application Support/lcu/browser`).
5. Delete the prefix (`/opt/lcu` or `~/.local/share/lcu`), `~/.local/share/lcu/skills`, and the saved opt-ins at `~/.local/state/lcu`.

LCU never modified the ChatGPT/Codex app, so nothing there needs undoing.

## Windows 11 x64 candidate (deferred from this delivery)

Windows is deferred from the current LCU delivery. The candidate requires the official `OpenAI.Codex` Store app to already be installed and registered for the current Windows account; LCU does not download or install it. It targets Windows 11 x64 and validates the registered package identity, publisher, Store signature, architecture, and required host layout. A package installed on another drive is registered at a `C:\Program Files\WindowsApps` junction to that drive's `WindowsApps` folder; LCU follows that junction only to the same package folder there, and still refuses links inside the package. Nothing else is needed (no Python): `scripts\install.ps1` checks the registered package and runs the app's own `node.exe` on the Node installer, from a temporary copy of that `node.exe` when Windows refuses to run it inside the protected WindowsApps folder. Extract the matching thin Windows ZIP and run from its extracted release directory in PowerShell:

~~~powershell
powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 --runtime-only
& "$env:LOCALAPPDATA\LCU\lcu.cmd" --version
~~~

To register an agent instead, use `powershell -ExecutionPolicy Bypass -File .\scripts\install.ps1 --agent codex --yes`. The installer accepts the common harness IDs; their installed-host prerequisites and lifecycle limits are in [harness adapters](ADAPTERS.md). OMP and Hermes remain experimental and have no Windows host verification; OMP also requires its generated package and LCU release on the same drive. Add `--chrome` only when the original external Chrome extension path is wanted. The default enables native computer use only. `--runtime-only` and `--agent` are alternative install modes.

The installer reads the selected package version and CUA runtime, inventories the complete registered package, and copies it unchanged into a private generation identified by that source-derived inventory. `<prefix>\lcu.cmd` runs that copy's `node.exe`, which is also recorded in each release's `node-path`. It records the observed metadata and validates the inventory when reusing the copy; it does not compare the app with a repository version or component-hash allowlist. Install, update, `lcu setup`, `lcu doctor` and `lcu status` hash the whole copy; a launch hashes it only when a file's size, modification time or identity, or the expected inventory, version or runtime, changed since the last full match, and otherwise checks the tree with file metadata only. An edit inside the copy that changes none of these is found by `lcu doctor`, not at launch. Its source stays managed by Windows. The first private copy can take several minutes; the installer prints phase messages while it verifies and copies. LCU derives the original native host from the selected app under each thin release and switches the selected release after validation. It does not change WindowsApps permissions or system policy, require ChatGPT sign-in, or bundle the app in the thin ZIP. Reinstalling with the same prefix reuses a validated private app generation and retains prior releases.

The default-prefix private copy, runtime-only installer, `--version`, and `doctor` passed in a clean Windows 11 guest. The installed candidate also enumerated windows, captured a screenshot, and saved Unicode text to an existing Notepad file; an independent file read matched the expected bytes. A later installed candidate verified matching Stop/Interrupt cleanup, stale-turn isolation, and helper exit at MCP shutdown. Candidate f completed project-scoped native setup for Codex CLI, Claude Code, and Pi; the generated Windows skill and Pi files were verified. Its opt-in Chrome path passed a scripted original-MCP action through the official extension, including exact-origin approval and an independently verified save. No Windows real-model session or automatic Chrome per-turn cleanup test ran. The final Windows archive build and seal audit passed. See the [Windows guest record](verification/windows-source.md) for exact results.
