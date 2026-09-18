# Changelog (变更记录)

All notable changes to this project will be documented in this file.
本项目的所有重要变更均将记录于此文件中。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased] (待发布)

### Added (新增特性)
- **一键安装自动注册 PATH 与免配置 CLI**：`install.ps1` 自动将 runtime bin 目录写入 Windows 用户注册表 PATH 并刷新当前会话；`install.sh` 在 PATH 包含 `~/.local/bin` 时自动创建软链接（未包含时给出配置指引）；`uninstall.js` 在卸载时自动清理已写入的注册表 PATH 或软链接；支持设置 `CODEBUDDY_HUD_NO_PATH=1` 跳过自动注册。

### Changed (变更与优化)
- **已完成工具调用独立展示**：Line 3 工具活动中多个已完成的工具调用优化为独立带 `doneIcon`（`✓`）并以双空格分隔（如 `✓ Read ×3  ✓ Grep ×2`），消除逗号带来的字符粘连，与 Line 3 组件化间距保持一致。

### Fixed (缺陷修复)
- **ASCII 模式推理强度标签重复**：修复 ASCII 终端下 `effortIcons` 渲染为空格导致与 `effortLabel` 拼接出现重复标签的问题，ASCII 模式下统一规范图标为空字符串。

## [v0.3.0] - 2026-09-16

### Added (新增特性)
- **安装器镜像加速与下载重试**：新增 `CODEBUDDY_HUD_MIRROR` 环境变量支持，安装脚本与 bootstrap 自动为 GitHub URL 添加镜像前缀；引入 302 重定向优先解析最新 tag（绕过 GitHub API 限流）并支持 `GITHUB_TOKEN`/`GH_TOKEN` 认证提额；runtime 文件下载支持最多 3 次尝试（1s/2s 指数退避）。

### Changed (变更与优化)
- **HUD 第二行精简与 /compact 状态感知**：Line 2 移除重复累加的 Token 数值，重构为 `Context Token in/size [bar] % │ out ... │ cache ...` 清晰结构；针对 `/compact` 压缩后宿主短时间内仍返回压缩前旧 usage 的时序滞后，通过逆向扫描 transcript compact 成功事件实现新鲜度判定，尚未刷新时显式展示 `--` 与多语言等待提示（`压缩后待更新` / `awaiting usage after compact`），杜绝旧数据误导。
- **主题选择器预览对齐 3 行布局**：`--theme` 交互选择器实时预览从 4 行收敛对齐至宿主实际生效的 3 行结构，分隔符统一使用 `│`，并将示例模型标识同步为 `Deepseek-V4.1-Flash`。

### Fixed (缺陷修复)
- **镜像覆盖版本发现与 API 兜底**：release tag 查询与 API 兜底现同样应用 `CODEBUDDY_HUD_MIRROR` 镜像前缀，并在镜像未覆盖时自动回退直连（runtime 文件始终走镜像）；`GITHUB_TOKEN`/`GH_TOKEN` 严格限制仅发往 GitHub 官方域名，杜绝凭据随重定向或镜像转发泄漏。原「302 解析」单测替换为真实断言并新增镜像覆盖 tag 查询的端到端回归测试。
- **卸载成功文案误报**：`--uninstall` 在无备份分支中于写盘前入队「Removed statusLine from settings.json」，settings 写入失败时会与「could not modify settings.json」同时打印。改为写盘成功后入队。
- **卸载备份还原自引用校验**：`--uninstall` 不再把备份中记录的 codebuddy-hud `statusLine` 写回 `settings.json`（如更早的安装副本或 `npm link` 全局 shim），消除「报告卸载成功而 HUD 仍生效」及写回失效路径的问题；对合法非 HUD 备份仍照常还原，输出文案区分「已还原」与「已消费备份但未还原」。新增 3 条回归测试。

### Documentation (文档优化)
- **安装契约口径校准**：README 镜像段去掉具体公共代理域名，回归 `your-mirror` 占位符（不背书任何第三方代理），并明确镜像前缀的覆盖范围与首跳需由 shell 展开；修正「所有下载自动重试 3 次」等绝对化表述；`docs/module-reference.md` 与 `docs/architecture*.md` 同步卸载契约（自引用校验、备份回收时机）与 bootstrap 契约（重试、镜像、`GITHUB_TOKEN`）。
- **架构与模块契约对齐**：全面校准 `AGENTS.md`、`docs/module-reference.md` 与 `docs/architecture*.md`，补充 `getTurnMetricsAndActivity` 的 `contextWindow` 与 `contextStatus` 签名、补齐 `paths.js`（`getCacheStatePath`/`getCreditStatePath`）与 `theme-selector.js`（`renderThemePreview`）导出清单、修正 Line 3 工具段双空格分隔符，并在架构图补全 `Renderer --> Lang` 依赖边与 Windows 8.3 短路径机制。
- **规范与技能配置补齐**：`AGENTS.md` 架构树补齐 `install.ps1`/`install.sh` 并补充 `https, http` 内置模块说明；`skills/hud-config/SKILL.md` 补充 `showVersion` 显示项。
- **首屏与元数据优化**：重构 README 首屏 SEO 语义、终端预览图与多平台镜像安装区，补齐 `plugin.json` 与 `package.json` 关键词。

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

[Unreleased]: https://github.com/XisFool/codebuddy-hud/compare/v0.3.0...HEAD
[v0.3.0]: https://github.com/XisFool/codebuddy-hud/compare/v0.2.1...v0.3.0
[v0.2.1]: https://github.com/XisFool/codebuddy-hud/compare/v0.2.0...v0.2.1
[v0.2.0]: https://github.com/XisFool/codebuddy-hud/compare/v0.1.0...v0.2.0
[v0.1.0]: https://github.com/XisFool/codebuddy-hud/releases/tag/v0.1.0
