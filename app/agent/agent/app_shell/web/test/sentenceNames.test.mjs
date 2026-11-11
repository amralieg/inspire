import { test } from 'node:test';
import assert from 'node:assert/strict';
import { entityName } from '../src/format.js';
import { recordSentenceName } from '../src/records.js';

test('a row with no label gives a sentence no name, so the record id never reads as a name in a sentence', () => {
  assert.equal(entityName({ franchise_id: 3000046 }, 'franchise_id'), 'Franchise 3000046', 'a table keeps its id fallback');
  assert.equal(entityName({ franchise_id: 3000046 }, 'franchise_id', { sentence: true }), '');
  assert.equal(entityName({ franchise_id: 3000046, franchise_name: 'Golden Gate Bakery' }, 'franchise_id', { sentence: true }), 'Golden Gate Bakery');
});

test('the name a sentence uses falls back to This record, never to the raw key', () => {
  const meta = { label: 'franchise_id', key: 'franchise_id' };
  assert.equal(recordSentenceName({ franchise_id: 3000046 }, meta), 'This record');
  assert.equal(recordSentenceName({ franchise_id: 3000046, franchise_name: 'Golden Gate Bakery' }, meta), 'Golden Gate Bakery');
});
