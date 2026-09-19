import assert from "node:assert/strict";
import { before, after, describe, it } from "node:test";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { testDatabase } from "./test-database";
import { authRequest, createAuth, type AppAuth } from "../src/server/auth/auth";
import { seedFixtures, fixtureUsers } from "../src/server/db/seed";
import { provisionTestAccounts } from "../src/server/auth/provision-test-accounts";
import { trpcRequest } from "../src/server/api/handler";
import { courses, session, user, userRoles } from "../src/server/db/schema";
import { getPrincipal, requireSelf, requireEntryAccess } from "../src/server/auth/authorization";
import { timetableEntries } from "../src/server/db/schema";
const origin = "http://127.0.0.1:3000";

describe("Real Better Auth sessions and server authorization", { concurrency: false }, () => {
  let database: Awaited<ReturnType<typeof testDatabase>>;
  let auth: AppAuth;
  const password = randomBytes(24).toString("base64url");
  const cookies: Record<string, string> = {};
  async function signIn(email: string, extra = {}) {
    return authRequest(auth, new Request(`${origin}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: origin }, body: JSON.stringify({ email, password, ...extra }) }));
  }
  async function rpc(path: string, cookie = "", input?: unknown) {
    const query = input === undefined ? "" : `?input=${encodeURIComponent(JSON.stringify(input))}`;
    const response = await trpcRequest(new Request(`${origin}/api/trpc/${path}${query}`, { headers: { cookie } }), { db: database.db, auth });
    return { status: response.status, body: await response.json(), headers: response.headers };
  }
  before(async () => {
    database = await testDatabase(); await seedFixtures(database.db);
    auth = createAuth(database.db, { secret: randomBytes(48).toString("hex"), baseURL: origin });
    const passwords = Object.fromEntries(fixtureUsers.map(u => [u.id, password]));
    await provisionTestAccounts(database.db, auth, passwords);
    await provisionTestAccounts(database.db, auth, passwords);
    for (const person of fixtureUsers) {
      const response = await signIn(person.email, { role: "staff", userId: "test-teacher" });
      assert.equal(response.status, 200);
      cookies[person.id] = response.headers.getSetCookie().map(c => c.split(";")[0]).join("; ");
      assert.match(response.headers.get("set-cookie")!, /httponly/i);
    }
  });
  after(async () => { await database?.close(); });
  it("uses the original user IDs and provisions four hashed accounts idempotently", async () => {
    const rows = (await database.pool.query('SELECT u.id, a.password FROM "user" u JOIN account a ON a.user_id = u.id')).rows;
    assert.equal(rows.length, 4); assert.ok(rows.every(r => r.password !== password));
    assert.deepEqual(rows.map(r => r.id).sort(), fixtureUsers.map(u => u.id).sort());
  });
  it("rejects missing/tampered sessions and returns no sensitive error detail", async () => {
    for (const cookie of ["", "unischedule.session_token=forged"]) {
      const result = await rpc("account.me", cookie);
      assert.equal(result.status, 401); assert.equal(result.body.error.data.code, "UNAUTHORIZED");
      assert.equal(result.body.error.data.stack, undefined); assert.ok(result.body.error.data.requestId);
    }
  });
  it("rejects bad passwords, public registration, and cross-origin sign-in", async () => {
    assert.equal((await signIn("student-a@example.invalid", { password: "wrong-password" })).status, 401);
    assert.equal((await authRequest(auth, new Request(`${origin}/api/auth/sign-up/email`, { method: "POST" }))).status, 404);
    assert.equal((await authRequest(auth, new Request(`${origin}/api/auth/sign-in/email`, { method: "POST", headers: { "Content-Type": "application/json", Origin: "https://untrusted.invalid" }, body: JSON.stringify({ email: "student-a@example.invalid", password }) }))).status, 403);
  });
  it("account.me ignores identity claims at sign-in and rejects forged RPC parameters", async () => {
    const result = await rpc("account.me", cookies["test-student-a"]);
    assert.equal(result.body.result.data.id, "test-student-a");
    assert.equal(result.body.result.data.emailVerified, false);
    assert.deepEqual(result.body.result.data.grants.map((g: {permission: string}) => g.permission), ["timetable.read.own"]);
    assert.equal(result.headers.get("cache-control"), "no-store");
    assert.equal((await rpc("account.me", cookies["test-student-a"], { userId: "test-teacher" })).status, 400);
  });
  it("denies student calls to staff endpoints and limits the teacher to COMP101", async () => {
    assert.equal((await rpc("staff.courses", cookies["test-student-a"])).status, 403);
    const result = await rpc("staff.courses", cookies["test-teacher"]);
    assert.deepEqual(result.body.result.data.map((c: {code: string}) => c.code), ["COMP101"]);
    assert.equal((await rpc("staff.courses", cookies["test-teacher"], { courseId: "anything" })).status, 400);
  });
  it("enforces entry and self scope even with dual student/staff roles", async () => {
    const [math] = await database.db.select().from(courses).where(eq(courses.code, "MATH101"));
    const [profile] = await database.db.select().from(user).where(eq(user.id, "test-student-a"));
    const [mathEntry] = await database.db.select().from(timetableEntries).where(eq(timetableEntries.externalId, "math-lecture-sep21"));
    await assert.rejects(requireEntryAccess(database.db, await getPrincipal(database.db, profile), mathEntry.id));
    await database.db.insert(userRoles).values({ userId: profile.id, role: "staff", scopeType: "course", courseId: math.id });
    const principal = await getPrincipal(database.db, profile);
    requireSelf(principal, profile.id); assert.throws(() => requireSelf(principal, "test-student-b"));
    await requireEntryAccess(database.db, principal, mathEntry.id);
    assert.deepEqual((await rpc("staff.courses", cookies[profile.id])).body.result.data.map((c: {code: string}) => c.code), ["MATH101"]);
    await database.db.delete(userRoles).where(eq(userRoles.courseId, math.id));
    assert.equal((await rpc("staff.courses", cookies[profile.id])).status, 403);
  });
  it("revoking a teacher grant immediately changes authorization for the same session", async () => {
    await database.db.delete(userRoles).where(eq(userRoles.userId, "test-teacher"));
    assert.equal((await rpc("staff.courses", cookies["test-teacher"])).status, 403);
  });
  it("sign-out invalidates the server session, including replay of the old cookie", async () => {
    const cookie = cookies["test-student-b"];
    const result = await authRequest(auth, new Request(`${origin}/api/auth/sign-out`, { method: "POST", headers: { Cookie: cookie, Origin: origin, "Content-Type": "application/json" }, body: "{}" }));
    assert.equal(result.status, 200);
    assert.equal((await rpc("account.me", cookie)).status, 401);
  });
  it("expired sessions cannot access protected queries", async () => {
    await database.db.update(session).set({ expiresAt: new Date(0) }).where(eq(session.userId, "test-student-a"));
    assert.equal((await rpc("account.me", cookies["test-student-a"])).status, 401);
  });
});
