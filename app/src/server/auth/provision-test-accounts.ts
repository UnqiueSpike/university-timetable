import "server-only";
import { eq } from "drizzle-orm";
import type { AppAuth } from "./auth";
import type { Database } from "../db/connection";
import { fixtureUsers } from "../db/seed";
import { user } from "../db/schema";

// CLI/test-only provisioning using Better Auth's own hashing and account adapter.
// No HTTP route imports this module. Existing passwords are never silently reset.
export async function provisionTestAccounts(db: Database, auth: AppAuth, passwords: Record<string, string>) {
  const ctx = await auth.$context;
  for (const person of fixtureUsers) {
    const password = passwords[person.id];
    if (!password || password.length < 12 || password.length > 128) throw new Error("A 12–128 character test password is required");
    const [profile] = await db.select().from(user).where(eq(user.id, person.id));
    if (!profile || profile.email !== person.email || !profile.email.endsWith("@example.invalid")) throw new Error("Only the known synthetic profiles may be provisioned");
    const existing = await ctx.internalAdapter.findCredentialAccount(person.id);
    if (existing) {
      if (!existing.password || !await ctx.password.verify({ hash: existing.password, password })) throw new Error("Existing test account password differs; no automatic reset performed");
      continue;
    }
    await ctx.internalAdapter.createAccount({ userId: person.id, accountId: person.id, providerId: "credential", password: await ctx.password.hash(password) });
  }
}
