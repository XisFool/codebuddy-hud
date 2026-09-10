# CodeBuddy HUD

[![CI](https://github.com/XisFool/codebuddy-hud/actions/workflows/ci.yml/badge.svg?branch=master)](https://github.com/XisFool/codebuddy-hud/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/XisFool/codebuddy-hud)](https://github.com/XisFool/codebuddy-hud/releases/latest)
[![Node.js >=18](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![npm dependencies](https://img.shields.io/badge/npm%20dependencies-0-2ea44f)](#install)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> Real-time statusline HUD for **CodeBuddy Code**. Refreshes after every session interaction and renders strictly ≤3 ANSI lines: model and reasoning effort, Git status, context tokens, cache hit rate, code changes, actual spend, and tool activity.
>
> Built entirely on Node.js built-in modules (zero npm dependencies). Every push is verified by a **macOS / Linux / Windows × Node 18/20/22** matrix running unit tests and install verification.

[简体中文](./README.md)

---

## What it looks like

```text
DeepSeek V4 Flash ● max  │  main*  │  my-project  │  default
Token 250.1k (in: 249k · out: 1.1k)  │  249k/1M [███░░░░░░░] 25%  │  cache 96.8%
Δ +1.7k -161  │  82.04 credits  │  ⏱ 2h47m  │  ◐ Edit: parser.js  │  ✓ Read ×3  ✓ Grep ×2
```

### Layout breakdown

- **Line 1 (identity)**: model name, reasoning effort (e.g. `● max`), Git branch (`*` means uncommitted changes), workspace directory name, current permission mode.
- **Line 2 (resources)**: total context tokens with input/output split, context window bar and percentage (numerator aligned with the host's `used_percentage`), current-turn prompt cache hit rate; shows `cache --` when the provider returns no cache fields.
- **Line 3 (turn activity)**: diff stats `Δ +N -M` (falls back to `[D]` on ASCII terminals), actual session spend (credits, falling back to `$USD` when unavailable), session duration, current AI action, and completed tool-call counts (up to 3).

3 lines is a hard cap, matching the host CodeBuddy Code stdout truncation (verified on v2.146.0: first 3 lines); lines or fields without data are omitted entirely, never rendered blank.

---

## Install

Requires Node.js >= 18 (validated by the install script first). Run one command in a normal terminal — no repo clone, no `npm install`.

**Windows (PowerShell)**

```powershell
irm https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/install.ps1 | iex
```

**macOS / Linux (Bash)**

```bash
curl -fsSL https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/install.sh | bash
```

The installer:

1. Resolves the GitHub Latest Release `tag_name` and pins the install to that release (never a moving branch).
2. Downloads the runtime to `~/.codebuddy/codebuddy-hud-runtime/`.
3. Backs up and writes `statusLine.command` into `~/.codebuddy/settings.json`; on Windows, also generates a `.cmd` shim with the Node absolute path baked in (PATH-independent).

**Idempotent** — re-run the same command anytime to repair drift, upgrade, or clean stale files left by older versions.

**Trigger**: restart CodeBuddy Code after installation and send any message. The host debounces ~300ms after session events before refreshing; idle sessions render nothing, so an empty bottom line right after opening a session is expected.

A background update check runs every 24 hours and suggests re-running the install command when a new version is available.

### Custom install source (mirrors / forks)

The install chain supports the following optional environment variable overrides:

- `CODEBUDDY_HUD_BOOTSTRAP_URL` — bootstrap.js download URL (used by the install scripts)
- `CODEBUDDY_HUD_VERSION` — pin a specific tag (e.g. `v0.2.0`); defaults to the Latest Release
- `CODEBUDDY_HUD_RAW_BASE` — base URL for runtime file downloads (your fork's raw base)
- `CODEBUDDY_HUD_LATEST_RELEASE_URL` — release lookup API (your fork's releases)

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

> Below, `codebuddy-hud` is shorthand for the entry point: for one-command installs it is the `...codebuddy-hud.js` above (`.cmd` on Windows); after a source install with `npm link` you can call `codebuddy-hud` directly.

The following are normal degradations, not install failures:

- Empty bottom line while the session is idle — the host only refreshes after session events; send a message and the HUD appears.
- `cache --` or missing credits — the current provider returned no telemetry for those fields; the HUD degrades gracefully per its three-state contract and never fabricates data.

---

## Diagnose

```bash
codebuddy-hud --doctor   # checks Node, settings.json and statusLine target, terminal encoding, Git, transcript access
```

Common issues and fixes:

| Symptom | Fix |
| :--- | :--- |
| No HUD at the bottom | Send any message to trigger a refresh; if it still fails, run `--doctor` to check the configured target |
| Garbled or box characters | Run `chcp 65001` to switch to UTF-8; if still incompatible set `CODEBUDDY_HUD_FORCE_ASCII=1` for plain ASCII symbols, or `CODEBUDDY_HUD_FORCE_UNICODE=1` to force Unicode |
| `cache --` / no spend data | Normal degradation when telemetry fields are unavailable — see "Verify" |
| Δ / duration behavior after `/clear` | The host switches to a new transcript; the HUD rebuilds its baseline and resets Δ / duration, taking effect on the next message |
| Inspecting low-level errors | Check `~/.codebuddy/codebuddy-hud-error.log` (auto-rotates past 1MB) |

---

## Uninstall

```bash
codebuddy-hud --uninstall
```

The uninstaller:

1. Restores `settings.json` from the original backup taken at install time; without a backup it only removes the `statusLine` entry.
2. Removes the Windows `.cmd` shim.
3. Cleans HUD-owned cache and state files (encoding cache, Git cache, usage checkpoints, session stats, credit state, update status).

Your theme config (`codebuddy-hud.config.json`) and the installed runtime directory (`~/.codebuddy/codebuddy-hud-runtime/`) are preserved — delete them manually if desired. Nothing else in `settings.json` is touched.

---

## Themes

5 built-in themes, each with dark and light palettes:

| Theme | Description |
| :--- | :--- |
| `ocean` (default) | Deep-sea cyan-blue |
| `emerald` | Emerald green |
| `cyberpunk` | Pink-purple + neon cyan |
| `amber` | Amber gold |
| `monochrome` | Black-and-white minimal |

```bash
codebuddy-hud --theme           # Interactive: ↑/↓ live preview, 1-5 to jump, Enter to confirm, Esc to cancel
codebuddy-hud --theme cyberpunk # Set directly
codebuddy-hud --theme list      # List all themes
```

You can also just describe the change inside a CodeBuddy Code session (the bundled `hud-config` Skill triggers automatically and writes the config), e.g. "switch the HUD theme to cyberpunk".

`themeMode` defaults to `auto`, combining terminal background signals (e.g. `COLORFGBG`) to pick dark/light; it can be forced to `dark` or `light`.

---

## Configuration

Optional. Create `codebuddy-hud.config.json` at the project root to affect only that project, or in `~/.codebuddy/` to apply to all projects. Priority: project > user > built-in defaults.

```json
{
  "theme": "ocean",
  "themeMode": "auto",
  "language": "en",
  "display": {
    "showTokenBar": true,
    "showCacheHitRate": true,
    "showDiffStats": true,
    "showCost": true,
    "showToolActivity": true,
    "useNerdFonts": false,
    "unicode": "auto"
  }
}
```

Fields:

- `theme` / `themeMode`: theme and dark/light mode — see "Themes".
- `language`: UI language, `zh` or `en` (default `en`; any other value auto-detects from the system locale).
- `defaultEffortLevel`: fallback reasoning effort when none is captured (default `medium`).
- `display.*`: per-segment switches, all default `true` — also includes `showDuration` / `showGitBranch` / `showCurrentDir` / `showPermissionMode`; `useNerdFonts` (default `false`) enables Nerd Fonts icons; `unicode` accepts `auto` / `true` / `false` (default `auto`, probes terminal capability).
- `thresholds`: warning/critical thresholds for the context bar (defaults `0.7` / `0.9`).
- `cacheHitThresholds`: color-grading thresholds for cache hit rate (defaults `80` / `50`).

---

## CLI reference

| Command | Description |
| :--- | :--- |
| `--setup` | Write `statusLine` into `settings.json` (for source-based local installs) |
| `--status` | Render the HUD once from demo data and exit |
| `--theme [name\|list]` | Interactive theme picker; `list` prints themes; a name switches directly |
| `--doctor` / `-d` | Print the environment diagnostic report |
| `--uninstall` | Uninstall and restore the config from backup |

---

## File structure

```text
codebuddy-hud/
├── runtime/
│   ├── bin/codebuddy-hud.js      # Entry: stdin payload → ANSI HUD; hosts all CLI subcommands
│   ├── renderer.js / renderer/   # 3-line layout assembly and segment rendering (format / diff-render / agents-render)
│   ├── parser.js                 # Payload parsing (token / diff / cost)
│   ├── transcript.js             # Tail-reads the transcript: turn tool counts + usage aggregation
│   ├── session-stats.js          # /clear reset detection and baseline handoff
│   ├── config.js                 # Theme presets, dark/light resolution, deepMerge
│   ├── theme-selector.js / lang.js          # Interactive theme picker and i18n dictionary
│   ├── doctor.js / statusline-installer.js  # Environment diagnostics / host config writer
│   ├── uninstall.js / settings-file.js      # Uninstall cleanup / safe JSONC writes
│   ├── update-checker.js         # Background version check (24h interval)
│   ├── encoding.js / git.js / model-info.js / paths.js / sanitize.js
│   └── codebuddy-hud.config.json # Built-in default config and theme presets
├── scripts/                      # install.sh / install.ps1 / bootstrap.js / verify-*.js / run-tests.js
├── tests/                        # node --test unit tests and payload fixtures
├── docs/                         # Architecture and module deep references
└── skills/hud-config/            # Bundled CodeBuddy configuration Skill
```

---

## Cross-platform notes

- **Windows**: the installer generates a `codebuddy-hud.cmd` shim with the Node absolute path baked in; it injects `@chcp 65001` when a non-ASCII path is detected. Terminal encoding probes are cached, and `CODEBUDDY_HUD_FORCE_ASCII` / `CODEBUDDY_HUD_FORCE_UNICODE` always override the cache.
- **Windows path limitation**: the host v2.146.0 launch chain has escaping limits on paths containing spaces, quotes, or other special characters — avoid placing the repo or runtime in such directories.
- **ASCII fallback**: when the terminal does not support Unicode, the HUD switches to plain ASCII symbols (borders, bars, icons) with no loss of functionality.
- **macOS / Linux**: invoke the entry directly with `node`; no shim is needed.

---

## Verified by CI

Every push runs the 3 OS × Node 18/20/22 matrix (see the CI badge above):

- `npm test` — unit tests across parsing, rendering, session state, config, and installation modules.
- `npm run verify` — E2E: payload rendering, CLI command shapes, edge cases.
- `node scripts/verify-install.js` — real install/uninstall flow in an isolated host.

---

## Development

```bash
git clone https://github.com/XisFool/codebuddy-hud.git
cd codebuddy-hud

node runtime/bin/codebuddy-hud.js --setup   # Register with the local CodeBuddy
npm link                                    # Optional: global codebuddy-hud command

npm test && npm run verify && npm run verify:install   # Full verification
```

References:

- [AGENTS.md](AGENTS.md) — development constraints, pitfalls, and the commit verification loop.
- [docs/architecture_zh.md](docs/architecture_zh.md) — system architecture and data flow (English: [architecture.md](docs/architecture.md)).
- [docs/module-reference.md](docs/module-reference.md) — module interfaces and persisted state.
- [CHANGELOG.md](CHANGELOG.md) — release history.

---

## License

Released under the [MIT License](LICENSE).
