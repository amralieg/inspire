const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { EventEmitter } = require('node:events');
const I = require('../lib/inspireImplement');
const H = require('../lib/hostedRun');
const A = require('../lib/useCaseAlerts');
const { appShellPayload, bundledAppShellText } = require('../lib/appShell');
const { makeApp, listen } = require('./support/implementApp');
const { fakePageChild } = require('./support/hostedShell');
const { AlertsWorkspace, RULES_MISSING, realAlerts, rulesRun, shellCompareWords } = require('./support/alertsWorkspace');

const OWNER = ['owner', 'example.com'].join('@');
const SAM = ['sam.ray', 'example.com'].join('@');
const LEE = ['lee.kim', 'example.com'].join('@');
const PERSON = 'person-token';
const SAM_TOKEN = 'sam-token';
const SP = 'tok';
const MVP = '/Workspace/Users/someone/acme/session_42/Sales/N01-U01/mvp';
const FOLDER = `${MVP}/alerts/n01_u01`;
const TABLE = 'main.inspire.churn_out';
const APP_URL = 'https://churn-desk-1.aws.databricksapps.com';
const DASHBOARD = 'https://workspace.example.com/dashboardsv3/d1/published';
const APP_SOURCE = `${MVP}/apps/churn-desk`;
const APP_FOLDER = `${MVP}/alerts/churn-desk`;
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const ROWS_TO_ACT = { what: 'records', filters: { tier: ['Act now'] }, operator: '>=', threshold: 5, basis: 'fixed' };
const COLUMNS = [['record_key', 'STRING'], ['entity_id', 'STRING'], ['priority_tier', 'STRING'], ['rank', 'INT'], ['value_at_stake', 'DOUBLE'],
  ['region', 'STRING'], ['use_case_id', 'STRING'], ['run_id', 'STRING'], ['as_of_date', 'DATE'], ['valid_from', 'TIMESTAMP'], ['valid_to', 'TIMESTAMP'],
  ['is_current', 'BOOLEAN'], ['change_source', 'STRING'], ['changed_by', 'STRING']];
const SCHEMA = { manifest: { schema: { columns: COLUMNS.map(([name, kind]) => ({ name, type_name: kind, type_text: kind })) } }, result: { data_array: [] } };
const TIERS = { manifest: { schema: { columns: [{ name: 'v', type_name: 'STRING' }] } }, result: { data_array: [['Act now'], ['Monitor'], ['Review']] } };
const NOW = { manifest: { schema: { columns: [{ name: 'watched_value', type_name: 'LONG', type_text: 'BIGINT' }] } }, result: { data_array: [['3']] } };
const REGIONS = { manifest: TIERS.manifest, result: { data_array: [['East'], ['West']] } };
const STATEMENTS = {
  'SELECT * FROM `main`.`inspire`.`churn_out` LIMIT 0': SCHEMA,
  'SELECT DISTINCT CAST(': (sql) => (sql.includes('`priority_tier`') ? TIERS : REGIONS),
  'WITH latest AS': NOW,
};
const skip = RULES_MISSING || false;

function spec(outputs = {}, config = {}) {
  const out = I.validateImplementSpec(I.withInspireUrl({
    use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: TABLE },
    data: { column_roles: { segment: 'main.sales.customers.region' } }, outputs: { dashboard: true },
  }, 'https://inspire.example.com'));
  assert.deepEqual(out.errors, []);
  return { ...out.spec, config: { ...out.spec.config, ...config }, outputs: { dashboard: true, ...outputs } };
}

const builtRow = ({ outputs = {}, config = {}, assets = {}, ...extra } = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: 3, status: 'ready', created_by: OWNER, updated_at: '2026-10-31T04:00:00Z',
  spec_json: JSON.stringify(spec(outputs, config)), notebook_path: `${MVP}/v3/N01-U01 Predict churn`, job_id: '77',
  asset_status: JSON.stringify({ notebook: { state: 'ready', spec_version: 3 }, ...assets }), ...extra,
});

function workspace(extra = {}) {
  return new AlertsWorkspace({ users: [OWNER, SAM, LEE], tokens: { [PERSON]: OWNER, [SAM_TOKEN]: SAM, [SP]: 'inspire-sp' }, ...extra });
}

const ME = { 'x-forwarded-access-token': PERSON, 'x-forwarded-email': OWNER };

