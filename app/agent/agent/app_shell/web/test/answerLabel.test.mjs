import { test } from 'node:test';
import assert from 'node:assert/strict';
import { answerLabel } from '../src/format.js';

test('a Genie answer column names its aggregate in words, never with the SQL function or the raw alias', () => {
  assert.equal(answerLabel('sum(incremental_value)'), 'Total incremental value');
  assert.equal(answerLabel('avg(roi)'), 'Average roi');
  assert.equal(answerLabel('count(distinct community)'), 'Count distinct community');
  assert.equal(answerLabel('avg_roi'), 'Avg roi');
  assert.equal(answerLabel('category'), 'Category');
  assert.equal(answerLabel(undefined), undefined);
});
