import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { MVP_JOB, RESULTS, STUDIO_STATE, built, builtSpec } from './implementFixtures.js';
import { REVIEW_PORTFOLIO, REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';
import { closeAsset, closeBrowser, expandBuild, openAsset, openUi, until } from './uiSupport.mjs';
import { apiWatch, keepToOrigins, openShowcase, readOnlyInspire, recordMvpApp, routeInspireDemo, tabButton, walkInspireDemo, walkMvpViews, watchOffline } from '../../../scripts/showcaseRecorder.mjs';
import { DEMO_READS, DEMO_READS_WHEN, routeOf, unrecorded } from '../../../scripts/showcaseRoutes.mjs';
import { SHOWCASE_ALERT_NOTE, SHOWCASE_BUTTON, SHOWCASE_DASHBOARD_NOTE, SHOWCASE_GENIE_NOTE, SHOWCASE_NOTE, SHOWCASE_OPEN_APP, SHOWCASE_PAGES } from '../../src/lib/showcase.js';
import { START_MVP_LABEL } from '../../src/lib/implementWizard.js';
import { APP_TABS } from '../../src/lib/tabs.js';
import { PORTFOLIO_GROUPS } from '../../src/lib/reviewFigures.js';

const require = createRequire(import.meta.url);
const { DEMO_HOST, SHOWCASE_MAX_BYTES, makeRecorder, showcaseLeaks, showcaseSizeProblem, showcaseText } = require('../../../backend/lib/showcaseRecord.js');
const { SHOWCASE_HEADER, SHOWCASE_READ_ONLY, registerShowcaseRoutes, showcaseMvpPath } = require('../../../backend/lib/showcase.js');

test.after(closeBrowser);

const DEMO = { id: 'acme', title: 'Acme retail', business: 'Acme', summary: 'Use cases Inspire found on the Acme sales data.' };
const MVP_URL = STUDIO_STATE.history[0].app_url;
const HOSTED = showcaseMvpPath(DEMO.id, 'N01-U01');
const NOTEBOOK = '/Workspace/Shared/inspire/n01_u03_segment_shoppers.py';
const NOTEBOOK_TEXT = '# Segment shoppers\nSELECT customer_id, SUM(amount) FROM main.s.orders GROUP BY customer_id';
const withUseCase = (results, no, extra) => ({
  ...results,
  domains: results.domains.map((d) => ({ ...d, use_cases: d.use_cases.map((u) => (u.No === no ? { ...u, ...extra } : u)) })),
});
const CHURN_KEY = { use_case_key: 'acme:predict-churn' };
const DEMO_RESULTS = withUseCase(withUseCase(RESULTS, 'N01-U03', { notebook_path: NOTEBOOK }), 'N01-U01', { ...CHURN_KEY, tables_involved: 'main.s.orders' });
const DEMO_RUN = { ...REVIEW_SESSIONS[0], usecase_overview: { total: 6, high: 2, meets: 6, below: 0, domains: 2, unread: {}, preview_use_cases: [{ Name: 'Predict churn' }, { Name: 'Forecast stock' }] } };
const RUN_STEPS = [
  { step_id: '1', stage_name: 'Discovery', step_name: 'Read the tables', status: 'ended_success', last_updated: '2026-10-31T09:10:00Z', message: 'Read 4 tables', progress_increment: 20 },
  { step_id: '2', stage_name: 'Use Case Generation', step_name: 'Write the use cases', status: 'ended_success', last_updated: '2026-10-31T09:40:00Z',
    message: 'Wrote 6 use cases', progress_increment: 70 },
  { step_id: '3', stage_name: 'Use Case Generation', step_name: 'Score the use cases', status: 'ended_success', last_updated: '2026-10-31T09:50:00Z',
    message: 'Scored 3 use cases', progress_increment: 10, session_id: '42',
    result_json: { prompt_name: 'BASE_USE_CASE_GEN_PROMPT', use_cases_count: 3, prompt: 'p'.repeat(40000), response: 'r'.repeat(60000),
      use_cases: ['Predict churn', 'Score upsell', 'Forecast stock'].map((Name, i) => ({ No: `N0${i + 1}-U01`, Name, Statement: 's'.repeat(2000) })) } },
];
const DEMO_ALERTS = {
  on: true, reason: '', built: '', unread: 0, caps: { used: 1, app: 20, mine: 1, person: 10 }, schedules: [{ id: 'daily', label: 'every day' }],
  operators: [{ id: '>=', label: 'is at least' }], baseline_operators: [], operator_words: {}, measures: [{ id: 'act_now', label: 'Act now rows' }],
  admin: false, filters: [], built_alert: null, person: 'owner@example.com', can_add: true, why: '',
  alerts: [{ id: 'w1', name: 'Act now over 5', state: 'ok', kind: 'watch', rule: 'Act now rows are at least 5', scope: '', schedule: 'daily',
    checked: '2026-10-31T09:00:00Z', email_count: 1, notify_on_ok: true, by: 'owner@example.com', can_change: true, url: '' }],
};
const STATE = {
  ...STUDIO_STATE, results: DEMO_RESULTS, useCases: [], ...REVIEW_PORTFOLIO, sessions: [DEMO_RUN, ...REVIEW_SESSIONS.slice(1)],
  useCaseAlerts: { listing: async () => DEMO_ALERTS },
  feedback: { available: true, latest: [], history: [] },
  inspireSession: { ...DEMO_RUN, processing_status: 'done', results_json: null },
  runSteps: RUN_STEPS,
  notebooks: { [NOTEBOOK]: NOTEBOOK_TEXT },
};
const DEFAULTS = {
  envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com',
  warehouseId: 'wh1', inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai',
};
const SHELL = {
  'static/index.html': '<!doctype html><html><head><link rel="stylesheet" href="assets/index.css"></head><body><main class="app">Loading</main><script src="assets/app.js"></script></body></html>',
  'static/assets/app.js': "fetch('api/app').then((r) => r.json()).then((d) => { document.querySelector('.app').textContent = d.title; });",
  'static/assets/index.css': '.app { font: 16px sans-serif; }',
};
const WRITE_SQL = /\b(?:INSERT\s+INTO|UPDATE\s+\S+\s+SET|DELETE\s+FROM|MERGE\s+INTO)\b/i;
const serveDefaults = (app) => app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
const besidesRefusals = (errors) => errors.filter((e) => !/status of 403 \(Forbidden\)/.test(e));
const demoBar = (page) => page.getByRole('region', { name: 'Demo' });
const list = (page) => page.getByRole('region', { name: 'Use case list' });
const MVP_VIEW_IDS = ['build', 'app', 'dashboard', 'genie_space', 'alert', 'notebook', 'job'];
const VIEW_REGIONS = { build: ["Genie's build messages"], notebook: ['Settings', 'Target KPI'], job: ['Build and job', 'Run and schedule', 'History'] };
const FACTS_NOTES = { dashboard: SHOWCASE_DASHBOARD_NOTE, genie_space: SHOWCASE_GENIE_NOTE };
const HOSTED_OUTPUTS = ['app', 'dashboard', 'genie_space'];
const showView = async (page, id) => {
  if (id !== 'build') return openAsset(page, id);
  if (await page.locator('[data-mvp-panel]').count()) await closeAsset(page);
  await expandBuild(page);
  return page.locator('[data-mvp-progress]');
};
const runPane = (page) => page.getByRole('region', { name: 'Run and schedule', exact: true });
const demoWrite = (page, pathname) => page.evaluate(async ([to, header, id]) => {
  const r = await fetch(to, { method: 'POST', headers: { [header]: id, 'Content-Type': 'application/json' }, body: '{}' });
  return { status: r.status, error: (await r.json()).error };
}, [pathname, SHOWCASE_HEADER, DEMO.id]);
const READ_CONTROLS = ['Use case details', 'Check the live status now', 'Jump to latest', 'Search use cases', 'Close', 'Show progress', 'Hide progress'];
const READ_NAMES = [/^Versions of the /, /^Close the /, /\. Show (why|the build progress)$/];
const READ_PLACES = ['tab', 'use case list', 'asset filter', 'History'];
const readsOnly = (c) => READ_PLACES.includes(c.place) || READ_CONTROLS.includes(c.name) || READ_NAMES.some((name) => name.test(c.name));
const controlsOf = (page) => page.evaluate(() => [...document.querySelectorAll('[data-implement-page], [data-mvp-panel]')].flatMap((root) => [...root.querySelectorAll('button, input, select, textarea')]).map((el) => {
  const own = (node) => [...(node?.childNodes || [])].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim();
  const name = (el.getAttribute('aria-label') || own(el.labels?.[0]) || el.textContent || el.tagName).replace(/\s+/g, ' ').trim();
  const place = el.getAttribute('role') === 'tab' ? 'tab'
    : el.closest('nav[aria-label="Use cases"]') ? 'use case list'
      : el.closest('[role="group"][aria-label="Show use cases with"]') ? 'asset filter'
        : el.closest('section[aria-label="History"]') && el.hasAttribute('aria-expanded') ? 'History' : '';
  return { name, place, enabled: !el.disabled, title: el.getAttribute('title') || '' };
}));

let demoDir = '';

const LATE_MS = 2000;
const startReadsLate = (page) => page.addInitScript((ms) => {
  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const at = new URL(typeof input === 'string' ? input : input.url, window.location.href);
    if (!at.pathname.startsWith('/api/')) return real(input, init);
    return new Promise((resolve) => { setTimeout(resolve, ms); }).then(() => real(input, init));
  };
}, LATE_MS);

