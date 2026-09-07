# CodeBuddy HUD 维护文档

实现约束以 [AGENTS.md](../AGENTS.md) 为准。本文档索引不重复维护模块签名和测试数量。

| 文档 | 用途 |
| --- | --- |
| [用户说明](../README.md) | 安装、主题、排障、数据口径与宿主兼容限制 |
| [架构说明](architecture.md) | 英文数据流、遥测扫描、会话基线与运行约束 |
| [中文架构说明](architecture_zh.md) | 相同核心行为的中文说明 |
| [模块参考](module-reference.md) | 模块职责、公开接口与状态结构 |
| [发布规范](../AGENTS.md#发布流程) | 版本、变更记录、tag 与 GitHub Release 验证 |
| [变更记录](../CHANGELOG.md) | 已发布版本的变更摘要 |
| [2026-09-06 复核记录](audit-report-2026-09-06.md) | 当日回归、修复依据与尚存限制 |
| [早期审计交接](audit-handoff-report.md) | 2026-09-02/03 的历史决策，不代表当前验收状态 |

## 修改前需要知道

- 每次状态栏调用启动新 Node 进程。宿主 v2.146.0 按事件触发并约 300ms 去抖，空闲时不周期刷新。
- HUD 输出最多 3 行，与该宿主的前 3 行截断上限严格对齐。Windows 启动器的引号限制见用户说明。
- Cache 与 Credits 来自真实遥测。会话 Credits 扫描未完成时隐藏累计值，checkpoint 可供后续调用续扫。
- 状态栏以 `process.exitCode = 0` 自然排空 stdout；800ms stdin 定时器不是同步磁盘操作的抢占式硬超时。总执行预算为 1500ms。
- 配置处理必须保留字符串、权限及符号链接语义。普通缓存的最佳努力写入不能替代用户配置的保护措施。
- 更新检查在 spawn 前记录时间戳，减少连续重复派生；这不是跨进程互斥锁，不能宣称彻底消除并发竞争。

## 验证

```bash
npm test
npm run verify
npm run verify:install
```

安装卸载测试须同时隔离用户目录、settings 路径及 runtime。仅设置 `CODEBUDDY_HOME` 仍可能删除真实仓库旁的 `.cmd` shim。

涉及 POSIX 权限或符号链接时应在 Linux 上运行对应测试；Windows 下跳过的平台专属测试不算该行为已经验证。现有 CI 覆盖 Linux、Windows、macOS 的 Node 18/20/22。
