import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, dataToResults, openAdvanced, openAsset, openSettings, openUi, onStep, startMvp, until, goToStep, toSummary } from './uiSupport.mjs';
import { STUDIO_STATE } from './implementFixtures.js';

const OWNER = ['owner', 'example.com'].join('@');
const USE_CASE = {
  id: 'N01-U01',
  use_case: 'Predict which customers will churn next month',
  Name: 'Predict which customers will churn next month',
  statement: 'Cut churn among loyal customers',
  primary_table: 'main.s.orders',
  tables_involved: 'main.s.orders',
  genie_instruction: '## Parameters\n| top_k | text | 25 | Top K |\n| act_now_share | text | 0.05 | Act now share |\n',
  elite_assessment: JSON.stringify({ decision: 'Which customers get a retention call this week', entity_key_column: 'main.s.orders.order_id' }),
  data_evidence: JSON.stringify({ tables: { 'main.s.orders': { rows: 12400, sampled: false } } }),
};
const COLUMNS = [
  { column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 },
  { column_name: 'customer_id', data_type: 'STRING', ordinal_position: 2 },
  { column_name: 'order_date', data_type: 'DATE', ordinal_position: 3 },
  { column_name: 'amount', data_type: 'DOUBLE', ordinal_position: 4 },
];

test.after(closeBrowser);

const next = (page) => page.getByRole('button', { name: 'Next' }).click();

