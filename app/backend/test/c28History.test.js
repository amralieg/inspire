const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

// c28_history (REQ-558 lane, history latency): GET /implement/history sends a fixed number of warehouse statements however many runs
// the session holds. Every row here is a build stopped by a person, so each row needs its ended-run write: those writes are one statement.
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42';
const FIXED_STATEMENTS = 6;

function rowsOf(n) {
  const history = Array.from({ length: n }, (_, i) => ({
    use_case_id: `N01-U${String(i + 1).padStart(2, '0')}`, spec_version: 1, status: 'building_outputs', implement_run_id: String(1000 + i),
    updated_at: '2026-11-25T10:00:00Z', spec_json: { use_case_id: `N01-U${String(i + 1).padStart(2, '0')}`, config: { result_table: `main.inspire.uc${i}_out` } },
  }));
  const controlLog = history.map((row) => ({ asset: 'build', asset_id: row.implement_run_id, action: 'cancel', result: 'ok', message: '', acted_by: 'person@example.com', acted_at: '2026-11-25T10:05:00.000Z' }));
  return { history, controlLog };
}

async function statementsFor(n) {
  const { history, controlLog } = rowsOf(n);
  const { app, sqlCalls } = makeApp({ history, controlLog, implementRun: { run_id: 99, state: { life_cycle_state: 'TERMINATED', result_state: 'CANCELED' } }, statements: { 'run_rank = 1': { rows: [] } } });
  const srv = await listen(app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/history?${Q}`);
    const body = await resp.json();
    assert.equal(resp.status, 200);
    assert.equal(body.latest.length, n);
    for (const row of body.latest) assert.equal(row.status, 'failed', 'the ended run is recorded on the row');
    return sqlCalls.length;
  } finally {
    await srv.close();
  }
}

test('history sends at most a fixed number of statements, independent of the number of runs', async () => {
  const few = await statementsFor(5);
  const many = await statementsFor(50);
  assert.ok(many <= FIXED_STATEMENTS, `50 runs sent ${many} statements, bound ${FIXED_STATEMENTS}`);
  assert.equal(many, few, `5 runs sent ${few} statements, 50 runs sent ${many}`);
});
