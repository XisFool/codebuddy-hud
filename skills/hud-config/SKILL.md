---
name: hud-config
description: 当用户想要配置、美化或自定义 codebuddy-hud 状态栏的显示设置（主题、图标、显示项开关、字符集等）时触发。
---

# 交互式配置 codebuddy-hud 状态栏

当用户要求修改、设置、美化或配置 codebuddy-hud 状态栏时，请遵循以下流程：

1. **发起交互选择**：
   使用 `ask_question` 工具对用户发起提问，包含以下选项让用户选择：
   - **保存范围**：局部项目配置 (`./codebuddy-hud.config.json`) 还是 全局默认配置 (`~/.codebuddy/codebuddy-hud.config.json`)
   - **颜色主题**：深海蓝 (`ocean`)、翡翠绿 (`emerald`)、赛博朋克 (`cyberpunk`)、琥珀金 (`amber`)、黑白极简 (`monochrome`)
   - **显示项控制**：是否显示 Diff 变更 (`showDiffStats`)、Credits 消费 (`showCost`)、耗时 (`showDuration`)、工具活动 (`showToolActivity`)、缓存命中率 (`showCacheHitRate`)、上下文进度条 (`showTokenBar`)
   - **图标字体**：Unicode 符号、Nerd Fonts 图标 还是 纯 ASCII 字符

2. **写入配置文件**：
   根据用户的选择，读取当前配置（或基于默认配置合并），使用文件写入工具保存到对应的 `codebuddy-hud.config.json` 中。
