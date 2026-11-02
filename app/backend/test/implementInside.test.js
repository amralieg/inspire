const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const C = require('../lib/implementControl');
const { pythonTuple, bundledNotebookText } = require('../lib/appShell');
const { HOSTED_NO_TOKEN } = require('../lib/hostedRun');
const { makeApp, listen } = require('./support/implementApp');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const runIdOf = (R, hash) => {
  const link = R.hashLink(hash);
  return link && link.page === R.RUN_TAB ? link.id : null;
};
const OWNER = ['owner', 'example.com'].join('@');
const OTHER = ['someone.else', 'example.com'].join('@');

const BASE = {
  use_case_id: 'N01-U01',
  use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp', inspire_url: 'https://inspire.example.com' },
};
const spec = (outputs = {}) => I.validateImplementSpec({ ...JSON.parse(JSON.stringify(BASE)), outputs: { ...BASE.outputs, ...outputs } });
const INSIDE = { app_placement: 'inspire', app_access: 'user', app_backend: 'delta', app_warehouse_id: 'wh2' };

test('an App Inside Inspire must read as each viewer, from Delta tables, with a warehouse of its own and no App to join; its App name is ignored', () => {
  const ok = spec({ ...INSIDE, app_name: 'Not A Name' });
  assert.deepEqual(ok.errors, []);
  assert.deepEqual([ok.spec.outputs.app_placement, ok.spec.outputs.app_name, ok.spec.outputs.app_access, ok.spec.outputs.app_backend,
    ok.spec.outputs.app_warehouse_id, ok.spec.outputs.merge.app], ['inspire', '', 'user', 'delta', 'wh2', '']);
  const cases = [
    [{ app_access: 'sp' }, 'a page inside Inspire shows each viewer only the data they may read, so it always signs viewers in as themselves'],
    [{ app_backend: 'lakebase' }, 'a page inside Inspire reads Delta tables; Lakebase needs an App of its own'],
    [{ merge: { app: 'other-app' } }, 'a page inside Inspire belongs to this use case alone, so it cannot be added to another App; leave outputs.merge.app empty'],
    [{ app_warehouse_id: '' }, 'a page inside Inspire needs outputs.app_warehouse_id, the SQL warehouse each viewer reads with; each viewer needs CAN USE on it'],
  ];
  for (const [change, error] of cases) {
    const got = spec({ ...INSIDE, ...change });
    assert.deepEqual(got.errors, [error], JSON.stringify(change));
    assert.notEqual(got.spec.outputs.app_access === 'sp' && got.spec.outputs.app_placement === 'inspire' && got.errors.length === 0, true, 'never a silent coercion');
  }
  const missing = spec({ app_placement: 'inspire', app_access: 'user', app_backend: 'delta' });
  assert.deepEqual(missing.errors, ['a page inside Inspire needs outputs.app_warehouse_id, the SQL warehouse each viewer reads with; each viewer needs CAN USE on it']);
  const badId = spec({ ...INSIDE, app_warehouse_id: 'bad id!' });
  assert.equal(badId.errors.length, 1, 'a malformed warehouse id is reported once, not twice');
  for (const placement of ['domain', 'use_case', 'business']) {
    assert.deepEqual(spec({ app_placement: placement }).errors, [], `${placement} keeps its rules`);
    assert.match(spec({ app_placement: placement, app_name: 'Not A Name' }).errors.join(' '), /app_name .* must be 3-30 characters/, `${placement} still needs an App name`);
  }
  assert.deepEqual(I.IMPLEMENT_APP_PLACEMENTS, ['domain', 'use_case', 'business', 'inspire']);
  assert.match(spec({ app_placement: 'cloud' }).errors[0], /'inspire' \(Inside Inspire, each use case's page in Inspire's Run tab; not recommended, only for testing\), not 'cloud'$/);
});

test('a move into or out of Inside Inspire is an App-only change that builds the App, and nothing else', () => {
  const built = spec({ app_placement: 'domain' }).spec;
  const inside = spec(INSIDE).spec;
  for (const [before, after] of [[built, inside], [inside, built]]) {
    assert.deepEqual(I.classifyImplementChange(before, after), ['outputs']);
    const plan = I.implementChangeSummary(before, after, { dashboard: 'd1', genie_space: 'g1', app: 'churn-desk' });
    assert.deepEqual([plan.build, plan.refresh, plan.refill, plan.delete], [['app'], [], false, []]);
  }
  const sameName = { ...inside, outputs: { ...inside.outputs, app_name: built.outputs.app_name } };
  assert.deepEqual(I.implementChangeSummary(built, sameName, { dashboard: 'd1', genie_space: 'g1', app: 'churn-desk' }).build, ['app'],
    'the move itself rebuilds, not only the name change');
  assert.deepEqual(I.classifyImplementChange(built, { ...built, outputs: { ...built.outputs, app_placement: 'use_case' } }), [],
    'a move between two own-App placements with the same name changes nothing');
});

const live = (version) => ({ state: 'ready', spec_version: version });
const hosted = (id, version, extra = {}) => ({ id, source: `/Workspace/Users/someone/inspire/${id}/v${version}`, version, warehouse_id: 'wh2', page: 'n01_u01',
  published_at: `2026-10-2${version}T05:00:00Z`, ...extra });
