// C25 (REQ-559 part 3): every generated document can be viewed in place, downloaded, or opened in Assets.
// Amr: "the generate doc must allow customer to download, or view in place, in addition to go to asset".
// View opens a modal inside the App (no navigation): a PDF in an iframe from a blob URL, a PPTX as its slide titles. Download saves the file with its name.
// Go to asset lands on Assets with that file marked. Both the Generate docs result and Results > Assets carry the three actions.
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { toDocuments, closeBrowser, openUi, toView } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';
import { DOC_KINDS } from '../../src/lib/docgen/docOptions.js';

test.after(closeBrowser);

const GENERATED = '/Workspace/Users/me@example.com/inspire_out';
const SESSIONS = REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: GENERATED, output_language: 'English' } : s));
const PDF_BYTES = Buffer.from('%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\ntrailer<</Root 1 0 R>>\n%%EOF');
const SLIDES = ['Why Acme should act', 'Three use cases that pay back'];

async function pptxBytes() {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<Types/>');
  SLIDES.forEach((t, i) => zip.file(`ppt/slides/slide${i + 1}.xml`, `<p:sld><p:cSld><p:spTree><p:sp><p:txBody><a:p><a:r><a:t>${t}</a:t></a:r></a:p></p:txBody></p:sp></p:spTree></p:cSld></p:sld>`));
  return Buffer.from(await zip.generateAsync({ type: 'uint8array' }));
}

const pptx = await pptxBytes();

