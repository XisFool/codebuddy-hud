---
name: hud-config
description: 当用户想要配置、美化或自定义 codebuddy-hud 状态栏的显示设置（主题、图标、显示项开关、字符集等）时触发。
---

# 交互式配置 codebuddy-hud 状态栏

当用户要求修改、设置、美化或配置 codebuddy-hud 状态栏时，请遵循以下流程：

1. **发起交互选择**：
   通过向用户发起交互提问或提供选项（若当前环境支持特定交互提问工具则调用相应机制，否则在回复中清晰列出选项），引导用户确认需求：
   - **保存范围**：局部项目配置 (`./codebuddy-hud.config.json`) 还是 全局默认配置 (`~/.codebuddy/codebuddy-hud.config.json`)
   - **颜色主题**：深海青蓝 (`ocean`，默认)、翡翠绿 (`emerald`)、赛博朋克 (`cyberpunk`)、琥珀金 (`amber`)、黑白极简 (`monochrome`)
   - **外观模式 (`themeMode`)**：`auto`（跟随终端背景自动感知，默认）、`dark`（强制暗色）、`light`（强制亮色）
   - **界面语言 (`language`)**：`zh`（中文）或 `en`（英文，默认）
   - **告警阈值**（置于根对象下，可选）：
     - `thresholds`: 上下文 Token 进度条告警阈值，默认 `{"warning": 0.7, "critical": 0.9}`（70% 黄色告警，90% 红色告警）
     - `cacheHitThresholds`: 缓存命中率分级阈值，默认 `{"excellent": 80, "partial": 50}`（80% 绿色优良，50% 黄色一般）
     - `defaultEffortLevel`: 推理深度回退档位，默认 `"medium"`（可选 `"low"`, `"medium"`, `"high"`, `"max"`）
   - **显示项控制**（所有显示开关必须置于 `display` 对象内）：
     - `showTokenBar`（上下文 Token 与用量进度条，默认 true）
     - `showCacheHitRate`（缓存命中率，默认 true）
     - `showDiffStats`（Git 代码变更增删行，默认 true）
     - `showCost`（Credits 实际消费，默认 true）
     - `showDuration`（会话耗时，默认 true）
     - `showToolActivity`（最近工具调用活动，默认 true；替代历史遗留的 `showAgentStatus`）
     - `showGitBranch`（Git 分支名与修改标记，默认 true）
     - `showCurrentDir`（当前工作区目录名，默认 true）
     - `showVersion`（Line 1 客户端版本号，默认 false）
     - `showPermissionMode`（权限模式指示器，默认 true）
     - `progressBarWidth`（进度条字符宽度，默认 10）
     - `toolActivityTailBytes`（工具活动尾扫字节数，默认 16384）
   - **图标字体**（同样置于 `display` 对象内）：
     - Nerd Fonts 精美图标：`"useNerdFonts": true, "unicode": "auto"`
     - 标准 Unicode 符号（默认）：`"useNerdFonts": false, "unicode": "auto"`
     - 纯 ASCII 字符（兼容低端终端）：`"useNerdFonts": false, "unicode": false`

2. **写入配置文件**：
   读取目标路径现有配置（若存在），与用户修改项合并，确保字段层级正确（显示项与字体选项必须置于 `display` 下，阈值置于根层级），写入目标 JSON。常用配置结构示例：

   ```json
   {
     "theme": "cyberpunk",
     "themeMode": "auto",
     "language": "zh",
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
       "progressBarWidth": 10,
       "useNerdFonts": false,
       "unicode": "auto"
     }
   }
   ```

   > **提示**：若仅需快速切换主题，也可以告知用户直接在终端运行 `codebuddy-hud --theme <名称>`。
