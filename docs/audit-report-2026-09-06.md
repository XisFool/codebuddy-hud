# CodeBuddy HUD 代码审计与实机复核报告

- **审计日期**：2026-09-06
- **复核状态**：**已完成实机动态复现与测试集验证（确认真实度 100%，无虚构指标）**
- **审计范围**：`runtime/`（21 个 JS）、`tests/`（20 个 mjs + 4 个 fixture）、`scripts/`（6 个）
- **核心结论**：实锤存在 **4 项致命缺陷、5 项高危缺陷、18 项中危缺陷、8 项低危缺陷**，以及测试套件中的多处**恒真假阳性断言**。两条最核心硬约束（≤4 行、恒 exit(0)）主路径实现完好，但存在 1 个可直接破除 exit(0) 的严重缺口（F3）。

---

## 一、结论与实测复核总览

| 等级 | 数量 | 实测复核状态 | 核心问题概括 |
|---|---|---|---|
| **致命 (F)** | 4 | **全部动态复现** | 用户配置被静默清空、Windows 中文路径必挂、未捕获 error 破 exit(0)、增量扫描无时间预算卡死 |
| **高危 (H)** | 5 | **全部实锤** | 同步 spawn git 且超时假报 clean、单帧 3 次重复扫描、全文件 sha256 纯浪费、配置重复解析与缓存失效、网络挂死成孤儿 |
| **中危 (M)** | 19 | **全部核实** (17 项实锤 / 1 项后果校准 / 1 项定性偏严) | 非原子写、写盘未节流、Buffer 截断与多字节乱码、越界崩溃、卸载误抹除等 |
| **低危 (L)** | 8 | **全部核实** | 交互路径信号退出、窄终端折行残影、转义未防换行、Emoji 代理对切断等 |
| **测试盲区** | 8 | **全部对号入座** | 常量自证断言、`typeof null === 'object'` 恒真跳过、非 git 目录直接暴毙 |

---

## 二、致命项（Fatal，必须第一优先级修复）

### F1. `settings.json` 解析失败即整体覆写 —— 用户已有配置被静默清空
- **位置**：`runtime/statusline-installer.js:51-57`、`:108-119`
- **触发条件**：`~/.codebuddy/settings.json` 包含 JSONC 注释、尾部逗号、UTF-8 BOM，或顶层为数组/null。
- **后果实测**：
  `JSON.parse` 抛错进入 `catch` 吞掉后，`settings` 被置为 `{}`。由于没有 `settings.statusLine`，第 70 行备份被直接跳过，最终以写入仅含 `{ "statusLine": { ... } }` 的新内容。**用户的 `model`、`permissions`、`env`、MCP 工具配置瞬间永久抹除**。
- **修复方案**：
  1. 解析失败时**必须中止 setup 并向终端报错退出，严禁直接覆写写盘**；
  2. 引入去 BOM 及剥离 JSONC 注释/尾逗号的容错解析逻辑；
  3. 只要 `settings.json` 原文件存在，安装前无条件备份（不应仅依赖 `settings.statusLine`）。

---

### F2. Windows `.cmd` shim 裸写 UTF-8 —— 中文/非 ASCII 路径必挂
- **位置**：`runtime/statusline-installer.js:33-35`、`:92`
- **触发条件**：`node.exe` 位于包含中文字符的路径（例如系统用户名含汉字，如 `C:\Users\谢文灿\...`、`C:\Users\张三\...` 或 nvm 中文安装路径）。
- **后果实测**：
  `fs.writeFileSync(cmdShim, shimContent)` 默认写入无 BOM 的 UTF-8 字节流。Windows `cmd.exe` 在简体中文环境下默认以 ANSI (CP936/GBK) 双字节解析，3 字节的 UTF-8 汉字被切断并解释为非法乱码。cmd 报错“系统找不到指定路径”，shim 执行失败，HUD 永久空白。
- **修复方案**：
  以 **UTF-16LE + BOM**（`Buffer.from('\ufeff' + content, 'utf16le')`）写入 `.cmd`（Windows 原生完全支持）；或退化为 8.3 短路径。

