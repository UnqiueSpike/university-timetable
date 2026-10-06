# 第六步：分享、比较、撤销

本地开发规则：受控的 share_recipient 表定义可选的 owner/recipient 对；只有维护人员可设置，界面不提供任意用户搜索。合成测试仅 A ↔ B，empty 账户作为未获授权的第三人。正式名单由大学提供，使用大学邮箱格式不构成批准。

Full Timetable 精确映射 `course,classType,startAt,endAt,location`；Availability Only 精确映射 `startAt,endAt`。两种响应都保留不透明条目 id，不返回容量、来源、补充内容、成员、审计或内部身份字段。白名单由服务端运行时校验，顺序采用上述规范格式。course 只包含 code/name。跨授权边界的课程时间截断到读取范围，避免披露范围外忙闲。

创建须 consent:true；服务器记录 consentedAt。分享必须有效期，UI 默认 7 天，可选 30 天，服务端上限 30 天；授权数据区间最多 62 天，当前 UI 每次分享一周（Sydney）。同意提示明确接收人必须登录、撤销停止后续访问但无法删除已经复制的内容。Calendar Feed、无限期分享、删除和任意用户搜索均未开放。

## 接口及授权

share.recipients 仅返回当前用户受控接收人的 id/displayName。share.create/list/read/revoke 与 timetable.compare 已接通。list 的 direction=sent/received，稳定按 id 分页；read/compare 按 startAt、side、id 分页，游标签名绑定访问者、分享、区间和接口类型。前端读取全部页面后展示，任一页失败不显示部分结果。

每次 read/compare 检查当前登录学生、精确接收人、未撤销/到期、受控接收人对仍有效、分享者仍为学生；每页重新检查。课表只查询分享者的有效 StudentClass 和有效班级/条目。链接不承担授权作用。分享者只能用本人课表接口读取本人数据，不能伪装为接收人调用 share.read。

查询期间持有分享和资格的共享锁；撤销与查询按数据库事务先后生效。revoke 只有分享者可执行，重复调用返回同一 revokedAt。已经过期也可撤销。compare 的 self 部分是当前用户本人，shared 部分受白名单限制；不实现扩展冲突计算。

## 验证

2026-09-19：59 项测试通过，新增 9 项涵盖受控名单、明确同意、期限、字段泄露、A/B/C 隔离、区间截断、分页游标签名、比较排序、幂等撤销、分页中失效、班级/角色撤销。类型检查、代码检查和正式构建通过。

本地 A 登录 → Shared Timetables → Create Share → 选择 B、2026-09-21 周、Availability Only、期限并同意 → 复制链接。B 登录打开链接可比较；Empty 账户拒绝。A 撤销后 B 再查询拒绝。第七步负责无须手动刷新时的客户端更新和结果清除。
