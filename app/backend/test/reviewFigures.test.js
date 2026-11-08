const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../lib/reviewFigures');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const TABLE = '`main`.`inspire`.`__inspire_session`';
const MISSING = (name) => new Error(`[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column, variable, or function parameter with name \`${name}\` cannot be resolved.`);
const Q = 'inspire_database=main.inspire&warehouse_id=wh1';

async function get(base, path) {
  const resp = await fetch(base + path);
  return { status: resp.status, data: await resp.json() };
}

test('the run list counts the runs of each business and ranks them by last update over every run, and a run with no business name stands alone', () => {
  const { sql, parameters } = R.sessionListStatement(TABLE);
  assert.equal(parameters, null, 'the list takes no value from the request');
  assert.match(sql, /^SELECT session_id, processing_status, completed_percent, create_at, last_updated, completed_on, business_name, /);
  const key = "CASE WHEN LOWER(TRIM(COALESCE(business_name, ''))) = '' THEN CONCAT('#', CAST(session_id AS STRING)) ELSE LOWER(TRIM(COALESCE(business_name, ''))) END";
  assert.ok(sql.includes(`CAST(COUNT(*) OVER (PARTITION BY ${key}) AS INT) AS business_runs`), 'an unnamed run is its own group of one');
  assert.ok(sql.includes(`CAST(ROW_NUMBER() OVER (PARTITION BY ${key} ORDER BY COALESCE(last_updated, completed_on, create_at) DESC NULLS LAST, session_id DESC) AS INT) AS business_rank`));
  assert.equal(sql.includes('latest_run'), false, 'the server reports facts; the App decides the label');
  assert.ok(sql.endsWith(`FROM ${TABLE} ORDER BY create_at DESC LIMIT ${R.SESSION_LIST_CAP + 1}`), 'the facts are worked out before the list is cut to 20');
  assert.equal(R.SESSION_LIST_CAP, 20);
  const old = R.sessionListStatement(TABLE, { lastUpdated: false }).sql;
  assert.ok(old.includes('NULL AS last_updated') && old.includes('ORDER BY COALESCE(completed_on, create_at) DESC NULLS LAST, session_id DESC'));
  assert.equal(old.includes('COALESCE(last_updated'), false);
});

test('the run list falls back to the completion time on a session table without last_updated, and reads the counts as whole numbers', async () => {
  const sent = [];
  const rows = [{ session_id: '7', business_runs: '2', business_rank: '1' }, { session_id: '6', business_runs: '2', business_rank: '2' },
    { session_id: '5', business_runs: 'x', business_rank: null }, { session_id: '4', business_runs: '-1', business_rank: '1.5' }];
  const run = async (statement) => {
    sent.push(statement.sql);
    if (statement.sql.includes('COALESCE(last_updated')) throw MISSING('last_updated');
    return rows;
  };
  const got = await R.loadSessionList(run, TABLE);
  assert.equal(sent.length, 2);
  assert.ok(sent[1].includes('NULL AS last_updated'));
  assert.deepEqual(got.sessions.map((s) => [s.session_id, s.business_runs, s.business_rank]), [['7', 2, 1], ['6', 2, 2], ['5', 0, 0], ['4', 0, 0]]);
  assert.equal(got.truncated, false);
  const once = [];
  await R.loadSessionList(async (statement) => { once.push(statement.sql); return []; }, TABLE);
  assert.equal(once.length, 1, 'a table with last_updated is read once');
  await assert.rejects(R.loadSessionList(async () => { throw new Error('PERMISSION_DENIED: no SELECT'); }, TABLE), /PERMISSION_DENIED/,
    'any other error is not hidden behind the fallback');
});

test('the run previews read the name with its technique next to the Name, and a table written before that column keeps the Name', async () => {
  const UC = '`main`.`inspire`.`__inspire_usecases`';
  const fresh = R.sessionPreviewStatement(UC, ['42', '43', '1 OR 1=1']).sql;
  assert.match(fresh, /, name_with_technique, ROW_NUMBER/);
  assert.match(fresh, /AS Name/);
  assert.match(fresh, /session_id IN \(42,43\)/, 'only whole-number ids reach the SQL');
  assert.match(fresh, /z\.rn <= 4/);
  const rows = [
    { session_id: '42', Name: 'Forecast stock', name_with_technique: 'Forecast stock using forecasting', rn: 1 },
    { session_id: '42', Name: 'Spot late suppliers', name_with_technique: '', rn: 2 },
    ...['a', 'b', 'c'].map((n, i) => ({ session_id: '43', Name: n, name_with_technique: null, rn: i + 1 })),
  ];
  const sent = [];
  const old = await R.loadSessionPreviews(async (statement) => {
    sent.push(statement.sql);
    if (!statement.sql.includes('CAST(NULL AS STRING) AS name_with_technique')) throw MISSING('name_with_technique');
    return rows;
  }, UC, ['42', '43']);
  assert.equal(sent.length, 2);
  assert.deepEqual(old['42'], [{ Name: 'Forecast stock', name_with_technique: 'Forecast stock using forecasting' }, { Name: 'Spot late suppliers', name_with_technique: null }]);
  assert.deepEqual(old['43'].map((u) => u.Name), ['a', 'b', 'c']);
  const once = [];
  await R.loadSessionPreviews(async (statement) => { once.push(statement.sql); return []; }, UC, ['42']);
  assert.equal(once.length, 1, 'a table with the column is read once');
  await assert.rejects(R.loadSessionPreviews(async () => { throw new Error('PERMISSION_DENIED: no SELECT'); }, UC, ['42']), /PERMISSION_DENIED/,
    'any other error is not hidden behind the fallback');
});

