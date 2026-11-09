const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const APP_TOKEN = 'tok';
const PERSON_TOKEN = 'person-tok';
const SP = 'app-sp-2';
const CATALOG = 'GRANT USE CATALOG ON CATALOG `main` TO `app-sp-2`';
const SCHEMA = 'GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp-2`';
const SELECT = 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-2`';
const RECORDED = [CATALOG, SCHEMA, SELECT];
const DENIED = "[PERMISSION_DENIED] User does not have MANAGE on Schema 'main.s'.";

function built(unread, status = 'ready_with_warnings') {
  return {
    session_id: 42, use_case_id: 'N01-U01', spec_version: 3, status, app_name: 'riverside-assets',
    spec_json: JSON.stringify({ use_case_id: 'N01-U01', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { app: true } }),
    asset_status: JSON.stringify({ app: { state: 'ready', spec_version: 3, ...(unread ? { unread } : {}) }, notebook: { state: 'ready', spec_version: 3 } }),
  };
}

const RECORD = { app: SP, tables: [{ table: 'main.s.orders', owner: 'data-eng', grants: RECORDED }] };

function workspace({ catalogMine = false, schemaManage = true, history = [built(RECORD)] } = {}) {
  const held = new Set();
  const grants = [];
  const rows = () => [
    { level: 'catalog', privilege: 'OWNER', principal: catalogMine ? 'amr@x' : 'admins', mine: String(catalogMine), me: 'amr@x' },
    { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'amr@x' },
    { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'amr@x' },
    ...(schemaManage ? [{ level: 'schema', privilege: 'MANAGE', principal: 'amr@x', mine: 'true', me: 'amr@x' }] : []),
    ...[...held].map((sql) => {
      const [, privilege, level] = /^GRANT (USE CATALOG|USE SCHEMA|SELECT) ON (\w+)/.exec(sql);
      return { level: level.toLowerCase(), privilege, principal: SP, mine: 'false', me: 'amr@x' };
    }),
  ];
  return {
    grants,
    held,
    overrides: {
      useCase: { id: 'N01-U01', use_case: 'Assess water assets', primary_table: 'main.s.orders', tables_involved: 'main.s.orders' },
      tokenKind: 'app',
      forwardedToken: PERSON_TOKEN,
      history,
      statements: {
        'system.information_schema.catalogs': () => ({ rows: rows() }),
        'GRANT ': (sql, _p, token) => {
          grants.push([sql, token]);
          if (sql.includes(' ON CATALOG ') ? !catalogMine : !schemaManage) throw new Error(DENIED);
          held.add(sql);
          return { rows: [] };
        },
      },
    },
  };
}

async function call(base, route, body) {
  const resp = await fetch(base + route, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}) });
  return { status: resp.status, data: await resp.json() };
}

async function withApp(overrides, run) {
  const made = makeApp(overrides);
  const srv = await listen(made.app);
  try {
    await run(srv.url, made);
  } finally {
    await srv.close();
  }
}

const updates = (made) => made.sqlCalls.filter((c) => String(c.sql).startsWith('UPDATE'));

test('Grant access with my permissions runs exactly the recorded grants still missing, with the person token, and nothing from the request', async () => {
  const w = workspace();
  await withApp(w.overrides, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/app-reads?${Q}`, { action: 'grant', grants: ['DROP TABLE main.s.orders'], sql: 'GRANT ALL PRIVILEGES ON CATALOG `main` TO `x`' });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(w.grants, [[CATALOG, PERSON_TOKEN], [SCHEMA, PERSON_TOKEN], [SELECT, PERSON_TOKEN]]);
    assert.ok(!made.sqlCalls.some((c) => /DROP|ALL PRIVILEGES|`x`/.test(String(c.sql))), 'the request body never reaches SQL (must-exclude)');
    assert.ok(!made.sqlCalls.some((c) => String(c.sql).startsWith('GRANT') && c.token === APP_TOKEN), 'no grant runs as the Inspire App');
    assert.deepEqual(got.data.ran, [SCHEMA, SELECT]);
    assert.equal(got.data.refused, true, 'the USE CATALOG the person cannot grant is refused and said so');
    assert.match(got.data.failed[0], /^GRANT USE CATALOG ON CATALOG `main` TO `app-sp-2`: \[PERMISSION_DENIED\]/);
    const [update] = updates(made);
    assert.match(update.sql, /^UPDATE `main`\.`inspire`\.`__inspire_implement` SET asset_status = parse_json\(:assets\)/);
    assert.match(update.sql, /status IN \('ready', 'ready_with_warnings'\)$/);
    const assets = JSON.parse(update.parameters.find((p) => p.name === 'assets').value);
    assert.deepEqual(assets.app.unread.tables, [{ table: 'main.s.orders', owner: 'admins', grants: [CATALOG] }], 'what the person could not grant stays recorded');
    assert.equal(assets.notebook.state, 'ready', 'the rest of the record is kept');
    assert.equal(got.data.state, 'unreadable');
    assert.match(got.data.text, /^The App riverside-assets cannot read main\.s\.orders, so its pages show no data from it\. Your grant was refused: GRANT USE CATALOG/);
    assert.match(got.data.text, /\. Admins can grant it$/);
  });
});

