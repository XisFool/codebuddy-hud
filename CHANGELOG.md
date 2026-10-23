# Changelog (变更记录)

All notable changes to this project will be documented in this file.
本项目的所有重要变更均将记录于此文件中。

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added (新增特性)
- **CLI 增补 `--version`/`-v` 与 `--help`/`-h` 选项**：`runtime/bin/codebuddy-hud.js` 为版本打印与简要帮助提供不读取 stdin 的快速分发，避免这两类查询等待 stdin；无参数运行仍按 statusLine 模式读取 stdin（800ms 保底超时）；`scripts/bootstrap.js` 补齐 `CODEBUDDY_HUD_REMOTE_PKG_URL` 历史环境变量兼容别名。

### Fixed (缺陷修复)
- **Δ/⏱ 被缓存命中误判为 `/clear` 而清零**：`runtime/session-stats.js` 的重置信号改为复用 `parser.resolveContextInputTokens` 的上下文占用仲裁（缓存已扣除形态还原、未扣除形态保持原值）；缓存预热/命中与缓存 TTL 过期不再触发断崖误判（依赖 `context_window_size`/`used_percentage`，缺失时退回原始输入，该形态仍可能触发断崖），`/compact` 行为保持不变；`input_tokens` 缺失且 cache 计数为 0 时保持 `null`，不再把未知帧当成占用 0；
- **项目配置主题色可注入终端控制序列**：`runtime/config.js` 的 `resolveTheme` 对 theme 覆盖值执行白名单校验（调色板键 + 严格 SGR 序列或纯色名），阻断恶意仓库通过 `codebuddy-hud.config.json` 注入清屏、OSC 52 剪贴板写入等序列；非字符串值不再导致渲染抛错；
- **DCS/APC/PM/SOS 控制串 payload 残留**：`runtime/sanitize.js` 按 ECMA-48 整串吞到 ST（或未终止串结尾），并补齐 C1 单字节形式（`0x9B/0x9D/0x90` 等）；控制载荷不再以可见文本泄漏到看板；
- **`--doctor` 误报转义路径不存在**：statusLine 命令分词改为转义感知，并按「原样 → 反转义」双形态校验；含 `$`/引号/反斜杠的 POSIX 路径不再误报，Windows 未转义的 UNC 与 `$` 目录路径不受影响；引号内以反斜杠结尾的 Windows 路径在转义感知分词失败时回退旧分词，避免把 `"...\"` 误读为转义引号；
- **`--theme` 文案未国际化**：列表标题、用法提示、选择器标题/快捷键提示与预览框标题接入 `lang.js`；预览框按显示宽度（CJK 双列）计算边线，英文标题不再溢出右边框；未知主题参数与保存路径输出前经 `sanitizeTerminalText()`；
- **`--uninstall` 覆盖用户后续修改的 statusLine**：仅当当前 `statusLine` 仍指向本 HUD 时才还原安装前备份；用户装后替换或删除的配置保持不变，备份仍被消费删除。
- **一键安装 / `--uninstall` 破坏或误删用户 PATH 条目**：`scripts/install.ps1` 与 `runtime/uninstall.js` 改用注册表 API 读写 HKCU `Path`，保留 `%VAR%` 间接引用（`REG_EXPAND_SZ` 不再被压平为 `REG_SZ`）；卸载按归一化路径比较（忽略大小写、去除包裹引号与尾分隔符）并移除 runtime bin 目录，避免误删/漏删；
- **effort 会话状态并发读到半截 JSON**：`runtime/model-info.js` 的状态写入改为临时文件 + rename 原子替换。

### Performance & Hardening (性能与稳健性加固)
- **Git 探测去除 shell 壳进程并懒加载 `child_process`**：`runtime/git.js` 的 `git status` / `rev-parse` 改用 `execFileSync`，Windows 真实 spawn 帧约省 33ms；`child_process` 仅在 Git 探测或 Windows 编码探测时加载，普通帧约省 2ms。

### Documentation (文档对齐)
- **宿主 v2.171.0 兼容性复核与全量文档漂移对齐**：复核 CodeBuddy Code v2.171.0 逆向确证（3 行截断、10240 个 UTF-16 字符、5s 超时与离散事件）；全面对齐双语 README、双语架构文档、模块参考与 AGENTS.md 中关于 Cache 命中率超窗滑窗、Git 探测规范、代码页 300ms 超时与 60s probeTtlMs 短缓存、TypeScript 接口签名及 CLI 选肤交互说明。
- **文档漂移与冗余治理**：修正 README 错误列出的刷新事件（统一为 session / result / permission / settings / cost 五类）、镜像仅代理 raw 仍可安装的绝对化表述、卸载还原条件与环境变量清单；修正架构文档 Credits checkpoint 截断判据（`sourceSize`）、配置合并层级（4 次 deepMerge + 主题后处理）与依赖图缺边；修正模块参考中缓存徽章样式、`checkNodeVersion` 退出行为、`install.ps1` 下载源与新鲜度判定条件，并补齐三份状态文件 schema；AGENTS.md 收敛为硬约束与单一来源指针。

