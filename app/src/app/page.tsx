import Image from "next/image";
import { LoginForm } from "@/components/login-form";

export default function Home() {
  return (
    <main className="relative isolate min-h-svh bg-[#f34a1d] lg:flex lg:justify-end">
      <Image src="/images/campus.png" alt="" fill priority sizes="100vw" className="-z-10 hidden object-cover object-left lg:block" />
      <div className="relative h-40 sm:h-56 lg:hidden" aria-hidden="true"><Image src="/images/campus.png" alt="" fill priority sizes="100vw" className="object-cover object-center" /></div>
      <section aria-label="Sign in" className="flex min-h-[calc(100svh-10rem)] w-full flex-col justify-between gap-12 rounded-t-lg border border-black bg-white/85 px-6 py-8 backdrop-blur-[30px] sm:min-h-[calc(100svh-14rem)] sm:px-12 lg:min-h-svh lg:w-[560px] lg:shrink-0 lg:rounded-lg lg:px-[60px] lg:py-[72px] xl:pl-20 xl:pr-[60px]">
        <div className="flex items-center gap-2"><Image src="/images/logo.png" alt="" width={32} height={32} className="size-8" /><span className="text-base font-bold">UniSchedule</span></div>
        <div className="mx-auto w-full max-w-[420px]"><LoginForm /></div>
        <footer className="text-xs text-muted-foreground">© 2026 UniSchedule. All rights reserved.</footer>
      </section>
    </main>
  );
}
