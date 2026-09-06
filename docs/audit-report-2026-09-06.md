# 2026-09-06 回归复核与修复记录

审查范围：`5c48f63`、`c521c1a`、`2c071e1`，以及随后恢复 HUD 的工作区修复。本文替代当天初稿中未区分源码推断、条件性风险与实机复现的分级结论；旧稿可从 Git 历史查看。

## HUD 消失的两条故障链

1. `2c071e1` 新增的两个卸载测试只隔离 settings，没有隔离 runtime 和用户缓存。临时副本实验证明：测试通过，但旁边的模拟安装 shim 被删除。修复后回归测试检查 shim、cache 和 credits 哨兵均保持原样。
2. CodeBuddy Code v2.146.0 的 Windows containment 启动器二次转义字面引号。实测矩阵为：containment + 引号失败，无引号成功；直连 cmd 两者均成功。安装器现在仅对可安全执行的 ASCII 路径省略引号。

恢复 shim 后，GLM-5.3-Flash、Hy4 preview 及缺少 display_name 的 GLM 均通过实际宿主调用链；用户确认窗口中的 HUD 已恢复。旧窗口是否重刷取决于会话事件，因此冻结的旧画面不能证明入口仍存在。

`scripts/verify-install.js` 也改为在临时 runtime 副本运行整个安装卸载流程，避免验证期间删除线上入口。临时 stdout 调试包装已移除。

## 当日提交引入的回归

| 问题 | 证据 | 修复行为 |
| --- | --- | --- |
| JSONC 全局去尾逗号正则修改合法字符串 | `"echo ,}"` 被解析为 `"echo }"`，已隔离复现 | 仅在字符串外处理语法；保留字符串内逗号、括号、转义字符；拒绝未闭合注释 |
| 原子替换丢失私有权限 | 默认临时文件 mode 为 `0666 & umask`，不能继承原文件 `0600` | 保留现有 POSIX mode/所有者；新文件及首次备份默认 `0600`，写入失败保留原文件 |
| 原子替换断开配置链接 | 硬链接替换实验证明原 inode 不再更新；文件 symlink 在 Windows 初次审查时因权限未实测 | 跟随有效符号链接后替换真实目标，保留链接；拒绝多硬链接目标，避免悄悄断链 |
| 100ms 扫描预算后部分 Credits 被当成总额 | 可控时钟使首帧返回 5，续扫后实际为 12 | checkpoint 保留进度；返回完整性状态，未完成时隐藏 Credits，禁止 payload 兜底伪装成完整值 |
| settings effort 缓存串值 | 相同 mtime 的不同 settings 路径由 high/low 串成 high/high | 删除磁盘 effort 缓存；进程内缓存绑定 settings 路径，允许缓存 null |
| 网络失败抹掉已知更新 | 本地失败端口使 updateAvailable 从 true 变 false | 失败保留最后有效版本信息，仅刷新检查时间 |

测试覆盖放在对应的 installer/settings-file、transcript、renderer、model-info 和 update-checker 单元测试中。完整性边界使用可控时间或短读模拟，避免依赖机器负载碰巧超过 100ms。

## 修正初稿的建议

- 撤销“UTF-16LE + BOM 的 `.cmd` 被 Windows 原生完全支持”。相同 `echo HUD_OK` 脚本在本机 UTF-8 执行成功，UTF-16LE 执行 exit 1。当前 shim 使用 UTF-8，必要时先切换代码页。
- `.git/index` mtime 不能证明工作树干净；未暂存的编辑不会更新 index。保留 `git status` 和现有 10 秒 TTL，将延迟视为性能与新鲜度的取舍。
- 删除配置文件的进程内 JSON Map 和 effort 磁盘缓存。正常 HUD 每次调用都是新进程，没有基准证明这些额外 stat、状态读写能改善常见路径。
- 保留 100ms 分块扫描预算，同时维护“是否扫描完成”的语义。预算本身不能成为展示不完整累计值的理由，也不能抢占一次同步 `JSON.parse`。
- `Buffer.concat` 能避免 UTF-8 跨 chunk 断字；原稿声称替换字符一定导致 `JSON.parse` 失败不准确，它也可能解析成功但文本已损坏。
- 原子 rename 防止读到半份 JSON，不等于保留权限、链接、跨进程更新或断电持久性。用户配置与缓存须分别处理其实际契约。

## 文档与兼容边界

- HUD 上限 4 行；宿主 v2.146.0 保留前 3 行，因此第 4 行可能不可见。
- 宿主使用事件触发和约 300ms 去抖，空闲不周期刷新。失败后不会自动定时重试。
- 必须带引号的 Windows 安装路径仍受宿主启动器限制；不通过去掉必要引号来破坏路径安全。
- 卸载仅恢复 statusLine，保留其他 settings 和用户主题配置。配置写入失败时保留备份。
- settings 读取失败时停止配置修改，不能将读取失败视为空文件。JSONC 成功写回会规范化为标准 JSON；注释只保留在首次原文备份中，卸载成功后删除该备份。
- 符号链接与私有权限须在原生 POSIX 文件系统测试；多硬链接原地更新与原子替换不能同时满足，本实现选择拒绝该写入。

## 验证入口

```bash
npm test
npm run verify
npm run verify:install
```

用例数以当次输出为准。安装卸载验证必须隔离 runtime、settings 与用户目录；不得为复现测试副作用而操作真实安装。宿主链验证与直接 `--status` 冒烟是不同检查，后者不能证明前者可用。

2026-09-06 本次验收：Windows Node 24.13.0 下 356 个单元测试通过，2 个 POSIX 专属用例跳过；显示验证 11/11、安装验证 8/8。WSL Ubuntu 22.04 / Node 24.15.0 下安装、配置写入和远程分发相关测试 35 个通过，1 个 Windows 专属用例跳过，实际验证了符号链接和 POSIX mode/uid/gid。远程安装测试使用本地 HTTP 服务，无需发布或请求 GitHub。
