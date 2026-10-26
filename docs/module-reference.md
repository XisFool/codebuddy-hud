# CodeBuddy HUD 模块 API 参考手册 (Module Reference)

> **版本：** `v0.3.9+`  
> **根路径：** 所有模块相对路径均以仓库根目录或 `~/.codebuddy/codebuddy-hud-runtime/` 为基准。

---

## 📑 模块目录索引

1. [`runtime/bin/codebuddy-hud.js` — CLI 统一入口与执行调度器](#1-runtimebincodebuddy-hudjs--cli-入口与执行调度器)
2. [`runtime/parser.js` — 宿主输入 JSON 解析与边界清洗](#2-runtimeparserjs--宿主输入解析与边界清洗)
3. [`runtime/config.js` — 多层配置合并与主题调色板引擎](#3-runtimeconfigjs--多层配置合并与主题引擎)
4. [`runtime/renderer.js` — 3 行看板装配与布局编排器](#4-runtimerendererjs--3-行看板装配与布局编排)
5. [`runtime/renderer/format.js` — 格式化、进度条与 Cache 徽标](#5-runtimerendererformatjs--格式化进度条与-cache-徽标)
6. [`runtime/renderer/diff-render.js` — 代码变更、Credits 与耗时渲染器](#6-runtimerendererdiff-renderjs--代码变更credits-与耗时渲染)
7. [`runtime/renderer/agents-render.js` — 工具活动频次聚合渲染器](#7-runtimerendereragents-renderjs--工具活动格式化渲染)
8. [`runtime/model-info.js` — 推理强度归一化与额度回退](#8-runtimemodel-infojs--推理强度归一化与额度回退)
9. [`runtime/lang.js` — 多语言国际化字典与探测器](#9-runtimelangjs--多语言国际化)
10. [`runtime/transcript.js` — 逆向滑窗遥测与增量 Checkpoint 状态机](#10-runtimetranscriptjs--逆向滑窗遥测与-checkpoint-状态机)
11. [`runtime/session-stats.js` — 会话基线捕获与 `/clear` 重置状态机](#11-runtimesession-statsjs--会话基线与-clear-重置状态机)
12. [`runtime/git.js` — Git 分支与 Dirty 状态非阻塞探测器](#12-runtimegitjs--git-分支与状态探测器)
13. [`runtime/encoding.js` — 终端字符集探测与 Windows 代码页缓存](#13-runtimeencodingjs--终端字符集探测与编码缓存)
14. [`runtime/sanitize.js` — 终端文本安全清洗与 ANSI/Bidi 注入防御](#14-runtimesanitizejs--终端文本安全清洗器)
15. [`runtime/paths.js` — 跨平台路径解析与状态目录管理](#15-runtimepathsjs--跨平台路径解析与目录管理)
16. [`runtime/settings-file.js` — JSONC 安全解析与配置原子写入](#16-runtimesettings-filejs--jsonc-安全解析与配置原子写入)
17. [`runtime/statusline-installer.js` — 状态栏注册与 Windows Shim 烘焙器](#17-runtimestatusline-installerjs--状态栏注册与-shim-烘焙器)
18. [`runtime/doctor.js` — 环境体检与排障诊断子系统](#18-runtimedoctorjs--环境体检与排障诊断)
19. [`runtime/theme-selector.js` — 交互式终端主题选择器](#19-runtimetheme-selectorjs--交互式主题选择器)
20. [`runtime/uninstall.js` — 卸载还原与状态深度清理器](#20-runtimeuninstalljs--卸载还原与深度清理)
21. [`runtime/update-checker.js` — 用户主动更新与版本解析](#21-runtimeupdate-checkerjs--用户主动更新与版本解析)
22. [`scripts/bootstrap.js` — 跨平台原子安装引导程序](#22-scriptsbootstrapjs--跨平台原子安装引导)
23. [`scripts/run-tests.js` — 跨平台测试分发驱动脚本](#23-scriptsrun-testsjs--跨平台测试分发驱动)
24. [`scripts/verify-display.js` — 看板端到端验证](#24-scriptsverify-displayjs--看板端到端验证)
25. [`scripts/verify-install.js` — 隔离宿主生命周期验证](#25-scriptsverify-installjs--隔离宿主生命周期验证)
26. [`scripts/install.ps1` & `install.sh` — 一键在线安装脚本](#26-scriptsinstallps1--installsh--一键在线安装脚本)
27. [`skills/hud-config/SKILL.md` — HUD 配置技能](#27-skillshud-configskillmd--hud-配置技能)

---

## 1. `runtime/bin/codebuddy-hud.js` — CLI 入口与执行调度器

**职责：** 状态栏执行入口，注册为 `statusLine.command`。负责命令行参数分发、stdin 管道超时竞争与异常诊断日志记录、顶层错误捕获与自然 Drain 退出。

### 命令行参数支持 (CLI Flags)
- `--setup [--theme <name>]`: 执行安装，写入 `settings.json`、生成 Windows `.cmd` shim 并自动挂载 `hud-config` 技能至 `~/.codebuddy/skills/`（在 TTY 终端运行自动唤起交互主题选择器，也可带 `--theme <name>` 直接指定跳过交互；PATH 注册由一键安装脚本完成，`--setup` 不修改 PATH）。
- `--uninstall`: 仅当当前 `statusLine` 仍指向本 HUD 时按备份还原或移除；清理技能挂载、缓存、PATH 注册及 shim，保留其他 settings 与用户主题配置（详见 §20）。
- `--theme [name|list]`: 交互式切换、指定主题或列出主题（如 `--theme cyberpunk`、`--theme list`）。
- `--doctor [--json]`, `-d`: 运行全面诊断体检报告（`-d` 为短参数别名，支持 `--json` 输出结构化数据）。
- `--status`: 冒烟探测当前状态栏能否正常渲染（3 行输出与 exit 0）。
- `--update`: 用户主动更新（检查 + 升级二合一）；解析最新 Release tag，落后时下载该 tag 的 bootstrap 并派生后台自举进程，渲染路径零网络契约不受影响。
- `--version, -v`: 输出当前 HUD 版本号并退出。
- `--help, -h`: 输出命令行全部子命令与参数选项帮助信息并退出。

分发顺序：`--version`/`-v` → `--help`/`-h` → 其余子命令，查询不读取 stdin、不会执行安装或卸载。`--theme --help` 或 `--theme -h` 只列出预设（TTY 下也不交互）；与 `--setup` 同用时显示全局帮助。

### 内部常数配置
```javascript
const TIMEOUT_MS = 800;          // Stdin 安全超时，预留 700ms 给渲染与 stdout 刷新
const LOG_MAX_BYTES = 1024 * 1024; // 错误日志 1MB 自动轮转上限
const MAX_STDIN_SIZE = 1024 * 1024;// Stdin 接收上限 1MB（stdin 管道分支内的局部常量）
```

### 错误与退出契约
- `process.stdout.on('error', () => {})` 静默吞掉 `EPIPE`；退出一律 `process.exitCode = 0` + 关闭 stdin 句柄，由事件循环自然排空，禁用 `process.exit()`。设计动机见 [architecture §7 与 §8](architecture_zh.md#7-故障降级与容灾矩阵-failure-degradation-matrix)。

---

## 2. `runtime/parser.js` — 宿主输入解析与边界清洗

**职责：** 从 CodeBuddy 传入的原始 stdin JSON 字符串中安全提取会话、Token、变更与消费指标。

### 接口定义 (TypeScript Signatures)

```typescript
export function parseCodeBuddyInput(rawStdin: string | null | undefined): CodeBuddyPayload | null;

export function extractTokenData(cbData: CodeBuddyPayload): {
  inTokens: number;
  outTokens: number;
  cacheRead: number;
  cacheWrite: number;
  totalInput: number;
  totalOutput: number;
  ctxSize: number;
  ctxPercent: number;
} | null;

export function resolveContextInputTokens(cw: ContextWindow): number | null;

export function extractDiffStats(cbData: CodeBuddyPayload): {
  linesAdded: number;
  linesRemoved: number;
};

export function extractCostData(cbData: CodeBuddyPayload): {
  totalCostUsd: number;
  totalDurationMs: number;
  apiDurationMs: number;
} | null;

export function num(val: any): number;
```

> **Token 占用还原与仲裁**：`input_tokens` 被宿主扣减为 0 时（DeepSeek 等把 miss 记为 creation），`extractTokenData` 以 `combined = rawInput + cacheRead + cacheCreation` 还原总占用（与 `used_percentage` 同基底）；未扣减提示词与缓存并存时，比对 `combined` 与 `rawInput` 相对 `used_percentage` 理论占用的残差距离仲裁，防止翻倍。该还原值同时供 `session-stats.js` 作 /clear 信号（与 Line 2 同源）。

### 数据结构 Shape
```javascript
// CodeBuddyPayload 基础形态
{
  cwd?: string,
  workspace?: { current_dir?: string },
  permission_mode?: string,
  version?: string,
  session_id?: string,
  model?: { id: string; display_name?: string },
  reasoning_effort?: string,
  transcript_path?: string,
  context_window?: {
    total_input_tokens?: number,
    total_output_tokens?: number,
    context_window_size?: number,
    used_percentage?: number,
    current_usage?: {
      input_tokens?: number,
      output_tokens?: number,
      cache_read_input_tokens?: number,
      cache_creation_input_tokens?: number
    }
  },
  cost?: {
    total_cost_usd?: number,
    total_duration_ms?: number,
    total_api_duration_ms?: number,
    total_lines_added?: number,
    total_lines_removed?: number,
    credits?: number
  }
}
```

---

## 3. `runtime/config.js` — 多层配置合并与主题引擎

**职责：** 按「默认 → 随包 → 用户 → 项目」4 层执行 `deepMerge`，再经 `resolveTheme` 后处理。`loadConfig()` 返回前会把 `config.theme` 替换为调色板对象 `{ ...palette, name, mode }`，调用方不能再把它当作预设名字符串比较。

### 接口定义
```typescript
export function loadConfig(cwd?: string): ResolvedConfig;
export function deepMerge<T extends object>(target: T, source: object, depth?: number): T;
export function resolveTheme(config: ResolvedConfig): ThemePalette;
export function detectThemeMode(config: ResolvedConfig): 'dark' | 'light';
export function isPresetName(name: string): boolean;
export const DEFAULT_CONFIG: ResolvedConfig;
export const THEME_PRESETS: Record<string, ThemePreset>;
```

### 内置主题预设 (THEME_PRESETS)
- `ocean` (默认): 深海青蓝科技风 (dark: `cyan`/`gray`, light: `blue`/`gray`)
- `emerald`: 翡翠绿清新护眼 (dark: `brightGreen`（256 色 `121` 浅薄荷绿）/`gray`, light: `green`/`gray`)
- `cyberpunk`: 赛博朋克炫酷粉紫+荧光青 (dark: `brightMagenta`（256 色 `219` 浅马卡龙粉紫）/`cyan`, light: `magenta`/`blue`)
- `amber`: 琥珀金耀眼质感 (dark/light: `gold`（标准 16 色高亮金 `\x1b[93m`）/`gray`)
- `monochrome`: 黑白极简经典终端 (dark: `white`/`gray`, light: `gray`/`gray`)

### 安全机制
设计动机见 [architecture §5.5](architecture_zh.md#55-多层级配置合并与主题引擎-configjs)。配置文件每次加载直接读取；`--theme <name>` 写入用户配置，不是运行时覆盖层；`resolveTheme` 是后处理而非合并层。

`deepMerge()` 内部跳过 `__proto__` 键并将递归深度限制为 64，阻断恶意配置污染 V8 原型链与爆栈。主题覆盖值另经白名单校验：仅保留调色板已有关键字；值必须是严格 SGR 序列（`^\x1b\[[0-9;:]{0,48}m$`）或长度 ≤32 且不含 C0/C1 的字符串；非字符串值被丢弃。未知颜色名不会回退预设，而是由 `color()` 原样输出为无样式文本。

---

## 4. `runtime/renderer.js` — 3 行看板装配与布局编排

**职责：** 核心布局引擎，协调各子渲染器装配 3 行看板，执行空行智能裁剪与终端安全转义。

### 接口定义
```typescript
export function renderHUD(
  cbData: CodeBuddyPayload | null,
  config: ResolvedConfig
): string;
```
> **说明**：必须传入完整解析后的 `config` 配置对象。当 `config` 省略或未提供时，渲染器首行守卫将直接返回空字符串 `''`。

### 3 行输出排版规范
- **Line 1 (Identity)**: `[ModelName] [EffortIcon][EffortLabel] │ [Branch*] │ [Workspace] │ [Permission]`（模型名称加粗；权限模式统一使用标准 16 色高亮紫 `brightPurple`；ASCII 模式下图标为空，仅保留级别文本）
- **Line 2 (Tokens)**: `Context Token 249k/1M [███░░░░░░░] 25% │ out 1.1k │ cache 96.8%`；Context Token 标题加粗，占用分子支持高缓存扣减还原与防翻倍仲裁；compact 压缩后若宿主仍提供旧 usage，则显示等待提示与 `--` 占位。
- **Line 3 (Diff/Cost/Tools)**: `Δ +1.7k -161 │ 82.04 credits │ ⏱ 2h47m │ ◐ Edit: parser.js  ✓ Read ×3  ✓ Grep ×2` (全空自动隐藏)

### Line 2 三态渲染 (`contextStatus`)
- `fresh`：完整展示进度条与 `out`。
- `stale`（`/compact` 后待刷新）：分子显示 `--`，隐藏进度条与 `out`。
- `unknown`：显示分子、隐藏进度条、提示上次上报。
- 缓存徽标：≥`excellent` 纯绿、≥`partial` 纯黄，低命中率与 0% 追加细体（细节见 §5）。设计动机见 [architecture §5.6](architecture_zh.md#56-3-行自适应布局-rendererjs)。

---

## 5. `runtime/renderer/format.js` — 格式化、进度条与 Cache 徽标

**职责：** 基础文本格式化、用量进度条与 Prompt Cache 徽标渲染。

### 核心函数列表
- `formatTokens(num: number): string`: 格式化数字为 `1.2k`、`3.5M`；`>= 999950` 直接进入 `M` 分支，`999.5` 边界处理防止四舍五入溢出为 `1000k`。
- `formatDurationMs(ms: number): string`: 格式化毫秒数为 `12s`、`5m20s`、`2h15m`、`10h`、`1d5h`、`10d`。
- `createProgressBar(pct: number, width: number, thresholds: object, glyphs: object): string`: 生成自适应色阶进度条（宽度限制 4–40）。
- `calculateTurnCacheMetrics(usage: object | null): TurnCacheMetrics | { available: false } | null`: 从单条 usage 计算缓存命中指标，字段缺失或总 prompt 为 0 时返回 `{ available: false }`，无 usage 时返回 `null`。该函数仅用于测试/辅助路径，生产渲染使用 `metricsFromPromptCache` 聚合 transcript 遥测。
- `metricsFromPromptCache(hitTokens: number, promptTokens: number): TurnCacheMetrics | null`: 从本轮聚合命中数与 prompt 数构建缓存指标（调用方在返回 `null` 时兜底为 `{ available: false }` 并渲染 `cache --`）。
- `formatTurnCacheBadge(metrics, label, isCompact, thresholds): string`: 渲染缓存徽标。命中率 ≥ `excellent` 时为纯绿、≥ `partial` 时为纯黄；仅 `0 < rate < partial` 与 0% 时追加 `DIM`。`isCompact` 为保留形参，当前实现未使用。
- 辅助导出与调色常量：`ANSI_COLORS`（含 `brightPurple: '\x1b[95m'` 等）、`RESET`、`BOLD`、`DIM` 样式常量，以及 `color` / `bold` / `dim` 三个样式辅助函数。
- 调色与清洗接口：
```typescript
export function themeColor(config: ResolvedConfig, key: string, text: string, fallback?: string): string;
export function getThemeColor(config: ResolvedConfig, key: string, fallback?: string): string;
export function normalizeTokenCount(v: any): number | null;
export function sumCachedTokens(details?: Array<{ cached_tokens?: number }>): number | null;
```

---

## 6. `runtime/renderer/diff-render.js` — 代码变更、Credits 与耗时渲染

**职责：** 装配 Line 3 代码增删指标、累计实际 Credits 扣费与耗时。

### 接口定义
```typescript
export function renderDiffSegment(
  diffStats: { linesAdded: number; linesRemoved: number },
  costData: { totalCostUsd?: number; totalDurationMs?: number; apiDurationMs?: number },
  config: ResolvedConfig,
  glyphs: GlyphSet,
  creditSpend?: number | null,
  toolSegment?: string
): string;

export function formatCreditSpend(creditSpend?: number | null): string; // 合法非负数（含 0）返回 "X.XX credits"，非法或缺失返回 ""
```

---

## 7. `runtime/renderer/agents-render.js` — 工具活动格式化渲染

**职责：** 将 `transcript.js` 已聚合好的工具活动格式化为 Line 3 尾部片段（聚合本身不在本模块）。

### 接口定义
```typescript
export function renderToolActivity(activity: ToolActivity, glyphs: GlyphSet): string;
```

### 工具聚合输出格式
多个已完成工具每个独立带有 `doneIcon`（`✓`），以双空格分隔；仅显示前 3 名，`×N` 仅在 `count > 1` 时出现：
```
◐ RunCommand: npm test  ✓ Edit ×3  ✓ View ×12
```

---

## 8. `runtime/model-info.js` — 推理强度归一化与额度回退

**职责：** 对会话推理强度（effort）做白名单归一化与多级解析，为 Line 1 的 effort 图标提供取值；并从 payload 提取明示的实际 Credits 消费。

### 接口定义
```typescript
export function resolveEffortLevel(cbData: CodeBuddyPayload, config?: ResolvedConfig): string | null;
export function resolveCreditSpend(cbData: CodeBuddyPayload): number | null;
export function resetModelInfoCache(): void;
```

### 关键机制
- **白名单归一化**：仅接受 `low` / `medium` / `high` / `xhigh` / `max` / `ultracode`（含 `med`、`extra-high`、`maximum`、`ultra` 等别名映射）；未知值视为不可信输入，沿解析链下探。
- **effort 解析链**：`cbData.reasoning_effort` → `cbData.model.reasoning_effort` → `cbData.model.effort` → transcript 会话信号（按 transcript 哈希持久化于会话状态目录）→ `settings.json` 的 `reasoningEffort`（仅进程内缓存）→ 模型名推断 → `config.defaultEffortLevel`。
- **Credits 回退**：仅提取 payload `cost.credits` 明示的实际消费；缺失返回 `null`，不基于模型费率元数据推算。

---

## 9. `runtime/lang.js` — 多语言国际化

**职责：** 提供集中化中英双语词典，自动探测系统环境语言并提供 `t()` 翻译辅助函数。

### 接口定义
```typescript
export function detectLanguage(config?: { language?: string }): 'zh' | 'en';
export function getI18n(config?: ResolvedConfig): {
  lang: 'zh' | 'en';
  t: (key: string, fallback?: string) => string;
  dict: Record<string, string>;
};
export const DICTIONARY: Record<'zh' | 'en', Record<string, string>>;
```

---

## 10. `runtime/transcript.js` — 逆向滑窗遥测与 Checkpoint 状态机

**职责：** 高性能逆向滑窗读取 `transcript.jsonl`，聚合当前轮次 API Usage，并以增量 Checkpoint 计算累计 Credits。

### 接口定义
```typescript
export function getTurnUsageMetrics(
  transcriptPath: string | null,
  opts?: { cwd?: string; tailBytes?: number }
): {
  hitTokens: number;
  promptTokens: number;
  callCount: number;
  credits: number | null;
  creditCallCount: number;
  source: 'turn';
} | null;

export function getSessionUsageMetrics(
  transcriptPath: string | null,
  opts?: { statePath?: string; cwd?: string }
): {
  complete: boolean;
  credits: number | null;
  creditCallCount: number | null;
  offset: number;
  source: 'session';
} | null;

export function getTurnToolActivity(
  transcriptPath: string | null,
  opts?: { cwd?: string; tailBytes?: number }
): {
  active?: { tool: string; detail?: string };
  completed: Array<{ tool: string; count: number }>;
  totalCompleted: number;
} | null;

export function getTurnMetricsAndActivity(
  transcriptPath: string | null,
  opts?: { cwd?: string; tailBytes?: number; contextWindow?: object }
): {
  turnUsage: ReturnType<typeof getTurnUsageMetrics>;
  toolActivity: ReturnType<typeof getTurnToolActivity>;
  contextStatus?: 'fresh' | 'stale' | 'unknown';
};
```

设计动机见 [architecture §5.1 与 §5.4](architecture_zh.md#51-逆向滑窗遥测扫描-transcriptjs)。

- `getTurnMetricsAndActivity()` 共享本轮 usage 与工具活动的一次逆向扫描；回扫自 EOF 向前，滑窗边界切断的 JSONL 行跨块拼装，遇到最近的 `role: 'user'` 即停；超出 `MAX_TURN_SCAN_LINES` / `MAX_TOTAL_BYTES` 时止于最近调用，口径变为 `sum(hitTokens) / sum(promptTokens)`。
- Cache 字段优先级：`rawUsage.prompt_tokens` 有效时取 `prompt_cache_hit_tokens` → `prompt_tokens_details.cached_tokens` → `cached_tokens` → 0；否则 `usage.inputTokens` 有效时取 `sum(usage.inputTokensDetails[].cached_tokens)`。
- 会话 Credits 另用前向 checkpoint 扫描（状态 schema 见 §15），分块循环预算 100ms，从 `offset` 续读，未写完的尾行不提交。`complete: false` 表示预算耗尽、短读或尾行未完成：累计值与调用数为 `null`，checkpoint 仍可续扫；渲染层隐藏 Credits，禁止 payload 兜底。
- `contextStatus`：`/compact` 产生压缩摘要而宿主尚未返回新 usage 时为 `stale`；判据见下。

### 核心状态机与双向遥测匹配机制（内部辅助实现，未在 module.exports 导出）
- `createContextTracker(contextWindow)`（内部辅助函数，未在 module.exports 导出）：沿消息 `parentId` 逆向回溯历史链。检测到完成的 compact 压缩摘要（`isCompacted: true` 且 `isSummary: true` 或 `isCompactInternal: true`）即置 `stale`；检测到普通活跃 API usage 时，通过 `resolveReportedInputs(usage)` 进行双向遥测比对（`matchesInput = reportedInput === input || rawReportedInput === input`），并且只有同时满足 `!sawUsage`、输入/输出均为有限非负数、`reportedOutput === output` 时才置 `fresh`；一旦本链已发现更早的普通 usage，则不再用旧 payload 反证。
- `getCompactContextStatus(transcriptPath, contextWindow, opts)`（内部辅助函数，未在 module.exports 导出）：当宿主未在边界完整保留 parent 关联时的尾窗回退——压缩摘要位于最新普通 usage 之后则为 `stale`。
- `resolveReportedInputs(usage)`（内部辅助函数，未在 module.exports 导出）：提取 `{ combined, raw }`，统一还原基准（`combined = input_tokens + cache_read_input_tokens + cache_creation_input_tokens`）。

### 辅助导出与常数
- 辅助扫描函数：`getRecentToolActivity(transcriptPath, opts)` 返回 `{ status: 'active' | 'done', tool, detail } | null`（renderer 在无 `turnActivity` 时兜底调用）；`getRecentUsageMetrics(path, opts)`、`extractUsageMetrics(entry: object)`。
- 滑窗预算常数：`DEFAULT_TAIL_BYTES` (16384)、`MAX_TOTAL_BYTES` (262144)、`MAX_SCAN_LINES` (40)、`MAX_TURN_SCAN_LINES` (200)；`MIN_TAIL_BYTES` 为 64，小于该值的 `display.toolActivityTailBytes` 会被 `normalizeTailBytes` 重置为 16384。

---

## 11. `runtime/session-stats.js` — 会话基线与 `/clear` 重置状态机

**职责：** 监控上下文与指标单调性，识别 `/clear` 场景并扣除历史基线。

### 接口定义
```typescript
export function getLogicalSessionCostData(
  cbData: CodeBuddyPayload,
  rawCostData: CostData,
  opts?: { statePath?: string; cwd?: string }
): {
  linesAdded: number;
  linesRemoved: number;
  totalDurationMs: number;
  apiDurationMs: number;
};
export function getSessionIdentity(cbData: CodeBuddyPayload, cwd?: string): string | null;
export function getResetSignal(cbData: CodeBuddyPayload): {
  totalInputTokens: number | null;
  currentInputTokens: number | null;
};
export const SESSION_STATS_VERSION: number;
```

状态落盘于 `~/.codebuddy/codebuddy-hud-session-state/<hash>.json`（schema 见 §15），设计动机见 [architecture §5.3](architecture_zh.md#53-会话基线捕获与-clear-判定-session-statsjs)。

**重置判定（任一命中即重建基线）**：
- **Cliff Drop**：当前上下文占用相对降幅 ≥50% 且绝对降幅 ≥3000；
- **Return to Initial**：当前占用 ≤4096 且此前 ≥6000（相对降幅 ≥35%）；
- 累计 `total_input_tokens` 下降；
- 同一 transcript 的 `session_id` 变化、transcript 物理截断（本次正整数 size 小于上次有效记录），或宿主显式 `clear_signal` / `is_clear`；
- 代码增删或耗时计数低于已存基线（此时 cost 基线归零）。

`cwd` 用于相对 `transcript_path` 的解析（identity 派生）；identity miss 即视为新会话，直接以当前 payload 累计为新基线。`getSessionIdentity()` 有 transcript 时返回 `transcript:<normalizePlatformPath(path)>`，否则返回 `session:<session_id>`，该字符串作为状态文件哈希键。`getResetSignal` 的 `currentInputTokens` 取 `parser.resolveContextInputTokens` 的还原占用（与 Line 2 同源）：有 `context_window_size`/`used_percentage` 时缓存命中/扣除不改变该值；两者缺失时退回原始 `input_tokens`（缓存残差形态仍可能触发断崖）；`input_tokens` 缺失且 cache 计数为 0 时为 `null`，不参与断崖比较。

`transcriptSize` 保存最近一次有效的正整数尺寸；单独增长也触发写回。stat 失败或尺寸为 0 时保留上次有效记录，即使其他信号触发写回；无重置且状态、尺寸均不变时不写盘。`0` 表示尚无有效尺寸，空文件本身不触发截断。

---

## 12. `runtime/git.js` — Git 分支与状态探测器

**职责：** 单次 `git status --porcelain -b` 快速获取分支名与脏文件标记（`*`）。

### 接口定义
```typescript
export function getGitStatus(
  cwd?: string,
  timeoutMs?: number // 默认 200ms 超时保底
): {
  branch: string;
  dirty: boolean | null;
} | null;
export function findGitInfo(cwd?: string): { gitDir: string; workTree: string } | null;
export function readDirectBranch(gitDir: string): string | null;
export function parseGitStatusOutput(output: string): { branch: string; dirty: boolean };
```

设计动机见 [architecture §5.2](architecture_zh.md#52-git-分支与状态非阻塞探测-gitjs)。读取 `.git/HEAD` 直接得到分支名或 7 位游离态 commit（零派生）；需要脏状态时 `execFileSync('git', ['status', '--porcelain', '-b'], ...)` 免 shell，硬超时 200ms，`windowsHide: true`，`GIT_OPTIONAL_LOCKS: '0'`；`child_process` 仅在缓存未命中时懒加载。

正常结果缓存 10 秒，HEAD/index mtime 变化可提前失效；未暂存的工作树编辑可能延迟显示。`git status` 失败但 HEAD 可读时写入 10 秒正缓存 `{ branch, dirty: null }`；只有无 HEAD 可回退时才写 60 秒失败负缓存（`GIT_FAILURE_TTL_MS`），并以 `headMtime` 变化自失效。非 git 目录不会派生 `git` 进程，仅有 5 秒进程内 `_nonGitDirs` 负缓存（一次性进程跨帧无效）。`CODEBUDDY_HUD_NO_GIT_CACHE=1` 绕过持久化缓存，但不影响该进程内 5 秒负缓存。返回 `null` 表示无仓库/无 HEAD；`dirty: null` 表示探测失败但分支可读。

---

## 13. `runtime/encoding.js` — 终端字符集探测与编码缓存

**职责：** 探测终端 Unicode/NerdFonts 支持，Windows 下自动探测 `chcp 65001` 并缓存。

### 接口定义
```typescript
export function supportsUnicode(): boolean;
export function detectUnicodeSupport(platform: string, env: Record<string, string | undefined>): boolean;
export function selectGlyphs(useNerdFonts: boolean, unicodeSupported: boolean): GlyphSet;
export function resetCache(): void;
```

设计动机见 [architecture §8](architecture_zh.md#8-跨平台与零依赖设计保障)。Windows 下通过直连 `spawnSync('chcp.com')` 免壳探测（硬超时 300ms）；代码页探测结果缓存于 `~/.codebuddy/codebuddy-hud-cache-state.json` 保持 1 小时，探测超时或派生失败当帧安全降级 ASCII 且仅缓存 60 秒（`probeTtlMs: 60000`）防抖，避免因系统偶发尖刺锁死 1 小时；`CODEBUDDY_HUD_FORCE_ASCII` / `CODEBUDDY_HUD_FORCE_UNICODE` 优先于缓存。

---

## 14. `runtime/sanitize.js` — 终端文本安全清洗器

**职责：** 剥离外部输入中的 ANSI CSI/OSC 控制序列、DCS/APC/PM/SOS 串式控制串（含 C1 单字节形式）、Unicode Bidi 伪装字符与 C0/C1 控制符。

### 接口定义
```typescript
export function sanitizeTerminalText(text: any, maxLen?: number): string;
```

---

## 15. `runtime/paths.js` — 跨平台路径解析与目录管理

**职责：** 统一定位 CodeBuddy 配置目录（优先支持 `CODEBUDDY_HOME` 与 `CODEBUDDY_SETTINGS_PATH` 环境变量），并提供跨平台文件哈希与状态路径解析。

### 核心路径查询函数
- `getCodeBuddyHome(): string`: 返回 `~/.codebuddy` 或覆盖路径。
- `getSettingsPath(): string`: 返回 `settings.json` 绝对路径。
- `getUserConfigPath(): string`: 返回 `codebuddy-hud.config.json` 路径。
- `getErrorLogPath(): string`: 返回 `codebuddy-hud-error.log` 路径。
- `getCacheStatePath(): string`: 返回 `codebuddy-hud-cache-state.json` 路径。
- `getCreditStatePath(): string`: 存量清理接口——返回旧版 `codebuddy-hud-credit-state.json` 路径。Credits 遥测已整体迁移至 usage checkpoint，仅供 uninstall 清理历史文件。
- `getUpdateStatusPath(): string`: 存量清理接口——返回旧版 `codebuddy-hud-update-status.json` 路径。遵循渲染路径零网络契约已整体退役，仅供 uninstall 清理历史文件。
- `getGitCachePath(): string`: 返回 `codebuddy-hud-git-cache.json` 路径。
- `getTranscriptUsageStateDir(): string`: 返回 `codebuddy-hud-usage-state/` 目录。
- `getTranscriptUsageStatePath(transcriptPath: string): string`: 按 transcript 绝对路径 SHA-256 哈希隔离的增量遥测 checkpoint 路径。
- `getSessionStatsStateDir(): string`: 返回 `codebuddy-hud-session-state/` 目录。
- `getSessionStatsStatePath(identity: string): string`: 按会话 identity 哈希隔离的基线状态路径。
- `getSessionStatsHandoffPath(cwd: string): string`: 存量清理接口——旧版 `/clear` handoff 状态路径（`handoff-<sha256(cwd)>.json`）。handoff 机制已退役（identity miss 直接锚定当前累计），现无运行时引用；函数保留以便定位/清理存量文件，uninstall 按整目录 rmSync 兜底覆盖。
- `getSessionEffortStatePath(transcriptPath: string): string`: 返回按 transcript 路径哈希寻址的会话 effort 状态文件 `codebuddy-hud-session-state/effort-<sha256>.json`。
- `resolveCodeBuddyPath(...segments: string[]): string`: 将相对路径解析为基于 `CODEBUDDY_HOME` 的绝对路径。
- `getUserSkillsDir(): string`: 返回用户级技能根目录（`~/.codebuddy/skills/`）。
- `getHudSkillTargetDir(): string`: 返回 `hud-config` 技能部署目标目录（`~/.codebuddy/skills/hud-config/`）。
- `normalizePlatformPath(p: string): string`: 平台感知路径归一化——Windows 下 resolve 后整体小写（消除盘符 `d:`/`D:` 哈希分裂），POSIX 保留大小写语义。

### 状态文件落盘格式与持久化契约

- `codebuddy-hud-session-state/<identity-sha256>.json` (会话基线与 /clear 重置信号状态):
```json
{
  "version": 1,
  "identityHash": "string (sha256)",
  "sessionIdHash": "string | null (sha256)",
  "baseline": {
    "linesAdded": 0,
    "linesRemoved": 0,
    "totalDurationMs": 0,
    "apiDurationMs": 0
  },
  "signal": {
    "totalInputTokens": null,
    "currentInputTokens": null
  },
  "transcriptSize": 12345,
  "updatedAt": 1729670000000
}
```

- `codebuddy-hud-session-state/effort-<transcript-sha256>.json` (会话推理深度 Effort 状态):
```json
{
  "version": 1,
  "effort": "max",
  "updatedAt": 1729670000000
}
```

- `codebuddy-hud-usage-state/<transcript-sha256>.json` (transcript Credits checkpoint, version 5):
```json
{
  "version": 5,
  "path": "absolute transcript path",
  "identity": { "dev": 0, "ino": 0, "birthtimeMs": 0 },
  "headHash": "sha256",
  "offset": 0,
  "credits": 0,
  "creditCallCount": 0,
  "checkpointHash": "sha256",
  "sourceSize": 0,
  "sourceMtimeNs": "0",
  "sourceCtimeNs": "0",
  "sourceContentHash": "sha256 | null",
  "updatedAt": 1729670000000
}
```
失效条件：`size < sourceSize`（截断/轮转）、`size === sourceSize` 但 mtime/ctime 变化或 `sourceContentHash` 变化（原地覆写）、identity 变化、checkpoint/head 哈希不匹配。

- `codebuddy-hud-cache-state.json` (终端编码缓存): `{ unicodeSupported: boolean, savedAt: number, probeTtlMs?: number }`；成功结果默认保留 1 小时，失败结果写 `probeTtlMs: 60000`。

- `codebuddy-hud-git-cache.json` (Git 探测缓存): 以 workTree 为键，每项 `{ branch, dirty, headMtime, indexMtime, failed?, timestamp }`；`failed: true` 为 60 秒负缓存。

---

## 16. `runtime/settings-file.js` — JSONC 安全解析与配置原子写入

**职责：** 针对宿主 `settings.json` 进行安全读取、注释剥离、符号链接目标解析、原子写盘与权限保全。

### 接口定义
```typescript
export function parseSettingsJson(raw: string): object;
export function atomicWriteSettingsFile(targetPath: string, content: string): void;
export function resolveWriteTarget(targetPath: string): string;
export function isSettingsObject(value: unknown): boolean;
export function writePrivateFileIfAbsent(filePath: string, content: string): boolean;
```

### 核心安全契约
- **严格保护字符串内容**：`stripJsonComments()` 仅剔除双引号字符串外的单行 `//` 与块级 `/* */` 注释，保留换行符与空格以确保 JSON 语法报错行号对齐；绝不误改字符串内部的路径或 URL。`parseSettingsJson()` 还会剥离 UTF-8 BOM、清除字符串外的尾随逗号；空内容返回 `{}`。
- **符号链接解析跟随**：`resolveWriteTarget()` 循环解引用符号链接（上限 40 层防环），确保写操作直接作用于最终真实目标文件。
- **原子替换与硬链接保护**：通过临时文件（`.tmp-<pid>-<time>`）写入后执行 `fs.renameSync()` 原子替换；检测到硬链接数 `nlink > 1` 时主动拒绝原子替换，防止意外破坏硬链接。
- **POSIX 权限保全**：继承目标文件原有的 mode/uid/gid；新创建的配置文件与首次备份默认赋予严格的 `0600` 私有权限。

---

## 17. `runtime/statusline-installer.js` — 状态栏注册与 Shim 烘焙器

**职责：** 将 HUD 注册进 CodeBuddy `settings.json` 的 `statusLine` 配置项，并在 Windows 平台生成固化 Node 绝对路径的 `.cmd` shim 启动脚本。

### 接口定义
```typescript
export function setup(options?: {
  settingsPath?: string;
  runtimeDir?: string;
  hudBin?: string;
  platform?: string;
  nodeExe?: string;
  theme?: string;
}): void;

export function deploySkill(options?: {
  rootDir?: string;
  sourceSkillDir?: string;
  targetSkillDir?: string;
}, hudBin?: string, platform?: string): void;

export function buildStatusLineCommand(platform: string, hudBin: string, nodeExe: string): string;
export function buildCmdShimContent(nodeExe: string, hudBin?: string): string;
export function parseSettingsJson(content: string): object;
export function isSettingsObject(val: unknown): val is Record<string, unknown>;
```

### 关键机制
- **技能自动挂载**：`setup()` 时通过 `deploySkill()` 将 `skills/hud-config/` 挂载至 `~/.codebuddy/skills/hud-config/`（Windows 优先 Junction，POSIX 优先目录软链接，跨卷或失败时降级递归复制；带源目录存在性与自环防呆校验）。
- **Windows Shim**：烘焙 `process.execPath`、`%`→`%%`、非 ASCII 路径的 8.3 短路径与 `@chcp 65001 >nul`、宿主引号兼容规则见 [architecture §8.1](architecture_zh.md#8-跨平台与零依赖设计保障)。
- **settings.statusLine 形状**：写入 `{ type: 'command', command, padding: 0 }`；Windows `.cmd` shim 以 `"%~dp0codebuddy-hud.js"` 转发同目录入口，`doctor` 按该转发约定校验健康度。
- **无损配置恢复保障**：首次安装前将原始 `settings.json` 备份为 `settings.json.bak.codebuddy-hud`（仅备份一次，永不覆盖老备份）。安装成功后通过 `settings-file.js` 以原子写入写回标准格式。

---

## 18. `runtime/doctor.js` — 环境体检与排障诊断

**职责：** 采集 Node、CodeBuddy 配置、终端编码、Git 与 Transcript 状态，执行物理路径真实存在性校验。

### 接口定义
```typescript
export function runDoctor(options?: { cwd?: string }): DoctorReport;
export function printDoctorReport(report: DoctorReport, isJson?: boolean, options?: { cwd?: string }): void;
```

### 诊断项分类 (Checks Categories)
1. `node`: Node.js 版本（$\ge 18$）、架构与可执行文件路径。
2. `codebuddy`: `CODEBUDDY_HOME`、`settings.json` 与 `statusLine.command` 指向的目标物理文件存在性校验（含 shim 转发路径）。
3. `codebuddy / hostRefreshProtocol`: 宿主事件驱动刷新架构契约说明（长任务期间宿主不派发更新属正常现象）。
4. `terminal`: Windows 代码页（`chcp 65001`）、Unicode 支持与明暗色调。
5. `terminal / windowsPathNormalization`: Windows 路径大小写规范化检查。
6. `git`: Git PATH 可达性、当前仓库分支与探测延迟。
7. `transcript`: 遥测状态目录创建与可写性校验，并回显错误日志路径。

命令路径在 POSIX 下按原样与 shell 反转义两种形式校验；Windows 只按字面路径校验，保留 UNC 与 `\$`，避免把不存在的路径反转义成另一个有效文件。引号内尾反斜杠造成分词歧义时回退非转义分词。

---

## 19. `runtime/theme-selector.js` — 交互式主题选择器

**职责：** 终端 Raw 模式下方向键交互式选择主题，实时动态刷新 ANSI 看板预览，退出时释放 stdin 句柄。

### 接口定义
```typescript
export function selectThemeInteractive(opts?: { initialTheme?: string; config?: ResolvedConfig }): Promise<string | null>;
export function saveUserTheme(themeName: string): string;
export function getActiveThemeName(): string;
export function renderThemePreview(themeName: string, mode?: 'dark' | 'light'): string[];
export function printThemesList(config?: ResolvedConfig): void;
export const THEMES: Array<{ name: string; label: string }>;
```

界面文案（列表标题、用法提示、选择器标题/快捷键提示、预览框标题）通过 `lang.js` 字典输出，`config.language` 生效；预览框顶边按显示宽度（CJK 双列）计算，与底边对齐。

---

## 20. `runtime/uninstall.js` — 卸载还原与深度清理

**职责：** 从首次备份仅还原非本 HUD 的 `statusLine`（且仅当当前 `statusLine` 仍指向本 HUD；用户装后替换或删除的项保留）——备份记录的命令含 `codebuddy-hud` 时（更早的安装副本或 `npm link` 全局 shim）改为移除 settings 中的该项，消除「报告卸载成功而 HUD 仍生效」；保留其他 settings 及用户主题配置；清理已部署的 `~/.codebuddy/skills/hud-config/` 技能目录/挂载；移除对应 runtime 的 Windows shim 与用户缓存；清理系统级 PATH 注册（从 Windows 用户注册表 Path 移除 runtime 目录，POSIX 移除 `~/.local/bin/codebuddy-hud` 软链接；沙箱测试模式下通过 `CODEBUDDY_HOME` 环境变量守卫自动跳过）。备份一经解析成功即回收，不依赖 settings 是否被写入；解析失败或写入失败时保留备份。

### 接口定义
```typescript
export function uninstall(options?: object): void;
export function stripBinDirFromUserPath(rawPath: string, binDir: string): { changed: boolean; value: string };
```
`stripBinDirFromUserPath()` 从原始 HKCU `Path` 值中移除 runtime bin 目录：比较前不展开 `%VAR%`，并按平台归一化（Windows 忽略大小写，去除包裹引号与路径尾分隔符），避免误删或漏删；写回时沿用原注册表值类型（保留 `REG_EXPAND_SZ`）。

---

## 21. `runtime/update-checker.js` — 用户主动更新与版本解析

**职责：** 为 `--update` 命令提供版本解析、比较与自举升级能力。是「渲染路径零网络」契约下唯一的联网入口：仅在用户显式调用 `--update` 时发起请求，无后台巡逻、无状态文件写入、无状态栏提示元素。

### 接口定义
```typescript
export function parseSemverDetail(v: string): { numbers: [number, number, number], prerelease: string[] };
export function compareVersions(v1: string, v2: string): -1 | 0 | 1;
export function getLocalVersion(): string | null;
export function getReleaseVersion(release: object): string | null;
export async function resolveLatestTag(options?: object): Promise<string>;
export function fetchLatestTagVia302(url: string): Promise<string>;
export function rawBaseForTag(tag: string): string;
export async function runUpdate(options?: object): Promise<{ ok: boolean, message: string, latest?: string, local?: string, bootstrapPath?: string }>;
```

### 关键契约
- **tag 单一形态**：`resolveLatestTag` 返回 GitHub 原始 ref（trim 后原样返回），下载 URL、子进程 `CODEBUDDY_HUD_VERSION`、比较与消息全程原样使用（`compareVersions` 自兼容 `v` 前缀）——不存在第二种归一化形态，结构上杜绝混用导致的 raw 404 与双前缀。
- **getLocalVersion**：读 runtime 上级 `package.json`；不可读返回 `null`（不伪造版本），此时 `runUpdate` 提示重跑安装脚本。
- **tag 解析三级策略（resolveLatestTag）**：显式 `CODEBUDDY_HUD_LATEST_RELEASE_URL`（兼容旧名 `CODEBUDDY_HUD_REMOTE_PKG_URL`）→ `github.com/releases/latest` 302 Location（免 API 限流）→ `api.github.com` REST 兜底（仅直连 host 附带 `GITHUB_TOKEN/GH_TOKEN`，镜像不带）；超时 8s。
- **白名单校验（rawBaseForTag）**：tag 必须匹配 `^v?\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$` 才允许拼入下载 URL，拒绝路径注入。
- **环境变量**：`CODEBUDDY_HUD_MIRROR`（镜像前缀，语义与 bootstrap.js 一致：镜像候选优先、直连兜底）、`CODEBUDDY_HUD_BOOTSTRAP_URL`（覆盖 bootstrap 下载源）、`CODEBUDDY_HUD_VERSION`（派生子进程时钉住 tag，bootstrap 免二次解析）、`CODEBUDDY_HUD_LATEST_RELEASE_URL`（兼容旧名 `CODEBUDDY_HUD_REMOTE_PKG_URL`，覆盖 Latest Release 查询 URL）。
- **自举升级流程（runUpdate）**：解析原始 ref 并预校验 tag 形态（畸形即失败，不落入假 "up to date"）→ 落后判定（`compareVersions > 0`，自兼容 `v` 前缀）→ 下载该原始 ref 的 `scripts/bootstrap.js` 至 `os.tmpdir()` → detached 派生 `node <tmp> --delay-start`（`stdio: 'inherit'`，`windowsHide`，`CODEBUDDY_HUD_VERSION` 钉原始 ref）；bootstrap 延迟 1s 等父进程完全退出后再原子重装 runtime，规避 Windows 文件锁。`--update` 分支恒 `exit 0`，失败信息走 stderr。

---

## 22. `scripts/bootstrap.js` — 跨平台原子安装引导

**职责：** 支持本地与 GitHub Raw 远程安装，通过临时目录 `.tmp-<pid>` + 原子重命名完成覆盖。本地安装直接复制仓库文件；远程安装解析 Release 的 `tag_name` 后从对应不可变 tag 下载。下载源优先级：`CODEBUDDY_HUD_RAW_BASE` → `CODEBUDDY_HUD_VERSION` → Latest Release 查询；前两者跳过查询。`CODEBUDDY_HUD_MIRROR` 为默认 GitHub URL 加镜像前缀，查询失败可回退直连，runtime 文件经镜像下载。`--delay-start` 延迟 1s 开始重装，供 `--update` 等待父进程退出以规避 Windows 文件锁。

### 核心导出与内部函数
- `install(): Promise<void>`: 核心安装入口，支持本地复制与远端下载，通过临时目录 + 原子重命名完成安装。
- `getTargetDir(): string`: 返回运行时目标安装目录路径（受 `CODEBUDDY_HUD_DIR` 环境变量影响）。
- `checkNodeVersion(): void`: 校验当前 Node.js 版本 ≥18；不满足时向 stderr 打印错误并 `process.exit(1)`（不抛异常，调用方无法 catch）。
- `rawBaseForTag(tag: string): string`: 返回指定 Release tag 的 GitHub Raw 基础地址。
- `resolveRemoteRawBase(options?: object): Promise<string>`: 解析 `CODEBUDDY_HUD_RAW_BASE`、`CODEBUDDY_HUD_VERSION` 或 Latest Release 后的下载源（含 `CODEBUDDY_HUD_MIRROR` 前缀）。
- `fetchLatestTagVia302(url?: string): Promise<string>`: 从 `releases/latest` 的 302 `Location` 解析不可变 tag；省略 `url` 时使用镜像前缀后的默认地址。
- `fetchLatestRelease(options?: { candidates302?: string[]; apiCandidates?: string[] }): Promise<object>`: 显式 `CODEBUDDY_HUD_LATEST_RELEASE_URL`（兼容旧名 `CODEBUDDY_HUD_REMOTE_PKG_URL`，两者同设时新名优先）独占查询，按原 URL 请求，失败即报错；未设置时才按 302 候选链 → API 候选链解析。
- `fetchUrlWithRetry(url: string, maxAttempts?: number): Promise<Buffer>`: 内部辅助实现（未在 module.exports 导出），网络下载重试包装（默认 3 次，1s/2s 指数退避）。
- `mirrorPrefix(): string`: 解析 `CODEBUDDY_HUD_MIRROR` 环境变量并归一化为 URL 前缀。

---

## 23. `scripts/run-tests.js` — 跨平台测试分发驱动

**职责：** `npm test` 底层执行驱动。遍历 `tests/unit/` 目录下全部 `*.test.mjs` 单元测试文件的绝对路径，直接向 `node --test` 喂入全量文件参数，彻底规避 Node 18/20 glob 在 Windows 路径反斜杠下的跨平台匹配陷阱与 `MODULE_NOT_FOUND` 假阳性。额外 CLI 参数会原样转发给 `node --test`（例如 `npm test -- --test-name-pattern=...`）。

---

## 24. `scripts/verify-display.js` — 看板端到端验证

**职责：** 执行 `npm run verify` 的 10 个 CLI、payload 与边界场景，验证看板行数（严格 $\le 3$ 行）、命令形态与容错契约。

---

## 25. `scripts/verify-install.js` — 隔离宿主生命周期验证

**职责：** 执行 `npm run verify:install`，在全隔离的临时沙箱中验证真实环境下的安装与卸载闭环。必须同时三重隔离 `CODEBUDDY_HOME`、`CODEBUDDY_SETTINGS_PATH` 与运行时目录，防止测试执行污染或误删工作区开发中的真实 `.cmd` shim。

---

## 26. `scripts/install.ps1` & `install.sh` — 一键在线安装脚本

**职责：** 面向终端用户的零配置一键安装管道。
- `scripts/install.ps1` (PowerShell)：支持 `CODEBUDDY_HUD_MIRROR` 代理；通过注册表 API 读写 HKCU `Path` 追加 runtime bin 目录（保留 `%VAR%` 间接引用，不破坏 `REG_EXPAND_SZ`）；从 master 下载 `bootstrap.js` 执行部署（runtime 版本由 bootstrap 后续解析并固定到 Release tag）。支持 `CODEBUDDY_HUD_NO_PATH=1` 跳过 PATH 修改。
- `scripts/install.sh` (POSIX Shell)：支持 macOS 与 Linux；当用户 PATH 包含 `~/.local/bin` 时自动创建指向 runtime bin 的软链接；支持 `CODEBUDDY_HUD_MIRROR` 镜像前缀下载与部署，支持 `CODEBUDDY_HUD_NO_PATH=1` 跳过 PATH 修改。

---

## 27. `skills/hud-config/SKILL.md` — HUD 配置技能

**职责：** 为 AI Agent 提供主题、图标与显示项配置的交互式引导，并将选择写入项目或全局 `codebuddy-hud.config.json`。
