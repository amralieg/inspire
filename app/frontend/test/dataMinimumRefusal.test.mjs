// REQ-255 (pre-build check) and REQ-256 (samples copy on the build step). Fail before: the 17-day forecast showed only a note and
// Build stayed enabled; the built-in sample refusal footer said "Grant access first" and pointed to a hand copy.
import test from 'node:test';
import assert from 'node:assert/strict';
import { dataMinimumBlocks, dataMinimumRefusalText, tooFewRowsText, SOURCE_REFUSED_REASON } from '../src/lib/implementWizard.js';

const forecast17 = { row_count: 3333, period_count: 17, minimum_rows: 60, skipped: false };

test('a forecast whose data has 17 distinct dates against a 60 minimum blocks the build and names both numbers and the way forward', () => {
  assert.equal(dataMinimumBlocks(forecast17), true);
  // Earlier steps: the plain sentence, which never blocks. The last step shows the refusal (dataMinimumRefusalText).
  assert.equal(tooFewRowsText(forecast17), 'Only 17 distinct dates are in this scope, fewer than the 60 this use case needs; you can still go on.');
  const text = dataMinimumRefusalText(forecast17);
  assert.match(text, /17 distinct dates/);
  assert.match(text, /at least 60 are needed/);
  assert.match(text, /coarser period/);
  assert.match(text, /more history/);
});

test('a forecast with enough distinct dates is not blocked, even on a table with few rows', () => {
  assert.equal(dataMinimumBlocks({ row_count: 70, period_count: 61, minimum_rows: 60 }), false);
  assert.equal(tooFewRowsText({ row_count: 70, period_count: 61, minimum_rows: 60 }), '');
});

test('a kind that counts rows blocks only when its rows are below the minimum, and an unchecked count never blocks', () => {
  assert.equal(dataMinimumBlocks({ row_count: 40, minimum_rows: 100 }), true);
  assert.match(tooFewRowsText({ row_count: 40, minimum_rows: 100 }), /40 rows/);
  assert.equal(dataMinimumBlocks({ skipped: true, unchecked: 'could not count', minimum_rows: 60 }), false);
  assert.equal(dataMinimumBlocks(null), false);
  assert.equal(dataMinimumBlocks({ row_count: 0, period_count: 0, minimum_rows: 60 }), false, 'an empty source is no data yet, not a refusal');
});

test('the source refusal keeps the grant wording (the built-in samples copy wording is gone, D-c23-01)', () => {
  assert.match(SOURCE_REFUSED_REASON, /Grant access first/);
});
