import { redirect } from "next/navigation";
import { pagePrincipal } from "@/server/auth/page-session";
import { SessionFrame } from "@/components/auth/session-frame";
export default async function Workspace() {
  const principal = await pagePrincipal();
  if (principal.grants.some(g => g.permission === "timetable.read.own")) redirect("/student");
  if (principal.grants.some(g => g.permission === "staff.access")) redirect("/staff");
  return <SessionFrame principal={principal}><main className="p-8"><h1 className="text-2xl font-bold">No workspace access</h1><p className="mt-3 text-muted-foreground">Your account has no assigned course or student permissions. Contact the university support team.</p></main></SessionFrame>;
}
