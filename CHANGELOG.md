# Changelog (变更记录)

All notable changes to this project will be documented in this file.
本项目的所有重要变更均将记录于此文件中。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Documentation (宿主契约复核)

- **宿主契约实测复核至 v2.181.0**：独立复核确认 statusLine 契约与 v2.179.2 一致（stdout 前 3 行、10240 UTF-16 字符上限、五类事件 300ms 去抖、5000ms 硬超时）；v2.181.0 仅为等价转译重构，无语义变化；同步更新文档版本引用、Credits 口径与刷新表述。

## [v0.4.0] - 2026-11-02

### Added (新增特性)

- **CLI 查询与优先级**：新增 `--version`/`-v` 与 `--help`/`-h` 命令，执行无需等待 stdin；分发优先级高于安装、卸载与换肤操作；`--status` 演示 payload 版本号改为动态读取 `package.json`，不再硬编码旧版本号。
- **配置与备份保护诊断**：`--doctor` 新增 `codebuddy / retainedBackups` 检查项，扫描并列出卸载时保留的 `.bak.codebuddy-hud.retained-*` 原文副本（严格过滤普通文件，排除同名前缀目录）并提示手动清理（只列出、不自动删除）。
- **分发完整性与漂移守卫**：本地复制与远端下载清单均补齐仓库 `LICENSE`（MIT）；新增远端运行清单（`RUNTIME_FILES`）双向漂移测试，既断言覆盖 `runtime/` 下全部依赖，又反向断言清单中每一项在仓库中物理存在，防止分发遗漏。

### Changed & Refactored (变更与品牌重构)

- **品牌名称统一**：安装/卸载提示文案、主题预览项目名与 E2E 验证脚本标头全面统一为 `codebuddy-hud`，彻底消除历史遗留的 `codebuddy-cli-hud`。
- **主题配色优化**：深色 Emerald 与 Cyberpunk 分别改用柔和浅绿（256 色 `114`）和粉紫（256 色 `183`），保留原有版式及其他字段配色。
- **Cyberpunk 主色统一**：深浅模式下，分支、项目名和 out Token 跟随模型与上下文用量的粉紫主色，同步主题选择器及中英文说明。

### Fixed (缺陷修复与安全加固)

- **安装/卸载 JSONC 无损**：`--setup`/`--uninstall` 改为基于 AST token 的局部精准文本编辑，仅改动 `statusLine` 成员，保留注释、BOM、换行与格式；已有 `padding` 与额外字段予以保留；卸载在确认 `statusLine` 之外无改动时整文精确还原，若存在其他改动则仅回写该字段并把原文另存 `.retained-<time>-<pid>` 后再退役备份。
- **技能目录归属保护**：部署与卸载只处理指向本次源目录的链接或带 `.codebuddy-hud-managed` 标记的复制目录；未知同名目录/链接/文件一律警告并保留，绝不误删用户自定义技能。
- **主题配置保护与国际化**：`--theme` 对无效配置（非法 JSON、非对象根节点、不可读文件）直接报错并保留原文件，不再重置为空对象；报错信息点出文件路径与严格 JSON 要求；`--setup --theme` 遇到换肤失败时安全中止，不继续写入 `statusLine`；主题列表、选择器及用法提示接入 `lang.js` 国际化，预览框按 CJK 双列宽度对齐。
- **终端安全加固**：主题覆盖值经 SGR 白名单校验，阻断清屏、OSC 52 剪贴板劫持等终端注入；`sanitizeTerminalText` 完整剥离 DCS/APC/PM/SOS 及 C1 形式（`0x90/0x98/0x9E/0x9F` 等）控制串，未终止串安全吞到输入末尾。
- **读取预算上限**：`display.toolActivityTailBytes` 增加 `MAX_TOTAL_BYTES`（256 KiB）上限钳制，各逆向扫描按剩余字节预算限制单次读取；配置文件超过 256 KiB 或非普通文件时跳过该层，防止仓库内恶意配置触发大内存读取。
- **Δ/⏱ 缓存误判消除**：重置信号复用上下文占用仲裁，避免缓存命中或 TTL 过期被当作 `/clear`；缺失 `input_tokens` 且 cache 为 0 时按未知处理。缺少窗口大小/使用率时仍回退原始输入，缓存残差仍可能触发断崖。
- **transcript 尺寸持久化**：文件单独增长也保存尺寸；stat 失败时其他状态写回保留上次有效尺寸，避免后续截断漏检。
- **卸载还原守卫**：仅当当前 `statusLine` 仍指向本 HUD 时还原备份，保留用户后续替换或删除的配置意图。
- **Windows PATH 保护**：安装/卸载通过注册表 API 读写 HKCU `Path`，保留 `%VAR%` 间接引用与 `REG_EXPAND_SZ` 值类型；卸载按归一化路径比对移除 runtime bin，避免误删或漏删。
- **会话 Effort 状态原子写**：采用临时文件 + rename 原子写入，避免多进程并发读到半截 JSON。
- **Bootstrap 查询源优先级**：显式 Release URL 跳过默认 302/API 查询；兼容 `CODEBUDDY_HUD_REMOTE_PKG_URL` 旧变量别名，新名优先。
- **Doctor 路径校验增强**：POSIX 支持 shell 反转义；Windows 保留 UNC、`\$` 等字面字符（不执行 shell 反转义），避免误报存在，并兼容引号内尾反斜杠的分词歧义。

