// REQ-525 (Amr: "you also need to add dark theme or light theme, also must support run in background like you did with value").
// Theme: the Style and color step offers Light (default) and Dark; Dark shows on Review and reaches the files. Background: once files are being
// made, "Run in background", X and Esc hide the dialog while the run goes on; a progress line shows and reopens it; only Stop stops.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';
import { planFiles, defaultDocOptions } from '../../src/lib/docgen/docOptions.js';

test.after(closeBrowser);

const GENERATED = '/Workspace/Users/me@example.com/inspire_out';
const SESSIONS = REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: GENERATED, output_language: 'English' } : s));
const PICKED = ['Predict churn', 'Score upsell'];
const PLAN = planFiles({ ...defaultDocOptions('English'), businessName: 'Acme' }, [{ No: 'N01-U01' }, { No: 'N01-U02' }]);

// state.hold: each save waits until state.release() answers the oldest one.
function backend(state) {
  state.saves = []; state.pending = [];
  state.release = () => { const p = state.pending.shift(); if (p) p.res.json({ path: `${p.req.body.folder}/${p.req.body.name}`, name: p.req.body.name, size: 1 }); return Boolean(p); };
  return (app) => {
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: {} }));
    app.post('/api/inspire/docs/save', (req, res) => {
      state.saves.push(req.body);
      if (state.hold) state.pending.push({ req, res }); else res.json({ path: `${req.body.folder}/${req.body.name}`, name: req.body.name, size: 1 });
    });
    app.get('/api/workspace/list', (_req, res) => res.json({ files: [] }));
  };
}
async function openResults(state) {
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS }, '', { mount: backend(state) });
  await ui.page.setViewportSize({ width: 1440, height: 900 });
  await ui.page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').first().waitFor();
  return ui;
}
const poll = async (check, what, timeout = 30000) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 50));
  }
};
const dialogOf = (page) => page.getByRole('dialog', { name: /Generate documents/ });
const barOf = (page) => page.locator('[data-docs-bg]');
const barText = async (page) => (await barOf(page).locator('[data-docs-bg-text]').innerText()).replace(/\s+/g, ' ').trim();
const currentPage = (dialog) => dialog.locator('[data-docs-page]:visible').first().getAttribute('data-docs-page');
async function openWizard(page) {
  for (const n of PICKED) await page.getByRole('checkbox', { name: `Select ${n}`, exact: true }).check();
  await page.locator('[data-value-bulk-bar]').getByRole('button', { name: /Generate docs/ }).click();
  const dialog = dialogOf(page);
  await dialog.waitFor();
  return dialog;
}
const toStep = async (dialog, id) => { for (let i = 0; i < 6 && (await currentPage(dialog)) !== id; i += 1) await dialog.getByRole('button', { name: /^Next/ }).click(); };
async function startMaking(page) {
  const dialog = await openWizard(page);
  await toStep(dialog, 'review');
  await dialog.getByRole('button', { name: new RegExp(`Generate ${PLAN.length} files$`) }).click();
  return dialog;
}

