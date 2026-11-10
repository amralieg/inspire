import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, onStep, openAdvanced, openUi, profileAt } from './uiSupport.mjs';
import { GROUPING_PROFILE } from './implementFixtures.js';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const stepLabels = async (page) => (await page.locator('[data-wizard-header] ol li').allTextContents()).map((l) => l.replace(/^\d+\. /, '').trim());
const stepGo = (page, id) => page.locator(`[data-step-go="${id}"]`);
const buildNow = (page) => page.locator('[data-build-now]');

test('the wizard starts on Data with no Use case step: the use case is a strip with Details, and no Advanced settings text is left', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await onStep(page, 'Data');
    const labels = await stepLabels(page);
    assert.equal(labels[0], 'Data', labels.join(' | '));
    assert.equal(labels.includes('Use case'), false, 'no Use case step (must-exclude)');
    assert.equal(await page.getByText('Advanced settings', { exact: false }).count(), 0, 'no Advanced settings text on any step (must-exclude)');
    assert.equal(await page.getByRole('heading', { name: 'Is this the use case you want to build?' }).count(), 0, 'the old use case question is gone (must-exclude)');
    await page.locator('[data-use-case-details-open]').click();
    const drawer = page.getByRole('dialog', { name: /^Use case details: / });
    await drawer.getByLabel('Goal sentence').waitFor();
    assert.ok((await drawer.getByLabel('Decision owner').inputValue()).length > 0, 'the decision owner shows in the drawer');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the stepper is a row of buttons: a finished step ticks, and a step after an invalid one cannot be reached', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await onStep(page, 'Data');
    await stepGo(page, 'results').waitFor();
    assert.equal(await stepGo(page, 'results').count(), 1, 'a later step is a button once the steps before it are valid');
    assert.equal(await page.locator('[data-wizard-header] ol li button').first().count() > 0, true);
    await page.locator('[data-use-case-details-open]').click();
    const drawer = page.getByRole('dialog', { name: /^Use case details: / });
    await drawer.getByLabel('Goal sentence').fill('');
    await drawer.getByRole('button', { name: 'Close details' }).click();
    await page.waitForFunction(() => !document.querySelector('[data-use-case-drawer]'));
    await page.waitForTimeout(300);
    assert.equal(await stepGo(page, 'results').count(), 0, 'Results is not reachable while the goal is empty (must-exclude)');
    await page.locator('[data-use-case-details-open]').click();
    await page.getByRole('dialog', { name: /^Use case details: / }).getByLabel('Goal sentence').fill('Forecast billed revenue by district');
    await page.getByRole('button', { name: 'Close details' }).click();
    await page.waitForFunction(() => document.querySelector('[data-step-go="results"]'));
    await stepGo(page, 'results').click();
    await onStep(page, 'Results');
    const ticked = await page.locator('[data-wizard-header] ol li').first().locator('svg').count();
    assert.equal(ticked, 1, 'the finished Data step shows a tick');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Build with these choices is on every step after Data and not on Data itself', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await onStep(page, 'Data');
    assert.equal(await buildNow(page).count(), 0, 'not on Data (must-exclude)');
    await goToStep(page, 'Results');
    await buildNow(page).waitFor();
    await page.waitForFunction(() => {
      const b = document.querySelector('[data-build-now]');
      return b && !b.disabled;
    }, null, { timeout: 15000 });
    await buildNow(page).click();
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('every setting that used to sit under Advanced settings opens from its own Change line on its step', async () => {
  const ui = await openUi('wizard', ME);
  const { page } = ui;
  try {
    await onStep(page, 'Data');
    for (const label of ['Window start', 'Window end']) assert.equal(await page.getByLabel(label, { exact: true }).count(), 0, `${label} waits behind its Change line`);
    await openAdvanced(page, 'data settings');
    for (const label of ['Window start', 'Window end']) await page.getByLabel(label, { exact: true }).first().waitFor();
    await goToStep(page, 'Run it');
    await openAdvanced(page, 'run settings');
    for (const label of [/^Cron \(Quartz\)/, /^Timezone/]) await page.getByLabel(label).first().waitFor();
    assert.equal(await page.getByRole('button', { name: /^(Change|Close) / }).count() >= 1, true);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const TWENTY = Array.from({ length: 20 }, (_, i) => `attr_${String(i + 1).padStart(2, '0')}`);
const twentyColumns = {
  ...GROUPING_PROFILE,
  reason: 'Inspire recommends attr_01 because the use case names attr_01.',
  recommended: [TWENTY[0]],
  recommended_by: 'use_case',
  group_column: TWENTY[0],
  groups_for: TWENTY[0],
  example: null,
  group_list: [],
  suggested_groups: [],
  columns: TWENTY.map((name, i) => ({ name, type: 'string', distinct: 3 + i, smallest: 10, largest: 1000, nulls: 0, parent: null })),
  column_groups: Object.fromEntries(TWENTY.map((name) => [name, [{ value: 'a', records: 100 }, { value: 'b', records: 80 }]])),
  group_sizes: [{ value: 'a', records: 100 }, { value: 'b', records: 80 }],
};

test('Data groups with 20 columns shows a short list with a Show all and a search, and the default has its one-line reason', async () => {
  const ui = await openUi('wizard', ME, '', { init: profileAt([], twentyColumns) });
  const { page } = ui;
  try {
    await goToStep(page, 'Data groups');
    await page.locator('[data-grouping-default-note]').waitFor();
    assert.equal(await page.locator('[data-grouping-default-note]').innerText(), 'Inspire picked this default because the use case names it.');
    const shown = await page.locator('[data-grouping-choice]').count();
    assert.ok(shown > 0 && shown <= 8, `${shown} grouping cards shown of 20 columns (must-exclude: all twenty at once)`);
    await page.getByRole('button', { name: /^Show all 2\d columns$/ }).first().waitFor();
    const overflow = await page.evaluate(() => {
      const el = document.querySelector('[role="dialog"]');
      return el ? el.scrollWidth - el.clientWidth : 0;
    });
    assert.ok(overflow <= 1, `the step is wider than its dialog by ${overflow}px`);
    await page.getByRole('button', { name: /^Show all 2\d columns$/ }).first().click();
    const find = page.locator('[data-show-all-open="grouping"] input[type="search"]');
    await find.fill('attr_13');
    await page.locator('[data-grouping-choice="attr_13"]').waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Next on Results does not wait for the own schema to be created: the step moves on and the build waits for it', async () => {
  const delayed = (app) => {
    app.post('/api/inspire/implement/create-schema', (_req, res) => setTimeout(() => res.json({ warnings: [] }), 6000));
  };
  const ui = await openUi('wizard', {
    me: { userName: OWNER, displayName: 'Owner' }, forwardedToken: 'person-tok', dbToken: 'person-tok', catalogs: ['main'], schemas: { main: ['inspire'] },
    statements: { 'information_schema.schema_tags': () => ({ rows: [{ kind: 'right', schema_name: '', value: 'CREATE_SCHEMA' }] }) },
  }, '', { mount: delayed });
  const { page } = ui;
  try {
    await goToStep(page, 'Results');
    await page.locator('[data-option="own"] [data-recommended]').waitFor();
    await page.locator('input[name="result-place"][value="own"]').waitFor();
    const started = Date.now();
    await page.getByRole('button', { name: 'Next' }).click();
    await page.getByRole('heading', { name: 'How will people use this use case?' }).waitFor({ timeout: 4000 });
    assert.ok(Date.now() - started < 4000, 'Deliver opened while the schema was still being created');
    await page.locator('[data-schema-job="running"]').waitFor();
    assert.equal(await page.locator('[data-build-now]').isDisabled(), true, 'Build with these choices waits for the schema (must-exclude: building before it exists)');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
