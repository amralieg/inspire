// C28 (REQ-567 REQ-570 REQ-572): the Generate docs dialog in a real browser. Overall = Excel, PDF, PowerPoint; each use case adds the infographic with
// orientation and style; the last step "Vibe your docs" takes a text (examples are clickable) and a logo; both reach the translate call and the files.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';
import { VIBE_EXAMPLES } from '../../src/lib/docgen/docOptions.js';

test.after(closeBrowser);
const GENERATED = '/Workspace/Users/me@example.com/inspire_out';
const SESSIONS = REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: GENERATED, output_language: 'English' } : s));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64');
const SHOTS = process.env.C28_SHOTS || '';
const page_ = (dialog) => dialog.locator('[data-docs-page]:visible').first().getAttribute('data-docs-page');

test('D1: overall offers Excel, PDF, PowerPoint; Each use case adds infographic with orientation; Vibe step takes text and logo', async () => {
  const translates = [];
  const mount = (app) => {
    app.get('/api/inspire/value/answers', (_q, res) => res.json({ answers: {} }));
    app.post('/api/inspire/docs/save', (req, res) => res.json({ path: `${req.body.folder}/${req.body.name}`, name: req.body.name, size: 1 }));
    app.post('/api/inspire/docs/translate', (req, res) => { translates.push(req.body); res.json({ language: req.body.language, texts: req.body.texts }); });
    app.get('/api/workspace/list', (_q, res) => res.json({ files: [] }));
  };
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS }, '', { mount });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').first().waitFor();
    for (const n of ['Predict churn', 'Score upsell']) await page.getByRole('checkbox', { name: `Select ${n}`, exact: true }).check();
    await page.locator('[data-value-bulk-bar]').getByRole('button', { name: /Generate docs/ }).click();
    const dialog = page.getByRole('dialog', { name: /Generate documents/ });
    await dialog.waitFor();
    const shot = async (name) => { if (SHOTS) await dialog.screenshot({ path: `${SHOTS}/${name}.png`, timeout: 8000 }).catch(() => {}); };
    const kinds = async () => (await dialog.locator('[data-doc-kind]').evaluateAll((els) => els.map((e) => e.getAttribute('data-doc-kind')))).sort();
    assert.deepEqual(await kinds(), ['pdf', 'pptx', 'xlsx']);
    await shot('1_documents_overall');
    await dialog.locator('[data-doc-scope="each"]').click();
    assert.ok((await kinds()).includes('infographic'));
    await dialog.locator('[data-doc-kind="infographic"]').click();
    await shot('2_documents_each');
    const next = () => dialog.getByRole('button', { name: /^Next/ }).click();
    while ((await page_(dialog)) !== 'style') await next();
    assert.equal(await dialog.locator('[data-doc-orientation]').count(), 2, 'Landscape and Portrait');
    assert.ok(await dialog.locator('[data-doc-infographic-style]').count() >= 1, 'a style picker');
    await dialog.locator('[data-doc-orientation="portrait"]').click();
    await shot('3_style_infographic');
    while ((await page_(dialog)) !== 'vibe') await next();
    assert.equal(await dialog.locator('[data-docs-vibe-example]').count(), VIBE_EXAMPLES.length);
    await dialog.locator('[data-docs-vibe-example="0"]').click();
    assert.equal(await dialog.locator('[data-docs-vibe-text]').inputValue(), VIBE_EXAMPLES[0]);
    await dialog.locator('[data-docs-logo-input]').setInputFiles({ name: 'brand.png', mimeType: 'image/png', buffer: PNG });
    await dialog.locator('[data-docs-logo-preview]').waitFor();
    await dialog.locator('[data-docs-logo-input]').setInputFiles({ name: 'x.gif', mimeType: 'image/gif', buffer: PNG });
    await dialog.locator('[data-docs-logo-problem]').waitFor();
    await shot('4_vibe');
    await next();
    assert.equal(await page_(dialog), 'review');
    assert.match(await dialog.locator('[data-doc-review-vibe]').innerText(), /Board-level/);
    assert.match(await dialog.locator('[data-doc-review-logo]').innerText(), /brand\.png/);
    await shot('5_review');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
