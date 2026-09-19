import { randomBytes } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { z } from "zod";
import { createAuth } from "../src/server/auth/auth";
import { provisionTestAccounts } from "../src/server/auth/provision-test-accounts";
import { fixtureUsers, seedFixtures } from "../src/server/db/seed";
import { connectDatabase } from "../src/server/db/connection";
import { databaseUrl, requireLocalDatabase } from "./env";
async function main() {
  const url = databaseUrl(); requireLocalDatabase(url, "dev");
  if (process.env.ALLOW_TEST_SEED !== "true") throw new Error("Test provisioning is not enabled");
  const { db, pool } = connectDatabase(url);
  try {
    await seedFixtures(db);
    const path = ".local-accounts.json";
    let credentials: { userId: string; email: string; password: string }[];
    try { credentials = z.array(z.strictObject({ userId: z.string(), email: z.email(), password: z.string().min(12).max(128) })).parse(JSON.parse(await readFile(path, "utf8"))); }
    catch (error) {
      if (!(error instanceof Error) || !("code" in error) || error.code !== "ENOENT") throw error;
      credentials = fixtureUsers.map(u => ({ userId: u.id, email: u.email, password: randomBytes(18).toString("base64url") }));
      await writeFile(path, JSON.stringify(credentials, null, 2) + "\n", { mode: 0o600, flag: "wx" });
    }
    const auth = createAuth(db, { secret: process.env.BETTER_AUTH_SECRET ?? "", baseURL: process.env.BETTER_AUTH_URL ?? "" });
    await provisionTestAccounts(db, auth, Object.fromEntries(credentials.map(c => [c.userId, c.password])));
    console.log("Four local test accounts are ready. Credentials: app/.local-accounts.json (ignored by Git). Existing credentials are unchanged.");
  } finally { await pool.end(); }
}
main().catch(() => { console.error("Test-account setup failed. Check auth environment, test seed opt-in and local credential file; no passwords were reset."); process.exitCode = 1; });
