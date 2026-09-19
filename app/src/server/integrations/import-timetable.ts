import "server-only";
import { createHash } from "node:crypto";
import { and, eq, inArray, notInArray, sql } from "drizzle-orm";
import type { Database } from "../db/connection";
import { capacitySnapshots, classes, courses, dataSources, identityLinks, studentClasses, syncScopes, timetableEntries } from "../db/schema";
import { batchSchema, type TimetableAdapter } from "./contracts";

function requireValue<T>(value: T | undefined, message: string): T {
  if (value === undefined) throw new Error(message);
  return value;
}
export async function importTimetable(db: Database, adapter: TimetableAdapter) {
  const [source] = await db.select().from(dataSources).where(eq(dataSources.id, adapter.sourceId));
  if (!source || source.kind !== adapter.kind || source.kind !== "test") throw new Error("Source is not registered for this adapter");
  const scope = and(eq(syncScopes.sourceId, source.id), eq(syncScopes.term, adapter.term));
  try {
    // A failed fetch or malformed payload never becomes an empty successful snapshot.
    const batch = batchSchema.parse(await adapter.load());
    if (batch.term !== adapter.term) throw new Error("Adapter scope mismatch");
    const digest = createHash("sha256").update(JSON.stringify(batch)).digest("hex");
    return await db.transaction(async tx => {
      // Serialize all imports from this source, including different terms.
      await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${source.id}, 0))`);
      await tx.insert(syncScopes).values({ sourceId: source.id, term: batch.term }).onConflictDoNothing();
      const [previous] = await tx.select().from(syncScopes).where(scope);
      if (batch.version < previous.version || (batch.version === previous.version && digest !== previous.digest)) throw new Error("Stale or conflicting source version");
      if (batch.version === previous.version) {
        await tx.update(syncScopes).set({ lastAttemptAt: new Date(), lastError: null }).where(scope);
        return { status: "replayed" as const, version: batch.version };
      }
      const now = new Date();
      for (const row of batch.courses) {
        await tx.insert(courses).values({ ...row, sourceId: source.id }).onConflictDoUpdate({ target: [courses.sourceId, courses.externalId], set: { code: row.code, name: row.name } });
      }
      const courseMap = new Map((await tx.select().from(courses).where(eq(courses.sourceId, source.id))).map(c => [c.externalId, c]));
      const oldClasses = new Map((await tx.select().from(classes).where(eq(classes.sourceId, source.id))).map(c => [c.externalId, c]));
      for (const row of batch.classes) {
        const course = requireValue(courseMap.get(row.courseExternalId), "Unknown course");
        const old = oldClasses.get(row.externalId);
        if (old && (old.term !== batch.term || old.courseId !== course.id)) throw new Error("Class external identity cannot move course or term");
        const values = { sourceId: source.id, externalId: row.externalId, courseId: course.id, term: batch.term, classCode: row.classCode, type: row.type, status: row.status };
        await tx.insert(classes).values(values).onConflictDoUpdate({ target: [classes.sourceId, classes.externalId], set: { classCode: row.classCode, type: row.type, status: row.status } });
      }
      const scopedClasses = await tx.select().from(classes).where(and(eq(classes.sourceId, source.id), eq(classes.term, batch.term)));
      const classMap = new Map(scopedClasses.map(c => [c.externalId, c]));
      const classId = (externalId: string) => requireValue(classMap.get(externalId), "Unknown class in import scope").id;
      for (const row of batch.entries) {
        const target = classId(row.classExternalId);
        const [old] = await tx.select().from(timetableEntries).where(and(eq(timetableEntries.sourceId, source.id), eq(timetableEntries.externalId, row.externalId)));
        if (old && old.classId !== target) throw new Error("Entry external identity cannot move class");
        const values = { classId: target, sourceId: source.id, sourceKind: source.kind, externalId: row.externalId, startAt: new Date(row.startAt), endAt: new Date(row.endAt), location: row.location, status: row.status, verificationStatus: "unverified" as const, sourceUpdatedAt: row.sourceUpdatedAt === null ? null : new Date(row.sourceUpdatedAt), syncedAt: now };
        await tx.insert(timetableEntries).values(values).onConflictDoUpdate({ target: [timetableEntries.sourceId, timetableEntries.externalId], set: values });
      }
      for (const row of batch.memberships) {
        const [identity] = await tx.select().from(identityLinks).where(and(eq(identityLinks.identityProvider, row.identityProvider), eq(identityLinks.externalSubject, row.externalSubject)));
        if (!identity) throw new Error("Unmapped identity; never create users by matching email during import");
        const target = classId(row.classExternalId);
        const [old] = await tx.select().from(studentClasses).where(and(eq(studentClasses.sourceId, source.id), eq(studentClasses.externalId, row.externalId)));
        if (old && (old.classId !== target || old.userId !== identity.userId)) throw new Error("Membership external identity cannot move user or class");
        const values = { userId: identity.userId, classId: target, sourceId: source.id, externalId: row.externalId, status: row.status, syncedAt: now };
        await tx.insert(studentClasses).values(values).onConflictDoUpdate({ target: [studentClasses.sourceId, studentClasses.externalId], set: { status: row.status, syncedAt: now } });
      }
      for (const row of batch.capacities) {
        const target = classId(row.classExternalId);
        const [old] = await tx.select().from(capacitySnapshots).where(and(eq(capacitySnapshots.sourceId, source.id), eq(capacitySnapshots.externalId, row.externalId)));
        if (old && (old.classId !== target || old.observedAt.getTime() !== Date.parse(row.observedAt) || old.total !== row.total || old.available !== row.available)) throw new Error("Capacity observations are immutable; corrections need a new observation ID and time");
        await tx.insert(capacitySnapshots).values({ classId: target, sourceId: source.id, sourceKind: source.kind, externalId: row.externalId, total: row.total, available: row.available, observedAt: new Date(row.observedAt), verificationStatus: "unverified", syncedAt: now }).onConflictDoNothing({ target: [capacitySnapshots.sourceId, capacitySnapshots.externalId] });
      }
      if (batch.mode === "snapshot") {
        const missingClasses = batch.classes.length ? notInArray(classes.externalId, batch.classes.map(c => c.externalId)) : undefined;
        await tx.update(classes).set({ status: "cancelled" }).where(and(eq(classes.sourceId, source.id), eq(classes.term, batch.term), missingClasses));
        const ids = scopedClasses.map(c => c.id);
        if (ids.length) {
          await tx.update(timetableEntries).set({ status: "cancelled", syncedAt: now }).where(and(eq(timetableEntries.sourceId, source.id), inArray(timetableEntries.classId, ids), batch.entries.length ? notInArray(timetableEntries.externalId, batch.entries.map(e => e.externalId)) : undefined));
          await tx.update(studentClasses).set({ status: "inactive", syncedAt: now }).where(and(eq(studentClasses.sourceId, source.id), inArray(studentClasses.classId, ids), batch.memberships.length ? notInArray(studentClasses.externalId, batch.memberships.map(m => m.externalId)) : undefined));
        }
      }
      await tx.update(syncScopes).set({ version: batch.version, digest, lastAttemptAt: now, lastSuccessAt: now, lastError: null }).where(scope);
      await tx.update(dataSources).set({ lastSuccessAt: now }).where(eq(dataSources.id, source.id));
      return { status: "imported" as const, version: batch.version };
    });
  } catch (error) {
    // Diagnostic status is persisted separately; the failed transaction changes no business rows.
    await db.insert(syncScopes).values({ sourceId: source.id, term: adapter.term, lastAttemptAt: new Date(), lastError: "IMPORT_FAILED" }).onConflictDoUpdate({ target: [syncScopes.sourceId, syncScopes.term], set: { lastAttemptAt: new Date(), lastError: "IMPORT_FAILED" } });
    throw error;
  }
}
