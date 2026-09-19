import { sql } from "drizzle-orm";
import { boolean, check, foreignKey, index, integer, jsonb, pgEnum, pgTable, text, timestamp, unique, uniqueIndex, uuid } from "drizzle-orm/pg-core";

const instant = (name: string) => timestamp(name, { withTimezone: true, mode: "date" });
const id = () => uuid("id").defaultRandom().primaryKey();
export const sourceKind = pgEnum("source_kind", ["official", "test", "supplementary"]);
export const verificationStatus = pgEnum("verification_status", ["verified", "unverified"]);
export const recordStatus = pgEnum("record_status", ["active", "cancelled"]);
export const membershipStatus = pgEnum("membership_status", ["active", "inactive"]);

// Better Auth and all business relations share this canonical user model.
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

export const session = pgTable("session", {
  id: text("id").primaryKey(), token: text("token").notNull().unique(),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  expiresAt: instant("expires_at").notNull(), createdAt: instant("created_at").defaultNow().notNull(), updatedAt: instant("updated_at").defaultNow().notNull(),
  ipAddress: text("ip_address"), userAgent: text("user_agent"),
}, t => [index("session_user_idx").on(t.userId)]);
export const account = pgTable("account", {
  id: text("id").primaryKey(), userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  providerId: text("provider_id").notNull(), accountId: text("account_id").notNull(), password: text("password"),
  accessToken: text("access_token"), refreshToken: text("refresh_token"), idToken: text("id_token"), scope: text("scope"),
  accessTokenExpiresAt: instant("access_token_expires_at"), refreshTokenExpiresAt: instant("refresh_token_expires_at"),
  createdAt: instant("created_at").defaultNow().notNull(), updatedAt: instant("updated_at").defaultNow().notNull(),
}, t => [unique().on(t.providerId, t.accountId), index("account_user_idx").on(t.userId)]);
export const verification = pgTable("verification", {
  id: text("id").primaryKey(), identifier: text("identifier").notNull(), value: text("value").notNull(),
  expiresAt: instant("expires_at").notNull(), createdAt: instant("created_at").defaultNow().notNull(), updatedAt: instant("updated_at").defaultNow().notNull(),
}, t => [index("verification_identifier_idx").on(t.identifier)]);


export const userGroups = pgTable("user_group", { id: id(), name: text("name").notNull(), active: boolean("active").default(true).notNull() });
export const groupMembers = pgTable("group_member", {
  id: id(), groupId: uuid("group_id").notNull().references(() => userGroups.id), userId: text("user_id").notNull().references(() => user.id), active: boolean("active").default(true).notNull(),
}, t => [unique().on(t.groupId, t.userId)]);
export const staffPermissions = pgTable("staff_permission", {
  id: id(), userId: text("user_id").notNull().references(() => user.id), permission: text("permission").notNull(),
  courseId: uuid("course_id").references(() => courses.id), groupId: uuid("group_id").references(() => userGroups.id),
}, t => [check("permission_scope", sql`(${t.courseId} IS NOT NULL) <> (${t.groupId} IS NOT NULL)`),
  check("permission_name", sql`${t.permission} IN ('supplement.write', 'announcement.manage', 'audit.read') AND (${t.permission} <> 'supplement.write' OR ${t.courseId} IS NOT NULL)`),
  unique().on(t.userId, t.permission, t.courseId), unique().on(t.userId, t.permission, t.groupId)]);
