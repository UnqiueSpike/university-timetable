# 第五步：教师维护、公告和审计

开发规则：教师只能写补充内容，不覆盖来源的时间、地点和容量；每次调用读取服务端会话及当前授权。`staff_permission` 显式授予 `supplement.write`、`announcement.manage`、`audit.read`，并要求对应教师课程角色仍有效。审计查看不是所有教师的默认权限。群体权限独立授予，群体成员关系不等于管理权限。

## 接口

- `staff.listEntries`：与本人课表相同的时间区间和分页，增加可选 courseId，只能查询授权课程。
- `supplement.save`：entryId、content；更新时必须同时提供 supplementId、expectedRevision。返回新 revision。不存在、越权和版本冲突不写入。
- `announcement.options`：受控课程、精确班级和群体选择。
- `announcement.create/update`：title、body、targets；update 携带 announcementId、expectedRevision。
- `announcement.publish/withdraw`：announcementId、expectedRevision。
- `announcement.listManaged`：仅作者本人且仍获全部目标授权的记录，支持 status、cursor、limit。
- `announcement.listVisible/getVisible`：仅当前目标学生可读的已发布公告；详情不返回目标成员列表。草稿和撤回统一不可见。
- `audit.list/get`：独立 audit.read，必须拥有事件全部课程和群体范围；list 支持 action、resource、actorId、from/to、cursor、limit，详情返回前后内容与 requestId。审计不能通过应用修改或删除，数据库触发器也拒绝更新和删除。

公告 targets 为 course/courseId、class/classId、group/groupId 的严格联合；多个目标取并集。CLASS 只匹配该班级有效 StudentClass，绝不扩大为整门科目。草稿可无目标，发布必须有目标。仅作者可编辑、发布和撤回；发布后不可编辑，要撤回并创建新的草稿。失效群体不能发布；仍有管理授权的作者可撤回已有公告。群体发布须单独授权，读取须群体与成员都有效。

教师写入和审计在同一事务；锁定当前授权、被修改记录，保存成功后递增 revision。审计失败整体回滚。浏览器写入必须带匹配认证站点的 Origin。并发冲突保留编辑器文字，不自动覆盖别人修改。补充信息在课程详情单独呈现。

上述是本地开发和试点候选规则，不代表大学业务审批或正式用户权限授予。部署前由大学维护人员建立正式身份和范围；合成测试教师仅 COMP101。未实现删除公告、任意群体搜索、转让作者、官方字段覆盖。

## 复验

在 app 下执行 db:migrate、db:seed、auth:seed；查看被忽略的 .local-accounts.json。教师工作台选择 2026-09-21 所在周，编辑补充；学生 A 刷新详情可见，B 不可见。Management 创建 CLASS L01 草稿后发布；A 查看，B 不可见；撤回后 A 再查询不可见。Audit Log 检查对应事件。

2026-09-19：类型检查、代码检查、正式构建通过；50 项集成检查通过（包含 14 项教师/公告/审计检查）：跨课程、伪造参数、精确班级和群体成员、草稿/撤回过滤、并发冲突、原子回滚、审计不可篡改、权限撤销、分页、跨站写入。浏览器实际验证教师登录、创建和发布 CLASS 草稿。当前自动同步由第七步补齐。
