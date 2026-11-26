// c25_blaunch R1 (RC7-B-06): with Show everything off a catalog that is only partly readable (`partial` set) is still usable, so it stays listed
// with its "Show the missing grant" link; a catalog that only needs access (not partial) waits for Show everything.
import test from 'node:test';
import assert from 'node:assert/strict';
import { usableRows } from '../src/lib/tableScope.js';

const rows = [
  { name: 'main', inspire_readable: true },
  { name: 'part', inspire_readable: false, partial: { missing: ['GRANT SELECT ON CATALOG `part` TO `app`'] } },
  { name: 'inspireNeeds', inspire_readable: false },
  { name: 'personNeeds', readable: false },
];
const names = (list) => list.map((r) => r.name);

test('R1: a partial catalog stays listed with Show everything off (must-keep)', () => {
  assert.deepEqual(names(usableRows(rows, false)), ['main', 'part']);
});

test('R1: Show everything lists every row (must-keep)', () => {
  assert.deepEqual(names(usableRows(rows, true)), ['main', 'part', 'inspireNeeds', 'personNeeds']);
});
