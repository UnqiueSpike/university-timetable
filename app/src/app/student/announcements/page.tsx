import {pagePrincipal} from "@/server/auth/page-session";
import {SessionFrame} from "@/components/auth/session-frame";
import {StudentAnnouncements} from "@/components/workspace/announcements";
export const metadata={title:"StudentAnnouncements · UniSchedule"};
export default async function Page(){const principal=await pagePrincipal("timetable.read.own");return <SessionFrame principal={principal}><StudentAnnouncements/></SessionFrame>;}