const row = (session, uc, version, status, { app = null, appName = '', appUrl = '', by = OWNER, name = 'Predict churn' } = {}) => ({
  session_id: session, use_case_id: uc, spec_version: version, status, created_by: by, app_name: appName, app_url: appUrl,
  spec_json: { use_case_name: name, outputs: { app: true, app_owners: [] } },
  asset_status: app ? { app } : { app: live(version) }, updated_at: `2026-10-2${version}T06:00:00Z`,
});
const insideApp = (rec) => ({ placement: 'inspire', hosted: rec, app_name: '', app_url: '' });

test('a hosted record is read only when it is whole and safe', () => {
  const good = hosted('n01-u01-abc', 2);
  assert.deepEqual(I.hostedRecord({ asset_status: { app: insideApp(good) } }), good);
  assert.deepEqual(I.hostedRecord({ asset_status: { app: insideApp({ ...good, source: `${good.source}/` }) } }).source, good.source);
  for (const bad of [{ id: 'N01_U01' }, { id: '' }, { source: 'relative/v2' }, { source: '/Workspace/x/../y' }, { version: '2' }, { version: 0 },
    { warehouse_id: 'bad id!' }, { page: '' }]) {
    assert.equal(I.hostedRecord({ asset_status: { app: insideApp({ ...good, ...bad }) } }), null, JSON.stringify(bad));
  }
  assert.equal(I.hostedRecord({ asset_status: { app: { placement: 'domain', hosted: good } } }), null, 'only an App Inside Inspire');
  assert.equal(I.hostedRecord(null), null);
});

test('Run lists the live version of every use case: Inside Inspire pages and Apps of their own, never a held or failed version', () => {
  const rows = [
    row('42', 'N01-U01', 3, 'vibe_not_met', { app: insideApp(hosted('n01-u01-a', 3)) }),
    row('42', 'N01-U01', 2, 'ready', { app: insideApp(hosted('n01-u01-a', 2)) }),
    row('42', 'N01-U02', 4, 'failed', { app: insideApp(hosted('n01-u02-a', 4)) }),
    row('42', 'N01-U02', 3, 'ready_with_warnings', { app: insideApp(hosted('n01-u02-a', 3)), name: 'Price right' }),
    row('42', 'N01-U03', 2, 'uninstalled'),
    row('42', 'N01-U03', 1, 'ready', { app: insideApp(hosted('n01-u03-a', 1)) }),
    row('43', 'N02-U01', 1, 'ready', { appName: 'inspire-hub-acme', appUrl: 'https://inspire-hub-acme.example.com', name: 'Plan shifts' }),
    row('43', 'N02-U02', 1, 'filling'),
  ];
  const scope = [{ session_id: '42', use_case_id: 'N01-U01', domain: 'Retention' }, { session_id: '42', use_case_id: 'N01-U02', domain: 'Pricing' },
    { session_id: '43', use_case_id: 'N02-U01', domain: 'Operations' }];
  const pages = I.runPages(rows, scope);
  assert.deepEqual(pages.map((p) => [p.use_case_id, p.kind, p.version, p.domain]),
    [['N02-U01', 'app', 1, 'Operations'], ['N01-U02', 'inspire', 3, 'Pricing'], ['N01-U01', 'inspire', 2, 'Retention']]);
  const [own, priced, held] = pages;
  assert.deepEqual([own.app_name, own.app_url], ['inspire-hub-acme', 'https://inspire-hub-acme.example.com']);
  assert.deepEqual([priced.id, priced.page, priced.hosted.source], ['n01-u02-a', 'n01_u01', '/Workspace/Users/someone/inspire/n01-u02-a/v3'],
    'a failed v4 never moves the live page');
  assert.equal(held.hosted.version, 2, 'a held v3 never moves the live page');
  assert.deepEqual(held.owners, [OWNER]);
  for (const order of [[0, 1], [1, 0]]) {
    const both = [row('42', 'N01-U01', 2, 'ready', { app: insideApp(hosted('same-id', 2)) }),
      row('44', 'N09-U09', 5, 'ready', { app: insideApp(hosted('same-id', 5)), name: 'Later page' })];
    const twice = I.runPages(order.map((i) => both[i]));
    const served = twice.filter((p) => !p.conflict);
    assert.deepEqual(served.map((p) => [p.use_case_id, p.version]), [['N09-U09', 5]], 'one page id serves one use case, the newest');
    const blocked = twice.find((p) => p.conflict);
    assert.deepEqual([blocked.use_case_id, blocked.conflict], ['N01-U01', { session_id: '44', use_case_id: 'N09-U09', name: 'Later page' }],
      'the other use case stays listed with the reason, never silently dropped');
  }
});

function fakeHosted() {
  const calls = { listed: [], states: [] };
  return {
    calls,
    useReader: () => {},
    setListed: (entries, ctx) => calls.listed.push({ ids: entries.map((e) => e.id), ctx }),
    stateOf: (id, { owner }) => {
      calls.states.push([id, owner]);
      return { state: 'failed', reason: '', error: 'the page stopped with exit code 1', ...(owner ? { stderr: ['Traceback', 'line 2'] } : {}) };
    },
  };
}

