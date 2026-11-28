'use strict';
// c46 acceptance (REQ-585 item 3, REQ-579): after Accept, GET match/result also answers `accepted`, read from the session's latest
// Accept step row of __inspire_step (stage "Match Use Cases", step "Accept"). The agent writes that row's result_json as
// { accepted, dropped_inputs, inputs: [{ input_no, verdict, confidence, dropped_pieces: [{ piece_no, requirement }] }] }.
// match_verdict is not a column of __inspire_usecases, so this step row is the only place the App reads it. Written by the coordinator;
// the c46 builder may not edit this file.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const PERSON = 'l@example.com';
const INPUT_COLUMNS = ['session_id', 'input_no', 'name', 'description', 'event_at'];
const STEP_COLUMNS = ['step_id', 'session_id', 'last_updated', 'stage_name', 'step_name', 'sub_step_name', 'progress_increment', 'message', 'status', 'result_json'];
const query = `/api/inspire/match/result?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}&session_id=1001`;

const acceptJson = (inputs, at) => JSON.stringify({ accepted: inputs.filter((i) => i.verdict !== 'none').length, dropped_inputs: [], inputs, event_at: at });
const NEW_INPUTS = [
  { input_no: 2, verdict: 'full', confidence: 88, dropped_pieces: [] },
  { input_no: 1, verdict: 'partial', confidence: 61, dropped_pieces: [{ piece_no: 2, requirement: 'Cancellation events' }] },
];
const OLD_INPUTS = [
  { input_no: 1, verdict: 'full', confidence: 92, dropped_pieces: [] },
  { input_no: 2, verdict: 'none', confidence: 0, dropped_pieces: [{ piece_no: 1, requirement: 'Order history' }] },
];
const stepRow = (id, at, step, json, stage = 'Match Use Cases') => [String(id), '1001', at, stage, step, '', '0', '', 'ended_success', json];

function hook(steps) {
  return (sql) => {
    if (!/^\s*(SELECT|WITH)\b/i.test(sql)) return null;
    if (/__inspire_match_input/.test(sql)) return S.sqlResult(INPUT_COLUMNS, [
      ['1001', '1', 'Reduce customer churn', '', '2026-11-28T09:00:00Z'], ['1001', '2', 'Forecast weekly demand', '', '2026-11-28T09:00:00Z']]);
    if (/__inspire_match_decision/.test(sql)) return S.sqlResult(['session_id', 'input_no', 'piece_no', 'decision', 'event_at'], []);
    if (/__inspire_match\b/.test(sql)) return S.sqlResult(['session_id', 'input_no', 'report_json', 'verdict', 'confidence', 'event_at'], [
      ['1001', '1', JSON.stringify({ input_no: 1, verdict: 'partial', confidence: 61, pieces: [] }), 'partial', '61', '2026-11-28T09:05:00Z'],
      ['1001', '2', JSON.stringify({ input_no: 2, verdict: 'full', confidence: 88, pieces: [] }), 'full', '88', '2026-11-28T09:06:00Z']]);
    if (/__inspire_step/.test(sql)) return S.sqlResult(STEP_COLUMNS, steps);
    return null;
  };
}

test('c46: match/result answers accepted from the Accept step: verdict, confidence and dropped pieces per input, in input order (must-fail on the base)', async () => {
  S.reset();
  S.state.sqlHook = hook([
    stepRow(7, '2026-11-28T11:00:00Z', 'Matching', JSON.stringify({ input_no: 1 })),
    stepRow(9, '2026-11-28T11:10:00Z', 'Accept', acceptJson(NEW_INPUTS, '2026-11-28T11:10:00Z')),
  ]);
  const got = await S.request('GET', query, { person: PERSON });
  assert.equal(got.status, 200, got.text);
  assert.deepEqual(got.data.accepted, [
    { input_no: 1, verdict: 'partial', confidence: 61, dropped: [{ piece_no: 2, requirement: 'Cancellation events' }] },
    { input_no: 2, verdict: 'full', confidence: 88, dropped: [] },
  ]);
  assert.equal(got.data.reports.length, 2, 'must-keep: the reports still answer as before');
});

test('c46 must-fail: an older Accept step row loses to the newer one, whatever order the rows come back in', async () => {
  for (const rows of [
    [stepRow(3, '2026-11-28T10:00:00Z', 'Accept', acceptJson(OLD_INPUTS, '2026-11-28T10:00:00Z')), stepRow(9, '2026-11-28T11:10:00Z', 'Accept', acceptJson(NEW_INPUTS, '2026-11-28T11:10:00Z'))],
    [stepRow(9, '2026-11-28T11:10:00Z', 'Accept', acceptJson(NEW_INPUTS, '2026-11-28T11:10:00Z')), stepRow(3, '2026-11-28T10:00:00Z', 'Accept', acceptJson(OLD_INPUTS, '2026-11-28T10:00:00Z'))],
  ]) {
    S.reset();
    S.state.sqlHook = hook(rows);
    const got = await S.request('GET', query, { person: PERSON });
    assert.equal(got.status, 200, got.text);
    assert.deepEqual(got.data.accepted.map((a) => [a.input_no, a.verdict, a.confidence]), [[1, 'partial', 61], [2, 'full', 88]], 'the newer Accept run wins');
  }
});

test('c46 must-keep: no Accept step, an Accept step of another stage, or an unreadable result_json answers accepted: []', async () => {
  for (const rows of [
    [],
    [stepRow(4, '2026-11-28T11:00:00Z', 'Matching', JSON.stringify({ input_no: 1 }))],
    [stepRow(5, '2026-11-28T11:00:00Z', 'Accept', acceptJson(NEW_INPUTS, '2026-11-28T11:00:00Z'), 'Use Case Design')],
    [stepRow(6, '2026-11-28T11:00:00Z', 'Accept', '{"inputs": [ not json')],
  ]) {
    S.reset();
    S.state.sqlHook = hook(rows);
    const got = await S.request('GET', query, { person: PERSON });
    assert.equal(got.status, 200, got.text);
    assert.deepEqual(got.data.accepted, [], `rows ${JSON.stringify(rows.map((r) => r[4]))} answer no accepted list`);
  }
  S.reset();
  S.state.sqlHook = (sql) => (/__inspire_step/.test(sql) ? { statement_id: 's1', status: { state: 'FAILED', error: { message: '[TABLE_OR_VIEW_NOT_FOUND] __inspire_step' } } } : hook([])(sql));
  const missing = await S.request('GET', query, { person: PERSON });
  assert.equal(missing.status, 200, `no step table yet is not an error: ${missing.text}`);
  assert.deepEqual(missing.data.accepted, []);
});
