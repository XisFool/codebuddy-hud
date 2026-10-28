# CodeBuddy HUD

[![CI](https://github.com/XisFool/codebuddy-hud/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/XisFool/codebuddy-hud/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/XisFool/codebuddy-hud)](https://github.com/XisFool/codebuddy-hud/releases/latest)
[![Node.js >=18](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![npm dependencies](https://img.shields.io/badge/npm%20dependencies-0-2ea44f)](#install)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> A compact statusLine HUD and plugin for **CodeBuddy Code**, delivering an event-driven terminal dashboard experience inspired by Claude Code's `cc-hud`.
>
> Refreshes after host session events to display model & reasoning effort, Git branch, context tokens, prompt cache hit rate, diff stats, session spend (credits), and tool activity in strict ≤3 lines of ANSI.
>
> Built entirely on Node.js built-in modules (zero npm dependencies). Pushes to master/main, pull requests, and the daily schedule are verified by a **macOS / Linux / Windows × Node 18/20/22** matrix running unit tests and install verification.

[简体中文](./README.md)

---

## Preview

![CodeBuddy HUD preview](./assets/codebuddy-hud-preview.svg)

**UTF-8 terminal**:

```text
Deepseek-V4.1-Flash ● max  │  main*  │  my-project  │  default
Context Token 249k/1M [███░░░░░░░] 25%  │  out 1.1k  │  cache 96.8%
Δ +1.7k -161  │  82.04 credits  │  ⏱ 2h47m  │  ◐ Edit: parser.js  ✓ Read ×3  ✓ Grep ×2
```

**GBK terminal** (Windows default code page 936 and other environments with poor Unicode support) automatically degrades to plain ASCII glyphs — same data, same layout:

```text
Deepseek-V4.1-Flash max  |  main*  |  my-project  |  default
Context Token 249k/1M [###-------] 25%  |  out 1.1k  |  cache 96.8%
[D] +1.7k -161  |  82.04 credits  |  [t] 2h47m  |  [A] Edit: parser.js  [T] Read ×3  [T] Grep ×2
```

> Force either form with `CODEBUDDY_HUD_FORCE_ASCII=1` / `CODEBUDDY_HUD_FORCE_UNICODE=1`; see "Diagnose" for garbled-output troubleshooting.

### Layout breakdown

- **Line 1 (identity)**: model name, reasoning effort (e.g. `● max`), Git branch (`*` means uncommitted changes), workspace directory name, current permission mode.
- **Line 2 (resources)**: current context input usage, context window bar and percentage (numerator aligned with the host's `used_percentage`), output tokens and recent prompt cache hit rate (sliding window aggregation); after compact, stale host data is marked as waiting for a fresh usage report.
- **Line 3 (session activity)**: diff stats `Δ +N -M` (falls back to `[D]` on ASCII terminals), actual session spend (credits, falling back to `$USD` when unavailable), session duration, current AI action, and completed tool-call counts (up to 3). Δ / credits / ⏱ are session-baseline totals (reset only by `/clear`), while tool counts are scanned from the current turn's transcript.

3 lines is a hard cap, aligned with CodeBuddy Code host limits (verified up to v2.171.0+ to truncate stdout at the first three lines); data-less lines are omitted entirely, while an empty individual field shows a `--` placeholder (e.g. `cache --`).

---

## Install

Requires Node.js >= 18 (validated by the install script first). Run one command in a normal terminal — no repo clone, no environment setup.

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/install.ps1 | iex
```

**Windows (CMD)**

```cmd
powershell -ExecutionPolicy Bypass -Command "irm https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/install.ps1 | iex"
```

**macOS / Linux (Bash)**

```bash
curl -fsSL https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/install.sh | bash
```

> **Why not a single plugin install command?** The plugin manifest (`.codebuddy-plugin/plugin.json`) only declares metadata — it does not download runtime files, nor does it write `statusLine` into `settings.json` (the host manifest schema has no such field). The installer script does both.

The installer:

1. Resolves the latest release `tag_name` and pins the runtime to that release (downloads retry up to 3 times with 1s, 2s backoff; `bootstrap.js` itself is still fetched from master).
2. Deploys the runtime to `~/.codebuddy/codebuddy-hud-runtime/` (core code in the `runtime/` subdirectory).
3. Backs up and writes `statusLine.command` into `~/.codebuddy/settings.json`; on Windows, also generates a `.cmd` shim with the Node absolute path baked in (PATH-independent).
4. Registers PATH: on Windows, appends to the user-level registry PATH; on macOS/Linux, symlinks into `~/.local/bin` if it is in PATH. Skip with `CODEBUDDY_HUD_NO_PATH=1`.
5. Mounts the `hud-config` skill at `~/.codebuddy/skills/hud-config/` (Junction on Windows, symlink on POSIX, falling back to a copy), so you can switch themes and customize the display in natural language inside a session.

**Idempotent** — re-run the same command anytime to repair drift, upgrade, or clean stale files left by older versions.

**Updating** — `codebuddy-hud --update` checks the latest release and upgrades in one step (re-running the install command also works). Updates are strictly user-initiated; the render path never touches the network.

**Trigger**: restart CodeBuddy Code after installation and send any message. The host debounces ~300ms after session events before refreshing, and idle sessions render nothing, so an empty bottom line right after opening a session is expected.

**Restricted network, offline, or self-hosted release source**: see [docs/install-advanced.md](docs/install-advanced.md) for mirror acceleration, git-clone local install, and fork installs.

---

## Verify

```bash
# 1. settings.json should contain a statusLine.command pointing at the runtime
grep -A2 '"statusLine"' ~/.codebuddy/settings.json

# 2. Direct invocation should render 3 status lines from demo data and exit
node ~/.codebuddy/codebuddy-hud-runtime/runtime/bin/codebuddy-hud.js --status
```

Windows PowerShell:

```powershell
Get-Content "$env:USERPROFILE\.codebuddy\settings.json"
& "$env:USERPROFILE\.codebuddy\codebuddy-hud-runtime\runtime\bin\codebuddy-hud.cmd" --status
```

> Below, `codebuddy-hud` is shorthand for the entry point: the one-command install registers PATH automatically; if that did not take effect, make sure `~/.local/bin` is in PATH or use the full paths above.

The following are normal degradations, not install failures:

- Empty bottom line while the session is idle — the host only refreshes after session events; send a message and the HUD appears.
- `cache --` or missing credits — the current provider returned no telemetry for those fields, or the transcript scan is incomplete; the HUD degrades or hides values per contract and never fabricates data.

---

## Diagnose

```bash
codebuddy-hud --doctor   # checks Node, settings.json and statusLine target, terminal encoding, Git, transcript access
```

| Symptom | Fix |
| :--- | :--- |
| No HUD at the bottom | Send any message to trigger a refresh; if it still fails, run `--doctor` to check the configured target |
| ⏱ Duration or tool activity doesn't tick in real time | Normal behavior — see "Host Refresh Mechanism & Constraints" |
| Garbled or box characters | Run `chcp 65001` to switch to UTF-8; if still incompatible set `CODEBUDDY_HUD_FORCE_ASCII=1`, or `CODEBUDDY_HUD_FORCE_UNICODE=1` to force Unicode |
| `cache --` / no spend data | Normal degradation when telemetry fields are unavailable — see "Verify" |
| Δ / duration behavior after `/clear` | The host switches to a new transcript; the HUD rebuilds its baseline and resets Δ / duration, taking effect on the next message |
| Inspecting low-level errors | Check `~/.codebuddy/codebuddy-hud-error.log` (auto-rotates past 1MB) |

---

## Uninstall

```bash
codebuddy-hud --uninstall
```

The uninstaller:

- Restores the `statusLine` from the backup taken at install time, only while the current `statusLine` still points at this HUD; if the command in the backup itself points to codebuddy-hud, the `statusLine` entry is removed instead. Replacements or removals you made after installation are preserved.
- Removes the Windows `.cmd` shim and HUD-owned cache and state files. Skills are removed only when the link points to this HUD's source directory or the copied directory has its ownership marker; unknown directories with the same name are preserved.
- Cleans up PATH registration: removes the runtime bin directory from the Windows user registry PATH, and unlinks `~/.local/bin/codebuddy-hud` on macOS/Linux (skipped automatically when `CODEBUDDY_HOME` is set).

Your theme config (`codebuddy-hud.config.json`) and the installed runtime directory (`~/.codebuddy/codebuddy-hud-runtime/`) are preserved — delete them manually if desired. Nothing else in `settings.json` is touched.

Setup and uninstall preserve untouched comments, BOM and formatting in `settings.json`. If the restored file differs from the original backup, uninstall retains the original beside it as `.bak.codebuddy-hud.retained-<time>-<pid>` and prints its path. Run `codebuddy-hud --doctor` to list retained copies (listed only, never auto-deleted).

---

## Themes

5 built-in themes, each with dark and light palettes:

| Theme | Description |
| :--- | :--- |
| `ocean` (default) | Deep-sea cyan-blue |
| `emerald` | Emerald green |
| `cyberpunk` | Pink-purple; matching model, branch, project and out token colors |
| `amber` | Amber gold |
| `monochrome` | Black-and-white minimal |

```bash
codebuddy-hud --theme           # Interactive: ↑/↓ live preview, 1-5 to jump, Enter to confirm, Esc to cancel
codebuddy-hud --theme cyberpunk # Set directly
codebuddy-hud --theme list      # List all themes
```

You can also describe the change inside a CodeBuddy Code session (the bundled `hud-config` Skill writes the config), e.g. "switch the HUD theme to cyberpunk".

`themeMode` defaults to `auto`, combining terminal background signals (e.g. `COLORFGBG`) to pick dark/light; it can be forced to `dark` or `light`.

---

## Configuration

Optional. Create `codebuddy-hud.config.json` at the project root to affect only that project, or in `~/.codebuddy/` to apply to all projects. Priority: project > user > built-in defaults. The block below lists every field with its default:

HUD configs use strict JSON (no comments or trailing commas). A file larger than 256 KiB is ignored for that layer. Changing themes reports an invalid config and leaves the original file intact.

```json
{
  "theme": "ocean",
  "themeMode": "auto",
  "language": "en",
  "defaultEffortLevel": "medium",
  "thresholds": {
    "warning": 0.7,
    "critical": 0.9
  },
  "cacheHitThresholds": {
    "excellent": 80,
    "partial": 50
  },
  "display": {
    "showTokenBar": true,
    "showCacheHitRate": true,
    "showDiffStats": true,
    "showCost": true,
    "showDuration": true,
    "showToolActivity": true,
    "showGitBranch": true,
    "showCurrentDir": true,
    "showVersion": false,
    "showPermissionMode": true,
    "maxLines": 3,
    "progressBarWidth": 10,
    "toolActivityTailBytes": 16384,
    "useNerdFonts": false,
    "unicode": "auto"
  }
}
```

- `language`: UI language, `zh` or `en` (default `en`; any other value auto-detects from the system locale).
- `defaultEffortLevel`: fallback reasoning effort when none is captured; options: `low`, `medium`, `high`, `xhigh`, `max`, `ultracode`.
- `thresholds`: warning/critical thresholds for the context bar; `cacheHitThresholds`: color-grading thresholds for cache hit rate.
- `display.*`: per-segment switches and display parameters. The host hard-truncates output at 3 lines, so a `maxLines` above 3 shows nothing extra — keep the default; `toolActivityTailBytes` is the reverse-scan byte budget for tool activity; `unicode` accepts `auto` / `true` / `false`.

### Environment variables

| Variable | Purpose |
| :--- | :--- |
| `CODEBUDDY_HOME` | Overrides the `~/.codebuddy` host directory (install, state, skills, cache) |
| `CODEBUDDY_SETTINGS_PATH` | Overrides the host `settings.json` path |
| `CODEBUDDY_HUD_DIR` | Overrides the runtime install directory (bootstrap) |
| `CODEBUDDY_HUD_VERSION` | Sets the release tag for bootstrap installation; `--update` resolves the latest release |
| `CODEBUDDY_HUD_MIRROR` | Prefixes install, update, and tag-lookup URLs with a mirror |
| `CODEBUDDY_HUD_BOOTSTRAP_URL` | Overrides the bootstrap.js download source (install and `--update`) |
| `CODEBUDDY_HUD_LATEST_RELEASE_URL` | Overrides the Latest Release lookup URL (legacy alias `CODEBUDDY_HUD_REMOTE_PKG_URL`) |
| `CODEBUDDY_HUD_RAW_BASE` | Directly sets the runtime download source and skips tag lookup |
| `CODEBUDDY_HUD_NO_PATH` | Set to `1` to skip automatic PATH registration during install |
| `CODEBUDDY_HUD_FORCE_ASCII` / `CODEBUDDY_HUD_FORCE_UNICODE` | Forces ASCII / Unicode glyphs |
| `CODEBUDDY_HUD_NO_GIT_CACHE` | Set to `1` to bypass the persistent Git cache |

Usage of the mirror and fork variables is covered in [docs/install-advanced.md](docs/install-advanced.md).

---

## CLI reference

| Command | Description |
| :--- | :--- |
| `--setup [--theme <name>]` | Write `statusLine` into `settings.json`, generate the Windows `.cmd` shim, and deploy the `hud-config` skill (interactive theme picker opens in TTY, or pass `--theme <name>` to skip; for source checkouts — PATH registration is handled by the one-command install scripts) |
| `--status` | Render the HUD once from demo data and exit |
| `--theme [name\|list]` | Interactive theme picker; `list` prints themes; a name switches directly |
| `--doctor` / `-d` `[--json]` | Print the environment diagnostic report (`--json` for machine consumption) |
| `--update` | Check the latest release and, when outdated, download bootstrap to self-upgrade (user-invoked only) |
| `--uninstall` | Uninstall and restore config from backup while the current `statusLine` still points at this HUD, removing deployed skills and PATH registration |
| `--version` / `-v` | Print current version and exit |
| `--help` / `-h` | Print CLI command options and exit |

`--version`/`-v` and `--help`/`-h` take precedence over setup, uninstall and other operations without reading stdin. `--theme --help` (or `--theme -h`) only lists themes, including on a TTY; combining it with `--setup` shows global help.

---

## Cross-platform notes

- **Windows**: the `.cmd` shim bakes in the Node absolute path and injects `@chcp 65001` when a non-ASCII path is detected; avoid placing the repo or runtime in directories containing spaces or quotes.
- **ASCII fallback**: when the terminal does not support Unicode, the HUD switches to plain ASCII symbols with no loss of functionality.
- **macOS / Linux**: invoke the entry directly with `node`; no shim is needed.

---

## Host Refresh Mechanism & Constraints

**Why doesn't the ⏱ duration tick like a stopwatch, and why doesn't tool activity update in real time during long-running commands?** This is the architectural contract of CodeBuddy Code, not a HUD bug:

- The host spawns a one-off child process per refresh, pipes JSON via stdin, and captures stdout, with a **5000ms wall-clock hard timeout** that kills the process and clears the statusLine.
- The host has no periodic timers; it invokes the statusLine only after **session / result / permission / settings / cost** events, with a **300ms debounce**. stdout capture is capped at 10240 UTF-16 characters and only the first 3 lines are kept.
- During long-running tools, streaming generation, and idle input waiting, the host never triggers the statusLine command.

Verified up to CodeBuddy Code **v2.171.0** (re-verified 2026-10-21); this mechanism is unchanged. HUD rendering is ~200ms p50 (0.15–0.32s through the `.cmd` shim). See [docs/architecture.md](docs/architecture.md) §4 and §7 for the full host contract and failure matrix.

---

## Development

```bash
git clone https://github.com/XisFool/codebuddy-hud.git
cd codebuddy-hud

node runtime/bin/codebuddy-hud.js --setup   # Register with the local CodeBuddy
npm link                                    # Optional: global codebuddy-hud command

npm test && npm run verify && npm run verify:install   # Full verification
```

CI runs the 3 OS × Node 18/20/22 matrix on pushes to master/main, pull requests, and the daily schedule: `npm test` (unit tests), `npm run verify` (E2E: payload rendering, CLI command shapes, edge cases), and `npm run verify:install` (real install/uninstall in an isolated host; CI invokes `node scripts/verify-install.js` directly).

References:

- [AGENTS.md](AGENTS.md) — development constraints, pitfalls, and the commit verification loop (includes the source layout).
- [docs/architecture.md](docs/architecture.md) — system architecture and data flow (Chinese: [architecture_zh.md](docs/architecture_zh.md)).
- [docs/module-reference.md](docs/module-reference.md) — module interfaces and persisted state.
- [docs/install-advanced.md](docs/install-advanced.md) — mirror, local, and fork installs.
- [CHANGELOG.md](CHANGELOG.md) — release history.

---

## License

Released under the [MIT License](LICENSE).