test('when the person can grant everything the App reads again and the build record no longer asks for access', async () => {
  const w = workspace({ catalogMine: true });
  w.held.add(CATALOG);
  await withApp(w.overrides, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/app-reads?${Q}`, { action: 'grant' });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.deepEqual(w.grants.map(([sql]) => sql), [SCHEMA, SELECT], 'a recorded grant the App already holds is not run again');
    assert.equal(got.data.refused, false);
    assert.equal(got.data.state, 'readable');
    assert.deepEqual(got.data.tables, []);
    assert.equal(got.data.text, 'The App can read all its data now');
    const assets = JSON.parse(updates(made)[0].parameters.find((p) => p.name === 'assets').value);
    assert.equal('unread' in assets.app, false);
  });
});

test('a fully refused grant keeps every table listed with its exact grants and the choices stay', async () => {
  const w = workspace({ schemaManage: false });
  await withApp(w.overrides, async (url, made) => {
    const got = await call(url, `/api/inspire/implement/app-reads?${Q}`, { action: 'grant' });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.refused, true);
    assert.deepEqual(got.data.ran, []);
    assert.equal(got.data.failed.length, 3);
    assert.equal(got.data.state, 'unreadable');
    assert.deepEqual(got.data.tables[0].grants, RECORDED);
    assert.equal(updates(made).length, 1, 'the owners read now replace the ones the build saw');
  });
});

test('Check again reads the App access without granting and without a sign-in', async () => {
  const w = workspace();
  await withApp({ ...w.overrides, forwardedToken: '' }, async (url) => {
    const got = await call(url, `/api/inspire/implement/app-reads?${Q}`, { action: 'check' });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.state, 'unreadable');
    assert.deepEqual(w.grants, []);
    const grant = await call(url, `/api/inspire/implement/app-reads?${Q}`, { action: 'grant' });
    assert.equal(grant.status, 401);
    assert.equal(grant.data.error, I.IMPLEMENT_GRANT_NO_SIGN_IN);
    assert.deepEqual(w.grants, []);
    assert.equal((await call(url, `/api/inspire/implement/app-reads?${Q}`, { action: 'drop' })).status, 400);
  });
});

test('only a recorded read grant to the App itself is ever run, and a build that is not done has nothing to grant', async () => {
  const tampered = { app: SP, tables: [{ table: 'main.s.orders', owner: 'data-eng',
    grants: ['GRANT MODIFY ON TABLE `main`.`s`.`orders` TO `app-sp-2`', 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `someone-else`', 'GRANT SELECT ON SCHEMA `main`.`s` TO `app-sp-2`', SELECT] }] };
  const w = workspace({ history: [built(tampered)] });
  await withApp(w.overrides, async (url) => {
    await call(url, `/api/inspire/implement/app-reads?${Q}`, { action: 'grant' });
    assert.deepEqual(w.grants.map(([sql]) => sql), [SELECT]);
  });
  for (const history of [[built(RECORD, 'building_outputs')], [built(null)], []]) {
    const n = workspace({ history });
    await withApp(n.overrides, async (url, made) => {
      const got = await call(url, `/api/inspire/implement/app-reads?${Q}`, { action: 'grant' });
      assert.equal(got.status, 200, JSON.stringify(got.data));
      assert.equal(got.data.state, 'readable');
      assert.deepEqual(n.grants, []);
      assert.equal(updates(made).length, 0);
    });
  }
  assert.equal(I.appReadGrantFor(SELECT, SP), true);
  assert.equal(I.appReadGrantFor('GRANT SELECT ON TABLE `main`.`s` TO `app-sp-2`', SP), false);
  assert.equal(I.appReadGrantFor(`${SELECT}; DROP TABLE x`, SP), false);
});

const PLAN_SPEC = (outputs) => ({ use_case_id: 'N01-U01', use_case_name: 'Assess water assets',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { dashboard: true, genie_space: true, alert: false, ...outputs } });

async function planWith(inspireRows, outputs) {
  const w = workspace({ history: [] });
  const overrides = { ...w.overrides, statements: { ...w.overrides.statements, 'system.information_schema.catalogs': (_s, _p, token) => ({ rows: token === APP_TOKEN ? inspireRows : [] }) } };
  let got;
  await withApp(overrides, async (url) => {
    got = await call(url, '/api/inspire/implement/plan', { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: PLAN_SPEC(outputs) });
  });
  return got;
}

const INSPIRE_READS_ONLY = [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'inspire-sp' },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'inspire-sp' },
  { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'inspire-sp' },
  { level: 'table', privilege: 'SELECT', principal: 'inspire-sp', mine: 'true', me: 'inspire-sp' },
];
const INSPIRE_MANAGES = [
  { level: 'catalog', privilege: 'OWNER', principal: 'inspire-sp', mine: 'true', me: 'inspire-sp' },
  { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'inspire-sp' },
  { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'inspire-sp' },
];

test('before the build, the plan warns when Inspire cannot share a picked table with the App it will create, naming it and its owner', async () => {
  const got = await planWith(INSPIRE_READS_ONLY, { app: true, app_name: 'riverside-assets', app_access: 'sp' });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const [warning] = got.data.warnings.filter((w) => w.startsWith('Inspire cannot share'));
  assert.ok(warning, JSON.stringify(got.data.warnings));
  assert.match(warning, /^Inspire cannot share main\.s\.orders \(owner admins and data-eng\) with the App this build makes/);
  assert.match(warning, /The build still runs\. When it ends, the Build page offers Grant access with my permissions to grant it as you in one click, or the grant SQL to send to admins and data-eng$/);
  assert.deepEqual(got.data.summary.app_reads.tables, [{ table: 'main.s.orders', owner: 'admins and data-eng' }]);
  assert.ok(got.data.warnings.includes(got.data.summary.app_reads.text), 'the wizard shows the same words the plan warns with');
});

test('the plan does not warn when Inspire manages the data, for a per-user App, or without an App (must-exclude)', async () => {
  for (const [rows, outputs] of [[INSPIRE_MANAGES, { app: true, app_name: 'riverside-assets', app_access: 'sp' }],
    [INSPIRE_READS_ONLY, { app: true, app_name: 'riverside-assets', app_access: 'user' }], [INSPIRE_READS_ONLY, { app: false }]]) {
    const got = await planWith(rows, outputs);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.equal(got.data.warnings.some((w) => w.startsWith('Inspire cannot share')), false, JSON.stringify(outputs));
    assert.equal('app_reads' in got.data.summary, false);
  }
});

const lib = (name) => import(require('node:url').pathToFileURL(require('node:path').resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const row = (unread, status = 'ready_with_warnings') => ({ ...built(unread, status), asset_status: JSON.parse(built(unread, status).asset_status) });

test('a done build with unread tables reads as action needed, and its finish stage is not plain Done', async () => {
  const W = await lib('implementWizard.js');
  const P = await lib('mvpProgress.js');
  const held = row(RECORD);
  assert.deepEqual(W.implementState(held), { group: 'held', label: W.APP_READS_LABEL, tone: 'warning', kind: 'mvp' });
  assert.notEqual(W.implementState(row(null)).label, W.APP_READS_LABEL, 'an App that reads everything stays Done (must-exclude)');
  assert.equal(W.appReadsOf(row(RECORD, 'failed')), null, 'a failed build shows its failure, not the access card');
  assert.equal(W.appReadsOf(row({ app: SP, tables: [{ table: 'main.s.orders', grants: [] }] })), null, 'nothing to grant shows nothing');
  const finish = P.mvpStages([], held).at(-1);
  assert.equal(finish.state, 'warning');
  assert.ok(finish.notes.includes(W.APP_READS_LABEL));
  const clean = P.mvpStages([], row(null, 'ready')).at(-1);
  assert.equal(clean.state, 'done');
  assert.ok(!clean.notes.includes(W.APP_READS_LABEL));
  const choices = W.appReadsChoices(W.appReadsOf(held));
  assert.deepEqual(choices.map((c) => c.id), ['grant', 'copy', 'check']);
  assert.equal(choices[1].label, 'Copy the grant SQL to send to data-eng');
  assert.equal(choices[1].sql, RECORDED.map((g) => `${g};`).join('\n'));
  assert.match(W.appReadsText(W.appReadsOf(held), 'riverside-assets'), /App riverside-assets cannot read main\.s\.orders \(owner data-eng\)/);
  assert.doesNotMatch(W.appReadsText(W.appReadsOf(held)), /build (it )?again|rebuild/i);
});
