import "server-only";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { courses } from "../db/schema";
import { requirePermission } from "../auth/authorization";
import { protectedProcedure, router } from "./trpc";
export const appRouter = router({
  account: router({ me: protectedProcedure.input(z.void()).query(({ ctx }) => ctx.principal) }),
  staff: router({ courses: protectedProcedure.input(z.void()).query(async ({ ctx }) => {
    requirePermission(ctx.principal, "staff.access");
    const ids = ctx.principal.grants.filter(g => g.permission === "timetable.read.course" && g.courseId).map(g => g.courseId!);
    return ids.length ? ctx.db.select({ id: courses.id, code: courses.code, name: courses.name }).from(courses).where(inArray(courses.id, ids)) : [];
  }) }),
});
export type AppRouter = typeof appRouter;