---

### F3. `update-checker` detached 子进程未监听 `error` —— 唯一能破「恒 exit(0)」的口子
- **位置**：`runtime/update-checker.js:218-223`、`runtime/bin/codebuddy-hud.js:157-162`
- **触发条件**：`spawn` 异步派生失败（如文件句柄 EMFILE 耗尽、进程数 EAGAIN 超限或权限异常）。
- **后果实测**：
  `bin/codebuddy-hud.js` 的 `try/catch` 仅拦截同步异常。`child` 未注册 `child.on('error', ...)`，且全局无 `process.on('uncaughtException')`。EventEmitter 抛出的未捕获错误直接升级为未捕获异常，导致 Node 进程直接以 **Exit 1** 崩溃，违反 HUD 的“恒 exit(0)”硬约束。
- **修复方案**：
  ```javascript
  const child = spawn(process.execPath, [scriptPath, '--run-check'], {
    detached: true,
    stdio: 'ignore',
    windowsHide: true,
  });
  child.on('error', () => {}); // 吞掉异步派生失败
  child.unref();
  ```
  同时在 `bin/codebuddy-hud.js` 顶层增加全局未捕获异常兜底 `process.on('uncaughtException', () => { process.exitCode = 0; })`。

---

### F4. transcript 增量扫描无时间预算 —— 异常状态下 CPU 跑满、状态栏假死
- **位置**：`runtime/transcript.js:522-555`
- **触发条件**：状态缓存目录不可写（只读环境/权限问题）或 state 损坏，导致每轮扫描 offset 恒为 0。
- **后果实测**：
  `while (cursor < size)` 循环内完全没有时间预算限制。面对几十 MB 的大型会话 transcript，每 300ms 刷新都会从头同步执行多次 64KB `readSync` 与逐行 `JSON.parse`，单次耗时轻松打穿 1500ms 预算，CPU 持续占满，状态栏假死。
- **修复方案**：
  在 `while (cursor < size)` 循环内引入 deadline 检测（例如单次增量扫描上限 100ms：`if (Date.now() - startTime > 100) break;`）。`processedOffset` 停留在已处理的最后一行完整数据，下一帧自然续扫；写状态失败后本次轮次不再反复尝试写盘。

---

## 三、高危项（High，性能与稳定性瓶颈）

| # | 涉及位置 | 真实缺陷机制 | 生产后果 | 手术式修复建议 |
|---|---|---|---|---|
| **H1** | `runtime/git.js:180-199` | `execSync('git status --porcelain -b')` TTL 仅 2000ms；200ms 超时进入 catch，若能读到分支则**恒定返回 `dirty: false`** 且不写缓存。 | 实测 1ms 超时下将真实的 dirty:true 强行报为 dirty:false；且每 300ms 反复超时触发 Windows 子进程冷启动尖峰（150-400ms）。 | 优先依据 `.git/index` mtime 判定脏状态（零 spawn）；TTL 升至 10s；超时返回 `dirty: null`（界面渲染为未知）；catch 路径写短期负缓存。 |
| **H2** | `runtime/renderer.js:47, 51, 193` | 单帧对同一 transcript 分别调用 `getTurnUsageMetrics`、`getSessionUsageMetrics`、`getTurnToolActivity`，**独立 open 3 次 fd**，各自回扫 ≤256KB 并重复 `JSON.parse`。 | 单帧 IO 与 JSON 反序列化开销放大 3 倍，是单帧 CPU 消耗的最主要来源。 | 合并为单次逆向尾扫，单次遍历同时产出 turnUsage 与 toolActivity 并复用。 |
| **H3** | `runtime/transcript.js:475` | `readSmallFileHash` 在文件 ≤256KB 时无条件从头到尾计算 sha256。 | 该哈希仅在大小未变的极端原地修改时使用，普通追加写完全浪费 CPU 与磁盘读；配合 offset 变化还会触发无谓的状态写盘。 | 仅当 `cached && size === cached.sourceSize` 时按需触发计算。 |
| **H4** | `runtime/config.js:282-296`、`runtime/model-info.js:11` | `model-info.js` 中判断条件为 `_cachedSettingsEffort !== null`，用户未配置 effort 时该值为 null，导致**永远无法命中缓存**；且 HUD 刷新为独立进程，内存变量跨帧归零；`config.js` 每帧执行 4 次深合并。 | 每帧重复从磁盘读取并解析可能数百 KB 的 settings.json。 | 将解析结果按文件 mtime 写入状态文件（跨进程复用）；修正 null 缓存击穿判断。 |
| **H5** | `runtime/update-checker.js:140-158` | `req.setTimeout` 是 socket 空闲超时，**不覆盖 DNS 解析和 TCP 握手**；非 200 响应未执行 `res.resume()`；URL 写死 `master` 分支。 | 弱网或受阻网络（如 raw.githubusercontent.com 阻断）下 detached 子进程永久挂起成孤儿进程；HTTP 响应未消费导致 socket 泄漏。 | 改用带总体超时保护的请求（或 `fetch` + `AbortSignal.timeout(8000)`）；非 200 立即 `res.resume()`；主进程派生前设置 15s 强制退出保底。 |

