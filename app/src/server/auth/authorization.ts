import "server-only";
import { TRPCError } from "@trpc/server";
import { and, eq } from "drizzle-orm";
import type { Database } from "../db/connection";
import { staffPermissions, userRoles, studentClasses, classes, timetableEntries } from "../db/schema";

export type Permission = "timetable.read.own" | "timetable.read.course" | "staff.access" | "supplement.write" | "announcement.manage" | "audit.read";
export type Grant = { permission: Permission; scopeType: "self" | "course" | "group"; groupId?: string; courseId: string | null };
export type Principal = { id: string; displayName: string; email: string; emailVerified: boolean; grants: Grant[] };
export async function getPrincipal(db: Pick<Database, "select">, current: { id: string; name: string; email: string; emailVerified: boolean }): Promise<Principal> {
  const roles = await db.select().from(userRoles).where(eq(userRoles.userId, current.id));
  const grants: Grant[] = roles.flatMap<Grant>(r => r.role === "student" && r.scopeType === "global" && r.courseId === null
    ? [{ permission: "timetable.read.own" as const, scopeType: "self" as const, courseId: null }]
    : r.role === "staff" && r.scopeType === "course" && r.courseId !== null
      ? ["staff.access", "timetable.read.course"].map(permission => ({ permission: permission as Permission, scopeType: "course" as const, courseId: r.courseId })) : []);
  const extra = await db.select().from(staffPermissions).where(eq(staffPermissions.userId, current.id));
  for (const grant of extra) if (roles.some(r => r.role === "staff" && (!grant.courseId || r.courseId === grant.courseId))) grants.push({ permission: grant.permission as Permission, scopeType: grant.courseId ? "course" : "group", courseId: grant.courseId, ...(grant.groupId ? {groupId: grant.groupId} : {}) });
  return { id: current.id, displayName: current.name, email: current.email, emailVerified: current.emailVerified, grants };
}
export function requirePermission(principal: Principal, permission: Permission, courseId?: string) {
  if (!principal.grants.some(g => g.permission === permission && (courseId === undefined || g.courseId === courseId))) throw new TRPCError({ code: "FORBIDDEN" });
}
export function requireSelf(principal: Principal, userId: string) {
  requirePermission(principal, "timetable.read.own");
  if (principal.id !== userId) throw new TRPCError({ code: "FORBIDDEN" });
}
export async function requireEntryAccess(db: Database, principal: Principal, entryId: string) {
  const [entry] = await db.select({ id: timetableEntries.id, classId: classes.id, courseId: classes.courseId }).from(timetableEntries)
    .innerJoin(classes, eq(classes.id, timetableEntries.classId))
    .where(and(eq(timetableEntries.id, entryId), eq(timetableEntries.status, "active"), eq(classes.status, "active")));
  if (entry) {
    if (principal.grants.some(g => g.permission === "timetable.read.course" && g.courseId === entry.courseId)) return entry;
    if (principal.grants.some(g => g.permission === "timetable.read.own")) {
      const [membership] = await db.select({ id: studentClasses.id }).from(studentClasses).where(and(eq(studentClasses.userId, principal.id), eq(studentClasses.classId, entry.classId), eq(studentClasses.status, "active")));
      if (membership) return entry;
    }
  }
  throw new TRPCError({ code: "NOT_FOUND" });
}