async function recordDemo({ late = false } = {}) {
  const exchanges = [];
  const blocked = [];
  const summary = { ...DEMO, session_id: '42', mvps: [] };
  const ui = await openUi('app', STATE, '', {
    mount: serveDefaults,
    init: async (page, origin) => {
      if (late) await startReadsLate(page);
      await routeInspireDemo(page, {
        origin, summary, real: { inspire_database: DEFAULTS.inspireDatabase, warehouse_id: DEFAULTS.warehouseId }, exchanges, blocked,
      });
    },
  });
  return { ui, exchanges, blocked };
}

function assertWalkSawEverything(walk) {
  assert.deepEqual([...walk.tabs].sort(), APP_TABS.map((t) => t.id).sort(), 'the walk visits every tab of the App');
  assert.equal(walk.start.totals, PORTFOLIO_GROUPS.flatMap((g) => g.cards).length, 'the walk saw every total across all runs on Start');
  assert.equal(walk.runs, 1, 'the walk saw only the demo run under Change run, never the other runs of the workspace');
  assert.equal(walk.results, 6, 'the walk opened every use case on the Results page');
  assert.equal(walk.build.length, 6, 'the walk opened every use case on the Build page');
  assert.deepEqual(walk.build.filter((b) => b.tabs.length).map(({ name, tabs }) => ({ name, tabs })), [{ name: 'Predict churn', tabs: MVP_VIEW_IDS }],
    'the walk opened Build progress and every asset of the one MVP, and a use case with no MVP has none');
  assert.deepEqual([...walk.build.find((b) => b.tabs.length).panels].sort(),
    ['Alerts of this use case', 'Build and job', 'History', 'Run and schedule', 'Settings', 'Target KPI'],
    'the walk saw the Settings and Alerts panels and every Build panel of the MVP');
  assert.equal(walk.run, 0, 'the walk opens the Run tab, which lists the MVP Apps of the demo file, so a recording has none there yet and reads nothing');
  assert.deepEqual({ runs: walk.start.runs, quick: walk.start.quick }, { runs: 1, quick: 1 }, 'the walk saw the demo run on Start and opened its quick view');
  assert.equal(walk.start.cards.length, 11, 'the walk clicked every card on Start');
  assert.deepEqual(walk.monitor, { steps: true }, 'the walk saw the steps of the run on Monitor');
}

test('the recording walk waits for what a slow page draws late: with every read of the App starting 2 s late it still sees every view, panel, card and step', async () => {
  const { ui, exchanges, blocked } = await recordDemo({ late: true });
  try {
    const walk = await walkInspireDemo(ui.page, { settle: apiWatch(ui.page) });
    assertWalkSawEverything(walk);
    assert.deepEqual(blocked, [], 'viewing the demo sends no write');
    assert.deepEqual(unrecorded(exchanges, { ...DEMO_READS, ...DEMO_READS_WHEN }), [], 'the slow walk still recorded every read the demo answers');
    assert.deepEqual(besidesRefusals(ui.pageErrors), []);
  } finally {
    await ui.close();
  }
});