### Performance & Hardening (性能与稳健性加固)

- **Git 探测零 Shell 派生**：使用免 shell 的 `execFileSync` 直连 `git status`，按需懒加载 `child_process`，普通渲染帧避免加载子进程模块，Windows 派生开销节省约 33ms。

### Documentation (文档对齐与宿主契约)

- **宿主契约实测复核**：实测至 CodeBuddy Code **v2.179.2**（2026-11-02 复核）——输出前 3 行截断、10240 UTF-16 字符上限（先判长度再追加）、五类事件 300ms 去抖与 5000ms 硬超时均保持不变；各文档版本引用全面同步为 v2.179.2。
- **架构文档解耦与重构**：抽离国内镜像、Git Clone、Fork 等高级安装到独立文档 `docs/install-advanced*.md`；架构文档聚焦设计动机，技术细则集中收拢至模块参考文档，双语文档完全对齐。

### Tests (测试与验证工程)

- **测试套件扩充至 496 个用例**：
  - 新增 CLI 参数组合矩阵（64 种组合覆盖）、TTY 主题帮助、transcript 尺寸增长/截断与 stat 失败、Release 查询源优先级等测试。
  - 新增远端清单双向漂移测试（正向覆盖全部 runtime 依赖，反向断言仓库真实存在）。
  - 新增 JSONC 字节级无损往返、技能目录归属判断、主题失败保护、doctor 残留副本过滤回归。
  - `verify:install` 扩充至 14 个端到端隔离生命周期场景校验（含用户技能保护与换肤失败配置保全）。

---

## [v0.3.9] - 2026-10-15

### Added (新增特性)
- **新增 `--update` 用户主动更新命令**：
  - 检查 + 升级二合一：解析最新 Release tag 并与本地版本比较，落后时下载该 tag 的 `scripts/bootstrap.js` 至临时文件，以 `--delay-start` detached 派生完成原子自举重装（`CODEBUDDY_HUD_VERSION` 钉住 tag），已最新则打印 `Already up to date`；
  - tag 解析三级策略（`runtime/update-checker.js`）：显式 `CODEBUDDY_HUD_LATEST_RELEASE_URL`（兼容旧名 `CODEBUDDY_HUD_REMOTE_PKG_URL`）→ `github.com/releases/latest` 302 Location（免 API 限流）→ `api.github.com` REST 兜底（仅直连附带 `GITHUB_TOKEN/GH_TOKEN`）；`CODEBUDDY_HUD_MIRROR` 镜像语义与 bootstrap.js 完全一致；
  - tag 全程单一形态：解析、下载寻址、`CODEBUDDY_HUD_VERSION`、比较与消息均原样使用 GitHub 原始 ref（`compareVersions` 自兼容 `v` 前缀），无第二归一化形态，结构上杜绝混用导致的 raw 404 与双前缀；`rawBaseForTag` 白名单校验拒绝路径注入；`bootstrap.js` 的 `RUNTIME_FILES` 清单补录 `runtime/update-checker.js`，远程安装不再缺失该模块；
  - 严守「渲染路径零网络」契约：无后台巡逻、无状态栏提示元素、无自动/静默升级，更新感知完全由用户显式触发；同时清理 `runtime/lang.js` 中自 938ece0 起遗留的死文案键 `updateAvailable`/`updateTip`。

