# CodeBuddy HUD (codebuddy-hud) — AGENTS.md

CodeBuddy Code 的 statusLine HUD：宿主在会话、结果、配置等事件后约 300ms 去抖，再把会话 JSON 从 stdin 喂入；空闲时不周期刷新。
HUD 同步输出 ≤3 行 ANSI 看板并退出。CommonJS，Node >=18。

## 硬约束（开发不可动摇规则）

1. **零 npm 依赖**：仅使用 Node.js 内置模块（`fs`, `path`, `readline`, `crypto`, `os`, `child_process`）。
2. **极速响应与恒 `exit(0)`**：
   - 单次预算 <1500ms（实际 p50 ~200ms；`runtime/bin/codebuddy-hud.js:13` 设 800ms 管道保底超时）。
   - 任何内部异常静默降级，入口监听 `process.stdout/stderr.on('error')` 防 EPIPE 崩溃；
   - 入口采用 `process.exitCode = 0` + 事件循环自然排空，防 stdout 异步管道截断。
3. **输出严格 ≤3 行**（`runtime/config.js:155` `display.maxLines: 3`）：结构上限 3 行，完全对齐宿主 CodeBuddy Code v2.146.0 实测截断（`stdout.split("\n").slice(0, 3)`，stdout 捕获上限 10KB），无数据行自动隐藏。
4. **终端安全防御**：所有外部文本必须经 `sanitizeTerminalText()`，剔除 ANSI CSI、OSC、C0/C1（`U+0080-U+009F`）及 Bidi 字符（`U+202E` 等）；`effort` 走白名单校验。
5. **数据真实性契约**：Cache 与 Credits 取自 transcript 真实遥测，绝不伪造或硬编码，无数据时优雅降级（如 `cache --`）。

## 架构（入口 → 数据流）

```
runtime/bin/codebuddy-hud.js   入口；--setup/--status/--uninstall/--theme/--doctor/-d
  ├ parser.js                  从 payload 提取 token/diff/cost
  ├ config.js                  内置 THEME_PRESETS、Dark/Light 模式解析与 deepMerge
  ├ theme-selector.js          TTY 实时所见即所得交互主题选择器
  ├ renderer.js                3 行组装
  │ ├ renderer/format.js       调色板 / 进度条 / cache 命中率
  │ ├ renderer/diff-render.js  Line 3 diff / credits / 耗时 / 工具活动段组装
  │ └ renderer/agents-render.js 工具活动与频次聚合格式化（供 Line 3 复用）
  ├ transcript.js              尾读 transcript（本轮工具频次聚合 + 本轮 usage 聚合）
  ├ session-stats.js           /clear 会话重置识别与 Diff/耗时逻辑基线管理
  ├ doctor.js                  --doctor 环境诊断（Node/配置/编码/Git/transcript）
  ├ update-checker.js          后台版本更新检查（24h 间隔、detached 子进程）
  ├ git.js / model-info.js / encoding.js / sanitize.js / paths.js
  ├ statusline-installer.js    --setup 写 settings.json
  ├ settings-file.js          JSONC 解析、配置权限与符号链接保护
  └ uninstall.js               --uninstall 清理配置、shim、缓存与状态
tests/fixtures/*.json          3 个 payload fixture
scripts/verify-display.js      E2E 看板与 CLI 命令形态契约验证
scripts/verify-install.js      隔离宿主安装/卸载生命周期契约验证
```

## 测试与验证命令

```bash
# 单元测试（推荐 npm test，底层脚本自动向 node --test 传参，兼容 Node 18~24+）
npm test
npm run verify                               # 11 个 E2E 场景（payload + CLI + 边界）
npm run verify:install                       # 隔离宿主真实安装与卸载验证
node runtime/bin/codebuddy-hud.js --status   # CLI 冒烟探测
node runtime/bin/codebuddy-hud.js --theme list
```

## 关键技术细节与避坑指南

1. **测试命令规范**：运行 `npm test`（或 `node scripts/run-tests.js`），自动向 `node --test` 喂入全量文件路径，彻底规避 Node 18/20 对 glob 不支持及 Windows 目录形式引发假阳性 `MODULE_NOT_FOUND` 的问题。
2. **Windows `.cmd` Shim**：烘焙安装时的 `process.execPath` 绝对路径（`statusline-installer.js`），不依赖系统 PATH；路径中 `%` 批量转义为 `%%`。
   - v2.146.0 的 Windows containment 启动器会二次转义字面引号。安装器对安全 ASCII 路径省略引号；含空格或 shell 特殊字符的路径仍需引号，存在宿主兼容限制。
   - `.cmd` 使用 UTF-8，必要时先 `chcp 65001`。不要改成 UTF-16LE；已实测 cmd.exe 无法正常执行该格式。
