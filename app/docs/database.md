# 第二步：PostgreSQL、迁移与测试数据

本阶段只实现持久化和内部数据接入，不增加公开导入接口、认证、tRPC 或页面课表查询。登录页仍是静态预览。

## 本地环境

使用 Node 22.x、npm 10.x 和 PostgreSQL **18.x**。本机已用 PostgreSQL 18.6 验证。安装 PostgreSQL 后，将 `initdb`、`pg_ctl` 加入 PATH。macOS 可使用 Homebrew 的 `postgresql@18`，Linux 可使用发行版对应的 PostgreSQL 18 软件包。无需启动系统级 PostgreSQL 服务。

在仓库根目录进入 `app/`：

```sh
npm ci
cp .env.example .env.local  # 已有文件时手动合并，不覆盖现有配置
npm run db:up
npm run db:migrate
npm run db:seed
npm run db:seed             # 同一批次再次执行返回 replayed
npm run db:inspect
npm run test:db
npm run check
```

`db:up` 用原生 PostgreSQL 工具初始化项目专属实例：数据目录 `app/.local-postgres/data`，仅监听 `127.0.0.1:55432`，使用 SCRAM 密码认证，不接触已有系统数据库。`.env.example` 中的密码仅为本地开发示例，不是正式凭据；修改密码时应同时管理已有 PostgreSQL 角色，不会因改环境变量而自动改数据库密码。

启动脚本只接受示例中的主机、端口、用户名及 `unischedule_dev` 库名；已有实例可重复启动。端口被占用或初始化失败时保留目录并报错，日志位于 `.local-postgres/postgres.log`。不要用脚本管理别的数据库。

```sh
npm run db:down             # 停止项目实例，保留数据
npm run db:up               # 再次启动，数据仍在
```

使用已有 PostgreSQL 时，可以直接配置 `DATABASE_URL` 后执行迁移，不必运行 `db:up`。迁移会修改所配置的数据库，应先核对目标。测试数据脚本额外要求非 production 环境、回环主机、库名 `unischedule_dev` 和 `ALLOW_TEST_SEED=true`；正式库不运行种子脚本。数据库连接池按需建立，静态页面构建不要求数据库在线。

## 迁移流程

- `src/server/db/schema.ts` 是结构源文件。
- 修改结构后运行 `npm run db:generate`，审阅 `drizzle/*.sql` 和 `drizzle/meta/`，一并提交到 Git。
- `npm run db:migrate` 使用 Drizzle 迁移日志，只应用未执行的迁移；可以重复执行。
- 不使用 `drizzle-kit push` 替代迁移，不改写已经执行的迁移。后续结构变更生成新迁移。
- `npm run test:db` 在同一本地服务器新建唯一的 `unischedule_test_<随机值>` 数据库，从空库执行迁移两次，执行测试后删除该临时库。仅清理本次创建的临时库，绝不清空开发库。测试连接用户须拥有 `CREATEDB` 权限。
- `TEST_DATABASE_URL` 的配置库名必须为 `unischedule_test`，它是测试目标标记；运行器通过 `/postgres` 管理本次临时库，不要求该标记库已存在。

所有连接变量仅用于服务端，不使用 `NEXT_PUBLIC_`。Next.js 入口、适配器及读取函数有 `server-only` 保护；命令行通过 `--conditions=react-server` 运行同一服务端代码。

## 身份与 Better Auth 的衔接

唯一用户主键为 `user.id`（text），字段按 Better Auth 核心 User 模型准备：`name`、`email`、`emailVerified`、`image`、`createdAt`、`updatedAt`。Drizzle 对象使用 camelCase，物理列使用 snake_case。所有学生关系和角色范围引用这个 ID，不再创建另一个业务用户表。

`identity_link(identity_provider, external_subject)` 是上游数据人员标识到同一个 `user.id` 的映射，组合唯一，不是认证账户，不保存密码或令牌。导入遇到未映射人员会整批拒绝，不能按邮箱自动合并用户或授予权限。

本步仅插入 4 条不可登录的合成用户资料（邮箱 `example.invalid`，`emailVerified=false`）。第三步须以最终锁定的 Better Auth 版本生成并核对 `account`、`session`、`verification` 等表，通过认证方案的受控账户建立流程为现有用户绑定登录方式，并保留本步 `user.id`。不能给已有资料再次创建一套用户，也不能直接向 SQL 插入明文或自行生成的密码；不能把合成 `identity_link` 当作身份验证结果。

Better Auth 的认证提供方账户关联最终由其 `account(providerId, accountId)` 管理，不能与本步的数据源人员映射混为一谈。角色读取、会话校验和授权检查在第三步落实；当前教师范围仅为数据库测试资料，不声明权限系统已完成。

## 测试资料

固定测试学期为 `2026-S2`，日期为 2026-09-21，校园时区 `Australia/Sydney`；入库使用 `timestamptz`，读取返回 UTC ISO 字符串。

| 用户 ID | 预期数据 |
| --- | --- |
| test-student-a | COMP101 Lecture 和 Practical；MATH101 关联失效；已取消班级不显示 |
| test-student-b | MATH101 Lecture，与 A 的有效课表不同 |
| test-student-empty | 没有班级关系，成功读取为空列表 |
| test-teacher | 仅 COMP101 的 staff/course 范围，无全局员工授权 |