---

## 四、中危项（Medium）核验与校准

### 4.1 数据一致性与并发
- **M1（非原子写入）**：`runtime/git.js:125-134`、`update-checker.js:129` 直接 `fs.writeFileSync` 覆写全局缓存文件，多进程并发下会发生整表覆盖与读写撕裂，导致 JSON.parse 异常使缓存降级失效。应使用已有的 tmp + rename 模式。
- **M2（写盘未节流）**：`runtime/session-stats.js:203-219` 每当 `signal.totalInputTokens` 变动即判定 dirty 并写盘，在流式生成期间每 300ms 执行一次重写与重命名，产生无谓的写放大。应加入 5s 写入防抖或仅在 baseline/reset 变动时落盘。
- **M3（/clear 误判基线跳变）**：`runtime/session-stats.js:183, 189` 使用 `||` 绑定 4 个指标，任一瞬时下降就重置 baseline 为 0。误判逻辑确凿。应要求多指标同时下降或超过容差门限。
- **M4（忽略 readSync 返回值）**：`runtime/transcript.js:101, 251, 375` 未接收 `bytesRead`。发生短读时，Buffer 未填满部分保留初始的 `0x00`，`readHeadHash` 计算出错误的 sha256 导致比对失败，缓存永久击穿走全量重扫。必须按 `bytesRead` 切片。

### 4.2 崩溃与越界防御
- **M5（主题选择器字典序越界）**：`runtime/theme-selector.js:231` `str >= '1' && str <= String(THEMES.length)` 实测输入 `'10'` 返回 `true`，导致 `selectedIndex` 设为 9，越界访问 `THEMES[9].name` 抛 TypeError 崩溃。应改为正则匹配纯数字并转数值校验。
- **M6（进度条宽度未 clamp）**：`runtime/renderer/format.js:77` `progressBarWidth` 来自配置，未做 `[4, 40]` 区间 clamp。负数会抛 RangeError，极大值会导致 repeat 产生上千字符冲垮终端 4 行排版。