async function withAlerts(overrides, run) {
  const ws = overrides.ws || workspace();
  const made = makeApp({ history: [builtRow()], statements: STATEMENTS, useCaseAlerts: realAlerts(), workspace: (call) => ws.handle(call), ...overrides });
  const srv = await listen(made.app);
  try {
    await run(srv.url, made, ws);
  } finally {
    await srv.close();
  }
}

async function send(base, step, body, headers = ME) {
  const resp = await fetch(`${base}/api/inspire/implement/alerts/${step}?${Q}`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  });
  return { status: resp.status, data: await resp.json() };
}

async function listed(base, headers = ME) {
  const resp = await fetch(`${base}/api/inspire/implement/alerts?${Q}`, { headers });
  return { status: resp.status, data: await resp.json() };
}

const newAlert = (extra = {}) => ({ name: '', watch: ROWS_TO_ACT, schedule: 'daily', emails: [OWNER, SAM], ...extra });

test('Add alert on a use case with no App plans the alert with the App shell rules and creates it in Databricks as the signed-in person', { skip }, async () => {
  const useCase = { id: 'N01-U01', solution: 'Call the riskiest accounts first',
    elite_assessment: JSON.stringify({ decision: 'Call at-risk customers', decision_owner: 'Retention lead' }) };
  await withAlerts({ useCase, history: [builtRow({ dashboard_url: DASHBOARD })] }, async (base, made, ws) => {
    const first = await listed(base);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.deepEqual([first.data.source, first.data.folder, first.data.person, first.data.can_add, first.data.alerts], ['result', FOLDER, OWNER, true, []]);
    assert.deepEqual(first.data.measures.map((m) => m.id), ['records', 'total_value_at_stake']);
    assert.deepEqual(first.data.filters, [{ id: 'tier', label: 'Tier', options: ['Act now', 'Monitor', 'Review'], error: '' },
      { id: 'segment_region', label: 'Region', options: ['East', 'West'], error: '' }]);
    assert.equal(first.data.built_alert, null);
    const reads = made.sqlCalls.filter((c) => c.sql.includes('LIMIT 0') || c.sql.includes('SELECT DISTINCT'));
    assert.ok(reads.length >= 3 && reads.every((c) => c.token === PERSON && c.warehouse === 'wh1'), 'the result table is read as the person');
    const out = await send(base, 'save', newAlert());
    assert.equal(out.status, 200, JSON.stringify(out.data));
    assert.deepEqual([out.data.alert.by, out.data.alert.rule, out.data.alert.scope, out.data.alert.can_change, out.data.alert.emails],
      [OWNER, 'Records on the list are at least 5', 'Tier: Act now', true, [OWNER, SAM]]);
    const mkdirs = ws.calls.findIndex((c) => c.path === '/api/2.0/workspace/mkdirs');
    const posted = ws.calls.findIndex((c) => c.method === 'POST' && c.path === '/api/2.0/alerts');
    assert.ok(mkdirs >= 0 && mkdirs < posted && ws.calls[mkdirs].token === SP && ws.calls[mkdirs].body.path === FOLDER);
    const body = ws.calls[posted].body;
    assert.equal(ws.calls[posted].token, PERSON, 'the alert is created with the person token, so it belongs to them');
    assert.equal(ws.alerts[out.data.alert.id].owner_user_name, OWNER);
    assert.deepEqual([body.parent_path, body.warehouse_id, body.evaluation.comparison_operator, body.evaluation.threshold],
      [FOLDER, 'wh1', 'GREATER_THAN_OR_EQUAL', { value: { double_value: 5 } }]);
    assert.match(body.display_name, /^Records on the list are at least 5 \([0-9a-f]{6}\)$/, 'a blank name is the rule');
    assert.deepEqual(body.evaluation.notification.subscriptions, [{ user_email: OWNER }, { user_email: SAM }]);
    assert.ok(body.query_text.includes("FROM `main`.`inspire`.`churn_out` WHERE is_current AND change_source <> 'delete'"), 'the latest run only');
    assert.ok(body.query_text.includes("CAST(`priority_tier` AS STRING) IN ('Act now')"));
    assert.deepEqual(body.schedule, { quartz_cron_schedule: '0 0 8 * * ?', timezone_id: 'UTC', pause_status: 'UNPAUSED' });
    const runbook = body.custom_description.split('\n');
    assert.deepEqual(runbook.slice(0, 4), ['What fired: Records on the list on Predict churn are at least 5, counting only Tier: Act now.',
      `Why this threshold: 5 is the number ${OWNER} set for this alert in the App.`, 'How often it checks: every day at 08:00 UTC.', 'What to do first:']);
    assert.ok(runbook.includes('2. Retention lead decides: Call at-risk customers.') && runbook.includes('3. How the use case acts on it: Call the riskiest accounts first.'),
      'what to do first comes from the use case row, never invented');
    assert.ok(runbook.includes(`Dashboard: ${DASHBOARD}`) && runbook.includes('When it clears: you get one more email when it returns to OK.'));
    assert.deepEqual(ws.writes().map((c) => c.token), [PERSON], 'the service principal writes no alert');
    const again = await listed(base);
    assert.deepEqual(again.data.alerts.map((a) => [a.id, a.by, a.state]), [[out.data.alert.id, OWNER, 'unknown']]);
    assert.deepEqual(again.data.caps, { app: 20, person: 10, used: 1, mine: 1 });
  });
});

