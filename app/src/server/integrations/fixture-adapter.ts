import "server-only";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { batchSchema, type TimetableAdapter } from "./contracts";

export const FIXTURE_SOURCE = "synthetic-timetable-v1";
export const FIXTURE_TERM = "2026-S2";
// File reading, timestamp normalization and external field validation stay at this boundary.
export function fixtureAdapter(file = resolve("fixtures/timetable.json")): TimetableAdapter {
  return {
    sourceId: FIXTURE_SOURCE, kind: "test", term: FIXTURE_TERM,
    async load() {
      const parsed = batchSchema.parse(JSON.parse(await readFile(file, "utf8")));
      return {
        ...parsed,
        entries: parsed.entries.map(e => ({ ...e, startAt: new Date(e.startAt).toISOString(), endAt: new Date(e.endAt).toISOString(), sourceUpdatedAt: e.sourceUpdatedAt === null ? null : new Date(e.sourceUpdatedAt).toISOString() })),
        capacities: parsed.capacities.map(c => ({ ...c, observedAt: new Date(c.observedAt).toISOString() })),
      };
    },
  };
}
