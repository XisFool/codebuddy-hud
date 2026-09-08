# CodeBuddy HUD

[![Node.js >=18](https://img.shields.io/badge/Node.js-%3E%3D18-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![npm dependencies](https://img.shields.io/badge/npm%20dependencies-0-2ea44f)](#-一键极速安装)
[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

> 专为 **CodeBuddy Code** 打造的终端实时看板。在你的终端底部以优雅极简的 3 行，清晰展现模型状态、Token 资源消耗、缓存命中、代码改动与 AI 实时工具活动。

- ⚡ **开箱即用**：纯 Node.js 原生标准库实现，零外部依赖，无需 `npm install`。
- 🛡️ **轻量稳定**：运行极速（通常 <200ms），异常静默降级，永不因看板影响 CodeBuddy 主对话。
- 🎯 **真实数据**：Token、缓存命中率与消费额度全部源于会话真实遥测，不虚构、不造假。
- 🎨 **自由换肤**：内置 5 套精美终端配色，支持方向键交互式实时预览与深浅色终端自适应。

[⚡ 一键安装](#-一键极速安装) · [📖 30 秒看懂看板](#-30-秒看懂你的看板) · [🎨 随心换肤](#-随心换肤) · [⚙️ 个性化定制](#-个性化定制进阶) · [❓ 常见问题](#-新手常见问题与排障) · [🗑️ 安全卸载](#-安全卸载) · [🛠️ 开发者参考](#-开发者专区)

---

## 💡 它长什么样？

在 CodeBuddy 终端底部，你会看到这样整洁直观的 3 行看板：

```text
DeepSeek V4 Flash ● max  │  main*  │  my-project  │  default
Token 250.1k (in: 249k · out: 1.1k)  │  249k/1M [███░░░░░░░] 25%  │  cache 96.8%
Δ +1.7k -161  │  82.04 credits  │  ⏱ 2h47m  │  ◐ Edit: parser.js  │  ✓ Read ×3  ✓ Grep ×2
```

> 💡 **小而强大**：严格控制在 ≤3 行之内，无对应数据的行或字段自动隐藏，绝不遮挡聊天屏幕；遇到不支持特殊符号的终端自动平滑切为纯文本，绝不乱码。

---

## 🚀 一键极速安装

无需手动克隆代码，只需在你的电脑终端粘贴运行一行命令：

### Windows (PowerShell)
```powershell
irm https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/install.ps1 | iex
```

### macOS / Linux (Bash)
```bash
curl -fsSL https://raw.githubusercontent.com/XisFool/codebuddy-hud/master/scripts/install.sh | bash
```

> ### ⚡ 新手必看提醒（最重要的一步！）
> 安装完成后，打开或重启你的 CodeBuddy Code。
> **请随便向 AI 发送任意第一条消息**（例如说一句“你好”），终端底部的 HUD 看板就会**立刻自动亮起**！
> *(原理：CodeBuddy 只在有消息交互时触发状态栏刷新，空闲未发消息时底部默认保持干净)*

---

## 📖 30 秒看懂你的看板

看板虽然只有 3 行，但包含了你在结对编程时最关心的所有核心信息：

```
Line 1: [模型名称] [思考深度]  │  [Git分支与改动]  │  [工作区目录]  │  [权限模式]
Line 2: Token [总消耗 (输入/输出)]  │  [上下文用量进度条与比例]  │  [省钱缓存命中率]
Line 3: Δ [代码增减行数]  │  [实际花销]  │  ⏱ [会话耗时]  │  ◐ [AI当前动作]  │  ✓ [工具调用聚合]
```

### 每一项通俗图解：

| 显示片段 | 通俗含义 | 为什么需要它？ |
| :--- | :--- | :--- |
| **`DeepSeek V4 Flash`** | 当前正在为你写代码的 AI 模型名称 | 一眼确认当前使用的是哪款模型，避免切错模型。 |
| **`● max` / `◐ medium`** | 模型推理/思考深度（effort） | 清楚知道当前模型是在“极速简答”还是在“深度思考复杂架构”。 |
| **`main*`** | 当前 Git 分支（带 `*` 表示有未提交改动） | 写代码时时刻感知版本分支状态，防错提分支。 |
| **`Token 250.1k (in: 249k · out: 1.1k)`** | 当前上下文 Token 开销与输入/输出拆分 | 了解本次交互吃掉了多少 token，输入多还是输出多。 |
| **`[███░░░░░░░] 25%`** | 上下文窗口已占用比例与可视化进度条 | 随着聊得越久条越满。快满（80%+）时提醒你及时 `/clear` 重置，保持 AI 智力巅峰。 |
| **`cache 96.8%`** | 提示词缓存（Prompt Cache）命中率 | **省钱与提速神器**！命中率高说明 96% 的历史上下文无需重新计算计费，响应极快。若服务商未返回则显示 `cache --`。 |
| **`Δ +1.7k -161`** | 本次会话累计增加 / 删除了多少行代码 | 编程成就感！直观看到本轮让 AI 帮你敲了多少生产力代码。 |
| **`82.04 credits`** | 本会话累计实际消耗的平台额度 | 明明白白消费，按实际遥测账单累计，拒绝糊涂账。 |
| **`⏱ 2h47m`** | 当前会话已持续的总时长 | 专注时钟，帮你掌握写代码的节奏。 |
| **`◐ Edit: parser.js`** | **AI 正在执行的操作**（置前高亮） | 当 AI 在后台长思考或改文件时，一眼看清它正在对哪个文件动手，告别黑盒盲等。 |
| **`✓ Read ×3  ✓ Grep ×2`** | 本轮已经完成的工具调用频次聚合 | 清晰了解 AI 刚才查了哪些文件、搜了多少次代码。 |

---

## 🎨 随心换肤

`codebuddy-hud` 内置了 5 套精心搭配的经典终端色系，随你的心情和编辑器风格自由切换：

| 主题名称 | 风格定位 | 特色看点 |
| :--- | :--- | :--- |
| **`ocean`**（默认） | 深海青蓝 | 现代科技感，蓝青搭配，高对比度不刺眼 |
| **`emerald`** | 翡翠绿 | 清新护眼自然风，适合长时间编程 |
| **`cyberpunk`** | 赛博朋克 | 霓虹紫 + 荧光青，炫酷高调，极客最爱 |
| **`amber`** | 琥珀金 | 暖金复古终端风，沉稳温暖 |
| **`monochrome`** | 黑白极简 | 极简经典黑白灰，无色干扰，纯粹利落 |

### 方式 A：在 CodeBuddy 里动动嘴（最推荐！）

最舒服的用法是直接在 CodeBuddy 聊天框中对 AI 助手说：
> “**帮我把 HUD 换成赛博朋克主题**”  
> 或直接输入命令：`/hud-config`

AI 会自动打开可视化交互菜单帮你瞬间配置完成！

### 方式 B：终端交互式“所见即所得”实时预览

你也可以在电脑终端中直接呼出主题选择器，用上下方向键 `↑` / `↓` 移动，屏幕会**实时同步渲染**出每套主题的真实看板模样，看中哪套敲回车（`Enter`）即可：

```bash
# Windows
& "$env:USERPROFILE\.codebuddy\codebuddy-hud-runtime\runtime\bin\codebuddy-hud.cmd" --theme

# macOS / Linux
node "$HOME/.codebuddy/codebuddy-hud-runtime/runtime/bin/codebuddy-hud.js" --theme
```

*(如果你是通过源码安装并执行了 `npm link`，则在任何终端直接输入 `codebuddy-hud --theme` 即可)*

---

## ⚙️ 个性化定制（进阶）

> 💡 **绝大多数用户完全不需要做任何配置！默认设置已针对日常体验打磨至最佳。**

如果你有特殊偏好（例如想关闭某一行、或者使用更好看的 Nerd Fonts 矢量图标），可以在项目根目录（或 `~/.codebuddy/` 用户全局目录）创建文件 `codebuddy-hud.config.json`：

```json
{
  "theme": "ocean",
  "themeMode": "auto",
  "display": {
    "showToolActivity": true,
    "showCacheHitRate": true,
    "showDiffStats": true,
    "showCost": true,
    "useNerdFonts": false
  },
  "language": "zh"
}
```

<details>
<summary><b>🔍 点击展开查看配置项说明</b></summary>

| 配置项 | 默认值 | 作用说明 |
| :--- | :--- | :--- |
| `theme` | `"ocean"` | 默认主题：`ocean`, `emerald`, `cyberpunk`, `amber`, `monochrome` |
| `themeMode` | `"auto"` | 色调模式：`auto`（自动侦测终端深色/浅色背景）、`dark`、`light` |
| `language` | `"zh"` | 提示语言：`zh`（中文）、`en`（英文） |
| `display.showToolActivity` | `true` | 是否在第 3 行尾部展示 AI 实时工具活动与调用次数 |
| `display.showCacheHitRate` | `true` | 是否展示 Prompt Cache 命中率 |
| `display.showDiffStats` | `true` | 是否展示代码变更量（`Δ +N -M`） |
| `display.showCost` | `true` | 是否展示实际额度消费 |
| `display.useNerdFonts` | `false` | 是否启用精美的矢量小图标（开启需终端安装并使用 Nerd Font 字体） |

</details>

---

## ❓ 新手常见问题与排障

### Q1: 安装成功后，打开 CodeBuddy 底部还是空的？
这是最常见的疑问！请注意：**CodeBuddy 在刚打开且空闲时是不绘制状态栏的**。  
👉 **解决方法**：只需在会话框里随便发一句话（比如打个问号或“测试”），让会话触发一次交互，HUD 就会立刻常驻在底部。

### Q2: 终端出现乱码、方块或奇怪符号？
通常是因为 Windows 系统的默认终端编码仍为老旧的 GBK 编码：  
👉 **解决方法**：
- **推荐**：在终端里运行一下命令 `chcp 65001`，将当前窗口编码切换为标准 UTF-8；
- **备选**：若你的终端环境确实不支持 Unicode，HUD 支持纯 ASCII 模式，在 PowerShell 中运行 `$env:CODEBUDDY_HUD_FORCE_ASCII = '1'` 即可切换为纯英文符号。

### Q3: 为什么 Credits 或 Cache 有时候显示 `--`？
👉 **这是正常现象，说明数据绝对真实，没有造假！**  
- 当你刚开启一个全新会话、或者你当前连接的 AI 模型供应商接口并未返回缓存/计费字段时，HUD 会优雅显示 `cache --` 或隐藏消费段，绝不胡乱捏造虚假数字。

### Q4: 怀疑看板没生效或工作异常，如何一键体检？
HUD 内置了全自动的“健康体检医生（doctor）”，会自动检查你的 Node 环境、配置文件、终端编码与路径权限：
```bash
# Windows
& "$env:USERPROFILE\.codebuddy\codebuddy-hud-runtime\runtime\bin\codebuddy-hud.cmd" --doctor

# macOS / Linux
node "$HOME/.codebuddy/codebuddy-hud-runtime/runtime/bin/codebuddy-hud.js" --doctor
```

---

## 🗑️ 安全卸载

如果你暂时不需要使用 HUD，可以随时运行卸载命令。

**我们的安全承诺**：卸载程序会自动从安装时保留的原始备份中**100% 干净还原**你的 CodeBuddy `settings.json`，并清理 HUD 运行时与临时缓存，**绝对不会误删或碰动你个人的任何其他偏好配置**！

```bash
# Windows
& "$env:USERPROFILE\.codebuddy\codebuddy-hud-runtime\runtime\bin\codebuddy-hud.cmd" --uninstall

# macOS / Linux
node "$HOME/.codebuddy/codebuddy-hud-runtime/runtime/bin/codebuddy-hud.js" --uninstall
```

---

## 🛠️ 开发者专区

<details>
<summary><b>🔧 点击展开：从源码手动构建与本地开发调试</b></summary>

### 源码安装与调试
如果你想参与开发或调试源码：
```bash
git clone https://github.com/XisFool/codebuddy-hud.git
cd codebuddy-hud

# 执行本地安装注册
node runtime/bin/codebuddy-hud.js --setup

# 推荐链接全局命令（方便直接敲 codebuddy-hud）
npm link

# 运行测试
npm test
npm run verify
```

### 深入技术文档
- [**AGENTS.md**](AGENTS.md) — 面向 AI 编码助手的系统核心约束、避坑指南与验证闭环。
- [**架构设计全景说明 (docs/architecture_zh.md)**](docs/architecture_zh.md) — 物理双层隔离设计、逆向遥测状态机与时序性能预算。
- [**模块 API 参考手册 (docs/module-reference.md)**](docs/module-reference.md) — 全部 25 个核心模块、工具脚本的职责定义与底层落盘状态。
- [**版本变更记录 (CHANGELOG.md)**](CHANGELOG.md) — 历史版本发布演进。

</details>

---

## 许可证

本项目基于 [MIT License](LICENSE) 开源发布。
