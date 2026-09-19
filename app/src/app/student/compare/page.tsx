import {and,eq} from "drizzle-orm";
import {z} from "zod";
import {pagePrincipal} from "@/server/auth/page-session";
import {getDatabase} from "@/server/db/connection";
import {shares} from "@/server/db/schema";
import {SessionFrame} from "@/components/auth/session-frame";
import {Compare} from "@/components/workspace/shares";
import {campusDate} from "@/lib/timetable/dates";
export const metadata={title:"Compare Timetables"};
export default async function Page({searchParams}:{searchParams:Promise<{share?:string}>}){const principal=await pagePrincipal("timetable.read.own");const params=await searchParams;const id=z.uuid().safeParse(params.share);const [record]=id.success?await getDatabase().select({from:shares.from}).from(shares).where(and(eq(shares.id,id.data),eq(shares.recipientId,principal.id))):[];return <SessionFrame principal={principal}><Compare initialShare={params.share} initialDate={record?campusDate(record.from.toISOString()):undefined}/></SessionFrame>;}
