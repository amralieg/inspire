import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const LABELLED = { Name: 'Forecast stock', name_with_technique: 'Forecast stock using forecasting' };
const PLAIN = { Name: 'Spot late suppliers', name_with_technique: null };
const ago = (ms) => new Date(Date.now() - ms).toISOString();

test('Choose shows each run preview as the name with its technique, and a use case without one keeps its Name', async () => {
  const sessions = [{ session_id: '42', business_name: 'Acme Retail', completed_percent: 100, processing_status: 'done', create_at: ago(60000),
    usecase_overview: { total: 5, high: 2, domains: 1, preview_use_cases: [LABELLED, PLAIN] } }];
  const ui = await openUi('choose', { sessions });
  try {
    const row = ui.page.locator('[data-run="42"]').first();
    await row.waitFor({ timeout: 10000 });
    await row.getByText('Forecast stock using forecasting · Spot late suppliers', { exact: false }).waitFor();
    assert.doesNotMatch(await row.innerText(), /Spot late suppliers using/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Launch Quick view lists the name with its technique, and a use case without one keeps its Name', async () => {
  const sessions = [{ session_id: '42', business_name: 'Acme Retail', completed_percent: 100, processing_status: 'done', create_at: ago(60000) }];
  const useCases = [{ session_id: '42', id: 'N01-U01', No: 'N01-U01', ...LABELLED }, { session_id: '42', id: 'N01-U02', No: 'N01-U02', ...PLAIN }];
  const ui = await openUi('launch', { sessions, useCases });
  const { page } = ui;
  try {
    await page.getByRole('button', { name: /Discovery Overview/ }).click();
    const run = page.locator('li[data-run="42"]');
    await run.getByRole('button', { name: /Quick view/ }).click();
    const titles = run.locator('ul li span.font-semibold');
    await titles.first().waitFor();
    assert.deepEqual(await titles.allInnerTexts(), ['Forecast stock using forecasting', 'Spot late suppliers']);
    assert.deepEqual(ui.pageErrors.filter((line) => !/401|403|Failed to load resource/.test(line)), []);
  } finally {
    await ui.close();
  }
});

test('Monitor lists the use cases drafted so far by the name with its technique, and one without it keeps its Name', async () => {
  const steps = [{ step_id: '1', session_id: '42', stage_name: 'Generate', step_name: 'Use cases', sub_step_name: '', status: 'ended_success',
    message: '', progress_increment: 0, last_updated: ago(30000),
    result_json: { use_cases: [{ No: 'N01-U01', 'Business Domain': 'Supply', ...LABELLED }, { No: 'N01-U02', 'Business Domain': 'Supply', ...PLAIN }] } }];
  const mount = (app) => {
    app.get('/api/inspire/session', (_req, res) => res.json({ session: { session_id: '42', business_name: 'Acme Retail', create_at: ago(600000),
      processing_status: 'done', completed_percent: 37, completed_on: null, last_updated: ago(30000) } }));
    app.get('/api/inspire/steps', (req, res) => res.json({ steps: req.query.since ? [] : steps }));
    app.post('/api/inspire/ack', (_req, res) => res.json({ success: true }));
  };
  const ui = await openUi('monitor', {}, '&run=none', { mount });
  const { page } = ui;
  try {
    const live = page.getByText('2 use cases drafted so far').locator('xpath=ancestor::div[contains(@class, "rounded")][1]');
    await live.waitFor({ timeout: 15000 });
    const names = await live.locator('p.font-medium').allInnerTexts();
    assert.deepEqual(names, ['Forecast stock using forecasting', 'Spot late suppliers']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Choose says a run where nothing meets the quality bar has none that meets it, and never calls such use cases high priority (must-exclude)', async () => {
  const sessions = [
    { session_id: '42', business_name: 'Below Bar Retail', completed_percent: 100, processing_status: 'done', create_at: ago(60000),
      usecase_overview: { total: 67, high: 0, meets: 0, domains: 3, preview_use_cases: [PLAIN] } },
    { session_id: '43', business_name: 'Strong Retail', completed_percent: 100, processing_status: 'done', create_at: ago(120000),
      usecase_overview: { total: 20, high: 6, meets: 18, domains: 2, preview_use_cases: [LABELLED] } }];
  const ui = await openUi('choose', { sessions });
  try {
    const below = ui.page.locator('[data-run="42"] [data-testid="run-use-case-counts"]').first();
    await below.waitFor({ timeout: 10000 });
    assert.equal(await below.innerText(), '67 use cases · none meets your quality bar');
    assert.equal(await ui.page.locator('[data-run="43"] [data-testid="run-use-case-counts"]').first().innerText(), '20 use cases · 6 high priority');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
