// RC6-B-01, B-03, B-04, B-05, B-06 (live walk of rc.6, lane B): the Start page helper size, the value wizard Filter step after All data,
// the Story data line noun, Calculate now on every step, and the Save profile name.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until, waitForLaunchReady } from './uiSupport.mjs';
import { PLAN, openCard, openWizard } from './valueWizardSupport.mjs';
import { FACTS, goTo507, mountReq507, textOf } from './req507Support.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const STATE = {
  catalogs: ['main'],
  schemas: { main: ['s'] },
  tables: { 'main.s': ['orders'] },
};
const next = (dialog) => dialog.getByRole('button', { name: 'Next', exact: true });

test('RC6-B-01: the Relationships empty state and helper text on the Start page are 12px, the same as every other Data Management helper', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
    await page.locator('[data-relationships-empty]').waitFor({ timeout: 15000 });
    await page.locator('[data-data-filters-empty]').waitFor({ timeout: 15000 });
    const sizeOf = (sel) => page.locator(sel).evaluate((e) => getComputedStyle(e).fontSize);
    const shared = await sizeOf('[data-data-filters-empty]');
    assert.equal(shared, '12px', 'the shared helper text size is 12px');
    assert.equal(await sizeOf('[data-relationships-empty]'), shared, 'the relationships empty state uses the shared helper size');
    const intro = await page.locator('[data-section="relationships"] > p').first().evaluate((e) => getComputedStyle(e).fontSize);
    assert.equal(intro, shared, 'the relationships intro line uses the shared helper size');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('RC6-B-03: after All data, the Filter step shows no "Describe the rows to keep" examples, only an optional note', async () => {
  const { ui, card, page } = await openCard(mountReq507());
  try {
    const dialog = await openWizard(page, card);
    await dialog.locator('[data-wizard-page="scope:facts"]').waitFor({ timeout: 15000 });
    await next(dialog).click();
    await dialog.locator('[data-wizard-page="scope:choice"]').waitFor();
    await dialog.locator('[data-scope-choice="all"]').click();
    await next(dialog).click();
    await dialog.locator('[data-wizard-page="filter"]').waitFor();
    const body = await textOf(dialog.locator('[data-wizard-body]'));
    assert.doesNotMatch(body, /Describe the rows to keep/);
    assert.equal(await dialog.locator('[data-filter-example]').count(), 0, 'no example chips');
    assert.equal(await dialog.locator('[data-filter-optional]').count(), 1, 'a clear optional, nothing to filter note');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('RC6-B-04: the Story data line names records for a plain record count, never the case noun of the use case', async () => {
  const facts = { ...FACTS, rows: 3333, noun: 'unusual transaction' };
  const plan = { ...PLAN, case_noun: 'unusual transaction' };
  const { ui, card, page } = await openCard(mountReq507({ facts, plan }));
  try {
    const dialog = await openWizard(page, card);
    await goTo507(dialog, 'scope:choice');
    await dialog.locator('[data-scope-choice="all"]').click();
    await goTo507(dialog, 'story:draft');
    const line = await textOf(dialog.locator('[data-story-line="Data"]'));
    assert.match(line, /Inspire read 3,333 records/);
    assert.doesNotMatch(line, /transaction/);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('RC6-B-05: Calculate now is enabled on the Data step while the case plan is still loading, waits for it, then calculates', async () => {
  const puts = [];
  const mount = (app) => {
    app.post('/api/inspire/value/case-plan', (req, res) => setTimeout(() => res.json({ plan: PLAN }), 2500));
    mountReq507({ puts })(app);
  };
  const { ui, card, page } = await openCard(mount);
  try {
    const dialog = await openWizard(page, card);
    await dialog.locator('[data-wizard-page="scope:facts"]').waitFor({ timeout: 15000 });
    const calc = dialog.getByRole('button', { name: 'Calculate now', exact: true });
    assert.equal(await calc.isEnabled(), true, 'enabled on the Data step');
    await calc.click();
    assert.equal(puts.length, 0, 'nothing is saved before the plan arrives');
    await dialog.locator('[data-wizard-page="save"]').waitFor({ timeout: 30000 });
    assert.equal(puts.length, 1);
    assert.equal(puts[0].answers.calculated, false);
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('RC6-B-06: the Save profile dialog has a Profile name input prefilled with the business name, and the typed name is the saved name', async () => {
  const ui = await openUi('launch', STATE);
  const { page, made } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Draft Corp');
    await page.locator('button[title="main"]').click();
    await page.locator('button[title="s"]').click();
    await page.locator('button[title="orders"]').click();
    await idle(page);
    await waitForLaunchReady(page);
    await page.getByRole('button', { name: 'Get Started' }).click();
    const input = page.getByLabel('Profile name');
    await input.waitFor({ timeout: 10000 });
    assert.equal(await input.inputValue(), 'Draft Corp');
    await input.fill('walk-rc6');
    await page.locator('[data-launch-save-run]').click();
    await until(() => (made.state.profileSaves || []).length === 1, 'the profile was saved');
    assert.equal(made.state.profileSaves[0].name, 'walk-rc6');
    assert.equal(made.state.profileSaves[0].business_name, 'Draft Corp');
    assert.deepEqual(ui.pageErrors.filter((e) => !/status of (403|404)/.test(e)), []);
  } finally { await ui.close(); }
});
