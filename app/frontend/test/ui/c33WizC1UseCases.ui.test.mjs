// c33 lane C acceptance (REQ-578, REQ-579): the "Your use cases" step of the Match path. It takes the business name and the use cases,
// pasted (one per line, "name: description"), uploaded (CSV, XLSX or TXT) or copied from a previous run, numbers them from 1, caps them at
// MATCH_INPUT_MAX and is ready with a business name and one use case. Written by the c33 planner; the lane C builder may not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { MATCH_INPUT_MAX } from '../../src/lib/startWizard.js';
import { xlsxOf } from './c33WizFixtures.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));
const draftOf = async (page) => JSON.parse(await page.locator('output[aria-label="Wizard draft"]').innerText());
const ready = (page) => page.locator('output[aria-label="Step ready"]').innerText();
const DRAFT = { path: 'match', businessName: '', useCases: [] };
const open = (state = {}, extra = {}) => openUi('wizStep', state, '&step=usecases', { ...extra, init: (page) => page.addInitScript((d) => { window.__WIZ_DRAFT__ = d; }, DRAFT) });

test('REQ-578: pasted use cases are numbered from 1, the text after a colon is the description, and Next needs a business and one use case (must-fail on the base)', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    const step = page.locator('[data-wiz-step="usecases"]');
    await step.waitFor({ timeout: 15000 });
    assert.equal(await step.getAttribute('data-wiz-stub'), null, 'the step is built, not the base stub');
    const box = step.getByRole('textbox', { name: 'Your use cases' });
    await box.fill('Forecast weekly demand: Predict units per store and week\n\n  Reduce customer churn  \nPlan staff rosters: Match staff to expected visits\n');
    await step.getByText('3 use cases found').waitFor({ timeout: 5000 });
    assert.equal(await ready(page), 'no', 'not ready without a business name');
    await step.getByPlaceholder(BUSINESS).fill('Example Co');
    await until(async () => (await ready(page)) === 'yes', 'ready with a business and use cases');
    const draft = await draftOf(page);
    assert.equal(draft.businessName, 'Example Co');
    assert.equal(draft.useCaseSource, 'paste');
    assert.deepEqual(draft.useCases, [
      { input_no: 1, name: 'Forecast weekly demand', description: 'Predict units per store and week' },
      { input_no: 2, name: 'Reduce customer churn', description: '' },
      { input_no: 3, name: 'Plan staff rosters', description: 'Match staff to expected visits' },
    ]);
    await box.fill('');
    await until(async () => (await ready(page)) === 'no', 'not ready with no use case');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test(`REQ-578: more than ${MATCH_INPUT_MAX} use cases are cut to ${MATCH_INPUT_MAX} and the step says so (must-fail on the base)`, async () => {
  const ui = await open();
  const { page } = ui;
  try {
    const step = page.locator('[data-wiz-step="usecases"]');
    await step.getByPlaceholder(BUSINESS).fill('Example Co');
    await step.getByRole('textbox', { name: 'Your use cases' }).fill(Array.from({ length: MATCH_INPUT_MAX + 5 }, (_, i) => `Use case ${i + 1}`).join('\n'));
    await step.getByText(`${MATCH_INPUT_MAX} use cases found`).waitFor({ timeout: 5000 });
    assert.match(await step.innerText(), new RegExp(`only the first ${MATCH_INPUT_MAX}`, 'i'));
    const draft = await draftOf(page);
    assert.equal(draft.useCases.length, MATCH_INPUT_MAX);
    assert.equal(draft.useCases[MATCH_INPUT_MAX - 1].input_no, MATCH_INPUT_MAX);
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-578: CSV, XLSX and TXT uploads fill the same list (must-fail on the base)', async () => {
  const ui = await open();
  const { page } = ui;
  try {
    const step = page.locator('[data-wiz-step="usecases"]');
    await step.waitFor({ timeout: 15000 });
    const input = step.locator('input[type="file"]');
    assert.match(String(await input.getAttribute('accept')), /\.csv[\s\S]*\.xlsx[\s\S]*\.txt|\.csv|\.xlsx|\.txt/);
    await input.setInputFiles({ name: 'cases.csv', mimeType: 'text/csv', buffer: Buffer.from('name,description\n"Forecast weekly demand","Predict units, per store"\nReduce customer churn,Find customers likely to leave\n') });
    await step.getByText('2 use cases found').waitFor({ timeout: 5000 });
    let draft = await draftOf(page);
    assert.equal(draft.useCaseSource, 'upload');
    assert.deepEqual(draft.useCases[0], { input_no: 1, name: 'Forecast weekly demand', description: 'Predict units, per store' }, 'a quoted CSV comma stays in the text');
    await input.setInputFiles({ name: 'cases.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      buffer: xlsxOf([['Name', 'Description'], ['Score supplier risk', 'Rate suppliers by late deliveries'], ['Plan staff rosters', 'Match staff to visits'], ['Route vans', 'Shorter routes']]) });
    await step.getByText('3 use cases found').waitFor({ timeout: 5000 });
    draft = await draftOf(page);
    assert.deepEqual(draft.useCases.map((u) => u.name), ['Score supplier risk', 'Plan staff rosters', 'Route vans']);
    assert.equal(draft.useCases[0].description, 'Rate suppliers by late deliveries');
    await input.setInputFiles({ name: 'cases.txt', mimeType: 'text/plain', buffer: Buffer.from('Forecast weekly demand: Predict units\nReduce customer churn\n') });
    await step.getByText('2 use cases found').waitFor({ timeout: 5000 });
    draft = await draftOf(page);
    assert.deepEqual(draft.useCases.map((u) => [u.input_no, u.name, u.description]), [[1, 'Forecast weekly demand', 'Predict units'], [2, 'Reduce customer churn', '']]);
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-578: use cases can be copied from a previous run (must-fail on the base)', async () => {
  const sessions = [{ session_id: '91', business_name: 'Delta Run', completed_percent: 100, processing_status: 'done', create_at: '2026-11-20T09:00:00Z', completed_on: '2026-11-20T10:00:00Z',
    usecase_overview: { total: 2, high: 1, meets: 1, below: 0, domains: 1, unread: {}, preview_use_cases: [{ Name: 'Plan rosters' }, { Name: 'Price promotions' }], use_case_titles: ['Plan rosters', 'Price promotions'] } }];
  const useCases = [
    { session_id: '91', id: 'N01-U01', Name: 'Plan rosters', statement: 'Plan staff rosters from expected visits' },
    { session_id: '91', id: 'N01-U02', Name: 'Price promotions', statement: 'Set promotion prices from past uplift' },
  ];
  const ui = await open({ sessions, useCases });
  const { page } = ui;
  try {
    const step = page.locator('[data-wiz-step="usecases"]');
    await step.getByRole('button', { name: /From a previous run/ }).click();
    await step.getByRole('button', { name: /Delta Run/ }).click();
    await step.getByText('2 use cases found').waitFor({ timeout: 15000 });
    const draft = await draftOf(page);
    assert.equal(draft.useCaseSource, 'run');
    assert.deepEqual(draft.useCases.map((u) => [u.input_no, u.name, u.description]),
      [[1, 'Plan rosters', 'Plan staff rosters from expected visits'], [2, 'Price promotions', 'Set promotion prices from past uplift']], 'GET /api/inspire/usecases of that run: Name and statement');
    assert.equal(draft.businessName, 'Delta Run', 'the run business fills an empty business name');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});