async function runPages(overrides, who, headers = {}) {
  const made = makeApp(overrides);
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/run/pages?inspire_database=main.inspire&warehouse_id=wh1`, {
      headers: { ...(who ? { 'x-forwarded-email': who } : {}), ...headers },
    });
    return { status: resp.status, data: await resp.json(), made };
  } finally {
    await srv.close();
  }
}

test('/api/run/pages lists every deployed use case through the implement record reader, tells each person if they own it, and shows stderr to owners only', async () => {
  const registry = [
    row('42', 'N01-U01', 2, 'ready', { app: insideApp(hosted('n01-u01-a', 2)) }),
    row('43', 'N02-U01', 1, 'ready', { appName: 'inspire-hub-acme', appUrl: 'https://inspire-hub-acme.example.com', by: OTHER }),
  ].map((r) => ({ ...r, spec_json: JSON.stringify(r.spec_json), asset_status: JSON.stringify(r.asset_status) }));
  const scope = [{ session_id: '42', use_case_id: 'N01-U01', domain: 'Retention', business: 'Acme' }];
  const owned = fakeHosted();
  const mine = await runPages({ registry, useCaseScope: scope, hostedRun: owned }, OWNER.toUpperCase(), { 'x-forwarded-access-token': 'user-token' });
  assert.equal(mine.status, 200, JSON.stringify(mine.data));
  const [app, inside] = [mine.data.pages.find((p) => p.kind === 'app'), mine.data.pages.find((p) => p.kind === 'inspire')];
  assert.deepEqual([inside.id, inside.path, inside.domain, inside.owner, inside.state, inside.stderr],
    ['n01-u01-a', '/run/n01-u01-a/#/n01_u01', 'Retention', true, 'failed', ['Traceback', 'line 2']]);
  assert.equal(Object.hasOwn(inside, 'owners') || Object.hasOwn(inside, 'hosted'), false, 'no owner list or workspace source leaves the server');
  assert.deepEqual([app.app_name, app.app_url, app.owner, Object.hasOwn(app, 'path')], ['inspire-hub-acme', 'https://inspire-hub-acme.example.com', false, false]);
  assert.deepEqual([mine.data.user_authorization, mine.data.user_authorization_note], [true, HOSTED_NO_TOKEN]);
  assert.deepEqual(owned.calls.listed, [{ ids: ['n01-u01-a'], ctx: { key: 'https://workspace.example.com|main.inspire', warehouseId: 'wh1', catalog: 'main', schema: 'inspire' } }]);
  const registryReads = mine.made.sqlCalls.filter((c) => String(c.sql).includes('`app_name` IS NOT NULL'));
  assert.equal(registryReads.length, 1, 'one read of the implement records, through the registry statement');
  const theirs = await runPages({ registry, useCaseScope: scope, hostedRun: fakeHosted() }, OTHER);
  const shown = theirs.data.pages.find((p) => p.kind === 'inspire');
  assert.deepEqual([shown.owner, shown.state, shown.error, Object.hasOwn(shown, 'stderr')], [false, 'failed', 'the page stopped with exit code 1', false]);
  assert.equal(theirs.data.user_authorization, false, 'no forwarded token: Run explains why the pages cannot open');
  const none = await runPages({ registry: [], hostedRun: fakeHosted() }, OWNER);
  assert.deepEqual(none.data.pages, []);
});

test('two use cases that claim one page id: Run serves the newest and shows the other as failed with the reason, and never proxies it', async () => {
  const registry = [
    row('42', 'N01-U01', 2, 'ready', { app: insideApp(hosted('n01-u01', 2)), name: 'Predict churn' }),
    row('44', 'N01-U01', 1, 'ready', { app: insideApp(hosted('n01-u01', 1, { published_at: '2026-10-29T05:00:00Z' })), name: 'Price right' }),
  ].map((r) => ({ ...r, spec_json: JSON.stringify(r.spec_json), asset_status: JSON.stringify(r.asset_status) }));
  const fake = fakeHosted();
  const got = await runPages({ registry, hostedRun: fake }, OWNER, { 'x-forwarded-access-token': 'user-token' });
  const blocked = got.data.pages.find((p) => p.session_id === '42');
  assert.deepEqual([blocked.state, Object.hasOwn(blocked, 'path')], ['failed', false]);
  assert.equal(blocked.error, 'the page id n01-u01 is also used by Price right (N01-U01 of session 44), published later, so this page cannot open '
    + 'Inside Inspire; give it its own App');
  assert.deepEqual(fake.calls.listed.map((c) => c.ids), [['n01-u01']]);
  assert.equal(got.data.pages.find((p) => p.session_id === '44').path, '/run/n01-u01/#/n01_u01');
});

test('the Build page control tower shows the App Inside Inspire with Open in Run, not an App link', async () => {
  const rows = [row('42', 'N01-U01', 3, 'filling', { app: insideApp(hosted('n01-u01-a', 3)) }), { ...row('42', 'N01-U01', 2, 'ready', { app: insideApp(hosted('n01-u01-a', 2)) }), job_id: '77' }];
  const targets = C.controlTargets(rows);
  assert.deepEqual([targets.inside, targets.app], ['n01-u01-a', undefined]);
  const status = C.liveStatus(targets, {}, { history: rows });
  assert.deepEqual(status.inside, { ok: true, id: 'n01-u01-a', page: 'n01_u01', version: 2, published_at: '2026-10-22T05:00:00Z' });
  assert.equal(C.controlTargets([row('42', 'N01-U01', 1, 'ready', { appName: 'churn-desk' })]).inside, undefined);
  const F = await lib('implementControl.js');
  const W = await lib('implementWizard.js');
  const rowsShown = F.controlRows({ targets, assets: status }, { spec_version: 3, spec_json: { outputs: { app: true } } });
  const appRow = rowsShown.find((r) => r.id === 'app');
  assert.deepEqual([appRow.name, appRow.url, appRow.run, appRow.state.label], [W.APP_INSIDE_PLACEMENT.label, '', { id: 'n01-u01-a', page: 'n01_u01' }, 'Inside Inspire']);
  assert.equal(W.RUN_LINK_LABEL, 'Open in Run');
  const lost = F.controlRows({ targets, assets: { inside: { ok: false, error: 'gone' } } }, { spec_json: {} }).find((r) => r.id === 'app');
  assert.deepEqual([lost.run, lost.state.tone], [null, 'error']);
});

test('the wizard locks an App Inside Inspire to per-user access, Delta tables and an explicit warehouse, and never sends an invalid spec', async () => {
  const W = await lib('implementWizard.js');
  const start = W.defaultSpecFromUseCase({ id: 'N01-U01', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', business_domain: 'Retention' },
    { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: OWNER, businessName: 'Acme' });
  const placement = W.APP_PLACEMENTS.find((p) => p.id === 'inspire');
  assert.deepEqual([placement.label, placement.tag], ['Inside Inspire', 'Not recommended, only for testing']);
  assert.equal(placement.blurb, 'Inspire runs the page in its Run tab, with no App of its own. Each viewer sees only the data they may read. Use it to try a page, then give it its own App.');
  assert.deepEqual(W.APP_PLACEMENT_IDS, I.IMPLEMENT_APP_PLACEMENTS, 'the wizard offers what the validator accepts');
  assert.deepEqual(W.APP_OWN_PLACEMENTS.map((p) => p.id), ['domain', 'use_case', 'business']);
  const inside = W.withNewApp({ ...start, outputs: { ...start.outputs, merge: { ...start.outputs.merge, app: 'inspire-hub-acme' } } }, 'inspire', null, {});
  assert.deepEqual([inside.outputs.app_placement, inside.outputs.app_name, inside.outputs.merge.app, inside.outputs.app_access, inside.outputs.app_backend,
    inside.outputs.app_warehouse_id], ['inspire', '', '', 'user', 'delta', 'wh1']);
  assert.equal(W.insideInspire(inside), true);
  assert.equal(W.withAppAccess(inside, 'sp'), inside, 'per-user is locked');
  assert.equal(W.withAppBackend(inside, 'lakebase'), inside, 'Delta tables are locked');
  assert.equal(W.lakebaseBlock(inside, { state: 'available' }), 'Lakebase needs an App of its own');
  assert.equal(W.appBackendOf({ ...inside, outputs: { ...inside.outputs, app_backend: 'lakebase' } }, { state: 'available' }), 'delta');
  assert.equal(W.withAppWarehouse(inside, 'wh1').outputs.app_warehouse_id, 'wh1', 'the build warehouse stays explicit Inside Inspire');
  assert.equal(W.withAppWarehouse(start, 'wh1').outputs.app_warehouse_id, '', 'an own App still leaves it empty for the build warehouse');
  assert.equal(W.placementAppName('inspire', { business: 'Acme', domain: 'Retention' }), '');
  assert.deepEqual(W.sectionErrors('app_place', inside), [], 'nothing to fix, and no App name is asked for');
  assert.deepEqual(W.sectionErrors('app_place', { ...inside, outputs: { ...inside.outputs, app_warehouse_id: '' } }), [W.INSIDE_WAREHOUSE_PROBLEM]);
  assert.match(W.sectionErrors('app_place', { ...inside, outputs: { ...inside.outputs, merge: { app: 'x-app' } } }).join(' '), /no App of its own to join/);
  assert.match(W.sectionErrors('app_access', { ...inside, outputs: { ...inside.outputs, app_access: 'sp' } }).join(' '), /signs in as themselves/);
  assert.deepEqual(W.sectionErrors('app_place', W.withNewApp(inside, 'domain', null, { business: 'Acme', domain: 'Retention' })), [], 'moving back names an App again');
  const joined = W.withMergeTarget(inside, 'app', { id: 'inspire-hub-acme', look: {} });
  assert.equal(joined.outputs.app_placement, 'domain', 'joining an App leaves Inside Inspire');
  const sent = W.sentSpec(inside, { state: 'available' }, null);
  assert.deepEqual(I.validateImplementSpec(I.withInspireUrl({ ...sent, config: { ...sent.config, result_table: 'main.inspire.n01_u01_s42_out' } }, 'https://inspire.example.com')).errors, [],
    'what the wizard sends passes the validator');
  const edit = W.specFromLatest({ spec_version: 2, status: 'ready', spec_json: sent }, start);
  assert.deepEqual([edit.outputs.app_placement, edit.outputs.app_name], ['inspire', ''], 'Vibe/Add/Remove Features keeps Inside Inspire without inventing an App name');
});

test('Run groups pages by domain and words their state; only a safe /run path becomes an iframe source', async () => {
  const R = await lib('runPages.js');
  const pages = [{ kind: 'inspire', id: 'b', domain: 'Retention' }, { kind: 'app', session_id: '1', use_case_id: 'N01', domain: '' },
    { kind: 'inspire', id: 'a', domain: 'Pricing' }];
  assert.deepEqual(R.runGroups(pages).map((g) => [g.domain, g.pages.length]), [['Pricing', 1], ['Retention', 1], [R.RUN_NO_DOMAIN, 1]]);
  assert.equal(R.runStateText({ state: 'starting' }), 'Starting');
  assert.equal(R.runStateText({ state: 'ready' }), 'Ready');
  assert.equal(R.runStateText({ state: 'stopped', reason: '' }), 'Stopped. Opening it starts it.');
  assert.equal(R.runStateText({ state: 'stopped', reason: 'it was stopped after 15 minutes with no visits; open it again to start it' }),
    'Stopped. It was stopped after 15 minutes with no visits; open it again to start it.');
  assert.equal(R.runStateText({ state: 'failed', error: 'the page stopped with exit code 1' }), 'Failed: the page stopped with exit code 1');
  assert.equal(R.runFrameSrc({ kind: 'inspire', path: '/run/n01-u01-a/#/n01_u01' }), '/run/n01-u01-a/#/n01_u01');
  for (const bad of ['https://evil.example.com/run/a/#/p', '/run/../api/x', '/api/run/pages', 'javascript:alert(1)', '/run/A/#/p']) {
    assert.equal(R.runFrameSrc({ kind: 'inspire', path: bad }), '', bad);
  }
  assert.equal(R.runAppUrl({ app_url: 'http://plain.example.com' }), '', 'only https App links open');
  assert.equal(R.runPolling([{ kind: 'inspire', id: 'a', state: 'ready' }], 'inspire:a'), false);
  assert.equal(R.runPolling([{ kind: 'inspire', id: 'a', state: 'starting' }], ''), true);
  assert.equal(R.runPolling([{ kind: 'inspire', id: 'a', state: 'failed' }], 'inspire:a'), false, 'a failed page is not polled forever');
  assert.equal(R.RUN_BANNER, 'Inside Inspire, only for testing. Give it its own App for real use.');
});

test('only a page with a safe frame source opens full window; an App of its own, an unsafe path or an unknown key never does', async () => {
  const R = await lib('runPages.js');
  const a = { kind: 'inspire', id: 'n01-u01-a', path: '/run/n01-u01-a/#/n01_u01' };
  const unsafe = { kind: 'inspire', id: 'n02-u01-b', path: 'https://evil.example.com/run/n02-u01-b/' };
  const own = { kind: 'app', session_id: '43', use_case_id: 'N02-U01', app_url: 'https://inspire-hub-acme.example.com' };
  const demo = { kind: R.RUN_DEMO_KIND, id: 'N01-U01', path: '/showcase/demo/mvp/n01/' };
  const pages = [own, a, unsafe, demo];
  assert.equal(R.runFullPage(pages, 'inspire:n01-u01-a'), a);
  assert.equal(R.runFullPage(pages, 'inspire:n02-u01-b'), null, 'a page whose path is not a safe /run path never fills the window');
  assert.equal(R.runFullPage(pages, 'app:43:N02-U01'), null, 'an App of its own opens outside Inspire');
  assert.equal(R.runFullPage(pages, 'inspire:n09-u09-x'), null);
  assert.equal(R.runFullPage(pages, ''), null);
  assert.equal(R.runFullPage(null, 'inspire:n01-u01-a'), null);
  assert.equal(R.runFullPage(pages, 'demo:N01-U01'), demo);
  assert.equal(R.runFullPage([{ ...demo, path: '/showcase/demo/mvp/n01/../../api/' }], 'demo:N01-U01'), null);
  assert.deepEqual(R.runFramedPages(pages), [a, demo], 'Switch use case lists only pages that can fill the window');
  assert.deepEqual(R.runFramedPages(undefined), []);
});

async function submitted(outputs, { headers = {}, appUrl, proxy } = {}) {
  const made = makeApp(proxy === undefined ? {} : { forwardedHost: proxy });
  const srv = await listen(made.app);
  const saved = process.env.DATABRICKS_APP_URL;
  if (appUrl === undefined) delete process.env.DATABRICKS_APP_URL;
  else process.env.DATABRICKS_APP_URL = appUrl;
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/submit`, {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...headers },
      body: JSON.stringify({ inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42', spec: { ...JSON.parse(JSON.stringify(BASE)), outputs: { ...BASE.outputs, ...outputs } } }),
    });
    const data = await resp.json();
    const specs = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
      .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));
    return { status: resp.status, data, specs };
  } finally {
    if (saved === undefined) delete process.env.DATABRICKS_APP_URL;
    else process.env.DATABRICKS_APP_URL = saved;
    await srv.close();
  }
}

