// REQ-126 (P81): the Review step bar shows the Data Filter Label step when the run's steps say it ran, and not otherwise.
// Fail-pre: before the fix the bar was a fixed list of seven stages, so a labelled run showed no label step at all.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, toView } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const LABEL_STEP = { step_id: '901', stage_name: 'Final Gate', step_name: 'Inspire is working on data filter label',
  sub_step_name: 'Completed: complete', status: 'ended_success', message: 'Inspire has completed data filter label',
  last_updated: '2026-11-15T12:30:00.000Z', progress_increment: 1 };
const QUALITY_STEP = { step_id: '900', stage_name: 'Use Case Prioritization', step_name: 'Inspire is working on quality bar',
  sub_step_name: 'Completed', status: 'ended_success', message: 'Quality bar done', last_updated: '2026-11-15T12:29:00.000Z', progress_increment: 1 };

function withSteps(steps) {
  return (app) => { app.get('/api/inspire/steps', (_req, res) => res.json({ steps })); };
}

async function barStages(steps) {
  const ui = await openUi('results', { ...REVIEW_STATE, results: { ...REVIEW_STATE.results, run_status: 'success' } }, '', { mount: withSteps(steps) });
  try {
    const { page } = ui;
    await toView(page, 'Overview');
    await page.getByText('Every step of the run finished.').waitFor({ timeout: 15000 });
    return {
      label: await page.getByText('Data Filter Label', { exact: true }).count(),
      implementation: await page.getByText('Implementation', { exact: true }).count(),
      pageErrors: ui.pageErrors ?? [],
    };
  } finally {
    await ui.close();
  }
}

test('a labelled run shows its Data Filter Label step on the Review bar', async () => {
  const shown = await barStages([QUALITY_STEP, LABEL_STEP]);
  assert.equal(shown.label, 1, 'the label step that ran is on the bar');
  assert.equal(shown.implementation, 1, 'the fixed stages stay on the bar');
  assert.deepEqual(shown.pageErrors, []);
});

test('an unlabelled run does not show a Data Filter Label step (must-exclude)', async () => {
  const shown = await barStages([QUALITY_STEP]);
  assert.equal(shown.label, 0);
  assert.equal(shown.implementation, 1);
});