test('the portfolio reads each table with one aggregate that rolls up per run and in total, bounded and parameterized', () => {
  const uc = R.portfolioUseCaseStatement('`c`.`s`.`__inspire_usecases`');
  assert.match(uc.sql, /GROUP BY ROLLUP \(session_id\) ORDER BY is_total DESC, sid DESC LIMIT 1002$/);
  assert.ok(uc.sql.includes("COUNT(DISTINCT NULLIF(TRIM(business_domain), ''))") && uc.sql.includes("COUNT(DISTINCT NULLIF(TRIM(subdomain), ''))"));
  assert.ok(uc.sql.includes('UPPER(TRIM(best_of_best)) = :starred'));
  assert.deepEqual(uc.parameters, [{ name: 'starred', value: 'Y', type: 'STRING' }]);
  const older = R.portfolioUseCaseStatement('`c`.`s`.`__inspire_usecases`', new Set(['session_id', 'business_domain', 'subdomain']));
  assert.ok(older.sql.includes('CAST(0 AS INT) AS best_of_best') && !older.sql.includes('UPPER(TRIM(best_of_best))'));
  assert.equal(older.parameters, null);

  const mvp = R.portfolioImplementStatement('`c`.`s`.`__inspire_implement`');
  assert.ok(mvp.sql.startsWith('WITH mvp AS (SELECT `session_id` AS session_id, max_by(`status`, `spec_version`) AS latest_status, '));
  assert.ok(mvp.sql.includes('GROUP BY `session_id`, `use_case_id`)'), 'one row per MVP before the roll-up');
  assert.match(mvp.sql, /FROM mvp GROUP BY ROLLUP \(session_id\) ORDER BY is_total DESC, sid DESC LIMIT 1002$/);
  for (const word of [...I.IMPLEMENT_DONE_STATUSES, I.IMPLEMENT_UNINSTALLED, ...I.IMPLEMENT_ACTIVE_STATUSES, 'failed', ...I.IMPLEMENT_STOPPED_STATES]) {
    assert.equal(mvp.sql.includes(`'${word}'`), false, `${word} is a parameter, not text in the SQL`);
  }
  assert.deepEqual(mvp.parameters.map((p) => [p.name, p.value]),
    [['done0', 'ready'], ['done1', 'ready_with_warnings'], ['gone', 'uninstalled'], ['active0', 'queued'], ['active1', 'filling'], ['active2', 'previewing'],
      ['active3', 'building_outputs'], ['active4', 'checking'], ['failed', 'failed'], ['stop0', 'deleted'], ['stop1', 'released']]);
  for (const key of ['mvps_started', 'mvps_live', 'mvps_building', 'mvps_failed', 'apps', 'dashboards', 'genie_spaces', 'alerts']) assert.ok(mvp.sql.includes(` AS ${key}`), key);
  assert.ok(mvp.sql.includes('CAST(SUM(CASE WHEN latest_status IN (:active0, :active1, :active2, :active3, :active4) THEN 1 ELSE 0 END) AS INT) AS mvps_building'),
    'an MVP counts as building only from its newest version');
  assert.ok(mvp.sql.includes('CAST(SUM(CASE WHEN latest_status = :failed THEN 1 ELSE 0 END) AS INT) AS mvps_failed'),
    'an MVP that failed once and was built again counts as built, not failed');
  assert.ok(mvp.sql.includes("CONCAT('inspire:', get_json_object(to_json(`asset_status`), '$.app.hosted.id'))"), 'an App Inside Inspire counts as an App');
  const old = R.portfolioImplementStatement('`c`.`s`.`__inspire_implement`', new Set(['session_id', 'use_case_id', 'spec_version', 'status', 'app_name']));
  for (const gone of ['`alert_id`', '`asset_status`', '`dashboard_id`', '`genie_space_id`']) assert.equal(old.sql.includes(gone), false, gone);
  assert.ok(old.sql.includes('NULLIF(TRIM(NULL), \'\')') && old.sql.includes('`app_name`'));

  const runs = R.portfolioSessionStatement(TABLE);
  assert.equal(runs.sql, `SELECT CAST(COUNT(*) AS INT) AS runs, CAST(COUNT(DISTINCT NULLIF(LOWER(TRIM(COALESCE(business_name, ''))), '')) AS INT) AS businesses FROM ${TABLE}`);
});

