# 试点部署与运维

当前交付的是可验证的部署配置和本地恢复记录，**尚未在大学 AWS 执行部署**。Terraform 1.14.7 / AWS Provider 锁文件已提供；先读下面的接管门槛。实际申请、费用、域名/证书和部署批准仍由大学控制。

## 环境与架构

infra/terraform 复用大学 VPC、两个可用区的私有子网、已有 NAT 或所需 VPC endpoints、私有 Route53 区域和覆盖两个域名的 ACM 证书。默认内部 HTTPS ALB，仅允许指定校园/VPN 网段和 VPC。应用为两份 ECS Fargate；PostgreSQL 18 RDS Multi-AZ，强制 SSL、14 天备份、删除保护和最终快照；Zero 单 EC2 + 独立加密 EBS，SSM 管理，无公网地址或 SSH。Zero 单节点属于试点可用性限制，实例替换会有同步中断。

应用与 Zero 使用同一个大学 ECR 镜像摘要，Zero 运行本项目固定依赖与安全修复。应用服务和 Zero 默认关闭 services_enabled=false，先完成数据库和密钥初始化。AWS 资源不是零成本，必须在大学账号内评估计划和预算后部署。

## 初始化、迁移、发布

1. 由大学提供账号 ID、区域、访问角色、VPC/子网/VPN 路由、NAT/endpoints、DNS 与证书、KMS 和 Secrets Manager ARN。核实所选区域支持 PostgreSQL 18、实例规格、逻辑复制和配额。
2. 建立加密、版本化、阻止公开访问的 Terraform 状态桶及最小权限。复制 backend.hcl.example 和 pilot.tfvars.example 到未跟踪的本地文件，替换占位符。状态与计划可能敏感，不提交 Git。
3. `terraform -chdir=infra/terraform init -backend-config=backend.hcl`；`terraform -chdir=infra/terraform plan -var-file=pilot.tfvars -out=pilot.tfplan`。核对 account_id 保护、网络、资源变化和费用，再由大学部署执行者 apply 该计划。
4. 通过受控迁移执行环境连接私有 RDS。RDS 管理密码由 Secrets Manager 自动管理；创建专用迁移、应用、Zero 账户和独立 CVR/change 数据库。ops/bootstrap.sql 提供权限清单，应按两阶段执行：先账户/数据库，迁移完成后再表级授权和 publication。给迁移角色应用 schema 所有权及必要 DDL 权限，不给应用角色数据库所有权。触发器以调用者执行，应用角色需读取范围关系、更新 sync_signal，并 INSERT audit_event。
5. 使用带可信 RDS CA 校验的连接（`sslmode=verify-full`）。应用 Secret JSON 只含 DATABASE_URL、BETTER_AUTH_SECRET；Zero Secret JSON 含 ZERO_UPSTREAM_DB、ZERO_CVR_DB、ZERO_CHANGE_DB、ZERO_ADMIN_PASSWORD。上游使用复制账户，CVR/change 使用各自所属库；Zero 不拿认证密码表 SELECT 权限。密钥值不放 Terraform、不在命令输出展示。
6. 在 linux/amd64 构建：`docker build --build-arg NEXT_PUBLIC_ZERO_CACHE_URL=https://<sync-domain> -t <university-ecr-tag> app`。本地未安装 Docker，容器构建尚未执行；大学流水线必须完成构建、镜像扫描和基础镜像摘要固定，再推 ECR，并把不可变 digest 写入配置。NEXT_PUBLIC_ZERO_CACHE_URL 在构建时固化，更换域名需重新构建。
7. 发布前备份，使用相同镜像的单次迁移任务，以迁移账户执行 `npm run db:migrate`。禁止多副本启动时各自迁移。迁移成功后重新执行新表授权，再把 services_enabled=true 并 apply。健康检查 /api/health 应为 200，应用和同步域名均必须 HTTPS 可达。Better Auth 仅开放已有账户登录/退出/会话，不依赖 SSO；正式账户由大学受控开通，不能运行本地 synthetic seed。
8. 配置校园入口的登录限速和可信代理 IP 规则并验证伪造转发头。当前认证限速按进程内存运行，共享 IP 与多实例不能视为全局限流；未完成大学网关限流前不扩大试点。

