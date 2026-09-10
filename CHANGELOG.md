# Changelog (变更记录)

All notable changes to this project will be documented in this file.
本项目的所有重要变更均将记录于此文件中。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] (待发布)

## [v0.2.1] - 2026-09-10

### Fixed (缺陷修复)
- **遥测真实性加固**：移除对 payload `cache_read_input_tokens` 的兜底回退，无真实遥测时降级 `cache --`，杜绝伪造 `cache 0.0%`。
- **滑窗扫描防御**：修正小数 `tailBytes` 导致的回扫死循环与逐字节 I/O 雪崩；工具活动兜底回扫收敛为全局连续 40 行预算，消除跨窗口跳行返回陈旧调用。
- **配置读写加固**：`settings.json` 解析统一使用 JSONC 解析器（注释与尾逗号容错）；主题名经 `Object.hasOwn` 白名单校验，阻断原型链污染。
- **卸载与体检加固**：卸载在 settings 清理成功前保留 Windows shim，杜绝半卸载悬空；`--doctor` 增加对 statusLine 命令目标脚本与 shim 转发路径的存在性校验。
- **入口健壮性**：补齐 stdin error 分支的流句柄释放；修正空字符串被误转为数字 0 的解析问题。
- **回归测试**：为上述修复新增 15 条单元测试，锁定行为。

### Documentation (文档优化)
- **文档漂移修正**：将 `docs/module-reference.md`（补 `model-info.js` 条目、修正 `renderDiffSegment` 签名与 `settings-file` 导出清单、更正备份文件名）与 `docs/architecture*.md`（`/clear` 判定阈值、依赖图缺边、sanitize 过滤范围、空 Stdin 行为）对齐至当前实现；同步修正 v0.2.0 i18n 条目措辞与 `skills/hud-config/SKILL.md` 中的过时配置项。
- **双语 README 与规范化重构**：重写 `README.md` 并新增英文版 `README_en.md`（顶部双语互链），按「安装 → 验证 → 诊断 → 卸载 → 配置」运维主线重构章节，补齐安装器行为说明、自定义安装源、命令行参考、文件结构与 CI 验证矩阵，移除标题 emoji 与营销化措辞，全部示例输出与运行时真实格式对齐。
- **面向用户重构**：打通一键安装用户在换肤、体检与卸载时的真实 CLI 调用路径，消除底层逆向工程细节泄漏，修复失效导航锚点。
- **Agent 契约规范化**：优化 `AGENTS.md`，引入 `lang.js` 模块声明，移除硬编码行号，强化测试驱动与验证闭环，建立指向 `docs/` 深度参考手册的上下文指针。
- **避坑条目与接口对齐**：`AGENTS.md` 新增 `/compact` 后 context 显示旧值的宿主刷新时序条目；`docs/module-reference.md` 对齐当前实现（`extractTokenData` 返回字段、缓存函数签名、`getTurnUsageMetrics` 返回结构、`getLogicalSessionCostData` opts、工具聚合示例）；README 预览小节标题规范化。

---

## [v0.2.0] - 2026-09-08

对齐 CodeBuddy Code v2.146.0 输出上限与增强会话状态管理的重大功能版本。

### Changed (变更与对齐)
- **三行看板布局对齐 (3-Line Layout Alignment)**：严格对齐宿主 statusLine 的 3 行输出截断限制，将最近工具活动与本轮频次聚合优雅并入第 3 行尾部展示。

### Added (新增功能)
- **多语言国际化体系 (i18n)**：新增 `runtime/lang.js` 字典模块；`--doctor` 体检报告支持中文 (`zh`) 与英文 (`en`) 自适应切换，`--theme` 选择器与快捷提示采用中英双语固定文案。
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

[Unreleased]: https://github.com/XisFool/codebuddy-hud/compare/v0.2.1...HEAD
[v0.2.1]: https://github.com/XisFool/codebuddy-hud/compare/v0.2.0...v0.2.1
[v0.2.0]: https://github.com/XisFool/codebuddy-hud/compare/v0.1.0...v0.2.0
[v0.1.0]: https://github.com/XisFool/codebuddy-hud/releases/tag/v0.1.0
