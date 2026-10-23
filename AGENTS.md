# CodeBuddy HUD (codebuddy-hud) — AGENTS.md

CodeBuddy Code 的 statusLine HUD：宿主在 **session / result / permission / settings / cost** 五类离散事件后约 300ms 去抖，将 JSON 从 stdin 喂入；HUD 同步输出 ≤3 行 ANSI 看板后退出。CommonJS，Node >=18。

## 硬约束

1. **零 npm 依赖**：仅用 Node 内置模块（`fs`/`path`/`readline`/`crypto`/`os`/`child_process`/`https`/`http`）。
2. **恒 `exit(0)` 且极速**：预算 <1500ms（p50 ~200ms），stdin 保底 800ms；内部异常静默降级，监听 stdout/stderr error 防 EPIPE；用 `process.exitCode = 0` + 自然排空，禁用 `process.exit()`。
3. **严格 ≤3 行**：宿主 v2.171.0 取 stdout 前 3 行、捕获上限 10240 个 UTF-16 字符（先判长度再追加）；`display.maxLines` 结构上限 3；无数据行隐藏，字段缺失用 `--`。
4. **终端安全**：所有外部文本经 `sanitizeTerminalText()`（ANSI/OSC/DCS/APC/PM/SOS、C0/C1、Bidi）；`effort` 白名单；主题值经 `resolveTheme` 的 SGR 白名单。
5. **数据真实**：Cache 严格取自 transcript（无 payload 兜底，缺失 `cache --`）；Credits 优先 transcript 增量，仅完全无 transcript 遥测时回退 payload `cost.credits`；扫描未完成时隐藏。绝不伪造。

## 架构

```
runtime/bin/codebuddy-hud.js   入口；--setup/--status/--uninstall/--theme/--doctor|-d [--json]/--update/--version|-v/--help|-h
  ├ parser.js / config.js / model-info.js          payload 解析、配置/主题合并、effort/credits
  ├ renderer.js + renderer/{format,diff-render,agents-render}.js  3 行组装与分段渲染
  ├ transcript.js / session-stats.js               transcript 遥测、/clear 基线与 /compact 新鲜度
  ├ git.js / encoding.js / sanitize.js             环境探测与终端安全
  ├ paths.js / lang.js                             状态路径与 i18n
  ├ statusline-installer.js / settings-file.js     settings.json 原子写入、shim、技能挂载
  ├ uninstall.js / update-checker.js               卸载清理、主动更新
  ├ doctor.js / theme-selector.js                  诊断、交互换肤
  └ codebuddy-hud.config.json                      内置默认配置（theme/display/thresholds）
tests/fixtures/*.json      3 个 payload fixture
tests/unit/*.test.mjs      25 个单元测试文件
scripts/                   install.ps1/.sh、bootstrap.js、run-tests.js、verify-*.js
.codebuddy-plugin/plugin.json · skills/hud-config/SKILL.md   插件元数据与伴生技能
```

> **单一来源**：宿主时序/上限/降级 → [architecture_zh.md](docs/architecture_zh.md)（英文 [architecture.md](docs/architecture.md)）；模块签名/常量/状态 schema/环境变量 → [module-reference.md](docs/module-reference.md)；用户安装/升级/卸载 → [README.md](README.md) / [README_en.md](README_en.md)。本文件只保留硬约束、高频陷阱与指针。

## 测试与验证

```bash
npm test                     # 全量单测（run-tests.js 自动喂全量路径，兼容 Node 18~24+）
npm run verify               # 10 个 E2E 场景
npm run verify:install       # 隔离宿主安装/卸载
node runtime/bin/codebuddy-hud.js --status
```

## 关键陷阱

1. **测试隔离**：改动后必须 `npm test` + 2 个 verify 全绿；测试同时隔离 `CODEBUDDY_HOME`、`CODEBUDDY_SETTINGS_PATH` 与 runtime 副本。
2. **Windows `.cmd`**：烘焙 `process.execPath`；`%`→`%%`；非 ASCII 路径用 8.3 短路径并前置 `@chcp 65001 >nul`；安全 ASCII 路径省略引号、含空格保留；UTF-8，严禁 UTF-16LE。
3. **编码探测**：`spawnSync('chcp.com')` 免 shell、超时 300ms；成功缓存 1h，失败当帧 ASCII 且仅缓存 60s（`probeTtlMs`）；`FORCE_ASCII/UNICODE` 优先。
4. **错误日志**：`~/.codebuddy/codebuddy-hud-error.log` 超 1MB 自动重置。
5. **Cache 口径**：仅 transcript `providerData.rawUsage`（避开 `cache_read_input_tokens: 0` 陷阱）；从 EOF 回扫至多 200 条/256KiB，超窗滑至最近调用，口径为「近期调用命中率」`sum(hit)/sum(prompt)`，非整轮平均；三态 `null` / `{available:false}` / `{available:true}`。
6. **Token/Credits**：进度条分子用还原后的 `inTokens`（与 `used_percentage` 同基底）；`input_tokens` 被扣为 0 时按 `combined = rawInput + cacheRead + cacheCreation` 还原，未扣减时按 `used_percentage` 残差仲裁防翻倍；`out` 独立；`/compact` 后旧 usage 显示 `--`；Credits 未扫完隐藏。
7. **配置与写入**：`deepMerge` 跳过 `__proto__`、深度上限 64；JSONC 不改字符串内容，原子替换保留 POSIX 权限与软链，新配置/首次备份 `0600`。
8. **Payload 与工具**：payload 无 `agents`/`tasks`；工具活动取自 transcript 的 `function_call`/`function_call_result`，并入 Line 3。
9. **/clear**：宿主切换新 transcript；identity miss 即新会话，当前 payload 直接锚定新基线，Δ/⏱ 归零；无跨 identity handoff（旧机制已退役，存量由 uninstall 清理）。
10. **/compact**：payload `current_usage` 取最近真实 API usage（跳过 compact），压缩后下一次响应前仍是旧值；HUD 读 transcript compact 摘要，旧 usage 时显示 `--` 等待。
11. **宿主 5s 误杀**：宿主事件循环阻塞 ≥5s 时 timers 先于 close，已完成的 HUD 也会被判超时并清空状态栏；HUD 侧无法阻止。日志搜 `Status line command failed`；完整结论见 architecture §4。
12. **技能与更新**：`--setup` 挂载 `skills/hud-config`（Junction/软链/复制三级降级），`--uninstall` 对称清理；`--update` 仅用户主动触发、渲染路径零网络，细节见 module-reference §21。
13. **Git**：Direct HEAD 零派生；`execFileSync` 免 shell（200ms）；10s 正缓存、无 HEAD 的 60s 失败负缓存、非 git 不派生；`child_process` 懒加载。细节见 module-reference §12。

## 提交与发布

- 提交前必须通过 `npm test`、`npm run verify`、`npm run verify:install`；用例数以当次实际输出为准，严禁带错提交。
- Commit message 使用中文。
- 发布：更新 `package.json` 与 `CHANGELOG.md` → 全量验证 → 创建注释 tag `vX.Y.Z` → 推送 master 与 tag → 创建 GitHub Release → 在隔离 `CODEBUDDY_HOME` 中真实远程安装并确认 `--status` 退出码 0。