### Performance & Hardening (性能与稳健性加固)
- **Windows 终端编码探测优化与超时预算收紧**：
  - `runtime/encoding.js` 中的 `chcp.com` 探测改用 `spawnSync` 直接派生，免除 `cmd.exe` 壳进程开销，实测 p50 由 ~38ms 降至 ~23ms；
  - 探测超时由 2000ms 严格收紧至 300ms，对健康 p50 保留约 8 倍余量，彻底远离宿主 5s statusLine 判死线；
  - 拆分失败缓存语义：真实代码页结果正常缓存 1 小时；超时或派生失败视为暂无数据，当帧安全降级为 ASCII 显示，但仅缓存 60 秒（`probeTtlMs`），过期自动重探，杜绝单次系统卡顿导致终端字形被锁死降级 1 小时。

### Changed (口径校准与视觉优化)
- **Cache 徽章超窗滑动校准为「近期调用命中率」**：
  - `runtime/transcript.js` 中 `getTurnUsageMetrics()` 从 EOF 回扫超出 200 条记录 / 256KiB 扫描预算时，滑动窗口自然截止于最近调用；
  - 明确徽章数值口径为「近期调用命中率」（`sum(hitTokens) / sum(promptTokens)`，由 `turn-window-slide` 测试钉死），消除先前误标为“整轮平均”的语义歧义；三态契约保持不变。
- **Context Token 比例分色与黑白极简主题对比度优化**：
  - Context Token 比例数字按 `thresholds` 阈值分色（绿 / 黄 / 红），标签与 in/size 数值使用主题主色；
  - 优化黑白极简主题（`monochrome`）高对比度色彩表现，提升暗色终端辨识度与阅读体验。

### Documentation (宿主兼容性复核与文档对齐)
- **全面对齐 CodeBuddy Code v2.167.0 逆向确证**：
  - 深入逆向确证 CodeBuddy Code v2.167.0 模块 254030：输出前 3 行截断（`eT=3`）、10240 个 UTF-16 字符 stdout 捕获上限（`eD=10240`，先判长度再追加）、5000ms 硬超时、5 类离散事件触发 300ms 去抖刷新、空闲与只读工具静默等运行机制；（注：模块号与常量名随构建变化；v2.181.0 现为模块 `870126`、`eT=10240`/`eD=3`，上述 `254030`/`eT=3`/`eD=10240` 仅对 v2.167.0 有效。）
  - 双语 README、`docs/architecture.md`、`docs/architecture_zh.md`、`docs/module-reference.md` 与 `AGENTS.md` 全量校准对齐。

### Tests (测试与验证工程)
- **单测用例扩充至 436 个**：
  - 新增 `tests/unit/update-checker.test.mjs`（14 个用例，覆盖 semver 比较、tag 解析、302 跳转、镜像拼装、自举子进程派生等）；
  - 新增 `tests/unit/entry.test.mjs` 中的 `--update` CLI 端到端测试；
  - 新增 `tests/unit/transcript.test.mjs` 中的 `turn-window-slide` 滑窗测试；
  - 新增 `tests/unit/renderer.layout.test.mjs` 与 `theme-selector.test.mjs` 主题色彩对比度测试。

## [v0.3.8] - 2026-10-02

### Fixed (缺陷修复)
- **修复 `/clear` 后 Δ/⏱ 漏显并彻底退役 handoff 机制**：
  - 针对宿主在 `/clear` 后切换全新 transcript 导致的会话失联与 Δ/⏱ 漏显问题，退役旧的跨 identity 水位共享（handoff）机制，彻底根除其在空闲超时 >5min 拒收、同目录多窗口覆写串扰与单调防线拒收三条路径下的漏显缺陷；
  - 确立「identity miss 即新会话」语义，无论新开窗口还是 `/clear` 换新会话，首帧直接以当前 payload 累计为新基线，Δ/⏱ 归零重来并在次帧平滑累加；
  - 状态持久化失败或异常时安全锚定为 Δ=0（消除旧版回退至宿主全量巨额累计的缺陷）；`paths.js` 保留 `getSessionStatsHandoffPath` 作为存量路径定位接口（无运行时引用，uninstall 整目录清理）。

### Added (新增特性)
- **支持 `hud-config` 技能自动挂载与卸载清理**：
  - `--setup` 安装时自动将内置的 `skills/hud-config` 挂载至宿主全局技能目录 `~/.codebuddy/skills/hud-config`（Windows 优先免特权的 Junction，POSIX 优先目录软链，遇到权限限制自动降级为递归目录拷贝），支持在 CodeBuddy 会话内通过自然语言直接调用 Agent 换肤与配置看板；
  - 挂载机制内置前置 `SKILL.md` 存在性校验、自环挂载守卫（Self-loop Guard）与全局异常非阻塞降级保护，决不影响 statusLine 主配置写入；
  - `--uninstall` 卸载时彻底清理已部署或挂载的技能目录与软链（符号链接优先使用 `unlink` 解除挂载，避免损伤源目录）。