test('edit, pause, resume and delete go to Databricks with the person token, and only the creator or an owner of the MVP may change one', { skip }, async () => {
  await withAlerts({ history: [builtRow({ created_by: LEE })] }, async (base, _made, ws) => {
    const id = (await send(base, 'save', newAlert({ name: 'Act now grows' }))).data.alert.id;
    const edited = await send(base, 'save', newAlert({ id, name: 'Act now doubles', watch: { ...ROWS_TO_ACT, threshold: 10 }, schedule: 'hourly', emails: [OWNER] }));
    assert.equal(edited.status, 200, JSON.stringify(edited.data));
    const patch = ws.calls.filter((c) => c.method === 'PATCH').pop();
    assert.deepEqual([patch.token, patch.params.update_mask], [PERSON, 'display_name,query_text,custom_summary,custom_description,evaluation,schedule']);
    assert.equal(ws.alerts[id].schedule.quartz_cron_schedule, '0 0 * * * ?');
    const paused = await send(base, 'pause', { id, paused: true });
    assert.deepEqual([paused.status, paused.data.alert.state, ws.alerts[id].schedule.pause_status], [200, 'paused', 'PAUSED']);
    const resumed = await send(base, 'pause', { id, paused: false });
    assert.deepEqual([resumed.status, ws.alerts[id].schedule.pause_status], [200, 'UNPAUSED']);
    const sam = { 'x-forwarded-access-token': SAM_TOKEN, 'x-forwarded-email': SAM };
    for (const [step, body] of [['pause', { id, paused: true }], ['delete', { id }], ['save', newAlert({ id })]]) {
      const refused = await send(base, step, body, sam);
      assert.equal(refused.status, 403, step);
      assert.match(refused.data.error, /^only the person who set up this alert/);
    }
    const lee = await send(base, 'pause', { id, paused: true }, { 'x-forwarded-access-token': 'lee-token', 'x-forwarded-email': LEE });
    assert.equal(lee.status, 200, 'the person who built the MVP may change any alert of it');
    const gone = await send(base, 'delete', { id });
    assert.deepEqual([gone.status, gone.data, ws.alerts[id].lifecycle_state], [200, { deleted: id }, 'DELETED']);
    assert.deepEqual(ws.writes().map((c) => [c.method, c.token]),
      [['POST', PERSON], ['PATCH', PERSON], ['PATCH', PERSON], ['PATCH', PERSON], ['PATCH', 'lee-token'], ['DELETE', PERSON]]);
    assert.deepEqual((await listed(base)).data.alerts, []);
  });
});

