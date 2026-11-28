// c47 UI lane acceptance (REQ-581 U4, after c36): pending artifacts in every slot that would otherwise be empty, and the real artifact wins.
// - Overview > Documents: with docs pending for the whole session, each Overall document slot (Excel, PDF, PowerPoint) with no file says
//   "pending, produced at Implement" instead of "Not made yet.".
// - The use case reader (a row click) shows the same pending kinds as its row.
// - A kind the use case already has (documents made, a notebook path, Databricks AI instructions saved) is not pending on its row.
// - When the Implement notebook run ends and the session's pending list is cleared, the markers go and the normal slots return.
// Marker contract as in c36: [data-pending-artifact="<kind>"] whose text matches PENDING_TEXT. Rows: [data-use-case-row][data-use-case-id].
// Written by the c47 spec writer; the builder may not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, toDocuments, until } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { PENDING_TEXT } from './c36Fixtures.mjs';
import { MADE_ROWS, NOTEBOOK_DONE, NOTEBOOK_RUNNING, PENDING_ALL } from './c47Fixtures.mjs';

test.after(closeBrowser);

const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));
const row = (page, id) => page.getByRole('region', { name: 'Use case list' }).locator(`[data-use-case-row][data-use-case-id="${id}"]`).first();
const kindsOn = (locator) => locator.locator('[data-pending-artifact]').evaluateAll((els) => els.map((el) => el.getAttribute('data-pending-artifact')).sort());

function backend({ pending, usecases = [], notebookRun = null }) {
  const feed = { pending, usecases, notebookRun, implementReads: 0 };
  const mount = (app) => {
    app.get('/api/inspire/results', (_req, res) => res.json({ results: REVIEW_RESULTS, found: true, pending_artifacts: feed.pending }));
    app.get('/api/inspire/usecases', (_req, res) => res.json({ usecases: feed.usecases, count: feed.usecases.length }));
    app.get('/api/inspire/implement/history', (_req, res) => { feed.implementReads += 1; res.json({ history: [], latest: [], notebook_run: feed.notebookRun }); });
  };
  return { feed, mount };
}

test('REQ-581 U4: each empty Overall document slot says pending, produced at Implement, not "Not made yet." (must-fail on the base)', async () => {
  const { mount } = backend({ pending: PENDING_ALL });
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  const { page } = ui;
  try {
    await row(page, 'N01-U01').waitFor({ timeout: 20000 });
    await toDocuments(page);
    const slots = page.locator('[data-overall-doc]');
    await slots.first().waitFor({ timeout: 15000 });
    const n = await slots.count();
    assert.ok(n >= 3, `the Excel, PDF and PowerPoint slots show (${n})`);
    for (let i = 0; i < n; i += 1) {
      const slot = slots.nth(i);
      const text = await slot.innerText();
      assert.ok(!text.includes('Not made yet.'), `slot ${await slot.getAttribute('data-overall-doc')} is not shown as empty`);
      assert.match(await slot.locator('[data-pending-artifact="docs"]').innerText(), PENDING_TEXT);
    }
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-581 U4: the use case reader shows the pending kinds of its use case (must-fail on the base)', async () => {
  const { mount } = backend({ pending: PENDING_ALL });
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  const { page } = ui;
  try {
    const churn = row(page, 'N01-U01');
    await churn.locator('[data-pending-artifact]').first().waitFor({ timeout: 20000 });
    await churn.locator('[data-row-name]').click();
    const reader = page.locator('[data-review-reader]');
    await reader.waitFor({ timeout: 10000 });
    await reader.locator('[data-pending-artifact]').first().waitFor({ timeout: 10000 });
    assert.deepEqual(await kindsOn(reader), ['docs', 'genie_instructions', 'notebook']);
    for (const text of await reader.locator('[data-pending-artifact]').allInnerTexts()) assert.match(text, PENDING_TEXT);
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-581 U4: a kind the use case already has is not pending on its row; the rest stay pending (must-fail on the base)', async () => {
  const { mount } = backend({ pending: PENDING_ALL, usecases: MADE_ROWS });
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  const { page } = ui;
  try {
    const churn = row(page, 'N01-U01');
    await churn.locator('[data-pending-artifact]').first().waitFor({ timeout: 20000 });
    await until(async () => JSON.stringify(await kindsOn(churn)) === JSON.stringify(['genie_instructions']),
      'N01-U01 has its documents and notebook: only the Databricks AI instructions stay pending', 15000);
    assert.deepEqual(await kindsOn(row(page, 'N01-U02')), ['docs'], 'a use case without documents keeps the session-wide pending docs');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-581 U4 regression: when the Implement notebook run ends and the list is cleared, the markers go and the slots return (must-keep)', async () => {
  const { feed, mount } = backend({ pending: PENDING_ALL, notebookRun: NOTEBOOK_RUNNING });
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount });
  const { page } = ui;
  try {
    await row(page, 'N01-U01').locator('[data-pending-artifact]').first().waitFor({ timeout: 20000 });
    await until(async () => feed.implementReads > 0, 'the Results page reads the Implement history', 15000);
    feed.pending = [];
    feed.usecases = MADE_ROWS;
    feed.notebookRun = NOTEBOOK_DONE;
    await until(async () => (await page.locator('[data-pending-artifact]').count()) === 0, 'every pending marker goes after Implement', 45000);
    await toDocuments(page);
    await page.getByText(/Not made yet\./).first().waitFor({ timeout: 15000 });
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});
