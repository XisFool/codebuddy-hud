---
name: hud-config
description: 当用户想要配置、美化或自定义 codebuddy-hud 状态栏的显示设置（主题、图标、显示项开关、字符集等）时触发。
---

# 交互式配置 codebuddy-hud 状态栏

当用户要求修改、设置、美化或配置 codebuddy-hud 状态栏时，请遵循以下流程：

1. **发起交互选择**：
   使用 `ask_question` 工具对用户发起提问，包含以下选项让用户选择：
   - **保存范围**：局部项目配置 (`./codebuddy-hud.config.json`) 还是 全局默认配置 (`~/.codebuddy/codebuddy-hud.config.json`)
   - **颜色主题**：深海青蓝 (`ocean`，默认)、翡翠绿 (`emerald`)、赛博朋克 (`cyberpunk`)、琥珀金 (`amber`)、黑白极简 (`monochrome`)
   - **外观模式 (`themeMode`)**：`auto`（跟随终端背景自动感知，默认）、`dark`（强制暗色）、`light`（强制亮色）
   - **界面语言 (`language`)**：`zh`（中文）或 `en`（英文，默认）
   - **显示项控制**（所有开关必须置于 `display` 对象内）：
     - `showTokenBar`（上下文 Token 与用量进度条，默认 true）
     - `showCacheHitRate`（缓存命中率，默认 true）
     - `showDiffStats`（Git 代码变更增删行，默认 true）
     - `showCost`（Credits 实际消费，默认 true）
     - `showDuration`（会话耗时，默认 true）
     - `showToolActivity`（最近工具调用活动，默认 true）
     - `showGitBranch`（Git 分支名与修改标记，默认 true）
     - `showCurrentDir`（当前工作区目录名，默认 true）
     - `showPermissionMode`（权限模式指示器，默认 true）
   - **图标字体**（同样置于 `display` 对象内）：
     - Nerd Fonts 精美图标：`"useNerdFonts": true, "unicode": "auto"`
     - 标准 Unicode 符号（默认）：`"useNerdFonts": false, "unicode": "auto"`
     - 纯 ASCII 字符（兼容低端终端）：`"useNerdFonts": false, "unicode": false`

2. **写入配置文件**：
   读取目标路径现有配置（若存在），与用户修改项合并，确保字段层级正确（显示项与字体选项必须置于 `display` 下），写入目标 JSON。完整配置结构示例：

   ```json
   {
     "theme": "cyberpunk",
     "themeMode": "auto",
     "language": "zh",
     "display": {
       "showTokenBar": true,
       "showCacheHitRate": true,
       "showDiffStats": true,
       "showCost": true,
       "showDuration": true,
       "showToolActivity": true,
       "showGitBranch": true,
       "showCurrentDir": true,
       "showPermissionMode": true,
       "useNerdFonts": false,
       "unicode": "auto"
     }
   }
   ```

   > **提示**：若仅需快速切换主题，也可以告知用户直接在终端运行 `codebuddy-hud --theme <名称>`。
