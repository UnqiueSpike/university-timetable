import { config } from "dotenv";
config({ path: ".env.local", quiet: true });
config({ path: ".env", quiet: true });
export function databaseUrl(key = "DATABASE_URL") {
  const url = process.env[key];
  if (!url) throw new Error(`${key} is required; copy .env.example to .env.local`);
  return url;
}
export function requireLocalDatabase(url: string, suffix: "dev" | "test") {
  const parsed = new URL(url);
  if (process.env.NODE_ENV === "production" || !["127.0.0.1", "localhost", "[::1]"].includes(parsed.hostname) || parsed.pathname !== `/unischedule_${suffix}`) {
    throw new Error(`This fixture operation requires a local unischedule_${suffix} database`);
  }
  return parsed;
}