test('the person turns off the email an alert sends when it clears, an edit keeps what they chose, and the built alert shows its own choice', { skip }, async () => {
  const built = builtRow({ alert_id: 'al-1', alert_url: 'https://workspace.example.com/sql/alerts-v2/al-1', outputs: { alert: true, alert_name: 'Churn rows' },
    assets: { alert: { state: 'ready', spec_version: 3, trigger: 'Act now rows in the latest run are at least 1' } } });
  await withAlerts({ history: [built] }, async (base, _made, ws) => {
    ws.alerts['al-1'] = { id: 'al-1', display_name: 'Churn rows', lifecycle_state: 'ACTIVE', parent_path: MVP,
      evaluation: { state: 'OK', notification: { notify_on_ok: false, subscriptions: [] } }, schedule: { pause_status: 'UNPAUSED' } };
    const first = await listed(base);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.equal(first.data.built_alert.notify_on_ok, false, 'the built alert says it sends no email when it clears');
    ws.alerts['al-1'].evaluation.notification.notify_on_ok = true;
    assert.equal((await listed(base)).data.built_alert.notify_on_ok, true);
    const posted = () => ws.calls.filter((c) => c.method === 'POST' && c.path === '/api/2.0/alerts').pop().body;
    const patched = () => ws.calls.filter((c) => c.method === 'PATCH').pop().body;
    const plain = await send(base, 'save', newAlert({ name: 'Default' }));
    assert.deepEqual([plain.status, plain.data.alert.notify_on_ok, posted().evaluation.notification.notify_on_ok], [200, true, true], 'on unless the person turns it off');
    const out = await send(base, 'save', newAlert({ name: 'Quiet', notify_on_ok: false }));
    assert.equal(out.status, 200, JSON.stringify(out.data));
    assert.deepEqual([out.data.alert.notify_on_ok, posted().evaluation.notification.notify_on_ok], [false, false]);
    assert.ok(posted().custom_description.includes('When it clears: it sends no email, and you hear from it again only the next time it fires.'));
    const id = out.data.alert.id;
    const kept = await send(base, 'save', newAlert({ id, name: 'Quiet renamed' }));
    assert.deepEqual([kept.status, kept.data.alert.notify_on_ok, patched().evaluation.notification.notify_on_ok], [200, false, false],
      'an edit that does not send the choice keeps what the person chose');
    const back = await send(base, 'save', newAlert({ id, name: 'Quiet renamed', notify_on_ok: true }));
    assert.deepEqual([back.status, back.data.alert.notify_on_ok, ws.alerts[id].evaluation.notification.notify_on_ok], [200, true, true]);
    assert.ok(ws.alerts[id].custom_description.includes('When it clears: you get one more email when it returns to OK.'));
    const refused = await send(base, 'save', newAlert({ id, notify_on_ok: 'no' }));
    assert.equal(refused.status, 400);
    assert.match(refused.data.error, /^notify_on_ok takes true or false/);
    const rows = (await listed(base)).data.alerts;
    assert.deepEqual(rows.map((a) => [a.name, a.notify_on_ok]).sort(), [['Default', true], ['Quiet renamed', true]]);
  });
});

test('without the forwarded user token or email Inspire writes nothing and says what to do', async () => {
  const ws = workspace();
  await withAlerts({ ws }, async (base) => {
    const noToken = { 'x-forwarded-email': OWNER };
    for (const [step, body] of [['save', newAlert()], ['pause', { id: '1', paused: true }], ['delete', { id: '1' }], ['preview', { watch: ROWS_TO_ACT }]]) {
      const out = await send(base, step, body, noToken);
      assert.deepEqual([out.status, out.data.error], [401, A.ALERT_TEXT.noSignIn], step);
    }
    const list = await listed(base, noToken);
    assert.deepEqual([list.status, list.data.why, list.data.can_add, list.data.unavailable, list.data.alerts], [200, A.ALERT_TEXT.noSignIn, false, true, []],
      'the result table is read only as the person, and the tab says why it lists nothing');
    const out = await send(base, 'save', newAlert(), { 'x-forwarded-access-token': PERSON });
    assert.deepEqual([out.status, out.data.error], [401, A.ALERT_TEXT.noEmail]);
  });
  assert.deepEqual(ws.calls, [], 'no Databricks call at all without the person');
  assert.doesNotMatch(Object.values(A.ALERT_TEXT).join(' '), /\u2014|\u2013/);
});

