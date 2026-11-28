// c33 lane A acceptance (REQ-577, REQ-578, REQ-579): the wizard steps. Discover path: Business, Data (find or choose, with the
// production-catalog advice), Plan only on the find path, Goals, Settings without Operation, Review and start. Match path: Your use cases,
// Data, Review and start (REQ-579: no Match result screen in the wizard). The lane B and C steps are base stubs that report ready.
// Written by the c33 planner; the lane A builder may not edit this file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, until } from './uiSupport.mjs';
import { DATA_TEXT, PRODUCTION_CATALOG_ADVICE, ROUTES, TABLE_ELECTION_BY_PLAN, WIZ_TITLE, WIZ_TITLE_MATCH } from '../../src/lib/startWizard.js';
import { PLAN } from './c33WizFixtures.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const EMPTY = { sessions: [], portfolioRuns: [{ runs: '0', businesses: '0' }], portfolioUseCases: [], portfolioMvps: [] };
const errors = (ui) => ui.pageErrors.filter((line) => !/status of 40[13]/.test(line));
const pillsOf = async (dialog) => (await dialog.locator('ol[aria-label="Steps"] li').allInnerTexts()).map((t) => t.replace(/^\s*\d+\.\s*/, '').replace(/\s+/g, ' ').trim());
const current = (dialog) => dialog.locator('ol[aria-label="Steps"] [aria-current="step"]').innerText();
const next = (dialog) => dialog.getByRole('button', { name: 'Next', exact: true });

// The lane B and C steps are stubs on the base and real after the merge; these tests drive both (a real step's controls are used when present).
const planMount = (app) => app.post(ROUTES.planSort, (_req, res) => res.json(PLAN));
async function openWizard(state = EMPTY) {
  const ui = await openUi('choose', state, '', { mount: planMount });
  await ui.page.locator('[data-start-new]').first().click();
  const dialog = ui.page.getByRole('dialog', { name: WIZ_TITLE });
  await dialog.waitFor({ timeout: 15000 });
  return { ui, dialog };
}

async function toData(dialog) {
  await dialog.locator('[data-wiz-path="discover"]').click();
  await next(dialog).click();
  await dialog.locator('[data-wiz-step="business"]').getByPlaceholder(BUSINESS).fill('Example Co');
  await next(dialog).click();
  await dialog.locator('[data-wiz-step="data"]').waitFor({ timeout: 10000 });
}

