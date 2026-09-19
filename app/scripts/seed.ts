import { connectDatabase } from "../src/server/db/connection";
import { seedFixtures } from "../src/server/db/seed";
import { databaseUrl, requireLocalDatabase } from "./env";
async function main() {
  const url = databaseUrl();
  requireLocalDatabase(url, "dev");
  if (process.env.ALLOW_TEST_SEED !== "true") throw new Error("Set ALLOW_TEST_SEED=true to load synthetic fixtures");
  const { db, pool } = connectDatabase(url);
  try { console.log(await seedFixtures(db)); } finally { await pool.end(); }
}
main().catch(() => { console.error("Fixture import failed. Check local database, seed opt-in, migrations and fixture validity. No credentials are logged."); process.exitCode = 1; });
