import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAgainHint, DATA_STOP_HINT, GENIE_CODE_OFF_TITLE, lostTablesText, MVP_MODE_LABEL, NOTEBOOK_MODE_LABEL, VIBE_FEATURES_LABEL } from '../../src/lib/implementWizard.js';
import {
  HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID, MVP_JOB, OWNER, RESULT_TABLE, STUDIO_STATE, built, builtSpec,
} from './implementFixtures.js';
import { closeAsset, closeBrowser, dataToResults, openAdvanced, expandBuild, FAKE_CLOCK, lowContrast, onStep, openAsset, openFeatures, openSettings, openUi, painted, pollNow, setDark, settled, shot, startMvp, stepsAre, toAppAccess, toVibes, until } from './uiSupport.mjs';

const GONE = '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`returns` cannot be found. Verify the spelling. SQLSTATE: 42P01';

test.after(closeBrowser);

const next = (page) => page.getByRole('button', { name: 'Next' }).click();
const TILE_IDS = ['app', 'dashboard', 'genie_space', 'alert', 'notebook', 'job'];
const OUTPUT_IDS = ['app', 'dashboard', 'alert', 'genie_space', 'notebook'];
const assetPanel = (page, id) => page.locator(`[data-asset-panel="${id}"]`);
const tile = (page, id) => page.locator(`[data-asset-tile="${id}"]`);
const runPane = (page) => page.getByRole('region', { name: 'Run and schedule', exact: true });
const historyPane = (page) => page.getByRole('region', { name: 'History', exact: true });
const historyToggle = (page) => historyPane(page).getByRole('button', { name: /^History/ });
const focusedName = (page) => page.evaluate(() => document.activeElement?.getAttribute('aria-label') || document.activeElement?.textContent?.trim() || '');
const VIEW_IDS = ['build', ...TILE_IDS];
const viewSelector = (id) => (id === 'build' ? '[data-mvp-progress]' : `[data-mvp-panel="${id}"]`);
const viewOf = (page, id) => page.locator(viewSelector(id));

async function showView(page, id) {
  if (id !== 'build') return openAsset(page, id);
  if (await page.locator('[data-mvp-panel]').count()) await closeAsset(page);
  return viewOf(page, 'build').waitFor();
}

async function statusLoaded(page) {
  await openAsset(page, 'job');
  await historyPane(page).getByText(/^\d+ spec versions? · /).waitFor({ timeout: 15000 });
  await closeAsset(page);
}

async function openHistory(page) {
  await openAsset(page, 'job');
  const toggle = historyToggle(page);
  if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
}

async function toData(page) {
  await onStep(page, 'Choose');
  await next(page);
  await onStep(page, 'Data');
}
async function toDelivery(page) {
  await dataToResults(page);
  await next(page);
  await onStep(page, 'Delivery');
}

async function throughApp(page, access = /^Internal data/) {
  await toAppAccess(page);
  await page.getByRole('radio', { name: access }).check();
  await next(page);
  await onStep(page, 'App look');
}
const advanced = (page) => page.getByRole('button', { name: 'Advanced settings' });
const footerErrors = (page) => page.locator('[role="alert"] p').allTextContents();

const implementWhenReady = startMvp;

function submittedSpec(made) {
  const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
  assert.equal(inserts.length, 1);
  return JSON.parse(inserts[0].parameters.find((p) => p.name === 'spec').value);
}