3. **终端编码探测缓存**：`chcp.com` 探测结果缓存在 `~/.codebuddy/codebuddy-hud-cache-state.json`（`encoding.js`）；`CODEBUDDY_HUD_FORCE_ASCII/UNICODE` 优先于缓存。
4. **错误日志轮转**：`~/.codebuddy/codebuddy-hud-error.log` 超过 1MB 自动重置，防高频刷新写满磁盘。
5. **Cache 命中率口径**：
   - 遥测仅存在于 transcript 的 `providerData.rawUsage`（避开 `cache_read_input_tokens: 0` 陷阱字段）；
   - `rawUsage.prompt_tokens` 有效时依次取 `prompt_cache_hit_tokens`、`prompt_tokens_details.cached_tokens`、`cached_tokens`，缺失则为 0；否则以 `usage.inputTokens` 和 `inputTokensDetails[].cached_tokens` 聚合兜底。不要使用该 provider 的陷阱字段 `cache_read_input_tokens`；
   - 聚合范围：`getTurnUsageMetrics()` 从 EOF 回扫至 `role: 'user'`，展示本轮聚合（`sum(hitTokens) / sum(promptTokens)`），非单次调用瞬时值；
   - 三态契约：`null`（不渲染）、`{available:false}`（`cache --`）、`{available:true, X%}`（正常数值）。
6. **Token、变更与 Credits 口径**：
   - Token 资源块（Line 2）显示当前上下文 `inTokens + outTokens`，进度条分子严格使用 `inTokens`（与 `used_percentage` 同基底）；
   - 变更摘要（Line 3）以 Unicode `Δ` 开头，ASCII fallback 为 `[D]`；
   - Credits（Line 3）为当前 transcript 会话的增量累计实际消费，按 transcript 独立缓存状态；扫描预算耗尽且尚未完成时隐藏累计值，不能把已扫描前缀或 payload 兜底显示为总额。
7. **配置防御与降级**：
   - 项目配置里的 `__proto__` 键被 `deepMerge` 跳过；合并深度上限 64 防爆栈；
   - transcript 回扫上限 256KB，遇到超长单行优雅降级回退到 payload 兜底。
8. **安装卸载测试隔离**：同时隔离 `CODEBUDDY_HOME`、`CODEBUDDY_SETTINGS_PATH` 和 runtime。仅指定临时 settings 不能隔离 shim 删除；CLI 测试必须调用临时 runtime 副本。
9. **配置写入**：JSONC 处理不能改动字符串内容；原子替换须保留现有 POSIX 权限和符号链接，失败时保留原配置与备份。新配置及首次备份默认私有权限。
10. **Payload 无 agents/tasks 与工具活动来源**：
    - 宿主 statusLine payload 并不存在 `agents` 或 `tasks` 字段（源码逆向确认宿主未构造此二键）；
    - 真实工具活动取自 transcript 真实遥测（`type: 'function_call'` 和 `type: 'function_call_result'`），由 `runtime/transcript.js` 解析；
    - 工具活动并入 Line 3 尾部展示；payload fixtures 中不应包含假造的 `agents`/`tasks` 字段。
11. **/clear 换新 transcript 的基线交接（handoff）**：
    - 宿主 /clear 后会切换到全新 transcript 文件（实测换文件而非截断），per-identity 状态失联，且所有 reset 信号都要求 `previous` 存在，进程级累计 Δ/⏱ 会全额漏显；
    - `session-stats.js` 另存按 cwd 寻址的 handoff 记录（`codebuddy-hud-session-state/handoff-<sha256(cwd)>.json`），每次刷新写入最新原始累计 cost；
    - identity 未命中时读取 handoff：cost 累计序列未下跌（同宿主进程延续）→ 继承其值为新基线，Δ/⏱ 归零；cost 下跌（新宿主进程启动）或 cwd 不同 → 不继承。
    - 已漏显的旧会话状态无法自愈，下一次 /clear 起生效。

## 提交风格

- 提交前运行 `npm test`、`npm run verify` 及 `npm run verify:install`；用例数量以当次输出为准。
- Commit message 必须使用中文。

## 发布流程

1. 更新 `package.json` 版本与 `CHANGELOG.md`，并完成全部验证命令。
2. 在发布提交上创建带注释的 `vX.Y.Z` tag，推送 `master` 与 tag。
3. 以该 tag 创建正式 GitHub Release；默认安装和更新检查均以 Latest Release 的 `tag_name` 为准。
4. 从公开 Release 下载 Bootstrap，在隔离 `CODEBUDDY_HOME` 中执行真实远程安装，确认 `--status` 退出码为 0。
