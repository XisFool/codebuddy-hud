# CodeBuddy HUD (codebuddy-hud) — AGENTS.md

CodeBuddy Code 的 statusLine HUD：宿主在会话、结果、配置等事件后约 300ms 去抖，再把会话 JSON 从 stdin 喂入；空闲时不周期刷新。
HUD 同步输出 ≤4 行 ANSI 看板并退出。CommonJS，Node >=18。

## 硬约束（开发不可动摇规则）

1. **零 npm 依赖**：仅使用 Node.js 内置模块（`fs`, `path`, `readline`, `crypto`, `os`, `child_process`）。
2. **极速响应与恒 `exit(0)`**：
   - 单次预算 <1500ms（实际 p50 ~200ms；`runtime/bin/codebuddy-hud.js:13` 设 800ms 管道保底超时）。
   - 任何内部异常静默降级，入口监听 `process.stdout/stderr.on('error')` 防 EPIPE 崩溃；
   - 入口采用 `process.exitCode = 0` + 事件循环自然排空，防 stdout 异步管道截断。
3. **输出严格 ≤4 行**（`runtime/config.js:155` `display.maxLines: 4`）：结构上限 4 行，无数据行自动隐藏。
   - CodeBuddy Code v2.146.0 实测仅保留 stdout 前 3 行；HUD 的输出上限与宿主显示上限是两个契约。
4. **终端安全防御**：所有外部文本必须经 `sanitizeTerminalText()`，剔除 ANSI CSI、OSC、C0/C1（`U+0080-U+009F`）及 Bidi 字符（`U+202E` 等）；`effort` 走白名单校验。
5. **数据真实性契约**：Cache 与 Credits 取自 transcript 真实遥测，绝不伪造或硬编码，无数据时优雅降级（如 `cache --`）。

## 架构（入口 → 数据流）

```
runtime/bin/codebuddy-hud.js   入口；--setup/--status/--uninstall/--theme/--doctor/-d
  ├ parser.js                  从 payload 提取 token/diff/cost/agent
  ├ config.js                  内置 THEME_PRESETS、Dark/Light 模式解析与 deepMerge
  ├ theme-selector.js          TTY 实时所见即所得交互主题选择器
  ├ renderer.js                4 行组装
  │ ├ renderer/format.js       调色板 / 进度条 / cache 命中率
  │ ├ renderer/diff-render.js
  │ └ renderer/agents-render.js Line 4 工具活动与频次聚合
  ├ transcript.js              尾读 transcript（本轮工具频次聚合 + 本轮 usage 聚合）
  ├ session-stats.js           /clear 会话重置识别与 Diff/耗时逻辑基线管理
  ├ doctor.js                  --doctor 环境诊断（Node/配置/编码/Git/transcript）
  ├ update-checker.js          后台版本更新检查（24h 间隔、detached 子进程）
  ├ git.js / model-info.js / encoding.js / sanitize.js / paths.js
  ├ statusline-installer.js    --setup 写 settings.json
  ├ settings-file.js          JSONC 解析、配置权限与符号链接保护
  └ uninstall.js               --uninstall 清理配置、shim、缓存与状态
tests/fixtures/*.json          4 个 payload fixture
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

## 提交风格

- 提交前运行 `npm test`、`npm run verify` 及 `npm run verify:install`；用例数量以当次输出为准。
- Commit message 必须使用中文。
