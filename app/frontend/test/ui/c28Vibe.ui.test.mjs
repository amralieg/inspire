// C28 (REQ-572 follow-up): the logo step. A valid PNG draws a real preview (a data: URL that decodes to a picture) and shows no error text;
// only an invalid file shows the error; a file the browser gives no type for is read by its extension.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);
const SESSIONS = REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: '/Workspace/Users/me@example.com/inspire_out', output_language: 'English' } : s));
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAKAAAAAwCAYAAACWqXFuAAAA+klEQVR4nO3dMUrEQBiA0WTxAHoRLfX+lZZ6Eb2B4mKW7GoKhcyH8F6XCYEUH/+QJjNPGx6vb9+37sFvPby9zD+tf1sUHiNDPKwvxMfeLhs7BSg+Rlm3dgxQfIy2NHe2BcNos+lHyQQkJUBSAiQlQFICJCVAUgIkdfXXB+9fn6f/6unmrn4FvpiApARISoCkBEhKgKQESEqApARISoCkBEhKgKQESEqApARISoCkBEhKgKQESEqApARIys+JSJmApARISoCkBEhKgKQESOqwdYIN7O2zPROQ1DFAU5DRluZOE1CEjLJu7WwLFiF7u2xs8wPEATZMO4a3+AD6PC9eVZ+b0QAAAABJRU5ErkJggg==', 'base64'); // a real 160 x 48 PNG
const TINY = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==', 'base64'); // 1 x 1 pixel
const SHOTS = process.env.C28_SHOTS || '';

test('(d) a valid PNG logo previews with a data: URL and no error; an invalid file shows the error', async () => {
  const mount = (app) => {
    app.get('/api/inspire/value/answers', (_q, res) => res.json({ answers: {} }));
    app.post('/api/inspire/docs/save', (req, res) => res.json({ path: `${req.body.folder}/${req.body.name}`, name: req.body.name, size: 1 }));
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
    const pageId = () => dialog.locator('[data-docs-page]:visible').first().getAttribute('data-docs-page');
    while ((await pageId()) !== 'vibe') await dialog.getByRole('button', { name: /^Next/ }).click();
    const input = dialog.locator('[data-docs-logo-input]');
    const preview = dialog.locator('[data-docs-logo-preview]');
    const problem = dialog.locator('[data-docs-logo-problem]');

    await dialog.locator('[data-docs-vibe-example="0"]').click();
    await input.setInputFiles({ name: 'dot.png', mimeType: 'image/png', buffer: TINY });
    await preview.waitFor();
    const dot = await preview.boundingBox();
    assert.ok(dot.width >= 24 && dot.height >= 24, `a tiny picture still previews at a size you can see (${dot.width} x ${dot.height})`);

    await input.setInputFiles({ name: 'brand.png', mimeType: 'image/png', buffer: PNG });
    await page.waitForFunction(() => document.querySelector('[data-docs-logo-preview]')?.alt === 'Logo brand.png');
    await preview.waitFor();
    assert.match(await preview.getAttribute('src'), /^data:image\/png;base64,/);
    await page.waitForFunction(() => { const i = document.querySelector('[data-docs-logo-preview]'); return i && i.complete && i.naturalWidth > 0; });
    const box = await preview.boundingBox();
    assert.ok(box.width >= 24 && box.height >= 16, `the preview is big enough to see (${box.width} x ${box.height})`);
    assert.equal(await problem.count(), 0, 'no error text beside a valid PNG');
    if (SHOTS) await dialog.screenshot({ path: `${SHOTS}/4_vibe.png`, timeout: 8000 }).catch(() => {});

    await input.setInputFiles({ name: 'x.gif', mimeType: 'image/gif', buffer: PNG });
    await problem.waitFor();
    assert.match(await problem.innerText(), /x\.gif.*PNG, SVG or JPEG/, 'the error names the file it is about');

    await input.setInputFiles({ name: 'LOGO.PNG', mimeType: '', buffer: PNG });
    await page.waitForFunction(() => document.querySelector('[data-docs-logo-preview]')?.alt === 'Logo LOGO.PNG');
    assert.equal(await problem.count(), 0, 'a file the browser gives no type for is read by its extension, and the old error clears');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