test('recording the demo walks every Results and Build view through the read-only guard and changes nothing', async (t) => {
  const { ui, exchanges, blocked } = await recordDemo();
  const { page, made } = ui;
  try {
    const settle = apiWatch(page);
    const walk = await walkInspireDemo(page, { settle });
    assert.deepEqual(blocked, [], 'viewing the demo sends no write');
    assertWalkSawEverything(walk);
    assert.deepEqual([...SHOWCASE_PAGES].sort(), APP_TABS.map((t) => t.id).sort(), 'every tab of the App stays in the demo');
    assert.deepEqual(unrecorded(exchanges, { ...DEMO_READS, ...DEMO_READS_WHEN }), [], 'the walk recorded every read the demo answers');
    assert.deepEqual(exchanges.filter((x) => /[?&]session_id=(?!42(&|$))/.test(x.url)).map((x) => routeOf(x.method, x.url)), [],
      'the walk read no other run of the workspace');
    await tabButton(page, 'implement').click();
    await page.locator('nav[aria-label="Use cases"] section button', { hasText: 'Predict churn' }).click();
    await settle();
    await showView(page, 'job');
    assert.equal(await runPane(page).getByRole('button', { name: 'Preview re-run' }).isDisabled(), true, 'the demo offers no re-run');
    assert.deepEqual(await demoWrite(page, '/api/inspire/implement/rerun'), { status: 403, error: SHOWCASE_READ_ONLY });
    assert.deepEqual(blocked, ['POST /api/inspire/implement/rerun'], 'the recorder refuses a write before it reaches the workspace');
    assert.equal(made.jobs.length, 0);
    assert.deepEqual(made.sqlCalls.filter((c) => WRITE_SQL.test(String(c.sql))).map((c) => c.sql), []);
    assert.deepEqual(made.fetches.filter((f) => String(f.opts.method || 'GET').toUpperCase() !== 'GET').map((f) => f.path), []);
    const recorder = makeRecorder({
      ...DEMO, sessionId: '42', replace: { 'amr@x': 'person@example.com' }, mvps: [{ id: 'N01-U01', title: 'Predict churn', url: MVP_URL }],
    });
    for (const x of exchanges) recorder.addInspire(x);
    recorder.addMvp('N01-U01', { method: 'GET', url: `${MVP_URL}/api/app`, status: 200, body: { title: 'Churn desk' } });
    const bundle = recorder.bundle();
    assert.deepEqual(showcaseLeaks(bundle, ['amr@x']), []);
    assert.equal(showcaseSizeProblem(bundle), '');
    const step = bundle.inspire['GET /api/inspire/steps?session_id=42'].body.steps.find((s) => s.step_id === '3');
    assert.deepEqual(Object.keys(step.result_json).sort(), ['prompt_name', 'use_cases', 'use_cases_count'], 'the prompt and the response of a step are never recorded');
    assert.deepEqual(step.result_json.use_cases.map((u) => Object.keys(u).sort().join()), ['Name,No', 'Name,No', 'Name,No']);
    t.diagnostic(`the walk recorded ${Buffer.byteLength(showcaseText(bundle))} bytes, under the cap of ${SHOWCASE_MAX_BYTES}`);
    const notebook = Object.entries(bundle.inspire).filter(([key, answer]) => key.startsWith('GET /api/workspace/export?') && answer.status === 200);
    assert.deepEqual(notebook, [], 'a use case card opens its notebook in the workspace, so the demo records no notebook text');
    const text = JSON.stringify(bundle);
    assert.ok(!text.includes(new URL(MVP_URL).host), 'the MVP App host is gone');
    assert.ok(text.includes(`"app_url":"${HOSTED}"`), 'the App link points at the MVP hosted in Inspire');
    assert.ok(text.includes(`"dashboard_url":"${HOSTED}"`) && text.includes(`"genie_space_url":"${HOSTED}"`));
    demoDir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-showcase-'));
    fs.writeFileSync(path.join(demoDir, `${DEMO.id}.json`), JSON.stringify(bundle));
    assert.deepEqual(besidesRefusals(ui.pageErrors), []);
  } finally {
    await ui.close();
  }
});

