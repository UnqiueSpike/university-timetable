import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, writeFileSync, unlinkSync } from "node:fs";
import { resolve } from "node:path";
import { Pool } from "pg";
import { databaseUrl, requireLocalDatabase } from "./env";
async function main() {
  const root = resolve(".local-postgres"), data = resolve(root, "data");
  const action = process.argv[2];
  if (!["up", "down"].includes(action)) throw new Error("Use up or down");
  if (action === "down") {
    if (existsSync(resolve(data, "postmaster.pid"))) execFileSync("pg_ctl", ["-D", data, "-m", "fast", "-w", "stop"], { stdio: "inherit" });
    return;
  }
  const url = requireLocalDatabase(databaseUrl(), "dev");
  if (url.hostname !== "127.0.0.1" || url.port !== "55432" || url.username !== "unischedule" || !url.password) throw new Error("Native local setup requires the host, port, user and password in .env.example");
  const version = execFileSync("initdb", ["--version"], { encoding: "utf8" });
  if (!version.includes("18.")) throw new Error("Install PostgreSQL 18 and add its bin directory to PATH");
  mkdirSync(root, { recursive: true, mode: 0o700 });
  if (!existsSync(resolve(data, "PG_VERSION"))) {
    const pw = resolve(root, "init-password");
    writeFileSync(pw, decodeURIComponent(url.password), { mode: 0o600 });
    try { execFileSync("initdb", ["-D", data, "-U", "unischedule", "--auth=scram-sha-256", `--pwfile=${pw}`, "--encoding=UTF8", "--locale=C"], { stdio: "inherit" }); }
    finally { unlinkSync(pw); }
  }
  if (!existsSync(resolve(data, "postmaster.pid"))) execFileSync("pg_ctl", ["-D", data, "-l", resolve(root, "postgres.log"), "-o", "-h 127.0.0.1 -p 55432 -k '' -c wal_level=logical", "-w", "start"], { stdio: "inherit" });
  url.pathname = "/postgres";
  const pool = new Pool({ connectionString: url.toString() });
  try {
    const result = await pool.query("SELECT 1 FROM pg_database WHERE datname = $1", ["unischedule_dev"]);
    if (!result.rowCount) await pool.query('CREATE DATABASE "unischedule_dev"');
    console.log("Local PostgreSQL ready on 127.0.0.1:55432; database unischedule_dev");
  } finally { await pool.end(); }
}
main().catch(() => { console.error("Local PostgreSQL setup failed. Check PostgreSQL 18 binaries, .env.local, port 55432 and .local-postgres/postgres.log. Existing data is retained."); process.exitCode = 1; });
