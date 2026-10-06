import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import { randomBytes } from "node:crypto";
import { eq, and } from "drizzle-orm";
import { testDatabase } from "./test-database";
import { seedFixtures, fixtureUsers } from "../src/server/db/seed";
import { getPrincipal, type Principal } from "../src/server/auth/authorization";
import { studentTimetable, getTimetableEntry, type CapacityPolicy } from "../src/server/services/timetable";
import { user, studentClasses, timetableEntries, classes, syncScopes } from "../src/server/db/schema";
import { weekRange } from "../src/lib/timetable/dates";
import { loadAllPages } from "../src/lib/timetable/load-pages";
import { createAuth, authRequest, type AppAuth } from "../src/server/auth/auth";
import { provisionTestAccounts } from "../src/server/auth/provision-test-accounts";
import { trpcRequest } from "../src/server/api/handler";
const range = weekRange("2026-09-21");
const secret = randomBytes(32).toString("hex");
const policy: CapacityPolicy = { sourceId: "synthetic-timetable-v1", asOf: new Date("2026-09-21T00:00:00Z"), maxAgeMs: 7 * 86400000 };
describe("Personal timetable boundaries", { concurrency: false }, () => {
  let database: Awaited<ReturnType<typeof testDatabase>>;
  const principals: Record<string, Principal> = {};
  let auth: AppAuth, cookie: string;
  const origin = "http://127.0.0.1:3000";
  async function rpc(path: string, input: unknown, withCookie = true) {
    const response = await trpcRequest(new Request(`${origin}/api/trpc/${path}?input=${encodeURIComponent(JSON.stringify(input))}`, { headers: { cookie: withCookie ? cookie : "" } }), { db: database.db, auth });
    return { status: response.status, body: await response.json() };
  }
  before(async () => {
    database = await testDatabase(); await seedFixtures(database.db);
    for (const profile of await database.db.select().from(user)) principals[profile.id] = await getPrincipal(database.db, profile);
    auth = createAuth(database.db, { secret, baseURL: origin });
    const password = randomBytes(24).toString("hex");
    await provisionTestAccounts(database.db, auth, Object.fromEntries(fixtureUsers.map(p => [p.id, password])));
    const response = await authRequest(auth, new Request(`${origin}/api/auth/sign-in/email`, { method: "POST", headers: { Origin: origin, "Content-Type": "application/json" }, body: JSON.stringify({ email: "student-a@example.invalid", password }) }));
    cookie = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
  });
  after(async () => { await database?.close(); });
  const mine = (id: string, input = range) => studentTimetable(database.db, principals[id], input, secret, policy);
  it("isolates A/B, excludes inactive relationships and cancelled classes, and preserves an empty student", async () => {
    assert.deepEqual((await mine("test-student-a")).items.map(i => i.course.code), ["COMP101", "COMP101"]);
    assert.deepEqual((await mine("test-student-b")).items.map(i => i.course.code), ["MATH101"]);
    assert.equal((await mine("test-student-empty")).items.length, 0);
    await assert.rejects(mine("test-teacher"), { code: "FORBIDDEN" });
  });
  it("checks real HTTP authentication and rejects forged identity/range parameters", async () => {
    assert.equal((await rpc("timetable.mine", range, false)).status, 401);
    assert.equal((await rpc("timetable.mine", { ...range, userId: "test-student-b" })).status, 400);
    assert.equal((await rpc("timetable.mine", { from: range.to, to: range.from })).status, 400);
    assert.equal((await rpc("timetable.mine", { from: "2026-01-01T00:00:00Z", to: "2026-12-01T00:00:00Z" })).status, 400);
    assert.equal((await rpc("timetable.getEntry", { entryId: "invalid" })).status, 400);
    assert.equal((await rpc("timetable.mine", range)).body.result.data.items.length, 2);
  });
  it("protects entry IDs, including a teacher's course scope", async () => {
    const [math] = (await mine("test-student-b")).items;
    const [comp] = (await mine("test-student-a")).items;
    assert.equal((await rpc("timetable.getEntry", { entryId: math.id })).status, 404);
    assert.equal((await getTimetableEntry(database.db, principals["test-teacher"], comp.id)).id, comp.id);
    await assert.rejects(getTimetableEntry(database.db, principals["test-teacher"], math.id), { code: "NOT_FOUND" });
  });
  it("keeps null different from zero and never verifies synthetic source data", async () => {
    const items = (await mine("test-student-a")).items;
    assert.equal(items[0].capacity?.available, null); assert.equal(items[0].capacity?.total, null);
    assert.equal(items[1].capacity?.available, 0); assert.equal(items[1].capacity?.total, 0);
    assert.ok(items.every(i => i.source.kind === "test" && i.verificationStatus === "unverified"));
    assert.equal((await studentTimetable(database.db, principals["test-student-a"], range, secret)).items[0].capacity, null);
    const stale = await studentTimetable(database.db, principals["test-student-a"], range, secret, { ...policy, maxAgeMs: 1 });
    assert.equal(stale.items[1].capacity, null);
  });
  it("uses half-open interval overlap, including classes that start before the requested window", async () => {
    const a = "test-student-a";
    assert.equal((await mine(a, { from: "2026-09-20T23:30:00Z", to: "2026-09-21T00:00:00Z" })).items.length, 1);
    assert.equal((await mine(a, { from: "2026-09-21T00:00:00Z", to: "2026-09-21T01:00:00Z" })).items.length, 0);
    assert.equal((await mine(a, { from: "2026-09-20T22:00:00Z", to: "2026-09-20T23:00:00Z" })).items.length, 0);
  });
  it("paginates equal start times without duplicates and binds signed cursors to user and range", async () => {
    const [existing] = await database.db.select().from(timetableEntries).where(eq(timetableEntries.externalId, "comp-lecture-sep21"));
    const { id: _id, ...copy } = existing; void _id;
    const [extra] = await database.db.insert(timetableEntries).values({ ...copy, externalId: "pagination-tie" }).returning();
    const first = await studentTimetable(database.db, principals["test-student-a"], { ...range, limit: 1 }, secret, policy);
    assert.ok(first.nextCursor);
    for (const [principal, input] of [[principals["test-student-b"], { ...range, cursor: first.nextCursor }], [principals["test-student-a"], { ...weekRange("2026-09-28"), cursor: first.nextCursor }], [principals["test-student-a"], { ...range, cursor: first.nextCursor + "x" }]] as const) await assert.rejects(studentTimetable(database.db, principal, input, secret), { code: "BAD_REQUEST" });
    const all = await loadAllPages(cursor => studentTimetable(database.db, principals["test-student-a"], { ...range, limit: 1, cursor }, secret, policy));
    assert.equal(all.length, 3); assert.equal(new Set(all.map(i => i.id)).size, 3);
    await database.db.delete(timetableEntries).where(eq(timetableEntries.id, extra.id));
  });
  it("does not turn a failed later page into a partial or empty timetable", async () => {
    const page = await studentTimetable(database.db, principals["test-student-a"], { ...range, limit: 1 }, secret);
    await assert.rejects(loadAllPages(async cursor => { if (cursor) throw new Error("network"); return page; }), /network/);
    await assert.rejects(loadAllPages(async () => page), /Pagination did not advance/);
  });
  it("reflects database edits and revocations on the very next authorized query", async () => {
    const [entry] = (await mine("test-student-a")).items;
    await database.db.update(timetableEntries).set({ location: "Updated room" }).where(eq(timetableEntries.id, entry.id));
    assert.equal((await rpc("timetable.getEntry", { entryId: entry.id })).body.result.data.location, "Updated room");
    await database.db.update(studentClasses).set({ status: "inactive" }).where(and(eq(studentClasses.userId, "test-student-a"), eq(studentClasses.classId, entry.classId)));
    assert.equal((await rpc("timetable.mine", range)).body.result.data.items.length, 1);
    assert.equal((await rpc("timetable.getEntry", { entryId: entry.id })).status, 404);
    await database.db.update(studentClasses).set({ status: "active" }).where(and(eq(studentClasses.userId, "test-student-a"), eq(studentClasses.classId, entry.classId)));
    await database.db.update(classes).set({ status: "cancelled" }).where(eq(classes.id, entry.classId));
    assert.equal((await mine("test-student-a")).items.length, 1);
  });
  it("retains last successful data with source-failure metadata", async () => {
    await database.db.update(syncScopes).set({ lastError: "upstream offline" });
    const result = await mine("test-student-b");
    assert.equal(result.items.length, 1); assert.equal(result.items[0].sourceUpdateFailed, true);
  });
  it("uses Sydney local Mondays across daylight-saving boundaries", () => {
    const spring = weekRange("2026-10-04"), autumn = weekRange("2026-04-05");
    assert.equal((Date.parse(spring.to) - Date.parse(spring.from)) / 3600000, 167);
    assert.equal((Date.parse(autumn.to) - Date.parse(autumn.from)) / 3600000, 169);
  });
});
