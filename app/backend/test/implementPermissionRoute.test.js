const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

// REQ-150: a build's Permission Required entries travel in asset_status.permissions on the row the Build page reads (GET .../implement/status, latest).
const OWNER = ['owner', 'example.com'].join('@');
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const SP = 'app-sp-2';
const SCOPE_SELECT = 'GRANT SELECT ON TABLE `main`.`inspire`.`churn_scope` TO `app-sp-2`';
const PERMISSION = {
  statements: [SCOPE_SELECT], instructions: [], principal: SP,
  why: 'The App cannot read its Data Filters view yet, so the filters show nothing. Ask your workspace admin to run these commands, then click Try again.',
};

function built(assets) {
  return {
    session_id: 42, use_case_id: 'N01-U01', spec_version: 3, status: 'ready_with_warnings', created_by: OWNER, updated_at: '2026-11-13T00:00:00Z',
    spec_json: JSON.stringify({ use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { app: true, app_name: 'churn-desk' } }),
    asset_status: JSON.stringify({ app: { state: 'ready', spec_version: 3 }, notebook: { state: 'ready', spec_version: 3 }, ...assets }),
    app_name: 'churn-desk',
  };
}

async function statusOf(rows) {
  const made = makeApp({ history: rows, moneySummary: [] });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/status?${Q}`, { headers: { 'x-forwarded-email': OWNER } });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}

test('the status route returns the build permission entries on latest.asset_status (the Build page reads them from there)', async () => {
  const got = await statusOf([built({ permissions: [PERMISSION] })]);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.data.latest.asset_status.permissions, [PERMISSION]);
  assert.equal(got.data.latest.asset_status.app.state, 'ready', 'the warning-free App record is unchanged');
});

test('a build with no permission entries returns none, so the Build page raises nothing', async () => {
  const got = await statusOf([built({})]);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.latest.asset_status.permissions, undefined);
});