test('the demo replays every view from the bundle with no workspace call, refuses changes in plain words, and Get Started or Leave demo leave it', async () => {
  assert.ok(demoDir, 'the recording test saved the demo');
  const ui = await openUi('app', STATE, '', {
    mount: (app) => {
      serveDefaults(app);
      registerShowcaseRoutes(app, { dir: demoDir, shellFiles: SHELL });
    },
  });
  const { page, made } = ui;
  const failed = [];
  const sent = [];
  page.on('response', (r) => {
    const p = new URL(r.url()).pathname;
    if ((p.startsWith('/api/') || p.startsWith('/showcase/')) && r.status() >= 400) failed.push(`${r.status()} ${r.request().method()} ${p}`);
  });
  page.on('request', (r) => {
    const p = new URL(r.url()).pathname;
    if (p.startsWith('/api/') && p !== '/api/showcase') sent.push({ path: p, demo: Boolean(r.headers()[SHOWCASE_HEADER]) });
  });
  const settle = apiWatch(page);
  try {
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await page.getByRole('button', { name: SHOWCASE_BUTTON, exact: true }).first().waitFor();
    await settle();
    const opened = sent.length;
    const read = { sql: made.sqlCalls.length, fetches: made.fetches.length };
    await page.getByRole('button', { name: SHOWCASE_BUTTON, exact: true }).first().click();
    await demoBar(page).getByText(SHOWCASE_NOTE).waitFor();
    const cards = list(page).locator('[aria-expanded]');
    await cards.first().waitFor();
    assert.equal(await cards.count(), 6);
    await page.getByRole('group', { name: 'MVPs' }).getByRole('button', { name: 'MVPs started: 1' }).waitFor();
    assert.equal(await page.locator('[data-portfolio], [data-portfolio-card]').count(), 0, 'the demo Review shows this run only, with no totals across runs');
    assert.equal(await page.getByRole('combobox', { name: 'MVP', exact: true }).locator('option[value="has"]').count(), 1, 'the demo filters by Has an MVP too');
    assert.equal(await page.getByRole('button', { name: START_MVP_LABEL }).count(), 0, 'the demo offers no new build');
    await cards.filter({ hasText: 'Predict churn' }).click();
    await settle();
    const feedback = list(page).getByRole('button', { name: /^(Accepted|Planned|Implemented|Reject)$/ });
    assert.deepEqual(await feedback.evaluateAll((els) => els.map((b) => [b.textContent.trim(), b.disabled, b.title])),
      ['Accepted', 'Planned', 'Implemented', 'Reject'].map((name) => [name, true, SHOWCASE_NOTE]), 'the demo shows the feedback buttons, disabled with the reason');
    assert.equal(await list(page).locator('[data-demo-note]').innerText(), SHOWCASE_NOTE, 'and says why in a calm note');
    assert.equal(await list(page).locator('[data-demo-note]').getAttribute('role'), 'note');
    await list(page).getByRole('button', { name: 'Open MVP' }).click();
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await page.locator('nav[aria-label="Use cases"] section button').first().waitFor();
    await page.locator('[data-asset-tiles]').waitFor();
    await settle();
    assert.equal((await page.locator('[data-pinned-name] h2').textContent()).trim(), 'Predict churn');
    const alertChip = page.locator('[data-asset-filter="alert"]');
    assert.match((await alertChip.innerText()).replace(/\s+/g, ' ').trim(), /^Alert [1-9]\d*$/, 'the demo counts its built alert, never Alert 0');
    assert.equal(await alertChip.isDisabled(), false);
    await page.locator('[data-progress-card]').waitFor();
    assert.equal(await page.locator('[data-mvp-panel]').count(), 0, 'a ready MVP opens on its tiles and its Build progress, with no drawer open');
    for (const name of ['Vibe/Add/Remove Features (0)', 'Uninstall all', START_MVP_LABEL]) assert.equal(await page.getByRole('button', { name, exact: true }).count(), 0, name);
    assert.equal(await page.locator('[data-vibe-features]').count(), 0, 'no Vibe/Add/Remove Features, with or without vibes waiting');

    let vibeCards = 0;
    const toMvp = [];
    let alertFacts = '';
    const tabs = await walkMvpViews(page, settle, async (id, panel) => {
      assert.equal(await page.getByRole('button', { name: /Uninstall/ }).count(), 0, `no Uninstall on the ${id} view`);
      assert.equal(await page.locator('textarea').count(), 0, `no vibe box on the ${id} view`);
      assert.equal(await page.getByRole('button', { name: /^(Add|Update) vibes?$|^Take it out$|^(Remove|Keep) “/ }).count(), 0, `no ask to add or remove on the ${id} view`);
      assert.equal(await page.locator('[data-vibe-box]').count(), 0);
      vibeCards += await panel.locator('[data-vibe-card]').count();
      if (id === 'alert') {
        alertFacts = await panel.locator('[data-asset-facts="alert"]').innerText();
        const alerts = panel.getByRole('region', { name: 'Alerts of this use case' });
        await alerts.getByText('Act now over 5', { exact: true }).waitFor();
        assert.equal(await alerts.locator('[data-demo-note]').innerText(), SHOWCASE_NOTE, 'the Alerts panel says why in the calm demo note');
        assert.deepEqual(await alerts.getByRole('button').evaluateAll((els) => els.map((b) => [b.textContent.trim(), b.disabled, b.title])),
          ['Add alert', 'Edit', 'Pause', 'Delete'].map((name) => [name, true, SHOWCASE_NOTE]), 'the demo lists the recorded alerts and disables every change with the reason');
        assert.equal(await alerts.locator('form').count(), 0);
      }
      const hrefs = await panel.locator('a[href]').evaluateAll((links) => links.map((a) => a.getAttribute('href')));
      assert.deepEqual(hrefs.filter((href) => href.startsWith(DEMO_HOST)), [], `no link on the ${id} view opens the made-up demo workspace`);
      for (const name of VIEW_REGIONS[id] || []) await panel.getByRole('region', { name, exact: true }).waitFor();
      if (id === 'notebook') {
        const tables = panel.locator('[data-settings-tables]');
        await tables.locator('[data-table]').first().waitFor();
        assert.equal(await tables.locator('[data-demo-note]').innerText(), SHOWCASE_NOTE, 'the tables of the MVP show read-only with the demo reason');
        assert.equal(await tables.getByRole('button').count() + await tables.locator('select').count(), 0, 'and offer no table change');
      }
      if (VIEW_REGIONS[id]) return;
      const asset = panel.locator(`[data-asset-panel="${id}"]`);
      await asset.waitFor();
      if (HOSTED_OUTPUTS.includes(id)) {
        assert.equal(await asset.getByRole('link', { name: 'Open', exact: true }).getAttribute('href'), HOSTED, `the ${id} Open link opens the MVP hosted in Inspire`);
      }
      if (!FACTS_NOTES[id]) return;
      const facts = panel.locator(`[data-asset-facts="${id}"]`);
      await facts.getByText(FACTS_NOTES[id], { exact: true }).waitFor();
      const link = facts.getByRole('link', { name: SHOWCASE_OPEN_APP });
      assert.equal(await link.getAttribute('href'), HOSTED, `the ${id} facts open the MVP hosted in Inspire`);
      const [mvp] = await Promise.all([page.context().waitForEvent('page'), link.click()]);
      await mvp.locator('.app', { hasText: 'Churn desk' }).waitFor();
      assert.equal(new URL(mvp.url()).pathname, HOSTED);
      await mvp.close();
      toMvp.push(id);
    });
    assert.deepEqual(tabs, MVP_VIEW_IDS, 'the demo shows Build progress and every asset of the MVP');
    assert.deepEqual(toMvp, ['dashboard', 'genie_space'], 'the Dashboard and the Agent drawers open the MVP App');
    assert.ok(vibeCards > 0, 'the part vibe cards show, read-only');
    assert.match(alertFacts, /Fires when: Act now rows in the latest run are at least 1/, 'the demo shows what fires the alert though its link is blanked');
    assert.match(alertFacts, /Notifies: owner@example\.com/);
    assert.ok(alertFacts.includes(SHOWCASE_ALERT_NOTE), 'the demo says why the alert has no link to open');
    assert.doesNotMatch(alertFacts, /No alert on this version/);

    await showView(page, 'job');
    assert.equal(await runPane(page).getByRole('button', { name: 'Preview re-run' }).isDisabled(), true, 'the demo offers no re-run');
    await closeAsset(page);
    await demoBar(page).getByText(SHOWCASE_NOTE).waitFor();
    assert.deepEqual(await demoWrite(page, '/api/inspire/implement/rerun'), { status: 403, error: SHOWCASE_READ_ONLY },
      'a write sent anyway is refused in plain words');
    await settle();

    await page.locator('header nav').getByRole('button', { name: /Run$/ }).click();
    const openFull = page.locator('[data-run-open="N01-U01"]');
    await openFull.waitFor();
    assert.equal(await page.locator('[data-run-frame]').count(), 0, 'the demo Run list never squeezes the MVP into a frame beside it');
    assert.equal(await page.locator('[data-run-page="demo:N01-U01"]').innerText().then((t) => t.includes('Predict churn')), true);
    assert.equal(await page.locator('[data-run-new-tab="N01-U01"]').getAttribute('href'), HOSTED);
    await openFull.click();
    await page.locator('[data-run-full="demo:N01-U01"]').waitFor();
    const runFrame = page.locator('[data-run-frame="N01-U01"]');
    assert.equal(await runFrame.getAttribute('src'), HOSTED, 'the demo Run tab opens the MVP App hosted in Inspire');
    await page.frameLocator('[data-run-frame="N01-U01"]').locator('.app', { hasText: 'Churn desk' }).waitFor();
    const viewport = page.viewportSize();
    assert.deepEqual(await runFrame.evaluate((el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.width, r.height]; }),
      [0, 0, viewport.width, viewport.height], 'the demo MVP fills the whole window, as it does on its own');
    assert.equal(await demoBar(page).count(), 0, 'the demo bar steps aside while the MVP fills the window');
    await page.locator('[data-run-control-toggle]').click();
    assert.equal(await page.locator('[data-run-full]').getByRole('note', { name: 'Demo' }).count(), 1, 'the Inspire menu still says it is a demo');
    await page.getByRole('button', { name: 'Back to Inspire', exact: true }).click();
    await page.locator('[data-run-page-root]').waitFor();
    await page.goBack();
    await page.locator('[data-run-full="demo:N01-U01"]').waitFor();
    await page.goForward();
    await page.locator('[data-run-page-root]').waitFor();
    assert.equal(await page.locator('[data-run-full]').count(), 0, 'browser back and forward move between the MVP and the Run list');
    await demoBar(page).getByText(SHOWCASE_NOTE).waitFor();
    await settle();

    await tabButton(page, 'choose').click();
    const startRun = page.locator('main [data-run="42"]');
    await startRun.waitFor();
    assert.equal(await page.locator('main [data-run]').count(), 1, 'Start lists the demo run alone');
    assert.equal(await startRun.locator('[data-latest-run]').count(), 1, 'Start marks the demo run as the latest run of its business');
    assert.equal(await page.getByTitle('Delete run').count(), 0, 'the demo offers no delete on Start');
    const startTotals = page.getByRole('region', { name: 'Across all runs' });
    await startTotals.locator('[data-portfolio-card="runs"] [data-card-value]', { hasText: '1' }).waitFor();
    assert.deepEqual(await startTotals.locator('[data-portfolio-card]').evaluateAll((els) => Object.fromEntries(els.map((el) => [el.getAttribute('data-portfolio-card'),
      el.querySelector('[data-card-value]').textContent.trim()]))), { businesses: '1', runs: '1', use_cases: '6', domains: '2', best_of_best: '2', mvps_started: '1',
      mvps_live: '1', apps: '1', dashboards: '1', genie_spaces: '1', alerts: '1' }, 'the Start totals count the demo run alone, though the workspace had 6 runs');
    const cardKeys = await startTotals.locator('button[data-portfolio-card]').evaluateAll((els) => els.map((el) => el.getAttribute('data-portfolio-card')));
    assert.equal(cardKeys.length, 11, 'every card of the demo is a link');
    const landed = {};
    for (const key of cardKeys) {
      const card = page.locator(`main button[data-portfolio-card="${key}"]`);
      const filters = (await card.getAttribute('aria-pressed')) !== null;
      await card.click();
      if (filters) {
        await page.locator(`main [data-run-filter="${key}"]`).waitFor();
        await page.locator('main [data-run="42"]').waitFor();
        landed[key] = `Start, ${await page.locator('main [data-run]').count()} run`;
      } else {
        await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
        await page.locator('nav[aria-label="Use cases"] section button').first().waitFor();
        landed[key] = 'Build';
        await tabButton(page, 'choose').click();
        await startRun.waitFor();
        await startTotals.locator('[data-portfolio-card="runs"] [data-card-value]', { hasText: '1' }).waitFor();
        await settle();
      }
      await demoBar(page).getByText(SHOWCASE_NOTE).waitFor();
    }
    assert.deepEqual(landed, { businesses: 'Start, 1 run', runs: 'Start, 1 run', use_cases: 'Start, 1 run', domains: 'Start, 1 run', best_of_best: 'Start, 1 run',
      mvps_started: 'Build', mvps_live: 'Build', apps: 'Build', dashboards: 'Build', genie_spaces: 'Build', alerts: 'Build' }, 'each card lands on a demo page');
    await page.locator('main button[title="Quick view use cases"]').click();
    await page.getByRole('button', { name: /Open in Review/ }).waitFor();
    await settle();
    await demoBar(page).getByText(SHOWCASE_NOTE).waitFor();

    await tabButton(page, 'monitor').click();
    await page.getByRole('heading', { name: 'Monitor', exact: true }).waitFor();
    await page.getByText('Inspire finished this run.').waitFor();
    await page.getByRole('heading', { name: 'Detailed Steps' }).waitFor();
    assert.match(await page.locator('main').innerText(), /2 stages · 3 steps/, 'Monitor lists the recorded steps of the run');
    await page.getByRole('button', { name: /Detailed Steps/ }).click();
    await page.getByRole('button', { name: /^Use Case Generation/ }).filter({ has: page.locator('h3') }).click();
    const named = await page.getByText('Forecast stock', { exact: true }).count();
    await page.getByText('Score the use cases', { exact: true }).click();
    await page.getByText('3 use cases', { exact: true }).waitFor();
    assert.equal(await page.getByText('Forecast stock', { exact: true }).count(), named + 1, 'a step recorded with only the fields Monitor shows still names its use cases');
    const heading = page.getByText(/^Use cases of /);
    await heading.waitFor();
    assert.doesNotMatch(await heading.innerText(), /\b42\b|\brun \d/, 'the use cases are named by the business and start, never by the internal run number');
    await page.getByText('Run completed', { exact: true }).waitFor();
    await settle();
    await demoBar(page).getByText(SHOWCASE_NOTE).waitFor();

    await tabButton(page, 'results').click();
    await page.getByRole('button', { name: 'Change run', exact: true }).click();
    const runCards = page.getByRole('group', { name: 'Runs' }).locator('button[data-run]');
    await runCards.first().waitFor();
    assert.deepEqual(await runCards.evaluateAll((els) => els.map((el) => el.getAttribute('data-run'))), ['42'], 'Review lists the demo run alone');
    assert.equal(await runCards.first().locator('[data-latest-run]').count(), 1, 'the run card shows the Latest Run badge');
    assert.match(await runCards.first().locator('[data-run-figures]').innerText(), /^6 use cases · 2 domains/, 'the run card shows the recorded figures');
    await runCards.first().click();
    await cards.filter({ hasText: 'Segment shoppers' }).click();
    await list(page).locator('[data-use-case-text="statement"]').first().waitFor();
    await settle();
    assert.equal(await list(page).getByText('SUM(amount) FROM main.s.orders', { exact: false }).count(), 0, 'the card shows no notebook preview');
    assert.equal(await list(page).getByRole('button', { name: /^Preview$/ }).count(), 0);

    assert.equal(made.sqlCalls.length - read.sql, 0, 'the demo reads nothing from the warehouse; only Start read the runs before it opened');
    assert.equal(made.fetches.length - read.fetches, 0, 'the demo calls no workspace API');
    assert.equal(made.jobs.length, 0);
    assert.deepEqual(failed, ['403 POST /api/inspire/implement/rerun'], 'every view had a saved answer');
    assert.ok(sent.length > opened, 'the demo read its saved answers');
    assert.deepEqual(sent.slice(opened).filter((s) => !s.demo).map((s) => s.path), [], 'every request in the demo was a demo request');
    assert.deepEqual(besidesRefusals(ui.pageErrors), []);

    await demoBar(page).getByRole('button', { name: 'Leave demo' }).click();
    await page.locator('[data-landing-actions]').first().waitFor();
    assert.equal(await demoBar(page).count(), 0);
    await openShowcase(page);
    await demoBar(page).waitFor();
    await settle();
    const before = sent.length;
    await demoBar(page).getByRole('button', { name: 'Get Started' }).click();
    await demoBar(page).waitFor({ state: 'detached' });
    await settle();
    assert.deepEqual(sent.slice(before).filter((s) => s.demo).map((s) => s.path), [], 'Get Started works on the real workspace');
  } finally {
    await ui.close();
    if (demoDir) fs.rmSync(demoDir, { recursive: true, force: true });
  }
});

