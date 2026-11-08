const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const { bundledBuildStamp, notebookBuildStamp, bundledNotebookText } = require('../lib/appShell');
const { makeApp, listen } = require('./support/implementApp');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const LATER = 'Not reliable yet: run 333333333333333 stopped before it wrote any record: the newest pickup is 2016-02-29, older than the freshness limit';
const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const SPEC = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, app: true, genie_space: false, alert: false } };
const CURRENT = bundledBuildStamp();
const row = (asset_status, extra = {}) => ({ session_id: '42', use_case_id: 'N01-U01', spec_version: 3, status: 'ready', job_id: '77', app_name: 'churn-app',
  app_url: 'https://churn-app.example.com', dashboard_id: 'd9', spec_json: SPEC, asset_status, updated_at: '2026-11-04T00:00:00Z', ...extra });
const STAMPED = { app: { state: 'ready', spec_version: 3 }, built_with: { version: CURRENT.version, shell: CURRENT.shell } };
const RC3 = { app: { state: 'ready', spec_version: 3 }, dashboard: { state: 'ready', spec_version: 3 } };

async function call(overrides, route, headers = {}) {
  const made = makeApp(overrides);
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${route}`, { headers });
    return { status: resp.status, data: await resp.json(), made };
  } finally {
    await srv.close();
  }
}

const rebuilt = (made) => made.fetches.some((f) => /run-now|runs\/submit|jobs\/(create|reset|update)|\/apps\b.*deploy/.test(f.path) && f.opts.method !== 'GET')
  || made.sqlCalls.some((c) => /^(INSERT|UPDATE|MERGE)/.test(String(c.sql).trim()) && String(c.sql).includes('__inspire_implement'));

test('the bundled notebook names the release and App shell an MVP gets when it is built now', () => {
  assert.match(CURRENT.version, /^v\d\.\d\.\d$/);
  assert.match(CURRENT.shell, /^[0-9a-f]{64}$/);
  assert.deepEqual(notebookBuildStamp(bundledNotebookText()), { version: CURRENT.version, shell: CURRENT.shell });
  assert.equal(I.IMPLEMENT_BUILT_WITH, 'built_with', 'the agent writes this record');
});

test('a scheduled run that turns unreliable after the build shows on the Build tile, in plain words, with the rebuild step (fail-before)', async () => {
  const W = await lib('implementWizard.js');
  const before = row(STAMPED);
  assert.equal(W.implementState(before).label, 'MVP ready', 'before this fix the tile read only the build-time record, so it said ready');
  const summary = [{ not_reliable: `  ${LATER}  `, updated_at: '2026-11-05T01:00:00Z' }];
  for (const route of [`/api/inspire/implement/status?${Q}`, `/api/inspire/implement/history?${Q}`]) {
    const got = await call({ history: [row(STAMPED)], moneySummary: summary }, route);
    assert.equal(got.status, 200, JSON.stringify(got.data));
    const latest = route.includes('/status') ? got.data.latest : got.data.latest[0];
    assert.deepEqual(latest.latest_run, { not_reliable: LATER, updated_at: '2026-11-05T01:00:00Z' }, route);
    const read = got.made.sqlCalls.find((c) => String(c.sql).includes('`churn_out_summary`'));
    assert.equal(read.sql, 'SELECT CAST(not_reliable AS STRING) AS not_reliable, CAST(updated_at AS STRING) AS updated_at FROM `main`.`inspire`.`churn_out_summary` '
      + 'WHERE use_case_id = :uc ORDER BY updated_at DESC NULLS LAST LIMIT 1', 'the same newest summary row the App and the build hold read');
    assert.deepEqual(read.parameters, [{ name: 'uc', value: 'N01-U01', type: 'STRING' }]);
    assert.deepEqual(W.implementState(latest), { group: 'held', label: W.UNRELIABLE_LABEL, tone: 'warning', kind: 'mvp' });
    assert.equal(W.statusReason(latest), `The latest run marked its results not reliable: ${LATER}. Its App pages show Not reliable yet until a run can be trusted. `
      + 'Next step: fix what it names, then build again with Vibe/Add/Remove Features.');
    assert.doesNotMatch(W.statusReason(latest), /not published/, 'this App was published before the run turned unreliable');
    assert.equal(rebuilt(got.made), false, 'reading the status never rebuilds');
  }
  assert.match(W.UNRELIABLE_REBUILD_NOTE, /not reliable yet.*rebuild/i);
});

test('a later reliable run clears a build-time hold, a missing summary holds nothing, and an unreadable summary keeps the build-time record', async () => {
  const W = await lib('implementWizard.js');
  const held = row({ ...STAMPED, not_reliable: { reason: 'the data ends on 2024-05-17', spec_version: 3 } });
  const cleared = await call({ history: [held], moneySummary: [{ not_reliable: null, updated_at: '2026-11-05T02:00:00Z' }] }, `/api/inspire/implement/status?${Q}`);
  assert.equal(cleared.data.latest.latest_run.not_reliable, '');
  assert.equal(W.implementState(cleared.data.latest).label, 'MVP ready', 'the newest run is trusted again');
  const none = await call({ history: [row(STAMPED)], moneySummary: [] }, `/api/inspire/implement/status?${Q}`);
  assert.deepEqual(none.data.latest.latest_run, { not_reliable: '', updated_at: '' });
  const missing = await call({ history: [held], sqlErrors: { churn_out_summary: '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`inspire`.`churn_out_summary` cannot be found.' } },
    `/api/inspire/implement/status?${Q}`);
  assert.equal(missing.status, 200);
  assert.deepEqual(missing.data.latest.latest_run, { not_reliable: '', updated_at: '' }, 'no summary table means no run has said anything yet');
  const denied = await call({ history: [held], sqlErrors: { churn_out_summary: '[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table main.inspire.churn_out_summary' } },
    `/api/inspire/implement/status?${Q}`);
  assert.equal(denied.status, 200, 'a summary this person cannot read never fails the Build page');
  assert.equal(Object.hasOwn(denied.data.latest, 'latest_run'), false);
  assert.equal(W.implementState(denied.data.latest).label, W.UNRELIABLE_LABEL, 'then the build-time record still holds');
  assert.doesNotMatch(JSON.stringify(denied.data), /INSUFFICIENT_PERMISSIONS/);
});

test('only a plain catalog.schema.table names the summary, so a spec cannot inject SQL', () => {
  assert.equal(I.runSummaryTable(row({})), 'main.inspire.churn_out_summary');
  assert.equal(I.runSummaryTable(row({}, { spec_json: { ...SPEC, config: { result_table: '`main`.`inspire`.`churn_out`' } } })), 'main.inspire.churn_out_summary');
  for (const bad of ['main.inspire', 'main.inspire.t; DROP TABLE x', 'a.b.c.d', '', null]) {
    assert.equal(I.runSummaryTable(row({}, { spec_json: { ...SPEC, config: { result_table: bad } } })), '', String(bad));
  }
  assert.equal(I.runSummaryTable({ spec_json: 'not parsed' }), '');
  assert.throws(() => I.latestRunStatement('main.in`spire.t_summary', 'N01-U01'));
});

