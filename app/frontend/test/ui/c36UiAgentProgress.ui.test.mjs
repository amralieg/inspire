// c36 UI lane acceptance (REQ-581, U2 in the agent/UI interface): a step the run switched off writes its step row with status
// "skipped". The Monitor progress view shows it as a neutral Skipped state: the run stepper marks its phase skipped (not running), the
// Every step dialog labels the row Skipped (not In Progress, not Error, not No end recorded), it is not counted as in progress or as an
// error, and a finished run with a skipped step is not shown as failed. The statuses the Monitor already knows render as before.
// Row contract: each step row in the Every step dialog carries data-step-row="<step_id>" and data-step-category="<category>".
// Written by the c36 spec writer; the builder may not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { KEEP_LIVE_STEPS, MONITOR_MOUNT, RUN_DONE, RUN_LIVE, SESSION_DONE, SESSION_LIVE, SKIPPED_STEP_NAME, SKIP_DONE_STEPS, SKIP_LIVE_STEPS } from './c36Fixtures.mjs';

test.after(closeBrowser);

const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));
const open = (runRead, inspireSession, runSteps) => openUi('monitor', { runRead, inspireSession, runSteps }, '', { mount: MONITOR_MOUNT });

async function stepStates(page) {
  await page.locator('[data-run-stepper]').first().waitFor({ timeout: 20000 });
  await page.waitForFunction(() => [...document.querySelectorAll('[data-run-stepper] [data-run-step]')].some((el) => el.getAttribute('data-state') !== 'todo'), null, { timeout: 20000 });
  return page.evaluate(() => Object.fromEntries([...document.querySelectorAll('[data-run-stepper] [data-run-step]')]
    .map((el) => [el.getAttribute('data-run-step'), el.getAttribute('data-state')])));
}
const everyStepButton = (page) => page.getByRole('button', { name: /Every step/ });
async function openEveryStep(page) {
  await everyStepButton(page).waitFor({ timeout: 20000 });
  await everyStepButton(page).click();
  const dialog = page.getByRole('dialog');
  await dialog.waitFor({ timeout: 10000 });
  return dialog;
}
// Stage groups in the dialog start collapsed; a header is a button holding an h3 with the stage name.
async function expandStage(page, stage) {
  await page.getByRole('dialog').getByRole('button', { name: new RegExp(`^${stage}`) }).filter({ has: page.locator('h3') }).first().click();
}
async function skippedRow(dialog) {
  await expandStage(dialog.page(), 'Business Domain Clustering');
  const row = dialog.locator('[data-step-row]').filter({ hasText: SKIPPED_STEP_NAME });
  await row.first().waitFor({ timeout: 10000 });
  assert.equal(await row.count(), 1, 'one row for the skipped step');
  return row;
}
async function assertNeutralSkipped(row) {
  assert.equal(await row.getAttribute('data-step-category'), 'skipped', 'the skipped row is in its own neutral category');
  const text = (await row.innerText()).replace(/\s+/g, ' ');
  assert.match(text, /\bSkipped\b/, 'the row is labelled Skipped');
  for (const wrong of ['In Progress', 'Error', 'No end recorded', 'Success']) assert.ok(!text.includes(wrong), `the skipped row is not labelled ${wrong}`);
  assert.equal(await row.locator('.animate-spin').count(), 0, 'no spinner on a skipped row');
}

test('REQ-581 U2: a finished run with a skipped step shows the phase as skipped, the row as Skipped, and the run as not failed (must-fail on the base)', async () => {
  const ui = await open(RUN_DONE, SESSION_DONE, SKIP_DONE_STEPS);
  const { page } = ui;
  try {
    const states = await stepStates(page);
    assert.equal(states.domains, 'skipped', 'the switched-off domain phase is skipped, not running');
    assert.equal(states.setup, 'done');
    assert.equal(states.prioritization, 'done');
    assert.match(String(await page.locator('[data-run-step="domains"]').getAttribute('aria-label')), /skipped/i);
    await until(async () => (await page.locator('[data-testid="monitor-status"]').getAttribute('data-status')) === 'success', 'the run shows as finished, not failed', 15000);
    const summary = (await everyStepButton(page).innerText()).replace(/\s+/g, ' ');
    assert.ok(!/in progress/i.test(summary), `the skipped step is not counted in progress: ${summary}`);
    assert.ok(!/\berror/i.test(summary), `the skipped step is not counted as an error: ${summary}`);
    const dialog = await openEveryStep(page);
    await assertNeutralSkipped(await skippedRow(dialog));
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-581 U2: on a live run a skipped step is not running or stuck: phase skipped, row Skipped, nothing counted in progress (must-fail on the base)', async () => {
  const ui = await open(RUN_LIVE, SESSION_LIVE, SKIP_LIVE_STEPS);
  const { page } = ui;
  try {
    const states = await stepStates(page);
    assert.equal(states.domains, 'skipped', 'a skipped phase does not spin as running');
    assert.notEqual(await page.locator('[data-testid="monitor-status"]').getAttribute('data-status'), 'failed', 'a skipped step does not fail the run');
    await everyStepButton(page).waitFor({ timeout: 20000 });
    const summary = (await everyStepButton(page).innerText()).replace(/\s+/g, ' ');
    assert.ok(!/in progress/i.test(summary), `a skipped step is not in progress: ${summary}`);
    const dialog = await openEveryStep(page);
    await assertNeutralSkipped(await skippedRow(dialog));
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-581 U2 regression: started, success, warning and error steps render as before (must-keep)', async () => {
  const ui = await open(RUN_LIVE, SESSION_LIVE, KEEP_LIVE_STEPS);
  const { page } = ui;
  try {
    const states = await stepStates(page);
    assert.deepEqual({ setup: states.setup, context: states.context, tables: states.tables, generation: states.generation },
      { setup: 'done', context: 'warning', tables: 'error', generation: 'active' });
    await everyStepButton(page).waitFor({ timeout: 20000 });
    const summary = (await everyStepButton(page).innerText()).replace(/\s+/g, ' ');
    assert.match(summary, /1 in progress/);
    assert.match(summary, /1 error\b/);
    const dialog = await openEveryStep(page);
    for (const stage of ['Setup', 'Business Understanding', 'Data Preparation', 'Use Cases Generation']) await expandStage(page, stage);
    for (const [name, label] of [['Read the settings', 'Success'], ['Business context', 'Warning'], ['Read the tables', 'Error'], ['Write use cases', 'In Progress']]) {
      const named = dialog.getByText(name, { exact: true }).first();
      await named.waitFor({ timeout: 10000 });
      const rowText = await named.evaluate((el) => {
        let node = el;
        while (node && !(node.innerText || '').match(/Success|Warning|Error|In Progress|No end recorded/)) node = node.parentElement;
        return node ? node.innerText : '';
      });
      assert.ok(rowText.includes(label), `${name} is labelled ${label}`);
    }
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});