const checksOf = (...items) => items.map(([ask, status, evidence]) => ({ ask, status, evidence }));
const BASE_ASSETS = JSON.parse(STUDIO_STATE.history[0].asset_status);
const WARNED_SPEC = { ...builtSpec(), outputs: { ...builtSpec().outputs, app_access: 'sp', app_backend: 'lakebase', dashboard_vibes: 'Put the weekly trend first\nArabic labels' } };
const WARNED = [
  built({
    spec_version: 2, status: 'ready_with_warnings', status_message: 'Genie Agent: space create 403', change_classes: 'outputs', spec_json: JSON.stringify(WARNED_SPEC),
    asset_status: JSON.stringify({
      ...BASE_ASSETS,
      dashboard: { state: 'ready', spec_version: 2, snapshot: true, vibes_checks: checksOf(['Put the weekly trend first', 'done', 'The first widget is the weekly trend'],
        ['Arabic labels', 'missing', 'The dashboard has no Arabic font']) },
      app: { ...BASE_ASSETS.app, spec_version: 2, backend: 'delta' },
      genie_space: { state: 'failed', error: 'space create 403', spec_version: 2 },
      kept: { assets: [{ output: 'dashboard', id: 'd0', version: 1, title: 'Weekly dashboard' }] },
    }),
  }),
  built({ asset_status: JSON.stringify({ ...BASE_ASSETS, dashboard: { state: 'ready', spec_version: 1, snapshot: true } }) }),
];
const NOTHING_BUILT = { result_rows: null, asset_status: null, dashboard_id: null, dashboard_url: null, genie_space_id: null, genie_space_url: null,
  app_name: null, app_url: null, alert_id: null, alert_url: null };
