import { z } from "zod";
const key = z.string().trim().min(1).max(200);
const time = z.iso.datetime({ offset: true });
const state = z.enum(["active", "cancelled"]);
export const batchSchema = z.strictObject({
  term: key, version: z.number().int().positive().max(2147483647),
  mode: z.enum(["snapshot", "delta"]), complete: z.boolean(),
  courses: z.array(z.strictObject({ externalId: key, code: key, name: key })),
  classes: z.array(z.strictObject({ externalId: key, courseExternalId: key, classCode: key, type: key, status: state })),
  entries: z.array(z.strictObject({ externalId: key, classExternalId: key, startAt: time, endAt: time, location: z.string().max(500).nullable(), status: state, sourceUpdatedAt: time.nullable() }).refine(v => Date.parse(v.endAt) > Date.parse(v.startAt), "endAt must be after startAt")),
  memberships: z.array(z.strictObject({ externalId: key, classExternalId: key, identityProvider: key, externalSubject: key, status: z.enum(["active", "inactive"]) })),
  capacities: z.array(z.strictObject({ externalId: key, classExternalId: key, total: z.number().int().nonnegative().max(2147483647).nullable(), available: z.number().int().nonnegative().max(2147483647).nullable(), observedAt: time })),
}).superRefine((v, ctx) => {
  if ((v.mode === "snapshot") !== v.complete) ctx.addIssue({ code: "custom", message: "Snapshots must explicitly be complete; deltas must not be complete" });
  for (const kind of ["courses", "classes", "entries", "memberships", "capacities"] as const) {
    const ids = v[kind].map(r => r.externalId);
    if (new Set(ids).size !== ids.length) ctx.addIssue({ code: "custom", message: `Duplicate externalId in ${kind}` });
  }
  if (v.mode === "snapshot") {
    const classIds = new Set(v.classes.map(c => c.externalId));
    for (const row of [...v.entries, ...v.memberships, ...v.capacities]) {
      if (!classIds.has(row.classExternalId)) ctx.addIssue({ code: "custom", message: "Complete snapshot must include referenced classes" });
    }
    const courseIds = new Set(v.courses.map(c => c.externalId));
    if (v.classes.some(c => !courseIds.has(c.courseExternalId))) ctx.addIssue({ code: "custom", message: "Complete snapshot must include referenced courses" });
  }
});
export type ImportBatch = z.infer<typeof batchSchema>;
export interface TimetableAdapter {
  readonly sourceId: string;
  readonly kind: "test"; // Only a synthetic adapter is implemented/approved for development.
  readonly term: string;
  load(): Promise<unknown>;
}
