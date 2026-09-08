# CodeBuddy HUD 深度设计与参考文档

开发约束与工作流契约以 [AGENTS.md](../AGENTS.md) 为唯一权威源。本文档作为 `docs/` 目录的上下文路由索引（Router），供 Agent 与开发者在特定开发分支下按需深入查阅。

## 文档路由与触发分支 (Context Pointers)

| 引导词 / 核心领域 | 目标文档 | 触发场景分支 (Trigger Branches) |
| :--- | :--- | :--- |
| **系统架构与数据流** | [architecture_zh.md](architecture_zh.md) | 涉及插件声明层与运行时物理两层设计、单次调用时序竞争、逆向遥测滑窗扫描、增量 Checkpoint 状态机或故障降级矩阵时查阅。（英文版备查：[architecture.md](architecture.md)） |
| **模块接口与状态结构** | [module-reference.md](module-reference.md) | 修改/新增模块公开接口、排查状态落盘 JSON 格式（会话基线/effort/使用量）、调整布局行字段装配或修改 JSONC 配置文件安全写入时查阅。 |

## 外部权威指针快速通道

- **开发硬约束、避坑指南与验证闭环**：查阅 [AGENTS.md](../AGENTS.md)。
- **终端用户安装、主题与排障指南**：查阅 [README.md](../README.md)。
- **版本发布标准流程**：查阅 [AGENTS.md#发布流程](../AGENTS.md#发布流程)。
- **版本演进与发布历史**：查阅 [CHANGELOG.md](../CHANGELOG.md)。
