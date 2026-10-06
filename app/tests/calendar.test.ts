import { it } from 'node:test';
import assert from 'node:assert/strict';
import { layoutEvents } from '../src/lib/timetable/layout';
it('chained, nested and equal-start classes never cover each other horizontally', () => {
  const events = [{id:'a',start:9,end:10},{id:'b',start:9.5,end:11},{id:'c',start:10,end:11.5},{id:'d',start:9.5,end:10.5},{id:'e',start:12,end:13}];
  const layout=layoutEvents(events);
  for(const a of layout) for(const b of layout) if(a.id!==b.id && a.start<b.end && b.start<a.end) assert.notEqual(a.column,b.column);
  assert.equal(layout.find(e=>e.id==='e')?.columns,1);
  assert.deepEqual(layout,layoutEvents([...events].reverse()));
});
