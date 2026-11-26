const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

// c25_history: GET /implement/history answers in under 2 s for 50 runs when each warehouse statement and each Jobs read takes 200 ms.
// Every row is a build that was stopped by a person, so each row needs its run read, its stop record and its ended-run write.
const N = 50;
const LATENCY_MS = 200;
const BOUND_MS = 2000;
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42';
const ids = Array.from({ length: N }, (_, i) => `N01-U${String(i + 1).padStart(2, '0')}`);
const HISTORY = ids.map((id, i) => ({
  use_case_id: id,
  spec_version: 1,
  status: 'building_outputs',
  implement_run_id: String(1000 + i),
  updated_at: '2026-11-25T10:00:00Z',
  spec_json: { use_case_id: id, config: { result_table: `main.inspire.uc${i}_out` } },
}));
const CONTROL_LOG = HISTORY.map((row) => ({
  asset: 'build', asset_id: row.implement_run_id, action: 'cancel', result: 'ok', message: '', acted_by: 'person@example.com', acted_at: '2026-11-25T10:05:00.000Z',
}));
const STOPPED_RUN = { run_id: 99, state: { life_cycle_state: 'TERMINATED', result_state: 'CANCELED' } };

function fixture(latency) {
  return makeApp({
    history: HISTORY,
    implementRun: STOPPED_RUN,
    controlLog: CONTROL_LOG,
    statements: { 'run_rank = 1': { rows: [] } },
    ...(latency ? { sqlLatencyMs: LATENCY_MS, fetchLatencyMs: LATENCY_MS } : {}),
  });
}

async function read(latency) {
  const { app, sqlCalls, fetches } = fixture(latency);
  const srv = await listen(app);
  try {
    const started = Date.now();
    const resp = await fetch(`${srv.url}/api/inspire/implement/history?${Q}`);
    const elapsed = Date.now() - started;
    return { status: resp.status, body: await resp.json(), elapsed, sqlCalls, fetches };
  } finally {
    await srv.close();
  }
}

test('history of 50 runs answers in under 2 s at 200 ms per call, with the same body (c25_history)', async () => {
  const reference = await read(false);
  assert.equal(reference.status, 200);
  assert.equal(reference.body.latest.length, N);
  for (const row of reference.body.latest) {
    assert.equal(row.status, 'failed', 'the ended run is recorded on the row');
    assert.equal(row.stalled.ended, true);
    assert.equal(row.stalled.ended_by, 'user');
  }

  const slow = await read(true);
  assert.equal(slow.status, 200);
  assert.deepEqual(slow.body, reference.body, 'the latency changes nothing in the response');
  assert.equal(slow.fetches.filter((f) => f.path.startsWith('/api/2.1/jobs/runs/get')).length, N, 'every run is still read');
  const stopReads = slow.sqlCalls.filter((c) => String(c.sql).includes('__inspire_control_log'));
  assert.ok(stopReads.length <= 1, `the stop records are read once for the session, got ${stopReads.length} statements`);
  assert.ok(slow.elapsed < BOUND_MS, `history of ${N} runs took ${slow.elapsed} ms, bound ${BOUND_MS} ms`);
});