test('each Databricks refusal gets its own plain message and nothing half saved', { skip }, async () => {
  const cases = [
    [{ 'POST /api/2.0/alerts': [{ error_code: 'PERMISSION_DENIED', message: 'User does not have CAN_EDIT on the folder' }, 403] }, {}, 403,
      `Databricks did not let you create the alert: User does not have CAN_EDIT on the folder. Ask the owner of the MVP or a workspace admin for Can Edit on the alerts folder ${FOLDER}, or for Can Manage on the alert.`],
    [{ 'POST /api/2.0/alerts': [{ error_code: 'FEATURE_DISABLED', message: 'Alerts V2 is not enabled for this workspace' }, 400] }, {}, 409, A.ALERT_TEXT.off],
    [{ 'POST /api/2.0/alerts': [{ error_code: 'PERMISSION_DENIED', message: 'Provided OAuth token does not have required scopes: sql' }, 403] }, {}, 403,
      A.ALERT_TEXT.scope],
    [{ 'POST /api/2.0/alerts': [{ error_code: 'INVALID_PARAMETER_VALUE', message: 'Warehouse wh1 does not exist or you lack access' }, 404] }, {}, 409,
      'Databricks did not create the alert because of the SQL warehouse wh1: Warehouse wh1 does not exist or you lack access. You need Can Use on it, and it must still exist.'],
    [{ 'POST /api/2.0/workspace/mkdirs': [{ error_code: 'PERMISSION_DENIED', message: 'no access' }, 403] }, {}, 503,
      `Inspire could not make the alerts folder ${FOLDER}: no access`],
    [{}, { emails: ['nobody@example.com'] }, 400, 'nobody@example.com is not a user of this workspace; alerts go only to workspace users'],
    [{}, { watch: { ...ROWS_TO_ACT, threshold: -1 } }, 400, 'Records on the list counts rows, so it is never below 0; set a threshold of 0 or more'],
    [{}, { watch: { ...ROWS_TO_ACT, threshold: 2.5 } }, 400, 'Records on the list counts rows, so set a whole number as the threshold'],
    [{}, { emails: [] }, 400, 'add at least one email address to send the alert to'],
    [{}, { schedule: 'monthly' }, 400, 'check the alert hourly, daily or weekly'],
  ];
  assert.equal(A.ALERT_TEXT.scope, 'Inspire saves alerts as you, and your sign-in to Inspire does not allow Databricks SQL. '
    + 'Ask a workspace admin to add the sql scope to the user authorization of the Inspire App, then open Inspire again.', 'it names the scope to ask for');
  for (const [fail, extra, status, message] of cases) {
    const ws = workspace({ fail });
    await withAlerts({ ws }, async (base) => {
      const out = await send(base, 'save', newAlert(extra));
      assert.deepEqual([out.status, out.data.error], [status, message], JSON.stringify(fail));
      assert.deepEqual(Object.keys(ws.alerts), []);
    });
  }
  await withAlerts({ history: [builtRow({ config: { warehouse_id: '' } })] }, async (base) => {
    const out = await send(base, 'save', newAlert());
    assert.deepEqual([out.status, out.data.error], [409, A.ALERT_TEXT.noWarehouse]);
  });
  await withAlerts({ ws: workspace({ fail: { 'GET /api/2.0/workspace/list': [{ error_code: 'PERMISSION_DENIED', message: 'no read' }, 403] } }) }, async (base) => {
    const out = await listed(base);
    assert.deepEqual([out.status, out.data.why, out.data.can_add], [200, `Inspire cannot read the alerts folder ${FOLDER}: no read`, false]);
  });
  await withAlerts({ history: [builtRow({ status: 'building_outputs' })] }, async (base) => {
    assert.deepEqual((await listed(base)).data.why, A.ALERT_TEXT.notBuilt);
    const bad = await fetch(`${base}/api/inspire/implement/alerts?inspire_database=main.inspire&warehouse_id=wh1&session_id=x&use_case_id=N01-U01`, { headers: ME });
    assert.equal(bad.status, 400, 'a malformed request is still refused');
  });
});

test('Check the value now reads only the latest run, as the person, on the warehouse of the use case', { skip }, async () => {
  await withAlerts({}, async (base, made, ws) => {
    const out = await send(base, 'preview', { watch: ROWS_TO_ACT });
    assert.deepEqual([out.status, out.data], [200, { ...shellCompareWords(), value: 3, fires: false, threshold: 5, basis: 'fixed', history_runs: null }]);
    const ran = made.sqlCalls.find((c) => c.sql.startsWith('WITH latest AS'));
    assert.deepEqual([ran.token, ran.warehouse], [PERSON, 'wh1']);
    assert.ok(ran.sql.includes("WHERE is_current AND change_source <> 'delete'"));
    assert.deepEqual(ws.writes(), [], 'a check saves nothing');
    const bad = await send(base, 'preview', { watch: { ...ROWS_TO_ACT, what: 'nope' } });
    assert.deepEqual([bad.status, bad.data.error], [400, "the page has no KPI 'nope' to watch"]);
  });
  await withAlerts({ sqlErrors: { 'WITH latest AS': 'SQL failed (403): {"error_code":"PERMISSION_DENIED","message":"no CAN_USE on warehouse wh1"}' } }, async (base) => {
    const out = await send(base, 'preview', { watch: ROWS_TO_ACT });
    assert.equal(out.status, 409);
    assert.match(out.data.error, /^Inspire could not check the value on the SQL warehouse wh1 as you: .*You need Can Use on it\.$/);
  });
});