### Performance (性能优化)
- **推理强度扫描快筛阻断**：在 `runtime/model-info.js` 的 `scanChunkForEffortSignal` 中加入针对 `/effort`、`ultra_effort` 与 `reasoningEffort` 指令的前置快速字符串快筛，阻断大文件 65%~99% 的无用 `JSON.parse` 与 GC 开销，严格遵守 40 行扫描预算上限。

### Removed (移除与清理)
- **清理插件清单无效命令**：移除 `.codebuddy-plugin/plugin.json` 中的 `commands` 数组，消除 CodeBuddy 宿主加载时的非标准指令集告警。
- **清除配置死键与技能文案校准**：彻底移除 `runtime/config.js` 与配置模板中已废弃的残留死键 `showAgentStatus`，同步校准 `skills/hud-config/SKILL.md` 配置指导文案，减少 LLM 认知负荷。
- **精简文档体系**：移除冗余的 `docs/README.md` 跳板文档，直连架构与模块参考手册。

### Changed (视觉与资源微调)
- **SVG 预览图色彩与层级校准**：校准 `assets/codebuddy-hud-preview.svg` 权限模式色值为标准 ANSI 95 高亮紫（`#cba6f7`），取消 cache 命中率粗体以对齐 v0.3.7 slim 细体排版规范，优化活跃图标与工具完成态视觉层级。

### Tests (测试与验证工程)
- **基线状态机与多窗口隔离回归矩阵**：重构 `tests/unit/session-stats.test.mjs`，新增 P1/P2/S6/S7/S8 全套测试用例，覆盖跨 transcript 归零、同工作区多窗口独立隔离、进程重启降值自适应及持久化异常降级场景；
- **技能生命周期单测覆盖**：`tests/unit/statusline-installer.test.mjs` 增补技能目录初次挂载、幂等更新、卸载清理、缺少 SKILL.md 跳过及自环保护测试；
- **E2E 隔离验证扩展**：`scripts/verify-install.js` 新增 `skill-installed-and-readable` 与 `skill-uninstalled-cleanly` 两项端到端生命周期断言；全量单元测试用例扩充至 417 个（415 passed, 2 skipped, 0 failed）。

### Documentation (文档对齐)
- **宿主刷新机制与局限说明**：双语 README 新增独立章节，AGENTS.md 同步对齐 CodeBuddy Code v2.157.0 模块 54030/83451 逆向确证（短命子进程模型、5 个离散事件触发 300ms 防抖、空闲与只读工具静默）。（注：模块号随构建变化；v2.181.0 现为 `870126`，上述 `54030`/`83451` 仅对 v2.157.0 有效。）
- **GBK 终端 ASCII 降级对照**：双语 README 补充 Windows 代码页 936 等非 UTF-8 终端下的纯 ASCII 降级显示对照示例。

## [v0.3.7] - 2026-09-22

### Changed (变更与优化)
- **琥珀金主题视觉升级**：
  - 琥珀金（`amber`）：暗色与亮色模式主色（`primary`）、强调色（`accent`）、模型名与 Git 分支统一升级为耀眼金色（`gold`，`\x1b[93m`），提升整体质感与对比度；
  - 调色板引擎（`runtime/renderer/format.js`）：新增导出 `brightPurple`（标准 16 色高亮紫，`\x1b[95m`）；
  - 排版视觉层级对齐：模型名与 Context Token 标题加粗（`bold`），低命中率 Cache 数值保持细体（高命中率为纯绿 / 纯黄），权限模式标识（`permission_mode`）统一使用 `brightPurple`，提高跨终端兼容性并消除暗色背景下的辨识度问题。

### Fixed (缺陷修复)
- **高缓存命中率下 Context Token 分子恒为 0 与进度条消失**：
  - 针对 DeepSeek 等服务商将 miss 视作 creation 导致宿主 `current_usage.input_tokens` 扣减为 0 的场景，HUD 自动按 `combined = rawInput + cacheRead + cacheCreation` 还原活跃上下文输入总占用，恢复进度条与占用显示；
  - 消除未扣减提示词与缓存并存时的翻倍缺陷，引入与 `used_percentage` 占用的残差距离仲裁，杜绝重复计算；
  - 上下文新鲜度判定（`createContextTracker`）与 compact 状态检测（`getCompactContextStatus`）升级为双向遥测匹配，同时支持还原总输入与原始未扣减输入。

