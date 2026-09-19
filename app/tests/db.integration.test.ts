import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, before, beforeEach, describe, it } from "node:test";
import { Pool } from "pg";
import { and, eq } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { connectDatabase, type Database } from "../src/server/db/connection";
import { seedFixtures } from "../src/server/db/seed";
import { capacitySnapshots, classes, courses, dataSources, identityLinks, studentClasses, syncScopes, timetableEntries, userRoles } from "../src/server/db/schema";
import { FIXTURE_SOURCE, FIXTURE_TERM, fixtureAdapter } from "../src/server/integrations/fixture-adapter";
import { batchSchema, type ImportBatch, type TimetableAdapter } from "../src/server/integrations/contracts";
import { importTimetable } from "../src/server/integrations/import-timetable";
import { readStudentTimetable } from "../src/server/services/read-timetable";
import { databaseUrl, requireLocalDatabase } from "../scripts/env";

const range = { from: "2026-09-20T00:00:00Z", to: "2026-09-23T00:00:00Z" };
const policy = { sourceId: FIXTURE_SOURCE, asOf: new Date("2026-09-21T00:00:00Z"), maxAgeMs: 7 * 86400000 };
const adapterFor = (payload: unknown, term = FIXTURE_TERM): TimetableAdapter => ({ sourceId: FIXTURE_SOURCE, kind: "test", term, load: async () => payload });
async function fixture(): Promise<ImportBatch> { return batchSchema.parse(await fixtureAdapter().load()); }
function pgCode(code: string) {
  return (error: unknown): boolean => {
    let current = error;
    while (current && typeof current === "object") {
      if ("code" in current && current.code === code) return true;
      current = "cause" in current ? current.cause : undefined;
    }
    return false;
  };
}

