// Each connected overlap group shares a column count; chained overlaps cannot cover a neighbour.
export function layoutEvents<T extends { id: string; start: number; end: number }>(events: T[]) {
  const sorted = [...events].sort((a, b) => a.start - b.start || a.id.localeCompare(b.id));
  const result: (T & { column: number; columns: number })[] = [];
  let group: T[] = [], groupEnd = -Infinity;
  function flush() {
    const ends: number[] = [];
    const assigned = group.map(event => {
      let column = ends.findIndex(end => end <= event.start);
      if (column < 0) column = ends.length;
      ends[column] = event.end;
      return { ...event, column };
    });
    result.push(...assigned.map(event => ({ ...event, columns: ends.length })));
    group = [];
  }
  for (const event of sorted) {
    if (event.start >= groupEnd) { flush(); groupEnd = event.end; }
    group.push(event); groupEnd = Math.max(groupEnd, event.end);
  }
  flush(); return result;
}
