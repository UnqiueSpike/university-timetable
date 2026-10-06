import type { TimetableItem } from "@/server/services/timetable";
export async function loadAllPages(fetchPage: (cursor?: string) => Promise<{ items: TimetableItem[]; nextCursor: string | null }>) {
  const items: TimetableItem[] = [], cursors = new Set<string>();
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    items.push(...page.items);
    cursor = page.nextCursor ?? undefined;
    if (cursor) { if (cursors.has(cursor)) throw new Error("Pagination did not advance"); cursors.add(cursor); }
  } while (cursor);
  return [...new Map(items.map(item => [item.id, item])).values()];
}
