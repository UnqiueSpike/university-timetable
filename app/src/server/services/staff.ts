import "server-only";
import { and, asc, desc, eq, gt, inArray, lt, or, sql, type SQL } from "drizzle-orm";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import type { Database } from "../db/connection";
import { announcements, announcementTargets, auditEvents, classes, courses, staffPermissions, supplements, timetableEntries, user, userGroups, userRoles } from "../db/schema";
import { getPrincipal, requirePermission, requireSelf, type Principal } from "../auth/authorization";
export const pageInput = z.strictObject({ cursor: z.uuid().optional(), limit: z.number().int().min(1).max(100).default(20) });
export const targetInput = z.discriminatedUnion("type", [z.strictObject({type:z.literal("course"),courseId:z.uuid()}),z.strictObject({type:z.literal("class"),classId:z.uuid()}),z.strictObject({type:z.literal("group"),groupId:z.uuid()})]);
export type Target = z.infer<typeof targetInput>;
const content = { title:z.string().trim().min(1).max(200), body:z.string().trim().min(1).max(5000), targets:z.array(targetInput).max(20).refine(v=>new Set(v.map(t=>JSON.stringify(t))).size===v.length,"Duplicate target") };
export const announcementInput = z.strictObject(content);
export const announcementUpdateInput = z.strictObject({...content,announcementId:z.uuid(),expectedRevision:z.number().int().positive()});
export const revisionInput = z.strictObject({announcementId:z.uuid(),expectedRevision:z.number().int().positive()});
export const supplementInput = z.strictObject({entryId:z.uuid(),supplementId:z.uuid().optional(),content:z.string().trim().min(1).max(5000),expectedRevision:z.number().int().positive().optional()}).refine(i=>!!i.supplementId===!!i.expectedRevision,"Editing requires both ID and revision");
export const managedInput = pageInput.extend({status:z.enum(["draft","published","withdrawn"]).optional()});
export const auditInput = pageInput.extend({action:z.enum(["supplement.create","supplement.update","announcement.create","announcement.update","announcement.publish","announcement.withdraw"]).optional(),resource:z.enum(["supplement","announcement"]).optional(),actorId:z.string().max(200).optional(),from:z.iso.datetime({offset:true}).optional(),to:z.iso.datetime({offset:true}).optional()}).refine(i=>!i.from||!i.to||Date.parse(i.from)<Date.parse(i.to));
type Tx = Parameters<Parameters<Database["transaction"]>[0]>[0];
const denied = () => new TRPCError({code:"NOT_FOUND"});
const conflict = () => new TRPCError({code:"CONFLICT"});
const scopeIds = (p:Principal, permission:"announcement.manage"|"audit.read") => ({courses:p.grants.filter(g=>g.permission===permission&&g.courseId).map(g=>g.courseId!),groups:p.grants.filter(g=>g.permission===permission&&g.groupId).map(g=>g.groupId!)});
function page<T extends {id:string}>(rows:T[],limit:number) {return {items:rows.slice(0,limit),nextCursor:rows.length>limit?rows[limit-1].id:null};}
async function mutation<T>(db:Database,p:Principal,run:(tx:Tx,current:Principal)=>Promise<T>) {
  return db.transaction(async tx=>{
    // Lock existing grants so revocation cannot race the commit of an authorized write.
    await tx.select().from(userRoles).where(eq(userRoles.userId,p.id)).for("share");
    await tx.select().from(staffPermissions).where(eq(staffPermissions.userId,p.id)).for("share");
    const current=await getPrincipal(tx,{id:p.id,name:p.displayName,email:p.email,emailVerified:p.emailVerified});
    return run(tx,current);
  });
}
async function audit(tx:Tx,p:Principal,requestId:string,action:string,resource:string,entityId:string,scopes:{courseIds:string[];groupIds:string[]},before:Record<string,unknown>|null,after:Record<string,unknown>) {
  await tx.insert(auditEvents).values({actorId:p.id,requestId,action,resource,entityId,...scopes,before,after});
}
export async function saveSupplement(db:Database,p:Principal,input:z.infer<typeof supplementInput>,requestId:string) {
  return mutation(db,p,async(tx,current)=>{
    const [entry]=await tx.select({courseId:classes.courseId}).from(timetableEntries).innerJoin(classes,eq(timetableEntries.classId,classes.id)).where(and(eq(timetableEntries.id,input.entryId),eq(timetableEntries.status,"active"),eq(classes.status,"active"))).for("share");
    if(!entry) throw denied(); requirePermission(current,"supplement.write",entry.courseId);
    let before:typeof supplements.$inferSelect|null=null, saved:typeof supplements.$inferSelect;
    if(input.supplementId) {
      [before]=await tx.select().from(supplements).where(and(eq(supplements.id,input.supplementId),eq(supplements.entryId,input.entryId))).for("update");
      if(!before) throw denied(); if(before.revision!==input.expectedRevision) throw conflict();
      [saved]=await tx.update(supplements).set({content:input.content,revision:before.revision+1,updatedAt:new Date(),updatedBy:p.id}).where(eq(supplements.id,before.id)).returning();
    }else [saved]=await tx.insert(supplements).values({entryId:input.entryId,content:input.content,authorId:p.id,updatedBy:p.id}).returning();
    await audit(tx,current,requestId,before?"supplement.update":"supplement.create","supplement",saved.id,{courseIds:[entry.courseId],groupIds:[]},before,saved);
    return {id:saved.id,entryId:saved.entryId,content:saved.content,revision:saved.revision,updatedAt:saved.updatedAt.toISOString()};
  });
}
async function targetScopes(tx:Tx,p:Principal,targets:Target[],active=true) {
  const courseIds:string[]=[],groupIds:string[]=[];
  for(const target of targets) {
    if(target.type==="group") {
      if(!p.grants.some(g=>g.permission==="announcement.manage"&&g.groupId===target.groupId)) throw new TRPCError({code:"FORBIDDEN"});
      const [group]=await tx.select().from(userGroups).where(eq(userGroups.id,target.groupId)).for("share");
      if(!group||(active&&!group.active))throw denied();groupIds.push(group.id);
    }else {
      let courseId:string;
      if(target.type==="class") {const [row]=await tx.select().from(classes).where(eq(classes.id,target.classId)).for("share");if(!row||(active&&row.status!=="active"))throw denied();courseId=row.courseId;}
      else {const [row]=await tx.select().from(courses).where(eq(courses.id,target.courseId)).for("share");if(!row)throw denied();courseId=row.id;}
      requirePermission(p,"announcement.manage",courseId);courseIds.push(courseId);
    }
  }
  return {courseIds:[...new Set(courseIds)],groupIds:[...new Set(groupIds)]};
}
async function targetsFor(db:Pick<Database,"select">,id:string):Promise<Target[]> {return (await db.select().from(announcementTargets).where(eq(announcementTargets.announcementId,id))).map(t=>t.courseId?{type:"course",courseId:t.courseId}:t.classId?{type:"class",classId:t.classId}:{type:"group",groupId:t.groupId!});}
async function writeTargets(tx:Tx,id:string,targets:Target[]) {await tx.delete(announcementTargets).where(eq(announcementTargets.announcementId,id));if(targets.length)await tx.insert(announcementTargets).values(targets.map(t=>({announcementId:id,...(t.type==="course"?{courseId:t.courseId}:t.type==="class"?{classId:t.classId}:{groupId:t.groupId})})));}
function serialize(a:typeof announcements.$inferSelect,targets:Target[]) {return {...a,createdAt:a.createdAt.toISOString(),updatedAt:a.updatedAt.toISOString(),publishedAt:a.publishedAt?.toISOString()??null,withdrawnAt:a.withdrawnAt?.toISOString()??null,targets};}
export async function createAnnouncement(db:Database,p:Principal,input:z.infer<typeof announcementInput>,requestId:string) {
  return mutation(db,p,async(tx,current)=>{
    requirePermission(current,"announcement.manage");const scopes=await targetScopes(tx,current,input.targets);
    const [saved]=await tx.insert(announcements).values({authorId:p.id,title:input.title,body:input.body}).returning();await writeTargets(tx,saved.id,input.targets);
    const result=serialize(saved,input.targets);await audit(tx,current,requestId,"announcement.create","announcement",saved.id,scopes,null,result);return result;
  });
}
export async function changeAnnouncement(db:Database,p:Principal,input:z.infer<typeof revisionInput>|z.infer<typeof announcementUpdateInput>,action:"update"|"publish"|"withdraw",requestId:string) {
  return mutation(db,p,async(tx,current)=>{
    requirePermission(current,"announcement.manage");
    const [before]=await tx.select().from(announcements).where(and(eq(announcements.id,input.announcementId),eq(announcements.authorId,p.id))).for("update");
    if(!before)throw denied();const oldTargets=await targetsFor(tx,before.id);const oldScopes=await targetScopes(tx,current,oldTargets,false);
    if(before.revision!==input.expectedRevision||before.status!==(action==="withdraw"?"published":"draft"))throw conflict();
    const nextTargets="targets" in input?input.targets:oldTargets;
    const scopes=await targetScopes(tx,current,nextTargets,action!=="withdraw");if(action==="publish"&&!nextTargets.length)throw new TRPCError({code:"BAD_REQUEST"});
    const now=new Date();const [saved]=await tx.update(announcements).set({revision:before.revision+1,updatedAt:now,...(action==="update"&&"title" in input?{title:input.title,body:input.body}:action==="publish"?{status:"published",publishedAt:now}:{status:"withdrawn",withdrawnAt:now})}).where(eq(announcements.id,before.id)).returning();
    if(action==="update")await writeTargets(tx,before.id,nextTargets);
    const result=serialize(saved,nextTargets);
    await audit(tx,current,requestId,`announcement.${action}`,"announcement",saved.id,{courseIds:[...new Set([...scopes.courseIds,...oldScopes.courseIds])],groupIds:[...new Set([...scopes.groupIds,...oldScopes.groupIds])]},serialize(before,oldTargets),result);return result;
  });
}
function managedScope(p:Principal):SQL {const ids=scopeIds(p,"announcement.manage");return sql`NOT EXISTS (SELECT 1 FROM announcement_target t LEFT JOIN class c ON c.id=t.class_id WHERE t.announcement_id=${announcements.id} AND NOT (coalesce(t.course_id = ANY(${sql.param(ids.courses)}::uuid[]),false) OR coalesce(c.course_id = ANY(${sql.param(ids.courses)}::uuid[]),false) OR coalesce(t.group_id = ANY(${sql.param(ids.groups)}::uuid[]),false)))`;}
export async function listManaged(db:Database,p:Principal,input:z.infer<typeof managedInput>) {
  requirePermission(p,"announcement.manage");const rows=await db.select().from(announcements).where(and(eq(announcements.authorId,p.id),managedScope(p),input.status?eq(announcements.status,input.status):undefined,input.cursor?gt(announcements.id,input.cursor):undefined)).orderBy(asc(announcements.id)).limit(input.limit+1);
  const result=page(rows,input.limit);return {...result,items:await Promise.all(result.items.map(async r=>serialize(r,await targetsFor(db,r.id))))};
}
export function visibleAnnouncementScope(p:Principal):SQL {return sql`EXISTS (SELECT 1 FROM announcement_target t WHERE t.announcement_id=${announcements.id} AND (EXISTS (SELECT 1 FROM student_class sc JOIN class c ON c.id=sc.class_id WHERE sc.user_id=${p.id} AND sc.status='active' AND c.status='active' AND (t.class_id=c.id OR t.course_id=c.course_id)) OR EXISTS (SELECT 1 FROM group_member gm JOIN user_group g ON g.id=gm.group_id WHERE gm.user_id=${p.id} AND gm.active AND g.active AND gm.group_id=t.group_id)))`;}
export async function visibleAnnouncements(db:Database,p:Principal,input:z.infer<typeof pageInput>,announcementId?:string) {
  requireSelf(p,p.id);const scope=and(eq(announcements.status,"published"),visibleAnnouncementScope(p));let after:SQL|undefined;
  if(input.cursor){const [last]=await db.select().from(announcements).where(and(scope,eq(announcements.id,input.cursor)));if(!last)throw denied();after=or(lt(announcements.publishedAt,last.publishedAt!),and(eq(announcements.publishedAt,last.publishedAt!),gt(announcements.id,last.id)));}
  const rows=await db.select({id:announcements.id,title:announcements.title,body:announcements.body,publishedAt:announcements.publishedAt,authorId:user.id,authorName:user.name}).from(announcements).innerJoin(user,eq(announcements.authorId,user.id)).where(and(scope,after,announcementId?eq(announcements.id,announcementId):undefined)).orderBy(desc(announcements.publishedAt),asc(announcements.id)).limit(input.limit+1);
  if(announcementId&&!rows.length)throw denied();return page(rows.map(r=>({id:r.id,title:r.title,...(announcementId?{body:r.body}:{}),publishedAt:r.publishedAt!.toISOString(),author:{id:r.authorId,displayName:r.authorName}})),input.limit);
}
export async function announcementOptions(db:Database,p:Principal) {
  requirePermission(p,"announcement.manage");const ids=scopeIds(p,"announcement.manage");
  const courseRows=ids.courses.length?await db.select().from(courses).where(inArray(courses.id,ids.courses)):[];
  const classRows=ids.courses.length?await db.select().from(classes).where(and(inArray(classes.courseId,ids.courses),eq(classes.status,"active"))):[];
  const groupRows=ids.groups.length?await db.select().from(userGroups).where(and(inArray(userGroups.id,ids.groups),eq(userGroups.active,true))):[];
  return [...courseRows.map(c=>({label:`COURSE · ${c.code}`,target:{type:"course" as const,courseId:c.id}})),...classRows.map(c=>({label:`CLASS · ${courseRows.find(r=>r.id===c.courseId)?.code} · ${c.classCode}`,target:{type:"class" as const,classId:c.id}})),...groupRows.map(g=>({label:`GROUP · ${g.name}`,target:{type:"group" as const,groupId:g.id}}))];
}
export async function readAudit(db:Database,p:Principal,input:z.infer<typeof auditInput>,auditId?:string) {
  requirePermission(p,"audit.read");const ids=scopeIds(p,"audit.read");
  const scope=sql`${auditEvents.courseIds} <@ ${sql.param(ids.courses)}::uuid[] AND ${auditEvents.groupIds} <@ ${sql.param(ids.groups)}::uuid[] AND (cardinality(${auditEvents.courseIds})+cardinality(${auditEvents.groupIds})>0 OR ${auditEvents.actorId}=${p.id})`;
  const rows=await db.select().from(auditEvents).where(and(scope,auditId?eq(auditEvents.id,auditId):undefined,input.cursor?gt(auditEvents.id,input.cursor):undefined,input.actorId?eq(auditEvents.actorId,input.actorId):undefined,input.action?eq(auditEvents.action,input.action):undefined,input.resource?eq(auditEvents.resource,input.resource):undefined,input.from?sql`${auditEvents.occurredAt} >= ${new Date(input.from)}`:undefined,input.to?lt(auditEvents.occurredAt,new Date(input.to)):undefined)).orderBy(asc(auditEvents.id)).limit(input.limit+1);
  if(auditId&&!rows.length)throw denied();return page(rows.map(r=>({id:r.id,actorId:r.actorId,action:r.action,resource:r.resource,entityId:r.entityId,occurredAt:r.occurredAt.toISOString(),...(auditId?{requestId:r.requestId,before:r.before,after:r.after}: {})})),input.limit);
}