test('REQ-577 3-4: Discover shows Start, Business, Data, Plan, Goals, Settings, Review; Business needs a name and keeps it (must-fail on the base)', async () => {
  const { ui, dialog } = await openWizard();
  try {
    await dialog.locator('[data-wiz-path="discover"]').click();
    assert.deepEqual(await pillsOf(dialog), ['Start', 'Business', 'Data', 'Plan', 'Goals', 'Settings', 'Review']);
    await next(dialog).click();
    const business = dialog.locator('[data-wiz-step="business"]');
    await business.getByText('Which business is this for?').waitFor();
    assert.ok(await business.getByText('Load a saved profile').count() > 0, 'a saved profile can be loaded here');
    assert.equal(await next(dialog).isDisabled(), true, 'Next waits for a business name');
    await business.getByPlaceholder(BUSINESS).fill('Example Co');
    assert.equal(await next(dialog).isDisabled(), false);
    assert.match(await dialog.innerText(), /Your discovery so far[\s\S]*Example Co/, 'the side card shows the business');
    await next(dialog).click();
    await dialog.getByRole('button', { name: 'Back', exact: true }).click();
    assert.equal(await dialog.locator('[data-wiz-step="business"]').getByPlaceholder(BUSINESS).inputValue(), 'Example Co', 'Back keeps what was typed');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-577 5 / REQ-578: the Data step offers Find suitable data for me (default) or choose myself, and advises production catalogs only (must-fail on the base)', async () => {
  const { ui, dialog } = await openWizard();
  try {
    await toData(dialog);
    const data = dialog.locator('[data-wiz-step="data"]');
    await data.getByText('Which data should Inspire use?').waitFor();
    assert.equal((await data.locator('[data-production-advice]').innerText()).trim(), PRODUCTION_CATALOG_ADVICE);
    const find = data.locator('[data-wiz-data-choice="find"]');
    const choose = data.locator('[data-wiz-data-choice="choose"]');
    assert.ok((await find.innerText()).includes(DATA_TEXT.find));
    assert.ok((await choose.innerText()).includes(DATA_TEXT.choose));
    assert.equal(await find.getAttribute('aria-pressed'), 'true', 'Find suitable data for me is the default');
    assert.equal(await data.locator('[data-wiz-step="find"]').count(), 1, 'the find choice shows the lane B step');
    await choose.click();
    assert.deepEqual(await pillsOf(dialog), ['Start', 'Business', 'Data', 'Goals', 'Settings', 'Review'], 'no Plan step when choosing myself');
    await data.locator('button[title="main"]').waitFor({ timeout: 15000 });
    assert.equal(await data.locator('[data-wiz-step="find"]').count(), 0);
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-577 6-8 / REQ-578: choose myself, Goals, Settings without Operation, Review and start launches one Discover run (must-fail on the base)', async () => {
  const { ui, dialog } = await openWizard();
  const { page, made } = ui;
  try {
    await toData(dialog);
    const data = dialog.locator('[data-wiz-step="data"]');
    await data.locator('[data-wiz-data-choice="choose"]').click();
    await data.locator('button[title="main"]').click();
    await until(async () => !(await next(dialog).isDisabled()), 'Next is on once a catalog is picked', 15000);
    await next(dialog).click();
    const goals = dialog.locator('[data-wiz-step="goals"]');
    await goals.waitFor();
    for (const label of ['Generation instructions', 'Business priorities']) assert.ok(await goals.getByText(label, { exact: false }).count() > 0, `${label} is on Goals`);
    await next(dialog).click();
    const settings = dialog.locator('[data-wiz-step="settings"]');
    await settings.getByText('Discovery type', { exact: false }).first().waitFor();
    await settings.getByRole('button', { name: /More settings/ }).click();
    assert.equal(await settings.getByText('Operation', { exact: true }).count(), 0, 'Operation is gone from the settings (REQ-578)');
    assert.doesNotMatch(await dialog.innerText(), /Generate Use Cases/, 'no Generate Use Cases anywhere in the wizard');
    assert.equal(await settings.locator('select option', { hasText: 'Generate Use Cases' }).count(), 0);
    await next(dialog).click();
    const review = dialog.locator('[data-wiz-step="review"]');
    await review.getByText('Check and start').waitFor();
    assert.match(await review.innerText(), /Example Co/);
    await review.locator('[data-wiz-edit="business"]').click();
    assert.equal(await current(dialog).then((t) => /Business/.test(t)), true, 'Edit jumps back to Business');
    for (let i = 0; i < 4; i += 1) await next(dialog).click();
    await dialog.locator('[data-wiz-step="review"]').waitFor();
    await dialog.locator('[data-wiz-start]').click();
    await until(() => made.launches.length === 1, 'one run was sent', 20000);
    const params = made.launches[0].params;
    assert.equal(params['15_operation'], 'Discover Use Cases');
    assert.equal(params['00_business_name'], 'Example Co');
    assert.match(String(params['01_uc_metadata'] || ''), /^main/);
    await until(async () => (await page.locator('output[aria-label="Launched"]').innerText()).endsWith(':99'), 'the Start page hears the launch (run 99)', 15000);
    assert.equal(made.launches.length, 1, 'exactly one launch');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-577 6: on the find path the table election is set by the plan (must-fail on the base)', async () => {
  const { ui, dialog } = await openWizard();
  try {
    await toData(dialog);
    const mainBox = dialog.locator('[data-wiz-step="find"]').getByRole('checkbox', { name: 'main', exact: true });
    if (await mainBox.count()) await mainBox.check();
    await until(async () => !(await next(dialog).isDisabled()), 'the find step reports ready', 10000);
    await next(dialog).click();
    await dialog.locator('[data-wiz-step="plan"]').waitFor();
    await until(async () => !(await next(dialog).isDisabled()), 'the plan step reports ready', 15000);
    await next(dialog).click();
    await dialog.locator('[data-wiz-step="goals"]').waitFor();
    await next(dialog).click();
    const settings = dialog.locator('[data-wiz-step="settings"]');
    await settings.getByRole('button', { name: /More settings/ }).click();
    await settings.getByText(TABLE_ELECTION_BY_PLAN).waitFor({ timeout: 5000 });
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});

test('REQ-578 / REQ-579: the Match path is Start, Your use cases, Data, Review and start, with its own title and no result screen (must-fail on the base)', async () => {
  const { ui, dialog: first } = await openWizard();
  try {
    await first.locator('[data-wiz-path="match"]').click();
    const dialog = ui.page.getByRole('dialog', { name: WIZ_TITLE_MATCH });
    await dialog.waitFor({ timeout: 5000 });
    assert.deepEqual(await pillsOf(dialog), ['Start', 'Your use cases', 'Data', 'Review']);
    await next(dialog).click();
    const usecases = dialog.locator('[data-wiz-step="usecases"]');
    await usecases.waitFor();
    const list = usecases.getByRole('textbox', { name: 'Your use cases' });
    if (await list.count()) {
      await usecases.getByPlaceholder(BUSINESS).fill('Example Co');
      await list.fill('Forecast weekly demand: Predict units per store and week');
    }
    await until(async () => !(await next(dialog).isDisabled()), 'the use cases step reports ready', 10000);
    await next(dialog).click();
    const data = dialog.locator('[data-wiz-step="data"]');
    await data.waitFor();
    assert.equal((await data.locator('[data-production-advice]').innerText()).trim(), PRODUCTION_CATALOG_ADVICE, 'the match Data step gives the same advice');
    assert.equal(await data.locator('[data-wiz-data-choice]').count(), 0, 'the match path picks catalogs and tables itself (no find choice)');
    await data.locator('button[title="main"]').click();
    await until(async () => !(await next(dialog).isDisabled()), 'Next is on once a catalog is picked', 15000);
    await next(dialog).click();
    await dialog.locator('[data-wiz-step="matchReview"]').waitFor();
    assert.equal(await dialog.locator('[data-wiz-step="match"]').count(), 0, 'no Match result screen in the wizard (REQ-579)');
    assert.equal(await dialog.locator('[data-wiz-start]').count(), 1, 'the last step has the start button');
    assert.deepEqual(errors(ui), []);
  } finally { await ui.close(); }
});