### Refactored (重构与工程质量)
- **统一 Payload 输入还原基准**：抽象 `resolveReportedInputs` 帮助函数，保持 DRY 并统一跨模块输入还原逻辑。
- **回归测试套件扩充**：新增 `tests/unit/context-token.test.mjs`，覆盖高缓存占用还原、未扣减防翻倍、双向新鲜度匹配及 post-compact 保护全链路场景；全量单元测试文件增至 22 个，单测用例增至 413 个。

## [v0.3.5] - 2026-09-21

- 翡翠绿（`emerald`）与赛博朋克（`cyberpunk`）暗色主题配色调优，调色板支持 ANSI 256 色与 Bright 转义序列。
- 修复非仓库目录（残留 `.git`）每次刷新重复执行 git 探测：新增 60s 失败负缓存，`CODEBUDDY_HUD_NO_GIT_CACHE=1` 可绕过。
- 修复 payload 缺失（超时、超 1MB、非法 JSON）时静默无输出：现向 `codebuddy-hud-error.log` 写入诊断。
- 移除第一行 `[↑ vX.Y.Z]` 更新提示徽章与后台更新检查，HUD 不再发起版本查询。

## [v0.3.2] - 2026-09-18

- 一键安装自动注册 PATH（Windows 注册表 / POSIX `~/.local/bin` 软链），卸载时自动清理，`CODEBUDDY_HUD_NO_PATH=1` 可跳过。
- 已完成的工具调用独立展示（`✓ Read ×3  ✓ Grep ×2`）。
- 修复 ASCII 模式下推理强度标签重复。

## [v0.3.0] - 2026-09-16

- 安装器新增 `CODEBUDDY_HUD_MIRROR` 镜像加速、302 解析最新 tag、`GITHUB_TOKEN`/`GH_TOKEN` 认证与最多 3 次下载重试。
- 第二行精简为 `Context Token in/size [bar] % │ out ... │ cache ...`，并感知 `/compact` 后旧 usage 滞后（显示 `--` 与等待提示）。
- `--theme` 选择器预览对齐宿主 3 行布局。
- 修复镜像未覆盖版本发现、卸载成功文案误报与卸载还原自引用 HUD 备份的问题。

## [v0.2.1] - 2026-09-10

- 无真实遥测时 cache 显示 `--`，不再伪造 `cache 0.0%`。
- 加固滑窗扫描、`settings.json` JSONC 解析、主题名校验、卸载 shim 保留与 `--doctor` 路径校验。
- 新增英文版 `README_en.md`，文档与实现对齐。

---

## [v0.2.0] - 2026-09-08

- 三行看板布局对齐宿主 3 行截断，工具活动并入第 3 行尾部。
- 新增多语言 i18n（`--doctor` 中英自适应），并以 handoff 机制修复 `/clear` 后 Δ/⏱ 漏显。
- 修复 Windows 路径大小写归一化、大文件推理强度捕获与中文路径 UTF-8 乱码。
- `ultracode` 采用金黄配色与 `⚡`，`bypassPermissions` 采用亮紫配色。

---

## [v0.1.0] - 2026-09-04

首个正式稳定版本发布。

- 实现 CodeBuddy Code statusLine ANSI 彩色状态栏看板。
- 支持主题换肤、Token 上下文进度条、Cache 命中率、Git diff、会话 Credits 与工具活动展示。
- 提供跨平台一键安装、卸载与环境体检诊断。

[Unreleased]: https://github.com/XisFool/codebuddy-hud/compare/v0.4.0...HEAD
[v0.4.0]: https://github.com/XisFool/codebuddy-hud/compare/v0.3.9...v0.4.0
[v0.3.9]: https://github.com/XisFool/codebuddy-hud/compare/v0.3.8...v0.3.9
[v0.3.8]: https://github.com/XisFool/codebuddy-hud/compare/v0.3.7...v0.3.8
[v0.3.7]: https://github.com/XisFool/codebuddy-hud/compare/v0.3.5...v0.3.7
[v0.3.5]: https://github.com/XisFool/codebuddy-hud/compare/v0.3.2...v0.3.5
[v0.3.2]: https://github.com/XisFool/codebuddy-hud/compare/v0.3.0...v0.3.2
[v0.3.0]: https://github.com/XisFool/codebuddy-hud/compare/v0.2.1...v0.3.0
[v0.2.1]: https://github.com/XisFool/codebuddy-hud/compare/v0.2.0...v0.2.1
[v0.2.0]: https://github.com/XisFool/codebuddy-hud/compare/v0.1.0...v0.2.0
[v0.1.0]: https://github.com/XisFool/codebuddy-hud/releases/tag/v0.1.0