test('the portfolio view folds the totals and one row of figures per run, adds the live assets, and caps the runs it lists', () => {
  const view = R.portfolioView({
    runs: { runs: '5', businesses: '3' },
    useCases: [
      { sid: null, is_total: '1', use_cases: '30', domains: '7', subdomains: '12', best_of_best: '6' },
      { sid: '42', is_total: '0', use_cases: '20', domains: '5', subdomains: '9', best_of_best: '4' },
      { sid: '43', is_total: '0', use_cases: '10', domains: '4', subdomains: '6', best_of_best: '2' },
      { sid: 'x1', is_total: '0', use_cases: '99' },
      { sid: null, is_total: '0', use_cases: '99' },
    ],
    mvps: [
      { sid: null, is_total: '1', mvps_started: '4', mvps_live: '2', mvps_building: '1', mvps_failed: '1', apps: '1', dashboards: '2', genie_spaces: '2', alerts: '1' },
      { sid: '42', is_total: '0', mvps_started: '3', mvps_live: '2', mvps_building: '0', mvps_failed: '1', apps: '1', dashboards: '2', genie_spaces: '2', alerts: '1' },
      { sid: '44', is_total: '0', mvps_started: '1', mvps_live: '-3', apps: 'n/a', dashboards: '0', genie_spaces: '0', alerts: '0' },
    ],
    missing: [I.IMPLEMENT_TABLE, 'other', '__inspire_session'],
  });
  assert.deepEqual(view.totals, { businesses: 3, runs: 5, use_cases: 30, domains: 7, subdomains: 12, best_of_best: 6, mvps_started: 4, mvps_live: 2,
    mvps_building: 1, mvps_failed: 1, apps: 1, dashboards: 2, genie_spaces: 2, alerts: 1, live_assets: 6 });
  assert.deepEqual(Object.keys(view.sessions).sort(), ['42', '43', '44'], 'a row with no numeric session id is not a run');
  assert.deepEqual(view.sessions['42'], { use_cases: 20, domains: 5, subdomains: 9, best_of_best: 4, mvps_started: 3, mvps_live: 2, mvps_building: 0, mvps_failed: 1,
    apps: 1, dashboards: 2,
    genie_spaces: 2, alerts: 1, live_assets: 6 });
  assert.equal(view.sessions['43'].mvps_started, 0, 'a run with no MVP has zero MVPs');
  assert.equal(view.sessions['44'].use_cases, 0, 'an MVP of a run with no use case row still shows');
  assert.equal(view.sessions['44'].mvps_live, 0, 'a negative or unreadable count reads as zero');
  assert.equal(view.truncated, false);
  assert.deepEqual(view.missing, ['__inspire_session', I.IMPLEMENT_TABLE], 'only the three tables, in a fixed order');

  const many = Array.from({ length: R.PORTFOLIO_RUN_CAP + 1 }, (_, i) => ({ sid: String(1000 + i), is_total: '0', use_cases: '1' }));
  const capped = R.portfolioView({ useCases: many });
  assert.equal(Object.keys(capped.sessions).length, R.PORTFOLIO_RUN_CAP);
  assert.equal(capped.truncated, true);
  assert.deepEqual(R.portfolioView().totals.live_assets, 0, 'an empty database counts zero everywhere');
});

