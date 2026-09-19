import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../src/server/db/connection";
import { databaseUrl } from "./env";
async function main() {
  const { db, pool } = connectDatabase(databaseUrl());
  try { await migrate(db, { migrationsFolder: "./drizzle" }); console.log("Migrations applied"); }
  finally { await pool.end(); }
}
main().catch(() => { console.error("Migration failed; verify connection and migration files (credentials omitted)."); process.exitCode = 1; });
