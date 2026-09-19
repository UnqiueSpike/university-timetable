"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { authClient } from "@/lib/auth-client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";

function FieldIcon({ name }: { name: "mail" | "lock" }) {
  return <Image src={`/images/${name}.svg`} alt="" width={16} height={16} className="pointer-events-none absolute left-3.5 top-[18px] size-4" />;
}

export function LoginForm() {
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState("");
  const [pending, setPending] = useState(false);
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const values = new FormData(event.currentTarget);
    setPending(true); setNotice("");
    try {
      const result = await authClient.signIn.email({ email: String(values.get("email")).trim(), password: String(values.get("password")), rememberMe: values.get("remember") === "on" });
      if (result.error) { setNotice(result.error.status === 429 ? "Too many attempts. Please try again later." : result.error.status >= 500 ? "Sign-in is temporarily unavailable. Please try again." : "Unable to sign in. Check your email and password."); return; }
      router.replace("/workspace"); router.refresh();
    } catch { setNotice("Unable to connect. Please try again."); }
    finally { setPending(false); }
  }
  return (
    <form className="grid w-full gap-8" onSubmit={submit} aria-busy={pending} aria-describedby="preview-notice">
      <header className="grid gap-1.5">
        <h1 className="text-[28px] leading-tight font-bold tracking-tight sm:text-[32px]">Sign in to your account</h1>
        <p className="text-[13px] text-muted-foreground">Welcome back! Please enter your university credentials.</p>
      </header>
      <div className="grid gap-5">
        <FormField id="email" label="University Email">
          <div className="relative"><FieldIcon name="mail" /><Input id="email" name="email" type="email" autoComplete="username" placeholder="arivera@uni.edu" required className="pl-10" /></div>
        </FormField>
        <FormField id="password" label="Password">
          <div className="relative">
            <FieldIcon name="lock" /><Input id="password" name="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="••••••••••••" required className="pr-12 pl-10" />
            <Button variant="ghost" size="icon" className="absolute top-1.5 right-1" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}><Image src="/images/eye.svg" alt="" width={16} height={16} className="size-4" /></Button>
          </div>
        </FormField>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <label className="flex min-h-8 cursor-pointer items-center gap-2 text-[13px] text-muted-foreground"><input name="remember" type="checkbox" className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />Remember this device</label>
          <Button variant="link" size="sm" onClick={() => setNotice("Password recovery is managed by university support. Self-service recovery is not enabled.")}>Forgot password?</Button>
        </div>
      </div>
      <div className="grid gap-4">
        <Button type="submit" disabled={pending} className="w-full">{pending ? "Signing in…" : "Sign In"}</Button>
        <p className="text-sm text-muted-foreground">Don&apos;t have an account? <Button variant="link" size="sm" className="h-auto text-sm" onClick={() => setNotice("Accounts are provisioned by the university. Public registration is not enabled.")}>Sign up</Button></p>
        <p id="preview-notice" className="text-xs leading-5 text-muted-foreground" role="status">{notice || "Use your provisioned account. An email address alone does not verify university affiliation."}</p>
      </div>
    </form>
  );
}
