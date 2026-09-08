# CodeBuddy HUD 模块 API 参考手册 (Module Reference)

> **版本：** `v0.2.0+`  
> **根路径：** 所有模块相对路径均以仓库根目录或 `~/.codebuddy/codebuddy-hud-runtime/` 为基准。

---

## 📑 模块目录索引

1. [`runtime/bin/codebuddy-hud.js` — CLI 统一入口与执行调度器](#1-runtimebincodebuddy-hudjs--cli-入口与执行调度器)
2. [`runtime/parser.js` — 宿主输入 JSON 解析与边界清洗](#2-runtimeparserjs--宿主输入解析与边界清洗)
3. [`runtime/config.js` — 多层配置合并与主题调色板引擎](#3-runtimeconfigjs--多层配置合并与主题引擎)
4. [`runtime/renderer.js` — 3 行看板装配与布局编排器](#4-runtimerendererjs--3-行看板装配与布局编排)
5. [`runtime/renderer/format.js` — 格式化、进度条与 Cache 徽标](#5-runtimerendererformatjs--格式化进度条与-cache-徽标)
6. [`runtime/renderer/diff-render.js` — 代码变更、Credits 与耗时渲染器](#6-runtimerendererdiff-renderjs--代码变更credits-与耗时渲染)
7. [`runtime/renderer/agents-render.js` — 工具活动频次聚合渲染器](#7-runtimerendereragents-renderjs--工具活动聚合渲染)
8. [`runtime/lang.js` — 多语言国际化字典与探测器](#8-runtimelangjs--多语言国际化)
9. [`runtime/transcript.js` — 逆向滑窗遥测与增量 Checkpoint 状态机](#9-runtimetranscriptjs--逆向滑窗遥测与-checkpoint-状态机)
10. [`runtime/session-stats.js` — 会话基线捕获与 `/clear` 重置状态机](#10-runtimesession-statsjs--会话基线与-clear-重置状态机)
11. [`runtime/git.js` — Git 分支与 Dirty 状态非阻塞探测器](#11-runtimegitjs--git-分支与状态探测器)
12. [`runtime/encoding.js` — 终端字符集探测与 Windows 代码页缓存](#12-runtimeencodingjs--终端字符集探测与编码缓存)
13. [`runtime/sanitize.js` — 终端文本安全清洗与 ANSI/Bidi 注入防御](#13-runtimesanitizejs--终端文本安全清洗器)
14. [`runtime/paths.js` — 跨平台路径解析与状态目录管理](#14-runtimepathsjs--跨平台路径解析与目录管理)
15. [`runtime/settings-file.js` — JSONC 安全解析与配置原子写入](#15-runtimesettings-filejs--jsonc-安全解析与配置原子写入)
16. [`runtime/statusline-installer.js` — 状态栏注册与 Windows Shim 烘焙器](#16-runtimestatusline-installerjs--状态栏注册与-shim-烘焙)
17. [`runtime/doctor.js` — 环境体检与排障诊断子系统](#17-runtimedoctorjs--环境体检与排障诊断)
18. [`runtime/update-checker.js` — 24h 异步更新检查与防惊群预占位锁](#18-runtimeupdate-checkerjs--异步更新检查与防惊群锁)
19. [`runtime/theme-selector.js` — 交互式终端主题选择器](#19-runtimetheme-selectorjs--交互式主题选择器)
20. [`runtime/uninstall.js` — 卸载还原与状态深度清理器](#20-runtimeuninstalljs--卸载还原与深度清理)
21. [`scripts/bootstrap.js` — 跨平台原子安装引导程序](#21-scriptsbootstrapjs--跨平台原子安装引导)
22. [`scripts/run-tests.js` — 跨平台测试分发驱动脚本](#22-scriptsrun-testsjs--跨平台测试分发驱动)
23. [`scripts/verify-display.js` — 看板端到端验证](#23-scriptsverify-displayjs--看板端到端验证)
24. [`scripts/verify-install.js` — 隔离宿主生命周期验证](#24-scriptsverify-installjs--隔离宿主生命周期验证)
25. [`skills/hud-config/SKILL.md` — HUD 配置技能](#25-skillshud-configskillmd--hud-配置技能)

---

## 1. `runtime/bin/codebuddy-hud.js` — CLI 入口与执行调度器

**职责：** 状态栏执行入口，注册为 `statusLine.command`。负责命令行参数分发、stdin 管道超时竞争、顶层错误捕获、自然 Drain 退出与后台更新派生。

### 命令行参数支持 (CLI Flags)
- `--setup`: 执行安装，写入 `settings.json` 并生成 Windows `.cmd` shim。
- `--uninstall`: 仅恢复备份中的 `statusLine`，清理缓存及 shim，保留其他 settings 与用户主题配置。
- `--theme [name]`: 交互式切换或指定设置主题（如 `--theme cyberpunk`、`--theme list`）。
- `--doctor` / `-d`: 运行环境健康体检（支持 `--json` 输出结构化报告）。
- `--status`: 输出当前 HUD 静态看板样例（用于健康探测）。

### 关键常量 (Constants)
```javascript
const TIMEOUT_MS = 800;          // Stdin 安全超时，预留 700ms 给渲染与 stdout 刷新
const LOG_MAX_BYTES = 1024 * 1024; // 错误日志 1MB 自动轮转上限
const MAX_STDIN_SIZE = 1024 * 1024;// Stdin 接收上限 1MB（stdin 管道分支内的局部常量）
```

### 错误与退出契约 (Design Decisions & Why)
- **Why `process.stdout.on('error', () => {})`?**  
  当宿主因超时或快速切屏提前杀掉接收管道时，Node.js 会向 stdout 发送异步 `EPIPE` 事件。未捕获会导致进程以 exit 1 崩溃并输出堆栈；静默捕获该错误是 CLI 工具在管道截断下的标准容灾手段。
- **Why Natural Event Loop Drain 代替 `process.exit(0)`?**  
  直接调用 `process.exit()` 会强制中断 libuv 未排空的 stdout 缓冲区，导致终端接收到半截 ANSI 字符。通过 `process.exitCode = 0` 并关闭 stdin 句柄，允许事件循环自然排空，保证字符完整刷出。

---

## 2. `runtime/parser.js` — 宿主输入解析与边界清洗

**职责：** 从 CodeBuddy 传入的原始 stdin JSON 字符串中安全提取会话、Token、变更与消费指标。

### 接口定义 (TypeScript Signatures)

```typescript
export function parseCodeBuddyInput(rawStdin: string | null | undefined): CodeBuddyPayload | null;

export function extractTokenData(cbData: CodeBuddyPayload): {
  inTokens: number;
  outTokens: number;
  ctxSize: number;
  ctxPercent: number;
} | null;

export function extractDiffStats(cbData: CodeBuddyPayload): {
  linesAdded: number;
  linesRemoved: number;
};

export function extractCostData(cbData: CodeBuddyPayload): {
  totalCostUsd: number;
  totalDurationMs: number;
  apiDurationMs: number;
} | null;
```

### 数据结构 Shape
```javascript
// CodeBuddyPayload 基础形态
{
  model?: { id: string; display_name?: string },
  context_window?: {
    total_input_tokens?: number,
    total_output_tokens?: number,
    context_window_size?: number,
    used_percentage?: number,
    current_usage?: {
      input_tokens?: number,
      output_tokens?: number,
      cache_read_input_tokens?: number
    }
  },
  cost?: {
    total_cost_usd?: number,
    total_duration_ms?: number,
    total_api_duration_ms?: number,
    total_lines_added?: number,
    total_lines_removed?: number
  }
}
```

---

## 3. `runtime/config.js` — 多层配置合并与主题引擎

**职责：** 读取并深度合并各层配置，解析明暗主题调色板。

### 接口定义
```typescript
export function loadConfig(cwd?: string): ResolvedConfig;
export function deepMerge<T extends object>(target: T, source: object, depth?: number): T;
export function resolveTheme(config: ResolvedConfig): ThemePalette;
export function detectThemeMode(config: ResolvedConfig): 'dark' | 'light';
```

### 内置主题预设 (THEME_PRESETS)
- `ocean` (默认): 深海青蓝科技风 (dark: `cyan`/`gray`, light: `blue`/`gray`)
- `emerald`: 翡翠绿清新护眼 (dark: `green`/`gray`/`cyan`, light: `green`/`gray`/`blue`)
- `cyberpunk`: 赛博朋克炫酷粉紫+荧光青 (dark: `magenta`/`cyan`, light: `magenta`/`blue`)
- `amber`: 琥珀金复古沉稳 (dark/light: `yellow`/`gray`)
- `monochrome`: 黑白极简经典终端 (dark/light: `gray`/`gray`)

### 安全机制 (Why)
`deepMerge()` 内部校验：
```javascript
if (key === '__proto__') continue;
```
严格阻断恶意配置文件通过伪造 `__proto__` 污染 V8 原型链。

---

## 4. `runtime/renderer.js` — 3 行看板装配与布局编排

**职责：** 核心布局引擎，协调各子渲染器装配 3 行看板，执行空行智能裁剪与终端安全转义。

### 接口定义
```typescript
export function renderHUD(
  cbData: CodeBuddyPayload | null,
  config?: ResolvedConfig
): string;
```

### 3 行输出排版规范
- **Line 1 (Identity)**: `[ModelName] [EffortIcon] │ [Branch*] │ [Workspace] │ [Permission] [UpdateBadge]`
- **Line 2 (Tokens)**: `Token 250.1k (in: 249k · out: 1.1k) │ 249k/1M [███░░░░░░░] 25% │ cache 96.8%`
- **Line 3 (Diff/Cost/Tools)**: `Δ +1.7k -161 │ 82.04 credits │ ⏱ 2h47m │ ◐ Edit: parser.js │ ✓ Read ×3` (全空自动隐藏)

---

## 5. `runtime/renderer/format.js` — 格式化、进度条与 Cache 徽标

**职责：** 基础文本格式化、用量进度条与 Prompt Cache 徽标渲染。

### 核心函数列表
- `formatTokens(num: number): string`: 格式化数字为 `1.2k`、`3.5M`。特别处理 `999.5` 边界防止四舍五入溢出为 `1000k`。
- `formatDurationMs(ms: number): string`: 格式化毫秒数为 `12s`、`5m20s`、`2h15m`。
- `createProgressBar(pct: number, width: number, thresholds: object, glyphs: object): string`: 生成自适应色阶进度条。
- `calculateTurnCacheMetrics(usageMetrics, currentUsage): TurnCacheMetrics`: 计算综合缓存命中率。
- `formatTurnCacheBadge(metrics, glyphs, config): string`: 渲染三态徽标：`cache 98.5%`、`cache --` 或空。

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
  legacyCreditSpend?: number | null
): string;

export function formatCreditSpend(creditSpend: number): string; // "82.04 credits"
```

---

## 7. `runtime/renderer/agents-render.js` — 工具活动聚合渲染

**职责：** 装配 Line 3 尾部的当前工具活动与本轮已完成工具调用频次聚合。

### 接口定义
```typescript
export function renderToolActivity(activity: ToolActivity, glyphs: GlyphSet): string;
```

### 工具聚合输出格式
```
✓ Edit ×3    ✓ View ×12    ◐ RunCommand: "npm test"
```

---

## 8. `runtime/lang.js` — 多语言国际化

**职责：** 提供集中化中英双语词典，自动探测系统环境语言并提供 `t()` 翻译辅助函数。

### 接口定义
```typescript
export function detectLanguage(config?: { language?: string }): 'zh' | 'en';
export function getI18n(config?: ResolvedConfig): {
  lang: 'zh' | 'en';
  t: (key: string, fallback?: string) => string;
  dict: Record<string, string>;
};
```

---

## 9. `runtime/transcript.js` — 逆向滑窗遥测与 Checkpoint 状态机

**职责：** 高性能逆向滑窗读取 `transcript.jsonl`，聚合当前轮次 API Usage，并以增量 Checkpoint 计算累计 Credits。

### 接口定义
```typescript
export function getTurnUsageMetrics(
  transcriptPath: string | null,
  opts?: { cwd?: string; tailBytes?: number }
): {
  hitTokens: number | null;
  promptTokens: number | null;
  credit: number | null;
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
  opts?: { cwd?: string; tailBytes?: number }
): {
  turnUsage: ReturnType<typeof getTurnUsageMetrics>;
  toolActivity: ReturnType<typeof getTurnToolActivity>;
};
```

`getTurnMetricsAndActivity()` 共享本轮 usage 和工具活动的逆向扫描。会话 Credits 另用前向 checkpoint 扫描，分块循环预算 100ms。`complete: false` 表示预算耗尽、短读或尾行尚未完成；此时累计值与调用数为 `null`，内部 checkpoint 仍可续扫。渲染层隐藏 Credits 并禁止 payload 兜底。

---

## 10. `runtime/session-stats.js` — 会话基线与 `/clear` 重置状态机

**职责：** 监控上下文与指标单调性，识别 `/clear` 场景并扣除历史基线。

### 接口定义
```typescript
export function getLogicalSessionCostData(
  cbData: CodeBuddyPayload,
  rawCostData: CostData,
  opts?: { statePath?: string }
): {
  linesAdded: number;
  linesRemoved: number;
  totalDurationMs: number;
  apiDurationMs: number;
};
```

---

## 11. `runtime/git.js` — Git 分支与状态探测器

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
```

正常缓存 TTL 为 10 秒，HEAD/index mtime 变化可提前失效；未暂存的工作树编辑可能延迟显示。`null` 表示 Git 超时后的未知脏状态。

---

## 12. `runtime/encoding.js` — 终端字符集探测与编码缓存

**职责：** 探测终端 Unicode/NerdFonts 支持，Windows 下自动探测 `chcp 65001` 并缓存。

### 接口定义
```typescript
export function supportsUnicode(): boolean;
export function selectGlyphs(useNerdFonts: boolean, unicodeSupported: boolean): GlyphSet;
export function resetCache(): void;
```

---

## 13. `runtime/sanitize.js` — 终端文本安全清洗器

**职责：** 剥离外部输入中的 ANSI CSI/OSC 控制序列、Unicode Bidi 伪装字符与 C0/C1 控制符。

### 接口定义
```typescript
export function sanitizeTerminalText(text: any, maxLen?: number): string;
```

---

## 14. `runtime/paths.js` — 跨平台路径解析与目录管理

**职责：** 统一定位 CodeBuddy 配置目录（优先支持 `CODEBUDDY_HOME` 与 `CODEBUDDY_SETTINGS_PATH` 环境变量），并提供跨平台文件哈希与状态路径解析。

### 核心路径查询函数
- `getCodeBuddyHome(): string`: 返回 `~/.codebuddy` 或覆盖路径。
- `getSettingsPath(): string`: 返回 `settings.json` 绝对路径。
- `getUserConfigPath(): string`: 返回 `codebuddy-hud.config.json` 路径。
- `getErrorLogPath(): string`: 返回 `codebuddy-hud-error.log` 路径。
- `getUpdateStatusPath(): string`: 返回 `codebuddy-hud-update-status.json` 路径。
- `getGitCachePath(): string`: 返回 `codebuddy-hud-git-cache.json` 路径。
- `getTranscriptUsageStateDir(): string`: 返回 `codebuddy-hud-usage-state/` 目录。
- `getTranscriptUsageStatePath(transcriptPath: string): string`: 按 transcript 绝对路径 SHA-256 哈希隔离的增量遥测 checkpoint 路径。
- `getSessionStatsStateDir(): string`: 返回 `codebuddy-hud-session-state/` 目录。
- `getSessionStatsStatePath(identity: string): string`: 按会话 identity 哈希隔离的基线状态路径。
- `getSessionStatsHandoffPath(cwd: string): string`: 会话 `/clear` 跨文件切换时的进程级 cost 累计交接状态路径（`handoff-<sha256(cwd)>.json`）。宿主 `/clear` 会产生新 transcript 文件，通过此 cwd 作用域文件在新旧 identity 之间交接基线，避免累计 Δ/⏱ 计数全额丢失。
- `getSessionEffortStatePath(transcriptPath: string): string`: 返回按 transcript 路径哈希寻址的会话 effort 状态文件 `codebuddy-hud-session-state/effort-<sha256>.json`。
- `normalizePlatformPath(p: string): string`: 平台感知路径归一化——Windows 下 resolve 后整体小写（消除盘符 `d:`/`D:` 哈希分裂），POSIX 保留大小写语义。

---

## 15. `runtime/settings-file.js` — JSONC 安全解析与配置原子写入

**职责：** 针对宿主 `settings.json` 进行安全读取、注释剥离、符号链接目标解析、原子写盘与权限保全。

### 接口定义
```typescript
export function parseSettingsJson(raw: string): object;
export function stripJsonComments(text: string): string;
export function atomicWriteSettingsFile(targetPath: string, content: string): void;
export function resolveWriteTarget(filePath: string): { realPath: string; stat: fs.Stats | null };
export function isSettingsObject(value: unknown): boolean;
export function writePrivateFileIfAbsent(filePath: string, content: string): boolean;
```

### 核心安全契约
- **严格保护字符串内容**：`stripJsonComments()` 仅剔除双引号字符串外的单行 `//` 与块级 `/* */` 注释，保留换行符与空格以确保 JSON 语法报错行号对齐；绝不误改字符串内部的路径或 URL。
- **符号链接解析跟随**：`resolveWriteTarget()` 循环解引用符号链接（上限 40 层防环），确保写操作直接作用于最终真实目标文件。
- **原子替换与硬链接保护**：通过临时文件（`.tmp-<pid>-<time>`）写入后执行 `fs.renameSync()` 原子替换；检测到硬链接数 `nlink > 1` 时主动拒绝原子替换，防止意外破坏硬链接。
- **POSIX 权限保全**：继承目标文件原有的 mode/uid/gid；新创建的配置文件与首次备份默认赋予严格的 `0600` 私有权限。

---

## 16. `runtime/statusline-installer.js` — 状态栏注册与 Shim 烘焙器

**职责：** 将 HUD 注册进 CodeBuddy `settings.json` 的 `statusLine` 配置项，并在 Windows 平台生成固化 Node 绝对路径的 `.cmd` shim 启动脚本。

### 接口定义
```typescript
export function setup(options?: {
  settingsPath?: string;
  runtimeDir?: string;
  platform?: string;
  nodeExe?: string;
}): void;

export function buildStatusLineCommand(platform: string, hudBin: string, nodeExe: string): string;
export function buildCmdShimContent(nodeExe: string, hudBin?: string): string;
```

### 关键机制
- **Windows Shim 路径固化与转义**：将安装时刻的 `process.execPath` 烘焙入 `.cmd` 启动器，路径中的 `%` 统一转义为 `%%` 阻断变量展开；在包含非 ASCII 字符时前置 `@chcp 65001 >nul`。
- **宿主引号容灾**：CodeBuddy Code v2.146.0 的 Windows containment 启动器存在二次转义字面引号的已知缺陷，纯 ASCII 安全命令路径直接省略外层引号。
- **无损配置恢复保障**：首次安装前将原始 `settings.json` 备份为 `settings.json.bak`（仅备份一次，永不覆盖老备份）。安装成功后通过 `settings-file.js` 以原子写入写回标准格式。

---

## 17. `runtime/doctor.js` — 环境体检与排障诊断

**职责：** 采集 Node、CodeBuddy 配置、终端编码、Git 与 Transcript 状态，执行物理路径真实存在性校验。

### 接口定义
```typescript
export function runDoctor(options?: { cwd?: string; env?: object }): DoctorReport;
export function printDoctorReport(report: DoctorReport, isJson?: boolean): void;
```

### 诊断项分类 (Checks Categories)
1. `node`: Node.js 版本（$\ge 18$）、架构与可执行文件路径。
2. `codebuddy`: `CODEBUDDY_HOME`、`settings.json` 与 `statusLine.command` 指向的目标物理文件存在性校验；宿主事件驱动刷新架构契约说明（长任务期间宿主不派发更新属正常现象）。
3. `terminal`: Windows 代码页（`chcp 65001`）、Unicode 支持、明暗色调与 Windows 路径大小写规范化状态。
4. `git`: Git PATH 可达性、当前仓库分支与探测延迟。
5. `transcript`: 遥测缓存目录读写权限与历史日志存在性。

---

## 18. `runtime/update-checker.js` — 异步更新检查与防惊群锁

**职责：** 后台非阻塞检查 GitHub 最新版本，前置预占位锁防并发进程爆炸。

### 接口定义
```typescript
export function checkForUpdates(options?: { force?: boolean }): Promise<UpdateStatus>;
export function spawnBackgroundUpdateCheck(): void;
export function compareVersions(v1: string, v2: string): 1 | -1 | 0;
export function parseSemver(v: string): [number, number, number];
```

网络失败保留最后一次有效更新信息，只刷新检查时间。spawn 前写 `lastCheck` 作为本地并发节流阀。

---

## 19. `runtime/theme-selector.js` — 交互式主题选择器

**职责：** 终端 Raw 模式下方向键交互式选择主题，实时动态刷新 ANSI 看板预览，退出时释放 stdin 句柄。

### 接口定义
```typescript
export function selectThemeInteractive(): Promise<string>;
export function printThemesList(): void;
```

---

## 20. `runtime/uninstall.js` — 卸载还原与深度清理

**职责：** 从首次备份仅还原 `statusLine`，保留其他 settings 及用户主题配置；移除对应 runtime 的 Windows shim 与用户缓存。有效备份在配置写入成功后才删除。

### 接口定义
```typescript
export function uninstall(options?: object): void;
```

---

## 21. `scripts/bootstrap.js` — 跨平台原子安装引导

**职责：** 支持本地与 GitHub Raw 远程安装，通过临时目录 `.tmp-<pid>` + 原子重命名完成无缝安装覆盖。默认从 GitHub Latest Release 读取 `tag_name`，再从对应不可变 tag 下载；`CODEBUDDY_HUD_VERSION` 可固定 tag。

### 核心函数
- `install(options?: object): Promise<void>`: 核心安装入口，支持本地复制与远端下载，通过临时目录 + 原子重命名完成安装。
- `getTargetDir(): string`: 返回运行时目标安装目录路径（受 `CODEBUDDY_HUD_DIR` 环境变量影响）。
- `checkNodeVersion(): void`: 校验当前 Node.js 版本 ≥18，不满足时抛出错误。
- `rawBaseForTag(tag: string): string`: 返回指定 Release tag 的 GitHub Raw 基础地址。
- `resolveRemoteRawBase(options?: object): Promise<string>`: 解析 `CODEBUDDY_HUD_RAW_BASE`、`CODEBUDDY_HUD_VERSION` 或 Latest Release 后的下载源。

---

## 22. `scripts/run-tests.js` — 跨平台测试分发驱动

**职责：** `npm test` 底层执行驱动。通过深度遍历搜集所有单元测试文件的绝对路径，直接向 `node --test` 喂入全量文件参数，彻底规避 Node 18/20 glob 在 Windows 路径反斜杠下的跨平台匹配陷阱与 `MODULE_NOT_FOUND` 假阳性。

---

## 23. `scripts/verify-display.js` — 看板端到端验证

**职责：** 执行 `npm run verify` 的 10 个 CLI、payload 与边界场景，验证看板行数（严格 $\le 3$ 行）、命令形态与容错契约。

---

## 24. `scripts/verify-install.js` — 隔离宿主生命周期验证

**职责：** 执行 `npm run verify:install`，在全隔离的临时沙箱中验证真实环境下的安装与卸载闭环。必须同时三重隔离 `CODEBUDDY_HOME`、`CODEBUDDY_SETTINGS_PATH` 与运行时目录，防止测试执行污染或误删工作区开发中的真实 `.cmd` shim。

---

## 25. `skills/hud-config/SKILL.md` — HUD 配置技能

**职责：** 为 AI Agent 提供主题、图标与显示项配置的交互式引导，并将选择写入项目或全局 `codebuddy-hud.config.json`。
