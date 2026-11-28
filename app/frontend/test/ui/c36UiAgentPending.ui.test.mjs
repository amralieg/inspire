// c36 UI lane acceptance (REQ-581, U4 in the agent/UI interface): the session row's pending_artifacts (as GET /api/inspire/results answers
// them, a list of {kind: docs|genie_instructions|notebook|translation, use_case_id|null}) shows on Results as "pending, produced at
// Implement" for each listed kind: on the use case row it names, or on every row when use_case_id is null; the Overview Documents panel
// shows the pending docs instead of the empty sentence. An empty list renders the normal slots.
// Marker contract: [data-pending-artifact="<kind>"] whose text matches PENDING_TEXT.
// Written by the c36 spec writer; the builder may not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, toDocuments } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { PENDING_NONE, PENDING_SOME, PENDING_TEXT } from './c36Fixtures.mjs';

test.after(closeBrowser);

const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));
const resultsWith = (pending) => (app) => app.get('/api/inspire/results', (_req, res) => res.json({ results: REVIEW_RESULTS, found: true, pending_artifacts: pending }));
const list = (page) => page.getByRole('region', { name: 'Use case list' });
const row = (page, name) => list(page).locator('[data-use-case-row]').filter({ hasText: name }).first();
const kindsOn = (locator) => locator.locator('[data-pending-artifact]').evaluateAll((els) => els.map((el) => el.getAttribute('data-pending-artifact')).sort());
async function allSayPending(locator) {
  for (const text of await locator.locator('[data-pending-artifact]').allInnerTexts()) assert.match(text, PENDING_TEXT);
}

test('REQ-581 U4: pending artifacts show as "pending, produced at Implement" per use case and session-wide (must-fail on the base)', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: resultsWith(PENDING_SOME) });
  const { page } = ui;
  try {
    await list(page).locator('[data-use-case-row]').first().waitFor({ timeout: 20000 });
    const churn = row(page, 'Predict churn');
    await churn.locator('[data-pending-artifact]').first().waitFor({ timeout: 15000 });
    assert.deepEqual(await kindsOn(churn), ['docs', 'genie_instructions', 'notebook'], 'its own pending kinds plus the session-wide docs');
    await allSayPending(churn);
    const upsell = row(page, 'Score upsell');
    assert.deepEqual(await kindsOn(upsell), ['docs'], 'a use case not named gets only the session-wide pending kind');
    await allSayPending(upsell);
    await toDocuments(page);
    const docs = page.locator('[data-overview-panel-body="documents"], [data-overview-documents]').or(page.locator('main')).first();
    const pendingDocs = page.locator('[data-pending-artifact="docs"]').filter({ hasText: PENDING_TEXT });
    await pendingDocs.first().waitFor({ timeout: 15000 });
    assert.ok(!(await docs.innerText()).includes('No use case has documents yet'), 'the Documents panel says docs are pending, not that there are none');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-581 U4 regression: an empty pending list renders the normal slots (must-keep)', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: REVIEW_RESULTS }, '', { mount: resultsWith(PENDING_NONE) });
  const { page } = ui;
  try {
    await list(page).locator('[data-use-case-row]').first().waitFor({ timeout: 20000 });
    await new Promise((r) => setTimeout(r, 1500));
    assert.equal(await page.locator('[data-pending-artifact]').count(), 0);
    await toDocuments(page);
    await page.getByText(/No use case has documents yet/).first().waitFor({ timeout: 15000 });
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});