test('the wizard groups the rows by the use case\'s subject, asks no team capacity (the App\'s Settings holds it), and keeps the weekly email on until it is turned off', async () => {
  const ui = await openUi('wizard', { me: { userName: OWNER, displayName: 'Owner' }, useCase: USE_CASE, columns: COLUMNS });
  const { page, pageErrors } = ui;
  const sent = [];
  page.on('request', (r) => {
    if (r.method() === 'POST' && r.url().includes('/api/inspire/implement/submit')) sent.push(JSON.parse(r.postData()));
  });
  try {
    await goToStep(page, 'Data');
    await openAdvanced(page);
    const grain = page.getByRole('region', { name: 'What one row means' });
    await grain.getByText('This use case is about customers, but one row of the result would be one order (main.s.orders.order_id). '
      + 'Group the rows by customer_id so one row is one customer.').waitFor();
    assert.equal(await grain.getAttribute('data-grain'), 'mismatch');
    await grain.getByRole('button', { name: 'Group by customer_id' }).click();
    await grain.getByText('One row of the result is one customer (main.s.orders.customer_id).').waitFor();
    assert.equal(await grain.getByRole('combobox', { name: 'Entity key' }).inputValue(), 'main.s.orders.customer_id');
    await dataToResults(page);
    assert.equal(await page.getByRole('group', { name: 'Team capacity' }).count(), 0, 'the wizard asks no team capacity (must-exclude)');
    assert.equal(await page.getByLabel('Rows the team can act on each run').count(), 0);
    await goToStep(page, 'What to build');
    await page.getByRole('checkbox', { name: /^Alert/ }).check();
    const digest = page.getByRole('checkbox', { name: /^Send a weekly value email to the alert recipients/ });
    assert.equal(await digest.isChecked(), true, 'the email is on once the alert has a recipient');
    await digest.uncheck();
    const toggle = page.getByRole('button', { name: /^(Change|Close) delivery settings$/ });
    if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    const clears = page.getByRole('checkbox', { name: /^Email again when it clears/ });
    assert.equal(await clears.isChecked(), true, 'the email when it clears is on once the alert has a recipient');
    await clears.uncheck();
    const submitted = page.waitForRequest((r) => r.method() === 'POST' && r.url().includes('/api/inspire/implement/submit'));
    await startMvp(page);
    const { spec } = JSON.parse((await submitted).postData());
    assert.equal(sent.length, 1);
    assert.equal(spec.capacity, undefined, 'a new MVP sends no cap; the App\u2019s Settings sets it');
    assert.equal(spec.data.column_roles.entity_id, 'main.s.orders.customer_id');
    assert.equal(spec.outputs.alert_digest, false);
    assert.equal(spec.outputs.alert_notify_on_ok, false);
    await until(() => ui.made.sqlCalls.some((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec')), 'the saved spec');
    const saved = JSON.parse(ui.made.sqlCalls.find((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
      .parameters.find((p) => p.name === 'spec').value);
    assert.deepEqual([saved.capacity, saved.outputs.alert_digest, saved.outputs.alert_notify_on_ok, saved.data.column_roles.entity_id],
      [undefined, false, false, 'main.s.orders.customer_id'], 'the backend keeps what the person chose, so the agent builds it');
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

const holder = (uc, name, extra) => ({
  session_id: '42', use_case_id: uc, spec_version: 1, status: 'ready', updated_at: '2026-10-26T00:00:00Z', asset_status: null,
  spec_json: JSON.stringify({ use_case_id: uc, use_case_name: name, outputs: { app: true } }), dashboard_id: null, genie_space_id: null, app_name: null, ...extra,
});
const TAKE_OUT = "Take this use case's part out of churn-desk; it stays for Forecast demand";

test('removing an App another use case shares offers to take this use case\'s part out of it, on the radio and in the plan, instead of deleting it', async () => {
  const ui = await openUi('wizard', {
    ...STUDIO_STATE,
    me: { userName: OWNER, displayName: 'Owner' },
    registry: [holder('N01-U01', 'Predict churn', { app_name: 'churn-desk', dashboard_id: 'd1', genie_space_id: 'g1' }),
      holder('N01-U02', 'Forecast demand', { app_name: 'churn-desk' })],
  });
  const { page, pageErrors } = ui;
  try {
    await goToStep(page, 'Data');
    await dataToResults(page);
    await goToStep(page, 'What to build');
    await page.getByRole('checkbox', { name: /^App / }).uncheck();
    const tile = page.locator('[data-output="app"]');
    await tile.getByText('This use case already has an App. What should happen to it?').waitFor();
    await tile.getByRole('radio', { name: 'Delete it' }).check();
    const takeOut = tile.getByRole('radio', { name: TAKE_OUT });
    await takeOut.waitFor();
    assert.equal(await takeOut.isChecked(), true, 'the choice the person made stays, only its words change');
    assert.equal(await tile.getByRole('radio', { name: 'Delete it' }).count(), 0);
    const plan = async () => {
      await toSummary(page);
      const toggle = page.getByRole('button', { name: /^(Change|Close) checks and plan$/ });
      if (await toggle.getAttribute('aria-expanded') !== 'true') await toggle.click();
    };
    await plan();
    await page.getByText(TAKE_OUT, { exact: true }).and(page.locator('p')).waitFor();
    assert.equal(await page.getByText('Deletes: App', { exact: true }).count(), 0, 'the plan never says it deletes a shared App');
    await goToStep(page, 'What to build');
    await tile.getByRole('radio', { name: 'Keep it unmanaged' }).check();
    assert.equal(await tile.getByRole('radio', { name: TAKE_OUT }).count(), 1, 'the radio keeps the last check while the plan no longer deletes it');
    await plan();
    await page.getByText('Leaves in place, no longer managed: App', { exact: true }).waitFor();
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Open all settings on the Build page hands the wizard its live check, so a shared App reads take-out before anything is picked', async () => {
  const ui = await openUi('implement', {
    ...STUDIO_STATE,
    me: { userName: OWNER, displayName: 'Owner' },
    registry: [holder('N01-U01', 'Predict churn', { app_name: 'churn-desk', dashboard_id: 'd1', genie_space_id: 'g1' }),
      holder('N01-U02', 'Forecast demand', { app_name: 'churn-desk' })],
  });
  const { page, pageErrors } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await page.locator('[data-asset-tile="app"] [data-tile-versions]').waitFor({ timeout: 15000 });
    await (await openAsset(page, 'app')).getByRole('button', { name: 'Remove from churn-desk' }).waitFor({ timeout: 15000 });
    await openSettings(page);
    await goToStep(page, 'What to build');
    await page.getByRole('checkbox', { name: /^App / }).uncheck();
    const tile = page.locator('[data-output="app"]');
    await tile.getByText('This use case already has an App. What should happen to it?').waitFor();
    assert.equal(await tile.getByRole('radio', { name: TAKE_OUT }).count(), 1, 'the live check already knows Forecast demand holds the App');
    assert.equal(await tile.getByRole('radio', { name: TAKE_OUT }).isChecked(), false, 'nothing is picked for the person');
    assert.equal(await tile.getByRole('radio', { name: 'Delete it' }).count(), 0);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});
