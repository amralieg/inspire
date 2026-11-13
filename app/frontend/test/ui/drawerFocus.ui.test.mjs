import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';
import { HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID } from './implementFixtures.js';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const built = () => {
  const made = defaultSpecFromUseCase(HARNESS_USE_CASE, { warehouseId: HARNESS_SETTINGS.warehouseId, inspireDatabase: HARNESS_SETTINGS.inspireDatabase, sessionId: HARNESS_SESSION_ID, owner: OWNER });
  return [{ session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', change_classes: 'initial', created_by: OWNER,
    updated_at: '2026-11-09T02:52:41Z', created_at: '2026-11-09T01:57:09Z', spec_json: JSON.stringify(made), job_id: '77',
    notebook_path: '/W/inspire/N01-U01', asset_status: JSON.stringify({ notebook: { state: 'ready', spec_version: 1 } }), status_message: '' }];
};

test('on page load the Build progress drawer stays closed, takes no focus and does not scroll the page; a click to open it moves focus into it', async () => {
  const ui = await openUi('implement', { history: built(), me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  const focusInPanel = () => page.evaluate(() => Boolean(document.activeElement?.closest('[data-progress-panel]')));
  try {
    await page.locator('[data-progress-show]').first().waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-progress-panel]').count(), 0, 'page load does not open the drawer');
    assert.equal(await focusInPanel(), false, 'nothing takes keyboard focus on page load');
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'page load does not scroll the page');
    await page.locator('[data-progress-show]').first().click();
    await page.locator('[data-progress-panel]').first().waitFor({ timeout: 15000 });
    await page.waitForFunction(() => Boolean(document.activeElement?.closest('[data-progress-panel]')), null, { timeout: 5000 });
    assert.equal(await focusInPanel(), true, 'a click to open the drawer moves focus into it');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a Build progress drawer opened by a build start does not take focus or scroll the page (the person keeps the Build Now button)', async () => {
  const { REVIEW_STATE } = await import('./reviewFixtures.js');
  const { built: builtRow } = await import('./implementFixtures.js');
  const measured = (high) => JSON.stringify({ status: 'measured', value_low: high / 2, value_high: high, currency: 'AED', text: `AED ${high} a year` });
  const evidence = (t) => JSON.stringify({ tables: { [t]: { columns: [] } } });
  const useCases = [
    { id: 'N01-U01', name_with_technique: 'Predict churn', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', value_estimate: measured(6000), data_evidence: evidence('main.s.orders'), inspire_score: '7.4' },
    { id: 'N01-U02', name_with_technique: 'Forecast weekly orders', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', value_estimate: measured(9000), data_evidence: evidence('main.s.orders'), inspire_score: '8.1' },
  ];
  const submits = [];
  const mount = (app) => {
    app.get('/api/defaults', (_req, res) => res.json({ envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1', inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' }));
    app.get('/api/showcase', (_req, res) => res.json({}));
    app.post('/api/inspire/implement/preflight', (_req, res) => res.json({ checks: {} }));
    app.post('/api/inspire/implement/submit', (req, res) => {
      submits.push(req.body);
      res.json({ session_id: '42', use_case_id: req.body.spec.use_case_id, spec_version: 1, summary: {}, warnings: [] });
    });
    app.get('/api/inspire/implement/history', (req, res, next) => {
      if (!submits.length) return next();
      const now = new Date().toISOString();
      return res.json({ latest: [{ use_case_id: submits[0].spec.use_case_id, session_id: '42', spec_version: 1, status: 'queued', created_at: now, updated_at: now, spec_json: JSON.stringify(submits[0].spec) }], notebook_run: null, notebook_run_error: '' });
    });
  };
  const ui = await openUi('app', { ...REVIEW_STATE, useCases, history: [builtRow({ use_case_id: 'N01-U01' })] }, '', { mount });
  const { page } = ui;
  try {
    await page.goto(`${page.url().split('#')[0]}#/build/42/N01-U01`).catch(() => {});
    await page.locator('[data-next-step-row="N01-U02"]').getByRole('button', { name: 'Build Now', exact: true }).waitFor({ timeout: 20000 });
    await page.locator('[data-next-step-row="N01-U02"]').getByRole('button', { name: 'Build Now', exact: true }).click();
    await page.waitForFunction(() => window.location.hash.includes('/build/42/N01-U02'), null, { timeout: 20000 });
    await page.locator('[data-progress-panel]').first().waitFor({ timeout: 20000 });
    await page.waitForTimeout(300);
    assert.equal(await page.evaluate(() => Boolean(document.activeElement?.closest('[data-progress-panel]'))), false, 'the drawer a build start opens does not take focus');
    assert.equal(await page.evaluate(() => window.scrollY), 0, 'the drawer a build start opens does not scroll the page');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