const EDITED_NOTEBOOK = built({
  spec_version: 2, status: 'failed', status_message: 'the notebook was edited after Inspire last built it, so this version did not rebuild it',
  asset_status: JSON.stringify({ ...BASE_ASSETS, notebook: { modified_at: 1, spec_version: 1, state: 'edited', edited_at: Date.UTC(2026, 9, 25, 5) } }),
});
const DEMO_WRITES = {
  build: [/^Retry the Genie Agent$/],
  app: [/^Stop the App$/, /^Switch to Lakebase$/],
  dashboard: [/^Unpublish$/, /^Roll back to version 1$/, /^Try again with the missing thing$/],
  genie_space: [/^Retry the Genie Agent$/],
  job: [/^(Pause|Resume) the schedule$/, /^Remove v1$/, /^Top K$/, /^Preview re-run$/, /^Schedule on$/],
};

async function openDemoBuild(history) {
  const blocked = [];
  const ui = await openUi('app', {
    ...STATE, history, job: MVP_JOB,
    responses: { 'GET /api/2.0/lakeview/dashboards/d1/published': [{ embed_credentials: false, revision_create_time: '2026-10-26T08:00:00.000Z' }] },
  }, '', {
    mount: serveDefaults,
    init: (page, origin) => routeInspireDemo(page, {
      origin, summary: { ...DEMO, session_id: '42', mvps: [] }, real: { inspire_database: DEFAULTS.inspireDatabase, warehouse_id: DEFAULTS.warehouseId },
      exchanges: [], blocked,
    }),
  });
  const settle = apiWatch(ui.page);
  try {
    await openShowcase(ui.page);
    await demoBar(ui.page).getByText(SHOWCASE_NOTE).waitFor();
    await list(ui.page).locator('[aria-expanded]').filter({ hasText: 'Predict churn' }).click();
    await settle();
    await list(ui.page).getByRole('button', { name: 'Open MVP' }).click();
    await ui.page.locator('[data-asset-tiles]').waitFor();
    await settle();
  } catch (e) {
    await ui.close();
    throw e;
  }
  return { ...ui, settle, blocked };
}

async function sweepView(page, id) {
  const controls = await controlsOf(page);
  const offending = controls.filter((c) => c.enabled && !readsOnly(c)).map((c) => c.name);
  assert.deepEqual(offending, [], `the ${id} view: every enabled control only reads`);
  const unexplained = controls.filter((c) => !c.enabled && !readsOnly(c) && c.title !== SHOWCASE_NOTE).map((c) => `${c.name}: ${c.title || 'no title'}`);
  assert.deepEqual(unexplained, [], `the ${id} view: every disabled write says why, in the words of the demo bar`);
  assert.equal(await page.locator('[data-vibe-box], [data-vibe-features], [data-vibe-features-dialog]').count(), 0, `the ${id} view has no vibe box and no Vibe/Add/Remove Features`);
  assert.equal(await page.locator('textarea').count(), 0, `the ${id} view has no box to type in`);
  assert.equal(await page.getByRole('button', { name: /^(Add vibes?|(Remove|Keep) “)/ }).count(), 0, `the ${id} view has no Add vibe and no Remove on an ask`);
  return controls;
}

test('the demo disables every control that writes in Build progress, on every tile and in every asset drawer, hides the vibe boxes, and leaves only the controls that read', async () => {
  const ui = await openDemoBuild(WARNED);
  const { page, made, settle, blocked } = ui;
  try {
    await page.locator('[data-asset-tile="app"][data-tile-kind="live"]').getByText('Running', { exact: true }).waitFor({ timeout: 20000 });
    const seen = {};
    const reads = new Set();
    for (const id of MVP_VIEW_IDS) {
      await showView(page, id);
      await settle();
      const controls = await sweepView(page, id);
      seen[id] = controls.filter((c) => !c.enabled).map((c) => c.name);
      for (const c of controls.filter((x) => x.enabled)) reads.add(c.place || c.name.replace(/(Versions of|Close) the .+/, '$1 the asset'));
      for (const want of DEMO_WRITES[id] || []) assert.ok(seen[id].some((name) => want.test(name)), `the ${id} view shows ${want} and it is disabled: ${seen[id].join(' | ')}`);
    }
    await showView(page, 'notebook');
    assert.equal(await page.locator('[data-mvp-panel="notebook"]').getByRole('region', { name: 'Target KPI', exact: true }).locator('p').textContent(),
      'No target KPI yet: this version was built before Inspire tracked one. The next version Inspire builds picks one.', 'the demo never points at Vibe/Add/Remove Features, which it hides');
    assert.deepEqual([...reads].sort(), ['Check the live status now', 'Close', 'Close the asset', 'Genie Agent: Failed. Show why', 'Hide progress', 'History',
      'Search use cases', 'Show progress', 'Use case details', 'Versions of the asset', 'asset filter', 'use case list'], 'the controls left enabled are the ones that read');
    await showView(page, 'dashboard');
    const card = page.locator('[data-vibe-card="dashboard"]');
    assert.equal(await card.count(), 1, 'the dashboard card still shows what was asked and how it was checked');
    const checks = card.locator('[data-checks]');
    await checks.getByText('You asked for 2 things. Done: 1 of 2.', { exact: true }).waitFor();
    assert.deepEqual(await checks.getByRole('listitem').evaluateAll((items) => items.map((li) => li.dataset.check)), ['done', 'missing'],
      'the demo shows each ask the dashboard was built with and how it was checked');
    assert.equal(await card.locator('[data-built-with], [data-held-ask]').count(), 0, 'and offers no Remove on them');
    assert.deepEqual(blocked, [], 'the demo sent no write');
    assert.equal(made.jobs.length, 0);
    assert.deepEqual(besidesRefusals(ui.pageErrors), []);
  } finally {
    await ui.close();
  }
  for (const [history, write] of [[[built({ status: 'failed', status_message: 'Genie stopped the build: no approved model yet', ...NOTHING_BUILT })], 'Try again'],
    [[EDITED_NOTEBOOK, built()], 'Rebuild and overwrite the edits']]) {
    const failed = await openDemoBuild(history);
    try {
      await failed.page.locator('[data-progress-card]').waitFor();
      await failed.page.getByRole('button', { name: write }).waitFor();
      assert.equal(await failed.page.getByRole('button', { name: write }).isDisabled(), true, `${write} waits outside the demo`);
      await sweepView(failed.page, `build (${write})`);
      assert.deepEqual(failed.blocked, []);
      assert.deepEqual(besidesRefusals(failed.pageErrors), []);
    } finally {
      await failed.close();
    }
  }
});

