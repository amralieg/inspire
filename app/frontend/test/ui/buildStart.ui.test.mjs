import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { built } from './implementFixtures.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const measured = (high) => JSON.stringify({ status: 'measured', value_low: high / 2, value_high: high, currency: 'AED',
  text: `AED ${high.toLocaleString('en-US')} a year, measured from the orders table` });
const evidence = (...tables) => JSON.stringify({ tables: Object.fromEntries(tables.map((t) => [t, { columns: [] }])) });
const USE_CASES = [
  { id: 'N01-U01', name_with_technique: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', value_estimate: measured(6000), data_evidence: evidence('main.s.orders'), inspire_score: '7.4' },
  { id: 'N01-U02', name_with_technique: 'Forecast weekly orders', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', value_estimate: measured(9000), data_evidence: evidence('main.s.orders'), inspire_score: '8.1' },
];
const STATE = { ...REVIEW_STATE, useCases: USE_CASES, history: [built({ use_case_id: 'N01-U01' })] };

// Build Now on a sibling use case that has no MVP yet: the Build page shows it, and once its build is running the progress drawer opens by itself.
test('starting a build while the use case is shown opens the Build progress drawer, and page load alone does not', async () => {
  const log = { submits: [] };
  const mount = (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
    app.post('/api/inspire/implement/preflight', (_req, res) => res.json({ checks: {} }));
    app.post('/api/inspire/implement/submit', (req, res) => {
      log.submits.push(req.body);
      res.json({ session_id: '42', use_case_id: req.body.spec.use_case_id, spec_version: 1, summary: {}, warnings: [] });
    });
    app.get('/api/inspire/implement/history', (req, res, next) => {
      if (!log.submits.length) return next();
      const id = log.submits[0].spec.use_case_id;
      return res.json({ latest: [{ use_case_id: id, session_id: '42', spec_version: 1, status: 'queued', created_at: new Date().toISOString(), updated_at: new Date().toISOString(), spec_json: JSON.stringify(log.submits[0].spec) }], notebook_run: null, notebook_run_error: '' });
    });
  };
  const ui = await openUi('app', STATE, '', { mount });
  const { page } = ui;
  try {
    await page.goto(`${page.url().split('#')[0]}#/build/42/N01-U01`).catch(() => {});
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor({ timeout: 20000 });
    await page.locator('[data-build-next-step]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-progress-panel]').count(), 0, 'page load alone does not open the drawer');
    await page.locator('[data-next-step-row="N01-U02"]').getByRole('button', { name: 'Build Now', exact: true }).click();
    await until(() => log.submits.length === 1, 'one build submitted');
    await page.waitForFunction(() => window.location.hash.includes('/build/42/N01-U02'), null, { timeout: 20000 });
    await page.locator('[data-progress-card]').waitFor({ timeout: 20000 });
    await page.locator('[data-progress-panel]').waitFor({ timeout: 20000 });
    assert.equal(await page.locator('[data-progress-card]').getAttribute('data-progress-open'), 'true', 'starting the build opens the drawer');
  } finally {
    await ui.close();
  }
});
