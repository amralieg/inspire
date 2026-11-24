// FX-114 (REQ-503): "✦ Generate docs" sits beside "Calculate value for N" when one or more use cases are selected, and is hidden when none is.
// It opens a multi-page wizard (approved wireframe v2: "do not stuff too many things in one page, split into pages inside the wizard"):
// Documents, Layout and language, What to include, Style and colour (live SVG preview), Excel columns (only when Excel is chosen), Review and
// generate. Files are made in the browser (runtime A) and saved through POST /api/inspire/docs/save (FX-115, mocked here), one per planned
// file, then "N files ready" and Go to Assets. A second language is translated through POST /api/inspire/docs/translate (FX-115, mocked).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';
import { planFiles, defaultDocOptions, CONTENT_BLOCKS, EXCEL_COLUMNS } from '../../src/lib/docgen/docOptions.js';
import { DOC_STYLES } from '../../src/lib/docgen/docStyles.js';

test.after(closeBrowser);

const GENERATED = '/Workspace/Users/me@example.com/inspire_out';
const SESSIONS = REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: GENERATED, output_language: 'English' } : s));
const SAVED = { version: 2, answers: { shape: 2, currency: 'USD', attribution_pct: 100, drivers: {}, calculated: true }, saved_at: '2026-11-20T10:42:00Z', saved_by: 'p@example.com', stale: false,
  yearly: { verb: 'REDUCE COST', period: 'Per Year', currency: 'USD', total: { unit: 'USD', amount: 2400000 }, calculated: true, estimated: false,
    parts: [{ id: 'a', label: 'Fewer lost customers', amount: 1500000 }, { id: 'b', label: 'Lower offer cost', amount: 900000 }], attribution_pct: 100 } };
const PICKED = [{ id: 'N01-U01', name: 'Predict churn' }, { id: 'N01-U02', name: 'Score upsell' }];
const MAGIC = { png: [0x89, 0x50, 0x4e, 0x47], pdf: [0x25, 0x50, 0x44, 0x46], pptx: [0x50, 0x4b], xlsx: [0x50, 0x4b] };

function backend({ failName = null } = {}) {
  const calls = { saves: [], translates: [] };
  const mount = (app) => {
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: { 'N01-U01': SAVED } }));
    app.post('/api/inspire/docs/save', (req, res) => {
      calls.saves.push(req.body);
      if (req.body.name === failName) return res.status(500).json({ error: 'The workspace refused the write.' });
      const bytes = Buffer.from(String(req.body.content_base64 || ''), 'base64');
      res.json({ path: `${req.body.folder}/${req.body.name}`, name: req.body.name, size: bytes.length });
    });
    app.post('/api/inspire/docs/translate', (req, res) => {
      calls.translates.push(req.body);
      res.json({ language: req.body.language, texts: Object.fromEntries(Object.entries(req.body.texts || {}).map(([k, v]) => [k, `AR ${v}`])) });
    });
    app.get('/api/workspace/list', (_req, res) => res.json({ files: [{ name: 'Acme-dbx_inspire.pdf', path: `${GENERATED}/acme/Acme-dbx_inspire.pdf`, is_directory: false }] }));
  };
  return { calls, mount };
}

async function openResults(mount, viewport = { width: 1440, height: 900 }) {
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS }, '', { mount });
  await ui.page.setViewportSize(viewport);
  await ui.page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').first().waitFor();
  return ui;
}
const pick = async (page, names) => { for (const n of names) await page.getByRole('checkbox', { name: `Select ${n}`, exact: true }).check(); };
const genButton = (page) => page.locator('[data-value-bulk-bar]').getByRole('button', { name: /Generate docs/ });
const on = async (loc) => (await loc.getAttribute('aria-checked')) === 'true';
const currentPage = async (dialog) => dialog.locator('[data-docs-page]:visible').first().getAttribute('data-docs-page');
const next = (dialog) => dialog.getByRole('button', { name: /^Next/ }).click();
const poll = async (check, what, timeout = 30000) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};
async function openWizard(page) {
  await pick(page, PICKED.map((p) => p.name));
  await genButton(page).click();
  const dialog = page.getByRole('dialog', { name: /Generate documents/ });
  await dialog.waitFor();
  return dialog;
}

