# Zero 与部署条件提前验证

日期：2026-09-19。实验依赖与主应用隔离，**不代表第七步完整同步集成或 AWS 部署已完成**。

## 已执行的本地实验

环境：macOS arm64、Node 22.14.0、PostgreSQL 18.6、Zero **1.9.0**、主应用 Better Auth 1.7.5 / Drizzle 0.45.2。版本解析见本目录 package-lock.json，执行结果见 [results.json](results.json)。

脚本在独立临时 PostgreSQL 集群（127.0.0.1:55433，logical WAL）创建空库，使用主应用迁移、seedFixtures、真实 Better Auth 账户/会话，以及现有 importTimetable 写入路径。开发数据库不被修改。只发布 timetable_entry、class、student_class、user_role 四张表，不发布账户、密码、会话或验证表。Zero 同步服务使用 4852/4853，本地查询服务使用 127.0.0.1:4851；仅供受信任本机开发验证，不部署或对外转发这些端口。

查询入口从已验证会话重新建立身份，不相信客户端 context。ZQL 将班级 active、本人 StudentClass active 和 student/global 角色作为关系条件，因此撤销会改变订阅结果；只在订阅建立时检查权限不足以保证后续撤销。实验禁用旧式 CRUD 写入与遥测，写入入口始终拒绝，写操作通过现有服务端导入器执行。

| 检查 | 结果 |
| --- | --- |
| 两个真实认证的 Zero 客户端只收到本人课程 | 通过；A 两门班次，B 一门班次 |
| 伪造客户端 userID，与真实会话不符 | 拒绝连接，无课程返回 |
| 当前导入路径更改课程地点后增量到达授权客户端 | 通过 |
| 撤销 StudentClass 后移除 A 的可见课程，B 不变 | 通过 |
| 删除 B 学生角色后移除其可见课程 | 通过 |
| 已退出会话的新连接 | 401 / needs-auth，拒绝同步 |
| 更新认证后恢复可授权数据 | 通过 |
| 实际停止并重启 zero-cache，同一客户端自动重连 | 重验会话；断线期间退出的会话被拒绝 |
| 失效会话后旧客户端缓存自动清除 | **未自动清除，仍保留两条内存记录** |

最后一项是已证实边界：后续 UI 必须在退出、needs-auth 或身份切换时隐藏内容、关闭 Zero 实例并销毁内存存储，重新认证后创建/连接新的授权实例。离线缓存不能作为授权依据，也无法召回用户已经复制的数据。完整接入前必须补充浏览器级断网、跨标签页退出、会话过期和共享电脑验证。本阶段应用不接入该缓存，继续使用每次验证会话的 tRPC；查询失败隐藏课表，15 秒会话复查，30 秒课程重查，聚焦/恢复联网也重新验证。

本实验 Node 客户端使用临时不透明 bearer 值传递本地会话给验证服务。它不是生产 token 设计，不应复制到浏览器。正式浏览器接入拟采用 HttpOnly cookie 由 Zero 转发至服务端验证，需另验同源/子域、SameSite、CSRF 和 WebSocket 入口。参考 [Zero 认证](https://zero.rocicorp.dev/docs/auth)、[查询与权限](https://zero.rocicorp.dev/docs/queries)。

## 复现

先完成主应用 `npm ci`，安装 PostgreSQL 18 并确保 initdb/pg_ctl 在 PATH；关闭占用 55433、4851–4853 的进程。仓库根目录执行：

```sh
npm ci --prefix experiments/zero
node --conditions=react-server --import ./app/node_modules/tsx/dist/loader.mjs experiments/zero/run.mjs
```

结果写入 results.json，失败返回非零；随机密码只存在临时私有目录/数据库，不输出到结果、不提交。结束时关闭客户端/Zero/HTTP/临时数据库集群。日志及关闭后的临时数据保留在系统临时目录，便于失败诊断。连接被拒绝的 401 和断线日志是测试预期。

## 已解决的问题与剩余风险

- zero-cache-dev 子进程要求 PATH 中有 zero-cache；复现脚本改用锁定包的直接入口。
- 正式入口要求管理口令；脚本运行时生成随机值。
- 自定义认证须同时配置 query 与 mutate URL；只配置 query 时会转入旧 JWT 验证路径。只读实验明确拒绝 mutate。
- 查询 URL 带协议参数，入口按 pathname 路由，避免误拒绝。
- 2026-09-19 npm audit：隔离 Zero 依赖有 **29 项（27 moderate、2 high）**，包括 OpenTelemetry Jaeger header 异常拒绝服务。自动建议回退旧 Zero 大版本不适合直接采用。升级/上游修复并重测、确认实际可达性之后才允许作为部署候选。主应用没有引入此依赖。
- 仅验证学生读取所需的四表子集；教师多课程、分享授权、容量、Supplement、Announcement、浏览器 cookie 转发、查询计划和大规模延迟尚未验证。未来加入 Supplement/Announcement 时带 revision。

候选路径：保留当前 tRPC 重新查询，授权实现已验证但不提供低延迟推送；Zero 在补齐失效缓存处理、依赖修复和部署验证后作为实时同步候选；若大学无法开放 logical replication，可评估服务端授权后的 SSE 失效通知 + tRPC 重查（尚未实现，须另验撤销与重连），不承诺未验证路径。

## AWS / IaC 决定与待确认

工程选用 **Terraform** 作为 IaC 工具，采用 provider/模块版本锁定、plan 审查后 apply；团队如有强制既有标准再迁移。状态拟放大学账户内加密 S3、启用版本与锁文件，不在 Git 存储状态或密钥。参考 [Terraform S3 backend](https://developer.hashicorp.com/terraform/language/backend/s3)。尚未创建云资源或执行 plan/apply。

本机检查：没有可调用的 AWS CLI、Terraform、Docker 或 Podman；原生 PostgreSQL 与 Zero 可运行。大学账户/区域/访问角色/现有资源尚未提供，已向用户询问，**不能确认大学 AWS 环境可部署**。

需要大学提供/确认以下信息后才能做实际部署验证：

| 条件 | 当前状态与验证方式 |
| --- | --- |
| 大学 AWS account、region、预算和资源政策 | 待确认；不默认采用个人账号或指定区域 |
| 访问方式 | 待提供只需的 SSO/角色；先只读核对身份、配额、资源，不在仓库保存凭据 |
| VPC、子网、路由及数据库连通性 | 待清点；应用/同步服务到数据库需可达，内部复制端口保持私有 |
| PostgreSQL | 待确认版本、logical replication、publication/slot 权限、连接数、WAL 保留与监控；复制使用直连而非事务池 |
| 计算与存储 | 待确认大学已有 ECS/EC2 等资源、WebSocket 支持、SQLite 副本磁盘 IOPS、重启恢复、优雅停机条件 |
| 域名/TLS、密钥、日志、备份 | 待确定大学控制的域名/证书、Secrets Manager、监控与恢复责任 |
| Terraform | 待确认允许版本/provider、S3 状态桶、最小权限执行角色与变更审批方式 |

RDS 可通过参数组启用逻辑复制，但需要适当权限、配置与重启安排，复制槽还需监控 WAL 占用；这些必须在目标实例核验。[AWS RDS 官方说明](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.FeatureSupport.LogicalReplication.html)

Zero 自托管至少包含复制管理与查询同步组件、PostgreSQL、应用 API，以及 SQLite 副本；外部入口需支持 WebSocket，复制管理接口只应走私网。先评估大学现有单节点部署条件，再按实际负载评估拆分；本次没有 AWS 性能/恢复证据。[Zero 自托管文档](https://zero.rocicorp.dev/docs/self-host)
