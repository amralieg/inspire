import test from 'node:test';
import assert from 'node:assert/strict';
import { GROUPING_INSTRUCTION, GROUPING_PROFILE, HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { GROUPING_EXAMPLE, GROUPING_PICK, GROUPING_TITLE } from '../../src/lib/runScope.js';
import { RUN_IT_TITLE, WIZARD_STEPS_MAX } from '../../src/lib/implementWizard.js';
import { BUILD_IT, assertOneBadgeOnDefault, choicesShown, closeBrowser, goToStep, onStep, openUi, profileAt, settleChoices, shot, stepsAre } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const WITH_APP = ['1. Data', '2. Data groups', '3. First run', '4. Results', '5. Deliver', '6. Who uses the App', '7. App pages', '8. App look', '9. Run it', '10. Review & build'];
const NO_APP = ['1. Data', '2. First run', '3. Results', '4. Deliver', '5. Run it', '6. Review & build'];
const next = (page) => page.getByRole('button', { name: 'Next' }).click();
const builtLine = (page) => page.locator('[data-built-sentence]').innerText();

function submittedSpec(made) {
  const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
  assert.equal(inserts.length, 1);
  return JSON.parse(inserts[0].parameters.find((p) => p.name === 'spec').value);
}

async function noOldSteps(page) {
  const labels = await page.locator('[data-wizard-header] ol li').allTextContents();
  for (const gone of ['What to build', 'Settings', 'Vibes', 'App', 'MVP Test Run', 'Measure impact', 'Keep it fresh', 'App placement']) {
    assert.equal(labels.some((l) => l.endsWith(`. ${gone}`)), false, `no ${gone} step (must-exclude)`);
  }
  assert.equal(await page.locator('input[name="implement-mode"]').count(), 0, 'no MVP or notebook choice (must-exclude)');
  assert.ok(labels.length <= WIZARD_STEPS_MAX, `${labels.length} steps`);
}

async function onePerQuestion(page, where) {
  await settleChoices(page);
  const shown = await choicesShown(page);
  assertOneBadgeOnDefault(shown, where, { perChoice: true });
  const badges = await page.locator('[role="dialog"] [data-recommended]').evaluateAll((all) => all.filter((b) => b.getClientRects().length).map((b) => b.firstElementChild?.textContent.trim()));
  assert.ok(badges.length <= Math.max(1, shown.length), `${where}: ${badges.length} badges for ${shown.length} questions`);
  for (const text of badges) assert.equal(text, 'Recommended', `${where}: the badge reads Recommended`);
  assert.equal(await page.locator('[role="dialog"]').getByText(/Highly Recommended/i).count(), 0, `${where}: never Highly Recommended (must-exclude)`);
}

async function summaryHasNoCapacity(page) {
  assert.equal(await page.locator('[data-picked-row="capacity"]').count(), 0, 'Summary lists no Team capacity (must-exclude)');
  assert.equal(await page.getByRole('group', { name: 'Team capacity' }).count(), 0);
  assert.equal(await page.getByText(/team capacity/i).count(), 0);
}

test('with the App picked the wizard reads Data, Data groups, First run, Results, Deliver, Who uses the App, App pages, App look, Run it, Review and build, one decision a screen', async () => {
  const ui = await openUi('wizard', { ...ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: GROUPING_INSTRUCTION } }, '', { init: profileAt([], GROUPING_PROFILE) });
  const { page, made } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await onStep(page, 'Use case');
    await stepsAre(page, WITH_APP);
    await noOldSteps(page);
    await page.locator('[data-wizard-header]').waitFor();
    assert.equal(await page.locator('[data-use-case-details-open]').count(), 1, 'the use case is a strip with Details, not a step of its own');
    assert.equal(await page.getByLabel('Decision owner').isVisible(), false, 'the goal and decision owner sit in the Details drawer, not on the step');
    await onePerQuestion(page, 'Use case');
    await shot(page, '01-use-case', false);
    await onStep(page, 'Data');
    await page.getByRole('heading', { name: 'Source tables' }).waitFor();
    assert.equal(await page.getByRole('region', { name: GROUPING_TITLE, exact: true }).count(), 0, 'the groups are their own step, not on Data (must-exclude)');
    await onePerQuestion(page, 'Data');
    await shot(page, '02-data', false);
    await next(page);
    await onStep(page, 'Data groups');
    const groups = page.getByRole('region', { name: GROUPING_TITLE, exact: true });
    await groups.waitFor({ timeout: 30000 });
    assert.equal(await groups.locator('[data-grouping-example-plain]').innerText(), `${GROUPING_EXAMPLE} ${GROUPING_PICK}`, 'the step explains groups with the average salary example');
    assert.equal(await groups.locator('[data-grouping-example-plain]').isVisible(), true, 'in view, not under Details');
    assert.equal(await page.getByRole('heading', { name: 'Source tables' }).count(), 0);
    const combineNote = await groups.locator('[data-grouping-combine-note]').innerText();
    assert.match(combineNote, /^Ticking both \S+ and \S+ gives groups of \S+ and \S+ together/, combineNote);
    assert.equal(combineNote.split(/(?<=\.)\s/).length, 1, 'one line, one sentence');
    await onePerQuestion(page, 'Data groups');
    await shot(page, '03-data-groups', false);
    await next(page);
    await onStep(page, 'First run');
    assert.equal(await page.getByRole('region', { name: GROUPING_TITLE, exact: true }).count(), 0, 'the groups are set on Data groups, not again on First run');
    const chosen = page.locator('[data-grouping-chosen]');
    assert.equal(await chosen.getAttribute('role'), 'note', 'the Data groups line is information');
    assert.doesNotMatch(await chosen.getAttribute('class'), /error|alert|db-red|pink/, 'never in an error colour (must-exclude)');
    assert.equal(await page.locator('[data-grouping-chosen][role="alert"]').count(), 0);
    const records = page.locator('[data-first-run-choice="records"]');
    const label = (await records.locator('label .font-medium').first().innerText()).trim();
    assert.match(label, /^~?[\d,]+ records( in (\d+ whole groups?|whole groups of \S+))?$/, label);
    const details = records.locator('[data-first-run-details="records"]');
    assert.equal(await details.evaluate((d) => d.open), false, 'the group list waits under Details');
    await details.locator('summary').click();
    assert.ok(await details.locator('[data-first-run-group]').count() >= 1, 'Details lists the whole groups');
    for (const id of ['one', 'groups']) {
      assert.match(await page.locator(`[data-first-run-choice="${id}"] [data-first-run-records]`).innerText(), /[\d,]+ records?$/, `${id} shows its records`);
    }
    await onePerQuestion(page, 'First run');
    await shot(page, '04-first-run', false);
    await next(page);
    await onStep(page, 'Results');
    assert.equal(await page.getByRole('group', { name: 'Keep it fresh' }).count(), 0, 'Results holds only where the result table lives');
    await onePerQuestion(page, 'Results');
    await shot(page, '05-results', false);
    await next(page);
    await onStep(page, 'Deliver');
    const notebook = page.locator('[data-output="notebook"] input');
    assert.deepEqual([await notebook.isChecked(), await notebook.isDisabled()], [true, true], 'the notebook is always built');
    assert.equal(await page.getByRole('checkbox', { name: /^App / }).isChecked(), true);
    assert.equal(await page.locator('[data-choice="outputs"]').evaluate((g) => [...g.querySelectorAll('[data-recommended]')].filter((b) => b.closest('[data-choice]') === g).length),
      1, 'one Recommended on Deliver');
    await page.getByRole('region', { name: 'App placement' }).waitFor();
    await page.locator('input[name="app-place"]').first().waitFor();
    await page.getByText('Finding the Apps Inspire built').waitFor({ state: 'detached' });
    assert.equal(await page.getByRole('region', { name: 'App access' }).count(), 0, 'who sees which rows waits for its own step (must-exclude)');
    await onePerQuestion(page, 'Deliver');
    await shot(page, '06-deliver', false);
    await next(page);
    await onStep(page, 'Who uses the App');
    await page.getByRole('region', { name: 'App access' }).waitFor();
    assert.equal(await page.locator('input[name="app-place"]').count(), 0, 'where the App goes was picked on Deliver (must-exclude)');
    assert.equal(await page.getByLabel('App name').count(), 0, 'and so was its name (must-exclude)');
    await onePerQuestion(page, 'Who uses the App');
    assert.equal(await page.getByRole('region', { name: 'App features' }).count(), 0, 'the pages and look wait for their own step (must-exclude)');
    assert.doesNotMatch(await page.locator('[role="dialog"]').innerText(), /service principal|Lakebase/i, 'no internals in view');
    assert.ok((await page.locator('[role="dialog"]').innerText()).split(/could not check/i).length <= 2, 'one sentence says what Inspire could not check');
    await shot(page, '07-who-uses-the-app', false);
    await next(page);
    await onStep(page, 'App pages');
    await page.getByRole('region', { name: 'App features' }).waitFor();
    assert.equal(await page.locator('input[name="app-place"]').count(), 0, 'placement stays on Deliver (must-exclude)');
    assert.equal(await page.getByRole('region', { name: 'App access' }).count(), 0, 'and access on Who uses the App (must-exclude)');
    await onePerQuestion(page, 'App pages');
    await shot(page, '08-app-pages', false);
    await next(page);
    await onStep(page, 'App look');
    await onePerQuestion(page, 'App look');
    await next(page);
    await onStep(page, 'Run it');
    assert.equal(await page.locator('[data-run-it]').innerText(), RUN_IT_TITLE);
    const fresh = page.getByRole('group', { name: 'Keep it fresh' });
    assert.equal(await fresh.getByRole('button', { name: 'Daily' }).getAttribute('aria-pressed'), 'true', 'Keep it fresh is on, Daily, by default');
    assert.equal(await page.getByRole('checkbox', { name: /^Hold back/ }).count(), 1, 'Measure impact sits on Run it');
    await onePerQuestion(page, 'Run it');
    await shot(page, '09-run-it', false);
    await next(page);
    await onStep(page, 'Review & build');
    assert.match(await builtLine(page), /^The MVP: .*App.*, the result table and the notebook that fills it\.$/);
    await page.getByRole('region', { name: 'Vibes' }).waitFor();
    await summaryHasNoCapacity(page);
    await shot(page, '10-summary', false);
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
    await shot(page, 'notebook-only-05-deliver', false);
    await goToStep(page, 'Review & build');
    assert.equal(await builtLine(page), 'The MVP: the result table and the notebook that fills it.');
    await summaryHasNoCapacity(page);
    await shot(page, 'notebook-only-07-summary', false);
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
    assert.equal(await page.locator('[data-output="app"] [data-recommended]').count(), 0, 'the dimmed App carries no Recommended');
    await stepsAre(page, NO_APP);
    await noOldSteps(page);
    await shot(page, 'app-unaffordable-05-deliver', false);
    await goToStep(page, 'Review & build');
    assert.doesNotMatch(await builtLine(page), /\bApp\b/);
    assert.match(await page.locator('[data-picked-row="dropped"] [data-picked-value]').innerText(), /^App: \S/, 'Summary says the App is not built and why');
    await summaryHasNoCapacity(page);
    await shot(page, 'app-unaffordable-07-summary', false);
    await page.getByRole('button', { name: BUILD_IT, exact: true }).click();
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.equal(submittedSpec(made).outputs.app, false);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
