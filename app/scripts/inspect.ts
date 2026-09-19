import { connectDatabase } from "../src/server/db/connection";
import { readStudentTimetable } from "../src/server/services/read-timetable";
import { FIXTURE_SOURCE } from "../src/server/integrations/fixture-adapter";
import { databaseUrl, requireLocalDatabase } from "./env";
async function main() {
  const url = databaseUrl(); requireLocalDatabase(url, "dev");
  const { db, pool } = connectDatabase(url);
  try {
    for (const id of ["test-student-a", "test-student-b", "test-student-empty"]) {
      const items = await readStudentTimetable(db, id, { from: "2026-09-20T00:00:00Z", to: "2026-09-23T00:00:00Z" }, { sourceId: FIXTURE_SOURCE, asOf: new Date("2026-09-21T00:00:00Z"), maxAgeMs: 7 * 86400000 });
      console.log(JSON.stringify({ userId: id, items }, null, 2));
    }
  } finally { await pool.end(); }
}
main().catch(() => { console.error("Fixture query failed; check local configuration and migrations."); process.exitCode = 1; });
