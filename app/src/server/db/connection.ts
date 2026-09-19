import "server-only";
import { drizzle } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import * as schema from "./schema";

export function connectDatabase(connectionString: string) {
  const pool = new Pool({ connectionString, max: 5, connectionTimeoutMillis: 5000, query_timeout: 10000, idleTimeoutMillis: 30000 });
  pool.on("error",()=>console.error(JSON.stringify({event:"database_pool_error"})));
  return { db: drizzle(pool, { schema }), pool };
}
export type Database = ReturnType<typeof connectDatabase>["db"];
let connection: ReturnType<typeof connectDatabase> | undefined;
// Lazy: static pages/builds require neither credentials nor a running database.
export function getDatabase() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is required for database operations");
  connection ??= connectDatabase(url);
  return connection.db;
}
