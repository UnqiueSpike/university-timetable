"use client";

import Image from "next/image";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { FormField } from "@/components/ui/form-field";

function FieldIcon({ name }: { name: "mail" | "lock" }) {
  return <Image src={`/images/${name}.svg`} alt="" width={16} height={16} className="pointer-events-none absolute left-3.5 top-[18px] size-4" />;
}

export function LoginForm() {
  const [showPassword, setShowPassword] = useState(false);
  const [notice, setNotice] = useState("");
  return (
    <form className="grid w-full gap-8" onSubmit={(event) => { event.preventDefault(); setNotice("Sign-in is not available in this interface preview. No credentials have been sent or saved."); }} aria-describedby="preview-notice">
      <header className="grid gap-1.5">
        <h1 className="text-[28px] leading-tight font-bold tracking-tight sm:text-[32px]">Sign in to your account</h1>
        <p className="text-[13px] text-muted-foreground">Welcome back! Please enter your university credentials.</p>
      </header>
      <div className="grid gap-5">
        <FormField id="email" label="University Email">
          <div className="relative"><FieldIcon name="mail" /><Input id="email" type="email" autoComplete="username" placeholder="arivera@uni.edu" required className="pl-10" /></div>
        </FormField>
        <FormField id="password" label="Password">
          <div className="relative">
            <FieldIcon name="lock" /><Input id="password" type={showPassword ? "text" : "password"} autoComplete="current-password" placeholder="••••••••••••" required className="pr-12 pl-10" />
            <Button variant="ghost" size="icon" className="absolute top-1.5 right-1" aria-label={showPassword ? "Hide password" : "Show password"} aria-pressed={showPassword} onClick={() => setShowPassword(!showPassword)}><Image src="/images/eye.svg" alt="" width={16} height={16} className="size-4" /></Button>
          </div>
        </FormField>
        <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
          <label className="flex min-h-8 cursor-pointer items-center gap-2 text-[13px] text-muted-foreground"><input type="checkbox" className="size-4 accent-primary focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring" />Remember this device</label>
          <Button variant="link" size="sm" onClick={() => setNotice("Password reset is not available yet. This is an interface preview.")}>Forgot password?</Button>
        </div>
      </div>
      <div className="grid gap-4">
        <Button type="submit" className="w-full">Sign In</Button>
        <p className="text-sm text-muted-foreground">Don&apos;t have an account? <Button variant="link" size="sm" className="h-auto text-sm" onClick={() => setNotice("Registration is not available yet. This is an interface preview.")}>Sign up</Button></p>
        <p id="preview-notice" className="text-xs leading-5 text-muted-foreground" role="status">{notice || "Interface preview only. Sign-in is not connected yet."}</p>
      </div>
    </form>
  );
}
