# CodeBuddy HUD

[![Node.js >=18](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![npm dependencies](https://img.shields.io/badge/npm%20dependencies-0-2ea44f)](#安装)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](#许可证)

> 专为 **CodeBuddy Code** 打造的实时终端 statusLine 看板。在终端底部以极简 3 行优雅呈现当前模型、Token 资源消耗、缓存命中、代码变更与实时工具活动。

- ⚡ **开箱即用 & 零依赖**：基于 Node.js 原生标准库开发，无需执行 `npm install`。
- 🛡️ **轻量稳定 & 永不中断**：执行耗时通常 <200ms，内部异常静默降级，绝不因看板报错中断 CodeBuddy 交互。
- 🎯 **真实遥测**：Token、Cache 命中率与 Credits 消费直接源自会话真实日志回溯，不虚构、不硬编码。
- 🎨 **自由换肤**：内置 5 套精致 ANSI 配色主题，支持交互式实时所见即所得预览与深浅色终端自适应。

[安装](#安装) · [显示效果](#显示效果) · [主题换肤](#主题换肤) · [配置指南](#配置指南) · [常见问题与排障](#常见问题与排障) · [卸载](#卸载) · [开发者文档](#开发者与深入参考)

---

## 显示效果

```text
DeepSeek V4 Flash ● max  │  main*  │  my-project  │  default
Token 250.1k (in: 249k · out: 1.1k)  │  249k/1M [███░░░░░░░] 25%  │  cache 96.8%
Δ +1.7k -161  │  82.04 credits  │  ⏱ 2h47m  │  ◐ Edit: parser.js  │  ✓ Read ×3  ✓ Grep ×2
```

### 三行紧凑布局

- **Line 1：运行环境** — 智能展示当前模型、推理强度（effort）、Git 分支与变更标记、当前项目目录及权限模式。
- **Line 2：Token 与缓存** — 本轮上下文 Token 消耗（输入/输出拆分）、图形化进度条与真实 Cache 命中率。
- **Line 3：产出与工具** — 当前会话代码变更增删量（`Δ +N -M`）、实际累计 Credits 消费、总耗时，以及置前高亮的当前工具状态（如 `◐ Edit: parser.js`）与本轮工具频次聚合（如 `✓ Read ×3  ✓ Grep ×2`）。

> **无感极简**：HUD 输出严格保持在 ≤3 行之内，无对应数据的行或片段自动隐藏，绝不遮挡主对话区。在不支持 Unicode 的终端自动平滑降级为 ASCII 字符，绝不乱码。

---

## 安装

### 方式一：一键极速安装（推荐）

无需手动克隆代码，复制以下命令并在终端中运行：

#### Windows (PowerShell)
```powershell
irm https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/install.ps1 | iex
```

#### Linux / macOS (Bash)
```bash
curl -fsSL https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/install.sh | bash
```

安装脚本会自动检测 Node.js 环境，将运行时安装至 `~/.codebuddy/codebuddy-hud-runtime/`，并安全配置 CodeBuddy `settings.json`（首次安装会自动备份原配置）。

> **安装成功后**：直接重启或新开一个 CodeBuddy Code 会话，终端底部即可实时看到 HUD！

---

### 方式二：从源码安装（开发者）

前提：本机已安装 **Node.js >= 18**。

```bash
git clone https://github.com/XisFool/codebuddy-hud.git
cd codebuddy-hud

# 执行安装并注册 statusLine
node runtime/bin/codebuddy-hud.js --setup

# 推荐：注册全局命令，方便随时换肤与排障
npm link
```

---

## 主题换肤

`codebuddy-hud` 内置 5 套精心调色的 ANSI 主题：

| 主题名称 | 风格定位 | 主色调 |
| :--- | :--- | :--- |
| `ocean`（默认） | 深海青蓝 | 清爽科技风，高对比度易读 |
| `emerald` | 翡翠绿 | 清新护眼，自然柔和 |
| `cyberpunk` | 赛博朋克 | 炫酷粉紫 + 荧光青 |
| `amber` | 琥珀金 | 沉稳金黄，复古终端质感 |
| `monochrome` | 黑白极简 | 经典灰白，纯粹无干扰 |

### 交互式“所见即所得”实时预览

运行主题选择器，使用方向键 `↑` / `↓` 移动，终端将**实时动态渲染**对应的 ANSI 看板效果，按 `Enter` 即可保存生效：

```bash
# 源码安装（或已执行 npm link）
codebuddy-hud --theme

# 一键安装用户（Windows）
& "$env:USERPROFILE\.codebuddy\codebuddy-hud-runtime\runtime\bin\codebuddy-hud.cmd" --theme

# 一键安装用户（Linux / macOS）
node "$HOME/.codebuddy/codebuddy-hud-runtime/runtime/bin/codebuddy-hud.js" --theme
```

> **小提示**：在 CodeBuddy 会话内，你也可以直接对 AI 助手说：`帮我更换 HUD 主题` 或输入 `/hud-config` 触发可视化配置。

### 命令行快捷切换

```bash
# 切换至赛博朋克主题
codebuddy-hud --theme cyberpunk

# 查看所有主题与当前激活状态
codebuddy-hud --theme list
```

### 深浅色终端自适应

HUD 会自动识别 CodeBuddy 全局主题与终端背景环境（`COLORFGBG`）。在浅色/白底终端下，自动切换至高对比度深色阶，彻底杜绝浅底看不清字的问题。

---

## 配置指南

默认配置已经适配绝大多数日常开发场景。若需要针对特定项目或全局个性化调整，可在项目根目录（或 `~/.codebuddy/` 目录）创建 `codebuddy-hud.config.json`：

```json
{
  "theme": "ocean",
  "themeMode": "auto",
  "display": {
    "showToolActivity": true,
    "showCacheHitRate": true,
    "showDiffStats": true,
    "showCost": true,
    "useNerdFonts": false,
    "unicode": "auto"
  },
  "language": "zh"
}
```

### 常用配置选项

| 配置项 | 类型 / 默认值 | 说明 |
| :--- | :--- | :--- |
| `theme` | `string` / `"ocean"` | 主题名称（`"ocean"`, `"emerald"`, `"cyberpunk"`, `"amber"`, `"monochrome"`） |
| `themeMode` | `string` / `"auto"` | 颜色自适应模式（`"auto"`, `"dark"`, `"light"`） |
| `language` | `string` / `"en"` | 界面语言（`"zh"` 中文、`"en"` 英文） |
| `display.showToolActivity` | `boolean` / `true` | 是否在第 3 行展示后台工具活动与调用频次 |
| `display.showCacheHitRate` | `boolean` / `true` | 是否展示 Prompt Cache 命中率 |
| `display.showDiffStats` | `boolean` / `true` | 是否展示本次会话代码修改增删量 |
| `display.showCost` | `boolean` / `true` | 是否展示当前会话 Credits 消费统计 |
| `display.showDuration` | `boolean` / `true` | 是否展示会话累计耗时 |
| `display.showTokenBar` | `boolean` / `true` | 是否展示 Token 消耗与进度条 |
| `display.useNerdFonts` | `boolean` / `false` | 是否开启 Nerd Fonts 矢量小图标（需终端字体支持） |
| `display.unicode` | `string` / `"auto"` | 图标字符集（`"auto"` 自动探测、`true` 强制 Unicode、`false` 纯 ASCII） |

---

## 常见问题与排障

### 1. 一键环境诊断体检（--doctor）
当状态栏未正常显示或怀疑环境配置有异常时，请运行内置体检器：

```bash
# 源码安装或已 link
codebuddy-hud --doctor

# 一键安装用户（Windows）
& "$env:USERPROFILE\.codebuddy\codebuddy-hud-runtime\runtime\bin\codebuddy-hud.cmd" --doctor

# 一键安装用户（macOS / Linux）
node "$HOME/.codebuddy/codebuddy-hud-runtime/runtime/bin/codebuddy-hud.js" --doctor
```
体检器会自动检查 Node 版本、配置文件语法、终端代码页编码、Git 耗时与日志访问权限。

### 2. 安装后没有看到 HUD 状态栏？
- **触发交互**：CodeBuddy Code 在空闲时不会主动重绘状态栏。请在会话中随便发送一条消息，触发事件去抖后状态栏即会呈现。
- **Windows 路径限制**：请尽量避免将仓库或运行时放在包含空格、引号或特殊字符的目录中，以免触发 Windows 启动链转义异常。

### 3. 终端出现乱码或进度条方块不正常？
HUD 会自动探测终端编码，但在部分 Windows 默认 GBK 终端中可能受限：
- **方案 A（推荐）**：在终端运行 `chcp 65001` 开启 UTF-8 支持；
- **方案 B（强制纯文本）**：设置环境变量 `$env:CODEBUDDY_HUD_FORCE_ASCII = '1'` (PowerShell) 或 `export CODEBUDDY_HUD_FORCE_ASCII=1` (Bash)。

### 4. Credits 显示为 `--` 或与账户总额不一致？
- Credits 显示的是**当前会话的实际累计消费**，不是账户历史总额。
- 当处于全新会话或当前模型服务商未返回费用遥测时，HUD 会优雅显示 `cache --` 或隐藏消费段，绝不伪造假数据。

### 5. 执行 `/clear` 后变更量与耗时没有重置？
HUD 具备会话重置识别机制。在执行 `/clear` 后，向 AI 发送下一条新指令时，HUD 会自动重置基线并重新开始统计。

---

## 卸载

如果你想卸载 HUD 并还原终端设置，执行以下命令即可：

```bash
# 源码安装
node runtime/bin/codebuddy-hud.js --uninstall

# 一键安装（Windows）
& "$env:USERPROFILE\.codebuddy\codebuddy-hud-runtime\runtime\bin\codebuddy-hud.cmd" --uninstall

# 一键安装（Linux / macOS）
node "$HOME/.codebuddy/codebuddy-hud-runtime/runtime/bin/codebuddy-hud.js" --uninstall
```

> **安全还原保障**：卸载器会自动从安装时生成的备份中恢复原 `statusLine` 配置，并清理 HUD 生成的缓存与 shim，完全不会触碰你的其他 CodeBuddy 个人偏好设置。

---

## 开发者与深入参考

本项目为 AI Agent 与终端极客提供了透明且详尽的架构与模块设计文档：

- [**AGENTS.md**](AGENTS.md) — 面向 AI 编码助手的系统硬约束、避坑指南与提交契约。
- [**架构设计全景说明 (architecture_zh.md)**](docs/architecture_zh.md) — 物理双层架构、逆向遥测状态机与性能预算设计。
- [**模块 API 参考手册 (module-reference.md)**](docs/module-reference.md) — 22 个核心模块职责、接口定义与状态流转。
- [**版本变更记录 (CHANGELOG.md)**](CHANGELOG.md) — 历史版本演进与发布记录。

---

## 许可证

本项目基于 [MIT License](LICENSE) 开源发布。