function hubPage() {
  return {
    version: 1, id: 'n01_u01', use_case_id: 'N01-U01', title: 'Churn desk', result_table: TABLE,
    datasets: [{ name: 'records', sql: `SELECT * FROM ${TABLE} WHERE is_current AND change_source <> 'delete'` }],
    filters: [{ id: 'region', type: 'multi_select', label: 'Region', columns: { records: 'region' } }],
    kpis: [{ id: 'at_stake', label: 'At stake', dataset: 'records', expression: 'SUM(value_at_stake)', format: 'currency', currency: 'USD' }],
    records: { tier: 'priority_tier', rank: 'rank' },
  };
}

test('a use case with its own App lists the alerts people set up in that App and adds new ones to the same folder, so the App shows them too', { skip }, async () => {
  const ws = workspace({
    folders: [APP_FOLDER], apps: { 'churn-desk': { name: 'churn-desk', active_deployment: { source_code_path: APP_SOURCE } } },
    files: { [`${APP_SOURCE}/inspire_app.json`]: { options: { alerts: true }, alert_folder: APP_FOLDER, admin: LEE, auth: 'sp' },
      [`${APP_SOURCE}/pages/n01_u01.json`]: hubPage() },
  });
  const inApp = await rulesRun('save', { page: hubPage(), data: { name: 'Sam watches the money', watch: { what: 'at_stake', filters: { region: ['West'] },
    operator: '>', threshold: 1000, basis: 'fixed' }, schedule: 'weekly', emails: [SAM] }, person: SAM, alerts: [], warehouse: 'wh1', link: '', folder: APP_FOLDER });
  const theirs = ws.add({ ...inApp.body, owner_user_name: 'app-sp' });
  const history = [builtRow({ created_by: LEE, outputs: { app: true, app_name: 'churn-desk', app_access: 'sp' }, app_name: 'churn-desk', app_url: APP_URL,
    assets: { app: { state: 'ready', spec_version: 3 } } })];
  await withAlerts({ ws, history }, async (base) => {
    const first = await listed(base);
    assert.equal(first.status, 200, JSON.stringify(first.data));
    assert.deepEqual([first.data.source, first.data.folder], ['app', APP_FOLDER]);
    assert.deepEqual(first.data.measures.map((m) => m.id), ['records', 'at_stake'], 'the measures of the App page, not a second guess');
    const [row] = first.data.alerts;
    assert.deepEqual([row.id, row.by, row.can_change, row.emails, row.owner_user_name, row.rule, row.scope],
      [theirs.id, SAM, false, [], 'app-sp', 'At stake is more than 1,000', 'Region: West']);
    const out = await send(base, 'save', newAlert({ watch: { what: 'records', filters: {}, operator: '>=', threshold: 1, basis: 'fixed' } }));
    assert.equal(out.status, 200, JSON.stringify(out.data));
    const body = ws.alerts[out.data.alert.id];
    assert.deepEqual([body.parent_path, body.owner_user_name], [APP_FOLDER, OWNER]);
    assert.ok(body.custom_description.includes(`Where to look:\nApp: ${APP_URL}/#/n01_u01\n`), body.custom_description);
    const lee = await listed(base, { 'x-forwarded-access-token': 'lee-token', 'x-forwarded-email': LEE });
    assert.equal(lee.data.admin, true, 'the admin of the App may change every alert in it');
    assert.deepEqual(lee.data.alerts.map((a) => a.can_change), [true, true]);
  });
});

