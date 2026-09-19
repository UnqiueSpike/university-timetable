import { table, string, createSchema, relationships, createBuilder, defineQueries, defineQuery } from '@rocicorp/zero';
const entry = table('timetable_entry').columns({ id: string(), class_id: string(), external_id: string(), location: string().optional(), status: string() }).primaryKey('id');
const klass = table('class').columns({ id: string(), status: string() }).primaryKey('id');
const membership = table('student_class').columns({ id: string(), class_id: string(), user_id: string(), status: string() }).primaryKey('id');
const role = table('user_role').columns({ id: string(), user_id: string(), role: string(), scope_type: string() }).primaryKey('id');
export const schema = createSchema({ tables: [entry, klass, membership, role], relationships: [
  relationships(entry, ({ one, many }) => ({ klass: one({ sourceField:['class_id'], destField:['id'], destSchema:klass }), memberships:many({sourceField:['class_id'],destField:['class_id'],destSchema:membership}) })),
  relationships(membership, ({many}) => ({ roles:many({sourceField:['user_id'],destField:['user_id'],destSchema:role}) }))
] });
const zql = createBuilder(schema);
export const queries = defineQueries({ mine: defineQuery(({ctx}) => zql.timetable_entry.where('status','active').whereExists('klass', q => q.where('status','active')).whereExists('memberships', q => q.where('user_id',ctx.id).where('status','active').whereExists('roles', r => r.where('role','student').where('scope_type','global')))) });
