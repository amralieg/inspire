import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_STATE, built } from './implementFixtures.js';
import { closeBrowser, expandBuild, onStep, openAsset, openUi, goToStep } from './uiSupport.mjs';

test.after(closeBrowser);

const NOTE = 'this page uses the look and access of the App inspire-hub (style a)';
const stepRow = (phase, status, time) => ({
  stage_name: 'Implement Use Cases', step_id: phase.length, step_name: `Inspire is working on ${phase.toLowerCase()}`, sub_step_name: 'Completed: n01-u01',
  status, last_updated: `2026-10-26T${time}.000Z`, result_json: JSON.stringify({ use_case_id: 'N01-U01', phase }),
});
const withApp = (app) => JSON.stringify({ ...JSON.parse(built().asset_status), app });
const STEPS = [stepRow('App', 'started', '10:02:00'), stepRow('App', 'ended_success', '10:09:00'), stepRow('Done', 'ended_success', '10:09:30')];

test('a build whose App ended with an info note only reads Ready and green, with the note in neutral text under the steps and on the App', async () => {
  const history = [built({ asset_status: withApp({ state: 'ready', health: 'running', spec_version: 1, notes: [NOTE] }) })];
  const ui = await openUi('implement', { ...STUDIO_STATE, history, steps: STEPS });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    await page.locator('[data-mvp-progress] p', { hasText: /^Ready$/ }).first().waitFor();
    const note = page.locator('[data-mvp-progress] [data-stage-notes] [data-stage-note="App"]');
    await note.waitFor();
    assert.equal(await note.textContent(), `App: ${NOTE}`);
    assert.match(await note.evaluate((el) => el.closest('ul').className), /text-text-secondary/, 'the note reads in neutral text');
    assert.equal(await page.locator('[data-mvp-progress] [data-stage="App"]').getAttribute('data-stage-state'), 'done');
    assert.equal(await page.locator('[data-mvp-progress] [data-stage-state="warning"]').count(), 0, 'no step is yellow');
    assert.equal(await page.locator('[data-mvp-progress] p', { hasText: /^Warnings$/ }).count(), 0);
    await openAsset(page, 'app');
    const told = page.locator('[data-asset-panel="app"] [data-built-note]');
    await told.waitFor();
    assert.equal(await told.textContent(), NOTE);
    assert.equal(await page.locator('[data-asset-panel="app"] ul[aria-label="App warnings"]').count(), 0, 'a note is not listed as a warning');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('App look turns the trend chart off with one line when the input tables carry no date, and keeps it when they do', async () => {
  const open = async (columns) => {
    const ui = await openUi('wizard', { me: { userName: 'owner@example.com', displayName: 'Owner' }, columns });
    const { page } = ui;
    await onStep(page, 'Delivery consumption');
    await goToStep(page, 'App access');
    await goToStep(page, 'App look');
    const look = page.getByRole('region', { name: 'App look' });
    await look.getByRole('tablist', { name: 'App look sections' }).getByRole('tab', { name: 'Charts', exact: true }).click();
    return { ui, look };
  };
  const undated = await open([{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }]);
  try {
    const { look } = undated;
    await look.locator('[data-app-sample][data-sample-charts="bars,pareto"]').waitFor();
    const trend = look.locator('[data-chart-kind="trend"] input');
    assert.deepEqual([await trend.isChecked(), await trend.isDisabled()], [false, true], 'a trend with no date cannot be picked');
    assert.equal(await look.locator('[data-chart-trend-off]').textContent(), 'Trend over time needs a date, and the input tables carry none.');
    await look.getByText("Inspire's pick: bars by segment and biggest first.", { exact: true }).waitFor();
    assert.deepEqual(undated.ui.pageErrors, []);
  } finally {
    await undated.ui.close();
  }
  const dated = await open([{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 },
    { column_name: 'order_date', data_type: 'DATE', ordinal_position: 2 }]);
  try {
    const { look } = dated;
    await look.locator('[data-app-sample][data-sample-charts="trend,bars,pareto"]').waitFor();
    assert.equal(await look.locator('[data-chart-trend-off]').count(), 0);
  } finally {
    await dated.ui.close();
  }
});

test('a business with an App for all its use cases joins it, cannot create a second one, and cannot name an App like it', async () => {
  const hubSpec = JSON.stringify({ use_case_id: 'N01-U02', use_case_name: 'Forecast demand', outputs: { app: true, app_access: 'sp', app_placement: 'business' } });
  const state = {
    me: { userName: 'owner@example.com', displayName: 'Owner' },
    useCase: { id: 'N01-U01', use_case: 'Predict churn', business_domain: 'Customer', primary_table: 'main.s.orders', tables_involved: 'main.s.orders', genie_instruction: '## Parameters\n| top_k | text | 25 | Top K |\n' },
    useCaseScope: [{ session_id: '42', use_case_id: 'N01-U02', business: 'Acme', domain: 'Finance' }],
    registry: [{ session_id: '42', use_case_id: 'N01-U02', spec_version: 1, status: 'ready', updated_at: '2026-10-26T00:00:00Z', asset_status: null,
      spec_json: hubSpec, dashboard_id: null, genie_space_id: null, app_name: 'inspire-hub-acme' }],
    appsByName: { 'inspire-hub-acme': { name: 'inspire-hub-acme', description: 'Inspire use case N01-U02 (session 42): Forecast demand' } },
  };
  const ui = await openUi('wizard', state);
  const { page } = ui;
  const next = () => page.getByRole('button', { name: 'Next' }).click();
  try {
    await onStep(page, 'Delivery consumption');
    await page.getByRole('checkbox', { name: /^App / }).check();
    await goToStep(page, 'App placement');
    const place = page.getByRole('region', { name: 'App placement' });
    const hub = place.locator('[data-app-target="inspire-hub-acme"] input[type="radio"]');
    await hub.waitFor();
    assert.equal(await hub.isChecked(), true, 'the use case joins the App of all use cases of its business by default');
    await place.getByRole('radio', { name: /^Create a new App/ }).check();
    const policy = place.getByRole('radiogroup', { name: 'How Inspire organizes Apps' });
    const all = policy.getByRole('radio', { name: /^One App for all use cases/ });
    assert.deepEqual([await all.isDisabled(), await all.isChecked()], [true, false], 'a second App for all use cases cannot be created');
    assert.equal(await policy.locator('[data-placement-off="business"]').textContent(),
      'inspire-hub-acme is the App for all use cases of Acme: add this use case to it');
    await policy.getByRole('radio', { name: /^One App per use case/ }).check();
    await page.getByLabel('App name').fill('inspire-hub-acme-03');
    await next();
    await page.locator('[role="alert"] p', { hasText: /^Names starting inspire-hub- are for the shared business App\. Pick another App name/ }).first().waitFor();
    await onStep(page, 'App placement');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a build that ended with a real warning still reads Warnings with a yellow last step', async () => {
  const warned = [STEPS[0], STEPS[1], stepRow('Done', 'ended_warning', '10:09:30')];
  const history = [built({ status: 'ready_with_warnings', status_message: 'App: the App churn-desk was not tagged. Build the App again to tag it',
    asset_status: withApp({ state: 'ready', health: 'running', spec_version: 1, warnings: ['the App churn-desk was not tagged. Build the App again to tag it'] }) })];
  const ui = await openUi('implement', { ...STUDIO_STATE, history, steps: warned });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    await page.locator('[data-mvp-progress] p', { hasText: /^Warnings$/ }).first().waitFor();
    assert.equal(await page.locator('[data-mvp-progress] [data-stage="Finish"]').getAttribute('data-stage-state'), 'warning');
    assert.equal(await page.locator('[data-stage-notes]').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