## 应用回滚与数据库兼容

记录已部署镜像 digest、任务定义版本、Git commit、迁移编号和备份点。先使用增加字段/表的 expand 迁移，旧版本保持兼容；删除/重命名放后续独立 contract 发布。失败时先停新写入，恢复前一镜像与任务定义；ECS circuit breaker 回滚应用不回滚数据库。若 schema 不兼容，不要强行运行旧应用，优先前滚修复或恢复到新数据库后完整复验。Zero schema/publication 更改须独立演练重新引导，不删除 EBS 副本当作普通回滚。

## 日志、故障和恢复

CloudWatch 保存应用/Zero 30 天日志，API 内部失败仅记录 requestId、接口和错误码，不记录请求内容、Cookie、密码或数据库 URL。/api/health 检查数据库并返回 503；来源导入失败通过 sync_scope 和页面提示保留最后成功数据，不解释为全部删除。RDS 存储告警已定义，大学需接入通知目标，并添加 ALB 5xx、健康目标、Zero 断连/复制滞后及复制槽 WAL 积压告警与值班流程。

RDS 14 天自动备份/PITR；变更前创建手动快照。恢复演练必须创建新 RDS 实例、相同逻辑复制参数/私有安全组，使用受控迁移身份验证约束与行数，然后在维护窗口切换 Secret/任务。恢复旧数据可能复活旧会话、分享或权限：**开放前清除 session、撤销恢复库中的所有 share，并根据大学最新授权重新对账角色/班级/群体/公告状态**。不允许把备份点之前的授权当作当前授权。示例维护事务：`BEGIN; DELETE FROM session; UPDATE share SET revoked_at=coalesce(revoked_at,now()); COMMIT;`。

本地 `cd app && npm run test:restore` 真正将 pg_dump 恢复到空隔离库，核对行、约束、认证数据，并验证恢复后失效措施；结果 app/docs/restore-results.json。这不是 RDS 恢复或基础设施重建完成证明。

Zero 副本 EBS 持久保留，实例重建在同一可用区重新附加该卷；数据库仍是权威来源。备份副本时先停止同步服务，取一致性 EBS 快照再启动；损坏/跨区灾难恢复需按 Zero 文档同时处理副本、CVR/change 与逻辑复制槽，不能只删除一个文件。大学需实际演练该流程并记录 RTO/RPO。

## 验收与移交门槛

- 实际大学 AWS apply、DNS/HTTPS/回调、密钥轮换和镜像运行结果。
- 在部署环境以 A/B/C、教师、兼具身份测试登录、本人课表、补充、公告、分享撤销及 Zero；不使用真实学生资料代替批准测试数据。
- 确认同步 SLA、测量条件、性能规模、RPO/RTO，重测失败恢复。
- 按 docs/user-guide.md 进行移动端、键盘和无障碍检查；当前是基础检查，尚非完整 WCAG 认证。
- 另一位大学开发者根据 README 从空环境启动，再执行部署/恢复演练并签名记录。

目前没有大学账号/接入信息和接管人员，以上不能代为声称完成；交付试点也不等于获准生产使用。

参考：[AWS RDS 逻辑复制](https://docs.aws.amazon.com/AmazonRDS/latest/UserGuide/PostgreSQL.Concepts.General.FeatureSupport.LogicalReplication.html)、[Terraform ECS service](https://registry.terraform.io/providers/hashicorp/aws/latest/docs/resources/ecs_service)、[Zero 自托管](https://zero.rocicorp.dev/docs/self-host)。