容量包括 `(null, null)` 未知、`(0, 0)` 已知零容量、`(30, 0)` 已满三个场景。没有快照或指定来源已过期时，整个 `capacity` 为 null；有快照但数值未知时保留字段级 null。数据库不假设 available 等于 total 减本系统学生人数，也未加入待确认的 available ≤ total 规则。

`fixtures/timetable.json` 是自行构造的合成开发数据，**尚未获得大学数据负责人批准**。来源固定为 `test`，课程条目和容量均为 `unverified`，不会写入 verified。它可以验证导入机制，但 **FR-01 的批准数据源验收仍待完成**：需记录批准人、日期、数据范围和稳定 ID 规则，再用相应适配器验证；当前不连接正式大学数据。

## 导入协议及失败处理

`fixture-adapter.ts` 负责文件读取、严格字段校验和时区归一化。`import-timetable.ts` 负责来源核对、引用解析及原子写入；不是给客户端调用的接口。当前只接受预先登记的 test 来源。正式或 supplementary 来源必须另行实现、批准适配器和验证流程。

每批必须包含明确的 `term`、正整数 `version`、`mode`、`complete` 和五类数组。外部标识在所属来源内唯一；班级 ID 不能跨学期/科目复用，条目和关联 ID 不能换对象。上游需保证版本对同一来源和学期严格递增。容量观察的 ID 与内容不可变，修正须新增 ID 和 observedAt。

| 输入情形 | 处理方式 |
| --- | --- |
| 相同版本、相同规范化内容 | 返回 replayed，保留记录 ID、数量、原同步时间 |
| 更高版本、相同外部 ID | 更新同一记录，不重复插入 |
| 更旧版本或相同版本不同内容 | 拒绝，避免旧数据覆盖新数据 |
| snapshot + complete=true | 声明该来源、学期的完整班级/条目/关联集合；必须已收齐全部分页 |
| 完整快照缺少已有记录 | 缺失班级/条目标为 cancelled，学生关联标为 inactive，保留历史 |
| 明确声明完整的空快照 | 仅停用该来源、学期的数据，不影响其他来源和学期 |
| delta + complete=false | 未提及记录保持不变，取消/失效必须显式传 status |
| 取消整个班级 | 内部查询排除该班级，即使旧条目仍为 active；重新激活须显式更新 |
| 文件缺失、请求失败、结构不完整、未知引用、冲突或约束失败 | 抛出错误，业务事务回滚；保留上次成功数据与时间，记录 IMPORT_FAILED |

数组顺序是规范化内容摘要的一部分；重排同一版本会被视为冲突。修改本地 fixture 后必须增加版本；已导入更高版本的开发库不能通过旧版本 seed 回退。测试运行器每次使用空库，不受开发库版本影响。空快照的 complete=true 是适配器的完整性保证，不能把失败响应或缺页响应包装为空数组。

来源级事务锁串行化并发导入；所有业务记录及成功标记在同一事务提交。失败标记单独写入 `sync_scope`，不改变 `last_success_at` 或成功版本。`data_source.last_success_at` 是来源级最后成功时间，`sync_scope` 按学期记录具体状态。数据库连接自身不可用时会直接失败，无法保证写入失败标记，但不会执行删除。

容量历史永不因快照缺失而删除。内部读取必须显式提供容量来源、参考时间及最大数据年龄才会选择快照；未提供策略则返回 capacity=null，不随意选某个来源的最新记录。`db:inspect` 使用固定测试策略，仅用于合成场景，正式优先级及过期规则仍待客户确认。

## 数据库约束及测试记录

数据库落实来源内外部 ID 唯一、人员标识唯一、用户/班级当前关联唯一、全部引用外键、结束晚于开始、容量非负或 null、角色范围与唯一性。课表和容量的 `(source_id, source_kind)` 复合外键配合 CHECK，阻止测试来源伪装成 official 或标记 verified。

2026-09-19 本地验证：PostgreSQL 18.6；空库迁移和重复迁移通过；16 项真实数据库集成测试通过，包括重复导入、两学生数据隔离、空课表、null/0、失效关联、取消、全量/增量、失败保留、整批回滚、版本冲突、并发导入、跨学期/来源隔离和直接 SQL 约束。测试不代替第三步的认证与越权测试。

GitHub Actions 额外启动 PostgreSQL 18 服务执行同一集成测试，并检查 schema 生成后没有迁移漂移。分享、公告、Supplement、审计表未提前实现；后续实现 Supplement 与 Announcement 时必须补充整数 `revision`、递增规则及 expectedRevision 冲突校验。

参考：[Better Auth 核心数据库模型](https://better-auth.com/docs/concepts/database)、[Drizzle PostgreSQL 接入](https://orm.drizzle.team/docs/get-started/postgresql-new)、[Drizzle 迁移](https://orm.drizzle.team/docs/migrations)。Drizzle Kit 间接引用的旧 esbuild 通过 package.json overrides 锁定为 0.25.12，升级工具后需重新评估并运行生成、迁移和测试验证。
