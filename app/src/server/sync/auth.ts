import "server-only";
import {createHmac,timingSafeEqual} from "node:crypto";
import {and,eq,gt} from "drizzle-orm";
import {z} from "zod";
import type {Database} from "../db/connection";
import {session} from "../db/schema";
const payload=z.strictObject({purpose:z.literal("zero-signal"),id:z.string(),sessionId:z.string(),expires:z.number()});
export function syncToken(id:string,sessionId:string,secret:string){const body=Buffer.from(JSON.stringify({purpose:"zero-signal",id,sessionId,expires:Date.now()+120000})).toString("base64url");return `${body}.${createHmac("sha256",secret).update(body).digest("hex")}`;}
export async function syncIdentity(db:Database,token:string,secret:string){try{const [body,signature,extra]=token.split('.'),expected=createHmac("sha256",secret).update(body).digest("hex");if(extra||!signature||signature.length!==expected.length||!timingSafeEqual(Buffer.from(signature),Buffer.from(expected)))return null;const p=payload.parse(JSON.parse(Buffer.from(body,"base64url").toString()));if(p.expires<=Date.now())return null;const [s]=await db.select({id:session.userId}).from(session).where(and(eq(session.id,p.sessionId),eq(session.userId,p.id),gt(session.expiresAt,new Date())));return s??null;}catch{return null;}}
