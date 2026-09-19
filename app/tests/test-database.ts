import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase } from "../src/server/db/connection";
import { databaseUrl, requireLocalDatabase } from "../scripts/env";
export async function testDatabase() {
  const url = requireLocalDatabase(databaseUrl("TEST_DATABASE_URL"), "test");
  const name = `unischedule_test_${randomUUID().replaceAll("-", "")}`;
  url.pathname = "/postgres";
  const admin = new Pool({ connectionString: url.toString() });
  await admin.query(`CREATE DATABASE "${name}"`);
  url.pathname = `/${name}`;
  const connection = connectDatabase(url.toString());
  async function close() { await connection.pool.end(); await admin.query(`DROP DATABASE "${name}"`); await admin.end(); }
  try { await migrate(connection.db, { migrationsFolder: "./drizzle" }); }
  catch (error) { await close(); throw error; }
  return { ...connection, close };
}