test('the demo Build progress card offers no Download diagnostics, Copy diagnostics or Report issue and reads no diagnostics, on a ready and on a failed build (must-exclude)', async () => {
  for (const history of [WARNED, [built({ status: 'failed', status_message: 'Genie stopped the build: no approved model yet', ...NOTHING_BUILT })]]) {
    const ui = await openDemoBuild(history);
    const reads = [];
    ui.page.on('request', (r) => { if (r.url().includes('/implement/diagnostics')) reads.push(r.url()); });
    try {
      const card = ui.page.locator('[data-progress-card]');
      await card.locator('[data-progress-show]').waitFor();
      await card.locator('[data-progress-show]').hover();
      await card.locator('[data-progress-show]').focus();
      await ui.page.keyboard.press('Tab');
      await ui.settle();
      assert.equal(await card.locator('[data-diagnostics-download], [data-diagnostics-copy], [data-diagnostics-report], [data-diagnostics-note]').count(), 0, `no diagnostics controls on ${history[0].status}`);
      for (const name of ['Download diagnostics', 'Copy diagnostics', 'Report issue']) {
        assert.equal(await ui.page.getByRole(name === 'Report issue' ? 'link' : 'button', { name }).count(), 0, `the demo has no ${name}`);
      }
      assert.equal(await card.getByText('no private or personal data').count(), 0, 'and no privacy note');
      assert.equal(await card.locator('[data-progress-actions] [data-progress-show]').count(), 1, 'Show progress stays in its row');
      assert.deepEqual(reads, [], 'the demo sends no diagnostics read');
      assert.deepEqual(ui.blocked, []);
      assert.deepEqual(besidesRefusals(ui.pageErrors), []);
    } finally {
      await ui.close();
    }
  }
});

