// c33 lane C acceptance (REQ-578, REQ-579): the Match path's "Review and start". It shows the business, the use cases and the data, links
// back to each step, and its registered start POSTs match/start (the match is a run, REQ-579); the shell then opens the Monitor.
// Written by the c33 planner; the lane C builder may not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { ROUTES } from '../../src/lib/startWizard.js';
import { MATCH_INPUTS } from './c33WizFixtures.mjs';

test.after(closeBrowser);

const errors = (ui) => ui.pageErrors.filter((line) => !/status of (40[13]|500)/.test(line));
const DRAFT = { path: 'match', businessName: 'Example Co', useCases: MATCH_INPUTS.slice(0, 2), useCaseSource: 'paste' };
const out = (page, name) => page.locator(`output[aria-label="${name}"]`).innerText();

function open(reply) {
  const starts = [];
  const mount = (app) => app.post(ROUTES.matchStart, (req, res) => { starts.push(req.body); reply(res); });
  return openUi('wizStep', {}, '&step=matchReview', { mount, init: (page) => page.addInitScript((d) => { window.__WIZ_DRAFT__ = d; }, DRAFT) })
    .then((ui) => ({ ui, starts }));
}

test('REQ-579: Review and start lists what will run and its start POSTs match/start with the use cases and settings (must-fail on the base)', async () => {
  const { ui, starts } = await open((res) => res.json({ session_id: '7001', run_id: 88 }));
  const { page } = ui;
  try {
    const step = page.locator('[data-wiz-step="matchReview"]');
    await step.waitFor({ timeout: 15000 });
    assert.equal(await step.getAttribute('data-wiz-stub'), null, 'the step is built, not the base stub');
    const text = await step.innerText();
    for (const want of ['Example Co', '2 use cases', 'Forecast weekly demand', 'Reduce customer churn', 'main']) assert.ok(text.includes(want), `the review shows ${want}`);
    await step.locator('[data-wiz-edit="usecases"]').click();
    await step.locator('[data-wiz-edit="data"]').click();
    assert.equal(await out(page, 'Edit step'), 'usecases,data');
    await until(async () => (await out(page, 'Step ready')) === 'yes', 'the review is ready');
    await page.getByRole('button', { name: 'Harness start' }).click();
    await until(async () => (await out(page, 'Launched')) === '7001:88', 'the start answers the session and run');
    assert.equal(starts.length, 1, 'one match/start');
    const body = starts[0];
    assert.equal(body.business_name, 'Example Co');
    assert.equal(body.inspire_database, 'main.inspire');
    assert.equal(body.warehouse_id, 'wh1');
    assert.deepEqual(body.use_cases, MATCH_INPUTS.slice(0, 2));
    assert.equal(body.params['01_uc_metadata'], 'main', 'the Data step picker tables go with the run');
    assert.equal(body.params['05_discovery_type'], 'Standard', 'the settings go with the run');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-579: a refused match/start shows the reason and starts nothing (must-fail on the base)', async () => {
  const { ui, starts } = await open((res) => res.status(500).json({ error: 'The Match notebook is not installed.' }));
  const { page } = ui;
  try {
    await page.locator('[data-wiz-step="matchReview"]').waitFor({ timeout: 15000 });
    await page.getByRole('button', { name: 'Harness start' }).click();
    await until(async () => /The Match notebook is not installed/.test(await out(page, 'Start failed')), 'the start rejects with the server reason');
    assert.equal(await out(page, 'Launched'), '');
    assert.equal(starts.length, 1);
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});
