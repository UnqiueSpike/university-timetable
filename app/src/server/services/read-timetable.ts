import "server-only";
import { and, desc, eq, gt, lt } from "drizzle-orm";
import { z } from "zod";
import type { Database } from "../db/connection";
import { capacitySnapshots, classes, courses, dataSources, studentClasses, timetableEntries } from "../db/schema";

// Internal repository read, NOT an authorized endpoint. Step 3/4 must obtain userId from a session.
// Capacity is only selected when the caller supplies an explicit source and freshness policy.
export async function readStudentTimetable(db: Database, userId: string, range: { from: string; to: string }, capacityPolicy?: { sourceId: string; asOf: Date; maxAgeMs: number }) {
  const parsed = z.strictObject({ from: z.iso.datetime({ offset: true }), to: z.iso.datetime({ offset: true }) }).refine(r => Date.parse(r.from) < Date.parse(r.to)).parse(range);
  if (capacityPolicy && (!Number.isFinite(capacityPolicy.maxAgeMs) || capacityPolicy.maxAgeMs < 0 || !Number.isFinite(capacityPolicy.asOf.getTime()))) throw new Error("Invalid capacity freshness policy");
  const rows = await db.select({ entry: timetableEntries, course: courses, class: classes, source: dataSources }).from(studentClasses)
    .innerJoin(classes, eq(studentClasses.classId, classes.id))
    .innerJoin(courses, eq(classes.courseId, courses.id))
    .innerJoin(timetableEntries, eq(timetableEntries.classId, classes.id))
    .innerJoin(dataSources, eq(timetableEntries.sourceId, dataSources.id))
    .where(and(eq(studentClasses.userId, userId), eq(studentClasses.status, "active"), eq(classes.status, "active"), eq(timetableEntries.status, "active"), lt(timetableEntries.startAt, new Date(parsed.to)), gt(timetableEntries.endAt, new Date(parsed.from))))
    .orderBy(timetableEntries.startAt, timetableEntries.id);
  return Promise.all(rows.map(async row => {
    const snapshots = capacityPolicy ? await db.select({ snapshot: capacitySnapshots, source: dataSources }).from(capacitySnapshots)
      .innerJoin(dataSources, eq(capacitySnapshots.sourceId, dataSources.id))
      .where(and(eq(capacitySnapshots.classId, row.class.id), eq(capacitySnapshots.sourceId, capacityPolicy.sourceId)))
      .orderBy(desc(capacitySnapshots.observedAt)) : [];
    const selected = capacityPolicy ? snapshots.find(r => {
      const age = capacityPolicy.asOf.getTime() - r.snapshot.observedAt.getTime();
      return age >= 0 && age <= capacityPolicy.maxAgeMs;
    }) : undefined;
    const sourceInfo = (source: typeof dataSources.$inferSelect) => ({ id: source.id, name: source.name, kind: source.kind });
    return {
      id: row.entry.id, classId: row.class.id, course: { id: row.course.id, code: row.course.code, name: row.course.name }, classType: row.class.type,
      startAt: row.entry.startAt.toISOString(), endAt: row.entry.endAt.toISOString(), location: row.entry.location,
      source: sourceInfo(row.source), verificationStatus: row.entry.verificationStatus,
      sourceUpdatedAt: row.entry.sourceUpdatedAt?.toISOString() ?? null, syncedAt: row.entry.syncedAt.toISOString(),
      capacity: selected ? { total: selected.snapshot.total, available: selected.snapshot.available, observedAt: selected.snapshot.observedAt.toISOString(), source: sourceInfo(selected.source), verificationStatus: selected.snapshot.verificationStatus } : null,
    };
  }));
}
