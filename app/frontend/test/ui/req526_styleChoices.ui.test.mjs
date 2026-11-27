// REQ-526 step 4: the Style and color step offers the four document designs first (each with a thumbnail of its own infographic), then the old styles.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const SESSIONS = REVIEW_SESSIONS.map((s, i) => (i === 0 ? { ...s, generation_path: '/Workspace/Users/me@example.com/inspire_out', output_language: 'English' } : s));
const PICKED = ['Predict churn', 'Score upsell'];
const NEW_IDS = ['original', 'editorial_ink', 'bold', 'consulting'];
const OLD_IDS = ['midnight', 'executive', 'vivid', 'editorial', 'neon', 'organic', 'gold', 'blueprint'];
const dialogOf = (page) => page.getByRole('dialog', { name: /Generate documents/ });
const currentPage = (dialog) => dialog.locator('[data-docs-page]:visible').first().getAttribute('data-docs-page');
async function openStyle() {
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: SESSIONS, results: REVIEW_RESULTS }, '', { mount: (app) => { app.get('/api/inspire/value/answers', (_q, r) => r.json({ answers: {} }));
    // REQ-121 (strategyDoc.js:41): Results saves the run's strategy PDF itself; without this route the harness answered 403.
    app.post('/api/inspire/docs/save', (req, res) => res.json({ path: `${req.body.folder}/${req.body.name}`, name: req.body.name, size: 1 }));
    app.get('/api/workspace/list', (_q, r) => r.json({ files: [] })); } });
  await ui.page.setViewportSize({ width: 1440, height: 900 });
  await ui.page.getByRole('region', { name: 'Use case list' }).locator('[data-use-case-row]').first().waitFor();
  for (const n of PICKED) await ui.page.getByRole('checkbox', { name: `Select ${n}`, exact: true }).check();
  await ui.page.locator('[data-value-bulk-bar]').getByRole('button', { name: /Generate docs/ }).click();
  const dialog = dialogOf(ui.page);
  await dialog.waitFor();
  for (let i = 0; i < 6 && (await currentPage(dialog)) !== 'style'; i += 1) await dialog.getByRole('button', { name: /^Next/ }).click();
  return { ui, dialog };
}

test('S1: the Style step lists 12 styles, the 4 designs first with their labels; Inspire original is checked by default', async () => {
  const { ui, dialog } = await openStyle();
  try {
    const ids = await dialog.locator('[data-doc-style]').evaluateAll((els) => els.map((e) => e.getAttribute('data-doc-style')));
    assert.deepEqual(ids, [...NEW_IDS, ...OLD_IDS]);
    const labels = await dialog.locator('[data-doc-style]').evaluateAll((els) => els.slice(0, 4).map((e) => e.innerText.trim()));
    assert.deepEqual(labels, ['Inspire original', 'Editorial ink', 'Bold data', 'Board pack']);
    assert.equal(await dialog.locator('[data-doc-style="original"]').getAttribute('aria-checked'), 'true');
  } finally { await ui.close(); }
});

test('S2: each new design card shows a thumbnail of its own infographic, and the thumbnails differ', async () => {
  const { ui, dialog } = await openStyle();
  try {
    const srcs = [];
    for (const id of NEW_IDS) {
      const thumb = dialog.locator(`[data-doc-style="${id}"] [data-doc-style-thumb]`);
      assert.equal(await thumb.count(), 1, id);
      srcs.push(await thumb.getAttribute('src'));
      assert.match(srcs.at(-1), /^data:image\/svg\+xml/);
    }
    assert.equal(new Set(srcs).size, 4);
    assert.equal(await dialog.locator('[data-doc-style="midnight"] [data-doc-style-thumb]').count(), 0);
  } finally { await ui.close(); }
});

test('S3: Bold data + Dark shows on Review and the preview is the bold dark design; an old style still works', async () => {
  const { ui, dialog } = await openStyle();
  try {
    await dialog.locator('[data-doc-style="bold"]').click();
    await dialog.getByRole('radiogroup', { name: 'Theme' }).getByRole('radio', { name: 'Dark' }).click();
    assert.match(await dialog.locator('[data-docs-preview] svg').first().evaluate((el) => el.outerHTML), /#0E1A20/i);
    await dialog.locator('[data-doc-style="midnight"]').click();
    assert.equal(await dialog.locator('[data-doc-style="midnight"]').getAttribute('aria-checked'), 'true');
    assert.doesNotMatch(await dialog.locator('[data-docs-preview] svg').first().evaluate((el) => el.outerHTML), /width="794"/);
    await dialog.locator('[data-doc-style="bold"]').click();
    for (let i = 0; i < 4 && (await currentPage(dialog)) !== 'review'; i += 1) await dialog.getByRole('button', { name: /^Next/ }).click();
    assert.equal(await currentPage(dialog), 'review');
    assert.match(await dialog.innerText(), /Style:?\s*Bold data/);
    assert.match(await dialog.innerText(), /Theme:?\s*Dark/);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});
