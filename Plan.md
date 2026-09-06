# Implementation Plan: Turn Cache Hit Rate Badge & Open-Source Hardening for codebuddy-cli-hud

> **Note**: 本文档是历史规划，包含后来被取代的方案，不再作为实施清单。当前行为契约与验证命令以 [AGENTS.md](AGENTS.md) 和 `runtime/` 源码为准；后续决策见 [2026-09-06 复核记录](docs/audit-report-2026-09-06.md)。

## 1. Project Background & Constraints
- **Target Host**: CodeBuddy Code CLI `statusLine` command.
- **Protocol**: Stdin reads JSON payload every ~300ms → Synchronously renders ANSI colored multi-line HUD → Immediately exits with code 0.
- **Hard Invariants**:
  1. **Zero npm dependencies**: Only Node.js built-ins (`fs`, `path`, `os`, `child_process`), Node >= 18, CommonJS.
  2. **1500ms execution budget & strict `exit(0)`**: No unhandled exceptions; statusLine errors must never pollute host CLI.
  3. **Line constraint**: Default $\le 4$ lines; empty/zero-value lines must be omitted cleanly.
  4. **Terminal safety**: All external strings must pass through `sanitizeTerminalText()`.
  5. **Pure English & Minimalist Aesthetic**: Background-free, dimmed auxiliary labels (`in:`, `out:`, `·`), hollow progress bars (`\x1b[2m░\x1b[0m`), and clean geometric symbols (`◐`, `▸`, `✓`, `◑`).

---

## 2. Target Visual Layout

### 4-Line HUD Rendering Preview
```text
Hy4 preview ◑ high │ main* │ my-project │ default
52k (in: 50k · out: 2k · cache: 30k) │ cache 60.0% │ 50k/1M [█░░░░░░░░░] 5%
+42 -3 │ 0.00x credits │ ⏱ 1m0s (API: 45s)
◐ 2 active (explorer, coder) │ ▸ Queue: 3 │ ✓ Done 5/8
```

---

## 3. Core Feature Specification: Turn Cache Hit Rate Badge

### 3.1 Data Source
Extracted from stdin payload: `cbData.context_window.current_usage` (or `tokenData`):
- `input_tokens`: Input prompt tokens for this turn.
- `cache_read_input_tokens`: Cached input tokens read.
- `cache_creation_input_tokens`: Cache creation/write tokens (optional, default 0).

### 3.2 Self-Adaptive Prompt Resolution & Hit Rate Formula
Different LLM providers define `input_tokens` either as total prompt tokens (inclusive of cache) or incremental tokens. The adaptive algorithm handles both:

$$\text{cacheTotal} = \text{cacheRead} + \text{cacheWrite}$$

$$\text{totalPrompt} = \begin{cases} \text{inTokens}, & \text{if } \text{inTokens} \ge \text{cacheTotal} \\ \text{inTokens} + \text{cacheTotal}, & \text{if } \text{inTokens} < \text{cacheTotal} \end{cases}$$

$$\text{hitRate} = \min\left(100, \max\left(0, \frac{\text{cacheRead}}{\text{totalPrompt}} \times 100\right)\right)$$

- **Boundary Safety**: If `cacheRead === 0 && inTokens === 0` or `totalPrompt === 0`, returns `{ available: false }`.

### 3.3 Four-Tier Temperature Scale
| Tier | Range | ANSI Code | Visual Meaning | Example Output |
| :--- | :--- | :--- | :--- | :--- |
| **Excellent** | $\ge 80\%$ | `\x1b[32m\x1b[1m` (Green + Bold) | High cache reuse | `cache 85.2%` |
| **Partial** | $50\% \le \text{rate} < 80\%$ | `\x1b[33m` (Yellow) | Moderate cache reuse | `cache 60.0%` |
| **Low** | $0\% < \text{rate} < 50\%$ | `\x1b[33m\x1b[2m` (Yellow + Dim) | Minor cache hit | `cache 25.0%` |
| **Cold** | $= 0\%$ | `\x1b[90m\x1b[2m` (Gray + Dim) | Cold start / zero hit | `cache 0.0%` |
| **Unavailable** | `available: false` | `\x1b[90m\x1b[2m` (Gray + Dim) | No token data | `cache --` |

---

## 4. Open-Source Hardening & Code Review Cleanups

| Component | Current Issue | Solution |
| :--- | :--- | :--- |
| `runtime/bin/codebuddy-hud.cmd` | Hardcoded machine paths (`D:\NodeJs\node.exe` and full directory) | Replace with portable relative path: `@echo off`<br>`node "%~dp0codebuddy-hud.js" %*` |
| `runtime/statusline-installer.js` | Generates hardcoded absolute paths in `.cmd` shim | Update installer to generate portable relative path shim |
| `runtime/git.js` | `cwd` passed to `execSync` without validation | Apply `path.resolve(cwd)` and reject null bytes (`\0`) |
| `runtime/renderer/lang.js` | Unused dead code module | Remove `lang.js` to keep zero-redundancy |