test('the wizard starts with the dashboard, Genie Agent and App ticked, drops App access and App look while the App is unticked, and Start MVP launches one run', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page, made } = ui;
  const withApp = ['1. Choose', '2. Data', '3. First run', '4. Results', '5. Delivery', '6. App placement', '7. App access', '8. App look', '9. Settings', '10. Vibes'];
  try {
    await onStep(page, 'Choose');
    await stepsAre(page, withApp);
    const summary = page.getByRole('region', { name: 'Executive summary' });
    await summary.getByText('Cut churn in the top segment').waitFor();
    await summary.getByText('Head of Retention').waitFor();
    assert.equal(await page.getByRole('radio', { name: new RegExp(`^${MVP_MODE_LABEL} \\(default\\)`) }).isChecked(), true);
    assert.equal(await page.getByRole('radio', { name: new RegExp(`^${NOTEBOOK_MODE_LABEL}`) }).isChecked(), false);
    assert.deepEqual(await page.locator('label:has(input[name="implement-mode"])').allInnerTexts().then((t) => t.map((x) => x.replace(/\s+/g, ' ').trim())), [
      'Inspire builds the MVP (default) Genie builds the data, then the App, dashboard, alerts or Genie Agent you pick.',
      'I will build it myself Inspire hands you the Genie Code notebook for this use case. Nothing else is built.',
    ], 'the Choose step names the two ways in plain words');
    assert.equal(await advanced(page).count(), 0, 'Choose has nothing under Advanced settings');
    await next(page);
    await onStep(page, 'Data');
    assert.deepEqual(await page.locator('[data-table]').evaluateAll((rows) => rows.map((r) => r.dataset.table)), ['main.s.orders', 'main.s.returns']);
    assert.equal(await advanced(page).getAttribute('aria-expanded'), 'false');
    assert.equal(await page.getByLabel('Goal sentence').count(), 0, 'every other setting waits under Advanced settings');
    await toDelivery(page);
    for (const name of [/^Dashboard/, /^Genie Agent/, /^App /]) assert.equal(await page.getByRole('checkbox', { name }).isChecked(), true, String(name));
    assert.equal(await page.getByRole('checkbox', { name: /^Alert/ }).isChecked(), false, 'the alert is the one output left off');
    await page.getByRole('checkbox', { name: /^App / }).uncheck();
    await stepsAre(page, ['1. Choose', '2. Data', '3. First run', '4. Results', '5. Delivery', '6. Settings', '7. Vibes']);
    assert.equal(await page.getByRole('button', { name: 'Start MVP', exact: true }).count(), 0, 'without an App, Delivery leads on to Vibes');
    await page.getByRole('checkbox', { name: /^App / }).check();
    await stepsAre(page, withApp);
    assert.equal(await page.getByLabel('App name').count(), 0, 'the App name waits for App placement');
    await page.getByRole('checkbox', { name: /^Alert/ }).check();
    await page.getByText(`Emails ${OWNER} when Act now rows in the latest run are at least 1.`).waitFor();
    await openAdvanced(page);
    const comparison = page.locator('select:has(option[value=">="])');
    assert.deepEqual(await comparison.locator('option').allInnerTexts(), ['at least', 'more than', 'equal to', 'not equal to', 'less than', 'at most'],
      'the alert comparison reads in words, never a symbol');
    await openAdvanced(page);
    const fresh = page.getByRole('group', { name: 'Keep it fresh' });
    assert.equal(await fresh.getByRole('button', { name: 'Off' }).getAttribute('aria-pressed'), 'true', 'Keep it fresh starts Off');
    await fresh.getByRole('button', { name: 'Weekly' }).click();
    assert.equal(await fresh.getByRole('button', { name: 'Weekly' }).getAttribute('aria-pressed'), 'true');
    assert.equal(made.jobs.length, 0);
    assert.equal(await page.getByRole('button', { name: 'Start MVP', exact: true }).count(), 0, 'with an App, Delivery leads on to App placement');
    await next(page);
    await onStep(page, 'App placement');
    assert.equal(await page.getByLabel('App name').inputValue(), 'inspire-hub-acme', 'a new App of a use case with no domain is the business Hub');
    await page.getByText("'inspire-hub-acme' is free").waitFor();
    await next(page);
    await onStep(page, 'App access');
    await page.getByRole('radio', { name: /^Internal data/ }).check();
    await next(page);
    await onStep(page, 'App look');
    await implementWhenReady(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();

    assert.equal(made.jobs.length, 1);
    const params = made.jobs[0].params;
    assert.equal(params['15_operation'], 'Implement Use Cases');
    assert.equal(params.inspire_implement_use_case, 'N01-U01');
    assert.equal(params.inspire_implement_spec_version, '1');
    const spec = submittedSpec(made);
    assert.equal(spec.use_case.decision_owner, OWNER);
    assert.deepEqual(spec.data.column_roles, {}, 'a new MVP leaves every column role to Inspire');
    assert.equal(spec.config.result_table, RESULT_TABLE);
    assert.deepEqual(
      { dashboard: spec.outputs.dashboard, genie_space: spec.outputs.genie_space, app: spec.outputs.app, alert: spec.outputs.alert },
      { dashboard: true, genie_space: true, app: true, alert: true },
    );
    assert.equal(spec.outputs.app_name, 'inspire-hub-acme');
    assert.equal(spec.outputs.app_access, 'sp');
    assert.deepEqual(spec.outputs.app_look, { style: 'a', layout: 'sidebar', palette: 'default', theme: 'light' });
    assert.deepEqual(spec.outputs.app_options, { modify: false, replace_edits: false, decisions: true, alerts: false });
    assert.deepEqual(spec.outputs.merge, { app: '', dashboard: '', genie_space: '' });
    assert.deepEqual(spec.outputs.alert_recipients, [OWNER]);
    assert.deepEqual([spec.schedule.enabled, spec.schedule.cron], [true, '0 0 6 ? * MON']);
    assert.deepEqual(spec.schedule.failure_emails, [OWNER]);
    assert.deepEqual(spec.sharing.principals, [{ type: 'user', name: OWNER }]);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the wizard names the use case as the card the person clicked, while the data comes from the tracking table', async () => {
  const { Name: _cardName, ...row } = HARNESS_USE_CASE;
  const ui = await openUi('wizard', { useCase: { ...row, use_case: 'Keep customers who would leave', statement: 'Keep the top segment buying' } });
  const { page, made } = ui;
  try {
    await onStep(page, 'Choose');
    const summary = page.getByRole('region', { name: 'Executive summary' });
    await summary.getByText('Keep the top segment buying').waitFor();
    assert.equal(await summary.locator('h3').innerText(), HARNESS_USE_CASE.Name);
    assert.equal(await page.getByRole('dialog').getByText('Keep customers who would leave').count(), 0, 'one name for the use case, the one on its card');
    await next(page);
    await onStep(page, 'Data');
    await toDelivery(page);
    await implementWhenReady(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.equal(submittedSpec(made).use_case_name, HARNESS_USE_CASE.Name);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Edit keeps the card name even when the saved version carries the tracking-table name', async () => {
  const legacy = built({ spec_json: JSON.stringify({ ...builtSpec(), use_case_name: 'Keep customers who would leave' }) });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [legacy] });
  const { page } = ui;
  try {
    const shown = page.locator('[data-implement-page]');
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await page.getByRole('heading', { name: HARNESS_USE_CASE.Name, exact: true }).waitFor();
    assert.equal(await shown.getByText('Keep customers who would leave').count(), 0);
    const wizard = await openSettings(page);
    assert.equal(await wizard.locator('[data-wizard-header] h2').innerText(), HARNESS_USE_CASE.Name);
    assert.equal(await wizard.getByText('Keep customers who would leave').count(), 0, 'one name for the use case, the one on its card');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Edit of a failed version the old wizard saved under the use case id names the App after the business Hub, since no App was built', async () => {
  const oldWizard = { ...builtSpec(), outputs: { ...builtSpec().outputs, app_name: 'n01-u01' } };
  const failed = built({
    status: 'failed', spec_json: JSON.stringify(oldWizard), result_rows: null, asset_status: null,
    dashboard_id: null, dashboard_url: null, genie_space_id: null, genie_space_url: null, app_name: null, app_url: null, alert_id: null, alert_url: null,
  });
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, history: [failed] });
  try {
    await toData(ui.page);
    await toDelivery(ui.page);
    await next(ui.page);
    await onStep(ui.page, 'App placement');
    assert.equal(await ui.page.getByLabel('App name').inputValue(), 'inspire-hub-acme', 'the App is the business Hub, not named after the use case id');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the wizard covers the screen from any scroll position, above the App header, inside an animated page', async () => {
  const ui = await openUi('wizard&nest=1', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  try {
    const overlay = page.locator('[data-implement-overlay]');
    await overlay.waitFor();
    await page.evaluate(() => window.scrollTo(0, 1200));
    await page.waitForFunction(() => window.scrollY === 1200);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('main')).transform === 'none', null, { timeout: 5000 })
      .catch(async () => {
        throw new Error(`the page animation leaves a transform behind: ${await page.evaluate(() => getComputedStyle(document.querySelector('main')).transform)}`);
      });
    assert.equal(await overlay.evaluate((el) => el.parentElement === document.body), true, 'the wizard renders at the top of the page');
    const box = await overlay.boundingBox();
    assert.deepEqual([box.x, box.y, box.width, box.height], [0, 0, 1440, 1000], 'the wizard fills the viewport');
    assert.equal(await page.evaluate(() => Boolean(document.elementFromPoint(720, 30)?.closest('[data-implement-overlay]'))), true,
      'the App header never paints over the wizard');
    const dialog = await page.getByRole('dialog', { name: 'Start Use Case MVP with Genie' }).boundingBox();
    assert.ok(dialog.y >= 0 && dialog.y + dialog.height <= 1000, JSON.stringify(dialog));
    const button = await page.getByRole('button', { name: 'Next' }).boundingBox();
    assert.ok(button.y >= 0 && button.y + button.height <= 1000, 'Next is on screen without scrolling the page');
    await page.getByRole('region', { name: 'Executive summary' }).waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the signed-in person is the decision owner and is shared with by default, and removing them under Advanced sticks', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page, made } = ui;
  try {
    await toData(page);
    await advanced(page).click();
    assert.equal(await page.getByLabel('Decision owner').inputValue(), OWNER);
    await toDelivery(page);
    await advanced(page).click();
    const chip = page.getByRole('button', { name: `${OWNER} ×` });
    await chip.waitFor();
    await chip.click();
    await chip.waitFor({ state: 'detached' });
    await implementWhenReady(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    const spec = submittedSpec(made);
    assert.equal(spec.use_case.decision_owner, OWNER);
    assert.deepEqual(spec.sharing.principals, []);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a new App that could not get access is disabled up front with the reason, and a sharing gap warns without blocking', async () => {
  const sp = (level, privilege, principal, mine) => ({ level, privilege, principal, mine: mine ? 'true' : 'false', me: 'inspire-sp' });
  const access = [sp('catalog', 'OWNER', 'admins', false), sp('schema', 'OWNER', 'data-eng', false), sp('catalog', 'USE_CATALOG', 'inspire-sp', true),
    sp('schema', 'USE_SCHEMA', 'inspire-sp', true), sp('schema', 'CREATE_TABLE', 'inspire-sp', true)];
  const ui = await openUi('wizard', { access, me: { userName: OWNER, displayName: 'Owner' } });
  const { page, made } = ui;
  try {
    await toData(page);
    await toDelivery(page);
    const appBox = page.getByRole('checkbox', { name: /^App / });
    await appBox.waitFor();
    assert.equal(await appBox.isDisabled(), true);
    const reason = await page.getByText('Inspire cannot create this App:', { exact: false }).textContent();
    assert.ok(reason.includes(`Inspire cannot create this App: a new App could not read ${RESULT_TABLE}: its service principal needs USE CATALOG on catalog \`main\` (owner admins)`), reason);
    assert.ok(reason.includes('Inspire cannot manage'), reason);
    assert.equal(await page.getByRole('checkbox', { name: /^Genie Agent/ }).isDisabled(), false);
    const warn = page.locator('span.text-warning-fg', { hasText: `${OWNER} may not be able to read the result table` });
    await warn.waitFor();
    assert.equal(await warn.count(), 1, 'the warning shows on the main view, once');
    assert.match(await warn.textContent(), new RegExp(`${OWNER} needs CAN USE on .* to open the dashboard and the Genie Agent, because they query with their own access`));
    assert.equal(await page.getByRole('note', { name: 'Where Inspire saves the MVP' }).count(), 0, 'a session outside /Shared shows no folder warning');
    await implementWhenReady(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.equal(submittedSpec(made).outputs.app, false);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a use case that trains a model stops on Results until Inspire may register its model, and says which grant is missing', async () => {
  const sp = (level, privilege, principal, mine) => ({ level, privilege, principal, mine: mine ? 'true' : 'false', me: 'inspire-sp' });
  const writes = [sp('catalog', 'OWNER', 'admins', false), sp('schema', 'OWNER', 'data-eng', false), sp('catalog', 'USE_CATALOG', 'inspire-sp', true),
    sp('schema', 'USE_SCHEMA', 'inspire-sp', true), sp('schema', 'CREATE_TABLE', 'inspire-sp', true)];
  const useCase = { ...HARNESS_USE_CASE, code_structure_mandate: 'Execution pattern: family B (classification).' };
  const missing = `you need CREATE MODEL on main.inspire to register the model ${RESULT_TABLE}_model`;
  for (const [access, blocked] of [[writes, true], [[...writes, sp('schema', 'CREATE_MODEL', 'inspire-sp', true)], false]]) {
    const ui = await openUi('wizard', { access, useCase, me: { userName: OWNER, displayName: 'Owner' } });
    const { page } = ui;
    try {
      await toData(page);
      await dataToResults(page);
      await next(page);
      const check = page.getByLabel('Result table check');
      if (blocked) {
        await page.locator('[role="alert"] p', { hasText: missing }).waitFor({ timeout: 15000 });
        assert.ok((await footerErrors(page)).includes(missing));
        assert.equal(await page.locator('[aria-current="step"]', { hasText: 'Results' }).count(), 1);
        assert.equal(await check.locator('p.text-error-fg', { hasText: missing }).count(), 1);
      } else {
        await onStep(page, 'Delivery');
        assert.equal(await check.count(), 0);
        await page.getByRole('button', { name: 'Back' }).click();
        await onStep(page, 'Results');
        assert.equal(await page.getByLabel('Result table check').locator('p.text-success-fg', { hasText: `you can register the model ${RESULT_TABLE}_model` }).count(), 1);
      }
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});

test('a session that saves under /Shared says on Delivery that everyone can edit the MVP, without blocking it', async () => {
  const session = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.orders',
    generation_path: '/Shared/demos', inspire_database_name: 'main.inspire' };
  const ui = await openUi('wizard', { session });
  const { page } = ui;
  try {
    await toData(page);
    await toDelivery(page);
    const note = page.getByRole('note', { name: 'Where Inspire saves the MVP' });
    await note.waitFor();
    assert.match(await note.textContent(), /^Inspire saves this MVP under \/Workspace\/Shared\/demos\/acme_implemented\. Everyone in the workspace can edit/);
    assert.equal(await note.evaluate((el) => el.className.includes('text-warning-fg')), true);
    await implementWhenReady(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('every column role starts as Inspire\'s choice, a picked column is type-checked, and only the roles the user picked are sent', async () => {
  const columns = [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'order_date', data_type: 'DATE', ordinal_position: 2 }];
  const ui = await openUi('wizard', { columns, me: { userName: OWNER, displayName: 'Owner' } });
  const { page, made } = ui;
  const role = (name) => page.locator('label').filter({ has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) }).locator('select');
  try {
    await toData(page);
    await advanced(page).click();
    await role('event date').locator('option[value="main.s.orders.order_date"]').waitFor({ state: 'attached' });
    for (const name of ['entity id', 'event date', 'measure', 'label', 'segment']) {
      assert.equal(await role(name).inputValue(), '', `${name} starts empty`);
      assert.equal(await role(name).evaluate((s) => s.selectedOptions[0]?.textContent), "Inspire's choice", name);
    }
    await role('event date').selectOption('main.s.orders.order_id');
    await next(page);
    await page.locator('[role="alert"]').waitFor();
    assert.ok((await footerErrors(page)).some((e) => e.includes('event date main.s.orders.order_id: pick a DATE or TIMESTAMP column')),
      (await footerErrors(page)).join(' | '));
    assert.equal(await page.locator('[aria-current="step"]').innerText(), '2. Data', 'a wrong type keeps the wizard on Data');
    await role('event date').selectOption('main.s.orders.order_date');
    await role('entity id').selectOption('main.s.orders.order_id');
    await role('event date').selectOption('');
    await toDelivery(page);
    await implementWhenReady(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.deepEqual(submittedSpec(made).data.column_roles, { entity_id: 'main.s.orders.order_id' },
      'a role set back to Inspire\'s choice is not sent');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('roles an older wizard guessed come back with the version, and one click sets every role back to Inspire\'s choice', async () => {
  const columns = [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'order_date', data_type: 'DATE', ordinal_position: 2 }];
  const guessed = { ...builtSpec(), data: { ...builtSpec().data, column_roles: { entity_id: 'main.s.orders.order_date', event_date: 'main.s.orders.order_id' } } };
  const failed = built({
    status: 'failed', spec_json: JSON.stringify(guessed), result_rows: null, asset_status: null,
    dashboard_id: null, dashboard_url: null, genie_space_id: null, genie_space_url: null, app_name: null, app_url: null, alert_id: null, alert_url: null,
  });
  const ui = await openUi('wizard', { columns, me: { userName: OWNER, displayName: 'Owner' }, history: [failed] });
  const { page, made } = ui;
  const role = (name) => page.locator('label').filter({ has: page.locator('span', { hasText: new RegExp(`^${name}$`) }) }).locator('select');
  const reset = page.getByRole('button', { name: "Reset roles to Inspire's choice", exact: true });
  try {
    await toData(page);
    await advanced(page).click();
    await role('event date').locator('option[value="main.s.orders.order_date"]').waitFor({ state: 'attached' });
    assert.equal(await role('entity id').inputValue(), 'main.s.orders.order_date', 'the earlier version\'s roles come back');
    assert.equal(await reset.count(), 1, 'a set role shows the reset');
    await next(page);
    await page.locator('[role="alert"]').waitFor();
    const shown = await footerErrors(page);
    assert.ok(shown.some((e) => e.startsWith('entity id main.s.orders.order_date:')), shown.join(' | '));
    assert.ok(shown.includes("Reset roles to Inspire's choice, under Advanced settings, sets every role back at once"), shown.join(' | '));
    await reset.click();
    for (const name of ['entity id', 'event date', 'measure', 'label', 'segment']) {
      assert.equal(await role(name).inputValue(), '', `${name} is back to Inspire's choice`);
    }
    assert.equal(await reset.count(), 0, 'with every role on Inspire\'s choice there is nothing to reset');
    await toDelivery(page);
    await throughApp(page);
    await implementWhenReady(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.deepEqual(submittedSpec(made).data.column_roles, {}, 'the reset sends no role');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Next stops when the data to work with has no rows and says what to widen, and the count says what it leaves out', async () => {
  const columns = [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'order_date', data_type: 'DATE', ordinal_position: 2 }];
  const ui = await openUi('wizard&discovery=Deep', { columns, readinessRows: [{ row_count: '0' }], me: { userName: OWNER, displayName: 'Owner' } });
  const { page, made } = ui;
  const eventDate = () => page.getByLabel('event date');
  try {
    await toData(page);
    await advanced(page).click();
    await eventDate().locator('option[value="main.s.returns.order_date"]').waitFor({ state: 'attached' });
    await eventDate().selectOption('main.s.orders.order_date');
    await page.getByLabel('Window start').fill('2026-10-26');
    await page.getByLabel('Window end').fill('2026-10-28');
    await next(page);
    await page.locator('[role="alert"]').waitFor();
    assert.deepEqual(await footerErrors(page),
      ['No rows to work with: main.s.orders has no rows inside the date window you picked. Widen or clear it under Advanced settings.']);
    assert.equal(await page.locator('[aria-current="step"]').innerText(), '2. Data', 'the wizard stays on Data');
    assert.equal(await advanced(page).getAttribute('aria-expanded'), 'true');
    const counted = made.sqlCalls.filter((c) => String(c.sql).startsWith('SELECT COUNT(*) AS row_count'));
    assert.equal(counted.length, 1);
    assert.ok(counted[0].sql.includes('`order_date` >= CAST(:wstart AS DATE)'), counted[0].sql);

    made.state.readinessRows = [{ row_count: '1200' }];
    await eventDate().selectOption('main.s.returns.order_date');
    await toDelivery(page);
    await page.getByText('Inspire found 1,200 rows to work with in main.s.orders. This count leaves out the date window on main.s.returns; the preview run applies it.').waitFor();
    assert.equal(made.jobs.length, 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a row count the warehouse cannot finish never holds Next: the wizard goes on and says the preview run checks the data', async () => {
  const ui = await openUi('wizard', { sqlErrors: { 'SELECT COUNT(*) AS row_count': 'warehouse stopped' }, me: { userName: OWNER, displayName: 'Owner' } });
  const { page, made } = ui;
  try {
    await toData(page);
    await toDelivery(page);
    await page.locator('[data-check-note]').filter({ hasText: 'Inspire could not count the rows in main.s.orders. You can go on; the preview run checks the data.' }).waitFor();
    assert.ok(made.sqlCalls.some((c) => String(c.sql).startsWith('SELECT COUNT(*) AS row_count')), 'the count was tried');
    assert.equal(made.jobs.length, 0);
    assert.deepEqual(ui.pageErrors.filter((e) => !/status of 5\d\d/.test(e)), []);
  } finally {
    await ui.close();
  }
});

test('what blocks a step shows in the footer, opens Advanced on the field to fix, and clears as it is fixed', async () => {
  const ui = await openUi('wizard', { useCase: { ...HARNESS_USE_CASE, statement: '', sponsor: '' }, me: { userName: '', displayName: '' } });
  const { page, made } = ui;
  try {
    await toData(page);
    assert.deepEqual(await footerErrors(page), [], 'nothing is flagged before the person tries to move on');
    await next(page);
    await page.locator('[role="alert"]').waitFor();
    assert.deepEqual(await footerErrors(page), ['write the goal sentence', 'name the decision owner']);
    assert.equal(await advanced(page).getAttribute('aria-expanded'), 'true');
    await page.getByLabel('Goal sentence').fill('Cut churn in the top segment');
    await page.waitForFunction(() => [...document.querySelectorAll('[role="alert"] p')].length === 1);
    assert.deepEqual(await footerErrors(page), ['name the decision owner']);
    await page.getByLabel('Decision owner').fill('Head of Retention');
    await toDelivery(page);
    await page.getByRole('checkbox', { name: /^Alert/ }).check();
    await page.getByText('Nobody gets it yet: add an email under Advanced settings.').waitFor();
    assert.equal(await advanced(page).getAttribute('aria-expanded'), 'false');
    await next(page);
    await page.locator('[role="alert"]').waitFor();
    assert.deepEqual(await footerErrors(page), ['an alert needs at least one recipient email or notification destination']);
    assert.equal(await advanced(page).getAttribute('aria-expanded'), 'true');
    assert.equal(made.jobs.length, 0);
    await page.getByLabel('Email recipients (comma separated)').fill(OWNER);
    await page.locator('[role="alert"]').waitFor({ state: 'detached' });
    await implementWhenReady(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.deepEqual(submittedSpec(made).outputs.alert_recipients, [OWNER]);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('an App name another App already uses is changed to the next free name, and a name the person types back is fixed on the last step', async () => {
  const ui = await openUi('wizard', {
    me: { userName: OWNER, displayName: 'Owner' },
    appsByName: { 'inspire-hub-acme': { name: 'inspire-hub-acme', description: 'Sales forecasting tool' } },
  });
  const { page, made } = ui;
  try {
    await toData(page);
    await toDelivery(page);
    await page.getByRole('checkbox', { name: /^App / }).check();
    await next(page);
    await onStep(page, 'App placement');
    await page.getByText("'inspire-hub-acme' is used by another App in this workspace, so Inspire named this App 'inspire-hub-acme-2'.").waitFor();
    assert.equal(await page.getByLabel('App name').inputValue(), 'inspire-hub-acme-2');
    await page.getByLabel('App name').fill('inspire-hub-acme');
    await page.getByText("'inspire-hub-acme' is used by another App in this workspace; pick another name.", { exact: false }).waitFor();
    assert.equal(await page.getByLabel('App name').inputValue(), 'inspire-hub-acme', 'a name the person typed is never changed for them');
    await page.getByRole('button', { name: 'Back' }).click();
    await onStep(page, 'Delivery');
    await throughApp(page);
    await toVibes(page);
    await page.locator('[role="alert"] p', { hasText: "App name: 'inspire-hub-acme' is used by another App in this workspace; pick another name" }).waitFor();
    assert.equal(await page.getByRole('button', { name: 'Start MVP', exact: true }).isDisabled(), true);
    const here = page.locator('[data-last-app-name]');
    await here.getByRole('button', { name: 'Use inspire-hub-acme-2' }).click();
    await here.getByText("'inspire-hub-acme-2' is free").waitFor();
    await onStep(page, 'Vibes');
    await implementWhenReady(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.equal(submittedSpec(made).outputs.app_name, 'inspire-hub-acme-2');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Change swaps a table for a similar one or drops it, and never offers to drop the primary table', async () => {
  const ui = await openUi('wizard', {
    me: { userName: OWNER, displayName: 'Owner' },
    swapRows: [{ table_schema: 's2', table_name: 'orders_v2', matched: '5', total: '6' }],
  });
  const { page, made } = ui;
  try {
    await toData(page);
    const row = (table) => page.locator(`[data-table="${table}"]`);
    await row('main.s.orders').getByRole('button', { name: 'Change' }).click();
    const ordersPick = page.getByLabel('Table to use for main.s.orders');
    await page.waitForFunction(() => [...document.querySelectorAll('option')].some((o) => o.textContent === 'main.s2.orders_v2 (5 of 6 columns match)'));
    const drop = ordersPick.locator('option', { hasText: "Don't use this table" });
    assert.equal(await drop.textContent(), "Don't use this table (the primary table can be swapped, not removed)");
    assert.equal(await drop.isDisabled(), true);
    await ordersPick.selectOption('main.s2.orders_v2');
    await row('main.s.orders').getByText('main.s2.orders_v2', { exact: true }).waitFor();
    await row('main.s.orders').getByText('instead of main.s.orders').waitFor();
    await row('main.s.returns').getByRole('button', { name: 'Change' }).click();
    await page.getByLabel('Table to use for main.s.returns').selectOption('__remove__');
    await page.getByText('Removed main.s.returns.', { exact: false }).waitFor();
    await row('main.s.returns').getByRole('button', { name: 'Use it again' }).waitFor();
    await toDelivery(page);
    await implementWhenReady(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    const spec = submittedSpec(made);
    assert.deepEqual(spec.data.tables, { 'main.s.orders': 'main.s2.orders_v2' });
    assert.deepEqual(spec.data.removed_tables, ['main.s.returns']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const NOTEBOOK_PATH = '/Users/owner@example.com/inspire/Acme/N01-U01';

test('the Build page shows one row of tiles in a fixed order, each tile opens its asset in a new tab, Versions opens its facts, and the job holds the runs and the history', async () => {
  const ui = await openUi('implement', { ...STUDIO_STATE, job: MVP_JOB, useCase: { ...HARNESS_USE_CASE, has_genie_code: 'Y', notebook_path: NOTEBOOK_PATH } });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    const listed = page.getByRole('navigation', { name: 'Use cases' });
    await listed.getByRole('region', { name: 'Ready' }).getByText('MVP ready', { exact: true }).waitFor();
    assert.equal(await listed.locator('[aria-current="true"]').innerText().then((t) => t.includes(HARNESS_USE_CASE.Name)), true);
    const tiles = page.getByRole('list', { name: 'Assets', exact: true }).locator('[data-asset-tile]');
    await tile(page, 'app').locator('[data-tile-open="asset"]').waitFor({ timeout: 15000 });
    assert.deepEqual(await tiles.evaluateAll((els) => els.map((t) => t.dataset.assetTile)), TILE_IDS);
    const labels = await tiles.evaluateAll((els) => els.map((t) => t.querySelector('[data-tile-state]').previousElementSibling.textContent));
    assert.deepEqual(labels, ['App', 'Dashboard', 'Genie Agent', 'Alerts', 'Notebook', 'Job']);
    const states = await tiles.evaluateAll((els) => els.map((t) => t.querySelector('[data-tile-state]')).map((s) => [s.title, s.textContent.trim()]));
    for (const [title, said] of states) assert.ok(said && title === said, `a state cut short on a narrow tile reads in full on hover: ${title} | ${said}`);
    for (const width of [1440, 1280, 1024]) {
      await page.setViewportSize({ width, height: 1000 });
      const cut = await tiles.evaluateAll((els) => els.flatMap((t) => [...t.querySelectorAll('[data-tile-state] span, button span, a span')]
        .filter((e) => e.scrollWidth > e.clientWidth + 1 || e.getBoundingClientRect().right > t.getBoundingClientRect().right + 1)
        .map((e) => `${t.dataset.assetTile}: ${e.textContent.trim()}`)));
      assert.deepEqual(cut, [], `no state or action label of a tile is cut short at ${width} px`);
    }
    await page.setViewportSize({ width: 1440, height: 1000 });
    const rows = await tiles.evaluateAll((els) => els.map((t) => [t.dataset.assetTile, t.dataset.tileKind]));
    assert.deepEqual(rows.map(([, kind]) => kind), TILE_IDS.map(() => 'live'), JSON.stringify(rows));
    assert.equal(await page.getByRole('tablist', { name: 'MVP views' }).count(), 0, 'no tabs: the tiles replace them');
    assert.equal(await page.getByRole('region', { name: 'Control tower' }).count(), 0, 'the Control Tower view is gone');
    assert.equal(await page.locator('[data-mvp-panel]').count(), 0, 'no asset drawer is open until Versions is clicked');
    assert.equal(await page.getByRole('region', { name: 'Build failed' }).count(), 0, 'a ready build has no failed banner');
    await page.locator('[data-mvp-progress]').waitFor();
    await shot(page, 'build-page-ready');

    const open = (id) => tile(page, id).locator('[data-tile-open="asset"]');
    assert.deepEqual(await Promise.all(TILE_IDS.map((id) => open(id).evaluate((a) => [a.getAttribute('href'), a.target]))), [
      ['https://churn-desk-1.aws.databricksapps.com', '_blank'],
      ['https://workspace.example.com/dashboardsv3/d1/published', '_blank'],
      ['https://workspace.example.com/genie/rooms/g1', '_blank'],
      ['https://workspace.example.com/sql/alerts-v2/a1', '_blank'],
      [`https://workspace.example.com/#workspace/Workspace${NOTEBOOK_PATH}`, '_blank'],
      ['https://workspace.example.com/#job/77', '_blank'],
    ], 'each tile opens its asset in a new tab');
    await page.context().route('https://workspace.example.com/**', (route) => route.fulfill({ status: 200, contentType: 'text/html', body: '<p>asset</p>' }));
    const [popup] = await Promise.all([page.waitForEvent('popup'), open('dashboard').click()]);
    const opened = await popup.evaluate(() => window.opener === null).catch(() => true);
    assert.equal(opened, true, 'the asset opens without a handle back to Inspire');
    assert.equal(await page.evaluate(() => window.location.pathname).then((p) => p.endsWith('implement.html')), true, 'the Build page stays where it was');
    await popup.close();

    await openAsset(page, 'app');
    const appFacts = page.locator('[data-asset-facts="app"]');
    await appFacts.getByText('RUNNING: App is running', { exact: true }).waitFor({ timeout: 15000 });
    const appRows = await appFacts.locator('dl > div').evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('dt, dd')].map((cell) => cell.textContent)));
    assert.deepEqual(appRows.slice(0, 3), [
      ['App', 'RUNNING: App is running'],
      ['Compute', 'ACTIVE'],
      ['Last deployment', 'SUCCEEDED: App started successfully (2026-10-25T04:10:00Z)'],
    ]);
    assert.ok(appRows.some(([label]) => label === 'Health check'));
    assert.deepEqual(appRows.find(([label]) => label === 'Built on'), ['Built on', 'v1']);
    assert.equal(await assetPanel(page, 'app').getByRole('link', { name: 'Open', exact: true }).getAttribute('href'), 'https://churn-desk-1.aws.databricksapps.com');
    assert.equal(await page.locator('[data-mvp-panel]').count(), 1, 'one drawer at a time');

    await openAsset(page, 'notebook');
    const notebookPanel = assetPanel(page, 'notebook');
    await notebookPanel.getByText('Genie Code notebook', { exact: true }).waitFor();
    await notebookPanel.getByText('Notebook ready', { exact: true }).waitFor();
    await notebookPanel.getByText(NOTEBOOK_PATH, { exact: true }).waitFor();
    assert.equal(await notebookPanel.getByRole('link', { name: 'Open the notebook', exact: true }).getAttribute('href'),
      `https://workspace.example.com/#workspace/Workspace${NOTEBOOK_PATH}`);

    await openAsset(page, 'genie_space');
    const agentFacts = page.locator('[data-asset-facts="genie_space"]');
    await agentFacts.getByText('Sample questions in the Genie Agent').waitFor();
    assert.deepEqual(await agentFacts.locator('ul.list-disc li > span').allTextContents(), ['Which customers should we call first?', 'How many customers are in Act now?']);
    assert.deepEqual(await agentFacts.locator('ul.list-disc li').evaluateAll((items) => items.map((li) => li.querySelector('p')?.textContent || '')),
      ['', 'The rows are accounts, so it counts accounts in Act now.']);
    await agentFacts.getByText('Inspire checked the Genie Agent with: Which customers should we call first?').waitFor();
    await agentFacts.getByText(`SELECT entity_id FROM ${RESULT_TABLE} ORDER BY rank LIMIT 10`).waitFor();
    await shot(page, 'agent-drawer', false);

    await openAsset(page, 'alert');
    const alertFacts = page.locator('[data-asset-facts="alert"]');
    await alertFacts.getByText('Fires when: Act now rows in the latest run are at least 1').waitFor();
    await alertFacts.getByText(`Notifies: ${OWNER}`).waitFor();
    await alertFacts.getByText('Subscribers on the job task: 1').waitFor();
    await alertFacts.getByText('Last check: OK').waitFor();
    await alertFacts.getByText('Preview re-runs never send it.', { exact: false }).waitFor();

    await openAsset(page, 'job');
    await runPane(page).getByRole('button', { name: 'Preview re-run' }).waitFor();
    assert.equal(await runPane(page).getByRole('button', { name: /^Edit/ }).count(), 0, 'the vibe button lives in the header, not under Run and schedule');
    const toggle = historyToggle(page);
    assert.equal(await toggle.getAttribute('aria-expanded'), 'false', 'History starts collapsed');
    assert.match(await toggle.innerText(), /1 spec version · 2 job runs/);
    assert.equal(await historyPane(page).getByText('v1 · ready · initial').isVisible(), false);
    await toggle.click();
    assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
    assert.equal(await page.locator(`[id="${await toggle.getAttribute('aria-controls')}"]`).isVisible(), true);
    await page.getByText('v1 · ready · initial').waitFor();
    await page.getByText('SUCCESS · preview · started by hand').waitFor();
    await page.getByText('FAILED · full (job default) · scheduled').waitFor();
    await page.getByText('Workload failed').waitFor();
    assert.equal(await page.getByRole('link', { name: 'Open run' }).first().getAttribute('href'), 'https://workspace.example.com/#job/77/run/9001');
    await toggle.click();
    assert.equal(await historyPane(page).getByText('v1 · ready · initial').isVisible(), false, 'History folds again');
    await closeAsset(page);
    assert.equal(await page.locator('[data-vibe-features]').count(), 1, 'one vibe button on the page');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a quick re-run is a preview that sends only the widgets the person changed and never the result table', async () => {
  const ui = await openUi('implement', STUDIO_STATE);
  const { page, made } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await showView(page, 'job');
    const quick = runPane(page);
    const rerun = quick.getByRole('button', { name: 'Preview re-run' });
    await rerun.waitFor();
    await quick.getByPlaceholder('25').waitFor();
    const ownText = (labels) => labels.map((l) => [...l.childNodes].filter((n) => n.nodeType === 3).map((n) => n.textContent.trim()).join(' ').trim());
    assert.deepEqual(await quick.locator('label').evaluateAll(ownText), ['Top K', 'Schedule on']);
    assert.equal(await quick.locator('label', { hasText: 'Top K' }).locator('span').textContent(), 'whole number, at least 1');
    await quick.getByPlaceholder('25').fill(' 10 ');
    await rerun.click();
    await until(() => made.fetches.some((f) => f.path === '/api/2.1/jobs/run-now'), 'the run-now call');
    const body = JSON.parse(made.fetches.find((f) => f.path === '/api/2.1/jobs/run-now').opts.body);
    assert.equal(body.job_id, 77);
    assert.deepEqual(body.notebook_params, { top_k: '10', run_profile: 'preview' });
    assert.equal(made.jobs.length, 0);
    assert.equal(made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO')).length, 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a quick re-run of a job Inspire may not move to the App environment version still runs, and the page says why it may fail offline', async () => {
  const ui = await openUi('implement', {
    ...STUDIO_STATE,
    job: { job_id: 77, settings: { environments: [{ environment_key: 'Default', spec: { client: '1' } }] } },
    responses: { 'POST /api/2.1/jobs/update': [{ error_code: 'PERMISSION_DENIED', message: 'User does not have Manage permission on job 77' }, 403] },
  });
  const { page, made } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await showView(page, 'job');
    const rerun = runPane(page).getByRole('button', { name: 'Preview re-run' });
    await rerun.waitFor();
    assert.equal(await page.getByRole('status').filter({ hasText: 'could not move job' }).count(), 0);
    await rerun.click();
    const said = page.getByRole('status').filter({ hasText: 'could not move job 77' });
    await said.waitFor();
    assert.match(await said.innerText(), /from serverless environment 1 to environment 4 \(User does not have Manage permission on job 77\), so this run uses environment 1\. In a workspace with no internet/);
    assert.ok(made.fetches.some((f) => f.path === '/api/2.1/jobs/run-now'), 'the run still starts');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a version that ended with a warning says why under its status, and a ready one stays quiet', async () => {
  const why = 'Decision list: no row of the latest run reached Act now or Review (1000 Monitor), so it has nobody to act on yet; '
    + "the run's output says why, such as a model that missed its acceptance check: https://workspace.example.com/jobs/77/runs/9001";
  const warned = await openUi('implement', { ...STUDIO_STATE, history: [built({ status: 'ready_with_warnings', status_message: why })] });
  try {
    await warned.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await warned.page.locator('[data-asset-tile="app"][data-tile-kind="live"]').waitFor({ timeout: 15000 });
    await expandBuild(warned.page);
    assert.equal(await warned.page.getByRole('region', { name: 'Build failed' }).count(), 0, 'warnings are not a failed build');
    const chip = warned.page.locator('[data-mvp-progress] p', { hasText: /^Warnings$/ }).first();
    await chip.waitFor();
    assert.equal(await warned.page.locator('[data-mvp-progress] [data-build-reason]').innerText(), why);
    assert.deepEqual(warned.pageErrors, []);
  } finally {
    await warned.close();
  }
  const ready = await openUi('implement', { ...STUDIO_STATE, history: [built({ status_message: 'ready: preview wrote 3 row(s)' })] });
  try {
    await ready.page.locator('[data-asset-tile="app"][data-tile-kind="live"]').waitFor({ timeout: 15000 });
    await expandBuild(ready.page);
    await ready.page.locator('[data-mvp-progress] p', { hasText: /^Ready$/ }).first().waitFor();
    assert.equal(await ready.page.getByText('ready: preview wrote 3 row(s)').count(), 0);
    await showView(ready.page, 'app');
    assert.equal(await ready.page.getByText('ready: preview wrote 3 row(s)').count(), 0, 'nor in an asset drawer');
  } finally {
    await ready.close();
  }
});

test('a version whose run stopped reads as Stopped with the reason and the run, and Rebuild and the schedule work again', async () => {
  const stopped = built({ spec_version: 2, status: 'filling', status_message: 'filling: v2', implement_run_id: '5555555555555555',
    updated_at: new Date().toISOString() });
  const run = { run_id: 5555555555555555, run_page_url: 'https://workspace.example.com/#job/77/run/5555555555555555',
    state: { life_cycle_state: 'TERMINATED', result_state: 'CANCELED', state_message: 'Run cancelled' } };
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [stopped, built()], implementRun: run });
  const { page } = ui;
  const why = 'the run building v2 ended (CANCELED: Run cancelled) while v2 was still filling. Rebuild in Vibe/Add/Remove Features submits a new version.';
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    const failed = page.getByRole('region', { name: 'Build failed' });
    await failed.getByText(why, { exact: true }).waitFor();
    assert.equal(await failed.locator('p').first().innerText(), 'The build stopped');
    assert.deepEqual((await failed.getByRole('button').allInnerTexts()).map((t) => t.trim()), ['Try again', 'Open all settings']);
    assert.equal(await viewOf(page, 'build').getByRole('region', { name: 'Build failed' }).count(), 1, 'the banner sits in the Build progress box');
    const chip = page.locator('[data-mvp-progress] p', { hasText: /^Stopped$/ }).first();
    await chip.waitFor();
    assert.equal(await page.locator('[data-mvp-progress] [data-build-reason]').innerText(), why);
    await page.getByRole('navigation', { name: 'Use cases' }).getByRole('region', { name: 'Needs attention' }).getByText('MVP stopped', { exact: true }).waitFor();
    const features = await openFeatures(page);
    assert.equal(await features.locator('[data-rebuild]').isEnabled(), true, 'a stopped build can be sent again');
    assert.equal(await features.locator('[data-rebuild-waits]').count(), 0);
    await closeAsset(page);
    await showView(page, 'job');
    assert.equal(await page.getByLabel(/^Job: /).getByRole('link', { name: 'Open the run that stopped' }).getAttribute('href'), run.run_page_url);
    assert.equal(await page.getByRole('region', { name: 'Build failed' }).getByRole('link', { name: 'Open the run that stopped' }).getAttribute('href'), run.run_page_url,
      'the Stopped panel links the run that stopped');
    assert.equal(await page.getByRole('checkbox', { name: 'Schedule on' }).isEnabled(), true);
    await openHistory(page);
    await page.getByText('v2 · stopped before it finished · initial').waitFor();
    await page.getByText('v1 · ready · initial').waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const busy = await openUi('implement', { ...STUDIO_STATE, history: [stopped, built()],
    implementRun: { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } } });
  try {
    await busy.page.locator('[data-mvp-progress] [data-stop-build]').waitFor();
    await busy.page.getByRole('navigation', { name: 'Use cases' }).getByRole('region', { name: 'Building' }).getByText('MVP running', { exact: true }).waitFor();
    const features = await openFeatures(busy.page);
    const rebuild = features.locator('[data-rebuild]');
    assert.equal(await rebuild.isDisabled(), true, 'Rebuild waits for the build');
    assert.equal(await rebuild.getAttribute('title'), 'A build is running. Vibes you add wait for the next build.');
    await closeAsset(busy.page);
    await showView(busy.page, 'job');
    assert.equal(await busy.page.getByRole('checkbox', { name: 'Schedule on' }).isEnabled(), false);
    assert.equal(await busy.page.getByText('Open the run that stopped').count(), 0);
    assert.equal(await busy.page.getByRole('region', { name: 'Build failed' }).count(), 0, 'a running build has no failed banner');
    assert.deepEqual(busy.pageErrors, []);
  } finally {
    await busy.close();
  }
});

const stepRow = (phase, status, time) => ({
  stage_name: 'Implement Use Cases', step_id: phase.length, step_name: `Inspire is working on ${phase.toLowerCase()}`, sub_step_name: 'Completed: n01-u01',
  status, last_updated: `2026-10-26T${time}.000Z`, result_json: JSON.stringify({ use_case_id: 'N01-U01', phase }),
});

const genieLogLine = (second, words) => `2026-10-26 10:${String(Math.floor(second / 60)).padStart(2, '0')}:${String(second % 60).padStart(2, '0')}`
  + ` - inspire - INFO - [GENIE N01-U01] [build] Genie: ${words}`;
const logText = (lines) => `${lines.join('\n')}\n`;

test('while Genie builds, a log read mid-copy never empties the message box or shows cut-off words', async () => {
  const said = (i) => `Check ${i}: I profiled the pickup zones and the hourly demand before the forecast.`;
  const first = Array.from({ length: 6 }, (_, i) => genieLogLine(i, said(i)));
  const building = built({ status: 'building_outputs', status_message: 'building outputs', implement_run_id: '5555555555555555', updated_at: new Date().toISOString() });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [building], liveLog: logText(first),
    implementRun: { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } } });
  const { page, made } = ui;
  const box = page.getByRole('log', { name: "Genie's messages" });
  const polled = () => page.waitForResponse((r) => r.url().includes('/api/inspire/implement/status'), { timeout: 20000 });
  const twoPolls = async () => { await polled(); await polled(); await painted(page); };
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await box.getByText(said(5)).waitFor();
    made.state.liveLog = '';
    await twoPolls();
    for (let i = 0; i < 6; i += 1) assert.ok((await box.innerText()).includes(said(i)), `an empty read keeps message ${i}`);
    const next = genieLogLine(20, 'Next I am writing the forecast table and its confidence band.');
    made.state.liveLog = `${logText(first)}${next.slice(0, next.length - 25)}`;
    await twoPolls();
    const text = await box.innerText();
    assert.ok(text.includes(said(5)), 'a cut-off read keeps what was there');
    assert.ok(!text.includes('Next I am writing'), 'the line the agent is still writing waits for the next poll');
    made.state.liveLog = logText([...first, next]);
    await box.getByText('Next I am writing the forecast table and its confidence band.').waitFor({ timeout: 20000 });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('while Genie builds, a log the agent swaps for a copy with only its newest lines keeps every message shown and adds the new one at the end', async () => {
  const said = (i) => `Pass ${i}: I joined the trips to the zones and checked the weekly totals.`;
  const first = Array.from({ length: 6 }, (_, i) => genieLogLine(i, said(i)));
  const building = built({ status: 'building_outputs', status_message: 'building outputs', implement_run_id: '5555555555555555', updated_at: new Date().toISOString() });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [building], liveLog: logText(first),
    implementRun: { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } } });
  const { page, made } = ui;
  const box = page.getByRole('log', { name: "Genie's messages" });
  const newest = 'Now I am publishing the dashboard with the weekly totals.';
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await box.getByText(said(5)).waitFor();
    made.state.liveLog = logText([first[4], first[5], genieLogLine(30, newest)]);
    await box.getByText(newest).waitFor({ timeout: 20000 });
    const text = await box.innerText();
    const at = Array.from({ length: 6 }, (_, i) => text.indexOf(said(i)));
    assert.ok(at.every((p) => p >= 0), 'every message shown before the swap stays');
    assert.ok(at.every((p, i) => !i || p > at[i - 1]) && text.indexOf(newest) > at[5], 'in their order, with the new one after them');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Build progress box scrolls Genie\'s messages itself: the page never grows with them, it follows new ones only while the end is in view, offers Jump to latest otherwise, and never shows log lines or JSON', async () => {
  const said = (i) => `Step ${i}: I'm checking the notebook instructions and the Databricks workflow before I build the dashboard.`;
  const first = Array.from({ length: 24 }, (_, i) => genieLogLine(i, said(i)));
  first.push(genieLogLine(30, JSON.stringify({ status: 'built', summary: 'Built the dashboard and checked every tile.', files: ['x.py'] })));
  first.push(genieLogLine(31, 'I ran it once with `run_profile=preview` and the **preview run** passed.'));
  const building = built({ status: 'building_outputs', status_message: 'building outputs', implement_run_id: '5555555555555555', updated_at: new Date().toISOString() });
  const steps = [stepRow('Plan', 'ended_success', '10:01:00'), stepRow('Instruction', 'started', '10:01:05'),
    stepRow('Instruction', 'ended_success', '10:03:50'), stepRow('Genie build', 'started', '10:04:05')];
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [building], liveLog: logText(first), steps,
    implementRun: { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } } });
  const { page, made } = ui;
  const box = page.getByRole('log', { name: "Genie's messages" });
  const log = page.locator('[data-build-log]');
  const jump = page.getByRole('button', { name: 'Jump to latest' });
  const pageHeight = () => page.evaluate(() => document.scrollingElement.scrollHeight);
  const scroll = () => log.evaluate((el) => ({ top: Math.round(el.scrollTop), max: Math.round(el.scrollHeight - el.clientHeight) }));
  const atEnd = () => page.waitForFunction(() => {
    const el = document.querySelector('[data-build-log]');
    return el.scrollHeight - el.clientHeight - el.scrollTop <= 2;
  }, null, { timeout: 10000 });
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await box.getByText('Built the dashboard and checked every tile.').waitFor();
    await page.locator('[data-stage="Job"][data-stage-state="done"]').waitFor();
    await page.locator('[data-stage="Notebook"][data-stage-state="running"]').waitFor();
    assert.equal(await page.locator('[data-stage="Plan"]').count(), 0, 'Plan reads as part of the Job');
    assert.equal(await page.locator('[data-asset-panel]').count(), 0, 'the asset drawers stay shut while Genie builds');
    await page.getByRole('region', { name: "Genie's build messages" }).waitFor();
    const text = await box.innerText();
    assert.ok(text.includes(said(23)), 'messages already in the log show at once');
    for (const raw of ['[GENIE', '[build]', 'Genie: ', '{"status"', '"summary"', 'x.py', '`', '**']) assert.ok(!text.includes(raw), `the box never shows ${raw}`);
    assert.equal(await box.locator('code', { hasText: 'run_profile=preview' }).count(), 1, "Genie's inline code reads as code");
    assert.equal(await box.locator('strong', { hasText: 'preview run' }).count(), 1, "Genie's bold reads as bold");
    assert.ok(await box.locator('svg').count() >= 25, 'every Genie message carries the Genie logo');
    assert.equal(await page.getByRole('progressbar', { name: 'Build progress' }).isVisible(), true);
    assert.equal(await page.locator('[data-genie-working]').isVisible(), true, 'a working row shows while Genie builds');
    const own = await log.evaluate((el) => ({ overflow: getComputedStyle(el).overflowY, scroll: el.scrollHeight, client: el.clientHeight,
      feed: getComputedStyle(el.querySelector('[role="log"]')).overflowY }));
    assert.deepEqual([own.overflow, own.feed], ['auto', 'visible'], 'one scroll box: the Build progress box, never the feed inside it');
    assert.ok(own.scroll > own.client, `the messages scroll inside the box (${own.scroll} in ${own.client})`);
    await atEnd();
    assert.equal(await jump.count(), 0, 'nothing to jump to while the box follows');

    const before = await pageHeight();
    const later = Array.from({ length: 12 }, (_, i) => genieLogLine(40 + i, `Now wiring tile ${i} of the Drivers page with its own query and a short caption.`));
    made.state.liveLog = logText([...first, ...later]);
    await box.getByText('Now wiring tile 11 of the Drivers page with its own query and a short caption.').waitFor({ timeout: 30000 });
    await atEnd();
    assert.equal(await pageHeight(), before, 'new messages never make the page longer');
    assert.equal(await jump.count(), 0);
    await shot(page, 'build-running');

    await log.evaluate((el) => { el.scrollTop = 0; });
    await page.waitForFunction(() => document.querySelector('[data-build-log]').scrollTop === 0);
    await painted(page);
    const last = genieLogLine(60, 'Last I am checking the alert query against the latest run.');
    made.state.liveLog = logText([...first, ...later, last]);
    await box.getByText('Last I am checking the alert query against the latest run.').waitFor({ timeout: 30000 });
    await jump.waitFor();
    assert.equal((await scroll()).top, 0, 'a person reading higher up is never pulled down');
    assert.equal(await jump.evaluate((el) => getComputedStyle(el.parentElement).position), 'sticky', 'Jump to latest stays in view of the box');
    const withJump = await lowContrast(page, ['[data-genie-feed]']);
    assert.deepEqual(withJump.low, [], 'Jump to latest reads at 4.5:1 or better');
    await jump.click();
    await atEnd();
    await jump.waitFor({ state: 'detached' });
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const progress = await lowContrast(page, ['[data-mvp-progress]', '[data-genie-feed]']);
      assert.ok(progress.checked >= 20, `measured ${progress.checked} progress elements`);
      assert.deepEqual(progress.low, [], dark ? 'dark Build progress' : 'light Build progress');
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const FAILED_REASON = 'Genie stopped the build: No approved model yet: candidate precision 0.455 was below baseline precision 0.527.';
const RUN_STOPPED_AFTER_ROUNDS = 'Genie stopped the build: the sample query failed. Inspire sent it back to Genie 2 times with the error, and it still stopped';
const RUN_FAILED_REASON = 'The build run failed: the notebook raised NameError: history_pdf.';
const NOTHING_BUILT = { result_rows: null, asset_status: null, dashboard_id: null, dashboard_url: null, genie_space_id: null, genie_space_url: null,
  app_name: null, app_url: null, alert_id: null, alert_url: null };

test('a failed build shows a red banner in the Build progress box with the failed step and the reason, above Genie\'s messages, and Open all settings opens the wizard', async () => {
  const failed = built({ status: 'failed', status_message: FAILED_REASON, ...NOTHING_BUILT });
  const steps = [stepRow('Plan', 'ended_success', '10:01:00'), stepRow('Instruction', 'ended_success', '10:03:50'), stepRow('Genie Code', 'ended_success', '10:04:00'),
    stepRow('Genie build', 'started', '10:04:05'), stepRow('Genie build', 'ended_error', '10:20:00')];
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [failed], steps, me: { userName: OWNER, displayName: 'Owner' } });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    const banner = page.getByRole('region', { name: 'Build failed' });
    await banner.getByText('Step: Genie builds the notebook', { exact: true }).waitFor();
    assert.equal(await viewOf(page, 'build').getByRole('region', { name: 'Build failed' }).count(), 1, 'the banner is part of the Build progress box');
    assert.deepEqual(await banner.locator('p').allInnerTexts(),
      ['The build failed', 'Step: Genie builds the notebook', FAILED_REASON, DATA_STOP_HINT]);
    assert.deepEqual((await banner.getByRole('button').allInnerTexts()).map((t) => t.trim()), [VIBE_FEATURES_LABEL, 'Open all settings'],
      'a Genie data stop offers changing the ask, never Try again on the same data');
    const top = async (locator) => (await locator.boundingBox()).y;
    assert.ok(await top(banner) < await top(page.getByRole('log', { name: "Genie's messages" })), 'the banner sits above Genie\'s messages');
    assert.match(await banner.evaluate((el) => el.className), /bg-error-bg/);
    await shot(page, 'build-failed');

    const failedStep = page.locator('[data-mvp-progress] [data-stage="Notebook"][data-stage-state="error"]');
    await failedStep.waitFor();
    assert.match(await failedStep.locator('[title]').getAttribute('title'), /Genie build/, 'the failed step names the stages it holds');
    assert.deepEqual(await page.locator('[data-mvp-progress] [data-stage]').evaluateAll((els) => els.map((e) => [e.dataset.stage, e.dataset.stageState])).then((rows) => rows.slice(0, 2)),
      [['Job', 'done'], ['Notebook', 'error']], 'done is green before the red failed step');
    await page.locator('[data-mvp-progress] p', { hasText: /^Failed$/ }).first().waitFor();
    assert.equal(await page.locator('[data-mvp-progress] [data-build-reason]').innerText(), FAILED_REASON);

    await showView(page, 'app');
    assert.equal(await viewOf(page, 'app').getByRole('region', { name: 'Build failed' }).count(), 0, 'the banner belongs to the Build progress box, not a drawer');
    await showView(page, 'build');
    await banner.getByRole('button', { name: 'Open all settings' }).click();
    await onStep(page, 'Vibes');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a build Genie stopped after two repair rounds lists what Genie changed in both rounds next to the stop reason, and a stop with no change shows no heading', async () => {
  const failed = built({ status: 'failed', status_message: RUN_STOPPED_AFTER_ROUNDS, ...NOTHING_BUILT });
  const changes = ['Genie changed the outcome column: the label is is_churned.', 'Genie changed the date filter: the history starts in 2024.'];
  const changed = { ...stepRow('Genie changes', 'ended_warning', '10:19:00'),
    result_json: JSON.stringify({ use_case_id: 'N01-U01', phase: 'Genie changes', genie_changes: changes }) };
  const steps = [stepRow('Plan', 'ended_success', '10:01:00'), stepRow('Genie build', 'started', '10:04:05'), changed, stepRow('Genie build', 'ended_error', '10:20:00')];
  for (const [withChanges, want] of [[true, changes], [false, []]]) {
    const ui = await openUi('implement', { ...STUDIO_STATE, history: [failed], steps: withChanges ? steps : steps.filter((r) => r !== changed) });
    try {
      await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
      await expandBuild(ui.page);
      const banner = ui.page.getByRole('region', { name: 'Build failed' });
      await banner.getByText(RUN_STOPPED_AFTER_ROUNDS, { exact: true }).waitFor();
      const list = banner.getByRole('list', { name: 'What Genie changed before it stopped' });
      assert.deepEqual(await list.getByRole('listitem').allInnerTexts(), want);
      assert.equal(await banner.getByText('What Genie changed before it stopped', { exact: true }).count(), withChanges ? 1 : 0, 'the heading shows only with changes');
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});

test('a build that failed the same way twice lists what Inspire tried, drops Try again, and offers choices that change the build', async () => {
  const rounds = [
    { attempt: 1, error: 'run_use_case() returned None', repair: 'rebuild_with_error', why: 'the notebook failed when it ran' },
    { attempt: 2, error: 'run_use_case() returned None', repair: 'stop', why: 'the same failure came back' },
  ];
  const ended = (terminal) => ({ ...stepRow('Implement', 'ended_error', '10:20:00'),
    result_json: JSON.stringify({ use_case_id: 'N01-U01', phase: 'Implement', spec_version: 2, attempts: 2, repair_rounds: rounds, terminal }) });
  const failed = built({ spec_version: 2, status: 'failed', status_message: RUN_FAILED_REASON });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [failed, built()], steps: [stepRow('Plan', 'ended_success', '10:01:00'), ended(true)] });
  const { page, made } = ui;
  try {
    const banner = page.getByRole('region', { name: 'Build failed' });
    const tried = banner.getByLabel('What Inspire tried');
    await tried.waitFor();
    const lines = await tried.getByRole('listitem').allInnerTexts();
    assert.equal(lines.length, 2);
    assert.match(lines[0], /^Attempt 1 failed: run_use_case\(\) returned None\. Inspire had Genie rebuild the notebook with this error/);
    assert.match(lines[1], /^Attempt 2 failed: .*Inspire stopped/);
    assert.equal(await banner.getByRole('button', { name: 'Try again' }).count(), 0, 'an unchanged resend would fail the same way');
    const choices = banner.locator('[data-failure-choice]');
    assert.deepEqual(await choices.evaluateAll((els) => els.map((e) => e.dataset.failureChoice)), ['smaller', 'technique', 'notebook', 'ask']);
    assert.doesNotMatch(await banner.innerText(), /contact|ticket|support/i);
    for (const dark of [false, true]) {
      await setDark(page, dark);
      assert.deepEqual((await lowContrast(page, ['section[aria-label="Build failed"]'])).low, [], dark ? 'dark banner' : 'light banner');
    }
    await banner.getByRole('button', { name: 'Build a smaller first run' }).click();
    await until(() => made.jobs.length === 1, 'the smaller run');
    const insert = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO'))[0];
    const sent = JSON.parse(insert.parameters.find((p) => p.name === 'spec').value);
    assert.equal(sent.config.profiles.preview.entity_cap, 200, 'the next version reads fewer entities');
    assert.equal(sent.based_on_version, 2);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const once = await openUi('implement', { ...STUDIO_STATE, history: [failed, built()], steps: [ended(false)] });
  try {
    const banner = once.page.getByRole('region', { name: 'Build failed' });
    await banner.getByLabel('What Inspire tried').waitFor();
    assert.equal(await banner.getByRole('button', { name: 'Try again' }).count(), 1, 'a failure that may pass on a resend keeps Try again');
    await banner.getByRole('button', { name: 'Switch technique' }).click();
    await once.page.locator('textarea').filter({ hasText: /simpler analytical technique/ }).first().waitFor();
    assert.equal(once.made.jobs.length, 0, 'switching technique asks the user before anything is sent');
    assert.deepEqual(once.pageErrors, []);
  } finally {
    await once.close();
  }
  const userStopped = built({ spec_version: 2, status: 'failed', implement_run_id: '5555555555555555',
    status_message: 'the run building v2 ended (CANCELED: Run cancelled) while v2 was still filling' });
  const cancelled = await openUi('implement', { ...STUDIO_STATE, history: [userStopped, built()] });
  try {
    await expandBuild(cancelled.page);
    const banner = cancelled.page.getByRole('region', { name: 'Build failed' });
    await banner.getByRole('button', { name: 'Try again' }).waitFor();
    assert.equal(await banner.locator('[data-failure-choice]').count(), 0, 'a run the user stopped did not fail, so it offers no failure choices');
    assert.deepEqual(cancelled.pageErrors, []);
  } finally {
    await cancelled.close();
  }
});

test('Try again on a failed build sends the version that failed again as the next one, with its asks, and a notebook edit keeps its own rebuild', async () => {
  const spec = builtSpec();
  const vibe = 'Put the riskiest customers first';
  const failed = built({ spec_version: 2, status: 'failed', status_message: RUN_FAILED_REASON, change_classes: 'vibe',
    spec_json: JSON.stringify({ ...spec, based_on_version: 1, vibes: vibe, vibe_previous: 'keep' }) });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [failed, built()] });
  const { page, made } = ui;
  try {
    const banner = page.getByRole('region', { name: 'Build failed' });
    await banner.getByText(buildAgainHint({ spec_version: 2 }), { exact: true }).waitFor();
    const again = banner.getByRole('button', { name: 'Try again' });
    assert.match(await again.evaluate((el) => el.className), /bg-db-red-solid/, 'Try again is the main way forward');
    assert.doesNotMatch(await banner.getByRole('button', { name: 'Open all settings' }).evaluate((el) => el.className), /bg-db-red-solid/);
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const seen = await lowContrast(page, ['section[aria-label="Build failed"]']);
      assert.ok(seen.checked >= 5, `measured ${seen.checked} banner elements`);
      assert.deepEqual(seen.low, [], dark ? 'dark banner' : 'light banner');
    }
    assert.equal(made.jobs.length, 0);
    await again.click();
    await until(() => made.jobs.length === 1, 'the Try again run');
    const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO'));
    assert.equal(inserts.length, 1);
    const value = (name) => inserts[0].parameters.find((p) => p.name === name).value;
    assert.deepEqual([value('v'), value('based'), value('classes')], ['3', '2', 'vibe']);
    const sent = JSON.parse(value('spec'));
    assert.deepEqual([sent.vibes, sent.vibe_previous, sent.based_on_version], [vibe, 'keep', 2], 'the ask of the failed version goes again');
    assert.equal(made.jobs[0].params.inspire_implement_spec_version, '3');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const edited = await openUi('implement', { ...STUDIO_STATE, history: [editedVersion(), built()] });
  try {
    const banner = edited.page.getByRole('region', { name: 'Build failed' });
    await banner.getByRole('button', { name: 'Open all settings' }).waitFor();
    assert.equal(await banner.getByRole('button', { name: 'Try again' }).count(), 0, 'a hand-edited notebook keeps its own rebuild');
    assert.match(await banner.getByRole('button', { name: 'Open all settings' }).evaluate((el) => el.className), /bg-db-red-solid/);
    assert.deepEqual(edited.pageErrors, []);
  } finally {
    await edited.close();
  }
});

test('a build that finishes bursts confetti from the bundled package, never for a person who asked for less motion, and loads nothing from an outside host', async () => {
  const run = { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } };
  const building = (v) => built({ spec_version: v, status: 'building_outputs', status_message: 'building outputs', implement_run_id: String(run.run_id),
    updated_at: new Date().toISOString() });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [building(2), built()], implementRun: run }, '', FAKE_CLOCK);
  const { page, made } = ui;
  const outside = [];
  page.on('request', (r) => { if (!/^(data|blob):|^https?:\/\/127\.0\.0\.1:\d+\//.test(r.url())) outside.push(r.url()); });
  const canvases = () => page.locator('canvas').count();
  try {
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await page.getByRole('progressbar', { name: 'Build progress' }).waitFor();
    made.state.history = [built({ spec_version: 2 }), built()];
    await pollNow(page);
    await page.locator('[data-mvp-progress][data-progress-open="false"] [data-build-summary]', { hasText: /^Ready/ }).waitFor({ timeout: 15000 });
    await page.clock.runFor(800);
    assert.equal(await canvases(), 0, 'no burst for a person who asked for less motion');

    await page.emulateMedia({ reducedMotion: 'no-preference' });
    made.state.history = [building(3), built({ spec_version: 2 }), built()];
    await pollNow(page);
    await page.locator('[data-stop-build]').waitFor({ timeout: 15000 });
    assert.equal(await canvases(), 0, 'nothing bursts while the build runs');
    made.state.history = [built({ spec_version: 3 }), built({ spec_version: 2 }), built()];
    await pollNow(page);
    const burst = await page.waitForFunction(() => document.querySelectorAll('canvas').length, null, { timeout: 15000 });
    assert.equal(await burst.jsonValue(), 1, 'one burst when the build finishes');
    assert.deepEqual(outside, [], 'the confetti comes with the App, not from a CDN');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('an App that wanted Lakebase and fell back to Delta tables says so in its drawer, and Switch to Lakebase rebuilds only the App', async () => {
  const assets = JSON.parse(built().asset_status);
  const spec = builtSpec();
  const fallback = 'App: it reads Delta tables, so its pages take a few seconds to load, because Inspire could not set up Lakebase: no capacity.';
  const fell = built({
    spec_version: 2, status: 'ready_with_warnings', status_message: fallback,
    spec_json: JSON.stringify({ ...spec, outputs: { ...spec.outputs, app_access: 'sp', app_backend: 'lakebase' } }),
    asset_status: JSON.stringify({ ...assets, app: { ...assets.app, backend: 'delta', warnings: [fallback] } }),
  });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [fell] });
  const { page, made } = ui;
  try {
    await showView(page, 'app');
    const tile = assetPanel(page, 'app');
    await tile.locator('[data-app-backend]').waitFor();
    assert.equal(await tile.locator('[data-app-backend]').innerText(), 'Reads Delta tables: pages take a few seconds to load');
    await tile.getByRole('list', { name: 'App warnings' }).getByText(fallback).waitFor();
    for (const id of [...OUTPUT_IDS.filter((tab) => tab !== 'app'), 'job', 'build']) {
      await showView(page, id);
      assert.equal(await viewOf(page, id).getByRole('button', { name: 'Switch to Lakebase' }).count(), 0, id);
    }
    assert.deepEqual(await page.locator('[data-asset-tile]').evaluateAll((els) => els.filter((t) => [...t.querySelectorAll('button')].some((x) => x.textContent.includes('Switch to Lakebase'))).map((t) => t.dataset.assetTile)),
      ['app'], 'the App tile offers the switch too, and no other tile does');
    await showView(page, 'app');
    await tile.getByRole('button', { name: 'Switch to Lakebase' }).click();
    await until(() => made.jobs.length === 1, 'the Lakebase rebuild run');
    const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO'));
    assert.equal(inserts.length, 1);
    const sent = JSON.parse(inserts[0].parameters.find((p) => p.name === 'spec').value);
    assert.deepEqual([sent.retry_outputs, sent.outputs.app_backend], [['app'], 'lakebase']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('an App on Lakebase says so in its drawer and offers no switch', async () => {
  const assets = JSON.parse(built().asset_status);
  const spec = builtSpec();
  const onLakebase = built({
    spec_json: JSON.stringify({ ...spec, outputs: { ...spec.outputs, app_access: 'sp', app_backend: 'lakebase' } }),
    asset_status: JSON.stringify({ ...assets, app: { ...assets.app, backend: 'lakebase' } }),
  });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [onLakebase] });
  const { page } = ui;
  try {
    await showView(page, 'app');
    const tile = assetPanel(page, 'app');
    await tile.locator('[data-app-backend]').waitFor();
    assert.equal(await tile.locator('[data-app-backend]').innerText(), 'Reads Lakebase: pages load instantly');
    assert.equal(await tile.getByRole('button', { name: 'Switch to Lakebase' }).count(), 0);
    assert.equal(await page.locator('[data-asset-tiles]').getByRole('button', { name: 'Switch to Lakebase' }).count(), 0, 'nor on a tile');
    for (const id of [...OUTPUT_IDS.filter((tab) => tab !== 'app'), 'job', 'build']) {
      await showView(page, id);
      assert.equal(await viewOf(page, id).getByRole('button', { name: 'Switch to Lakebase' }).count(), 0, id);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Alert drawer shows what fires the alert when it has a link or a trigger, and says there is no alert when it has neither', async () => {
  const assets = JSON.parse(built().asset_status);
  const noLink = { alert_id: null, alert_url: null };
  for (const [row, shown, gone] of [
    [built(noLink), ['Fires when: Act now rows in the latest run are at least 1', `Notifies: ${OWNER}`, 'Last check: OK'], 'No alert on this version.'],
    [built({ ...noLink, asset_status: JSON.stringify({ ...assets, alert: { state: 'ready' } }) }), ['No alert on this version.'], 'Fires when:'],
  ]) {
    const ui = await openUi('implement', { ...STUDIO_STATE, history: [row] });
    const { page } = ui;
    try {
      await showView(page, 'alert');
      const facts = page.locator('[data-asset-facts="alert"]');
      for (const text of shown) await facts.getByText(text, { exact: true }).waitFor();
      assert.equal(await facts.getByText(gone, { exact: false }).count(), 0, gone);
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});

test('a failed output offers its own retry, which submits the next version that rebuilds only that output', async () => {
  const assets = JSON.parse(built().asset_status);
  const warned = built({
    spec_version: 2, status: 'ready_with_warnings', status_message: 'Genie Agent: space create 403',
    asset_status: JSON.stringify({ ...assets, genie_space: { state: 'failed', error: 'space create 403', spec_version: 1 } }),
  });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [warned] });
  const { page, made } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    const agentTile = tile(page, 'genie_space');
    await agentTile.locator('[data-tile-state]').getByText('Failed', { exact: true }).waitFor({ timeout: 20000 });
    assert.equal(await agentTile.getAttribute('title'), 'space create 403', 'the tile says why it failed');
    assert.equal(await agentTile.locator('[data-tile-open="asset"], [data-tile-open-button]').count(), 0, 'a failed tile opens the reason, not the asset');
    assert.deepEqual(await page.locator('[data-asset-tile] [data-tile-state]').evaluateAll((els) => els.filter((e) => e.textContent === 'Failed').length), 1, 'only the Genie Agent tile reads Failed');
    await page.locator('[data-asset-tile="app"][data-tile-kind="live"]').waitFor({ timeout: 20000 });
    const retried = [];
    for (const id of OUTPUT_IDS) {
      await showView(page, id);
      if (await viewOf(page, id).getByRole('button', { name: /^Retry the / }).count()) retried.push(id);
    }
    assert.deepEqual(retried, ['genie_space'], 'only the failed output\'s drawer offers a retry');
    await showView(page, 'genie_space');
    const agent = assetPanel(page, 'genie_space');
    assert.equal(await agent.getByRole('button', { name: 'Retry the Genie Agent' }).getAttribute('title'), 'space create 403');
    await agent.getByText('The Genie Agent failed on v1: space create 403', { exact: true }).waitFor();
    await showView(page, 'app');
    await assetPanel(page, 'app').waitFor();
    assert.equal(await viewOf(page, 'app').getByText(/failed on v/).count(), 0, 'only the failed output\'s drawer shows its failure');
    assert.equal(await viewOf(page, 'app').getByText('space create 403', { exact: false }).count(), 0);

    await showView(page, 'build');
    await agentTile.locator('[data-tile-open="reason"]').click();
    await viewOf(page, 'genie_space').getByText('The Genie Agent failed on v1: space create 403', { exact: true }).waitFor();
    assert.equal(made.jobs.length, 0);

    await showView(page, 'job');
    const retries = runPane(page).getByRole('button', { name: /^Retry the / });
    await retries.first().waitFor();
    assert.deepEqual((await retries.allTextContents()).map((t) => t.trim()), ['Retry the Genie Agent']);
    await retries.first().click();
    await until(() => made.jobs.length === 1, 'the retry implement run');
    const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO'));
    assert.equal(inserts.length, 1);
    const value = (name) => inserts[0].parameters.find((p) => p.name === name).value;
    assert.deepEqual([value('v'), value('based'), value('classes')], ['3', '2', 'retry']);
    const spec = JSON.parse(value('spec'));
    assert.deepEqual(spec.retry_outputs, ['genie_space']);
    assert.deepEqual(
      { dashboard: spec.outputs.dashboard, genie_space: spec.outputs.genie_space, app: spec.outputs.app, alert: spec.outputs.alert },
      { dashboard: true, genie_space: true, app: true, alert: true },
    );
    assert.equal(made.jobs[0].params['15_operation'], 'Implement Use Cases');
    assert.equal(made.jobs[0].params.inspire_implement_spec_version, '3');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a retry of a version that wrote to the old shared result table another use case holds moves to its own table and says so on the Build page', async () => {
  const shared = 'main.inspire.n01_u01_out';
  const assets = JSON.parse(built().asset_status);
  const warned = built({
    spec_version: 2, status: 'ready_with_warnings', status_message: 'Genie Agent: space create 403',
    spec_json: JSON.stringify({ ...builtSpec(), config: { ...builtSpec().config, result_table: shared } }),
    asset_status: JSON.stringify({ ...assets, genie_space: { state: 'failed', error: 'space create 403', spec_version: 1 } }),
  });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [warned],
    resultTableHolders: { [shared]: [{ session_id: '2222222222222222222', use_case_id: 'N01-U01' }] } });
  const { page, made } = ui;
  try {
    await tile(page, 'genie_space').locator('[data-tile-state]').getByText('Failed', { exact: true }).waitFor({ timeout: 20000 });
    await showView(page, 'job');
    const retries = runPane(page).getByRole('button', { name: 'Retry the Genie Agent' });
    await retries.first().click();
    await until(() => made.jobs.length === 1, 'the retry implement run');
    const note = page.getByRole('status').filter({ hasText: 'Result table: results move to' });
    await note.waitFor();
    assert.equal((await note.textContent()).trim(), `Result table: results move to ${RESULT_TABLE}, because ${shared} holds the results of use case N01-U01 `
      + 'of session 2222222222222222222; earlier versions of this use case wrote there under the old shared name');
    const insert = made.sqlCalls.find((c) => String(c.sql).includes('INSERT INTO'));
    assert.equal(JSON.parse(insert.parameters.find((p) => p.name === 'spec').value).config.result_table, RESULT_TABLE);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('no output drawer has a rebuild button of its own, a failed output keeps its retry on its tile, in its drawer and under Run and schedule, and nothing in an output can be pressed while a version runs', async () => {
  const assets = JSON.parse(built().asset_status);
  const warned = built({
    spec_version: 2, status: 'ready_with_warnings', status_message: 'Genie Agent: space create 403',
    asset_status: JSON.stringify({ ...assets, genie_space: { state: 'failed', error: 'space create 403', spec_version: 2 } }),
  });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [warned] });
  const { page, made } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await statusLoaded(page);
    const rebuilds = {};
    const retries = {};
    assert.deepEqual(await page.locator('[data-asset-tile] button', { hasText: /^ ?Retry/ }).evaluateAll((els) => els.map((b) => b.closest('[data-asset-tile]').dataset.assetTile)),
      ['genie_space'], 'the failed tile carries its retry');
    for (const id of OUTPUT_IDS) {
      await showView(page, id);
      rebuilds[id] = await viewOf(page, id).getByRole('button', { name: /^Rebuild/ }).count();
      retries[id] = (await viewOf(page, id).getByRole('button', { name: /^Retry the / }).evaluateAll((els) => els.map((b) => b.getAttribute('aria-label') || b.textContent.trim())));
    }
    assert.deepEqual(rebuilds, { app: 0, dashboard: 0, alert: 0, genie_space: 0, notebook: 0 }, 'a built output is rebuilt with Vibe/Add/Remove Features, not a button of its own');
    assert.deepEqual(retries, { app: [], dashboard: [], alert: [], genie_space: ['Retry the Genie Agent'], notebook: [] });
    await showView(page, 'job');
    assert.deepEqual((await runPane(page).getByRole('button', { name: /^Retry the / }).allTextContents()).map((t) => t.trim()),
      ['Retry the Genie Agent']);
    await showView(page, 'genie_space');
    await assetPanel(page, 'genie_space').getByRole('button', { name: 'Retry the Genie Agent' }).click();
    await until(() => made.jobs.length === 1, 'the retry implement run');
    const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO'));
    assert.equal(inserts.length, 1);
    const value = (name) => inserts[0].parameters.find((p) => p.name === name).value;
    assert.deepEqual([value('v'), value('based'), value('classes')], ['3', '2', 'retry']);
    const spec = JSON.parse(value('spec'));
    assert.deepEqual(spec.retry_outputs, ['genie_space'], 'the retry in the Agent drawer rebuilds only the Genie Agent');
    assert.equal(spec.outputs.app_name, 'churn-desk', 'and keeps the App as it is');
    assert.equal(made.jobs[0].params.inspire_implement_spec_version, '3');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const busy = await openUi('implement', { ...STUDIO_STATE,
    history: [built({ status: 'building_outputs', implement_run_id: '5555555555555555', updated_at: new Date().toISOString() })],
    implementRun: { run_id: 5555555555555555, state: { life_cycle_state: 'RUNNING' } } });
  try {
    await busy.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await busy.page.getByRole('navigation', { name: 'Use cases' }).getByRole('region', { name: 'Building' }).getByText('MVP running', { exact: true }).waitFor();
    await statusLoaded(busy.page);
    await showView(busy.page, 'job');
    assert.equal(await busy.page.getByRole('checkbox', { name: 'Schedule on' }).isDisabled(), true);
    await showView(busy.page, 'app');
    await busy.page.locator('[data-asset-panel="app"][data-tile-kind="live"]').waitFor({ timeout: 20000 });
    const pressable = {};
    let buttons = 0;
    for (const id of OUTPUT_IDS) {
      await showView(busy.page, id);
      if (id !== 'notebook') await assetPanel(busy.page, id).waitFor();
      const states = await busy.page.locator('[data-asset-panel] button').evaluateAll((els) => els.map((b) => [b.textContent.trim(), b.disabled]));
      buttons += states.length;
      pressable[id] = states.filter(([, disabled]) => !disabled).map(([label]) => label);
      assert.equal(await viewOf(busy.page, id).getByRole('button', { name: /^Rebuild/ }).count(), 0, `nothing is rebuilt while a version runs: ${id}`);
    }
    assert.ok(buttons > 0, 'the output panels were measured with their buttons');
    assert.deepEqual(pressable, { app: [], dashboard: [], alert: [], genie_space: [], notebook: [] }, 'every output button waits for the build');
    assert.deepEqual(busy.pageErrors, []);
  } finally {
    await busy.close();
  }
});

test('a version saved while the App offered downloads retries its App and opens in Edit without them', async () => {
  const saved = builtSpec();
  const downloadSpec = JSON.stringify({ ...saved, outputs: { ...saved.outputs, app_access: 'sp',
    app_options: { download: true, modify: true, replace_edits: false, decisions: false } } });
  const withDownloads = built({ spec_json: downloadSpec });
  const assets = JSON.parse(built().asset_status);
  const appFailed = built({ status: 'ready_with_warnings', status_message: 'App: deploy failed', spec_json: downloadSpec,
    asset_status: JSON.stringify({ ...assets, app: { state: 'failed', error: 'deploy failed', spec_version: 1 } }) });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [appFailed] });
  try {
    await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await showView(ui.page, 'app');
    const retry = assetPanel(ui.page, 'app').getByRole('button', { name: 'Retry the App', exact: true });
    assert.equal(await retry.getAttribute('title'), 'deploy failed');
    await retry.click();
    await until(() => ui.made.jobs.length === 1, 'the App retry implement run');
    const spec = submittedSpec(ui.made);
    assert.deepEqual(spec.retry_outputs, ['app']);
    assert.deepEqual(spec.outputs.app_options, { modify: true, replace_edits: false, decisions: false, alerts: false });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const never = await openUi('implement', { ...STUDIO_STATE, history: [{ ...appFailed, app_name: null, app_url: null }] });
  try {
    await never.page.locator('[data-asset-tile="app"] [data-tile-open="reason"]').click({ timeout: 20000 });
    const panel = never.page.locator('[data-asset-panel="app"][data-tile-kind="failed"]');
    await panel.waitFor({ timeout: 20000 });
    assert.equal(await panel.getByText('The App failed on v1: deploy failed', { exact: true }).count(), 1, 'an App that was never created says why, once');
    assert.equal(await panel.getByText('It failed', { exact: false }).count(), 0);
    await panel.getByRole('button', { name: 'Retry the App', exact: true }).click();
    await until(() => never.made.jobs.length === 1, 'the retry of the App that was never created');
    assert.deepEqual(submittedSpec(never.made).retry_outputs, ['app']);
    assert.deepEqual(never.pageErrors, []);
  } finally {
    await never.close();
  }
  const edit = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, history: [withDownloads] });
  try {
    await toData(edit.page);
    await toDelivery(edit.page);
    await toAppAccess(edit.page);
    const access = edit.page.getByRole('region', { name: 'App access' });
    assert.equal(await access.getByRole('checkbox', { name: /^Let people edit data/ }).isChecked(), true, 'the saved choices come back');
    await access.getByRole('checkbox', { name: /^Record decisions/ }).check();
    await next(edit.page);
    await onStep(edit.page, 'App look');
    await implementWhenReady(edit.page);
    await edit.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.deepEqual(submittedSpec(edit.made).outputs.app_options, { modify: true, replace_edits: false, decisions: true, alerts: false });
    assert.deepEqual(edit.pageErrors, []);
  } finally {
    await edit.close();
  }
});

test('a dropped source table stops the re-run with its name, and Edit opens the Data step with that table marked and its Change open', async () => {
  const ui = await openUi('implement', { ...STUDIO_STATE, probeErrors: { '`main`.`s`.`returns`': GONE } });
  const { page, made } = ui;
  const missing = [{ table: 'main.s.returns', reason: 'not found' }];
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await statusLoaded(page);
    await showView(page, 'job');
    await runPane(page).getByRole('button', { name: 'Preview re-run' }).click();
    await page.getByText(lostTablesText(missing)).waitFor();
    await page.getByText('the preview cannot run because these source tables are missing or not readable: main.s.returns (not found).', { exact: false }).waitFor();
    assert.equal(await page.getByText('409:', { exact: false }).count(), 0, 'no HTTP status code reaches the screen');
    assert.ok(!made.fetches.some((f) => f.path === '/api/2.1/jobs/run-now'));

    await closeAsset(page);
    await page.getByRole('button', { name: 'Edit the Data step' }).click();
    await onStep(page, 'Data');
    const wizard = page.getByRole('dialog');
    await wizard.getByText(lostTablesText(missing)).waitFor();
    const lostRow = wizard.locator('[data-table="main.s.returns"]');
    await lostRow.getByText('not found', { exact: true }).waitFor();
    assert.match(await lostRow.getAttribute('class'), /border-error\/50/);
    await page.getByLabel('Table to use for main.s.returns').waitFor();
    const primaryRow = wizard.locator('[data-table="main.s.orders"]');
    await primaryRow.getByText('Primary', { exact: true }).waitFor();
    assert.doesNotMatch(await primaryRow.getAttribute('class'), /border-error/);
    assert.equal(await page.getByLabel('Table to use for main.s.orders').count(), 0, 'only the lost table opens its Change');
    assert.equal(made.sqlCalls.some((c) => /FROM `main`\.`inspire`\.`n01_u01_s42_out` WHERE as_of_date/.test(String(c.sql))), false, 'no result rows are read');
    assert.equal(made.jobs.length, 0);
    assert.deepEqual(ui.pageErrors, ['Failed to load resource: the server responded with a status of 409 (Conflict)'], 'the refused re-run is the only error');
  } finally {
    await ui.close();
  }
});

test('Edit of a use case whose own App no longer exists says so and puts the use case in its domain App by default', async () => {
  const hubRow = {
    session_id: '42', use_case_id: 'N01-U05', spec_version: 1, status: 'ready', updated_at: '2026-10-26T00:00:00Z', asset_status: null,
    spec_json: JSON.stringify({ use_case_id: 'N01-U05', use_case_name: 'Price promos', outputs: { app: true, app_access: 'sp' } }),
    dashboard_id: null, genie_space_id: null, app_name: 'inspire-hub-acme',
  };
  const ui = await openUi('wizard', {
    me: { userName: OWNER, displayName: 'Owner' }, history: [built()], registry: [hubRow],
    appsByName: { 'inspire-hub-acme': { name: 'inspire-hub-acme', description: 'Inspire use case N01-U05 (session 42): Price promos' } },
    useCaseScope: [{ session_id: '42', use_case_id: 'N01-U05', business: 'Acme', domain: '' }],
  });
  const { page, made } = ui;
  try {
    await toData(page);
    await toDelivery(page);
    await page.getByText('The App this use case had, churn-desk, no longer exists, so Genie can add the use case to one Inspire built or create a new one.').waitFor();
    assert.equal(await page.locator('[data-merge="dashboard"]').count(), 0, 'a dashboard that still exists is updated in place');
    await next(page);
    await onStep(page, 'App placement');
    const place = page.getByRole('region', { name: 'App placement' });
    await place.getByRole('note', { name: 'The App this use case joins' }).waitFor();
    assert.equal(await place.locator('[data-app-target="inspire-hub-acme"] input[type="radio"]').isChecked(), true);
    assert.match(await place.locator('[data-app-target="inspire-hub-acme"]').textContent(), /Holds Price promos/);
    await implementWhenReady(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    const spec = submittedSpec(made);
    assert.deepEqual([spec.outputs.app_name, spec.outputs.merge.app], ['inspire-hub-acme', 'inspire-hub-acme']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const GONE_OLD = '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`returns_old` cannot be found. Verify the spelling. SQLSTATE: 42P01';
const lostSwapVersions = () => {
  const saved = builtSpec();
  const spec = { ...saved, outputs: { ...saved.outputs, app_access: 'sp' }, data: { ...saved.data, tables: { 'main.s.returns': 'main.s.returns_old' } } };
  return [
    built({ spec_version: 2, status: 'failed', status_message: 'the preview cannot run', spec_json: JSON.stringify({ ...spec, data: { ...spec.data, notes: 'try again' } }) }),
    built({ spec_json: JSON.stringify(spec) }),
  ];
};

test('Edit of a version whose swapped table is gone goes back to the use case\'s own table, says so on the Data step, and Start builds on it', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, history: lostSwapVersions(),
    probeErrors: { '`main`.`s`.`returns_old`': GONE_OLD } });
  const { page, made } = ui;
  try {
    await toData(page);
    const said = 'main.s.returns_old is missing or not readable (not found), so this version goes back to main.s.returns, the table Inspire picked. '
      + 'Use Change to pick another table.';
    await page.getByRole('dialog').getByText(said).waitFor();
    const row = page.locator('[data-table="main.s.returns"]');
    await row.getByText('main.s.returns', { exact: true }).waitFor();
    assert.equal(await row.getByText('instead of', { exact: false }).count(), 0, 'the row shows the use case\'s own table');
    assert.doesNotMatch(await row.getAttribute('class'), /border-error/);
    await toDelivery(page);
    await toAppAccess(page);
    await next(page);
    await onStep(page, 'App look');
    await implementWhenReady(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.deepEqual(submittedSpec(made).data.tables, {});
    assert.equal(made.jobs.length, 1);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Edit of a version whose swapped table and own table are both gone marks the table, and Start stays off with the table named', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, history: lostSwapVersions(),
    probeErrors: { '`main`.`s`.`returns_old`': GONE_OLD, '`main`.`s`.`returns`': GONE } });
  const { page, made } = ui;
  try {
    await toData(page);
    await page.getByRole('dialog').getByText(lostTablesText([{ table: 'main.s.returns_old', reason: 'not found' }])).waitFor();
    const row = page.locator('[data-table="main.s.returns"]');
    await row.getByText('not found', { exact: true }).waitFor();
    await page.getByLabel('Table to use for main.s.returns').waitFor();
    await toDelivery(page);
    await toAppAccess(page);
    await next(page);
    await onStep(page, 'App look');
    await toVibes(page);
    const named = 'the preview cannot run because these source tables are missing or not readable: main.s.returns_old (not found).';
    await page.waitForFunction((text) => [...document.querySelectorAll('[role="alert"] p')].some((p) => p.textContent.includes(text)), named, { timeout: 15000 });
    assert.equal(await page.getByRole('button', { name: 'Start MVP', exact: true }).isDisabled(), true);
    assert.equal(made.jobs.length, 0);
    assert.equal(made.sqlCalls.some((c) => /INSERT INTO/.test(String(c.sql))), false);
  } finally {
    await ui.close();
  }
});

test('Use case details on the Implement page open the full use case in a drawer that closes with Escape and leaves Build progress in place', async () => {
  const ui = await openUi('implement', STUDIO_STATE);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await showView(page, 'build');
    await page.getByRole('button', { name: 'Use case details' }).click();
    const drawer = page.getByRole('dialog', { name: `Use case details: ${HARNESS_USE_CASE.Name}` });
    await drawer.getByRole('heading', { name: HARNESS_USE_CASE.Name, level: 2 }).waitFor();
    await drawer.getByText(HARNESS_USE_CASE.statement).first().waitFor();
    await drawer.getByText('MVP ready', { exact: true }).first().waitFor();
    assert.equal(await drawer.getByRole('button', { name: 'Open in Build' }).count(), 0, 'already on the Implement page');
    assert.equal(await drawer.getByRole('button', { name: /^(Previous|Next) use case$/ }).count(), 0, 'one use case, no paging');
    await page.keyboard.press('Escape');
    await drawer.waitFor({ state: 'detached' });
    await viewOf(page, 'build').waitFor();
    assert.equal(await page.locator('[data-mvp-panel]').count(), 0, 'no asset drawer opened behind it');
    assert.equal(await focusedName(page), 'Use case details', 'the focus comes back to the button that opened it');
    await page.getByRole('button', { name: 'Use case details' }).click();
    await drawer.getByRole('button', { name: 'Close', exact: true }).click();
    await drawer.waitFor({ state: 'detached' });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a use case with no MVP offers to start one, reads no result table, and the wizard shows its title and id on every step', async () => {
  const never = await openUi('implement', { ...STUDIO_STATE, history: [] });
  try {
    await never.page.getByText('Not built yet.', { exact: false }).waitFor();
    await never.page.getByRole('navigation', { name: 'Use cases' }).getByRole('region', { name: 'Not built' }).getByText(HARNESS_USE_CASE.Name).waitFor();
    assert.equal(await never.page.locator('[data-asset-tiles]').count(), 0, 'no tiles before an MVP exists');
    assert.equal(await never.page.locator('[data-vibe-features]').count(), 0, 'nothing to vibe before an MVP exists');
    assert.equal(await never.page.locator('[data-asset-panel]').count(), 0, 'nothing to control before an MVP or a notebook exists');
    assert.equal(await never.page.locator('[data-mvp-progress]').count(), 0, 'no build to follow before an MVP exists');
    assert.equal(never.made.sqlCalls.some((c) => /^SELECT \* FROM `main`\.`inspire`\.`n01_u01_s42_out`/.test(String(c.sql))), false, 'no result table read');
    await never.page.getByRole('button', { name: 'Start Use Case MVP with Genie' }).click();
    await onStep(never.page, 'Choose');
    assert.equal(await never.page.getByRole('region', { name: 'Executive summary' }).locator('h3').innerText(), HARNESS_USE_CASE.Name);
    const header = never.page.locator('[data-wizard-header]');
    for (const label of ['Choose', 'Data', 'First run', 'Results', 'Delivery']) {
      if (label !== 'Choose') {
        await next(never.page);
        await onStep(never.page, label);
      }
      assert.equal(await header.getByRole('heading', { level: 2 }).innerText(), HARNESS_USE_CASE.Name, label);
      assert.equal(await header.getByRole('list', { name: 'About this use case' }).innerText().then((t) => t.replace(/\s+/g, ' ').trim()), 'ID N01-U01', label);
    }
    await never.page.getByRole('dialog', { name: `Start Use Case MVP with Genie: ${HARNESS_USE_CASE.Name}` }).waitFor();
    assert.deepEqual(never.pageErrors, []);
  } finally {
    await never.close();
  }
});

const EDITED_AT = Date.UTC(2026, 9, 25, 5, 0, 0);
const EDITED_REASON = 'the notebook /tmp/out/acme_implemented/Sales/N01-U01 was edited after Inspire last built it, so this version did not '
  + 'rebuild it: rebuild it with Vibe/Add/Remove Features on the Build page to overwrite those edits, or keep them and change only the outputs or the schedule';

const editedVersion = () => {
  const spec = builtSpec();
  const assets = JSON.parse(built().asset_status);
  return built({
    spec_version: 2, status: 'failed', status_message: EDITED_REASON,
    spec_json: JSON.stringify({ ...spec, config: { ...spec.config, profiles: { ...spec.config.profiles, preview: { entity_cap: 500 } } } }),
    asset_status: JSON.stringify({ ...assets, notebook: { modified_at: EDITED_AT - 60000, spec_version: 1, state: 'edited', edited_at: EDITED_AT } }),
  });
};

test('a version stopped by notebook edits offers a rebuild that overwrites them, submitted as the next version', async () => {
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [editedVersion(), built()] });
  const { page, made } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await page.getByText(EDITED_REASON).waitFor();
    assert.equal(await page.getByText(EDITED_REASON).count(), 1, 'the reason shows once, next to its action');
    assert.equal(made.jobs.length, 0);
    await page.getByRole('button', { name: 'Rebuild and overwrite the edits' }).click();
    await until(() => made.jobs.length === 1, 'the rebuild implement run');
    const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO'));
    assert.equal(inserts.length, 1);
    const value = (name) => inserts[0].parameters.find((p) => p.name === name).value;
    assert.deepEqual([value('v'), value('based'), value('classes')], ['3', '2', 'config']);
    const spec = JSON.parse(value('spec'));
    assert.equal(spec.confirm_notebook_overwrite, true);
    assert.equal(spec.config.profiles.preview.entity_cap, 500, 'the rebuild keeps the change the stopped version was making');
    assert.equal('retry_outputs' in spec && spec.retry_outputs.length > 0, false);
    assert.equal(made.jobs[0].params.inspire_implement_spec_version, '3');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const assets = JSON.parse(built().asset_status);
  const kept = await openUi('implement', { ...STUDIO_STATE,
    history: [built({ asset_status: JSON.stringify({ ...assets, notebook: { modified_at: 1, state: 'edited', edited_at: EDITED_AT } }) })] });
  try {
    await statusLoaded(kept.page);
    assert.equal(await kept.page.getByRole('button', { name: 'Rebuild and overwrite the edits' }).count(), 0,
      'a built version that kept the edits offers no overwrite');
  } finally {
    await kept.close();
  }
});

test('Edit after notebook edits asks on Delivery whether to overwrite them, and only a ticked box confirms', async () => {
  const ui = await openUi('wizard', { ...STUDIO_STATE, history: [editedVersion(), built()], me: { userName: OWNER, displayName: 'Owner' } });
  const { page, made } = ui;
  try {
    await toData(page);
    await toDelivery(page);
    const box = page.getByRole('checkbox', { name: /^Overwrite the edits made to the notebook on / });
    await box.waitFor();
    assert.equal(await box.isChecked(), false, 'an Edit never starts confirmed');
    const asks = page.getByText('This version rebuilds the notebook, so it stops and asks again unless you tick this.');
    await asks.waitFor();
    await box.check();
    await asks.waitFor({ state: 'detached' });
    await throughApp(page);
    await implementWhenReady(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO'));
    assert.equal(inserts.length, 1);
    const value = (name) => inserts[0].parameters.find((p) => p.name === name).value;
    assert.deepEqual([value('v'), value('based')], ['3', '2']);
    assert.equal(JSON.parse(value('spec')).confirm_notebook_overwrite, true);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const fresh = await openUi('wizard', { ...STUDIO_STATE, me: { userName: OWNER, displayName: 'Owner' } });
  try {
    await toData(fresh.page);
    await toDelivery(fresh.page);
    assert.equal(await fresh.page.getByRole('checkbox', { name: /^Overwrite the edits/ }).count(), 0, 'no recorded edit, no question');
    assert.equal(await fresh.page.locator('[data-merge]').count(), 0, 'an output the use case already has is updated in place, never moved');
    await next(fresh.page);
    await onStep(fresh.page, 'App placement');
    await fresh.page.getByText('This use case already has its App, churn-desk, so Genie rebuilds it there.').waitFor();
    assert.equal(await fresh.page.getByLabel('App name').inputValue(), 'churn-desk', 'an edit keeps the live App name');
    assert.equal(await fresh.page.locator('[data-app-target]').count(), 0, 'an App the use case already has is never moved');
    await next(fresh.page);
    await onStep(fresh.page, 'App access');
    assert.equal(await fresh.page.getByRole('radio', { name: /^Internal data/ }).isChecked(), true,
      'an App built before the access choice existed shows the service principal it signs in with');
    await next(fresh.page);
    await onStep(fresh.page, 'App look');
    await toVibes(fresh.page);
    const note = fresh.page.getByRole('note', { name: 'Nothing to build' });
    await note.waitFor();
    assert.match(await note.innerText(), /Nothing changed since version 1, so there is nothing new to build\. Change a choice in any step to build version 2/);
    assert.equal(await fresh.page.getByRole('button', { name: 'Start MVP', exact: true }).isDisabled(), true, 'an edit with no change cannot submit');
    assert.equal(await fresh.page.getByRole('alert').count(), 0, 'an unchanged edit is a note, never an error');
    assert.equal(await fresh.page.getByText(/^\d{3}:/).count(), 0, 'no HTTP status code reaches the screen');
    const lookStep = async () => {
      for (const label of ['Settings', 'App look']) {
        await fresh.page.getByRole('button', { name: 'Back' }).click();
        await onStep(fresh.page, label);
      }
      await fresh.page.getByRole('region', { name: 'App look' }).getByRole('tab', { name: 'Palette', exact: true }).click();
      return fresh.page.getByRole('region', { name: 'App look' }).getByRole('group', { name: 'Light or dark' });
    };
    await (await lookStep()).getByRole('button', { name: 'Dark' }).click();
    await toVibes(fresh.page);
    await fresh.page.waitForFunction(() => {
      const start = [...document.querySelectorAll('button')].find((b) => b.textContent.trim() === 'Start MVP');
      return start && !start.disabled;
    });
    assert.equal(await note.count(), 0, 'a changed look is something to build');
    await (await lookStep()).getByRole('button', { name: 'Light' }).click();
    await toVibes(fresh.page);
    await note.waitFor();
    await note.getByRole('button', { name: 'Go to the Build page' }).click();
    await fresh.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.equal(fresh.made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO')).length, 0, 'an unchanged edit records no new version');
    assert.deepEqual(fresh.pageErrors, []);
  } finally {
    await fresh.close();
  }
});

test('with no Genie Code route, Inspire builds the MVP is disabled with the reason and the admin fix, and I will build it myself is picked for you', async () => {
  const noRoute = { answer: () => [{ error_code: 'RESOURCE_DOES_NOT_EXIST', message: 'no such model' }, 404] };
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, gateway: noRoute });
  const { page, made } = ui;
  try {
    await onStep(page, 'Choose');
    const full = page.getByRole('radio', { name: new RegExp(`^${MVP_MODE_LABEL}`) });
    assert.equal(await full.isDisabled(), true);
    assert.equal(await page.getByRole('radio', { name: new RegExp(`^${NOTEBOOK_MODE_LABEL}`) }).isChecked(), true);
    const note = page.getByRole('note', { name: GENIE_CODE_OFF_TITLE });
    await note.getByText(/^Genie Code is not available in this workspace/).waitFor();
    await note.getByText(/^Admin fix: Ask a workspace admin to serve a model to Genie Code/).waitFor();
    assert.doesNotMatch(await note.textContent(), /contact|ticket|support/i);
    assert.deepEqual(await page.locator('ol li').allTextContents(), ['1. Choose', '2. Data', '3. Notebook']);
    assert.equal(made.jobs.length, 0);
  } finally {
    await ui.close();
  }
});

test('with a Genie Code route, Inspire builds the MVP stays the default and no note shows', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  try {
    await onStep(ui.page, 'Choose');
    assert.equal(await ui.page.getByRole('radio', { name: new RegExp(`^${MVP_MODE_LABEL}`) }).isChecked(), true);
    assert.equal(await ui.page.getByRole('note', { name: GENIE_CODE_OFF_TITLE }).count(), 0);
  } finally {
    await ui.close();
  }
});

test('I will build it myself skips the MVP settings, flags only this use case, starts Generate Use Cases, and the Implement page follows the notebook run', async () => {
  const notebookPath = '/Users/owner@example.com/inspire/Acme/N01-U01';
  const flaggedRow = { ...HARNESS_USE_CASE, generate_genie_code_instruction: 'Yes', has_genie_code: 'N' };
  const runUrl = 'https://workspace.example.com/#job/7/run/99';
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' } });
  const { page, made } = ui;
  made.state.afterTrigger = () => {
    made.state.useCase = flaggedRow;
    made.state.jobsList = { jobs: [{ job_id: 7, created_time: 1, settings: { name: 'Inspire AI - Genie Code - 42' } }] };
    made.state.runsByJob = { 7: { runs: [{ run_id: 99, state: { life_cycle_state: 'RUNNING' }, run_page_url: runUrl }] } };
  };
  try {
    await onStep(page, 'Choose');
    await page.getByRole('radio', { name: new RegExp(`^${NOTEBOOK_MODE_LABEL}`) }).check();
    assert.deepEqual(await page.locator('ol li').allTextContents(), ['1. Choose', '2. Data', '3. Notebook']);
    await next(page);
    await onStep(page, 'Data');
    const tables = page.getByRole('region', { name: 'Tables the notebook uses' });
    assert.deepEqual(await tables.locator('li > span.font-mono').allTextContents(), ['main.s.orders', 'main.s.returns']);
    await tables.locator('li', { hasText: 'main.s.orders' }).getByText('primary', { exact: true }).waitFor();
    assert.equal(await advanced(page).count(), 0, 'I will build it myself has no MVP settings');
    assert.equal(await page.getByRole('button', { name: 'Change' }).count(), 0, 'I will build it myself never swaps a table');
    await next(page);
    await onStep(page, 'Notebook');
    const step = page.getByRole('region', { name: 'Notebook' });
    await step.getByRole('heading', { name: 'Write the Genie Code notebook' }).waitFor();
    await step.getByText('under /tmp/out/acme.', { exact: false }).waitFor();
    assert.equal(made.jobs.length, 0);
    await page.getByRole('button', { name: 'Generate notebook' }).click();
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();

    assert.equal(made.jobs.length, 1);
    assert.equal(made.jobs[0].jobType, 'genie_regen');
    assert.equal(made.jobs[0].jobName, 'Inspire AI - Genie Code - 42');
    assert.equal(made.jobs[0].params['15_operation'], 'Generate Use Cases');
    assert.deepEqual(made.flagged.map((f) => [f.sid, f.ids]), [['42', ['N01-U01']]]);
    assert.equal(made.sqlCalls.some((c) => String(c.sql).includes('INSERT INTO')), false, 'I will build it myself writes no MVP version');

    const nav = page.getByRole('navigation', { name: 'Use cases' });
    await nav.getByRole('region', { name: 'Building' }).getByText('Notebook running', { exact: true }).waitFor();
    const panel = assetPanel(page, 'notebook');
    assert.equal(await panel.getByRole('link', { name: 'Open the notebook run' }).getAttribute('href'), runUrl);
    await panel.getByText('Notebook running', { exact: true }).waitFor();
    assert.equal(await page.locator('[data-asset-tiles]').count(), 0, 'a notebook alone shows without tiles');
    assert.deepEqual(await page.locator('[data-asset-panel]').evaluateAll((panels) => panels.map((p) => p.dataset.assetPanel)), ['notebook'], 'only the notebook panel');
    assert.equal(await page.getByRole('button', { name: 'Check the live status now' }).count(), 0, 'a notebook has no live status to check');
    assert.equal(await page.getByRole('region', { name: 'Run and schedule', exact: true }).count(), 0);
    assert.equal(await page.getByRole('region', { name: 'History', exact: true }).count(), 0);
    assert.equal(await page.locator('[data-mvp-progress]').count(), 0, 'no MVP build to follow');
    assert.equal(await panel.getByRole('link', { name: 'Open the notebook', exact: true }).count(), 0, 'no notebook link before it is written');
    assert.equal(await page.getByRole('button', { name: /Uninstall/ }).count(), 0, 'nothing to uninstall without an MVP');

    made.state.useCase = { ...flaggedRow, generate_genie_code_instruction: 'No', has_genie_code: 'Y', notebook_path: notebookPath };
    made.state.runsByJob = { 7: { runs: [{ run_id: 99, state: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' }, run_page_url: runUrl }] } };
    await nav.getByRole('region', { name: 'Ready' }).getByText('Notebook ready', { exact: true }).waitFor({ timeout: 25000 });
    assert.equal(await panel.getByRole('link', { name: 'Open the notebook', exact: true }).getAttribute('href'),
      `https://workspace.example.com/#workspace/Workspace${notebookPath}`);
    await page.getByRole('button', { name: 'Start Use Case MVP with Genie' }).waitFor();
    await page.getByText('Not built yet.', { exact: false }).waitFor();
    await shot(page, 'notebook-only');
    await panel.getByText(notebookPath, { exact: true }).waitFor();
    await panel.getByText('Notebook ready', { exact: true }).waitFor();
    assert.deepEqual(await page.locator('[data-asset-panel]').evaluateAll((panels) => panels.map((p) => p.dataset.assetPanel)), ['notebook']);
    assert.equal(await page.locator('[data-asset-tiles]').count(), 0);
    assert.equal(await page.getByRole('region', { name: 'Run and schedule', exact: true }).count(), 0);
    assert.equal(await page.getByRole('region', { name: 'History', exact: true }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'Check the live status now' }).count(), 0);
    assert.equal(await page.locator('[data-vibe-card]').count(), 0, 'a notebook without an MVP has no vibes to rebuild');
    assert.equal(await page.getByRole('button', { name: /Uninstall/ }).count(), 0, 'and nothing to uninstall');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('I will build it myself started from the Build page of a use case that has a notebook shows it running at once, not the old notebook as ready', async () => {
  const notebookPath = '/Users/owner@example.com/inspire/Acme/N01-U01';
  const runUrl = 'https://workspace.example.com/#job/7/run/99';
  const ui = await openUi('implement', { useCase: { ...HARNESS_USE_CASE, has_genie_code: 'Y', generate_genie_code_instruction: 'No', notebook_path: notebookPath } });
  const { page, made } = ui;
  made.state.afterTrigger = () => {
    made.state.useCase = { ...HARNESS_USE_CASE, has_genie_code: 'N', generate_genie_code_instruction: 'Yes', notebook_path: notebookPath };
    made.state.jobsList = { jobs: [{ job_id: 7, created_time: 1, settings: { name: 'Inspire AI - Genie Code - 42' } }] };
    made.state.runsByJob = { 7: { runs: [{ run_id: 99, state: { life_cycle_state: 'RUNNING' }, run_page_url: runUrl }] } };
  };
  try {
    const nav = page.getByRole('navigation', { name: 'Use cases' });
    await nav.getByRole('region', { name: 'Ready' }).getByText('Notebook ready', { exact: true }).waitFor();
    await page.getByRole('button', { name: 'Start Use Case MVP with Genie' }).click();
    await onStep(page, 'Choose');
    await page.getByRole('radio', { name: new RegExp(`^${NOTEBOOK_MODE_LABEL}`) }).check();
    await next(page);
    await onStep(page, 'Data');
    await next(page);
    await onStep(page, 'Notebook');
    await page.getByRole('button', { name: 'Generate notebook' }).click();
    await page.getByRole('dialog').waitFor({ state: 'detached' });
    assert.equal(made.jobs.length, 1);
    await nav.getByRole('region', { name: 'Building' }).getByText('Notebook running', { exact: true }).waitFor({ timeout: 5000 });
    assert.equal(await nav.getByRole('region', { name: 'Ready' }).getByText('Notebook ready', { exact: true }).count(), 0, 'the rewritten notebook is no longer listed as ready');
    const panel = assetPanel(page, 'notebook');
    await panel.getByText('Notebook running', { exact: true }).waitFor({ timeout: 5000 });
    assert.equal(await panel.getByRole('link', { name: 'Open the notebook run' }).getAttribute('href'), runUrl);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Implement page groups every use case by its state, searches by name, id or domain, and starts an MVP from one with none', async () => {
  const useCases = [
    { ...HARNESS_USE_CASE, _domain: 'Retention' },
    { id: 'N01-U02', Name: 'Forecast demand', use_case: 'Forecast demand', _domain: 'Supply', statement: 'Plan stock a week ahead',
      primary_table: 'main.s.orders', tables_involved: 'main.s.orders' },
    { id: 'N02-U01', Name: 'Score suppliers', use_case: 'Score suppliers', _domain: 'Supply', has_genie_code: 'Y',
      notebook_path: '/Users/owner@example.com/inspire/Acme/N02-U01' },
  ];
  const ui = await openUi('implement', { ...STUDIO_STATE, useCases });
  const { page } = ui;
  const nav = page.getByRole('navigation', { name: 'Use cases' });
  const group = (name) => nav.getByRole('region', { name });
  const names = (name) => group(name).locator('button > div:first-child').allTextContents();
  const search = (text) => page.getByLabel('Search use cases').fill(text);
  try {
    await group('Ready').getByText('MVP ready', { exact: true }).waitFor();
    assert.deepEqual(await nav.locator('h2').allTextContents(), ['Ready (2)', 'Not built (1)']);
    assert.deepEqual(await names('Ready'), ['Predict churn', 'Score suppliers']);
    assert.deepEqual(await names('Not built'), ['Forecast demand']);
    await group('Ready').getByRole('button', { name: /Score suppliers/ }).getByText('Notebook ready', { exact: true }).waitFor();
    assert.equal(await group('Not built').locator('[data-implement-status]').count(), 0, 'a use case with nothing built has no label');
    await page.getByRole('heading', { name: 'Predict churn', exact: true }).waitFor();

    await search('supply');
    await group('Ready').getByText('Predict churn').waitFor({ state: 'detached' });
    assert.deepEqual(await names('Ready'), ['Score suppliers']);
    assert.deepEqual(await names('Not built'), ['Forecast demand']);
    await page.getByRole('heading', { name: 'Predict churn', exact: true }).waitFor();
    await search('N01-U02');
    await group('Ready').getByText('Score suppliers').waitFor({ state: 'detached' });
    assert.deepEqual(await names('Not built'), ['Forecast demand']);
    await search('nothing like this');
    await nav.getByText('No use case matches "nothing like this".').waitFor();
    await search('');

    await group('Not built').getByRole('button', { name: /Forecast demand/ }).click();
    await page.getByRole('heading', { name: 'Forecast demand', exact: true }).waitFor();
    await page.getByText('Not built yet.', { exact: false }).waitFor();
    assert.equal(await page.locator('[data-asset-tiles]').count(), 0);
    await page.getByRole('button', { name: 'Start Use Case MVP with Genie' }).click();
    await onStep(page, 'Choose');
    assert.equal(await page.getByRole('region', { name: 'Executive summary' }).locator('h3').innerText(), 'Forecast demand');
    await page.getByRole('button', { name: 'Close' }).click();
    await page.locator('[data-implement-overlay]').waitFor({ state: 'detached' });

    await group('Ready').getByRole('button', { name: /Score suppliers/ }).click();
    await page.getByRole('heading', { name: 'Score suppliers', exact: true }).waitFor();
    const panel = assetPanel(page, 'notebook');
    await panel.waitFor();
    assert.equal(await page.locator('[data-asset-tiles]').count(), 0, 'a notebook alone has no tiles');
    assert.equal(await panel.getByRole('link', { name: 'Open the notebook', exact: true }).getAttribute('href'),
      'https://workspace.example.com/#workspace/Workspace/Users/owner@example.com/inspire/Acme/N02-U01');
    await page.getByRole('button', { name: 'Start Use Case MVP with Genie' }).waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a card offers Start Use Case MVP with Genie until an MVP starts, then Open MVP, a notebook-only card adds Open notebook, and the status label is text, not a control', async () => {
  const ui = await openUi('card');
  const { page } = ui;
  const card = (id) => page.locator(`[data-card="${id}"]`);
  const buttons = async (id) => (await card(id).getByRole('button').allTextContents()).map((t) => t.trim());
  try {
    await card('running').getByText('MVP running', { exact: true }).waitFor();
    for (const [id, shown] of [['not-started', ['Start Use Case MVP with Genie']], ['running', ['Open MVP']], ['notebook', ['Start Use Case MVP with Genie']],
      ['uninstalled', ['Start Use Case MVP with Genie']]]) {
      assert.deepEqual(await buttons(id), shown, id);
    }
    const link = card('notebook').getByRole('link', { name: /Open notebook/ });
    assert.equal(await link.getAttribute('href'), 'https://workspace.example.com/#workspace/nb/notebook');
    assert.equal(await link.getAttribute('target'), '_blank');
    for (const id of ['not-started', 'running', 'uninstalled', 'no-session']) assert.equal(await card(id).getByRole('link').count(), 0, `${id} has no notebook link`);
    assert.equal(await card('not-started').locator('[data-implement-status]').count(), 0, 'nothing built, no label');
    assert.equal(await card('uninstalled').locator('[data-implement-status]').textContent(), 'MVP uninstalled');
    const label = card('notebook').locator('[data-implement-status]');
    assert.equal(await label.textContent(), 'Notebook ready');
    assert.equal(await label.evaluate((el) => el.tagName), 'SPAN');
    assert.equal(await card('no-session').getByRole('button').count(), 0, 'without a session and warehouse the card offers no start and no open');
    await card('no-session').getByText('MVP ready', { exact: true }).waitFor();
    await card('running').getByRole('button').click();
    await card('notebook').getByRole('button').click();
    await label.click();
    assert.equal(await page.getByLabel('Clicks').textContent(), 'open:running,start:notebook,card:notebook',
      'the buttons never toggle the card, and the label has no action of its own');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('each output drawer shows its asset live, the App drawer stops the App through Inspire, and the Dashboard drawer uninstalls it only once the use case id is typed', async () => {
  const mvpJob = { job_id: 77, settings: { tags: { dbx_inspire_ai_run_type: 'implement', dbx_inspire_ai_session_id: '42', dbx_inspire_ai_usecase_id: 'N01-U01' },
    schedule: { quartz_cron_expression: '0 0 6 * * ?', timezone_id: 'UTC', pause_status: 'UNPAUSED' } } };
  const ui = await openUi('implement', { ...STUDIO_STATE, job: mvpJob, spacesOk: true, alertsOk: true,
    responses: { 'POST /api/2.0/apps/churn-desk/stop': [{}] } });
  const { page, made } = ui;
  try {
    await showView(page, 'app');
    await assetPanel(page, 'app').getByText('Running', { exact: true }).waitFor();
    await showView(page, 'job');
    const job = page.getByRole('region', { name: 'Build and job' }).locator('[data-control="job"]');
    await job.getByText('Scheduled: every day at 06:00 (UTC)').waitFor();
    assert.equal(await viewOf(page, 'job').locator('[data-asset-panel]').count(), 0, 'the outputs live in their own drawers');
    const kinds = {};
    for (const id of ['app', 'dashboard', 'alert', 'genie_space']) {
      await showView(page, id);
      kinds[id] = await assetPanel(page, id).getAttribute('data-tile-kind');
      assert.equal(await assetPanel(page, id).getAttribute('data-control'), id);
    }
    assert.deepEqual(kinds, { app: 'live', dashboard: 'live', alert: 'live', genie_space: 'live' });
    await showView(page, 'dashboard');
    await assetPanel(page, 'dashboard').getByText('Published', { exact: true }).waitFor();
    await showView(page, 'genie_space');
    assert.equal(await assetPanel(page, 'genie_space').getByRole('button', { name: /Stop|Start|Publish/ }).count(), 0,
      'a Genie Agent has nothing to stop or start');

    await showView(page, 'app');
    await assetPanel(page, 'app').getByRole('button', { name: 'Stop the App' }).click();
    await until(() => made.fetches.some((f) => f.path === '/api/2.0/apps/churn-desk/stop' && f.opts.method === 'POST'), 'the App stop call');
    await until(() => made.sqlCalls.some((c) => String(c.sql).startsWith('INSERT INTO `main`.`inspire`.`__inspire_control_log`')), 'the audit row');
    assert.equal(made.jobs.length, 0, 'stopping the App starts no Inspire run');

    await showView(page, 'dashboard');
    await assetPanel(page, 'dashboard').getByRole('button', { name: 'Uninstall', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Uninstall the Dashboard' });
    const confirm = dialog.getByRole('button', { name: 'Uninstall', exact: true });
    assert.equal(await confirm.isDisabled(), true);
    await dialog.getByText('You can add it back from its tile.', { exact: false }).waitFor();
    assert.equal(await dialog.getByText('Edit tab', { exact: false }).count(), 0, 'the dialog points at a button that exists');
    await dialog.getByLabel('Type the use case id to confirm').fill('n01-u01');
    assert.equal(await confirm.isDisabled(), true, 'the id must match exactly');
    await dialog.getByLabel('Type the use case id to confirm').fill('N01-U01');
    await confirm.click();
    await until(() => made.jobs.length === 1, 'the implement run that deletes the dashboard');
    const spec = submittedSpec(made);
    assert.deepEqual([spec.outputs.dashboard, spec.outputs.genie_space, spec.outputs.app, spec.outputs.alert], [false, true, true, true]);
    assert.deepEqual(spec.removed_outputs, { dashboard: 'delete' });
    assert.equal(made.jobs[0].params['15_operation'], 'Implement Use Cases');
    await dialog.waitFor({ state: 'detached' });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the job row in the Job drawer shows the share of records the built version holds back to measure impact', async () => {
  const mvpJob = { job_id: 77, settings: { tags: { dbx_inspire_ai_run_type: 'implement', dbx_inspire_ai_session_id: '42', dbx_inspire_ai_usecase_id: 'N01-U01' },
    schedule: { quartz_cron_expression: '0 0 6 * * ?', timezone_id: 'UTC', pause_status: 'UNPAUSED' } } };
  const held = built({ spec_json: JSON.stringify({ ...builtSpec(), holdout: { enabled: true, share: 0.15 } }) });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [held], job: mvpJob, spacesOk: true, alertsOk: true });
  const { page } = ui;
  try {
    await showView(page, 'job');
    const job = page.getByRole('region', { name: 'Build and job' }).locator('[data-control="job"]');
    await job.getByText('Scheduled: every day at 06:00 (UTC). Holds back 15% of the records to measure impact', { exact: true }).waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('while its status loads, the Build page shows the built version from the rail, never an empty one', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const ui = await openUi('implement', { ...STUDIO_STATE, hold: { '/status': held, '/live': held } });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await viewOf(page, 'build').waitFor();
    assert.equal(await page.locator('[data-mvp-panel]').count(), 0, 'the built version from the rail opens on Build progress, no drawer');
    const kinds = {};
    let added = 0;
    for (const id of ['app', 'dashboard', 'alert', 'genie_space']) {
      await showView(page, id);
      kinds[id] = await assetPanel(page, id).getAttribute('data-tile-kind');
      added += await viewOf(page, id).getByRole('button', { name: /^Add the / }).count();
    }
    assert.deepEqual(kinds, { app: 'checking', dashboard: 'checking', alert: 'checking', genie_space: 'checking' }, 'every built output reads its live status');
    assert.equal(added, 0, 'no built output is offered as missing');
    await page.locator('[data-asset-facts="genie_space"]').getByText('Inspire checked the Genie Agent with: Which customers should we call first?').waitFor();
    assert.equal(await page.getByRole('progressbar', { name: 'Build progress' }).count(), 0, 'a ready version shows no progress bar, so it never reads 0%');
    assert.equal(await page.locator('[data-progress-percent]').count(), 0);
    assert.equal(await page.locator('[data-stage-state="waiting"]').count(), 0, 'no stage reads not started');
    await showView(page, 'job');
    assert.equal(await historyToggle(page).innerText().then((t) => t.includes('Loading…')), true, 'the History header waits for the counts');
    await openHistory(page);
    await page.getByText('Loading the versions and job runs…').waitFor();
    assert.equal(await page.getByText('This use case has no job yet.').count(), 0, 'loading is not read as no job');
    release();
    await page.getByText(/^v1 · /).waitFor();
    assert.equal(await page.getByText('Loading the versions and job runs…').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    release();
    await ui.close();
  }
});

test('each output the version lacks shows faded with its name and Add opens Edit on Delivery, except the Alert, which adds alerts in its drawer', async () => {
  const spec = builtSpec();
  const dashboardOnly = built({ spec_json: JSON.stringify({ ...spec, outputs: { ...spec.outputs, genie_space: false, app: false, alert: false } }),
    genie_space_id: null, genie_space_url: null, app_name: null, app_url: null, alert_id: null, alert_url: null });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [dashboardOnly] });
  const { page } = ui;
  try {
    await page.locator('[data-asset-tile="dashboard"][data-tile-kind="live"]').waitFor({ timeout: 15000 });
    assert.equal(await tile(page, 'dashboard').getByRole('button', { name: /^Add the / }).count(), 0, 'the output it has is not offered');
    const offered = {};
    const faded = {};
    for (const [id, label] of [['app', 'App'], ['alert', 'Alerts'], ['genie_space', 'Genie Agent']]) {
      const off = tile(page, id);
      await off.locator('[data-tile-state]').getByText('Not in this MVP', { exact: true }).waitFor();
      faded[id] = [await off.getAttribute('data-tile-kind'), /border-dashed/.test(await off.getAttribute('class'))];
      assert.equal(await off.locator('[data-tile-versions]').count(), 0, `${id}: nothing to version before it is built`);
      assert.equal(await off.locator('[data-tile-open], [data-tile-open-button]').count(), 0, `${id}: nothing to open before it is built`);
      offered[id] = await off.getByRole('button', { name: `Add the ${label}`, exact: true }).count();
    }
    assert.deepEqual(faded, { app: ['off', true], alert: ['off', true], genie_space: ['off', true] }, 'items not in the MVP show faded');
    assert.deepEqual(offered, { app: 1, alert: 1, genie_space: 1 });
    await tile(page, 'alert').getByRole('button', { name: 'Add the Alerts', exact: true }).click();
    await viewOf(page, 'alert').getByRole('region', { name: 'Alerts of this use case' }).waitFor();
    assert.equal(await page.getByRole('dialog', { name: /^Start Use Case MVP|^Edit/ }).count(), 0, 'Add on the Alert opens its drawer, not the wizard');
    await closeAsset(page);
    await tile(page, 'genie_space').getByRole('button', { name: 'Add the Genie Agent', exact: true }).click();
    await onStep(page, 'Delivery');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the whole Implement page, the use case details and the wizard read at 4.5:1 or better in light and in dark', async () => {
  const ui = await openUi('implement', STUDIO_STATE);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await statusLoaded(page);
    await openHistory(page);
    await showView(page, 'app');
    await page.locator('[data-asset-panel="app"][data-tile-kind="live"]').waitFor({ timeout: 20000 });
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const mode = dark ? 'dark' : 'light';
      for (const id of VIEW_IDS) {
        await showView(page, id);
        await settled(page, viewSelector(id), { loaded: true });
        const shown = await lowContrast(page, ['body']);
        assert.ok(shown.checked >= 40, `${mode}: measured ${shown.checked} text elements with the ${id} view`);
        assert.deepEqual(shown.low, [], `${mode} Implement page with the ${id} view`);
      }
      await showView(page, 'build');
      await openFeatures(page);
      const features = await lowContrast(page, ['[data-vibe-features-dialog]']);
      assert.ok(features.checked >= 5, `${mode}: measured ${features.checked} Vibe/Add/Remove Features elements`);
      assert.deepEqual(features.low, [], `${mode} Vibe/Add/Remove Features`);
      await closeAsset(page);
      await page.getByRole('button', { name: 'Use case details' }).click();
      const details = await lowContrast(page, ['[role="dialog"]']);
      assert.ok(details.checked >= 15, `${mode}: measured ${details.checked} detail elements`);
      assert.deepEqual(details.low, [], `${mode} use case details`);
      await page.keyboard.press('Escape');
      await page.getByRole('dialog').waitFor({ state: 'detached' });
      await openSettings(page);
      const wizard = await lowContrast(page, ['[role="dialog"]']);
      assert.ok(wizard.checked >= 15, `${mode}: measured ${wizard.checked} wizard elements`);
      assert.deepEqual(wizard.low, [], `${mode} wizard`);
      await page.getByRole('dialog').getByRole('button', { name: 'Close' }).first().click();
      await page.getByRole('dialog').waitFor({ state: 'detached' });
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('every asset drawer, Build progress and the Uninstall dialog read at 4.5:1 or better in light and in dark', async () => {
  const mvpJob = { job_id: 77, settings: { tags: { dbx_inspire_ai_run_type: 'implement', dbx_inspire_ai_session_id: '42', dbx_inspire_ai_usecase_id: 'N01-U01' },
    schedule: { quartz_cron_expression: '0 0 6 * * ?', timezone_id: 'UTC', pause_status: 'UNPAUSED' } } };
  const note = "Ask Genie is off because this use case's Genie Agent is not ready: the space has no tables";
  const assets = JSON.parse(built().asset_status);
  const warned = built({ status: 'ready_with_warnings', status_message: `App: ${note}`,
    asset_status: JSON.stringify({ ...assets, app: { ...assets.app, warnings: [note] } }) });
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [warned], job: mvpJob, spacesOk: true, alertsOk: true,
    controlLog: [{ asset: 'app', asset_id: 'churn-desk', action: 'stop', result: 'done', message: 'Stop the App: done', acted_by: OWNER, acted_at: '2026-10-26T10:00:00.000Z' },
      { asset: 'dashboard', asset_id: 'd1', action: 'unpublish', result: 'failed', message: 'Unpublish the dashboard: failed', acted_by: OWNER, acted_at: '2026-10-26T09:00:00.000Z' }],
    responses: { 'GET /api/2.0/lakeview/dashboards/d1/published': [{ embed_credentials: true, revision_create_time: '2026-10-26T08:00:00.000Z' }] } });
  const { page } = ui;
  try {
    const app = assetPanel(page, 'app');
    await showView(page, 'app');
    await app.getByText('Running', { exact: true }).waitFor();
    await app.getByRole('list', { name: 'App warnings' }).getByText(note, { exact: true }).waitFor();
    const warnings = {};
    for (const id of VIEW_IDS) {
      await showView(page, id);
      warnings[id] = await viewOf(page, id).getByRole('list', { name: /warnings$/ }).count();
    }
    assert.deepEqual(warnings, { build: 0, app: 1, dashboard: 0, genie_space: 0, alert: 0, notebook: 0, job: 0 }, 'only the App ended with a warning, in its own drawer');
    await showView(page, 'job');
    await page.getByRole('list', { name: 'Recent control actions' }).waitFor();
    await showView(page, 'dashboard');
    const dashboard = assetPanel(page, 'dashboard');
    await dashboard.getByText('Shares its publisher’s access', { exact: true }).waitFor();
    await dashboard.getByRole('button', { name: 'Publish again' }).waitFor();
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const mode = dark ? 'dark' : 'light';
      let measured = 0;
      for (const id of VIEW_IDS) {
        await showView(page, id);
        await settled(page, viewSelector(id), { loaded: true });
        const shown = await lowContrast(page);
        assert.ok(shown.checked >= 1, `${mode}: measured ${shown.checked} text elements with the ${id} view`);
        assert.deepEqual(shown.low, [], `${mode} ${id} view`);
        measured += shown.checked;
      }
      assert.ok(measured >= 60, `${mode}: measured ${measured} text elements across the views`);
      await showView(page, 'dashboard');
      const plain = await lowContrast(page);
      await dashboard.getByRole('button', { name: 'Uninstall', exact: true }).click();
      const dialog = page.getByRole('dialog', { name: 'Uninstall the Dashboard' });
      await dialog.getByLabel('Type the use case id to confirm').fill('N01');
      const withDialog = await lowContrast(page);
      assert.ok(withDialog.checked > plain.checked, `${mode}: the dialog was measured`);
      assert.deepEqual(withDialog.low, [], `${mode} Uninstall dialog`);
      await dialog.getByLabel('Type the use case id to confirm').fill('N01-U01');
      const confirm = dialog.getByRole('button', { name: 'Uninstall', exact: true });
      assert.equal(await confirm.isEnabled(), true, 'the right id enables the confirm');
      const armed = await lowContrast(page);
      assert.ok(armed.checked > withDialog.checked, `${mode}: the enabled confirm was measured`);
      assert.deepEqual(armed.low, [], `${mode} armed Uninstall dialog`);
      await dialog.getByRole('button', { name: 'Cancel' }).click();
      await dialog.waitFor({ state: 'detached' });
    }
    await showView(page, 'job');
    const times = await page.getByRole('list', { name: 'Recent control actions' }).innerText();
    assert.doesNotMatch(times, /T10:00|\.000Z/, 'times read as a local date and time');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
