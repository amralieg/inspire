import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';
import { built } from './implementFixtures.js';

// C24 gap 1 (Amr P218): the header says whether AI calls are going through. Gap 2 (REQ-078, Amr P004): a built use case nudges to build another.
test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const measured = (high) => JSON.stringify({ status: 'measured', value_low: high / 2, value_high: high, currency: 'AED', text: `AED ${high} a year, measured` });
const uc = (id, name, high) => ({ id, use_case: name, name_with_technique: name, primary_table: `main.s.${id}`, tables_involved: `main.s.${id}`,
  value_estimate: measured(high), data_evidence: JSON.stringify({ tables: { [`main.s.${id}`]: { columns: [] } } }), inspire_score: '7' });
const FOUR = [uc('N01-U01', 'Predict churn', 6000), uc('N01-U02', 'Score upsell', 2000), uc('N02-U01', 'Track stock outs', 9000), uc('N03-U01', 'Reorder timing', 1200)];

const mountBase = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
};
async function go(page, hash) {
  await page.waitForLoadState('networkidle');
  await page.waitForFunction(() => !document.body.innerText.includes('Connecting to workspace'), null, { timeout: 20000 });
  await page.evaluate((target) => { window.location.hash = target; }, hash);
}

test('the header shows AI ready, working while an LLM call is pending, unavailable after a failure, ready after a success', async () => {
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  let mode = 'hold';
  const ui = await openUi('app', { ...REVIEW_STATE, useCases: FOUR }, '', { mount: (app) => {
    mountBase(app);
    app.post('/api/inspire/docs/translate', async (_req, res) => {
      if (mode === 'fail') return res.status(500).json({ error: 'Model endpoint is down' });
      if (mode === 'hold') await gate;
      return res.json({ texts: {} });
    });
  } });
  const { page } = ui;
  try {
    await page.waitForFunction(() => !document.body.innerText.includes('Connecting to workspace'), null, { timeout: 20000 });
    const badge = page.locator('header [data-ai-status]');
    await badge.waitFor({ timeout: 20000 });
    assert.match(await badge.innerText(), /AI: ready/);
    const call = () => page.evaluate(async () => {
      const { makeApiPostJson } = await import('/src/lib/apiClient.js');
      return makeApiPostJson({})('/api/inspire/docs/translate', {}).then(() => 'ok', (e) => `err ${e.message}`);
    });
    const pending = call();
    await page.waitForFunction(() => /AI: working/.test(document.querySelector('header [data-ai-status]')?.innerText || ''), null, { timeout: 10000 });
    release();
    assert.equal(await pending, 'ok');
    await page.waitForFunction(() => /AI: ready/.test(document.querySelector('header [data-ai-status]')?.innerText || ''), null, { timeout: 10000 });
    mode = 'fail';
    assert.match(await call(), /^err/);
    await page.waitForFunction(() => /AI: unavailable/.test(document.querySelector('header [data-ai-status]')?.innerText || ''), null, { timeout: 10000 });
    assert.match(await badge.getAttribute('title'), /Model endpoint is down/);
    mode = 'ok';
    assert.equal(await call(), 'ok');
    await page.waitForFunction(() => /AI: ready/.test(document.querySelector('header [data-ai-status]')?.innerText || ''), null, { timeout: 10000 });
  } finally {
    await ui.close();
  }
});

test('a use case with a built asset nudges to build another and the button opens the highest-value unbuilt one', async () => {
  const ui = await openUi('app', { ...REVIEW_STATE, useCases: FOUR, history: [built({ use_case_id: 'N01-U01' })] }, '', { mount: mountBase });
  const { page } = ui;
  try {
    await go(page, '#/build/42/N01-U01');
    const nudge = page.locator('[data-build-another]');
    await nudge.waitFor({ timeout: 20000 });
    assert.match(await nudge.innerText(), /Build another: 3 more use cases in this run are ready to build/);
    await nudge.getByRole('button').click();
    await page.locator('button[aria-current="true"]', { hasText: 'Track stock outs' }).waitFor({ timeout: 10000 });
  } finally {
    await ui.close();
  }
});

test('a use case with no built asset shows no nudge', async () => {
  const ui = await openUi('app', { ...REVIEW_STATE, useCases: FOUR, history: [built({ use_case_id: 'N01-U01' })] }, '', { mount: mountBase });
  const { page } = ui;
  try {
    await go(page, '#/build/42/N02-U01');
    await page.locator('[aria-label="Use case"]').waitFor({ timeout: 20000 });
    await page.waitForTimeout(800);
    assert.equal(await page.locator('[data-build-another]').count(), 0);
  } finally {
    await ui.close();
  }
});
