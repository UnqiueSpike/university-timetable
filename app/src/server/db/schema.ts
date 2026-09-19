import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () => uuid("id").defaultRandom().primaryKey();
export const sourceKind = pgEnum("source_kind", ["official", "test", "supplementary"]);
export const verificationStatus = pgEnum("verification_status", ["verified", "unverified"]);
export const recordStatus = pgEnum("record_status", ["active", "cancelled"]);
export const membershipStatus = pgEnum("membership_status", ["active", "inactive"]);

// Better Auth's canonical user model. Account/session/verification are added in step 3.
export const user = pgTable("user", {
  id: text("id").primaryKey(), name: text("name").notNull(), email: text("email").notNull().unique(),
  emailVerified: boolean("email_verified").default(false).notNull(), image: text("image"),
  createdAt: instant("created_at").defaultNow().notNull(), updatedAt: instant("updated_at").defaultNow().notNull(),
});
export const identityLinks = pgTable("identity_link", {
  id: id(), userId: text("user_id").notNull().references(() => user.id, { onDelete: "restrict" }),
  identityProvider: text("identity_provider").notNull(), externalSubject: text("external_subject").notNull(),
}, t => [unique().on(t.identityProvider, t.externalSubject)]);
export const dataSources = pgTable("data_source", {
  id: text("id").primaryKey(), name: text("name").notNull(), kind: sourceKind("kind").notNull(),
  lastSuccessAt: instant("last_success_at"),
}, t => [unique().on(t.id, t.kind)]);
export const courses = pgTable("course", {
  id: id(), sourceId: text("source_id").notNull().references(() => dataSources.id),
  externalId: text("external_id").notNull(), code: text("code").notNull(), name: text("name").notNull(),
}, t => [unique().on(t.sourceId, t.externalId)]);
export const classes = pgTable("class", {
  id: id(), sourceId: text("source_id").notNull().references(() => dataSources.id), externalId: text("external_id").notNull(),
  courseId: uuid("course_id").notNull().references(() => courses.id), term: text("term").notNull(),
  classCode: text("class_code").notNull(), type: text("type").notNull(), status: recordStatus("status").default("active").notNull(),
}, t => [unique().on(t.sourceId, t.externalId), index("class_source_term_idx").on(t.sourceId, t.term)]);
export const timetableEntries = pgTable("timetable_entry", {
  id: id(), classId: uuid("class_id").notNull().references(() => classes.id),
  sourceId: text("source_id").notNull(), sourceKind: sourceKind("source_kind").notNull(), externalId: text("external_id").notNull(),
  startAt: instant("start_at").notNull(), endAt: instant("end_at").notNull(), location: text("location"),
  status: recordStatus("status").default("active").notNull(), verificationStatus: verificationStatus("verification_status").default("unverified").notNull(),
  sourceUpdatedAt: instant("source_updated_at"), syncedAt: instant("synced_at").defaultNow().notNull(),
}, t => [
  unique().on(t.sourceId, t.externalId),
  foreignKey({ columns: [t.sourceId, t.sourceKind], foreignColumns: [dataSources.id, dataSources.kind] }),
  check("entry_time_order", sql`${t.endAt} > ${t.startAt}`),
  check("entry_verified_official_only", sql`${t.verificationStatus} <> 'verified' OR ${t.sourceKind} = 'official'`),
  index("entry_class_time_idx").on(t.classId, t.startAt),
]);
export const studentClasses = pgTable("student_class", {
  id: id(), userId: text("user_id").notNull().references(() => user.id), classId: uuid("class_id").notNull().references(() => classes.id),
  sourceId: text("source_id").notNull().references(() => dataSources.id), externalId: text("external_id").notNull(),
  status: membershipStatus("status").default("active").notNull(), syncedAt: instant("synced_at").defaultNow().notNull(),
}, t => [unique().on(t.sourceId, t.externalId), unique().on(t.userId, t.classId), index("student_class_user_idx").on(t.userId, t.status)]);
export const capacitySnapshots = pgTable("capacity_snapshot", {
  id: id(), classId: uuid("class_id").notNull().references(() => classes.id),
  sourceId: text("source_id").notNull(), sourceKind: sourceKind("source_kind").notNull(), externalId: text("external_id").notNull(),
  total: integer("total"), available: integer("available"), observedAt: instant("observed_at").notNull(),
  verificationStatus: verificationStatus("verification_status").default("unverified").notNull(), syncedAt: instant("synced_at").defaultNow().notNull(),
}, t => [
  unique().on(t.sourceId, t.externalId), unique().on(t.sourceId, t.classId, t.observedAt),
  foreignKey({ columns: [t.sourceId, t.sourceKind], foreignColumns: [dataSources.id, dataSources.kind] }),
  check("capacity_nonnegative", sql`(${t.total} IS NULL OR ${t.total} >= 0) AND (${t.available} IS NULL OR ${t.available} >= 0)`),
  check("capacity_verified_official_only", sql`${t.verificationStatus} <> 'verified' OR ${t.sourceKind} = 'official'`),
]);
// Deliberately only the grants needed for fixtures; these do not authenticate a user.
export const userRoles = pgTable("user_role", {
  id: id(), userId: text("user_id").notNull().references(() => user.id), role: text("role").notNull(),
  scopeType: text("scope_type").notNull(), courseId: uuid("course_id").references(() => courses.id),
}, t => [
  check("role_scope", sql`(${t.role} = 'student' AND ${t.scopeType} = 'global' AND ${t.courseId} IS NULL) OR (${t.role} = 'staff' AND ${t.scopeType} = 'course' AND ${t.courseId} IS NOT NULL)`),
  uniqueIndex("user_role_course_unique").on(t.userId, t.role, t.courseId).where(sql`${t.courseId} IS NOT NULL`),
  uniqueIndex("user_role_global_unique").on(t.userId, t.role).where(sql`${t.courseId} IS NULL`),
]);
export const syncScopes = pgTable("sync_scope", {
  id: id(), sourceId: text("source_id").notNull().references(() => dataSources.id), term: text("term").notNull(),
  version: integer("version").default(0).notNull(), digest: text("digest"), lastSuccessAt: instant("last_success_at"),
  lastAttemptAt: instant("last_attempt_at"), lastError: text("last_error"),
}, t => [unique().on(t.sourceId, t.term), check("sync_version_nonnegative", sql`${t.version} >= 0`)]);
