import "server-only";
import { betterAuth } from "better-auth";
import { drizzleAdapter } from "@better-auth/drizzle-adapter";
import { getDatabase, type Database } from "../db/connection";
import { user, session, account, verification } from "../db/schema";

export function createAuth(db: Database, config: { secret: string; baseURL: string }) {
  if (config.secret.length < 32) throw new Error("BETTER_AUTH_SECRET must contain at least 32 characters");
  return betterAuth({
    appName: "UniSchedule", secret: config.secret, baseURL: config.baseURL,
    trustedOrigins: [new URL(config.baseURL).origin],
    database: drizzleAdapter(db, { provider: "pg", schema: { user, session, account, verification }, transaction: true }),
    emailAndPassword: { enabled: true, disableSignUp: true, minPasswordLength: 12, maxPasswordLength: 128, requireEmailVerification: false },
    session: { expiresIn: 60 * 60 * 24 * 7, updateAge: 60 * 60 * 24, cookieCache: { enabled: false } },
    rateLimit: { enabled: true, window: 60, max: 100, customRules: { "/sign-in/email": { window: 60, max: 10 } } },
    advanced: { cookiePrefix: "unischedule", defaultCookieAttributes: { httpOnly: true, sameSite: "lax" } },
    disabledPaths: ["/sign-up/email", "/request-password-reset", "/reset-password", "/update-user", "/change-email", "/delete-user"],
  });
}
export type AppAuth = ReturnType<typeof createAuth>;
let auth: AppAuth | undefined;
export function getAuth() {
  const secret = process.env.BETTER_AUTH_SECRET;
  const baseURL = process.env.BETTER_AUTH_URL;
  if (!secret || !baseURL) throw new Error("Authentication environment is not configured");
  auth ??= createAuth(getDatabase(), { secret, baseURL });
  return auth;
}
export async function authRequest(auth: AppAuth, request: Request) {
  const path = new URL(request.url).pathname.replace(/^\/api\/auth/, "");
  if (!["/sign-in/email", "/sign-out", "/get-session"].includes(path)) return Response.json({ message: "Not available" }, { status: 404 });
  const response = await auth.handler(request);
  response.headers.set("Cache-Control", "no-store");
  return response;
}
