import { test } from 'node:test';
import assert from 'node:assert/strict';
import { categoryLabels, fillRows, labelPx } from '../src/layout.js';

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

test('category labels take the width each category has, and tilt only when the longest would not fit', () => {
  const wide = categoryLabels(['Rate above contract', 'Duplicate invoice'], { width: 1100 });
  assert.equal(wide.axisLabel.rotate, 0);
  assert.equal(wide.axisLabel.overflow, 'truncate');
  assert.ok(wide.axisLabel.width >= labelPx('Rate above contract', 10));
  const crowded = categoryLabels(Array.from({ length: 30 }, (_, i) => `Category ${i} long name`), { width: 520 });
  assert.equal(crowded.axisLabel.rotate, 35);
  assert.equal(crowded.axisLabel.hideOverlap, true);
  assert.ok(crowded.axisLabel.width <= 96);
  assert.equal(categoryLabels([], {}).axisLabel.rotate, 0);
  const side = categoryLabels(['North region, Outerwear and coats'], { width: 1100, side: true });
  assert.equal(side.axisLabel.width, labelPx('North region, Outerwear and coats', 10) + 4);
  assert.equal(side.left, side.axisLabel.width + 14);
  assert.equal(categoryLabels(['x'.repeat(200)], { width: 400, side: true }).axisLabel.width, 120);
  assert.equal(categoryLabels(['x'.repeat(200)], { width: 2000, side: true }).axisLabel.width, 240);
});