async function shellLike() {
  const server = http.createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    if (req.url === '/api/app') {
      res.end(JSON.stringify({ title: 'Churn desk', auth: 'user', options: { modify: false, alerts: false },
        alerting: { on: false, reason: 'This App shows each person only their own data, so it sends no alerts' } }));
    } else {
      res.end(JSON.stringify({ ok: true, url: req.url }));
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return { port: server.address().port, close: () => new Promise((resolve) => server.close(resolve)) };
}

test('the Run tab page turns its Alerts view on and saves through the same rules and folder as the Build page, as the person', { skip }, async () => {
  const record = { id: 'n01-u01-42', source: `${MVP}/apps/n01-u01-42/v3`, version: 3, warehouse_id: 'wh2', page: 'n01_u01', published_at: '2026-10-31T05:00:00Z' };
  const hostedFolder = `${MVP}/alerts/n01-u01-42`;
  const ws = workspace({ files: { [`${record.source}/inspire_app.json`]: { auth: 'user', host: 'inspire', options: { alerts: false } },
    [`${record.source}/pages/n01_u01.json`]: hubPage() } });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-alerts-'));
  const up = await shellLike();
  const hosted = H.createHostedRun({
    spawn: () => fakePageChild(up.port), pickPython: async () => '/opt/venv/bin/python3', tmpRoot: tmp, env: { PATH: '/usr/bin' },
    checkHealth: async () => true, pause: async () => {},
    files: () => ({
      async list(folder) { return folder === record.source ? [{ path: `${record.source}/app.py`, object_type: 'FILE' }] : []; },
      async read() { return Buffer.from('app'); },
    }),
  });
  const history = [builtRow({ outputs: { app: true, app_placement: 'inspire', app_access: 'user', app_warehouse_id: 'wh2' },
    assets: { app: { state: 'ready', spec_version: 3, placement: 'inspire', hosted: record } } })];
  const mount = (app) => app.all('/run/:id/{*rest}', (req, _res, next) => { req.dbHost = 'https://workspace.example.com'; req.dbToken = SP; next(); },
    hosted.proxy);
  try {
    const made = makeApp({ history, statements: STATEMENTS, useCaseAlerts: realAlerts(), workspace: (call) => ws.handle(call), hostedRun: hosted }, { mount });
    const srv = await listen(made.app);
    try {
      hosted.setListed([{ kind: 'inspire', id: record.id, hosted: record, owners: [OWNER], session_id: '42', use_case_id: 'N01-U01' }],
        { key: 'db', warehouseId: 'wh1', catalog: 'main', schema: 'inspire' });
      const me = ME;
      const info = await (await fetch(`${srv.url}/run/${record.id}/api/app`, { headers: me, signal: AbortSignal.timeout(20000) })).json();
      assert.deepEqual([info.alerting, info.options.alerts, info.title], [{ on: true, reason: '' }, true, 'Churn desk']);
      const got = await fetch(`${srv.url}/run/${record.id}/api/alerts?page=n01_u01`, { headers: me });
      const listing = await got.json();
      assert.equal(got.status, 200, JSON.stringify(listing));
      assert.deepEqual([listing.source, listing.folder, listing.measures.map((m) => m.id)], ['inside', hostedFolder, ['records', 'at_stake']]);
      assert.deepEqual(listing.operators, ['>=', '>', '=', '!=', '<', '<='], 'the contract the shell Alerts form reads');
      const saved = await fetch(`${srv.url}/run/${record.id}/api/alerts/save`, { method: 'POST', headers: { ...me, 'Content-Type': 'application/json' },
        body: JSON.stringify({ page: 'n01_u01', name: 'Region West grows', watch: { what: 'records', filters: { region: ['West'] }, operator: '>', threshold: 2,
          basis: 'fixed' }, schedule: 'daily', emails: [OWNER] }) });
      const alert = (await saved.json()).alert;
      assert.equal(saved.status, 200);
      assert.deepEqual([ws.alerts[alert.id].parent_path, ws.alerts[alert.id].owner_user_name, ws.alerts[alert.id].warehouse_id], [hostedFolder, OWNER, 'wh2']);
      const wrong = await fetch(`${srv.url}/run/${record.id}/api/alerts?page=other`, { headers: me });
      assert.deepEqual([wrong.status, (await wrong.json()).error], [404, "the App has no page 'other'"]);
      const noToken = await fetch(`${srv.url}/run/${record.id}/api/alerts?page=n01_u01`, { headers: { 'x-forwarded-email': OWNER } });
      assert.equal(noToken.status, 401, 'no forwarded token never reaches the alerts');
      const build = await (await fetch(`${srv.url}/api/inspire/implement/alerts?${Q}`, { headers: me })).json();
      assert.deepEqual(build.alerts.map((a) => [a.id, a.name, a.by]), [[alert.id, 'Region West grows', OWNER]], 'one list on the Build page and in the Run tab');
    } finally {
      await srv.close();
    }
  } finally {
    hosted.stopAll();
    await up.close();
    fs.rmSync(tmp, { recursive: true, force: true });
  }
});

test('the alert step copies every App shell module its rules import, so a module added to the shell never breaks alerts', () => {
  const shell = appShellPayload(bundledAppShellText()).files;
  const uncopied = (copied) => {
    const missing = [];
    const seen = new Set();
    const visit = (name) => {
      if (seen.has(name)) return;
      seen.add(name);
      assert.equal(typeof shell[name], 'string', `the bundled App shell has ${name}`);
      for (const [, dep] of shell[name].matchAll(/^(?:import|from)\s+(shell_\w+)/gm)) {
        if (!copied.includes(`${dep}.py`)) missing.push(`${name} imports ${dep}.py`);
        visit(`${dep}.py`);
      }
    };
    visit('shell_alerts.py');
    return [...new Set(missing)];
  };
  assert.deepEqual(uncopied(A.ALERT_RULE_FILES), []);
  assert.deepEqual(uncopied(A.ALERT_RULE_FILES.filter((name) => name !== 'shell_facts.py')), ['shell_sql.py imports shell_facts.py'],
    'a module the rules import but the step does not copy is caught');
  assert.deepEqual(uncopied(A.ALERT_RULE_FILES.filter((name) => name !== 'shell_redact.py')),
    ['shell_sql.py imports shell_redact.py', 'shell_db.py imports shell_redact.py'], 'and so is one imported from two places');
});

test('the alert steps run in a plain Python process with no token in its environment and stop after the timeout', async () => {
  const seen = [];
  const rules = A.createAlertRules({
    files: () => ({ 'shell_alerts.py': 'def cli():\n    pass\n', 'shell_sql.py': '', 'shell_facts.py': '', 'shell_db.py': '', 'shell_redact.py': '' }),
    tmpRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'alert-rules-unit-')),
    env: { PATH: '/usr/bin', DATABRICKS_TOKEN: 'never', DATABRICKS_CLIENT_SECRET: 'never' },
    pickPython: async () => '/usr/bin/python3',
    timeoutMs: 50,
    spawn: (cmd, args, opts) => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      child.stdin = { on() {}, end(text) { seen.push({ cmd, args, opts, text }); } };
      child.kill = () => setImmediate(() => child.emit('close', null));
      return child;
    },
  });
  await assert.rejects(rules.run('listing', { page: {} }), (err) => err.statusCode === 504 && /stopped planning the alert/.test(err.message));
  const [{ cmd, args, opts, text }] = seen;
  assert.equal(cmd, '/usr/bin/python3');
  assert.deepEqual(args.slice(0, 4), ['-B', '-E', '-s', '-c']);
  assert.deepEqual(Object.keys(opts.env).sort(), ['LANG', 'PATH'], 'Python plans the alert and never sees a token');
  assert.deepEqual(JSON.parse(text), { v: 1, op: 'listing', args: { page: {} } });
  const old = A.createAlertRules({ files: () => ({ 'shell_alerts.py': 'class Alerts:\n    pass\n', 'shell_sql.py': '', 'shell_facts.py': '', 'shell_db.py': '', 'shell_redact.py': '' }),
    tmpRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'alert-rules-old-')), pickPython: async () => '/usr/bin/python3' });
  await assert.rejects(old.run('listing', {}), (err) => err.statusCode === 503 && err.message === A.ALERT_TEXT.noRules);
});

