import { shareRecipients } from "./schema";
import "server-only";
import { and, eq } from "drizzle-orm";
import type { Database } from "./connection";
import { staffPermissions, courses, dataSources, identityLinks, user, userRoles } from "./schema";
import { FIXTURE_SOURCE, fixtureAdapter } from "../integrations/fixture-adapter";
import { importTimetable } from "../integrations/import-timetable";

export const fixtureUsers = [
  { id: "test-student-a", subject: "student-a", name: "Demo Student A", email: "student-a@example.invalid", role: "student" },
  { id: "test-student-b", subject: "student-b", name: "Demo Student B", email: "student-b@example.invalid", role: "student" },
  { id: "test-student-empty", subject: "student-empty", name: "Demo Student Empty", email: "student-empty@example.invalid", role: "student" },
  { id: "test-teacher", subject: "teacher", name: "Demo Teacher", email: "teacher@example.invalid", role: "staff" },
] as const;

export async function seedFixtures(db: Database) {
  await db.transaction(async tx => {
    await tx.insert(dataSources).values({ id: FIXTURE_SOURCE, name: "Synthetic development fixtures — not approved university data", kind: "test" }).onConflictDoNothing();
    const [source] = await tx.select().from(dataSources).where(eq(dataSources.id, FIXTURE_SOURCE));
    if (source.kind !== "test") throw new Error("Fixture source ID is already assigned to a non-test source");
    for (const person of fixtureUsers) {
      await tx.insert(user).values({ id: person.id, name: person.name, email: person.email, emailVerified: false }).onConflictDoNothing();
      const [existing] = await tx.select().from(user).where(eq(user.id, person.id));
      if (!existing || existing.email !== person.email) throw new Error("Fixture identity conflicts with existing user");
      await tx.insert(identityLinks).values({ userId: person.id, identityProvider: "synthetic", externalSubject: person.subject }).onConflictDoNothing();
      const [link] = await tx.select().from(identityLinks).where(and(eq(identityLinks.identityProvider, "synthetic"), eq(identityLinks.externalSubject, person.subject)));
      if (link.userId !== person.id) throw new Error("Fixture identity mapping conflict");
      if (person.role === "student") await tx.insert(userRoles).values({ userId: person.id, role: "student", scopeType: "global" }).onConflictDoNothing();
    }
  });
  const result = await importTimetable(db, fixtureAdapter());
  const [course] = await db.select().from(courses).where(and(eq(courses.sourceId, FIXTURE_SOURCE), eq(courses.externalId, "comp101")));
  await db.insert(userRoles).values({ userId: "test-teacher", role: "staff", scopeType: "course", courseId: course.id }).onConflictDoNothing();
  for (const permission of ["supplement.write", "announcement.manage", "audit.read"]) await db.insert(staffPermissions).values({userId: "test-teacher", permission, courseId: course.id}).onConflictDoNothing();
  await db.insert(shareRecipients).values([{ownerId:"test-student-a",recipientId:"test-student-b"},{ownerId:"test-student-b",recipientId:"test-student-a"}]).onConflictDoNothing();
  return result;
}
