const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');
const { buildDiagnostics, cloudOf } = require('../lib/buildDiagnostics');
const { maskPrivate, nameLabels } = require('../lib/redact');
const { newIssueUrl } = require('../../frontend/src/lib/issues.js');

const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const FAKE_PAT = `dapi${'0123456789abcdef'.repeat(2)}`;
const FAKE_JWT = ['eyJ' + 'hbGciOiJub25lIn0', 'eyJzdWIiOiJmYWtlLXVzZXIifQ', 'ZmFrZS1zaWduYXR1cmU'].join('.');
const EMAIL = ['ana.lopez', 'contoso-bank.com'].join('@');
const OTHER_EMAIL = ['ops.team', 'fabrikam.io'].join('@');
const HOST = `https://${['adb-1234567890123456', '7', `azure${'databricks'}`, 'net'].join('.')}`;
const OTHER_HOST = [['dbc', '1a2b3c4d', '5e6f'].join('-'), 'cloud', 'databricks', 'com'].join('.');
const HOME = ['', 'Users', 'ana'].join('/');
const TABLE = 'prod_cat.sales_core.customer_orders';
const OTHER_TABLE = '`prod_cat`.`sales_core`.`loyalty_points`';
const PRIVATE = [
  EMAIL, OTHER_EMAIL, HOST.slice(8, 28), HOST.slice(-19), OTHER_HOST, OTHER_HOST.slice(0, 12), FAKE_PAT, FAKE_JWT, 'eyJ', 'fake-cookie-123',
  'prod_cat', 'sales_core', 'customer_orders', 'loyalty_points', 'lifetime_spend', 'region_code', 'churn_score', 'tier_name',
  'Riyadh', 'Gold tier', '4821.75', '1500', 'VIP', 'amount', ' status =', 'ana.lopez', 'Ana Lopez', 'ContosoBank', 'contoso-churn-desk', 'Q3 revenue',
  "'A'", 'secret-sample', HOME, 'workspace.example.com',
];