test('an MVP built on an older release says so on its Build page and in the App list, with the rebuild action, and is never rebuilt on its own (rc.3-shaped record)', async () => {
  const W = await lib('implementWizard.js');
  const note = 'Built with an earlier Inspire release. Rebuild to get the latest fixes.';
  assert.equal(I.olderBuildNote([row(RC3)], CURRENT), note, 'an rc.3 record carries no stamp');
  assert.equal(I.olderBuildNote([row({ ...RC3, built_with: { version: 'v1.3.0', shell: 'a'.repeat(64) } })], CURRENT),
    'Built with Inspire v1.3.0. Rebuild to get the latest fixes.');
  assert.equal(I.olderBuildNote([row({ ...RC3, built_with: { version: CURRENT.version, shell: 'b'.repeat(64) } })], CURRENT),
    `Built with an earlier build of Inspire ${CURRENT.version}. Rebuild to get the latest fixes.`, 'a candidate of the same release with older App code');
  assert.equal(I.olderBuildNote([row(STAMPED)], CURRENT), '', 'must-exclude: a build of this release says nothing');
  assert.equal(I.olderBuildNote([row(RC3, { status: 'building_outputs' })], CURRENT), '', 'a build in flight is not old yet');
  assert.equal(I.olderBuildNote([row(RC3, { status: 'failed' })], CURRENT), '', 'a failed build already says what to do');
  assert.equal(I.olderBuildNote([row(RC3, { app_name: null, dashboard_id: null, job_id: null })], CURRENT), '', 'nothing built, nothing old');
  assert.equal(I.olderBuildNote([row(RC3)], { version: '', shell: '' }), '', 'with no bundled stamp nothing is called old');
  const status = await call({ history: [row(RC3)], moneySummary: [] }, `/api/inspire/implement/status?${Q}`);
  assert.equal(status.data.latest.older_build, note);
  assert.equal(W.olderBuildNote(status.data.latest), note);
  assert.equal(rebuilt(status.made), false, 'the note never starts a build');
  const fresh = await call({ history: [row(STAMPED)], moneySummary: [] }, `/api/inspire/implement/status?${Q}`);
  assert.equal(fresh.data.latest.older_build, '');
  const registry = [row(RC3), row(STAMPED, { use_case_id: 'N01-U02', app_name: 'other-app', spec_json: { ...SPEC, use_case_id: 'N01-U02', use_case_name: 'Score leads' } })]
    .map((r) => ({ ...r, spec_json: JSON.stringify(r.spec_json), asset_status: JSON.stringify(r.asset_status) }));
  const pages = await call({ registry, useCaseScope: [] }, '/api/run/pages?inspire_database=main.inspire&warehouse_id=wh1');
  assert.equal(pages.status, 200, JSON.stringify(pages.data));
  const byUc = Object.fromEntries(pages.data.pages.map((p) => [p.use_case_id, p.older_build]));
  assert.deepEqual(byUc, { 'N01-U01': note, 'N01-U02': '' });
  assert.equal(rebuilt(pages.made), false);
  const R = await lib('runPages.js');
  assert.equal(R.RUN_REBUILD, 'Open its Build page to rebuild');
});