test('at submit Inspire sets outputs.inspire_url to its own https address for every App placement and for a dashboard, and nothing a browser sends can change it', async () => {
  const proxied = await submitted(INSIDE, { headers: { 'x-forwarded-host': 'Inspire-AI-1.Example.com' } });
  assert.equal(proxied.status, 200, JSON.stringify(proxied.data));
  assert.equal(proxied.specs[0].outputs.inspire_url, 'https://inspire-ai-1.example.com', 'the host the Apps proxy says the browser asked for');
  const own = await submitted(INSIDE, { headers: { 'x-forwarded-host': 'other.example.com' }, appUrl: 'https://inspire-ai-2.example.com/' });
  assert.equal(own.specs[0].outputs.inspire_url, 'https://inspire-ai-2.example.com', "the App's own URL wins, with no trailing slash");
  const forged = await submitted({ ...INSIDE, inspire_url: 'https://evil.example.com' }, { headers: { 'x-forwarded-host': 'inspire.example.com' } });
  assert.equal(forged.specs[0].outputs.inspire_url, 'https://inspire.example.com', 'a value the browser sends is replaced');
  const placements = [
    ['an App of its own', { app_placement: 'use_case' }],
    ['an App for the domain', { app_placement: 'domain', app_name: 'inspire-customer' }],
    ['one App for the business', { app_placement: 'business', app_name: 'inspire-hub-acme' }],
    ['a page Inside Inspire', INSIDE],
    ['a dashboard with no App', { app: false, genie_space: false }],
  ];
  for (const [what, outputs] of placements) {
    const sent = await submitted({ ...outputs, inspire_url: 'https://evil.example.com' }, { headers: { 'x-forwarded-host': 'inspire.example.com' } });
    assert.equal(sent.status, 200, `${what}: ${JSON.stringify(sent.data)}`);
    assert.equal(sent.specs[0].outputs.inspire_url, 'https://inspire.example.com', `${what} carries the Inspire address`);
  }
  const neither = await submitted({ app: false, genie_space: true, dashboard: false, inspire_url: 'https://evil.example.com' }, { headers: { 'x-forwarded-host': 'inspire.example.com' } });
  assert.equal(neither.status, 200, JSON.stringify(neither.data));
  assert.equal(neither.specs[0].outputs.inspire_url, '', 'a spec with neither an App nor a dashboard carries no address');
  for (const [what, options] of [['no address of its own', {}], ['an address with a port', { headers: { 'x-forwarded-host': 'inspire.example.com:8443' } }]]) {
    const refused = await submitted({ app_placement: 'use_case', inspire_url: 'https://evil.example.com' }, { proxy: '', ...options });
    assert.equal(refused.status, 400, `${what}: ${JSON.stringify(refused.data)}`);
    assert.equal(refused.data.error, I.IMPLEMENT_APP_HOSTED_ERRORS.inspire_url, `${what}: Inspire never builds a page without its address, and never the browser one`);
    assert.deepEqual(refused.specs, [], `${what}: nothing is written`);
  }
  for (const [value, expected] of [['https://inspire-ai-1.aws.example.com/', 'https://inspire-ai-1.aws.example.com'], ['https://A.Example.com/x?y#z', 'https://a.example.com'],
    ['inspire.example.com', 'https://inspire.example.com'], ['http://inspire.example.com', ''], ['https://u:p@inspire.example.com', ''], ['not a url', ''], ['', ''],
    ['https://inspire.example.com:8443', ''], ['https://inspire.example.com:443/', 'https://inspire.example.com']]) {
    assert.equal(I.inspireBaseUrl(value), expected, value);
  }
  for (const outputs of [INSIDE, { app_placement: 'domain', app_name: 'inspire-customer' }, { app: false, genie_space: false }]) {
    for (const bad of ['https://inspire.example.com/run', 'https://inspire.example.com:8443', 'http://inspire.example.com', '', '   ', 5, null]) {
      assert.deepEqual(spec({ ...outputs, inspire_url: bad }).errors, [I.IMPLEMENT_APP_HOSTED_ERRORS.inspire_url], `${JSON.stringify(outputs)} ${String(bad)}`);
    }
  }
  assert.equal(spec({ ...INSIDE, inspire_url: '  HTTPS://Inspire.Example.COM ' }).spec.outputs.inspire_url, 'https://inspire.example.com');
  assert.equal(spec({ ...INSIDE, inspire_url: 'https://inspire.example.com/' }).spec.outputs.inspire_url, 'https://inspire.example.com', 'one trailing slash is dropped');
  assert.equal(spec({ app_placement: 'domain', app_name: 'inspire-customer', inspire_url: 'https://inspire.example.com' }).spec.outputs.inspire_url, 'https://inspire.example.com');
  assert.equal(spec({ app: false, genie_space: true, dashboard: false, inspire_url: 'not an address' }).spec.outputs.inspire_url, '');
  assert.match(I.IMPLEMENT_APP_HOSTED_ERRORS.inspire_url, /every App page and dashboard links to its use case on Inspire's Review page$/);
  for (const name of ['app', 'dashboard']) assert.ok(I.IMPLEMENT_OUTPUT_OPTIONS[name].includes('inspire_url'), `a new address refreshes the ${name}`);
});

test('a version saved before Inspire stamped its address gains it at the next submit, which refreshes the App and the dashboard once; one saved with it is unchanged', () => {
  const asked = { ...spec({ app_placement: 'use_case' }).spec, based_on_version: 1 };
  const saved = (address) => I.parseImplementRow({ session_id: '42', use_case_id: 'N01-U01', spec_version: '1', status: 'ready', dashboard_id: 'd1', genie_space_id: 'g1',
    app_name: 'churn-desk', notebook_path: '/W/impl/N01-U01', asset_status: JSON.stringify({ notebook: { state: 'ready', spec_version: 1, result_history: 1 } }),
    spec_json: JSON.stringify({ ...asked, based_on_version: null, outputs: { ...asked.outputs, inspire_url: address } }) });
  const before = I.planSubmission([saved('')], asked);
  assert.deepEqual([before.unchanged, before.summary.classes, [...before.summary.refresh].sort()], [false, ['outputs'], ['app', 'dashboard']],
    'the first submit puts the Review link on the App and the dashboard');
  const same = I.planSubmission([saved('https://inspire.example.com')], asked);
  assert.deepEqual([same.unchanged, same.summary.classes, same.summary.refresh], [true, [], []], 'the same address is no change');
});

test('the run pages view is one exported function: owner flags, paths and states, and no owner list, source or clash detail leaves it', () => {
  const pages = I.runPages([
    row('42', 'N01-U01', 2, 'ready', { app: insideApp(hosted('n01-u01-42', 2)) }),
    row('43', 'N02-U01', 1, 'ready', { appName: 'inspire-hub-acme', appUrl: 'https://inspire-hub-acme.example.com', by: OTHER }),
  ]);
  const asked = [];
  const view = I.runPagesView(pages, { who: ` ${OWNER.toUpperCase()} `, stateOf: (id, opts) => { asked.push([id, opts.owner]); return { state: 'ready', reason: '', error: '' }; } });
  assert.deepEqual(asked, [['n01-u01-42', true]]);
  const [app, inside] = [view.find((p) => p.kind === 'app'), view.find((p) => p.kind === 'inspire')];
  assert.deepEqual([inside.owner, inside.state, inside.path], [true, 'ready', '/run/n01-u01-42/#/n01_u01']);
  assert.deepEqual([app.owner, Object.hasOwn(app, 'path')], [false, false]);
  for (const page of view) for (const key of ['owners', 'hosted', 'conflict']) assert.equal(Object.hasOwn(page, key), false, key);
  assert.deepEqual(I.runPagesView(pages).find((p) => p.kind === 'inspire').state, 'stopped', 'with no host every page reads as stopped');
  assert.deepEqual(I.runPagesServed(pages).map((p) => p.id), ['n01-u01-42']);
});

test('the wizard says plainly what happens to the App a use case has when its page moves Inside Inspire, and can go back to it', async () => {
  const W = await lib('implementWizard.js');
  const C = await lib('implementControl.js');
  const start = W.defaultSpecFromUseCase({ id: 'N01-U01', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', business_domain: 'Retention' },
    { warehouseId: 'wh1', inspireDatabase: 'main.inspire', owner: OWNER, businessName: 'Acme' });
  const held = { ...start, outputs: { ...start.outputs, app_name: 'churn-desk', app_placement: 'use_case', app_access: 'sp', app_backend: 'lakebase' } };
  const inside = W.withNewApp(held, 'inspire', null, {});
  assert.equal(C.insideMoveNote(inside, 'churn-desk'),
    "churn-desk is left as it is and no longer refreshed; Inspire runs this use case's page in its Run tab instead and deletes nothing.");
  const shared = { app: { id: 'inspire-hub-acme', use_cases: [{ session_id: '42', use_case_id: 'N01-U01', name: 'Mine' },
    { session_id: '42', use_case_id: 'N01-U02', name: 'Price right' }, { session_id: '43', use_case_id: 'N02-U01', name: 'Plan shifts' }] } };
  assert.equal(C.insideMoveNote(inside, 'inspire-hub-acme', { shared, sessionId: '42', useCaseId: 'N01-U01' }),
    "inspire-hub-acme also holds the pages of Price right and Plan shifts, so it keeps what Inspire built there for this use case; Inspire no longer "
    + "refreshes this use case's pages in it and runs them in its Run tab instead.");
  assert.match(C.insideMoveNote(inside, 'inspire-hub-acme', { joinedBefore: 'inspire-hub-acme' }), /^inspire-hub-acme is shared with other use cases, so it keeps what Inspire built there/);
  assert.equal(C.insideMoveNote(held, 'churn-desk'), '', 'no note while the page stays in its App');
  assert.equal(C.insideMoveNote(inside, ''), '', 'no note for a use case with no App yet');
  const back = W.withHeldApp(inside, held.outputs);
  assert.deepEqual([back.outputs.app_placement, back.outputs.app_name, back.outputs.app_access, back.outputs.app_backend, back.outputs.merge.app],
    ['use_case', 'churn-desk', 'sp', 'lakebase', ''], 'Keep it puts back the App the use case has');
  const joinedBack = W.withHeldApp(inside, { ...held.outputs, app_name: 'inspire-hub-acme', app_placement: 'inspire', merge: { app: 'inspire-hub-acme' } });
  assert.deepEqual([joinedBack.outputs.app_placement, joinedBack.outputs.merge.app], [W.APP_PLACEMENT_DEFAULT, 'inspire-hub-acme']);
});

test('a #/run/<id> link names a page to open on the Run tab; anything else is not a Run link', async () => {
  const R = await lib('runPages.js');
  assert.equal(runIdOf(R, '#/run/n01-u01-42'), 'n01-u01-42');
  assert.equal(runIdOf(R, '#/run/n01%2Du01'), 'n01-u01');
  for (const bad of ['#/run/N01-U01', '#/run/a_b', '#/run/', '#/run/%E0%A4%A']) assert.equal(runIdOf(R, bad), '', bad);
  for (const none of ['', '#/', '#/build/x', '#/run/a/b', '#/run', '#run/a']) assert.equal(runIdOf(R, none), null, none);
  assert.equal(R.runUnknownText('n09-u09-x'), 'Inspire has no page n09-u09-x Inside Inspire that you can open: it may be uninstalled, moved to an App of its own, '
    + 'or not shared with you. Here is every deployed use case.');
  assert.equal(R.runUnknownText(''), 'That link names no page Inside Inspire. Here is every deployed use case.');
});

test("every Run tab link line the agent writes in the weekly email, from the shared fixture, opens its page on Inspire's Run tab", async () => {
  const R = await lib('runPages.js');
  const { digest_lines: lines, contract_tables: tables } = require('./fixtures/implement_change_classes.json');
  const hosted = lines.filter((entry) => entry.hosted_id && entry.inspire_url);
  assert.equal(hosted.length, 2);
  for (const entry of hosted) {
    assert.ok(entry.line.startsWith(`${tables.IMPLEMENT_APP_HOSTED_EMAIL}: `), entry.name);
    const link = new URL(entry.line.slice(tables.IMPLEMENT_APP_HOSTED_EMAIL.length + 2));
    assert.equal(link.origin, I.inspireBaseUrl(entry.inspire_url), entry.name);
    assert.equal(link.hash, '', 'the email link carries no fragment, which a sign-in can drop');
    assert.equal(runIdOf(R, new URL(R.queryLink(link), link.origin).hash), entry.hosted_id, entry.name);
    assert.ok(I.IMPLEMENT_APP_HOSTED_ID_RE.test(entry.hosted_id), entry.hosted_id);
  }
  assert.ok(hosted.some((entry) => entry.hosted_id.length === 63), 'the longest id the agent makes');
  assert.equal(runIdOf(R, `#/run/${'x'.repeat(64)}`), '', '64 characters is no page id');
  assert.deepEqual(lines.filter((entry) => entry.hosted_id && !entry.inspire_url).map((entry) => entry.line), [''], 'with no address there is no Run tab line');
});

test('parity: the App offers exactly the placements the bundled agent notebook validates', () => {
  const cell = JSON.parse(bundledNotebookText()).cells[1].source;
  const source = Array.isArray(cell) ? cell.join('') : String(cell);
  assert.deepEqual(pythonTuple(source, 'IMPLEMENT_APP_PLACEMENTS'), I.IMPLEMENT_APP_PLACEMENTS,
    'the bundled agent notebook must carry the inspire placement; re-bundle the agent notebook that adds it');
});

test('a ?run=<id> query, which a sign-in keeps, becomes the #/run/<id> hash with every other query kept, and the Run hash follows the page shown', async () => {
  const R = await lib('runPages.js');
  assert.equal(R.queryLink({ pathname: '/', search: '?run=n01-u01-42', hash: '' }), '/#/run/n01-u01-42');
  assert.equal(R.queryLink({ pathname: '/', search: '?a=1&run=n01-u01-42&b=2', hash: '#/run/n09-u09-x' }), '/?a=1&b=2#/run/n01-u01-42',
    'the email link wins over a hash already there');
  assert.equal(R.queryLink({ pathname: '/', search: '?run=Not An Id', hash: '' }), '/#/run/Not%20An%20Id');
  assert.equal(runIdOf(R, '#/run/Not%20An%20Id'), '', 'a bad id still opens the plain Run tab with its reason');
  assert.equal(R.queryLink({ pathname: '/', search: '?run=', hash: '' }), '/#/run/');
  assert.equal(runIdOf(R, '#/run/'), '');
  assert.equal(R.queryLink({ pathname: '/', search: '?open=app', hash: '#/run/x' }), '', 'no run query leaves the address alone');
  assert.equal(R.queryLink(), '');
  assert.equal(R.runHashLink({ pathname: '/', search: '?open=app', hash: '' }, 'n01-u01-42'), '/?open=app#/run/n01-u01-42');
  assert.equal(R.runHashLink({ pathname: '/', search: '', hash: '#/run/n01-u01-42' }, 'n01-u01-42'), null, 'nothing to change');
  assert.equal(R.runHashLink({ pathname: '/', search: '', hash: '#/run/n01-u01-42' }, null), '/', 'leaving the Run tab clears its hash');
  assert.equal(R.runHashLink({ pathname: '/', search: '', hash: '#/somewhere' }, null), null, 'a hash that is not a Run link is left alone');
  assert.equal(R.RUN_LEFT_DEMO, 'You left the demo to open this link, because it names a page in your workspace and the demo runs only its own '
    + 'recorded MVP Apps. To see the demo again, choose See Demo on the home page.');
});