test('the folder of a use case is the App folder when its App sends alerts, else the alerts folder next to the MVP versions', () => {
  assert.equal(A.mvpDir({ notebook_path: `${MVP}/v12/N01-U01 Predict churn` }, null), MVP);
  assert.equal(A.mvpDir({ notebook_path: '/odd/path' }, { source: `${MVP}/apps/n01-u01-42/v3` }), MVP);
  assert.equal(A.mvpDir({ notebook_path: '' }, null), '');
  assert.equal(A.appAlertFolder({ options: { alerts: true }, alert_folder: APP_FOLDER }), APP_FOLDER);
  assert.equal(A.appAlertFolder({ options: { alerts: false }, alert_folder: APP_FOLDER }), '');
  assert.throws(() => A.alertBase([], 'N01-U01'), (err) => err.statusCode === 409 && err.message === A.ALERT_TEXT.notBuilt);
  const base = A.alertBase([I.parseImplementRow(builtRow({ alert_id: 'al-1', alert_url: 'https://workspace.example.com/sql/alerts-v2/al-1',
    outputs: { alert: true, alert_name: 'Churn rows' }, assets: { alert: { state: 'ready', spec_version: 3, trigger: 'Act now rows in the latest run are at least 1' } } }))],
  'N01-U01');
  assert.deepEqual(base.built, { id: 'al-1', url: 'https://workspace.example.com/sql/alerts-v2/al-1', name: 'Churn rows',
    trigger: 'Act now rows in the latest run are at least 1' });
  assert.deepEqual([base.segments, base.owners, base.warehouse, base.mvp], [['region'], [OWNER], 'wh1', MVP]);
  assert.deepEqual(A.personOf({ headers: { 'x-forwarded-access-token': 'Bearer abc', 'x-forwarded-email': ` ${OWNER} ` } }), { token: 'abc', email: OWNER });
});
