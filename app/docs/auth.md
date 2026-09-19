# 第三步：真实登录与服务端授权

## 启动与账户

先按 database.md 启动 PostgreSQL 并运行迁移，然后在 `app/.env.local` 配置：

- `BETTER_AUTH_URL=http://127.0.0.1:3000`，浏览器也使用这个地址；部署时必须是实际 HTTPS origin。
- `BETTER_AUTH_SECRET`：至少 32 字符的随机值。可执行 `node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"` 生成并手动填入本地环境文件。不要提交到 Git。

```sh
npm run db:migrate
npm run auth:seed
npm run dev
```

`auth:seed` 仅允许回环地址上的 unischedule_dev、非 production 环境且 ALLOW_TEST_SEED=true。它为原有 4 个合成 user.id 建立 Better Auth credential 账户，使用 Better Auth 自带哈希与 internalAdapter，不自行实现密码算法。凭据随机生成，保存在权限 0600、被 Git 忽略的 `app/.local-accounts.json`，日志不输出密码。

再次执行会复用同一文件并验证现有密码，不创建第二套用户、不重设密码。请保留该文件；文件损坏或与数据库不一致时脚本拒绝，不自动覆盖账户。此受控脚本使用锁定版本的 Better Auth 内部适配器，升级认证库时必须重跑集成测试。

学生 A/B/空课表账户分别使用 student-a、student-b、student-empty@example.invalid；教师为 teacher@example.invalid。具体邮箱和密码以本地文件为准。它们不是大学正式账户。

## 实现边界

- Better Auth 的 user/account/session/verification 表和业务外键共用一个用户 ID。禁用公开注册，HTTP 只开放 sign-in/email、sign-out、get-session。
- 未启用自助找回密码或发邮件流程；UI 明确引导联系大学支持。大学身份核实和 SSO 尚未接入，`emailVerified=false` 不会因邮箱格式而变成 true。
- 会话存储于 PostgreSQL；HttpOnly、SameSite=Lax cookie，HTTPS 下 Better Auth 使用 Secure。关闭 cookie session cache，每次受保护请求校验数据库会话；退出后旧 cookie 也失效。
- “记住设备”传递 Better Auth rememberMe；不记住时使用非持久 cookie。会话默认最长 7 天，按 Better Auth 的刷新规则延长；短会话依照其不记住设备策略。
- 登录启用每分钟 10 次限制，其他认证请求每分钟 100 次。目前单实例内存限流；缺少可信代理 IP 时保守共用路径桶，不信任客户端伪造的 IP。多实例部署前须配置可信代理、共享限流存储和大学批准的策略。
- 当前无公开账户创建、角色编辑或授权变更入口。角色仅由数据库受控配置，前端输入 role/userId 不会产生授权。

## 服务端权限

`tRPC account.me` 返回 id、displayName、email、emailVerified、grants；不接受客户端 userId。参数使用 Zod 严格校验；统一返回错误 code、reason、requestId，不返回数据库细节或堆栈，响应 no-store。

`student/global` 业务角色映射为 `timetable.read.own` 的 self 范围，绝不解释为所有学生。`staff/course` 只映射该课程的 staff.access 和 timetable.read.course。未定义角色没有权限。

共用授权函数分别检查操作权限、课程范围和本人 ID。详情按有效 StudentClass 或明确授权的课程判断；不存在与越权统一 NOT_FOUND。学生身份和教师身份可以并存，教师身份不能用于绕过本人课表范围。

`staff.courses` 是真实受保护接口，只返回获授课程。服务端页面也检查权限，学生/教师入口按权限呈现。客户端每 15 秒和窗口重新聚焦/联网时复核会话与权限；发现变化清除显示并重新进入授权入口，查询失败不冒充退出成功。

## 验证

`npm run test:db` 包含 16 个数据接入测试和 9 个真实认证/授权测试。认证测试使用临时 PostgreSQL、真实 Better Auth handler、真实签名 cookie、tRPC Fetch handler，覆盖随机凭据重复建立、旧用户 ID 复用、错误密码、跨源登录、匿名/伪造会话、伪造 userId、学生调教师接口、双角色、授权撤销、退出后旧 cookie 和过期会话。

后续正式运行仍需大学批准的账户建立、恢复及身份核实流程；本步不声称完成 SSO 或大学身份验证。

参考：[Better Auth Drizzle adapter](https://better-auth.com/docs/adapters/drizzle)、[会话管理](https://better-auth.com/docs/concepts/session-management)、[tRPC Fetch adapter](https://trpc.io/docs/server/adapters/fetch)。
