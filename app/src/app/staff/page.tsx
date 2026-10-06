import {pagePrincipal} from "@/server/auth/page-session";
import {SessionFrame} from "@/components/auth/session-frame";
import {StaffWorkspace} from "@/components/workspace/staff-workspace";
export const metadata={title:"StaffWorkspace · UniSchedule"};
export default async function Page(){const principal=await pagePrincipal("staff.access");return <SessionFrame principal={principal}><StaffWorkspace principal={principal}/></SessionFrame>;}
