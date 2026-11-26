import { test } from 'node:test';
import assert from 'node:assert/strict';
import { decideChoices, modeOf, queueOf, stepsOf, summaryOf } from '../src/focus.js';

// REQ-542: the pure rules behind the One-by-One wizard. No React, no browser.
const ROWS = [
  { record_key: 'A', value: 30, status: 'open', label: 'Alpha' },
  { record_key: 'B', value: 90, status: 'open', label: 'Bravo' },
  { record_key: 'C', value: 60, status: 'done', label: 'Charlie' },
  { record_key: 'D', value: 90, status: 'open', label: 'Delta' },
  { record_key: 'E', value: 10, status: 'open', label: 'Echo' },
];
const QUEUE = { filter: "status = 'open'", order: { column: 'value', direction: 'desc' }, cohort_column: null };
const step = (id, kind) => ({ id, question: `Question ${id}?`, kind });
const spec = (n) => ({ steps: Array.from({ length: n }, (_, i) => step(`s${i + 1}`, i === n - 1 ? 'decide' : 'show')) });

test('queueOf filters, then orders by the column and direction, keeping the input order among equals', () => {
  assert.deepEqual(queueOf(ROWS, QUEUE).map((r) => r.record_key), ['B', 'D', 'A', 'E']);
  assert.deepEqual(queueOf(ROWS, { ...QUEUE, order: { column: 'value', direction: 'asc' } }).map((r) => r.record_key), ['E', 'A', 'B', 'D']);
  assert.equal(queueOf(ROWS, QUEUE).length, 4, 'k of n counts the filtered queue, not all rows');
  assert.deepEqual(queueOf(ROWS, { ...QUEUE, filter: "status = 'open' AND value >= 60" }).map((r) => r.record_key), ['B', 'D']);
  assert.deepEqual(queueOf([], QUEUE), []);
});

test('queueOf reads the status of a record from its action status when the row has no status column', () => {
  const rows = [{ record_key: 'A', value: 1, _inspire_status: 'Done' }, { record_key: 'B', value: 2, _inspire_status: null }, { record_key: 'C', value: 3, _inspire_status: 'In progress' }];
  assert.deepEqual(queueOf(rows, QUEUE).map((r) => r.record_key), ['C', 'B']);
});

test('stepsOf returns 2 to 5 steps with the decide step last, and rejects 1 or 6', () => {
  assert.equal(stepsOf(spec(2)).length, 2);
  assert.equal(stepsOf(spec(5)).length, 5);
  assert.equal(stepsOf(spec(3)).at(-1).kind, 'decide');
  assert.deepEqual(stepsOf(spec(1)), []);
  assert.deepEqual(stepsOf(spec(6)), []);
  const lastNotDecide = { steps: [step('a', 'show'), step('b', 'show')] };
  assert.deepEqual(stepsOf(lastNotDecide), []);
  assert.deepEqual(stepsOf(null), []);
});

test('decideChoices drops a choice whose action is not allowed', () => {
  const choices = [{ label: 'Mark done', action: 'done' }, { label: 'Approve it', action: 'approve' }, { label: 'Snooze', action: 'snooze' }];
  const spec2 = { decide: { choices } };
  assert.deepEqual(decideChoices(spec2, ['done', 'snooze']).map((c) => c.action), ['done', 'snooze']);
  assert.deepEqual(decideChoices(spec2, ['approve']).map((c) => c.action), ['approve']);
  assert.deepEqual(decideChoices(spec2, []), []);
  assert.deepEqual(decideChoices({}, ['done']), []);
});

test('summaryOf counts each action and the skipped items', () => {
  const log = [{ key: 'A', action: 'done' }, { key: 'B', action: 'done' }, { key: 'C', action: 'snooze' }, { key: 'D', action: 'skip' }, { key: 'E', action: 'skip' }];
  assert.deepEqual(summaryOf(log), { done: 2, snooze: 1, skipped: 2, total: 5 });
  assert.deepEqual(summaryOf([]), { skipped: 0, total: 0 });
});

test('modeOf follows the saved choice, and auto means one by one up to 20 items', () => {
  assert.equal(modeOf({ workMode: 'auto' }, 20), 'one');
  assert.equal(modeOf({ workMode: 'auto' }, 21), 'all');
  assert.equal(modeOf({}, 20), 'one');
  assert.equal(modeOf({}, 21), 'all');
  assert.equal(modeOf({ workMode: 'one' }, 500), 'one');
  assert.equal(modeOf({ workMode: 'all' }, 3), 'all');
});