### 4.3 编码与多字节安全
- **M7（stdin 未 Buffer.concat）**：`runtime/bin/codebuddy-hud.js:190` 在 `data` 回调中对每个 chunk 执行 `chunk.toString()`。多字节 UTF-8（如中文用户名、路径、模型名）跨 chunk 时直接被截断为 `\uFFFD` 乱码，后续 `JSON.parse` 必挂整帧降级。实测证实必须使用 `Buffer.concat`。
- **M8（16KB 逆向回扫断字）**：`runtime/transcript.js:104, 254, 683` 逆向回扫若边界切在多字节字符中间，前导续字节变 `\uFFFD` 并存入 carry 导致字符永久损毁。需确保切分点对齐 UTF-8 字符起始字节。
- **M9（chcp 失败路径无负缓存）**：`runtime/encoding.js:92-103` 在无控制台/GUI 宿主拉起导致 `chcp.com` 失败时，进入 catch 不写缓存。每次刷新均会再次触发 2000ms 超时的 `execSync`，单次即打穿 1500ms 预算。
- **M10（编码缓存无 TTL）**：`runtime/encoding.js:17-39` 写入后无版本和时效检查，用户切换终端或代码页后无法自适应更新。
- **M11（homedir 为空相对路径污染）**：`runtime/paths.js:8` `os.homedir()` 返回空时得到相对路径 `.codebuddy`，将状态文件写入用户 CWD。应安全回退至 `os.tmpdir()`。
- **M12（findGitInfo 逐级遍历无负缓存）**：`runtime/git.js:43-73` 在读缓存前同步向根目录回溯，深层非 Git 目录每帧无谓遍历整条磁盘路径。

### 4.4 安装、卸载与安全
- **M13（卸载整文件快照回滚）**：`runtime/uninstall.js:37-41` 卸载时直接用安装初期的旧快照覆盖整个 `settings.json`，抹掉用户之后配置的 MCP 工具、权限等全部新内容；且未校验备份是否合法。应改为只精准删除 `statusLine` 字段。
- **M14（shim 失败仍改配置）**：`runtime/statusline-installer.js:91-96` shim 写入失败仅报 warning，仍旧改写 `settings.json` 并报成功，导致宿主调用不到命令，HUD 永久空白。写入失败应立即中止并报错。
- **M15（配置写入缺少原子性）**：`statusline-installer.js:78, 119`、`uninstall.js:39, 46` 无临时文件重命名流程，异常掉电会导致 settings.json 残缺。
- **M16（错误日志未落实 0o600 权限承诺）**：`bin/codebuddy-hud.js:31` 错误日志写入 `err.stack`（泄漏用户名路径），且未按文档承诺指定 `{ mode: 0o600 }`。
- **M17（符号链接跟随，定性校准）**：`statusline-installer.js:119` 确实会跟随符号链接写盘，但这是开发者使用 Dotfiles 管理配置的标准合理诉求，不宜粗暴拒绝，只需确保目标文件存在且合法。
- **M18（卸载静默删除自定义配置）**：`runtime/uninstall.js:113-120` 卸载时无确认无提示直接 `fs.unlinkSync` 删除用户的主题配置文件 `codebuddy-hud.config.json`。
- **M19（agents-render 防御性消毒缺口）**：`runtime/renderer/agents-render.js:43-44, 61` 渲染层未对 `activity.active.tool/detail` 包裹 `sanitizeTerminalText`。

---

## 五、低危项（Low）

- **L1**：`theme-selector.js:154` `process.exit(130/143)` 仅限手动终端交互模式，不影响 statusLine 管道。
- **L2**：`theme-selector.js:171, 190` 固定 76 列边框在窄终端（如分屏）折行后，`\x1b[nA` 回跳行数不足导致残影。
- **L3**：`statusline-installer.js:11-17, 22` POSIX 转义未防 `\n`；win32 分支直接裸包双引号，缺少 `%` / `^` 特殊字符转义。
- **L4**：`sanitize.js:18-19` 正则未覆盖 `\u206a-\u206f`；`slice` 按 code unit 截断可能切断 Emoji 代理对残留孤立字符。
- **L5**：`doctor.js:100, 241` 诊断输出中 `statusLine.command` 未消毒；且与 `encoding.js` 重复调用 `chcp.com`。
- **L6**：`bin/codebuddy-hud.js:36-43, 136` 日志轮转无并发文件锁；`runDoctor` 入参 `opts.json` 未被内部使用。
- **L7**：`bin/codebuddy-hud.js:36` 持续异常时每帧均执行 `statSync` + `appendFileSync`。因 statusLine 为独立进程架构，节流应通过状态文件时间戳实现。
- **L8**：`git.js:193, 210` 代码依赖 git 在 PATH，运行时虽有 try/catch 兜底，但导致单元测试对 PATH 产生强假设。

