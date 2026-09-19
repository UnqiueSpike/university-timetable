import "server-only";
import { initTRPC, TRPCError } from "@trpc/server";
import type { Database } from "../db/connection";
import type { AppAuth } from "../auth/auth";
import { getPrincipal } from "../auth/authorization";
export type Context = { db: Database; auth: AppAuth; headers: Headers; requestId: string };
const messages: Record<string, string> = { UNAUTHORIZED: "Your session has ended. Please sign in.", FORBIDDEN: "You do not have access to this action.", NOT_FOUND: "This item is unavailable.", BAD_REQUEST: "Check the request details.", CONFLICT: "The data changed. Please refresh.", TOO_MANY_REQUESTS: "Too many requests. Please try again later." };
const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error, ctx }) {
    return { ...shape, message: messages[error.code] ?? "The request could not be completed. Please try again.", data: { code: shape.data.code, httpStatus: shape.data.httpStatus, path: shape.data.path, reason: error.code, requestId: ctx?.requestId } };
  },
});
export const router = t.router;
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const current = await ctx.auth.api.getSession({ headers: ctx.headers, query: { disableCookieCache: true } });
  if (!current) throw new TRPCError({ code: "UNAUTHORIZED" });
  return next({ ctx: { ...ctx, principal: await getPrincipal(ctx.db, current.user) } });
});
