// c46 acceptance (REQ-585 item 3, REQ-579): after Accept, each use case card on the Results page shows the final verdict and confidence
// from match/result `accepted`, and lists each dropped piece under "Dropped from this use case". A dropped piece leaves the card's
// piece list, so it is never shown or counted as matched. Before Accept (accepted is empty) the card is unchanged. Written by the
// coordinator; the c46 builder may not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { MATCH_REVIEW_TITLE, VERDICT_TEXT } from '../../src/lib/startWizard.js';
import { MATCH_DONE } from './c33WizFixtures.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));
const DROPPED_TITLE = 'Dropped from this use case';
const ACCEPTED = {
  ...MATCH_DONE,
  accepted: [
    { input_no: 1, verdict: 'full', confidence: 92, dropped: [] },
    { input_no: 2, verdict: 'full', confidence: 88, dropped: [{ piece_no: 2, requirement: 'Cancellation events' }] },
    { input_no: 3, verdict: 'none', confidence: 0, dropped: [{ piece_no: 1, requirement: 'Drone flight paths' }] },
  ],
};

async function openPanel(matchResult) {
  const ui = await openUi('results', { ...REVIEW_STATE, matchResult });
  const panel = ui.page.locator('[data-match-panel]');
  await panel.getByText(MATCH_REVIEW_TITLE).waitFor({ timeout: 20000 });
  return { ui, panel, reports: panel.locator('[data-match-report]') };
}

test('c46: after Accept each card reads its verdict and confidence from accepted and lists the dropped pieces (must-fail on the base)', async () => {
  const { ui, reports } = await openPanel(ACCEPTED);
  try {
    assert.deepEqual(await reports.evaluateAll((els) => els.map((el) => el.getAttribute('data-match-verdict'))), ['full', 'full', 'none'],
      'the card verdict is the accepted one (input 2 was partial before Accept)');
    const churn = reports.nth(1);
    const text = await churn.innerText();
    assert.ok(text.includes(VERDICT_TEXT.full) && /88% sure/.test(text), `input 2 shows the accepted verdict and 88% sure: ${text}`);
    const dropped = churn.locator('[data-match-dropped]');
    assert.equal(await dropped.count(), 1, 'input 2 has a dropped list');
    const droppedText = await dropped.innerText();
    assert.ok(droppedText.includes(DROPPED_TITLE) && droppedText.includes('Cancellation events'), `the dropped list names the requirement: ${droppedText}`);
    assert.deepEqual(await churn.locator('[data-match-piece]').evaluateAll((els) => els.map((el) => el.getAttribute('data-match-piece'))), ['1'],
      'the dropped piece is not in the piece list, so it is never shown as matched');
    assert.equal(await reports.nth(0).locator('[data-match-dropped]').count(), 0, 'no dropped list where nothing was dropped');
    assert.ok((await reports.nth(2).locator('[data-match-dropped]').innerText()).includes('Drone flight paths'));
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('c46 must-keep: before Accept (no accepted list) the cards keep the report verdicts and show no dropped list', async () => {
  for (const matchResult of [MATCH_DONE, { ...MATCH_DONE, accepted: [] }]) {
    const { ui, panel, reports } = await openPanel(matchResult);
    try {
      assert.deepEqual(await reports.evaluateAll((els) => els.map((el) => el.getAttribute('data-match-verdict'))), ['full', 'partial', 'none']);
      assert.equal(await panel.locator('[data-match-dropped]').count(), 0);
      assert.equal(await reports.nth(1).locator('[data-match-piece]').count(), 2, 'every piece stays in the review before Accept');
      assert.ok(!(await panel.innerText()).includes(DROPPED_TITLE));
      assert.deepEqual(errors(ui), []);
    } finally { await ui.close(); }
  }
});
