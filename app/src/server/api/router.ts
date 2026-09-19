import "server-only";
import { z } from "zod";
import { inArray } from "drizzle-orm";
import { courses } from "../db/schema";
import { requirePermission } from "../auth/authorization";
import { protectedProcedure, router } from "./trpc";
import { configuredCapacityPolicy, getTimetableEntry, rangeInput, studentTimetable } from "../services/timetable";
import * as staffService from "../services/staff";
import * as shareService from "../services/shares";
export const appRouter = router({
  timetable: router({
    compare:protectedProcedure.input(shareService.readInput).query(async({ctx,input})=>shareService.readShare(ctx.db,ctx.principal,input,(await ctx.auth.$context).secret,true)),
    mine: protectedProcedure.input(rangeInput).query(async ({ctx, input}) => studentTimetable(ctx.db, ctx.principal, input, (await ctx.auth.$context).secret, configuredCapacityPolicy())),
    getEntry: protectedProcedure.input(z.strictObject({entryId: z.uuid()})).query(({ctx, input}) => getTimetableEntry(ctx.db, ctx.principal, input.entryId, configuredCapacityPolicy())),
  }),
  share:router({
    recipients:protectedProcedure.input(z.void()).query(({ctx})=>shareService.recipients(ctx.db,ctx.principal)),
    create:protectedProcedure.input(shareService.createInput).mutation(({ctx,input})=>shareService.createShare(ctx.db,ctx.principal,input)),
    list:protectedProcedure.input(shareService.listInput).query(({ctx,input})=>shareService.listShares(ctx.db,ctx.principal,input)),
    revoke:protectedProcedure.input(z.strictObject({shareId:z.uuid()})).mutation(({ctx,input})=>shareService.revokeShare(ctx.db,ctx.principal,input.shareId)),
    read:protectedProcedure.input(shareService.readInput).query(async({ctx,input})=>{const r=await shareService.readShare(ctx.db,ctx.principal,input,(await ctx.auth.$context).secret);return {...r,items:r.items.map(i=>i.entry)};}),
  }),
  supplement: router({save:protectedProcedure.input(staffService.supplementInput).mutation(({ctx,input})=>staffService.saveSupplement(ctx.db,ctx.principal,input,ctx.requestId))}),
  announcement: router({
    options:protectedProcedure.input(z.void()).query(({ctx})=>staffService.announcementOptions(ctx.db,ctx.principal)),
    create:protectedProcedure.input(staffService.announcementInput).mutation(({ctx,input})=>staffService.createAnnouncement(ctx.db,ctx.principal,input,ctx.requestId)),
    update:protectedProcedure.input(staffService.announcementUpdateInput).mutation(({ctx,input})=>staffService.changeAnnouncement(ctx.db,ctx.principal,input,"update",ctx.requestId)),
    publish:protectedProcedure.input(staffService.revisionInput).mutation(({ctx,input})=>staffService.changeAnnouncement(ctx.db,ctx.principal,input,"publish",ctx.requestId)),
    withdraw:protectedProcedure.input(staffService.revisionInput).mutation(({ctx,input})=>staffService.changeAnnouncement(ctx.db,ctx.principal,input,"withdraw",ctx.requestId)),
    listManaged:protectedProcedure.input(staffService.managedInput).query(({ctx,input})=>staffService.listManaged(ctx.db,ctx.principal,input)),
    listVisible:protectedProcedure.input(staffService.pageInput).query(({ctx,input})=>staffService.visibleAnnouncements(ctx.db,ctx.principal,input)),
    getVisible:protectedProcedure.input(z.strictObject({announcementId:z.uuid()})).query(async({ctx,input})=>(await staffService.visibleAnnouncements(ctx.db,ctx.principal,{limit:1},input.announcementId)).items[0]),
  }),
  audit:router({
    list:protectedProcedure.input(staffService.auditInput).query(({ctx,input})=>staffService.readAudit(ctx.db,ctx.principal,input)),
    get:protectedProcedure.input(z.strictObject({auditId:z.uuid()})).query(async({ctx,input})=>(await staffService.readAudit(ctx.db,ctx.principal,{limit:1},input.auditId)).items[0]),
  }),
  account: router({ me: protectedProcedure.input(z.void()).query(({ ctx }) => ctx.principal) }),
  staff: router({
    listEntries:protectedProcedure.input(rangeInput.safeExtend({courseId:z.uuid().optional()})).query(async({ctx,input})=>{
      requirePermission(ctx.principal,"timetable.read.course",input.courseId);
      const ids=ctx.principal.grants.filter(g=>g.permission==="timetable.read.course"&&g.courseId&&(!input.courseId||g.courseId===input.courseId)).map(g=>g.courseId!);
      const {courseId: _courseId,...range}=input;void _courseId;
      return studentTimetable(ctx.db,ctx.principal,range,(await ctx.auth.$context).secret,configuredCapacityPolicy(),ids);
    }), courses: protectedProcedure.input(z.void()).query(async ({ ctx }) => {
    requirePermission(ctx.principal, "staff.access");
    const ids = ctx.principal.grants.filter(g => g.permission === "timetable.read.course" && g.courseId).map(g => g.courseId!);
    return ids.length ? ctx.db.select({ id: courses.id, code: courses.code, name: courses.name }).from(courses).where(inArray(courses.id, ids)) : [];
  }) }),
});
export type AppRouter = typeof appRouter;