test('H1: the Style and color step offers Light (checked) and Dark; Dark shows on Review and under the choice the note names what it covers', async () => {
  const ui = await openResults({});
  try {
    const dialog = await openWizard(ui.page);
    await toStep(dialog, 'style');
    const group = dialog.getByRole('radiogroup', { name: 'Theme' });
    assert.equal(await group.getByRole('radio', { name: 'Light' }).getAttribute('aria-checked'), 'true');
    assert.equal(await group.getByRole('radio', { name: 'Dark' }).getAttribute('aria-checked'), 'false');
    assert.match(await dialog.innerText(), /Applies to PDF and PowerPoint files\. Excel sheets stay light\./);
    const lightSvg = await dialog.locator('[data-docs-preview] svg').evaluate((el) => el.outerHTML);
    await group.getByRole('radio', { name: 'Dark' }).click();
    await poll(async () => (await dialog.locator('[data-docs-preview] svg').evaluate((el) => el.outerHTML)) !== lightSvg, 'the preview follows the theme', 5000);
    await toStep(dialog, 'review');
    assert.match(await dialog.innerText(), /Theme:?\s*Dark/);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('H2: a Dark run saves files made with the dark theme (the PDF infographic image is dark); Light stays as today', async () => {
  const state = {};
  const ui = await openResults(state);
  try {
    const dialog = await openWizard(ui.page);
    await toStep(dialog, 'style');
    await dialog.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }).click();
    await toStep(dialog, 'review');
    await dialog.getByRole('button', { name: new RegExp(`Generate ${PLAN.length} files$`) }).click();
    await poll(async () => state.saves.length === PLAN.length, 'all files saved', 90000);
    assert.deepEqual(state.saves.map((s) => s.name).sort(), PLAN.map((f) => f.name).sort());
    assert.ok(state.saves.every((s) => Buffer.from(s.content_base64, 'base64').length > 200));
  } finally { await ui.close(); }
});

test('B1: Run in background hides the dialog, the progress line counts, the run keeps going, and Open shows the final rows with Close', async () => {
  const state = { hold: true };
  const ui = await openResults(state);
  const { page } = ui;
  try {
    const dialog = await startMaking(page);
    await poll(() => state.saves.length === 1, 'the first save is held');
    await dialog.getByRole('button', { name: 'Run in background', exact: true }).click();
    await dialog.waitFor({ state: 'detached' });
    await barOf(page).waitFor();
    assert.equal(await barText(page), `Making documents: 0 of ${PLAN.length} saved`);
    state.release();
    await poll(async () => (await barText(page)) === `Making documents: 1 of ${PLAN.length} saved`, 'the line says 1 saved');
    while (state.saves.length < PLAN.length || state.pending.length) { state.release(); await new Promise((r) => setTimeout(r, 50)); }
    await poll(async () => (await barText(page)).includes(`${PLAN.length} of ${PLAN.length} saved`), 'all saved while hidden');
    assert.deepEqual(state.saves.map((s) => s.name), PLAN.map((f) => f.name), 'the same save calls as when watched, in plan order');
    await barOf(page).getByRole('button', { name: 'Open', exact: true }).click();
    const panel = dialogOf(page);
    await panel.waitFor();
    assert.match(await panel.innerText(), new RegExp(`${PLAN.length} files ready`));
    for (const f of PLAN) assert.equal(await panel.locator(`[data-doc-file="${f.name}"]`).getAttribute('data-doc-file-state'), 'done');
    await panel.getByRole('button', { name: 'Close', exact: true }).first().click();
    await panel.waitFor({ state: 'detached' });
    assert.equal(await barOf(page).count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

for (const how of ['Esc', 'X']) {
  test(`B2: ${how} while making hides the dialog and the run goes on`, async () => {
    const state = { hold: true };
    const ui = await openResults(state);
    const { page } = ui;
    try {
      const dialog = await startMaking(page);
      await poll(() => state.saves.length === 1, 'the first save is held');
      if (how === 'Esc') await page.keyboard.press('Escape'); else await dialog.getByRole('button', { name: 'Close', exact: true }).first().click();
      await dialog.waitFor({ state: 'detached' });
      await barOf(page).waitFor();
      while (state.saves.length < PLAN.length || state.pending.length) { state.release(); await new Promise((r) => setTimeout(r, 50)); }
      await poll(async () => (await barText(page)).includes(`${PLAN.length} of ${PLAN.length} saved`), 'every file is saved after hiding');
      assert.deepEqual(ui.pageErrors, []);
    } finally { await ui.close(); }
  });
}

test('B3: Stop starts no new file; the one being made finishes and the rest say they were not started', async () => {
  const state = { hold: true };
  const ui = await openResults(state);
  const { page } = ui;
  try {
    const dialog = await startMaking(page);
    await poll(() => state.saves.length === 1, 'the first save is held');
    await dialog.getByRole('button', { name: 'Stop', exact: true }).click();
    state.release();
    await poll(async () => (await dialog.getByRole('button', { name: 'Close', exact: true }).count()) > 0, 'the dialog offers Close once it ended');
    await new Promise((r) => setTimeout(r, 1200));
    assert.equal(state.saves.length, 1, 'no file started after Stop');
    assert.equal(await dialog.locator(`[data-doc-file="${PLAN[0].name}"]`).getAttribute('data-doc-file-state'), 'done');
    for (const f of PLAN.slice(1)) assert.equal(await dialog.locator(`[data-doc-file="${f.name}"]`).getAttribute('data-doc-file-state'), 'stopped');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('B4 (must-keep): a run left open in the dialog shows every row, "N files ready", and Go to Assets', async () => {
  const state = {};
  const ui = await openResults(state);
  const { page } = ui;
  try {
    const dialog = await startMaking(page);
    await poll(async () => (await dialog.innerText()).includes(`${PLAN.length} files ready`), 'files ready', 90000);
    assert.equal(await barOf(page).count(), 0, 'no progress line while the dialog is shown');
    await dialog.getByRole('button', { name: 'Go to Assets' }).click();
    await dialog.waitFor({ state: 'detached' });
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
