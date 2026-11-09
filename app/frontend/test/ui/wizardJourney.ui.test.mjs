import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPING_INSTRUCTION, GROUPING_PROFILE, HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { GROUPING_TITLE } from '../../src/lib/runScope.js';
import { RUN_IT_TITLE } from '../../src/lib/implementWizard.js';
import { BUILD_IT, closeBrowser, goToStep, onStep, openUi, profileAt, shot, stepsAre } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const WITH_APP = ['1. Data', '2. First run', '3. Results', '4. Deliver', '5. App', '6. Run it', '7. Summary'];
const NO_APP = ['1. Data', '2. First run', '3. Results', '4. Deliver', '5. Run it', '6. Summary'];
const next = (page) => page.getByRole('button', { name: 'Next' }).click();
const builtLine = (page) => page.locator('[data-built-sentence]').innerText();

function submittedSpec(made) {
  const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
  assert.equal(inserts.length, 1);
  return JSON.parse(inserts[0].parameters.find((p) => p.name === 'spec').value);
}

async function noOldSteps(page) {
  const labels = await page.locator('[data-wizard-header] ol li').allTextContents();
  for (const gone of ['What to build', 'Settings', 'Vibes', 'Data groups', 'MVP Test Run', 'Measure impact', 'Keep it fresh', 'App placement']) {
    assert.equal(labels.some((l) => l.endsWith(`. ${gone}`)), false, `no ${gone} step (must-exclude)`);
  }
  assert.equal(await page.locator('input[name="implement-mode"]').count(), 0, 'no MVP or notebook choice (must-exclude)');
}

async function summaryHasNoCapacity(page) {
  assert.equal(await page.locator('[data-picked-row="capacity"]').count(), 0, 'Summary lists no Team capacity (must-exclude)');
  assert.equal(await page.getByRole('group', { name: 'Team capacity' }).count(), 0);
  assert.equal(await page.getByText(/team capacity/i).count(), 0);
}