export const supplements = pgTable("supplement", {
  id: id(), entryId: uuid("entry_id").notNull().references(() => timetableEntries.id), content: text("content").notNull(),
  authorId: text("author_id").notNull().references(() => user.id), updatedBy: text("updated_by").notNull().references(() => user.id),
  updatedAt: instant("updated_at").defaultNow().notNull(), revision: integer("revision").default(1).notNull(),
}, t => [check("supplement_revision", sql`${t.revision} > 0`), check("supplement_content", sql`length(trim(${t.content})) BETWEEN 1 AND 5000`), index("supplement_entry_idx").on(t.entryId)]);
export const announcements = pgTable("announcement", {
  id: id(), authorId: text("author_id").notNull().references(() => user.id), title: text("title").notNull(), body: text("body").notNull(),
  status: text("status").default("draft").notNull(), revision: integer("revision").default(1).notNull(),
  createdAt: instant("created_at").defaultNow().notNull(), updatedAt: instant("updated_at").defaultNow().notNull(), publishedAt: instant("published_at"), withdrawnAt: instant("withdrawn_at"),
}, t => [check("announcement_revision", sql`${t.revision} > 0`), check("announcement_content", sql`length(trim(${t.title})) BETWEEN 1 AND 200 AND length(trim(${t.body})) BETWEEN 1 AND 5000`),
  check("announcement_state", sql`(${t.status} = 'draft' AND ${t.publishedAt} IS NULL AND ${t.withdrawnAt} IS NULL) OR (${t.status} = 'published' AND ${t.publishedAt} IS NOT NULL AND ${t.withdrawnAt} IS NULL) OR (${t.status} = 'withdrawn' AND ${t.publishedAt} IS NOT NULL AND ${t.withdrawnAt} >= ${t.publishedAt})`), index("announcement_visible_idx").on(t.status, t.publishedAt, t.id)]);
export const announcementTargets = pgTable("announcement_target", {
  id: id(), announcementId: uuid("announcement_id").notNull().references(() => announcements.id),
  courseId: uuid("course_id").references(() => courses.id), classId: uuid("class_id").references(() => classes.id), groupId: uuid("group_id").references(() => userGroups.id),
}, t => [check("announcement_target_one", sql`num_nonnulls(${t.courseId}, ${t.classId}, ${t.groupId}) = 1`), unique().on(t.announcementId, t.courseId), unique().on(t.announcementId, t.classId), unique().on(t.announcementId, t.groupId)]);
export const auditEvents = pgTable("audit_event", {
  id: id(), actorId: text("actor_id").notNull().references(() => user.id), action: text("action").notNull(), resource: text("resource").notNull(), entityId: uuid("entity_id").notNull(),
  occurredAt: instant("occurred_at").defaultNow().notNull(), requestId: text("request_id").notNull(),
  courseIds: uuid("course_ids").array().default(sql`'{}'::uuid[]`).notNull(), groupIds: uuid("group_ids").array().default(sql`'{}'::uuid[]`).notNull(),
  before: jsonb("before").$type<Record<string, unknown> | null>(), after: jsonb("after").$type<Record<string, unknown>>().notNull(),
}, t => [index("audit_time_idx").on(t.occurredAt, t.id)]);

// Explicit, administrator-maintained pair selection; never an unrestricted user directory.
export const shareRecipients = pgTable("share_recipient", {
  id:id(), ownerId:text("owner_id").notNull().references(()=>user.id),recipientId:text("recipient_id").notNull().references(()=>user.id),active:boolean("active").notNull().default(true),
},t=>[unique().on(t.ownerId,t.recipientId),check("share_recipient_distinct",sql`${t.ownerId} <> ${t.recipientId}`)]);
export const shares = pgTable("share", {
  id:id(),ownerId:text("owner_id").notNull().references(()=>user.id),recipientId:text("recipient_id").notNull().references(()=>user.id),
  from:instant("from_at").notNull(),to:instant("to_at").notNull(),allowedFields:text("allowed_fields").array().notNull(),
  consentedAt:instant("consented_at").notNull().defaultNow(),expiresAt:instant("expires_at").notNull(),revokedAt:instant("revoked_at"),
},t=>[index().on(t.ownerId,t.id),index().on(t.recipientId,t.id),check("share_distinct",sql`${t.ownerId} <> ${t.recipientId}`),check("share_time_range",sql`${t.from} < ${t.to} AND ${t.to} <= ${t.from} + interval '62 days'`),check("share_expiration",sql`${t.expiresAt} > ${t.consentedAt} AND ${t.expiresAt} <= ${t.consentedAt} + interval '30 days'`),check("share_fields",sql`${t.allowedFields} = ARRAY['startAt','endAt']::text[] OR ${t.allowedFields} = ARRAY['course','classType','startAt','endAt','location']::text[]`)]);

// Zero replicates only this per-user opaque invalidation token, never business payloads.
export const syncSignals=pgTable("sync_signal",{userId:text("user_id").primaryKey().references(()=>user.id,{onDelete:"cascade"}),revision:text("revision").notNull().default(sql`gen_random_uuid()::text`)});