test('a run link that arrives during the demo leaves the demo and opens the workspace Run tab with a plain note, from the demo Run tab too', async () => {
  const blocked = [];
  const ui = await openUi('app', STATE, '', {
    mount: serveDefaults,
    init: (page, origin) => routeInspireDemo(page, {
      origin, summary: { ...DEMO, session_id: '42', mvps: [] }, real: { inspire_database: DEFAULTS.inspireDatabase, warehouse_id: DEFAULTS.warehouseId },
      exchanges: [], blocked,
    }),
  });
  const { page } = ui;
  const runTab = page.locator('header nav button', { hasText: 'Run' });
  try {
    const note = 'You left the demo to open this link, because it names a page in your workspace and the demo runs only its own recorded MVP Apps. '
      + `To see the demo again, choose ${SHOWCASE_BUTTON} on the Start page.`;
    for (const from of ['Review', 'Run']) {
      await openShowcase(page);
      await demoBar(page).getByText(SHOWCASE_NOTE).waitFor();
      if (from === 'Run') {
        assert.equal(await runTab.isDisabled(), false, 'the demo has its own Run tab');
        await runTab.click();
        await page.locator('[data-run-page-root]').waitFor();
        assert.equal(await demoBar(page).count(), 1, 'the demo Run tab stays in the demo');
      }
      await page.evaluate(() => { window.location.hash = '#/run/n01-u01-a'; });
      await page.locator('[data-run-left-demo]').waitFor({ timeout: 20000 });
      assert.equal(await page.locator('[data-run-left-demo]').textContent(), note, `from the demo ${from} tab`);
      assert.equal(await demoBar(page).count(), 0, 'the demo is left, so the link never opens inside it');
      assert.equal(await page.evaluate(() => window.location.hash), '#/run/n01-u01-a');
      if (from === 'Review') {
        await page.locator('header button', { hasText: 'Inspire AI' }).click();
        await page.locator('[data-landing-actions]').first().waitFor({ timeout: 20000 });
      }
    }
    await page.locator('header nav button', { hasText: 'Review' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-run-page-root]'));
    await runTab.click();
    await page.locator('[data-run-page-root]').waitFor();
    assert.equal(await page.locator('[data-run-left-demo]').count(), 0, 'the note goes once the person moves on');
  } finally {
    await ui.close();
  }
});

test('a change the demo refuses shows as a calm note in plain words, and any other failure still shows as an error', async () => {
  let answer = [403, { error: SHOWCASE_READ_ONLY, showcase: true }];
  const ui = await openUi('results', { ...REVIEW_STATE, results: withUseCase(REVIEW_STATE.results, 'N01-U01', CHURN_KEY) }, '', {
    mount: (app) => {
      app.get('/api/inspire/feedback', (_req, res) => res.json({ available: true, latest: [], history: [] }));
      app.post('/api/inspire/feedback', (_req, res) => res.status(answer[0]).json(answer[1]));
    },
  });
  const { page } = ui;
  const calm = list(page).locator('[data-demo-note]');
  const red = list(page).locator('p.text-error-fg');
  try {
    await list(page).locator('[aria-expanded]').filter({ hasText: 'Predict churn' }).click();
    await list(page).getByRole('button', { name: 'Accepted', exact: true }).click();
    await calm.waitFor();
    assert.equal(await calm.innerText(), SHOWCASE_READ_ONLY);
    assert.equal(await calm.getAttribute('role'), 'note');
    assert.match(await calm.getAttribute('class'), /text-info-fg/);
    assert.equal(await red.count(), 0, 'the refusal is not shown as an error');
    answer = [500, { error: 'The warehouse is stopped' }];
    await list(page).getByRole('button', { name: 'Planned', exact: true }).click();
    await red.filter({ hasText: 'The warehouse is stopped' }).waitFor();
    assert.equal(await calm.count(), 0, 'a real failure is never dressed as the demo note');
  } finally {
    await ui.close();
  }
});

test('a page closed while the recorder still passes a read on leaves no stray error behind, so the error that ended the walk is the one reported', async () => {
  const stray = [];
  const onStray = (err) => stray.push(String(err && err.message ? err.message : err));
  process.on('unhandledRejection', onStray);
  let asked;
  const reached = new Promise((resolve) => { asked = resolve; });
  const slow = (app) => {
    serveDefaults(app);
    app.get('/api/slow-read', (_req, res) => { asked(); setTimeout(() => res.json({ ok: true }), 1500); });
  };
  const exchanges = [];
  const blocked = [];
  let late;
  const lateDone = new Promise((resolve) => { late = resolve; });
  const ui = await openUi('app', STATE, '', {
    mount: slow,
    init: (page, origin) => routeInspireDemo(page, {
      origin, summary: { ...DEMO, session_id: '42', mvps: [] }, real: { inspire_database: DEFAULTS.inspireDatabase, warehouse_id: DEFAULTS.warehouseId },
      exchanges, blocked, passed: (outcome) => { if (outcome.path === '/api/slow-read') late(outcome); },
    }),
  });
  try {
    await ui.page.evaluate(() => { fetch('/api/slow-read', { headers: { 'X-Inspire-Showcase': 'acme' } }).catch(() => null); });
    await reached;
    await ui.close();
    const outcome = await lateDone;
    await new Promise((resolve) => { setImmediate(resolve); });
    assert.ok(outcome.error, 'the recorder could not hand the late answer to the closed page');
    assert.deepEqual(stray, []);
    assert.deepEqual(exchanges, [], 'a read the closed page never got is not recorded (must-exclude)');
  } finally {
    process.off('unhandledRejection', onStray);
  }
});

test('the recorder fetches nothing from a host outside the App and its MVP Apps: a font link of an MVP page is refused, and the App itself still answers', async () => {
  const ui = await openUi('landing');
  try {
    const refused = [];
    await keepToOrigins(ui.page.context(), new Set([ui.origin]), refused);
    const font = 'https://fonts.googleapis.com/css2?family=Inter:wght@400';
    const got = await ui.page.evaluate(async ([outside]) => {
      const tryFetch = (url) => fetch(url).then((r) => r.status, () => 'refused');
      return { outside: await tryFetch(outside), own: await tryFetch('/test/ui/implement.html') };
    }, [font]);
    assert.deepEqual(got, { outside: 'refused', own: 200 });
    assert.deepEqual(refused, [font]);
  } finally {
    await ui.close();
  }
});

test('the MVP walk notices a table row that is a link to another screen, returns to the screen it walks before the next row, never counts on Escape to close what the row opened, and waits for a busy screen to draw its rows', async () => {
  const ui = await openUi('landing');
  try {
    const exchanges = [];
    const lines = [];
    const context = await ui.page.context().browser().newContext({ viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(8000);
    try {
      await recordMvpApp(context, { url: `${ui.origin}/test/ui/mvpWalkFixture.html`, exchanges, blocked: [], log: (line) => lines.push(line), rows: 2, questions: 0 });
    } finally {
      await context.close();
    }
    const seen = exchanges.map((x) => new URL(x.url).search).filter((q) => q.startsWith('?screen='));
    assert.deepEqual(seen, ['?screen=overview&row=0', '?screen=overview&row=1', '?screen=detail&row=0', '?screen=detail&row=1']);
    assert.deepEqual(lines, [`MVP App ${ui.origin}: walked 3 screens`]);
  } finally {
    await ui.close();
  }
});

test('the MVP walk asks every suggested question a chat page shows on any of its views, beyond the questions it asks in the Genie panel, so the demo replays each one', async () => {
  const ui = await openUi('landing');
  try {
    const exchanges = [];
    const lines = [];
    const context = await ui.page.context().browser().newContext({ viewport: { width: 1440, height: 1000 } });
    context.setDefaultTimeout(8000);
    try {
      await recordMvpApp(context, { url: `${ui.origin}/test/ui/mvpWalkFixture.html`, exchanges, blocked: [], log: (line) => lines.push(line), rows: 0, questions: 1 });
    } finally {
      await context.close();
    }
    const asked = exchanges.map((x) => new URL(x.url)).filter((u) => u.pathname === '/api/walk-ask').map((u) => u.searchParams.get('q'));
    assert.deepEqual(asked, ['Question 0', 'Question 1', 'Question 2']);
    assert.deepEqual(lines, ['Questions chat: Genie answered "Question 0"', 'Questions chat: Genie answered "Question 1"', 'Questions chat: Genie answered "Question 2"', `MVP App ${ui.origin}: walked 3 screens`]);
  } finally {
    await ui.close();
  }
});

test('the offline walk names every request to an outside host with the page and the file that made it, keeps page and console errors, and refuses every write to Inspire', async () => {
  const ui = await openUi('landing');
  const context = await ui.page.context().browser().newContext();
  try {
    const watch = await watchOffline(context, new Set([ui.origin]));
    const page = await context.newPage();
    const blocked = [];
    await readOnlyInspire(page, ui.origin, blocked);
    watch.at('Fixture');
    await page.goto(`${ui.origin}/test/ui/offlineWalkFixture.html`);
    await page.waitForFunction(() => window.walked && window.walked.read);
    await until(() => watch.found.pageErrors.length > 0, 'the page error');
    assert.deepEqual(await page.evaluate(() => window.walked), { outside: 'refused', write: 403, read: 200 });
    const report = watch.report();
    const fixture = `${ui.origin}/test/ui/offlineWalkFixture.html`;
    assert.deepEqual(report.outside.map((o) => [o.page, o.host, o.path]).sort(), [['Fixture', 'fonts.googleapis.com', '/css2'], ['Fixture', 'telemetry.example.com', '/ping']]);
    const served = (await (await fetch(fixture)).text()).split('\n').findIndex((line) => line.includes('fonts.googleapis.com')) + 1;
    assert.equal(report.outside.find((o) => o.host === 'fonts.googleapis.com').initiator, `parser ${fixture}:${served}`, 'the line of the served page that links the font');
    assert.match(report.outside.find((o) => o.host === 'telemetry.example.com').initiator, new RegExp(`^script ${fixture.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\?[^:]*)?:\\d+$`));
    assert.deepEqual(report.pageErrors, [{ page: 'Fixture', error: 'fixture page error' }]);
    assert.ok(report.consoleErrors.some((e) => e.page === 'Fixture' && e.error === 'fixture console error'), JSON.stringify(report.consoleErrors));
    assert.deepEqual(blocked, ['POST /api/inspire/implement/submit']);
  } finally {
    await context.close();
    await ui.close();
  }
});
