# CodeBuddy HUD

[![Node.js >=18](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![npm dependencies](https://img.shields.io/badge/npm%20dependencies-0-2ea44f)](#安装)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#许可证)

> CodeBuddy Code 的实时终端 statusLine HUD。每次会话刷新后，它在终端底部展示当前模型、上下文、Token、缓存命中、代码变更、会话 Credits 与任务进度。
>
> 不需要 `npm install`，不会因为 HUD 出错而中断 CodeBuddy。仅在后台发起匿名轻量版本更新检查（24h/次，静默），不收集或上传任何代码与会话数据。

[GitHub 项目](https://github.com/XisFool/codebuddy-hud) · [安装](#安装) · [主题换肤](#主题换肤) · [验证](#验证) · [诊断](#诊断) · [卸载](#卸载)

---

## 显示效果

```text
DeepSeek V4 Flash ⚡max  │  main*  │  my-project  │  default
Token 250.1k (in: 249k · out: 1.1k)  │  249k/1M [███░░░░░░░] 25%  │  cache 96.8%
Δ +1.7k -161  │  82.04 credits  │  ⏱ 2h47m (API: 1h23m)
◐ Edit: parser.js  │  ✓ Read ×3  ✓ Grep ×2
```

### 四行布局

- **第 1 行：当前环境**。模型、推理强度、Git 分支、项目目录和权限模式。
- **第 2 行：上下文资源**。本次上下文的输入/输出 Token、上下文进度和当前轮次缓存命中率。
- **第 3 行：会话进度**。代码新增/删除、当前会话 Credits、总耗时与 API 耗时。
- **第 4 行：正在做什么（按需出现）**。宿主提供子代理、任务或工具活动时，置前高亮正在执行的工具（如 `◐ Edit: parser.js`），并聚合展示本轮已完成工具频次（如 `✓ Read ×3  ✓ Grep ×2`）。

没有对应数据的行或片段会自动隐藏。HUD 最多输出 4 行。

> CodeBuddy Code v2.146.0 实测仅显示命令输出的前 3 行，因此该宿主中的第 4 行工具活动不可见。直接运行 HUD 可查看完整输出。宿主在会话事件后约 300ms 去抖刷新，空闲时不会周期重刷。


支持 Unicode 的终端会显示 `Δ`、`█` 与暗灰 `░` 进度条；不支持时自动使用 `[D]`、`#`、`-` 等 ASCII 回退，不会显示乱码。Markdown 代码块不保留 ANSI 颜色，实际终端中的填充部分会按阈值显示绿色、黄色或红色。

---

## 一键极速安装（推荐）

### Windows (PowerShell)
```powershell
irm https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/install.ps1 | iex
```

### Linux / macOS (Bash)
```bash
curl -fsSL https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/install.sh | bash
```

---

## 手动从源码安装

前提：已安装 **Node.js >= 18**，并且本机已使用 CodeBuddy Code。

### Windows PowerShell 或 cmd.exe

```powershell
git clone https://github.com/XisFool/codebuddy-hud.git
cd codebuddy-hud
node runtime/bin/codebuddy-hud.js --setup
npm link  # 推荐：注册全局 codebuddy-hud 命令，方便在任意目录下换肤
```

### Linux、macOS 与 WSL

```sh
git clone https://github.com/XisFool/codebuddy-hud.git
cd codebuddy-hud
node runtime/bin/codebuddy-hud.js --setup
npm link  # 推荐：注册全局 codebuddy-hud 命令，方便在任意目录下换肤
```

安装器会：

1. 写入 CodeBuddy `settings.json` 的 `statusLine.command`。
2. 首次覆盖已有 statusLine 前，备份原 settings 为 `settings.json.bak.codebuddy-hud`。
3. 在 Windows 生成本机专用的 `runtime/bin/codebuddy-hud.cmd`。

重新运行 `--setup` 是安全的：它会修复路径和 Windows Node 版本变更，但不会覆盖第一次安装留下的原始 settings 备份。

安装器接受 BOM、JSONC 注释和尾逗号，保留字段值并写成标准 JSON；注释和原排版不会保留在写回文件中，首次备份保留原始文本。卸载成功后会移除已使用的备份。

> Windows 的 `.cmd` shim 内含安装时的 Node 绝对路径，因此从 GUI 启动的 CodeBuddy 不依赖当前终端的 `PATH`。不要从其他电脑复制这个文件；切换 nvm、fnm、Volta 的 Node 版本后重新执行 `--setup`。

> CodeBuddy Code v2.146.0 的 Windows 启动器存在引号二次转义问题。当前安装器会对安全 ASCII 路径省略引号；使用该宿主时建议将仓库放在类似 `D:\tools\codebuddy-hud` 的路径。含空格、Unicode 或 shell 特殊字符的安装路径仍可能无法通过宿主启动链。

---

## 验证

安装完成后，先在仓库目录运行：

```bash
node runtime/bin/codebuddy-hud.js --status
```

它应输出示例 HUD。随后新开或刷新一个 CodeBuddy Code 会话，HUD 会出现在终端底部。

也可以检查 `settings.json` 是否已包含 `statusLine`：

```powershell
Get-Content "$env:USERPROFILE\.codebuddy\settings.json"
```

```sh
cat "$HOME/.codebuddy/settings.json"
```

默认 settings 路径：

| 平台 | 默认路径 |
| --- | --- |
| Windows | `%USERPROFILE%\.codebuddy\settings.json` |
| Linux / macOS / WSL | `$HOME/.codebuddy/settings.json` |

settings 会保存安装时的仓库和 Node 绝对路径。因此仓库被移动、删除，或者 Node 安装路径变化后，只需回到仓库重新执行 `--setup`。

---

## 主题换肤

`codebuddy-cli-hud` 内置 5 套经典 ANSI 主题，支持暗/亮色自适应与全局/项目级配置：

| 主题名称 | 风格定位 | 主色调 |
| --- | --- | --- |
| `ocean`（默认） | 深海青蓝 | 青蓝科技风，高可读性 |
| `emerald` | 翡翠绿 | 清新护眼，自然舒适 |
| `cyberpunk` | 赛博朋克 | 炫酷粉紫 + 荧光青 |
| `amber` | 琥珀金 | 沉稳金黄，复古终端 |
| `monochrome` | 黑白极简 | 经典终端灰白 |

### 交互式“所见即所得”实时预览

在任意终端运行以下命令，使用方向键 `↑` / `↓` 移动光标，屏幕下方将**实时动态渲染**出该主题的真实 ANSI 彩色看板效果，按 `Enter` 即可一键保存：

```bash
codebuddy-hud --theme
```

### 命令行快速切换

```bash
# 切换为赛博朋克主题
codebuddy-hud --theme cyberpunk

# 查看所有主题列表与当前激活主题
codebuddy-hud --theme list
```

### 暗/亮色自适应

HUD 会自动感知 CodeBuddy 全局主题配置与终端背景环境变量（`COLORFGBG`）。在浅色/白底终端下，HUD 会自动启用高对比度深色阶，杜绝文本看不清问题。

---

## 诊断与环境检查

### 运行内置环境体检器 (`--doctor`)

HUD 内置一键诊断工具，可全面排查 Node 版本、Settings 配置、终端编码、Git 耗时与 Transcript 日志权限：

```bash
codebuddy-hud --doctor
# 或者输出 JSON 结构（用于 Issue 报告）
codebuddy-hud --doctor --json
```

### 没有看到 HUD

最常见原因是 `statusLine.command` 指向了已移动的仓库或旧 Node 路径。进入仓库后重新执行：

```bash
node runtime/bin/codebuddy-hud.js --setup
```

若手动 `--status` 正常但宿主仍无 HUD，检查 `runtime/bin/codebuddy-hud.cmd` 是否存在，并核对上面的 Windows 路径限制。恢复入口后，在原会话发一条消息触发刷新。`--status` 只验证 HUD 渲染，不会验证宿主启动器。

### Unicode 图标或进度条乱码 / 强制切换

强制使用 ASCII（兼容纯文本终端）：

```powershell
$env:CODEBUDDY_HUD_FORCE_ASCII = '1'
```

```sh
export CODEBUDDY_HUD_FORCE_ASCII=1
```

强制启用 Unicode（在支持 UTF-8 的终端强制开启）：

```powershell
$env:CODEBUDDY_HUD_FORCE_UNICODE = '1'
```

```sh
export CODEBUDDY_HUD_FORCE_UNICODE=1
```

也可以删除 CodeBuddy 根目录中的 `codebuddy-hud-cache-state.json` 后重新打开会话，让 HUD 重新检测终端编码。

### Credits 未显示或看起来不是账号总消费

Credits 只针对当前 `transcript_path`，不是账户历史总消费。请确认 transcript 中包含数值型 `providerData.rawUsage.credit`；没有 `transcript_path` 时，HUD 无法读取 transcript 累计值。

### `/clear` 后 Diff 或计时没有重置

等待下一次 statusLine 刷新。HUD 通过 `session_id` 变化、上下文累计回退或当前上下文回到初始小值识别清空边界。若宿主不提供任何这些边界信号，HUD 会保留原始统计，避免把正常上下文压缩误判为 `/clear`。

### HOME、settings 或状态目录不可写

HUD 会静默降级并保持 CodeBuddy 正常运行。若要完成安装或保存状态，请把 `CODEBUDDY_HOME` 或 `CODEBUDDY_SETTINGS_PATH` 指向可写位置。

---

## 卸载

在仓库目录执行：

```bash
node runtime/bin/codebuddy-hud.js --uninstall
```

卸载器只从首次备份恢复 `statusLine` 字段，保留安装后新增的其他 settings。没有可用备份时，仅移除本项目写入的 statusLine。HUD 缓存、Credits checkpoint、会话统计基线和 Windows `.cmd` shim 会被清理；用户主题配置 `codebuddy-hud.config.json` 会保留。配置写入失败时保留备份以便恢复。

---

## 配置（可选）

默认配置已经适合日常使用。需要按项目调整时，在项目根目录创建 `codebuddy-hud.config.json`：

```json
{
  "theme": "cyberpunk",
  "themeMode": "auto",
  "display": {
    "showToolActivity": true,
    "showCacheHitRate": true,
    "showDiffStats": true,
    "unicode": "auto"
  }
}
```

| 配置 | 类型 / 默认值 | 作用 |
| --- | --- | --- |
| `theme` | `string` / `"ocean"` | 主题名称（`"ocean"`、`"emerald"`、`"cyberpunk"`、`"amber"`、`"monochrome"`）或自定义调色对象。 |
| `themeMode` | `string` / `"auto"` | 模式自适应（`"auto"`、`"dark"`、`"light"`）。 |
| `display.showTokenBar` | `boolean` / `true` | 显示或隐藏 Token 与上下文进度条。 |
| `display.showDiffStats` | `boolean` / `true` | 显示或隐藏代码变更统计（Line 3）。 |
| `display.showCost` | `boolean` / `true` | 显示或隐藏 Credits / 成本消费（Line 3）。 |
| `display.showDuration` | `boolean` / `true` | 显示或隐藏总耗时与 API 耗时（Line 3）。 |
| `display.showCurrentDir` | `boolean` / `true` | 显示或隐藏当前目录名（Line 1）。 |
| `display.showGitBranch` | `boolean` / `true` | 显示或隐藏 Git 分支名与脏标记（Line 1）。 |
| `display.showPermissionMode` | `boolean` / `true` | 显示或隐藏权限模式（Line 1）。 |
| `display.showVersion` | `boolean` / `false` | 显示或隐藏宿主版本号（Line 1）。 |
| `display.showAgentStatus` | `boolean` / `true` | 显示或隐藏子代理与任务队列（Line 4）。 |
| `display.showToolActivity` | `boolean` / `true` | 显示或隐藏最近工具活动与聚合频次（Line 4）。 |
| `display.toolActivityTailBytes` | `number` / `16384` | transcript 回扫初始滑窗字节数。 |
| `display.progressBarWidth` | `number` / `10` | 上下文进度条字符宽度。 |
| `display.maxLines` | `number` / `4` | 最大输出行数（结构上限 ≤4 行）。 |
| `display.unicode` | `string|boolean` / `"auto"` | `"auto"`、`true` 或 `false`。 |
| `display.useNerdFonts` | `boolean` / `false` | 设为 `true` 时使用 Nerd Fonts 图标。 |
| `thresholds` | `object` | 上下文使用率进度条颜色阈值，默认 `{ "warning": 0.7, "critical": 0.9 }`。 |
| `cacheHitThresholds` | `object` | Cache 命中率四级色阶阈值，默认 `{ "excellent": 80, "partial": 50 }`。 |
| `defaultEffortLevel` | `string` / `"medium"` | 默认思考推理强度兜底（`"low"`, `"medium"`, `"high"`, `"xhigh"`, `"max"`, `"ultracode"`）。 |
| `language` | `string` / `"en"` | HUD 界面语言（`"en"` 英文、`"zh"` 中文）。 |

无论怎样配置，HUD 都不会超过 4 行。


---

## 数据口径

### Token 与 cache

`Token` 显示的是当前 `context_window.current_usage` 的输入和输出，不是整个会话累计。上下文进度条也使用当前上下文数据，因此不会出现累计 Token 与进度百分比不一致的情况。

`cache` 优先使用 transcript 中当前对话轮次的 provider telemetry 聚合计算。遥测缺失时显示 `cache --`，不会把未知状态伪装成 0%。

### Diff 与耗时

`Δ +N -M`、总耗时和 API 耗时都代表当前逻辑会话。执行 `/clear` 后，HUD 识别到会话边界时会从零开始统计。

### Credits

Credits 是当前 `transcript_path` 对应会话的**累计实际消费**：它汇总所有合法的 `providerData.rawUsage.credit`，不是模型倍率、不是单轮消费、也不是整个用户历史的总额。

- `credit: 0` 会被保留为真实零消费。
- 缺失、负数、字符串、`NaN` 和无限值不会计入。
- 每个 transcript 独立累计；新 transcript 即新会话。
- 有有效 transcript credit 时，优先显示它，而不是 payload 的美元估值。
- 重建累计值采用约 100ms 的分块扫描预算。尚未扫描完成时暂时隐藏 Credits，下一次事件刷新继续扫描；不会把已扫描部分显示为会话总额。
- 没有 `transcript_path` 时，只能回退使用 payload 明示的 `cost.credits`。

---

## 高级路径与环境变量设置

默认 CodeBuddy 根目录为 `~/.codebuddy`。需要隔离测试、便携安装或排障时，可以使用：

这些变量只隔离配置与状态目录。安装或卸载仍会操作所调用 runtime 旁的 Windows shim；自动化验证请使用 `npm run verify:install`，它会同时复制 runtime 到临时目录。

| 变量 | 用途 |
| --- | --- |
| `CODEBUDDY_HOME` | 覆盖 CodeBuddy 根目录；HUD 缓存与 transcript 状态放在其中。 |
| `CODEBUDDY_SETTINGS_PATH` | 直接指定 `settings.json`，优先级高于 `CODEBUDDY_HOME`。 |
| `CODEBUDDY_HUD_FORCE_ASCII` | 设为 `1` 时强制使用 ASCII 字符，禁用 Unicode 图标与进度条。 |
| `CODEBUDDY_HUD_FORCE_UNICODE` | 设为 `1` 时强制开启 Unicode 图标与进度条。 |

PowerShell：

```powershell
$env:CODEBUDDY_HOME = 'D:\temp\codebuddy-home'
node runtime/bin/codebuddy-hud.js --setup
```

Bash、zsh 或 WSL：

```sh
export CODEBUDDY_HOME="/tmp/codebuddy-home"
node runtime/bin/codebuddy-hud.js --setup
```

---

## 隐私、兼容性与限制

- 仅在后台发起匿名轻量版本更新检查（每 24 小时最多一次，静默 HTTPS 拉取 `package.json` 版本号），不收集或上传任何代码、会话或用户数据。不读取 transcript 以外的会话内容。
- 所有输出到终端的外部文本都会经过 `sanitizeTerminalText()`；ANSI/OSC 注入、控制字符和 bidi/RTL 控制字符会被移除。
- Credits checkpoint 和会话基线只保存在本机 CodeBuddy 根目录。缓存损坏、文件截断或状态不可写时会自动降级，不会中断 HUD。
- Windows、Linux、macOS、WSL 均有运行时支持；宿主 v2.146.0 的 Windows 引号限制见安装说明。
- 配置写入保留现有 POSIX 权限并跟随有效符号链接；新配置及首次备份默认 `0600`。多硬链接配置不做原子替换，以免悄悄断开链接关系。
- 单次运行目标小于 1500ms，所有内部异常静默处理并以 exit code `0` 结束。
- 特别巨大的单条 transcript 记录可能使较早的工具活动或当前轮 cache telemetry 不可见；HUD 会省略该段或回退到 payload。

---

## 许可证

MIT