describe("PostgreSQL migrations and timetable ingestion", { concurrency: false }, () => {
  let db: Database;
  let pool: Pool;
  let admin: Pool;
  let created = false;
  const database = `unischedule_test_${randomUUID().replaceAll("-", "")}`;
  before(async () => {
    const url = requireLocalDatabase(databaseUrl("TEST_DATABASE_URL"), "test");
    url.pathname = "/postgres";
    admin = new Pool({ connectionString: url.toString(), connectionTimeoutMillis: 5000 });
    await admin.query(`CREATE DATABASE "${database}"`);
    created = true;
    url.pathname = `/${database}`;
    ({ db, pool } = connectDatabase(url.toString()));
    await migrate(db, { migrationsFolder: "./drizzle" });
    await migrate(db, { migrationsFolder: "./drizzle" });
  });
  after(async () => {
    await pool?.end();
    if (created) await admin.query(`DROP DATABASE "${database}"`);
    await admin?.end();
  });
  beforeEach(async () => {
    await pool.query('TRUNCATE "user", data_source, course, class, identity_link, user_role, student_class, timetable_entry, capacity_snapshot, sync_scope CASCADE');
    await seedFixtures(db);
  });
  it("creates a fresh database and can apply migrations twice", async () => {
    const { rows } = await pool.query("SELECT count(*)::int AS n FROM drizzle.__drizzle_migrations");
    assert.ok(rows[0].n >= 2);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM "user"')).rows[0].n, 4);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM account')).rows[0].n, 0);
  });
  it("repeated seeds preserve record IDs and counts, including capacity history", async () => {
    const before = await db.select().from(timetableEntries);
    assert.equal((await seedFixtures(db)).status, "replayed");
    assert.deepEqual(await db.select().from(timetableEntries), before);
    assert.equal((await db.select().from(identityLinks)).length, 4);
    assert.equal((await db.select().from(studentClasses)).length, 5);
    assert.equal((await db.select().from(capacitySnapshots)).length, 3);
    assert.equal((await db.select().from(userRoles)).length, 4);
    const next = await fixture(); next.version = 2;
    await importTimetable(db, adapterFor(next));
    assert.equal((await db.select().from(timetableEntries)).length, 4);
    assert.equal((await db.select().from(capacitySnapshots)).length, 3);
  });
  it("returns separate schedules, excludes inactive/cancelled records, preserves null and zero", async () => {
    const a = await readStudentTimetable(db, "test-student-a", range, policy);
    const b = await readStudentTimetable(db, "test-student-b", range, policy);
    assert.deepEqual(a.map(e => e.course.code), ["COMP101", "COMP101"]);
    assert.deepEqual(b.map(e => e.course.code), ["MATH101"]);
    assert.equal(a[0].capacity?.total, null); assert.equal(a[0].capacity?.available, null);
    assert.equal(a[1].capacity?.total, 0); assert.equal(a[1].capacity?.available, 0);
    assert.equal(b[0].capacity?.total, 30); assert.equal(b[0].capacity?.available, 0);
    assert.equal(a[0].startAt, "2026-09-20T23:00:00.000Z");
    assert.equal(a[0].source.kind, "test"); assert.equal(a[0].verificationStatus, "unverified");
    assert.equal(a[0].capacity?.verificationStatus, "unverified");
    assert.deepEqual(await readStudentTimetable(db, "test-student-empty", range), []);
  });
  it("requires an explicit capacity policy and preserves missing/stale snapshots as null", async () => {
    assert.ok((await readStudentTimetable(db, "test-student-a", range)).every(e => e.capacity === null));
    assert.ok((await readStudentTimetable(db, "test-student-a", range, { ...policy, maxAgeMs: 1 })).every(e => e.capacity === null));
    assert.ok((await readStudentTimetable(db, "test-student-a", range, { ...policy, sourceId: "unknown" })).every(e => e.capacity === null));
    await assert.rejects(readStudentTimetable(db, "test-student-a", { from: range.to, to: range.from }));
  });
  it("grants the teacher only COMP101 and rejects unscoped staff roles", async () => {
    const [grant] = await db.select().from(userRoles).where(eq(userRoles.userId, "test-teacher"));
    const [course] = await db.select().from(courses).where(eq(courses.id, grant.courseId!));
    assert.equal(course.code, "COMP101"); assert.equal(grant.scopeType, "course");
    await assert.rejects(db.insert(userRoles).values({ userId: "test-teacher", role: "staff", scopeType: "global" }), pgCode("23514"));
    await assert.rejects(db.insert(userRoles).values({ userId: "test-teacher", role: "staff", scopeType: "course", courseId: course.id }), pgCode("23505"));
  });
  it("enforces foreign keys, unique identities, memberships and chronological checks in SQL", async () => {
    await assert.rejects(db.insert(identityLinks).values({ userId: "missing", identityProvider: "synthetic", externalSubject: "missing" }), pgCode("23503"));
    await assert.rejects(db.insert(identityLinks).values({ userId: "test-student-b", identityProvider: "synthetic", externalSubject: "student-a" }), pgCode("23505"));
    const [membership] = await db.select().from(studentClasses);
    await assert.rejects(db.insert(studentClasses).values({ ...membership, id: randomUUID(), externalId: "another-id" }), pgCode("23505"));
    const [entry] = await db.select().from(timetableEntries);
    await assert.rejects(db.update(timetableEntries).set({ endAt: entry.startAt }).where(eq(timetableEntries.id, entry.id)), pgCode("23514"));
    await assert.rejects(db.insert(timetableEntries).values({ ...entry, id: randomUUID() }), pgCode("23505"));
    const [capacity] = await db.select().from(capacitySnapshots);
    await assert.rejects(db.update(capacitySnapshots).set({ total: -1 }).where(eq(capacitySnapshots.id, capacity.id)), pgCode("23514"));
  });
  it("cannot mark test data verified or disguise its source kind", async () => {
    await assert.rejects(db.update(timetableEntries).set({ verificationStatus: "verified" }), pgCode("23514"));
    await assert.rejects(db.update(capacitySnapshots).set({ verificationStatus: "verified" }), pgCode("23514"));
    await assert.rejects(db.update(timetableEntries).set({ sourceKind: "official", verificationStatus: "verified" }), pgCode("23503"));
    await assert.rejects(db.update(dataSources).set({ kind: "official" }).where(eq(dataSources.id, FIXTURE_SOURCE)), pgCode("23503"));
    await db.insert(dataSources).values({ id: "official", name: "Not connected", kind: "official" });
    await assert.rejects(importTimetable(db, { ...adapterFor(await fixture()), sourceId: "official" }), /not registered/);
  });
  it("delta omission preserves records; explicit cancellation and invalidation take effect", async () => {
    const b = await fixture(); b.version = 2; b.mode = "delta"; b.complete = false;
    b.courses = []; b.classes = []; b.entries = [ { ...b.entries[0], status: "cancelled" } ];
    b.memberships = [{ ...b.memberships[1], status: "inactive" }]; b.capacities = [];
    await importTimetable(db, adapterFor(b));
    assert.deepEqual(await readStudentTimetable(db, "test-student-a", range), []);
    assert.equal((await readStudentTimetable(db, "test-student-b", range)).length, 1);
    assert.equal((await db.select().from(timetableEntries)).length, 4);
    assert.equal((await db.select().from(capacitySnapshots)).length, 3);
  });
  it("class cancellation hides its entries even when those entries are still active", async () => {
    const b = await fixture(); b.version = 2; b.mode = "delta"; b.complete = false;
    b.classes = [{ ...b.classes[0], status: "cancelled" }]; b.courses = []; b.entries = []; b.memberships = []; b.capacities = [];
    await importTimetable(db, adapterFor(b));
    assert.equal((await readStudentTimetable(db, "test-student-a", range)).length, 1);
  });
  it("full snapshot omission soft-cancels entries and invalidates relations without deleting history", async () => {
    const b = await fixture(); b.version = 2; b.classes = b.classes.filter(c => c.externalId !== "comp-lab");
    b.entries = b.entries.filter(e => e.classExternalId !== "comp-lab");
    b.memberships = b.memberships.filter(m => m.classExternalId !== "comp-lab");
    b.capacities = b.capacities.filter(c => c.classExternalId !== "comp-lab");
    await importTimetable(db, adapterFor(b));
    const [c] = await db.select().from(classes).where(eq(classes.externalId, "comp-lab"));
    assert.equal(c.status, "cancelled");
    const [m] = await db.select().from(studentClasses).where(eq(studentClasses.externalId, "a-lab"));
    assert.equal(m.status, "inactive");
    const [e] = await db.select().from(timetableEntries).where(eq(timetableEntries.externalId, "comp-lab-sep21"));
    assert.equal(e.status, "cancelled");
    assert.equal((await db.select().from(capacitySnapshots)).length, 3);
  });
  it("source failure preserves successful data and time while recording failed status", async () => {
    const before = await db.select().from(timetableEntries);
    const [source] = await db.select().from(dataSources);
    await assert.rejects(importTimetable(db, { ...fixtureAdapter(), load: async () => { throw new Error("simulated network outage"); } }));
    assert.deepEqual(await db.select().from(timetableEntries), before);
    assert.deepEqual((await db.select().from(dataSources))[0].lastSuccessAt, source.lastSuccessAt);
    const [scope] = await db.select().from(syncScopes);
    assert.equal(scope.lastError, "IMPORT_FAILED"); assert.equal(scope.version, 1);
    assert.equal((await importTimetable(db, fixtureAdapter())).status, "replayed");
    assert.equal((await db.select().from(syncScopes))[0].lastError, null);
  });
  it("rejects incomplete, duplicate and invalid payloads before altering records", async () => {
    const before = await db.select().from(timetableEntries);
    const b = await fixture(); b.version = 2;
    await assert.rejects(importTimetable(db, adapterFor({ ...b, complete: false })));
    await assert.rejects(importTimetable(db, adapterFor({ ...b, entries: [b.entries[0], b.entries[0]] })));
    await assert.rejects(importTimetable(db, adapterFor({ ...b, entries: [{ ...b.entries[0], endAt: b.entries[0].startAt }] })));
    await assert.rejects(importTimetable(db, adapterFor({ ...b, entries: [{ ...b.entries[0], verificationStatus: "verified" }] })));
    await assert.rejects(importTimetable(db, adapterFor({ ...b, memberships: undefined })));
    assert.deepEqual(await db.select().from(timetableEntries), before);
  });
  it("unknown identity rolls back earlier course and entry writes in the same batch", async () => {
    const b = await fixture(); b.version = 2; b.courses[0].name = "Must roll back";
    b.entries[0].location = "Must roll back"; b.memberships[0].externalSubject = "unknown";
    await assert.rejects(importTimetable(db, adapterFor(b)), /Unmapped identity/);
    assert.equal((await db.select().from(courses).where(eq(courses.externalId, "comp101")))[0].name, "Introduction to Computing");
    assert.equal((await db.select().from(timetableEntries).where(eq(timetableEntries.externalId, "comp-lecture-sep21")))[0].location, "Demo Hall A");
    assert.equal((await db.select().from(syncScopes))[0].version, 1);
  });
  it("rejects reassignment of external identity and mutation of historical observations", async () => {
    const b = await fixture(); b.version = 2; b.memberships[0].externalSubject = "student-b";
    await assert.rejects(importTimetable(db, adapterFor(b)), /cannot move/);
    const c = await fixture(); c.version = 2; c.capacities[0].total = 10;
    await assert.rejects(importTimetable(db, adapterFor(c)), /immutable/);
    const d = await fixture(); d.version = 2; d.entries[0].classExternalId = "math-lecture";
    await assert.rejects(importTimetable(db, adapterFor(d)), /cannot move/);
  });
  it("serializes concurrent replays and rejects stale or conflicting versions", async () => {
    const b = await fixture(); b.version = 2;
    const results = await Promise.all([importTimetable(db, adapterFor(b)), importTimetable(db, adapterFor(b))]);
    assert.deepEqual(results.map(r => r.status).sort(), ["imported", "replayed"]);
    await assert.rejects(importTimetable(db, fixtureAdapter()), /Stale/);
    b.entries[0].location = "Conflict";
    await assert.rejects(importTimetable(db, adapterFor(b)), /conflicting/);
  });
  it("explicit empty snapshot only invalidates its own source and term", async () => {
    const other = await fixture(); other.term = "2027-S1";
    other.classes = other.classes.map(c => ({ ...c, externalId: `next-${c.externalId}` }));
    other.entries = other.entries.map(e => ({ ...e, externalId: `next-${e.externalId}`, classExternalId: `next-${e.classExternalId}` }));
    other.memberships = other.memberships.map(m => ({ ...m, externalId: `next-${m.externalId}`, classExternalId: `next-${m.classExternalId}` }));
    other.capacities = other.capacities.map(c => ({ ...c, externalId: `next-${c.externalId}`, classExternalId: `next-${c.classExternalId}` }));
    await importTimetable(db, adapterFor(other, other.term));
    await db.insert(dataSources).values({ id: "another-test-source", name: "Other", kind: "test" });
    await importTimetable(db, { ...adapterFor(await fixture()), sourceId: "another-test-source" });
    const empty = { ...(await fixture()), version: 2, courses: [], classes: [], entries: [], memberships: [], capacities: [] };
    await importTimetable(db, adapterFor(empty));
    const remaining = await db.select().from(classes).where(eq(classes.status, "active"));
    assert.equal(remaining.filter(c => c.sourceId === FIXTURE_SOURCE && c.term === FIXTURE_TERM).length, 0);
    assert.equal(remaining.filter(c => c.term === "2027-S1").length, 3);
    assert.equal(remaining.filter(c => c.sourceId === "another-test-source").length, 3);
    const scope = await db.select().from(syncScopes).where(and(eq(syncScopes.sourceId, FIXTURE_SOURCE), eq(syncScopes.term, FIXTURE_TERM)));
    assert.equal(scope[0].version, 2);
  });
});
