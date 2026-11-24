// REQ-408 at the route: the build's App read offer (sourceVerdict behind the context route) asks at catalog level when the run picked the
// whole catalog, and at schema level when the run has no whole-catalog pick.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const APP = 'app-sp-id';
const APP_TOKEN = 'app-token';
const SPEC = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { dashboard: true } };
const HISTORY = [{ spec_version: 1, status: 'ready', use_case_id: 'N01-U01', job_id: 77, spec_json: JSON.stringify(SPEC) }];
const USE_CASE = { id: 'N01-U01', use_case: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' };

function sessionRow() {
  return { session_id: 42, business_name: 'Acme', inspire_database_name: 'main.inspire', processing_status: 'ready' };
}

async function contextOf(tables) {
  const made = makeApp({
    history: HISTORY, useCase: USE_CASE, appToken: APP_TOKEN,
    me: { applicationId: APP, displayName: 'riverside-assets' },
    // The App cannot read the table; the person can (the denial is for the App's token only).
    sqlDeniedFor: { [APP_TOKEN]: { '`main`.`s`.`orders`': '[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table main.s.orders' } },
    session: sessionRow(), ucMetadata: tables,
  });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/context?${Q}`);
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}

test('SEC-01 (W3) route: a build whose run picked the whole catalog still asks the App read at table level', async () => {
  const got = await contextOf('main');
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const statements = got.data.app_unreadable.permissions[0].statements;
  assert.ok(statements.includes(`GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${APP}\``), JSON.stringify(statements));
  assert.equal(statements.filter((sql) => /^GRANT (SELECT|READ METADATA) ON (CATALOG|SCHEMA) /.test(sql)).length, 0, JSON.stringify(statements));
});

test('SEC-01 (W3) route: a build without a whole-catalog pick asks at table level', async () => {
  const got = await contextOf('main.s.orders');
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const statements = got.data.app_unreadable.permissions[0].statements;
  assert.ok(statements.includes(`GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${APP}\``), JSON.stringify(statements));
});

// REQ-408 at the preflight route (sourceCheckOf behind the submit's pre-check): the App read offer names the catalog for a whole-catalog pick.
const PREFLIGHT_Q = `${Q}&result_table=main.inspire.churn_out`;
async function preflightOf(ucMetadata) {
  const made = makeApp({
    history: HISTORY, useCase: USE_CASE, appToken: APP_TOKEN, me: { applicationId: APP, displayName: 'riverside-assets' },
    sqlDeniedFor: { [APP_TOKEN]: { '`main`.`s`.`orders`': '[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table main.s.orders' } },
    session: sessionRow(), ucMetadata,
  });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/preflight?${PREFLIGHT_Q}`);
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}

test('SEC-01 (W3) preflight (submit path): a whole-catalog pick still asks the App read at table level', async () => {
  const got = await preflightOf('main');
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const statements = got.data.checks.sources.permission.statements;
  assert.ok(statements.includes(`GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${APP}\``), JSON.stringify(statements));
  assert.equal(statements.filter((sql) => /^GRANT (SELECT|READ METADATA) ON (CATALOG|SCHEMA) /.test(sql)).length, 0, JSON.stringify(statements));
});

test('SEC-01 (W3) preflight (submit path): without a whole-catalog pick the App read asks at table level', async () => {
  const got = await preflightOf('main.s.orders');
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const statements = got.data.checks.sources.permission.statements;
  assert.ok(statements.includes(`GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${APP}\``), JSON.stringify(statements));
});
