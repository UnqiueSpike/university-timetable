# 第七步：Zero 更新同步

固定 Zero 1.9.0。采用已实际验证的 **Zero 授权失效通知 + tRPC 当前授权读取**：Zero 仅订阅当前用户的 `sync_signal(user_id,revision)`；revision 是随机不透明值，无课程、时间、地点、公告正文或分享内容。所有业务字段仍经 tRPC 白名单和数据库权限检查。没有第二套客户端业务查询权限，也不把受保护内容放入 Zero 持久缓存。

| 数据 | 提供方式 | 更新方式 |
|---|---|---|
| 本人课表/详情、容量、来源、补充 | tRPC | Zero 信号触发重新读取全部页 |
| 分享列表、获准内容、比较 | tRPC | 同上；每页重验身份、期限、撤销、字段 |
| 目标公告、教师工作台、公告管理、审计 | tRPC | 同上；草稿/撤回/失效范围仍由服务端过滤 |
| 当前用户失效通知 | Zero | 只允许会话对应 user_id 的一行 |

数据库触发器在原写入事务内更新受影响用户的信号，包括相关学生、授权教师以及分享接收人；包含 tRPC/Drizzle、导入器和直接数据库维护路径。回滚时信号也回滚。Zero 发布只包含 sync_signal，认证表、业务表不进入 publication。禁止 Zero CRUD 和自定义写入；/api/sync/mutate 始终拒绝。

/api/sync/token 只接受同源已登录请求，签发 2 分钟、特定用途、特定会话的 HMAC 令牌。/api/sync/query 校验签名、期限和数据库当前会话，Zero 验证 userID 一致。断线重连会重新检查会话，needs-auth 时重新获取短期令牌。浏览器退出/卸载会关闭内存 Zero；断线隐藏并卸载业务页面，连接恢复重新查询。不得把 Zero 残留数据作为有效权限依据。每 5 秒重新检查业务授权以覆盖无数据库写入的到期；这是在线失效检查，不承诺离线展示。

## 本地启动

在 app 下完成依赖安装、迁移和测试账户。原本已启动的 PostgreSQL 需执行一次 `npm run db:down` / `npm run db:up`，启用 wal_level=logical。`.env.local` 配置 NEXT_PUBLIC_ZERO_CACHE_URL=http://127.0.0.1:4848。

分别运行 `npm run dev` 和 `npm run sync:dev`。后者严格限制本地开发库，创建只含 sync_signal 的 publication，在被忽略的 .local-zero 目录保留副本。界面显示 Updates connected；连接失败显示重试并隐藏业务结果。没有配置同步地址时明确提示未配置，而不宣称自动同步已上线。

## 实验与边界

`npm run test:sync` 使用独立临时 PostgreSQL 18 集群、真实认证和两个独立 Zero 客户端；不会改开发库。结果见 sync-results.json。2026-09-19：11 项场景及延迟检查通过；教师补充 114ms、公告发布 109ms、分享撤销 107ms（本机合成小数据、仅由 Zero 信号触发读取，不使用 5 秒兜底）。包含伪造客户端 ID、字段隔离、导入同步、事务回滚、成员/角色撤销、断线会话失效和重新认证。

5 秒为开发验收候选值，客户 SLA、网络条件、数据规模和大学 AWS 上结果仍待确认。本机结果不能代替部署环境 SLA。实际浏览器验证：Codex 内置浏览器以 A 登录，Chrome 独立会话以 B 登录；B 打开忙闲分享仅见 Busy，A 确认撤销后 B 无需刷新即清除比较内容并显示不可用（同一工具批次内约 0.7 秒完成观察，非精确性能基准）。

主应用锁文件对 OpenTelemetry core/jaeger 使用同主版本 2.11.0，CloudEvents UUID 使用 11.1.1；已运行实际同步验证，npm audit 为 0。旧 experiments/zero 是第四步原始实验，独立锁文件保留当时问题记录，不用于部署。

参考：[Zero 自托管](https://zero.rocicorp.dev/docs/self-host)、[认证](https://zero.rocicorp.dev/docs/auth)、[配置](https://zero.rocicorp.dev/docs/zero-cache-config)。
