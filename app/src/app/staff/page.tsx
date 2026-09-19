import { headers } from "next/headers";
import { pagePrincipal } from "@/server/auth/page-session";
import { SessionFrame } from "@/components/auth/session-frame";
import { appRouter } from "@/server/api/router";
import { getAuth } from "@/server/auth/auth";
import { getDatabase } from "@/server/db/connection";
export default async function StaffPage() {
  const principal = await pagePrincipal("staff.access");
  const caller = appRouter.createCaller({ db: getDatabase(), auth: getAuth(), headers: await headers(), requestId: crypto.randomUUID() });
  const courses = await caller.staff.courses();
  return <SessionFrame principal={principal}><main className="mx-auto max-w-5xl p-6 sm:p-10"><p className="text-sm text-muted-foreground">Teaching & coordination</p><h1 className="mt-2 text-3xl font-bold">Staff workspace</h1><p className="mt-3 text-muted-foreground">Your assigned courses</p><div className="mt-8 grid gap-4 sm:grid-cols-2">{courses.map(c => <article key={c.id} className="rounded-lg border border-border p-6"><p className="text-sm font-semibold text-primary">{c.code}</p><h2 className="mt-2 text-xl font-semibold">{c.name}</h2><p className="mt-4 text-sm text-muted-foreground">Course-scoped access</p></article>)}</div></main></SessionFrame>;
}
