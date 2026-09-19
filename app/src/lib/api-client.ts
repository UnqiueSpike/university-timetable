"use client";
import { createTRPCClient, httpLink } from "@trpc/client";
import type { AppRouter } from "@/server/api/router";
export const api = createTRPCClient<AppRouter>({ links: [httpLink({ url: "/api/trpc" })] });