const spec = {
  use_case_id: 'N01-U01', use_case_name: 'Predict churn for ContosoBank',
  config: { warehouse_id: 'wh1', result_table: TABLE },
  data: { tables: { [TABLE]: 'prod_cat.sales_core.customer_orders_v2' }, filters: [{ table: TABLE, column: 'region_code', op: 'in', values: ['Riyadh', 'secret-sample', 'Gold tier'] }] },
  kpi: { column: 'churn_score' },
  outputs: { dashboard: true, app: true, app_name: 'contoso-churn-desk', alert_recipients: [EMAIL] },
};
const step = (phase, status, at, message, extra = {}) => ({
  step_id: `${phase}-${status}`, stage_name: 'Implement Use Cases', step_name: `Inspire is working on ${phase.toLowerCase()}`, sub_step_name: 'Completed: n01-u01',
  status, message, last_updated: at, result_json: JSON.stringify({ use_case_id: 'N01-U01', phase, spec_version: 2, ...extra }),
});
const ERROR = `[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column with name \`lifetime_spend\` cannot be resolved in ${OTHER_TABLE}. SQL: SELECT tier_name FROM ${TABLE} WHERE amount > 1500 AND status = 'VIP' AND region_code IN ('A', 'B') -- by ${EMAIL} on ${HOST}/editor/notebooks/1 with Bearer ${FAKE_JWT}`;
const STATE = {
  session: { business_name: 'ContosoBank', discovery_type: 'Deep', inspire_database_name: 'main.inspire' },
  history: [
    { session_id: '42', use_case_id: 'N01-U01', spec_version: 2, based_on_version: 1, status: 'failed', change_classes: 'outputs', created_by: EMAIL, spec_json: spec,
      status_message: `Preview run failed: ${ERROR}`, job_id: '770000000000001', implement_run_id: '880000000000002', last_preview_run_id: '990000000000003',
      notebook_path: `/Workspace/Users/${EMAIL}/inspire/N01-U01`, app_name: 'contoso-churn-desk', app_url: 'https://contoso-churn-desk-1.aws.databricksapps.com',
      dashboard_url: `${HOST}/dashboardsv3/d1`, created_at: '2026-11-08T10:00:00.000Z', updated_at: '2026-11-08T10:12:00.000Z',
      asset_status: JSON.stringify({ dashboard: { state: 'failed', spec_version: 2, reason: `Gold tier rows in ${TABLE} had value 4821.75` }, 'app:page:Gold tier': { state: 'ready', spec_version: 1 } }) },
    { session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', spec_json: spec, created_by: 'Ana Lopez', status_message: `built by ${OTHER_EMAIL}`,
      created_at: '2026-11-07T10:00:00.000Z', updated_at: '2026-11-07T10:30:00.000Z' },
  ],
  steps: [
    step('Plan', 'ended_success', '2026-11-08T10:01:00.000Z', `Read ${TABLE} as ${EMAIL}`),
    step('Instruction', 'ended_success', '2026-11-08T10:03:00.000Z', 'Wrote the instruction for churn_score by region_code'),
    step('Genie Code', 'ended_success', '2026-11-08T10:04:00.000Z', 'started'),
    step('Genie build', 'ended_success', '2026-11-08T10:09:00.000Z', `token=${FAKE_PAT} cookie: fake-cookie-123`),
    step('Preview run', 'ended_error', '2026-11-08T10:12:00.000Z', ERROR, { error_code: 'UNRESOLVED_COLUMN', round: 2, rounds: 3, error: `values "Riyadh" and 4821.75 in ${OTHER_HOST}` }),
  ],
  liveLog: [
    `2026-11-08 10:05:00 - DatabricksInspire - INFO - [GENIE N01-U01] [build] Genie: The top customer Ana Lopez spent 4821.75 on Q3 revenue in ${TABLE}`,
    '2026-11-08 10:06:00 - DatabricksInspire - INFO - [GENIE N01-U01] [build] Genie ran: python check.py (exit 1)',
    `2026-11-08 10:07:00 - DatabricksInspire - INFO - [GENIE N01-U01] [build] Genie error: could not read /Workspace/Users/${EMAIL}/x.py from ${HOST}`,
    '2026-11-08 10:08:00 - DatabricksInspire - INFO - [GENIE N01-U01] [build] Genie turn completed',
    `2026-11-08 10:10:00 - DatabricksInspire - INFO - [IMPLEMENT N01-U01] relay round 2 sent the error on \`tier_name\` from ${TABLE} where tier = 'Gold tier'`,
    '2026-11-08 10:11:00 - DatabricksInspire - INFO - [IMPLEMENT N01-U01] [120s] job run 990000000000003: TERMINATED / FAILED',
    '',
  ].join('\n'),
  runs: { runs: [{ run_id: 990000000000003, start_time: Date.parse('2026-11-08T10:09:30Z'), run_duration: 150000, state: { result_state: 'FAILED', state_message: `Task failed on ${TABLE}: ${EMAIL}` }, trigger: 'ONE_TIME', run_page_url: `${HOST}/#job/1/run/2` }] },
  appExists: true,
  app: { name: 'contoso-churn-desk', description: 'Inspire use case N01-U01 (session 42): Predict churn', url: 'https://contoso-churn-desk-1.aws.databricksapps.com', compute_status: { state: 'ACTIVE' }, app_status: { state: 'CRASHED', message: `crashed reading ${TABLE} for ${EMAIL}` } },
  buildStamp: { version: '1.5.0', shell: 'abcdef0123456789abcdef' },
};

async function withApp(state, fn) {
  const made = makeApp(state);
  const srv = await listen(made.app);
  try {
    return await fn(srv.url, made);
  } finally {
    await srv.close();
  }
}