### Tests (测试)
- 单测用例增至 458 个（456 pass / 2 skipped），新增 CLI `--version` 与 `--help` 快速分发，新增缓存误判、零 cache 未知帧、未扣除载荷、主题注入、DCS/APC、doctor 转义与 Windows 尾反斜杠路径、theme 参数清洗、i18n 与卸载回滚等回归用例；`npm run verify` 与 `npm run verify:install` 各 10/10 通过。

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
  - 深入逆向确证 CodeBuddy Code v2.167.0 模块 254030：输出前 3 行截断（`eT=3`）、10240 个 UTF-16 字符 stdout 捕获上限（`eD=10240`，先判长度再追加）、5000ms 硬超时、5 类离散事件触发 300ms 去抖刷新、空闲与只读工具静默等运行机制；
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
- **宿主刷新机制与局限说明**：双语 README 新增独立章节，AGENTS.md 同步对齐 CodeBuddy Code v2.157.0 模块 54030/83451 逆向确证（短命子进程模型、5 个离散事件触发 300ms 防抖、空闲与只读工具静默）。
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

### Changed (变更与优化)
- **翡翠绿与赛博朋克主题视觉调优**：
  - 翡翠绿（`emerald`）：暗色模式升级为浅薄荷翠绿（ANSI 256 色代码 `121`，`\x1b[38;5;121m`），统一主色与 accent 强调色，大幅提升暗色终端背景下的文字对比度与通透感；
  - 赛博朋克（`cyberpunk`）：暗色模式主色升级为浅马卡龙粉紫（ANSI 256 色代码 `219`，`\x1b[38;5;219m`），与荧光青构成高对比霓虹撞色，视觉层次更鲜明；
  - 调色板引擎（`runtime/renderer/format.js`）：原生扩展支持 ANSI 256 色（`38;5;...`）及标准 Bright 高亮转义序列，增强转义码兼容性与色彩表现力。

### Fixed (缺陷修复)
- **非仓库目录重复执行 git 探测**：目录中存在 `.git` 但不是可用仓库时（残留/半初始化、HEAD 缺失），失败结果此前不落缓存，导致每次刷新都重复 fork 一次注定失败的 `git status`（实测 50~90ms，占单次运行 25% 以上）且拿不到分支段。现记录 60s 失败负缓存，并以 `headMtime` 自失效（目录变为真实仓库即重新探测）；`CODEBUDDY_HUD_NO_GIT_CACHE=1` 可绕过持久化缓存（进程内 5 秒非 git 目录负缓存仍生效）。
- **payload 缺失时静默无输出**：stdin 超时、超 1MB、读取错误或内容非法 JSON 时，HUD 输出 0 字节，宿主只判断退出码与文本，会把状态栏整块收起且不留任何错误。现向 `codebuddy-hud-error.log` 写入一行带原因的诊断（stdout 行为不变，仍不输出任何伪造数据）。

### Removed (移除)
- **第一行更新提示徽章与后台更新检查**：移除 Line 1 末的 `[↑ vX.Y.Z]` 新版本徽章及其全部支撑逻辑（`runtime/update-checker.js` 的 24h 后台检查、detached 子进程与状态写入），HUD 不再发起任何版本查询请求；`--uninstall` 仍会清理旧版本遗留的更新状态文件。

## [v0.3.2] - 2026-09-18

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

[Unreleased]: https://github.com/XisFool/codebuddy-hud/compare/v0.3.9...HEAD
[v0.3.9]: https://github.com/XisFool/codebuddy-hud/compare/v0.3.8...v0.3.9
[v0.3.8]: https://github.com/XisFool/codebuddy-hud/compare/v0.3.7...v0.3.8
[v0.3.7]: https://github.com/XisFool/codebuddy-hud/compare/v0.3.5...v0.3.7
[v0.3.5]: https://github.com/XisFool/codebuddy-hud/compare/v0.3.2...v0.3.5
[v0.3.2]: https://github.com/XisFool/codebuddy-hud/compare/v0.3.0...v0.3.2
[v0.3.0]: https://github.com/XisFool/codebuddy-hud/compare/v0.2.1...v0.3.0
[v0.2.1]: https://github.com/XisFool/codebuddy-hud/compare/v0.2.0...v0.2.1
[v0.2.0]: https://github.com/XisFool/codebuddy-hud/compare/v0.1.0...v0.2.0
[v0.1.0]: https://github.com/XisFool/codebuddy-hud/releases/tag/v0.1.0
