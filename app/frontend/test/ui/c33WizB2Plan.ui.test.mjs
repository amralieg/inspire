// c33 lane B acceptance (REQ-577 5b): the Plan step asks POST plan/sort, shows the five progress lines while it waits, then the ordered runs
// (at most 25 tables each), what was left out, lets the user reorder and sort again, and keeps the plan in the draft. The Start page's
// plan advance POSTs plan/advance on mount. Written by the c33 planner; the lane B builder may not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { PLAN_RUN_MAX, PLAN_STAGES, ROUTES, planFinding } from '../../src/lib/startWizard.js';
import { PLAN, PLAN_FOOTER } from './c33WizFixtures.mjs';

test.after(closeBrowser);

const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));
const draftOf = async (page) => JSON.parse(await page.locator('output[aria-label="Wizard draft"]').innerText());
const ready = (page) => page.locator('output[aria-label="Step ready"]').innerText();
const DRAFT = { businessName: 'Example Co', dataChoice: 'find', catalogs: ['main'] };

function planMount() {
  const sorts = [];
  let release;
  const gate = new Promise((resolve) => { release = resolve; });
  const mount = (app) => app.post(ROUTES.planSort, async (req, res) => {
    sorts.push(req.body);
    if (sorts.length === 1) await gate;
    res.json(PLAN);
  });
  return { sorts, release: () => release(), mount };
}

test('REQ-577 5b: the Plan step shows its progress, then the runs in order with their tables and what was left out (must-fail on the base)', async () => {
  const m = planMount();
  const ui = await openUi('wizStep', {}, '&step=plan', { mount: m.mount, init: (page) => page.addInitScript((d) => { window.__WIZ_DRAFT__ = d; }, DRAFT) });
  const { page } = ui;
  try {
    const step = page.locator('[data-wiz-step="plan"]');
    await step.getByText(planFinding('Example Co')).waitFor({ timeout: 15000 });
    for (const line of PLAN_STAGES) assert.ok(await step.getByText(line, { exact: false }).count() > 0, `progress line: ${line}`);
    assert.equal(await ready(page), 'no', 'not ready while sorting');
    await until(() => m.sorts.length === 1, 'one sort request');
    assert.deepEqual(m.sorts[0].catalogs, ['main']);
    assert.equal(m.sorts[0].business_name, 'Example Co');
    assert.ok(m.sorts[0].warehouse_id, 'the sort names the warehouse');
    m.release();
    await step.getByText('Your plan: 3 runs').waitFor({ timeout: 15000 });
    const runs = step.locator('[data-plan-run]');
    assert.equal(await runs.count(), 3);
    const names = await runs.evaluateAll((els) => els.map((el) => el.getAttribute('data-plan-run')));
    assert.deepEqual(names, ['1', '2', '3'], 'runs show in run order');
    assert.match(await runs.nth(0).innerText(), /Sales and orders[\s\S]*25 tables/);
    assert.match(await runs.nth(1).innerText(), /Stock and stores[\s\S]*15 tables/);
    assert.match(await runs.nth(0).innerText(), /Orders, items and prices join on order id/, 'each run says why');
    for (const run of PLAN.runs) assert.ok(run.tables.length <= PLAN_RUN_MAX);
    assert.match(await step.innerText(), /Left out: 12 tables/);
    assert.match(await step.innerText(), /Copies of other tables/);
    assert.ok((await step.innerText()).includes(PLAN_FOOTER), 'the footer sums the plan');
    await until(async () => (await ready(page)) === 'yes', 'ready once the plan shows');
    const plan = (await draftOf(page)).plan;
    assert.deepEqual(plan.runs.map((r) => r.name), ['Sales and orders', 'Stock and stores', 'People and shifts']);
    assert.equal(plan.runs[0].tables.length, 25);
    assert.deepEqual(errors(ui), []);
  } finally { m.release(); await ui.close(); }
});

test('REQ-577 5b: moving a run down reorders the plan and renumbers it; Sort again asks the model again (must-fail on the base)', async () => {
  const m = planMount();
  m.release();
  const ui = await openUi('wizStep', {}, '&step=plan', { mount: m.mount, init: (page) => page.addInitScript((d) => { window.__WIZ_DRAFT__ = d; }, DRAFT) });
  const { page } = ui;
  try {
    const step = page.locator('[data-wiz-step="plan"]');
    await step.getByText('Your plan: 3 runs').waitFor({ timeout: 15000 });
    await step.locator('[data-plan-run="1"]').getByRole('button', { name: /Move down/ }).click();
    await until(async () => (await draftOf(page)).plan?.runs?.[0]?.name === 'Stock and stores', 'run 2 is now first');
    const plan = (await draftOf(page)).plan;
    assert.deepEqual(plan.runs.map((r) => r.run_no), [1, 2, 3], 'run numbers follow the new order');
    assert.equal(plan.runs[1].name, 'Sales and orders');
    assert.match(await step.locator('[data-plan-run]').first().innerText(), /Stock and stores/);
    assert.equal(await step.locator('[data-plan-run="1"]').getByRole('button', { name: /Move up/ }).isDisabled(), true, 'the first run cannot move up');
    await step.locator('[data-plan-run="2"]').getByRole('button', { name: /Move up/ }).click();
    await until(async () => (await draftOf(page)).plan?.runs?.[0]?.name === 'Sales and orders', 'moved back up');
    await step.getByRole('button', { name: 'Sort again' }).click();
    await until(() => m.sorts.length === 2, 'Sort again sends a second sort');
    await step.getByText('Your plan: 3 runs').waitFor({ timeout: 15000 });
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-577 5b: a failed sort shows a plain error and a way to try again, and the step is not ready (must-fail on the base)', async () => {
  let calls = 0;
  const mount = (app) => app.post(ROUTES.planSort, (_req, res) => {
    calls += 1;
    if (calls === 1) return res.status(502).json({ error: 'The model did not answer. Try again.' });
    return res.json(PLAN);
  });
  const ui = await openUi('wizStep', {}, '&step=plan', { mount, init: (page) => page.addInitScript((d) => { window.__WIZ_DRAFT__ = d; }, DRAFT) });
  const { page } = ui;
  try {
    const step = page.locator('[data-wiz-step="plan"]');
    await step.getByText('The model did not answer. Try again.').waitFor({ timeout: 15000 });
    assert.equal(await ready(page), 'no');
    await step.getByRole('button', { name: 'Sort again' }).click();
    await step.getByText('Your plan: 3 runs').waitFor({ timeout: 15000 });
    await until(async () => (await ready(page)) === 'yes', 'ready after the retry');
    assert.deepEqual(ui.pageErrors.filter((line) => !/status of (40[13]|502)/.test(line)), []);
  } finally { await ui.close(); }
});

test('REQ-577: the plan advance POSTs plan/advance with the database and warehouse when mounted (must-fail on the base)', async () => {
  const advances = [];
  const mount = (app) => app.post(ROUTES.planAdvance, (req, res) => { advances.push(req.body); res.json({ started: [] }); });
  const ui = await openUi('wizStep', {}, '&step=planAdvance', { mount });
  const { page } = ui;
  try {
    await page.getByText('Plan advance mounted').waitFor({ timeout: 15000 });
    await until(() => advances.length >= 1, 'plan/advance was called on mount', 10000);
    assert.equal(advances[0].inspire_database, 'main.inspire');
    assert.equal(advances[0].warehouse_id, 'wh1');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});
