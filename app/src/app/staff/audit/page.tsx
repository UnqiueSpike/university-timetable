import {pagePrincipal} from "@/server/auth/page-session";
import {SessionFrame} from "@/components/auth/session-frame";
import {AuditLog} from "@/components/workspace/audit";
export const metadata={title:"AuditLog · UniSchedule"};
export default async function Page(){const principal=await pagePrincipal("audit.read");return <SessionFrame principal={principal}><AuditLog/></SessionFrame>;}
