import { pagePrincipal } from "@/server/auth/page-session";
import { SessionFrame } from "@/components/auth/session-frame";
export default async function StudentPage() {
  const principal = await pagePrincipal("timetable.read.own");
  return <SessionFrame principal={principal}><main className="p-8"><h1 className="text-2xl font-bold">My timetable</h1><p className="mt-3">Welcome, {principal.displayName}. Your student workspace is ready.</p></main></SessionFrame>;
}
