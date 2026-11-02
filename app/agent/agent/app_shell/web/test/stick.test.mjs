import { test } from 'node:test';
import assert from 'node:assert/strict';
import { NOT_RELIABLE, capacityText, reliableText, useCaseState } from '../src/hub.js';

const RUNS = { updated: '2026-10-20T06:00:00Z', as_of: '2026-10-20', cadence_days: 7, next: '2026-10-27', stale: false, count: 6, failed: false };
const tracked = { visible: true, tracked: true, items: [{ key: 'a', tier: 'Act now' }], runs: RUNS };
const why = "The best candidate's out-of-time AUC was 0.58 and this use case needs 0.70.";

test('a run that is not reliable yet says so with its reason and never shows a list to fix', () => {
  const state = useCaseState(tracked, { run: { decision_basis: 'measured', not_reliable: why, nothing_to_act: why } });
  assert.deepEqual(state, { kind: 'wait', text: NOT_RELIABLE, title: NOT_RELIABLE, reason: why, unreliable: true, next: '2026-10-27' });
  assert.equal(reliableText(state.reason), `Not reliable yet: ${why}`);
  assert.equal(reliableText('  '), '');
  const empty = useCaseState({ visible: true, tracked: false, empty: true }, { run: { not_reliable: 'No usable rows were found.' } });
  assert.equal(empty.text, 'Not reliable yet', 'a first run that stopped says why instead of waiting for results');
  assert.equal(useCaseState({ ...tracked, runs: { ...RUNS, failed: true } }, { run: { not_reliable: why } }).kind, 'stale',
    'a failed job after it is the newer truth');
  assert.equal(useCaseState(tracked, { run: { not_reliable: '' } }).text, '1 to fix');
});

test('the capacity note says how many more would qualify and that the cap holds them back', () => {
  assert.equal(capacityText({ over_capacity_records: 2950, act_now_capacity: 50 }),
    '2,950 more records would qualify for Act now, but the team capacity of 50 a run holds them in Review.');
  assert.equal(capacityText({ over_capacity_records: 1, act_now_capacity: 1 }),
    '1 more record would qualify for Act now, but the team capacity of 1 a run holds it in Review.');
  for (const run of [{ over_capacity_records: 0, act_now_capacity: 50 }, { act_now_capacity: 50 }, {}, null, undefined]) {
    assert.equal(capacityText(run), '', JSON.stringify(run));
  }
});