const get = async (url) => {
  const resp = await fetch(url);
  return { status: resp.status, data: await resp.json() };
};

const survivors = (text) => PRIVATE.filter((s) => text.toLowerCase().includes(s.toLowerCase()));

test('the diagnostics file holds every build fact and none of the private text: no email, host, token, cookie, table or column name, sample value, SQL literal, person or home path (must-exclude)', async () => {
  await withApp(STATE, async (url) => {
    const got = await get(`${url}/api/inspire/implement/diagnostics?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const { text, filename, issue } = got.data;
    assert.deepEqual(survivors(text), [], text);
    assert.deepEqual(survivors(`${issue.title}\n${issue.body}`), []);
    assert.equal(filename, 'inspire-diagnostics-N01-U01-v2.txt');
    for (const fact of ['App and agent version: 1.5.0', 'App build: abcdef0123456789', 'Use case: N01-U01', 'Build version: v2 (based on v1)', 'Build status: failed',
      'Job id: 770000000000001', 'Build run id: 880000000000002', 'Preview run id: 990000000000003', '- run 990000000000003: FAILED', 'Genie turns completed: 1',
      'Genie commands: 1, failed: 1', 'Genie messages: 1 (their text is left out)', 'UNRESOLVED_COLUMN.WITH_SUGGESTION', 'error_code UNRESOLVED_COLUMN', '- Preview run: error',
      'round 2', 'Earlier versions (1)', 'state CRASHED, compute ACTIVE']) {
      assert.ok(text.includes(fact), `the file says ${fact}:\n${text}`);
    }
    assert.match(text, /^- v1: ready, updated 2026-11-07T10:30:00.000Z: built by \[email\]$/m);
  });
});

test('one table or column keeps the same label everywhere in one file, and a different one gets a different label', async () => {
  await withApp(STATE, async (url) => {
    const { text } = (await get(`${url}/api/inspire/implement/diagnostics?${Q}`)).data;
    const orders = text.match(/catalog_\d+\.schema_\d+\.table_\d+/g);
    assert.ok(orders.length >= 5, text);
    const labelOf = (re) => [...new Set(text.match(re) || [])];
    const tableLabels = new Set(orders);
    assert.equal(tableLabels.size, 2, `customer_orders and loyalty_points: ${[...tableLabels]}`);
    assert.equal(labelOf(/catalog_\d+(?=\.schema)/g).length, 1, 'prod_cat gets one catalog label every time');
    assert.equal(labelOf(/(?<=\.)schema_\d+(?=\.table)/g).length, 1, 'sales_core gets one schema label every time');
    assert.match(text, /column with name column_\d+ cannot be resolved/);
    const spend = /column with name (column_\d+)/.exec(text)[1];
    const region = /by (column_\d+)/.exec(text)[1];
    assert.notEqual(spend, region);
    assert.equal(/Wrote the instruction for (column_\d+) by/.exec(text)[1] !== region, true, 'churn_score and region_code differ');
    const masked = maskPrivate(`${TABLE} then ${TABLE.toUpperCase()} then ${TABLE}`, { label: nameLabels() });
    assert.equal(masked.split(' then ')[0], masked.split(' then ')[2]);
  });
});

test('Download and Copy read one server answer, so two reads of the same build are the identical text', async () => {
  await withApp(STATE, async (url) => {
    const a = (await get(`${url}/api/inspire/implement/diagnostics?${Q}`)).data;
    await new Promise((r) => setTimeout(r, 1100));
    const b = (await get(`${url}/api/inspire/implement/diagnostics?${Q}`)).data;
    assert.equal(a.text, b.text);
    assert.deepEqual(a.issue, b.issue);
  });
});

test('Report issue opens a new GitHub issue with the version, the build step and the masked plain error, and never the log', async () => {
  await withApp(STATE, async (url) => {
    const { text, issue } = (await get(`${url}/api/inspire/implement/diagnostics?${Q}`)).data;
    assert.deepEqual(Object.keys(issue), ['title', 'body']);
    assert.doesNotMatch(JSON.stringify({ text, issue }), /https?:\/\/|github\.com/, 'the server answer names no internet host, so the offline App bundle stays clean');
    assert.equal(newIssueUrl(null), 'https://github.com/amralieg/inspire/issues/new');
    const u = new URL(newIssueUrl(issue));
    assert.equal(`${u.origin}${u.pathname}`, 'https://github.com/amralieg/inspire/issues/new');
    assert.deepEqual([...u.searchParams.keys()], ['title', 'body']);
    const title = u.searchParams.get('title');
    const body = u.searchParams.get('body');
    assert.equal(title, 'Build failed at Preview run in Inspire 1.5.0');
    assert.match(body, /^Inspire version: 1\.5\.0\nCloud: unknown\nBuild step: Preview run \(error\)\nError: /);
    assert.match(body, /\nError code: UNRESOLVED_COLUMN\.WITH_SUGGESTION\n/);
    assert.match(body, /column_\d+/);
    for (const logOnly of ['Genie turns', 'relay', 'Steps (', 'run 990000000000003', 'Job id', 'Inspire is working on']) assert.ok(!body.includes(logOnly), `no ${logOnly} in the issue`);
    assert.ok(body.length < 1000);
    assert.ok(text.length > body.length * 3);
  });
});

test('a build with no version yet still answers with the App facts and an issue link', () => {
  const got = buildDiagnostics({ latest: null, history: [], steps: [], feed: [], runs: null, app_status: null }, { host: `https://${['x', 'gcp', 'databricks', 'com'].join('.')}`, useCaseId: 'N02-U03', stamp: {} });
  assert.match(got.text, /Build: Inspire has no build of this use case yet\./);
  assert.match(got.text, /Cloud: GCP/);
  assert.equal(got.filename, 'inspire-diagnostics-N02-U03.txt');
  assert.match(got.issue.title, /^Build issue at start in Inspire unknown$/);
});

test('the cloud comes from the workspace address and the address itself never shows', () => {
  assert.equal(cloudOf(HOST), 'Azure');
  assert.equal(cloudOf(`https://${OTHER_HOST}`), 'AWS');
  assert.equal(cloudOf(['x', 'gcp', 'databricks', 'com'].join('.')), 'GCP');
  assert.equal(cloudOf('localhost:3000'), 'unknown');
  assert.equal(cloudOf(''), 'unknown');
});

test('maskPrivate keeps error codes, versions, file names and plain words, and masks only private text (must-exclude: no over-masking of build facts)', () => {
  const mask = (s, known) => maskPrivate(s, { label: nameLabels(), known });
  assert.equal(mask('[UNRESOLVED_COLUMN.WITH_SUGGESTION] in agent v1.5.0 at check.py: exit 1'), '[UNRESOLVED_COLUMN.WITH_SUGGESTION] in agent v1.5.0 at check.py: exit 1');
  assert.equal(mask("the use case's preview didn't finish"), "the use case's preview didn't finish");
  assert.equal(mask("WHERE x = 'a' AND y >= 10 AND z IN (1, 2)"), "WHERE column_1 = '[value]' AND column_2 >= [value] AND column_3 IN ([values])");
  assert.equal(mask('read `s`.`t` and `c`'), 'read schema_1.table_1 and column_1');
  assert.equal(mask('see /Workspace/Users/someone/nb and /Volumes/a/b/c/log.log'), 'see /Workspace/[path] and /Volumes/[path]');
  assert.equal(mask('Inspire read inspire.x.y', { schema: ['inspire'] }), 'Inspire read catalog_1.schema_1.table_1', 'a lowercase database name never masks the product name');
  assert.equal(mask('the region column', { column: ['region'] }), 'the column_1 column');
  assert.equal(mask('[value] stays', { column: ['value'] }), '[value] stays');
});
