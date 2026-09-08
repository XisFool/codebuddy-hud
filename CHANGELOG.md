# Changelog (变更记录)

All notable changes to this project will be documented in this file.
本项目的所有重要变更均将记录于此文件中。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] (待发布)

### Documentation (文档优化)
- **面向用户重构**：全面重写 `README.md`，打通一键安装用户在换肤、体检与卸载时的真实 CLI 调用路径，消除底层逆向工程细节泄漏，修复失效导航锚点。
- **Agent 契约规范化**：优化 `AGENTS.md`，引入 `lang.js` 模块声明，移除硬编码行号，强化测试驱动与验证闭环，建立指向 `docs/` 深度参考手册的上下文指针。

---

## [v0.2.0] - 2026-09-08

对齐 CodeBuddy Code v2.146.0 输出上限与增强会话状态管理的重大功能版本。

### Changed (变更与对齐)
- **三行看板布局对齐 (3-Line Layout Alignment)**：严格对齐宿主 statusLine 的 3 行输出截断限制，将最近工具活动与本轮频次聚合优雅并入第 3 行尾部展示。

### Added (新增功能)
- **多语言国际化体系 (i18n)**：新增 `runtime/lang.js` 字典模块，`--doctor` 体检、`--theme` 换肤与 `--uninstall` 卸载全面支持中文 (`zh`) 与英文 (`en`) 自适应切换。
- **会话基线跨文件交接 (Session Baseline Handoff)**：通过基于工作目录（cwd）哈希寻址的 handoff 状态机，解决 `/clear` 切换新 transcript 文件导致的 Δ 代码变更与 ⏱ 耗时全额漏显问题。

### Fixed (缺陷修复)
- **Windows 路径大小写归一化**：对工作目录与文件路径执行标准化，消除 Windows 跨驱动器与大小写不一致导致的 handoff 基线分裂。
- **大文件推理强度捕获 (Effort Sliding Window)**：增加文件头部兜底探测与会话状态缓存，防止 `/effort ultracode` 等高强度标记在超过 1MB 的超大 transcript 中滑出尾部窗口。
- **Windows 终端 UTF-8 编码兼容**：Windows Shim 脚本在检测到非 ASCII 路径时自动注入 `@chcp 65001`，彻底解决中文路径下的乱码问题。

### Visual (视觉与交互)
- **高亮色阶与指示符**：为 `ultracode` 引入耀眼金黄配色与 `⚡` 符号，`bypassPermissions` 引入高对比度亮紫配色，与 `● max` 形成明确区分。

---

## [v0.1.0] - 2026-09-04

首个正式稳定版本发布。

- 实现 CodeBuddy Code statusLine ANSI 彩色状态栏看板。
- 支持主题换肤、Token 上下文进度条、Cache 命中率、代码 Git diff、会话 Credits 遥测与工具活动展示。
- 提供跨平台一键安装、卸载、环境体检诊断与隔离环境安装验证闭环。
- 基于 GitHub Release 不变 tag 实现高可靠安装与静默后台更新检测。

[Unreleased]: https://github.com/XisFool/codebuddy-hud/compare/v0.2.0...HEAD
[v0.2.0]: https://github.com/XisFool/codebuddy-hud/compare/v0.1.0...v0.2.0
[v0.1.0]: https://github.com/XisFool/codebuddy-hud/releases/tag/v0.1.0