test('GET /api/inspire/portfolio answers from three aggregate reads however many runs there are, and rejects a bad Inspire database', async () => {
  const runs = Array.from({ length: 40 }, (_, i) => ({ sid: String(500 + i), is_total: '0', use_cases: '3', domains: '1', subdomains: '1', best_of_best: '1' }));
  const { app, sqlCalls } = makeApp({
    portfolioRuns: [{ runs: '40', businesses: '9' }],
    portfolioUseCases: [{ sid: null, is_total: '1', use_cases: '120', domains: '8', subdomains: '20', best_of_best: '40' }, ...runs],
    portfolioMvps: [{ sid: null, is_total: '1', mvps_started: '6', mvps_live: '4', apps: '2', dashboards: '3', genie_spaces: '3', alerts: '1' },
      { sid: '500', is_total: '0', mvps_started: '6', mvps_live: '4', apps: '2', dashboards: '3', genie_spaces: '3', alerts: '1' }],
  });
  const srv = await listen(app);
  try {
    const got = await get(srv.url, `/api/inspire/portfolio?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.totals, { businesses: 9, runs: 40, use_cases: 120, domains: 8, subdomains: 20, best_of_best: 40, mvps_started: 6, mvps_live: 4,
      mvps_building: 0, mvps_failed: 0, apps: 2, dashboards: 3, genie_spaces: 3, alerts: 1, live_assets: 9 });
    assert.equal(Object.keys(got.data.sessions).length, 40);
    assert.equal(got.data.sessions['500'].live_assets, 9);
    assert.deepEqual(got.data.missing, []);
    assert.equal(sqlCalls.length, 3, 'one read per table, never one per run');
    assert.deepEqual(sqlCalls.map((c) => c.sql.match(/`__inspire_\w+`/)[0]).sort(), ['`__inspire_implement`', '`__inspire_session`', '`__inspire_usecases`']);
    for (const bad of ['', 'main', 'a.b.c']) {
      const refused = await get(srv.url, `/api/inspire/portfolio?inspire_database=${encodeURIComponent(bad)}&warehouse_id=wh1`);
      assert.equal(refused.status, 400, bad);
      assert.match(refused.data.error, /inspire_database must be exactly catalog\.schema/);
    }
    assert.equal((await get(srv.url, '/api/inspire/portfolio?inspire_database=main.inspire')).status, 400, 'a warehouse is required');
    assert.equal(sqlCalls.length, 3, 'a refused request reads nothing');
  } finally {
    await srv.close();
  }
});

test('the API reference documents the portfolio route, its figures and the Latest Run fields of the run list', () => {
  const spec = require('js-yaml').load(require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'openapi.yaml'), 'utf8'));
  const route = spec.paths['/api/inspire/portfolio'].get;
  assert.equal(route.responses['200'].content['application/json'].schema.$ref, '#/components/schemas/Portfolio');
  assert.deepEqual(route.parameters.map((p) => p.$ref.split('/').pop()), ['DatabricksHost', 'InspireDatabase', 'WarehouseId']);
  const figures = spec.components.schemas.RunFigures.properties;
  assert.deepEqual(Object.keys(figures), [...R.RUN_FIGURES, 'live_assets']);
  assert.deepEqual(spec.components.schemas.Portfolio.properties.missing.items.enum, R.PORTFOLIO_TABLES);
  const session = spec.components.schemas.SessionSummary.properties;
  assert.equal(session.business_runs.type, 'integer');
  assert.equal(session.business_rank.type, 'integer');
  assert.equal(session.latest_run, undefined);
  assert.equal(session.last_updated.format, 'date-time');
});

test('GET /api/inspire/portfolio counts zero for a table that does not exist yet and reads an older table through its own columns', async () => {
  const { app, sqlCalls } = makeApp({
    sqlErrors: { 'AS businesses FROM': '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`inspire`.`__inspire_session` cannot be found.',
      'UPPER(TRIM(best_of_best))': MISSING('best_of_best').message },
    useCaseColumns: ['session_id', 'business_domain', 'subdomain'],
    implementColumns: ['session_id', 'use_case_id', 'spec_version', 'status', 'app_name', 'dashboard_id', 'genie_space_id'],
    portfolioUseCases: [{ sid: null, is_total: '1', use_cases: '12', domains: '3', subdomains: '5', best_of_best: '0' }],
    portfolioMvps: [{ sid: null, is_total: '1', mvps_started: '2', mvps_live: '1', apps: '1', dashboards: '1', genie_spaces: '0', alerts: '0' }],
  });
  const srv = await listen(app);
  try {
    const got = await get(srv.url, `/api/inspire/portfolio?${Q}`);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(got.data.missing, ['__inspire_session']);
    assert.equal(got.data.totals.runs, 0);
    assert.equal(got.data.totals.use_cases, 12);
    assert.equal(got.data.totals.live_assets, 2);
    const sqls = sqlCalls.map((c) => c.sql);
    assert.equal(sqls.filter((s) => s.startsWith('DESCRIBE TABLE')).length, 2, 'each older table is described once');
    const mvp = sqls.filter((s) => s.includes('GROUP BY ROLLUP') && s.includes('__inspire_implement'));
    assert.equal(mvp.length, 2, 'the MVP read is retried once with the columns the table has');
    assert.equal(mvp[1].includes('`alert_id`') || mvp[1].includes('`asset_status`'), false);
  } finally {
    await srv.close();
  }
});