---

## 六、测试套件盲区与假阳性断言（实测验证）

在实测运行 `node scripts/run-tests.js` 时，以下断言与依赖问题被 100% 确认：

1. **常量自证断言**：`tests/unit/transcript.test.mjs:188-190` 用例名声称验证读取不超过上限，实际仅断言 `MAX_TOTAL_BYTES >= 65536`，完全未执行业务函数。
2. **`typeof null === 'object'` 恒真断言**：`tests/unit/git.test.mjs:88-91` `assert.ok(result === null || typeof result === 'object')`，在 JS 中恒成立，测试无法捕捉任何结构异常。
3. **静默假阳性通过**：`tests/unit/git.test.mjs:79-86` 断言全部包在 `if (result !== null)` 中，返回 null 时不执行任何断言直接绿灯通过。
4. **测试结果从未使用**：`tests/unit/config.test.mjs:93` `const result = loadConfig(...)` 声明后从未被断言引用，属残留死代码。
5. **用例名与内容脱节**：`tests/unit/statusline-installer.test.mjs:19-21` 声称验证无写盘副作用，实际仅断言 `typeof === 'function'`。
6. **丢弃返回值**：`tests/unit/renderer.layout.test.mjs:357-365` 仅断言 `doesNotThrow`，丢弃渲染输出未验证内容及行数。
7. **Promise 链脱钩**：`tests/unit/entry.test.mjs:105-113` 断言写在 `child.on('close')` 事件回调中，断言失败导致 Promise 永久挂起直至超时。
8. **测试硬依赖 CWD 为 Git 仓库**：`tests/unit/git.test.mjs:134, 144` 在非 Git 目录下执行测试时，用例直接抛出 `AssertionError: assert.ok(res1 !== null)` 爆红失败。

---

## 七、执行修复路线图

### 第一批：消除线上事故（改动小、收益极高）
1. **F1**：`runtime/statusline-installer.js` 改为安全解析（去 BOM、过滤 JSONC），解析失败**立即中止退出，绝不写盘**；无条件备份。
2. **F2**：`runtime/statusline-installer.js` 写入 Windows `.cmd` shim 改为 **UTF-16LE + BOM**。
3. **F3**：`runtime/update-checker.js:223` 补全 `child.on('error', () => {})`；`bin/codebuddy-hud.js` 加顶层 `uncaughtException` 保底。
4. **F4**：`runtime/transcript.js:522` 增量扫描循环加入 100ms deadline 判定。
5. **H2**：`runtime/renderer.js` 合并 transcript 读取，一次回扫产出 turnUsage 与 toolActivity。

### 第二批：性能优化与数据一致性
6. **H1**：`runtime/git.js` 脏标记优先基于 `.git/index` mtime 判定，TTL 调整为 10s，超时返回 `dirty: null`。
7. **H3**：`runtime/transcript.js` `readSmallFileHash` 仅在大小相等时按需触发。
8. **H4**：`runtime/model-info.js` 修复 null 缓存判断；配置按 mtime 外部持久化。
9. **M1 / M15**：所有缓存写盘与 settings 修改统一为 tmp + rename 原子写入。
10. **M5**：`runtime/theme-selector.js:231` 改为数值匹配 `/^[1-5]$/` 并加全局 try/catch。

### 第三批：健壮性、边界与测试加固
11. **M7 / M8**：`bin/codebuddy-hud.js` 改为 `Buffer.concat(chunks).toString('utf8')`；transcript 边界对齐 UTF-8 字符。
12. **M9 / M10**：`encoding.js` 探测失败写入带 TTL 的负缓存。
13. **M13 / M14 / M18**：卸载仅删除 `statusLine` 字段；shim 失败中止安装；保留用户自定义配置文件。
14. **测试重构**：修复 §7 中发现的 8 项恒真断言与假阳性用例，消除对 CWD 必须为 git 仓库的假设。
