import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fillRows, labelTilt } from '../src/layout.js';

const charts = (...spans) => spans.map((span, i) => ({ id: `c${i}`, span }));

test('a lone half-width chart widens so no row has a hole', () => {
  assert.deepEqual(fillRows(charts(2, 1, 1, 1)), [2, 1, 1, 2]);
  assert.deepEqual(fillRows(charts(1)), [2]);
  assert.deepEqual(fillRows(charts(1, 2, 1, 1)), [2, 2, 1, 1]);
  assert.deepEqual(fillRows(charts(1, 1, 1, 2, 1)), [1, 1, 2, 2, 2]);
});

test('rows that already fill keep their spans', () => {
  assert.deepEqual(fillRows(charts(2, 1, 1)), [2, 1, 1]);
  assert.deepEqual(fillRows(charts(1, 1, 2, 1, 1)), [1, 1, 2, 1, 1]);
  assert.deepEqual(fillRows(charts(undefined, undefined)), [1, 1]);
  assert.deepEqual(fillRows([]), []);
});

test('category labels tilt only when they would crowd', () => {
  assert.equal(labelTilt(['Books', 'Music', 'Home', 'Garden', 'Toys', 'Sports']), 0);
  assert.equal(labelTilt(Array.from({ length: 9 }, (_, i) => `C${i}`)), 35);
  assert.equal(labelTilt(Array.from({ length: 6 }, () => 'Very long name')), 35);
  assert.equal(labelTilt([]), 0);
});