---

## 5. File-by-File Change Matrix

### 5.1 `runtime/renderer/format.js`
- **Add & Export `calculateTurnCacheMetrics(usage)`**:
  - Validates `cache_read_input_tokens`, `cache_creation_input_tokens`, `input_tokens`.
  - Calculates `totalPrompt` and `hitRate`.
  - Returns `{ available: boolean, hitRate: number, cacheRead: number, totalPrompt: number }`.
- **Add & Export `formatTurnCacheBadge(metrics, label = 'cache', isCompact = false, thresholds)`**:
  - Applies 4-tier ANSI temperature color scale.
  - Formats rate to 1 decimal place (e.g. `85.2%`).

### 5.2 `runtime/renderer.js`
- In Line 2 orchestration:
  - Check `config.display.showCacheHitRate !== false`.
  - If enabled and `metrics && metrics.available`, format `cacheBadge`.
  - Place `cacheBadge` between Token breakdown and Context progress bar:
    `[Token breakdown] │ [Cache Badge] │ [Context Bar]`

### 5.3 `runtime/config.js` & `runtime/codebuddy-hud.config.json`
- Add default configuration:
  ```json
  "display": {
    "showTokenBar": true,
    "showCacheHitRate": true,
    "cacheHitThresholds": {
      "excellent": 80,
      "partial": 50
    }
  }
  ```

### 5.4 `runtime/git.js`
- Validate `cwd` input:
  ```javascript
  if (!cwd || typeof cwd !== 'string' || cwd.includes('\0')) return null;
  const safeCwd = path.resolve(cwd);
  ```

### 5.5 `runtime/bin/codebuddy-hud.cmd` & `runtime/statusline-installer.js`
- Set `.cmd` content strictly to:
  ```cmd
  @echo off
  node "%~dp0codebuddy-hud.js" %*
  ```

### 5.6 Remove `runtime/renderer/lang.js`
- Delete `runtime/renderer/lang.js` as the project standard is now clean English.

---

## 6. Testing & Quality Assurance Plan

### 6.1 New Unit Test: `tests/unit/renderer.cache-hit.test.mjs`
- **Test Cases**:
  1. `calculateTurnCacheMetrics`:
     - Standard input with cache included: `in: 5000, read: 3000, write: 1000` $\rightarrow$ `totalPrompt: 5000, hitRate: 60.0%`.
     - Incremental input: `in: 1000, read: 3000, write: 0` $\rightarrow$ `totalPrompt: 4000, hitRate: 75.0%`.
     - Cold start: `in: 5000, read: 0` $\rightarrow$ `hitRate: 0.0%`.
     - Zero tokens / null usage $\rightarrow$ `{ available: false }`.
  2. `formatTurnCacheBadge`:
     - $\ge 80\%$ contains `\x1b[32m\x1b[1m` (Green + Bold).
     - $50\% \le \text{rate} < 80\%$ contains `\x1b[33m` (Yellow).
     - $1\% \le \text{rate} < 50\%$ contains `\x1b[33m\x1b[2m` (Dim Yellow).
     - $0\%$ contains `\x1b[90m\x1b[2m` (Dim Gray).
     - Unavailable metrics returns `\x1b[90m\x1b[2mcache --\x1b[0m`.

### 6.2 Layout Integration Test: `tests/unit/renderer.layout.test.mjs`
- Assert Line 2 contains `cache` percentage when `cacheRead > 0`.
- Assert `showCacheHitRate: false` disables the badge cleanly without breaking dividers.

### 6.3 Verification Commands
```bash
# 1. Run all unit tests (target: 90+ tests pass, 0 fail)
node --test tests/unit/*.test.mjs

# 2. Run E2E fixture verification (target: 5 passed, 0 fail, <1500ms, exit code 0)
node scripts/verify-display.js

# 3. Smoke render test
node runtime/bin/codebuddy-hud.js --status
```

---

## 7. Review Checklist for Reviewing AI
- [ ] Are mathematical formulas for `totalPrompt` and `hitRate` sound and free of divide-by-zero errors?
- [ ] Are all ANSI color escape codes properly closed with `\x1b[0m` to prevent terminal color bleeding?
- [ ] Does `git.js` path normalization eliminate null-byte and directory-traversal edge cases?
- [ ] Is the Windows `.cmd` shim fully portable across machines without hardcoded paths?
- [ ] Are all performance-critical paths strictly synchronous and free of network/long disk I/O?