const poll = async (check, what, timeout = 90000) => {
  const end = Date.now() + timeout;
  for (;;) {
    if (await check()) return;
    if (Date.now() > end) throw new Error(`timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 100));
  }
};

function backend(files) {
  const state = { saves: [], exports: [] };
  const mount = (app) => {
    app.get('/api/inspire/value/answers', (_req, res) => res.json({ answers: {} }));
    app.post('/api/inspire/docs/save', (req, res) => { state.saves.push(req.body); res.json({ path: `${req.body.folder}/${req.body.name}`, name: req.body.name, size: 1 }); });
    app.post('/api/inspire/docs/translate', (req, res) => res.json({ language: req.body.language, texts: req.body.texts }));
    app.get('/api/workspace/list', (req, res) => {
      const saved = state.saves.map((s) => ({ name: s.name, path: `${s.folder}/${s.name}`, is_directory: false, file_size: 1000 }));
      res.json({ files: [...files, ...saved] });
    });
    app.get('/api/workspace/export', (req, res) => {
      state.exports.push(String(req.query.path));
      res.type(String(req.query.path).endsWith('.pptx') ? 'application/octet-stream' : 'application/pdf').send(String(req.query.path).endsWith('.pptx') ? pptx : PDF_BYTES);
    });
  };
  return { state, mount };
}
const asset = (name) => ({ name, path: `${GENERATED}/${name}`, is_directory: false, file_size: 90000 });

async function generateOnly(page, kind) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').first().waitFor();
  await page.getByRole('checkbox', { name: 'Select Predict churn', exact: true }).check();
  await page.locator('[data-value-bulk-bar]').getByRole('button', { name: /Generate docs/ }).click();
  const dialog = page.getByRole('dialog', { name: /Generate documents/ });
  await dialog.waitFor();
  for (const k of DOC_KINDS) {
    const box = dialog.locator(`[data-doc-kind="${k}"]`);
    // REQ-567/570 (ec0a7e63e): under "Overall" only Excel, PDF and PowerPoint are offered (no Word, no infographic); a kind that is not offered cannot be on.
    if ((await box.count()) === 0) { assert.ok(['infographic', 'docx'].includes(k), 'only Word and the infographic may be absent'); continue; }
    if ((await box.getAttribute('aria-checked')) === (k === kind ? 'false' : 'true')) await box.click();
  }
  for (let i = 0; i < 6 && (await dialog.locator('[data-docs-page]:visible').first().getAttribute('data-docs-page')) !== 'review'; i += 1) await dialog.getByRole('button', { name: /^Next/ }).click();
  await dialog.getByRole('button', { name: /^✦?\s*Generate 1 file$/ }).click();
  return page.getByRole('dialog', { name: /Generate documents/ });
}

test('G1: a generated PDF can be viewed in place, downloaded with its name, and found in Documents', async () => {
  const be = backend([]);
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS }, '', { mount: be.mount });
  const { page } = ui;
  try {
    const panel = await generateOnly(page, 'pdf');
    // The auto-built strategy PDF is saved too, so the file is the one the panel lists.
    const name = await panel.locator('[data-doc-file]').first().getAttribute('data-doc-file');
    await poll(() => be.state.saves.some((x) => x.name === name), 'the file is saved');
    assert.match(name, /\.pdf$/);
    const row = panel.locator(`[data-doc-file="${name}"]`);
    await poll(async () => (await row.getAttribute('data-doc-file-state')) === 'done', 'the file is done');
    const before = page.url();
    await panel.getByRole('button', { name: `View ${name}`, exact: true }).click();
    const viewer = page.locator('[data-doc-viewer]');
    await viewer.waitFor();
    assert.equal(await viewer.locator('iframe').count(), 1, 'a PDF shows in an iframe');
    assert.match(await viewer.locator('iframe').getAttribute('src'), /^blob:/);
    assert.equal(page.url(), before, 'the address does not change');
    await viewer.getByRole('button', { name: 'Close' }).first().click();
    await viewer.waitFor({ state: 'detached' });
    const [download] = await Promise.all([page.waitForEvent('download'), panel.getByRole('button', { name: `Download ${name}`, exact: true }).click()]);
    assert.equal(download.suggestedFilename(), name);
    await panel.getByRole('button', { name: `Go to asset ${name}`, exact: true }).click();
    assert.match(page.url(), /view=overview/);
    await page.locator('[data-asset-focus]').filter({ hasText: name }).first().waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('G2: a Documents PDF has View (modal iframe, same address) and Download (named)', async () => {
  const pdf = asset('Acme-dbx_inspire.pdf');
  const be = backend([pdf]);
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS }, '', { mount: be.mount });
  const { page } = ui;
  try {
    await toDocuments(page);
    await page.getByText(pdf.name).first().waitFor({ timeout: 20000 });
    const row = page.locator(`[data-doc-file="${pdf.name}"]`).first();
    const before = page.url();
    await row.getByRole('button', { name: `View ${pdf.name}`, exact: true }).click();
    const viewer = page.locator('[data-doc-viewer]');
    await viewer.waitFor();
    assert.match(await viewer.locator('iframe').getAttribute('src'), /^blob:/);
    assert.equal(page.url(), before);
    assert.ok(be.state.exports.includes(pdf.path), 'the file came through the existing export route');
    await viewer.getByRole('button', { name: 'Close' }).first().click();
    await viewer.waitFor({ state: 'detached' });
    const [download] = await Promise.all([page.waitForEvent('download'), row.getByRole('button', { name: `Download ${pdf.name}`, exact: true }).click()]);
    assert.equal(download.suggestedFilename(), pdf.name);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('G3: a Documents PPTX View shows its slide titles in the App', async () => {
  const deck = asset('Acme_deck.pptx');
  const be = backend([deck]);
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS }, '', { mount: be.mount });
  const { page } = ui;
  try {
    await toDocuments(page);
    await page.getByText(deck.name).first().waitFor({ timeout: 20000 });
    const before = page.url();
    await page.locator(`[data-doc-file="${deck.name}"]`).first().getByRole('button', { name: `View ${deck.name}`, exact: true }).click();
    const viewer = page.locator('[data-doc-viewer]');
    await viewer.waitFor();
    for (const t of SLIDES) await viewer.getByText(t).first().waitFor();
    assert.equal(await viewer.locator('iframe').count(), 0, 'a deck is not an iframe');
    assert.equal(page.url(), before);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
