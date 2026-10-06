import "server-only";
import {createHmac,timingSafeEqual} from "node:crypto";
import {and,asc,eq,gt,isNull,lt,or,sql} from "drizzle-orm";
import {z} from "zod";
import {TRPCError} from "@trpc/server";
import type {Database} from "../db/connection";
import {classes,courses,shareRecipients,shares,timetableEntries,user,userRoles} from "../db/schema";
import {requireSelf,type Principal} from "../auth/authorization";
import {rangeInput} from "./timetable";
import {pageInput} from "./staff";
export const FULL_FIELDS=["course","classType","startAt","endAt","location"] as const;
export const AVAILABILITY_FIELDS=["startAt","endAt"] as const;
const fields=z.union([z.tuple([z.literal("startAt"),z.literal("endAt")]),z.tuple([z.literal("course"),z.literal("classType"),z.literal("startAt"),z.literal("endAt"),z.literal("location")])]);
export const createInput=z.strictObject({recipientId:z.string().min(1).max(200),from:z.iso.datetime({offset:true}),to:z.iso.datetime({offset:true}),allowedFields:fields,expiresAt:z.iso.datetime({offset:true}),consent:z.literal(true)}).refine(i=>Date.parse(i.from)<Date.parse(i.to)&&Date.parse(i.to)-Date.parse(i.from)<=62*86400000);
export const listInput=pageInput.extend({direction:z.enum(["sent","received"])});
export const readInput=rangeInput.safeExtend({shareId:z.uuid()});
type Tx=Parameters<Parameters<Database["transaction"]>[0]>[0];
const unavailable=()=>new TRPCError({code:"NOT_FOUND"});
async function student(tx:Tx,id:string){const rows=await tx.select().from(userRoles).where(and(eq(userRoles.userId,id),eq(userRoles.role,"student"),eq(userRoles.scopeType,"global"),isNull(userRoles.courseId))).for("share");if(!rows.length)throw unavailable();}
async function pair(tx:Tx,ownerId:string,recipientId:string){const [p]=await tx.select().from(shareRecipients).where(and(eq(shareRecipients.ownerId,ownerId),eq(shareRecipients.recipientId,recipientId),eq(shareRecipients.active,true))).for("share");if(!p)throw unavailable();await student(tx,ownerId);await student(tx,recipientId);}
function serialize(s:typeof shares.$inferSelect){return {...s,from:s.from.toISOString(),to:s.to.toISOString(),consentedAt:s.consentedAt.toISOString(),expiresAt:s.expiresAt.toISOString(),revokedAt:s.revokedAt?.toISOString()??null};}
export async function recipients(db:Database,p:Principal){requireSelf(p,p.id);return db.select({id:user.id,displayName:user.name}).from(shareRecipients).innerJoin(user,eq(user.id,shareRecipients.recipientId)).where(and(eq(shareRecipients.ownerId,p.id),eq(shareRecipients.active,true),sql`EXISTS (SELECT 1 FROM user_role r WHERE r.user_id=${user.id} AND r.role='student' AND r.scope_type='global' AND r.course_id IS NULL)`)).orderBy(user.name,user.id);}
export async function createShare(db:Database,p:Principal,input:z.infer<typeof createInput>){requireSelf(p,p.id);return db.transaction(async tx=>{await pair(tx,p.id,input.recipientId);const now=new Date();if(Date.parse(input.expiresAt)<=+now||Date.parse(input.expiresAt)>+now+30*86400000)throw new TRPCError({code:"BAD_REQUEST"});const [s]=await tx.insert(shares).values({ownerId:p.id,recipientId:input.recipientId,from:new Date(input.from),to:new Date(input.to),allowedFields:input.allowedFields,consentedAt:now,expiresAt:new Date(input.expiresAt)}).returning();return serialize(s);});}
export async function listShares(db:Database,p:Principal,input:z.infer<typeof listInput>){requireSelf(p,p.id);const rows=await db.select().from(shares).where(and(eq(input.direction==="sent"?shares.ownerId:shares.recipientId,p.id),input.cursor?gt(shares.id,input.cursor):undefined)).orderBy(asc(shares.id)).limit(input.limit+1);return{items:rows.slice(0,input.limit).map(serialize),nextCursor:rows.length>input.limit?rows[input.limit-1].id:null};}
export async function revokeShare(db:Database,p:Principal,shareId:string){requireSelf(p,p.id);return db.transaction(async tx=>{const [s]=await tx.select().from(shares).where(and(eq(shares.id,shareId),eq(shares.ownerId,p.id))).for("update");if(!s)throw unavailable();if(s.revokedAt)return{id:s.id,revokedAt:s.revokedAt.toISOString()};const [saved]=await tx.update(shares).set({revokedAt:new Date()}).where(eq(shares.id,s.id)).returning();return{id:s.id,revokedAt:saved.revokedAt!.toISOString()};});}
const cursorSchema=z.strictObject({shareId:z.uuid(),viewer:z.string(),from:z.string(),to:z.string(),kind:z.enum(["read","compare"]),startAt:z.string(),side:z.enum(["self","shared"]),id:z.uuid()});
type Cursor=z.infer<typeof cursorSchema>;
function encode(value:Cursor,secret:string){const body=Buffer.from(JSON.stringify(value)).toString("base64url");return `${body}.${createHmac("sha256",secret).update(body).digest("hex")}`;}
function decode(value:string,secret:string){try{const [body,sig,extra]=value.split('.'),expected=createHmac("sha256",secret).update(body).digest("hex");if(extra||!sig||sig.length!==expected.length||!timingSafeEqual(Buffer.from(sig),Buffer.from(expected)))throw Error();return cursorSchema.parse(JSON.parse(Buffer.from(body,"base64url").toString()));}catch{throw new TRPCError({code:"BAD_REQUEST"});}}
type SafeEntry={id:string;startAt:string;endAt:string;course?:{code:string;name:string};classType?:string;location?:string|null};
export async function readShare(db:Database,p:Principal,input:z.infer<typeof readInput>,secret:string,compare=false){
 requireSelf(p,p.id);const from=new Date(input.from).toISOString(),to=new Date(input.to).toISOString(),kind=compare?"compare":"read";
 const cursor=input.cursor?decode(input.cursor,secret):undefined;
 if(cursor&&(cursor.shareId!==input.shareId||cursor.viewer!==p.id||cursor.from!==from||cursor.to!==to||cursor.kind!==kind))throw new TRPCError({code:"BAD_REQUEST"});
 return db.transaction(async tx=>{
  const [s]=await tx.select().from(shares).where(and(eq(shares.id,input.shareId),eq(shares.recipientId,p.id),isNull(shares.revokedAt),gt(shares.expiresAt,new Date()))).for("share");if(!s)throw unavailable();await pair(tx,s.ownerId,p.id);
  if(Date.parse(from)<+s.from||Date.parse(to)>+s.to)throw new TRPCError({code:"FORBIDDEN"});
  async function rowsFor(id:string,side:"self"|"shared"){
   const after=cursor?or(gt(timetableEntries.startAt,new Date(cursor.startAt)),and(eq(timetableEntries.startAt,new Date(cursor.startAt)),side>cursor.side?sql`true`:side===cursor.side?gt(timetableEntries.id,cursor.id):sql`false`)):undefined;
   return (await tx.select({id:timetableEntries.id,startAt:timetableEntries.startAt,endAt:timetableEntries.endAt,code:courses.code,name:courses.name,classType:classes.type,location:timetableEntries.location}).from(timetableEntries).innerJoin(classes,eq(classes.id,timetableEntries.classId)).innerJoin(courses,eq(courses.id,classes.courseId)).where(and(eq(timetableEntries.status,"active"),eq(classes.status,"active"),lt(timetableEntries.startAt,new Date(to)),gt(timetableEntries.endAt,new Date(from)),sql`EXISTS (SELECT 1 FROM student_class sc WHERE sc.class_id=${classes.id} AND sc.user_id=${id} AND sc.status='active')`,after)).orderBy(asc(timetableEntries.startAt),asc(timetableEntries.id)).limit(input.limit+1)).map(r=>({...r,side}));
  }
  const rows=[...await rowsFor(s.ownerId,"shared"),...(compare?await rowsFor(p.id,"self"):[])].sort((a,b)=>+a.startAt-+b.startAt||a.side.localeCompare(b.side)||a.id.localeCompare(b.id));
  const selected=rows.slice(0,input.limit),last=selected.at(-1);
  const items=selected.map(r=>{const full=r.side==="self"||s.allowedFields.includes("course");const entry:SafeEntry={id:r.id,startAt:new Date(Math.max(+r.startAt,Date.parse(from))).toISOString(),endAt:new Date(Math.min(+r.endAt,Date.parse(to))).toISOString(),...(full?{course:{code:r.code,name:r.name},classType:r.classType,location:r.location}:{})};return{side:r.side,entry};});
  if(+s.expiresAt<=Date.now())throw unavailable();
  return{items,nextCursor:rows.length>input.limit&&last?encode({shareId:s.id,viewer:p.id,from,to,kind,startAt:last.startAt.toISOString(),side:last.side,id:last.id},secret):null};
 });
}
