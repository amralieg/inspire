import { test } from 'node:test';
import assert from 'node:assert/strict';
import { heldShare } from '../src/impact.js';
import { KIND_CHARTS } from '../src/kindCharts.js';

const P = { muted: '#999', series: ['#000'], well: '#eee' };
const mapNote = (rows) => KIND_CHARTS.map_points({ chart: { y: [{ label: 'Value' }] }, rows, P, valueFmt: () => String }).title?.text;
const placed = (x) => ({ x, y0: 1, y1: 10, y2: 20 });
const unplaced = (x) => ({ x, y0: 1, y1: null, y2: null });

test('the held share agrees with a count of 1 and of 2', () => {
  assert.equal(heldShare({ current: { records: 200, held: 1 } }), '1 record of 200 (1%) is held back now');
  assert.equal(heldShare({ current: { records: 200, held: 2 } }), '2 records of 200 (1%) are held back now');
});

test('the map note on rows without a place agrees with a count of 1 and of 2', () => {
  assert.equal(mapNote([placed('a'), unplaced('b')]), '1 of 2 rows has no latitude and longitude, so the map leaves it out');
  assert.equal(mapNote([placed('a'), unplaced('b'), unplaced('c')]), '2 of 3 rows have no latitude and longitude, so the map leaves them out');
  assert.equal(mapNote([unplaced('a')]), '1 of 1 row has no latitude and longitude, so the map leaves it out');
  assert.equal(mapNote([placed('a')]), undefined);
});
