import { pagePrincipal } from "@/server/auth/page-session";
import { SessionFrame } from "@/components/auth/session-frame";
import { Timetable } from "@/components/timetable/timetable";
export const metadata = { title: "My timetable · UniSchedule" };
export default async function StudentPage() {
  const principal = await pagePrincipal("timetable.read.own");
  return <SessionFrame principal={principal}><Timetable /></SessionFrame>;
}
