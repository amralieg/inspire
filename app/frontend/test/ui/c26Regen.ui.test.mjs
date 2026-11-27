// C26 (REQ-562): once documents exist the docs button says "Re-generate docs", so the customer can regenerate at any time.
// Amr: "when you generate docs, doc button should show 'Re-generate' so customer can at anytime regenerate docs". Catalog: T-DOC-12.
// The listing marks use case N01-U03 as having documents (docs_generated_at). Row 1 says "Re-generate docs", row 2 "Generate docs";
// finishing the wizard on row 2 flips row 2 at once (no reload), and a reload keeps both.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const GENERATED = '/Workspace/Users/me@example.com/inspire_out';
const SESSIONS = REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: GENERATED, output_language: 'English' } : s));
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const FIRST = 'N01-U03';
const SECOND = 'N01-U04';

const poll = async (check, what, timeout = 60000) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

// The fake App keeps what the wizard saved, and the use case listing reports docs_generated_at for each use case a saved file names (like the real save route).
function backend() {
  const state = { saves: [] };
  const mount = (app) => {
    app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
    app.get('/api/showcase', (_req, res) => res.json({}));
    app.get('/api/inspire/value', (_req, res) => res.json({ use_cases: {}, run: { at_stake: [], saved: [], mvps_measured: 0 } }));
    app.get('/api/inspire/value/estimates', (_req, res) => res.json({ use_cases: {}, totals: null }));
    app.get('/api/inspire/value/yearly', (_req, res) => res.json({ use_cases: {} }));
    app.get('/api/inspire/value/answers/history', (_req, res) => res.json({ history: [] }));
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: {} }));
    app.post('/api/inspire/docs/save', (req, res) => { state.saves.push(req.body); res.json({ path: `${req.body.folder}/${req.body.name}`, name: req.body.name, size: 1 }); });
    app.get('/api/workspace/list', (_req, res) => res.json({ files: [] }));
  };
  const init = async (page) => {
    await page.route(/\/api\/inspire\/usecases\?/, async (route) => {
      const response = await route.fetch();
      const body = await response.json().catch(() => ({}));
      const made = new Set([FIRST, ...state.saves.flatMap((s) => s.use_case_ids || [])]);
      const rows = (body.usecases || []).filter((r) => !made.has(String(r.id)));
      made.forEach((id) => rows.push({ ...((body.usecases || []).find((r) => String(r.id) === id) || { id, session_id: 42, use_case: id, Name: id }), docs_generated_at: '2026-11-27T10:00:00Z' }));
      await route.fulfill({ response, json: { ...body, usecases: rows } });
    });
  };
  return { state, mount, init };
}

const label = (page, id) => page.locator(`[data-use-case-row][data-use-case-no="${id}"]`).getByRole('button', { name: /generate docs/i });

async function finishWizard(page, id) {
  await label(page, id).click();
  const dialog = page.getByRole('dialog', { name: /Generate documents/ });
  await dialog.waitFor();
  for (let i = 0; i < 6 && (await dialog.locator('[data-docs-page]:visible').first().getAttribute('data-docs-page')) !== 'review'; i += 1) await dialog.getByRole('button', { name: /^Next/ }).click();
  await dialog.getByRole('button', { name: /^✦?\s*Generate \d+ files?$/ }).click();
}

test('T-DOC-12: a use case with documents shows "Re-generate docs", the switch is live, and a reload keeps it', async () => {
  const be = backend();
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS }, '', { mount: be.mount, init: be.init });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').first().waitFor({ timeout: 15000 });
    await page.locator(`[data-use-case-row][data-use-case-no="${FIRST}"] [data-docs-made]`).waitFor({ timeout: 15000 });
    assert.equal((await label(page, FIRST).innerText()).trim(), 'Re-generate docs');
    assert.equal((await label(page, SECOND).innerText()).trim(), 'Generate docs');
    await finishWizard(page, SECOND);
    await poll(async () => (await label(page, SECOND).innerText()).trim() === 'Re-generate docs', 'row 2 switches without a reload');
    assert.ok(be.state.saves.some((s) => (s.use_case_ids || []).includes(SECOND)), 'the wizard saved a file for row 2');
    await page.reload();
    await page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').first().waitFor({ timeout: 15000 });
    await poll(async () => (await label(page, SECOND).innerText()).trim() === 'Re-generate docs', 'row 2 keeps it after a reload');
    assert.equal((await label(page, FIRST).innerText()).trim(), 'Re-generate docs');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
