"use client";
import Link from "next/link";
import { Button } from "@/components/ui/button";
export default function ErrorPage({ reset }: { reset: () => void }) {
  return <main className="mx-auto max-w-lg p-8"><h1 className="text-2xl font-bold">Unable to load this page</h1><p className="my-4 text-muted-foreground">The service could not complete your request. Please try again.</p><Button onClick={reset}>Try again</Button><Link href="/" className="ml-4 text-sm underline">Return to sign in</Link></main>;
}
