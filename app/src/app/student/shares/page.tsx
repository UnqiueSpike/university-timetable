import {pagePrincipal} from "@/server/auth/page-session";
import {SessionFrame} from "@/components/auth/session-frame";
import {Shares} from "@/components/workspace/shares";
export const metadata={title:"Shared Timetables"};
export default async function Page(){const principal=await pagePrincipal("timetable.read.own");return <SessionFrame principal={principal}><Shares/></SessionFrame>;}
