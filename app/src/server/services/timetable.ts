import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import { and, asc, desc, eq, exists, gt, gte, inArray, lt, lte, or, sql } from "drizzle-orm";
import { TRPCError } from "@trpc/server";
import { z } from "zod";
import type { Database } from "../db/connection";
import { capacitySnapshots, classes, courses, dataSources, studentClasses, syncScopes, timetableEntries } from "../db/schema";
import { requireSelf, type Principal } from "../auth/authorization";

const instant = z.iso.datetime({ offset: true });
export const rangeInput = z.strictObject({ from: instant, to: instant, cursor: z.string().max(2048).optional(), limit: z.number().int().min(1).max(100).default(20) }).refine(r => Date.parse(r.from) < Date.parse(r.to) && Date.parse(r.to) - Date.parse(r.from) <= 62 * 86400000, "Query at most 62 days with from < to");
const cursorPayload = z.strictObject({ id: z.uuid(), startAt: instant, from: instant, to: instant, userId: z.string() });
export type CapacityPolicy = { sourceId: string; maxAgeMs: number; asOf: Date };
export function configuredCapacityPolicy(): CapacityPolicy | undefined {
  if (!process.env.CAPACITY_SOURCE_ID) return undefined;
  const hours = z.coerce.number().int().positive().max(8760).parse(process.env.CAPACITY_MAX_AGE_HOURS);
  return { sourceId: process.env.CAPACITY_SOURCE_ID, maxAgeMs: hours * 3600000, asOf: new Date() };
}
function ownMembership(db: Database, principal: Principal) {
  return exists(db.select({ id: studentClasses.id }).from(studentClasses).where(and(eq(studentClasses.classId, classes.id), eq(studentClasses.userId, principal.id), eq(studentClasses.status, "active"))));
}
const selection = { entry: timetableEntries, class: classes, course: courses, source: dataSources, sync: syncScopes };
function baseQuery(db: Database) {
  return db.select(selection).from(timetableEntries).innerJoin(classes, eq(timetableEntries.classId, classes.id)).innerJoin(courses, eq(classes.courseId, courses.id)).innerJoin(dataSources, eq(timetableEntries.sourceId, dataSources.id)).leftJoin(syncScopes, and(eq(syncScopes.sourceId, dataSources.id), eq(syncScopes.term, classes.term)));
}
type Row = Awaited<ReturnType<typeof baseQuery>>[number];
async function serialize(db: Database, rows: Row[], policy?: CapacityPolicy) {
  if (policy && (!Number.isFinite(policy.asOf.getTime()) || !Number.isFinite(policy.maxAgeMs) || policy.maxAgeMs < 0)) throw new Error("Invalid capacity policy");
  const snapshots = rows.length && policy ? await db.select({ capacity: capacitySnapshots, source: dataSources }).from(capacitySnapshots)
    .innerJoin(dataSources, eq(capacitySnapshots.sourceId, dataSources.id))
    .where(and(inArray(capacitySnapshots.classId, rows.map(r => r.class.id)), eq(capacitySnapshots.sourceId, policy.sourceId), lte(capacitySnapshots.observedAt, policy.asOf), gte(capacitySnapshots.observedAt, new Date(policy.asOf.getTime() - policy.maxAgeMs))))
    .orderBy(desc(capacitySnapshots.observedAt), capacitySnapshots.id) : [];
  const sourceInfo = (s: typeof dataSources.$inferSelect) => ({ id: s.id, name: s.name, kind: s.kind });
  return rows.map(row => {
    const snapshot = snapshots.find(s => s.capacity.classId === row.class.id);
    return {
      id: row.entry.id, classId: row.class.id, course: { id: row.course.id, code: row.course.code, name: row.course.name }, classType: row.class.type,
      startAt: row.entry.startAt.toISOString(), endAt: row.entry.endAt.toISOString(), location: row.entry.location,
      source: sourceInfo(row.source), verificationStatus: row.entry.verificationStatus, sourceUpdatedAt: row.entry.sourceUpdatedAt?.toISOString() ?? null, syncedAt: row.entry.syncedAt.toISOString(), sourceUpdateFailed: !!row.sync?.lastError,
      capacity: snapshot ? { total: snapshot.capacity.total, available: snapshot.capacity.available, observedAt: snapshot.capacity.observedAt.toISOString(), verificationStatus: snapshot.capacity.verificationStatus, source: sourceInfo(snapshot.source) } : null,
      supplements: [] as { id: string; entryId: string; content: string; updatedAt: string; revision: number }[],
    };
  });
}
export type TimetableItem = Awaited<ReturnType<typeof serialize>>[number];
export async function studentTimetable(db: Database, principal: Principal, raw: z.input<typeof rangeInput>, secret: string, capacityPolicy?: CapacityPolicy) {
  requireSelf(principal, principal.id);
  const input = rangeInput.parse(raw);
  const from = new Date(input.from).toISOString(), to = new Date(input.to).toISOString();
  let after;
  if (input.cursor) {
    try {
      const [encoded, signature, extra] = input.cursor.split(".");
      const expected = createHmac("sha256", secret).update(encoded).digest("hex");
      if (extra || !signature || signature.length !== expected.length || !timingSafeEqual(Buffer.from(signature), Buffer.from(expected))) throw new Error();
      const payload = cursorPayload.parse(JSON.parse(Buffer.from(encoded, "base64url").toString()));
      if (payload.userId !== principal.id || payload.from !== from || payload.to !== to) throw new Error();
      after = or(gt(timetableEntries.startAt, new Date(payload.startAt)), and(eq(timetableEntries.startAt, new Date(payload.startAt)), gt(timetableEntries.id, payload.id)));
    } catch { throw new TRPCError({ code: "BAD_REQUEST" }); }
  }
  const rows = await baseQuery(db).where(and(ownMembership(db, principal), eq(classes.status, "active"), eq(timetableEntries.status, "active"), lt(timetableEntries.startAt, new Date(to)), gt(timetableEntries.endAt, new Date(from)), after)).orderBy(asc(timetableEntries.startAt), asc(timetableEntries.id)).limit(input.limit + 1);
  const page = rows.slice(0, input.limit);
  let nextCursor: string | null = null;
  if (rows.length > input.limit) {
    const last = page.at(-1)!;
    const encoded = Buffer.from(JSON.stringify({ id: last.entry.id, startAt: last.entry.startAt.toISOString(), from, to, userId: principal.id })).toString("base64url");
    nextCursor = `${encoded}.${createHmac("sha256", secret).update(encoded).digest("hex")}`;
  }
  return { items: await serialize(db, page, capacityPolicy), nextCursor };
}
export async function getTimetableEntry(db: Database, principal: Principal, entryId: string, capacityPolicy?: CapacityPolicy) {
  const own = principal.grants.some(g => g.permission === "timetable.read.own") ? ownMembership(db, principal) : sql`false`;
  const courseIds = principal.grants.filter(g => g.permission === "timetable.read.course" && g.courseId).map(g => g.courseId!);
  const [row] = await baseQuery(db).where(and(eq(timetableEntries.id, entryId), eq(timetableEntries.status, "active"), eq(classes.status, "active"), or(own, courseIds.length ? inArray(courses.id, courseIds) : sql`false`))).limit(1);
  if (!row) throw new TRPCError({ code: "NOT_FOUND" });
  return (await serialize(db, [row], capacityPolicy))[0];
}
