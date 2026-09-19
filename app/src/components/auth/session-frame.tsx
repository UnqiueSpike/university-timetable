"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { TRPCClientError } from "@trpc/client";
import { authClient } from "@/lib/auth-client";
import { api } from "@/lib/api-client";
import { Button } from "@/components/ui/button";
import type { Principal } from "@/server/auth/authorization";

export function SessionFrame({ principal, children }: { principal: Principal; children: React.ReactNode }) {
  const router = useRouter();
  const [notice, setNotice] = useState("");
  const [hidden, setHidden] = useState(false);
  useEffect(() => {
    let active = true;
    const check = async () => {
      try {
        const current = await api.account.me.query();
        if (active && (current.id !== principal.id || JSON.stringify(current.grants) !== JSON.stringify(principal.grants))) { setHidden(true); window.location.replace("/workspace"); }
        else if (active) { setHidden(false); setNotice(""); }
      } catch (error) {
        if (!active) return;
        setHidden(true);
        if (error instanceof TRPCClientError && error.data?.code === "UNAUTHORIZED") window.location.replace("/?session=expired");
        else setNotice("Unable to verify your session. Please retry.");
      }
    };
    const timer = window.setInterval(check, 15000);
    window.addEventListener("focus", check);
    window.addEventListener("online", check);
    return () => { active = false; clearInterval(timer); window.removeEventListener("focus", check); window.removeEventListener("online", check); };
  }, [principal]);
  async function signOut() {
    setHidden(true);
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error();
      window.location.replace("/");
    } catch { setNotice("Sign out failed. Please retry to end your session."); }
  }
  return <div className="min-h-svh bg-white">
    <header className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-6 py-4">
      <Link href="/workspace" className="font-bold">UniSchedule</Link>
      <nav aria-label="Your workspaces" className="flex flex-wrap items-center gap-4 text-sm">
        {principal.grants.some(g => g.permission === "timetable.read.own") && <Link href="/student">My timetable</Link>}
        {principal.grants.some(g => g.permission === "staff.access") && <Link href="/staff">Staff workspace</Link>}
        <span>{principal.displayName}</span><Button size="sm" variant="link" onClick={signOut}>Sign out</Button>
      </nav>
    </header>
    {notice && <div role="alert" className="p-6 text-sm">{notice} <Button variant="link" size="sm" onClick={() => router.refresh()}>Retry</Button></div>}
    {!hidden && children}
  </div>;
}