test('W1: Generate docs shows beside "Calculate value for N" only while one or more use cases are selected', async () => {
  const ui = await openResults(backend().mount);
  const { page } = ui;
  try {
    const bar = page.locator('[data-value-bulk-bar]');
    await bar.waitFor();
    assert.equal(await genButton(page).count(), 0, 'hidden with none selected');
    await pick(page, ['Predict churn']);
    await genButton(page).waitFor();
    assert.match((await genButton(page).innerText()).trim(), /^✦\s*Generate docs/);
    assert.equal(await bar.getByRole('button', { name: 'Calculate value for 1', exact: true }).count(), 1, 'Calculate value stays');
    await page.getByRole('checkbox', { name: 'Select Predict churn', exact: true }).uncheck();
    await poll(async () => (await genButton(page).count()) === 0, 'Generate docs hidden again');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('W2: the wizard is split into pages: one section per page, an Excel columns page only when Excel is chosen, and each page fits a 1280x800 screen', async () => {
  const ui = await openResults(backend().mount, { width: 1280, height: 800 });
  const { page } = ui;
  try {
    const dialog = await openWizard(page);
    const text = await dialog.innerText();
    for (const p of PICKED) assert.ok(text.includes(p.name), `the header names ${p.name}`);
    assert.ok((await dialog.locator('[data-docs-step]').count()) >= 5, 'a step indicator with every page');
    assert.equal(await currentPage(dialog), 'documents');
    for (const kind of ['infographic', 'pptx', 'pdf', 'xlsx']) assert.ok(await on(dialog.locator(`[data-doc-kind="${kind}"]`)), `${kind} on by default`);
    assert.equal(await dialog.locator('[data-doc-style]:visible').count(), 0, 'styles are not on the documents page');
    assert.equal(await dialog.locator('[data-doc-column]:visible').count(), 0, 'columns are not on the documents page');
    const seen = [];
    const fits = async () => {
      const box = await dialog.boundingBox();
      assert.ok(box && box.y >= 0 && box.y + box.height <= 800 + 1, `page ${seen.at(-1)} fits: ${JSON.stringify(box)}`);
    };
    seen.push(await currentPage(dialog)); await fits();
    for (let i = 0; i < 6 && (await currentPage(dialog)) !== 'review'; i += 1) { await next(dialog); seen.push(await currentPage(dialog)); await fits(); }
    assert.deepEqual(seen, ['documents', 'layout', 'include', 'style', 'columns', 'review']);
    // Back to Documents, turn Excel off: the Excel columns page is gone.
    for (let i = 0; i < 6 && (await currentPage(dialog)) !== 'documents'; i += 1) await dialog.getByRole('button', { name: /^Back/ }).click();
    await dialog.locator('[data-doc-kind="xlsx"]').click();
    assert.equal(await on(dialog.locator('[data-doc-kind="xlsx"]')), false);
    const without = [await currentPage(dialog)];
    for (let i = 0; i < 6 && (await currentPage(dialog)) !== 'review'; i += 1) { await next(dialog); without.push(await currentPage(dialog)); }
    assert.deepEqual(without, ['documents', 'layout', 'include', 'style', 'review']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('W3: layout and language, the content blocks, eight styles with palettes and a brand colour, and a live SVG preview redrawn on each click', async () => {
  const ui = await openResults(backend().mount);
  const { page } = ui;
  try {
    const dialog = await openWizard(page);
    await next(dialog);
    assert.equal(await currentPage(dialog), 'layout');
    assert.equal(await dialog.locator('input[type=radio][name="docs-layout"][value="one"]').isChecked(), true, 'one file for all by default');
    assert.equal(await dialog.locator('input[type=radio][name="docs-layout"][value="each"]').count(), 1);
    const lang = dialog.locator('select[data-docs-language]').first();
    assert.equal(await lang.inputValue(), 'English', "the run's language");
    await next(dialog);
    assert.equal(await currentPage(dialog), 'include');
    assert.equal(await dialog.locator('[data-doc-block]').count(), CONTENT_BLOCKS.length);
    for (const id of defaultDocOptions().blocks) assert.ok(await on(dialog.locator(`[data-doc-block="${id}"]`)), `${id} on by default`);
    await next(dialog);
    assert.equal(await currentPage(dialog), 'style');
    assert.equal(await dialog.locator('[data-doc-style]').count(), DOC_STYLES.length);
    assert.ok((await dialog.locator('[data-doc-palette]').count()) >= 4);
    assert.equal(await dialog.locator('input[aria-label="Brand colour"]').count(), 1);
    const preview = dialog.locator('[data-docs-preview] svg');
    await preview.waitFor();
    const before = await preview.evaluate((el) => el.outerHTML);
    assert.ok(before.includes('Predict churn'), 'the preview is the real infographic of the selected use cases');
    await dialog.locator('[data-doc-style="executive"]').click();
    assert.ok(await on(dialog.locator('[data-doc-style="executive"]')));
    await poll(async () => (await preview.evaluate((el) => el.outerHTML)) !== before, 'the preview redraws on a style click', 5000);
    const afterStyle = await preview.evaluate((el) => el.outerHTML);
    await dialog.locator('input[aria-label="Brand colour"]').fill('#123ABC');
    await poll(async () => (await preview.evaluate((el) => el.outerHTML)).toLowerCase().includes('#123abc'), 'a brand colour leads the preview', 5000);
    assert.notEqual(await preview.evaluate((el) => el.outerHTML), afterStyle);
    await next(dialog);
    assert.equal(await currentPage(dialog), 'columns');
    assert.equal(await dialog.locator('[data-doc-column]').count(), EXCEL_COLUMNS.length);
    for (const id of defaultDocOptions().columns) assert.ok(await on(dialog.locator(`[data-doc-column="${id}"]`)), `${id} on by default`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('W4: Generate saves one real file per planned file into the Assets folder, shows a row per file, then "N files ready" and Go to Assets', async () => {
  const be = backend();
  const ui = await openResults(be.mount);
  const { page } = ui;
  try {
    const dialog = await openWizard(page);
    for (let i = 0; i < 6 && (await currentPage(dialog)) !== 'review'; i += 1) await next(dialog);
    const plan = planFiles({ ...defaultDocOptions('English'), businessName: 'Acme' }, PICKED.map((p) => ({ No: p.id })));
    assert.equal(await dialog.locator('[data-doc-plan-file]').count(), plan.length, 'the review lists the planned files');
    await dialog.getByRole('button', { name: new RegExp(`^✦?\\s*Generate ${plan.length} files$`) }).click();
    await poll(async () => (await dialog.innerText()).includes(`${plan.length} files ready`), `${plan.length} files ready`, 90000);
    assert.deepEqual(be.calls.saves.map((s) => s.name).sort(), plan.map((f) => f.name).sort(), 'one save per planned file, named as planned');
    for (const s of be.calls.saves) {
      assert.equal(s.session_id, '42');
      assert.equal(s.inspire_database, 'main.inspire');
      assert.ok(String(s.folder).startsWith(GENERATED), `saved into the run's Assets folder: ${s.folder}`);
      const bytes = Buffer.from(s.content_base64, 'base64');
      const ext = s.name.split('.').pop();
      assert.ok(bytes.length > 200, `${s.name} has content`);
      assert.deepEqual([...bytes.subarray(0, MAGIC[ext].length)], MAGIC[ext], `${s.name} is a real .${ext}`);
      assert.equal(await dialog.locator(`[data-doc-file="${s.name}"]`).getAttribute('data-doc-file-state'), 'done');
    }
    assert.equal(be.calls.translates.length, 0, 'English needs no translation');
    const marked = await page.evaluate(() => JSON.parse(sessionStorage.getItem('inspire:new-docs:42') || '[]'));
    assert.deepEqual([...marked].sort(), be.calls.saves.map((s) => `${s.folder}/${s.name}`).sort(), 'the saved paths are marked new for Assets');
    await dialog.getByRole('button', { name: 'Go to Assets' }).click();
    await dialog.waitFor({ state: 'hidden' });
    assert.equal(await page.locator('[data-results-nav-item="assets"]').getAttribute('aria-selected'), 'true');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('W5: a second language is translated through the App once and adds a file set per language; a failed save names its file and the reason, the rest are saved', async () => {
  const be = backend({ failName: 'Acme_use_cases_Arabic.xlsx' });
  const ui = await openResults(be.mount);
  const { page } = ui;
  try {
    const dialog = await openWizard(page);
    await dialog.locator('[data-doc-kind="pptx"]').click();
    await dialog.locator('[data-doc-kind="pdf"]').click();
    await next(dialog);
    await dialog.getByRole('button', { name: /Add a language/ }).click();
    await dialog.locator('select[data-docs-language]').nth(1).selectOption('Arabic');
    for (let i = 0; i < 6 && (await currentPage(dialog)) !== 'review'; i += 1) await next(dialog);
    const plan = planFiles({ ...defaultDocOptions('English'), kinds: ['infographic', 'xlsx'], languages: ['English', 'Arabic'], businessName: 'Acme' },
      PICKED.map((p) => ({ No: p.id })));
    assert.equal(await dialog.locator('[data-doc-plan-file]').count(), plan.length);
    await dialog.getByRole('button', { name: new RegExp(`Generate ${plan.length} files$`) }).click();
    await poll(async () => (await dialog.locator('[data-doc-file-state="done"]').count()) + (await dialog.locator('[data-doc-file-state="failed"]').count()) === plan.length,
      'every file ends', 90000);
    assert.equal(be.calls.translates.length, 1, 'one translate call for Arabic');
    assert.equal(be.calls.translates[0].language, 'Arabic');
    assert.ok(Object.values(be.calls.translates[0].texts).some((t) => String(t).includes('Predict churn')), 'the use case texts are sent');
    const failed = dialog.locator('[data-doc-file="Acme_use_cases_Arabic.xlsx"]');
    assert.equal(await failed.getAttribute('data-doc-file-state'), 'failed');
    assert.match(await failed.innerText(), /The workspace refused the write/);
    assert.ok((await dialog.innerText()).includes(`${plan.length - 1} files ready`));
    assert.deepEqual(be.calls.saves.map((s) => s.name).sort(), plan.map((f) => f.name).sort());
  } finally {
    await ui.close();
  }
});
