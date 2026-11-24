// REQ-459 (Amr: "Drop DBUs per use case"): the card shows App, Dashboard, Lakebase and Genie as Yes or No (REQ-427) and no DBU text,
// and the page never asks for the DBU read.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const asked = [];
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  // A server that still had the old route would answer; the page must never ask.
  app.get('/api/inspire/implement/usecase-dbus', (_req, res) => res.json({ state: 'ok', use_cases: { 'N01-U01': 16 } }));
  app.get('/api/inspire/implement/usecase-assets', (_req, res) => res.json({ use_cases: { 'N01-U01': { app: true, dashboard: false, lakebase: true, genie: false } } }));
};

test('a use case card shows its asset flags and no DBU text, and the page makes no request to usecase-dbus', async () => {
  asked.length = 0;
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount, init: (page) => { page.on('request', (r) => asked.push(r.url())); } });
  const { page } = ui;
  try {
    const list = page.getByRole('region', { name: 'Use case list' });
    await list.locator('[data-use-case-row]').first().waitFor();
    const assets = list.locator('[data-use-case-assets]').first();
    await assets.waitFor({ timeout: 15000 });
    assert.match((await assets.innerText()).replace(/\s+/g, ' '), /Agentic App: Yes.*Dashboard: No.*Lakebase: Yes.*Genie Agent: No/);
    assert.equal(await page.locator('[data-asset="dbus"]').count(), 0);
    assert.doesNotMatch(await page.locator('body').innerText(), /\bDBUs?\b/);
    assert.ok(asked.some((u) => u.includes('/api/inspire/implement/usecase-assets')), 'the flags are still read');
    assert.deepEqual(asked.filter((u) => u.includes('usecase-dbus')), []);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
