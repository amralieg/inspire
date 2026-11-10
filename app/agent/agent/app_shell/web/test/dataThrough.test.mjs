import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dataThroughText } from '../src/freshness.js';

test('old data says plainly that the source has no newer rows', () => {
  assert.equal(dataThroughText('2026-10-26', '2026-11-10'), 'Data through Oct 26, 2026: the source has no newer rows');
});

test('recent data is stated without a warning', () => {
  assert.equal(dataThroughText('2026-11-08', '2026-11-10'), 'Data through Nov 8, 2026');
});

test('data dated after today is flagged, not presented as the data through date', () => {
  assert.equal(dataThroughText('2026-11-28', '2026-11-10'), 'Data dated Nov 28, 2026 is after today (Nov 10, 2026): check the dates in the source');
});

test('no data date gives no sentence', () => {
  assert.equal(dataThroughText(null, '2026-11-10'), '');
});
