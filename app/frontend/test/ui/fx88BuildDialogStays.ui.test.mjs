import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_IT, closeBrowser, openUi, toSummary, until } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { built } from './implementFixtures.js';

// A fresh browser and server for each test: a build submitted in one test must not show as built in the next.
test.afterEach(closeBrowser);

// REQ-486: the final Build click keeps the dialog on screen, with a spinner and "Starting your build", until the Build page shows the build.
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const measured = (high) => JSON.stringify({ status: 'measured', value_low: high / 2, value_high: high, currency: 'AED',
  text: `AED ${high.toLocaleString('en-US')} a year, measured from the orders table` });
const evidence = (...tables) => JSON.stringify({ tables: Object.fromEntries(tables.map((t) => [t, { columns: [] }])) });
const USE_CASES = [
  { id: 'N01-U01', name_with_technique: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', value_estimate: measured(6000), data_evidence: evidence('main.s.orders'), inspire_score: '7.4' },
  { id: 'N01-U02', name_with_technique: 'Forecast weekly orders', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', value_estimate: measured(9000), data_evidence: evidence('main.s.orders'), inspire_score: '8.1' },
];
const BUILD_STATE = { ...REVIEW_STATE, useCases: USE_CASES, history: [built({ use_case_id: 'N01-U01' })] };
// No build exists yet, so the wizard never says "Nothing changed since version 1" (the harness plans every card as its one fixture use case).
const STATE = { ...REVIEW_STATE, history: [] };
const SUBMIT_MS = 2500;
const HISTORY_MS = 4000;
const STARTING = '[data-build-starting]';
// Same as startMvp, with a longer wait for the access check under load.
async function startMvp(page) {
  await toSummary(page);
  await page.waitForFunction((label) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === label && !b.disabled), BUILD_IT, { timeout: 30000 });
  await page.getByRole('button', { name: BUILD_IT, exact: true }).click();
}
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function mounter(log, { fail = false } = {}) {
  return (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
    app.post('/api/inspire/implement/submit', async (req, res) => {
      log.submits.push(req.body);
      await sleep(SUBMIT_MS);
      if (fail) { res.status(500).json({ error: 'The build could not start. Try again.' }); return; }
      log.answered = true;
      res.json({ session_id: '42', use_case_id: req.body.spec.use_case_id, spec_version: 1, summary: {}, warnings: [] });
    });
    // After the submit answers, the Build page history is slow: its rail has nothing to show for a while.
    app.get('/api/inspire/implement/history', async (req, res, next) => {
      if (!log.answered) return next();
      log.answered = 'reading';
      await sleep(HISTORY_MS);
      log.historyAnswered = true;
      const now = new Date().toISOString();
      const id = log.submits[0].spec.use_case_id;
      return res.json({ latest: [{ use_case_id: id, session_id: '42', spec_version: 1, status: 'queued', created_at: now, updated_at: now, spec_json: JSON.stringify(log.submits[0].spec) }], notebook_run: null, notebook_run_error: '' });
    });
  };
}

async function openResultsWizard(log, opts, which = 0) {
  const ui = await openUi('app', structuredClone(STATE), '', { mount: mounter(log, opts), build: null });
  const { page } = ui;
  await page.goto(`${page.url().split('#')[0]}#/review/42`).catch(() => {});
  const start = page.getByRole('region', { name: 'Use case list' }).getByRole('button', { name: /^Build MVP$/ }).nth(which);
  await start.waitFor({ timeout: 30000 });
  await start.click();
  await page.getByRole('dialog', { name: /Start Use Case MVP/ }).waitFor({ timeout: 20000 });
  return ui;
}

test('REQ-486 Results: the dialog stays with "Starting your build" and a spinner until the Build page shows the build', async () => {
  const log = { submits: [], answered: false, historyAnswered: false };
  const ui = await openResultsWizard(log, {}, 0);
  const { page } = ui;
  try {
    await startMvp(page);
    const starting = page.locator(STARTING);
    await starting.waitFor({ timeout: 1000 });
    assert.match(await starting.innerText(), /Starting your build/, 'a: the words are on screen within 1 s of the click');
    assert.ok(await starting.locator('.animate-spin').count() >= 1, 'a: with a spinner');
    assert.equal(log.answered, false, 'a: this is before the submit answered');
    await until(() => log.answered, 'the submit answers', 20000);
    assert.equal(await starting.isVisible(), true, 'b: still shown after the submit answered, before the Build page has its progress');
    const gone = await page.waitForFunction(() => (document.querySelector('[data-build-starting]') ? false : { card: Boolean(document.querySelector('[data-progress-card]')) }), null, { timeout: 30000, polling: 20 });
    assert.deepEqual(await gone.jsonValue(), { card: true }, 'c: gone only once the Build page shows this build (the pending entry counts)');
    assert.equal(log.submits.length, 1);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('REQ-486 Results: the Build button cannot submit twice', async () => {
  const log = { submits: [], answered: false, historyAnswered: false };
  const ui = await openResultsWizard(log, {}, 0);
  const { page } = ui;
  try {
    await page.waitForFunction((label) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === label), BUILD_IT, { timeout: 1 }).catch(() => null);
    await startMvp(page);
    await page.evaluate((label) => { for (const b of document.querySelectorAll('button')) if (b.textContent.trim() === label || b.textContent.trim() === 'Starting…') { b.click(); b.click(); } }, BUILD_IT);
    await page.locator(STARTING).waitFor({ timeout: 1000 });
    await sleep(SUBMIT_MS + 500);
    assert.equal(log.submits.length, 1, 'd: one submit');
  } finally {
    await ui.close();
  }
});

test('REQ-486 Results: a failing submit keeps the dialog and shows the error, with no starting cover left over', async () => {
  const log = { submits: [], answered: false, historyAnswered: false };
  const ui = await openResultsWizard(log, { fail: true }, 0);
  const { page } = ui;
  try {
    await startMvp(page);
    await page.locator(STARTING).waitFor({ timeout: 1000 });
    await page.locator('[role="dialog"]').getByText(/could not start/).waitFor({ timeout: 20000 });
    assert.equal(await page.locator(STARTING).count(), 0, 'e: the cover goes, the error shows');
    assert.equal(await page.getByRole('dialog', { name: /Start Use Case MVP/ }).isVisible(), true, 'e: the dialog stays');
  } finally {
    await ui.close();
  }
});

test('REQ-486 Build page: the dialog stays until the progress of this build is in view', async () => {
  const log = { submits: [], answered: false, historyAnswered: false };
  const ui = await openUi('app', structuredClone(BUILD_STATE), '', { mount: mounter(log), build: null });
  const { page } = ui;
  try {
    await page.goto(`${page.url().split('#')[0]}#/build/42/N01-U01`).catch(() => {});
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor({ timeout: 20000 });
    await page.locator('[data-build-next-step]').waitFor({ timeout: 20000 });
    await page.locator('[data-build-custom="N01-U02"]').click();
    await page.getByRole('dialog', { name: /Start Use Case MVP/ }).waitFor({ timeout: 20000 });
    await startMvp(page);
    const starting = page.locator(STARTING);
    await starting.waitFor({ timeout: 1000 });
    assert.match(await starting.innerText(), /Starting your build/);
    await until(() => log.answered, 'the submit answers', 20000);
    const gone = await page.waitForFunction(() => (document.querySelector('[data-build-starting]') ? false
      : { card: Boolean(document.querySelector('[data-progress-card]')), page: window.location.hash }), null, { timeout: 30000, polling: 20 });
    const seen = await gone.jsonValue();
    assert.equal(seen.card, true, 'gone only once the progress of this build is in view');
    assert.match(seen.page, /\/build\/42\/N01-U02/, 'and the Build page is on the use case that was built');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
