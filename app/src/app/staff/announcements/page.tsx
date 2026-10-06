import {pagePrincipal} from "@/server/auth/page-session";
import {SessionFrame} from "@/components/auth/session-frame";
import {AnnouncementManager} from "@/components/workspace/announcements";
export const metadata={title:"AnnouncementManager · UniSchedule"};
export default async function Page(){const principal=await pagePrincipal("announcement.manage");return <SessionFrame principal={principal}><AnnouncementManager/></SessionFrame>;}
