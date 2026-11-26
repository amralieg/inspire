import test from 'node:test';
import assert from 'node:assert/strict';
import { splitEstimate } from '../src/records.js';

// RC7-B-12: stored text now reads "(estimate: depends on x)"; the "Estimate, based on" note must survive, and the old bracket form still reads.
test('splitEstimate reads the plain "(estimate: ...)" form the agent now stores', () => {
  assert.deepEqual(splitEstimate('Margin at risk (estimate: depends on order_quantity)'), { text: 'Margin at risk', note: 'Estimate, based on order quantity.' });
  assert.deepEqual(splitEstimate('Margin at risk (Estimate: depends on `order_quantity`) per week'), { text: 'Margin at risk per week', note: 'Estimate, based on order quantity.' });
  assert.deepEqual(splitEstimate('Saving (estimate: depends on c.s.orders)'), { text: 'Saving', note: 'Estimate, based on the data behind this record.' });
});

test('splitEstimate still reads the old bracket form', () => {
  assert.deepEqual(splitEstimate('Margin at risk [ESTIMATE: depends on `order_quantity`]'), { text: 'Margin at risk', note: 'Estimate, based on order quantity.' });
  assert.deepEqual(splitEstimate('Plain text'), { text: 'Plain text', note: '' });
});
