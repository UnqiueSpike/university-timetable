# 个人课表与课程详情（第四步）

2026-09-19：实现登录 → 本人周课表 → 课程详情、容量和来源的数据库端到端流程。

## 查询与授权

- `timetable.mine({from,to,cursor?,limit?})` 只取会话用户的 active StudentClass，且 Class / TimetableEntry 均须 active。拒绝 userId 等未声明参数；教师单一角色不能调用本人学生课表。
- `timetable.getEntry({entryId})` 在 SQL 查询中限制本人有效班级或授予的教师课程范围；不可访问或不存在均返回 NOT_FOUND。兼具身份时按该操作允许范围取并集。
- `[from,to)` 按相交判断：`startAt < to && endAt > from`，包含窗口开始前已开始但尚未结束的课。输入带时区，最多 62 天；输出 UTC ISO，界面按 Australia/Sydney 展示。
- 默认 20、最多 100 条；按 `(startAt,id)` 游标分页。游标签名并绑定用户和规范化时间范围，篡改/跨用户/跨区间复用返回 BAD_REQUEST。客户端加载所有页后才展示；中途失败显示错误，不展示部分结果或伪装成空课表。
- 稳定排序不代表跨请求数据库快照隔离。并发改课后应重新查询；本阶段每 30 秒、窗口聚焦、恢复联网或手动刷新均重新查询，取消过期请求，避免旧周结果覆盖新周。
- 查询均禁止缓存；不会把 PostgreSQL 或鉴权失败转换为成功空列表。来源导入失败则保留上次成功记录并显示独立提示。

## 容量与来源

只有服务端显式配置 CAPACITY_SOURCE_ID 和 CAPACITY_MAX_AGE_HOURS 才选择对应来源、未过期且非未来的最新容量快照。无快照为 `capacity:null`；快照内未知为 null，已知零为 0。

示例配置是开发测试策略（synthetic-timetable-v1 / 168 小时），不是大学批准的正式容量策略。固定测试快照为 2026-09-19；晚于有效期后界面会显示 Unknown，这是预期过期处理，不会将陈旧数据当成当前容量。

测试记录始终显示 Test data · unverified。详情列出来源、验证状态、来源更新时间（缺失时 Not provided）、导入时间、容量观察时间。Supplement 当前返回空数组，独立展示无补充信息；第五步建立物理表时补齐 entryId / revision 与并发更新约束，不编造教师姓名、已选人数或候补人数。

## 界面与验收

参考 [Figma 周课表 2:4](https://www.figma.com/design/F9PdvZ2BAiF2pOJ6lmr6uY/Untitled?node-id=2-4) 与 [详情 6:2](https://www.figma.com/design/F9PdvZ2BAiF2pOJ6lmr6uY/Untitled?node-id=6-2)：220px 侧栏、Geist、细网格、柔和课程色块、右侧详情。只有当前可用入口和读取字段，后续写操作随对应阶段添加。

桌面默认工作日网格；有周末课程时显示七天，跨日/非标准时间课程扩展时间轴，重叠课程分列。手机显示完整七天日程，详情保留焦点约束、Escape 关闭与焦点返回。

本地账户来自 `.local-accounts.json`，日期切到 **2026-09-21 所在周**：

| 身份 | 预期结果 |
| --- | --- |
| student-a@example.invalid | COMP101 Lecture、Practical；容量分别 null 和 0 |
| student-b@example.invalid | 只有 MATH101，不出现 A 的课程 |
| student-empty@example.invalid | 无课程，成功空状态 |
| teacher@example.invalid | 进入教师工作区，仅 COMP101；不能自行扩大范围 |

已完成：36 项数据库/认证/课表/重叠布局测试；类型、代码和正式构建检查通过。浏览器实测 A/B 真实登录、不同课程、未知/零容量详情、1440px 桌面与 375/320px 窄屏；临时改写 B 的测试地点后刷新显示新值，并已恢复原值。Empty 账户在同一测试周显示无课程；临时停止开发库后刷新明确显示查询失败，数据库已恢复。

Zero 的独立验证及 AWS 未决条件见 [同步与部署验证](../../experiments/zero/README.md)。当前产品使用 tRPC 查询与定时重新查询，尚未启用 Zero 客户端缓存。