test('with the App picked the wizard reads Data, First run, Results, Deliver, App, Run it, Summary, from your data to people using it', async () => {
  const ui = await openUi('wizard', { ...ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: GROUPING_INSTRUCTION } }, '', { init: profileAt([], GROUPING_PROFILE) });
  const { page, made } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await onStep(page, 'Data');
    await page.getByRole('region', { name: GROUPING_TITLE, exact: true }).waitFor({ timeout: 30000 });
    await stepsAre(page, WITH_APP);
    await noOldSteps(page);
    await page.getByRole('heading', { name: 'Source tables' }).waitFor();
    await shot(page, '1-data', false);
    await next(page);
    await onStep(page, 'First run');
    assert.equal(await page.getByRole('region', { name: GROUPING_TITLE, exact: true }).count(), 0, 'the groups are set on Data, not again on First run');
    await shot(page, '2-first-run', false);
    await next(page);
    await onStep(page, 'Results');
    assert.equal(await page.getByRole('group', { name: 'Keep it fresh' }).count(), 0, 'Results holds only where the result table lives');
    await shot(page, '3-results', false);
    await next(page);
    await onStep(page, 'Deliver');
    const notebook = page.locator('[data-output="notebook"] input');
    assert.deepEqual([await notebook.isChecked(), await notebook.isDisabled()], [true, true], 'the notebook is always built');
    assert.equal(await page.getByRole('checkbox', { name: /^App / }).isChecked(), true);
    assert.equal(await page.locator('[data-choice="outputs"]').evaluate((g) => [...g.querySelectorAll('[data-highly-recommended]')].filter((b) => b.closest('[data-choice]') === g).length),
      1, 'one Recommended on Deliver');
    await shot(page, '4-deliver', false);
    await next(page);
    await onStep(page, 'App');
    await page.locator('input[name="app-place"]').first().waitFor();
    assert.doesNotMatch(await page.locator('[role="dialog"]').innerText(), /service principal|Lakebase/i, 'no internals in view');
    await shot(page, '5-app', false);
    await next(page);
    await onStep(page, 'Run it');
    assert.equal(await page.locator('[data-run-it]').innerText(), RUN_IT_TITLE);
    const fresh = page.getByRole('group', { name: 'Keep it fresh' });
    assert.equal(await fresh.getByRole('button', { name: 'Daily' }).getAttribute('aria-pressed'), 'true', 'Keep it fresh is on, Daily, by default');
    assert.equal(await page.getByRole('checkbox', { name: /^Hold back/ }).count(), 1, 'Measure impact sits on Run it');
    await shot(page, '6-run-it', false);
    await next(page);
    await onStep(page, 'Summary');
    assert.match(await builtLine(page), /^The MVP: .*App.*, the result table and the notebook that fills it\.$/);
    await page.getByRole('region', { name: 'Vibes' }).waitFor();
    await summaryHasNoCapacity(page);
    await shot(page, '7-summary', false);
    await page.getByRole('button', { name: BUILD_IT, exact: true }).click();
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    const spec = submittedSpec(made);
    assert.equal(spec.outputs.app, true);
    assert.equal(spec.schedule.enabled, true);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a notebook-only build is Deliver with only Notebook ticked: no App step, and Summary says only the notebook and its table are built', async () => {
  const ui = await openUi('wizard', ME);
  const { page, made } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToStep(page, 'Deliver');
    for (const name of [/^App /, /^Genie Agent/, /^Dashboard/, /^Alert/]) {
      const box = page.getByRole('checkbox', { name });
      if (await box.isChecked()) await box.uncheck();
    }
    await stepsAre(page, NO_APP);
    await noOldSteps(page);
    await shot(page, 'notebook-only-4-deliver', false);
    await goToStep(page, 'Summary');
    assert.equal(await builtLine(page), 'The MVP: the result table and the notebook that fills it.');
    await summaryHasNoCapacity(page);
    await shot(page, 'notebook-only-6-summary', false);
    await page.getByRole('button', { name: BUILD_IT, exact: true }).click();
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    const { outputs } = submittedSpec(made);
    assert.deepEqual([outputs.app, outputs.genie_space, outputs.dashboard, outputs.alert], [false, false, false, false]);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('an App Inspire cannot afford is dimmed on Deliver with one plain reason and the grant under Details, gets no App step, and Summary names it as not built', async () => {
  const sp = (level, privilege, principal, mine) => ({ level, privilege, principal, mine: mine ? 'true' : 'false', me: 'inspire-sp' });
  const access = [sp('catalog', 'OWNER', 'admins', false), sp('schema', 'OWNER', 'data-eng', false), sp('catalog', 'USE_CATALOG', 'inspire-sp', true),
    sp('schema', 'USE_SCHEMA', 'inspire-sp', true), sp('schema', 'CREATE_TABLE', 'inspire-sp', true)];
  const ui = await openUi('wizard', { ...ME, access });
  const { page, made } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await goToStep(page, 'Deliver');
    const appBox = page.getByRole('checkbox', { name: /^App / });
    await page.locator('[data-blocked-reason="app"]').waitFor({ timeout: 15000 });
    assert.deepEqual([await appBox.isDisabled(), await appBox.isChecked()], [true, false]);
    const blocked = page.locator('[data-blocked-reason="app"]');
    assert.equal((await blocked.locator('p').allTextContents()).length, 1, 'one plain reason');
    await blocked.getByText('Details', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-output="app"] [data-highly-recommended]').count(), 0, 'the dimmed App carries no Recommended');
    await stepsAre(page, NO_APP);
    await noOldSteps(page);
    await shot(page, 'app-unaffordable-4-deliver', false);
    await goToStep(page, 'Summary');
    assert.doesNotMatch(await builtLine(page), /\bApp\b/);
    assert.match(await page.locator('[data-picked-row="dropped"] [data-picked-value]').innerText(), /^App: \S/, 'Summary says the App is not built and why');
    await summaryHasNoCapacity(page);
    await shot(page, 'app-unaffordable-6-summary', false);
    await page.getByRole('button', { name: BUILD_IT, exact: true }).click();
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.equal(submittedSpec(made).outputs.app, false);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
