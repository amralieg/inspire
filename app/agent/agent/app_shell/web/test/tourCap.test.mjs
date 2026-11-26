import { test } from 'node:test';
import assert from 'node:assert/strict';
import { capStops } from '../src/tour.js';

const list = (...a) => a.map((anchor) => ({ anchor, title: anchor }));

test('a 6+ stop list is capped to 5 and keeps todo, value, saved and settings', () => {
  const out = capStops(list('decision', 'todo', 'kpis', 'value', 'saved', 'view', 'settings'), 5);
  assert.deepEqual(out.map((s) => s.anchor), ['decision', 'todo', 'value', 'saved', 'settings']);
});

test('a short list is left as it is, and help lists are not capped', () => {
  assert.equal(capStops(list('a', 'b'), 5).length, 2);
  assert.equal(capStops(list('a', 'b', 'c'), Infinity).length, 3);
});
