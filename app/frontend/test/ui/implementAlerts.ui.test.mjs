import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { built, builtSpec } from './implementFixtures.js';
import { closeBrowser, openUi } from './uiSupport.mjs';

const require = createRequire(import.meta.url);
const { AlertsWorkspace, RULES_MISSING, realAlerts } = require('../../../backend/test/support/alertsWorkspace.js');

const OWNER = ['owner', 'example.com'].join('@');
const SAM = ['sam.ray', 'example.com'].join('@');
const PERSON = 'person-token';
const MVP = '/Workspace/Users/someone/acme/session_42/Customer/N01-U01/mvp';
const FOLDER = `${MVP}/alerts/n01_u01`;
const skip = RULES_MISSING || false;

test.after(closeBrowser);

function quoted(table) {
  return table.split('.').map((part) => `\`${part}\``).join('.');
}

function scene({ alert = false } = {}) {
  const spec = builtSpec();
  const outputs = { ...spec.outputs, app: false, app_name: '', alert };
  const table = spec.config.result_table;
  const assets = JSON.parse(built().asset_status);
  if (!alert) delete assets.alert;
  delete assets.app;
  const row = built({
    spec_json: JSON.stringify({ ...spec, outputs }), app_name: null, app_url: null, notebook_path: `${MVP}/v1/N01-U01 Predict churn`,
    asset_status: JSON.stringify(assets), ...(alert ? {} : { alert_id: null, alert_url: null }),
  });
  const ws = new AlertsWorkspace({ users: [OWNER, SAM], tokens: { [PERSON]: OWNER, tok: 'inspire-sp' } });
  if (alert) ws.alerts.a1 = { id: 'a1', display_name: 'Churn over 25', lifecycle_state: 'ACTIVE', evaluation: { state: 'TRIGGERED', notification: { notify_on_ok: true } } };
  const columns = [['record_key', 'STRING'], ['entity_id', 'STRING'], ['priority_tier', 'STRING'], ['rank', 'INT'], ['value_at_stake', 'DOUBLE'],
    ['run_id', 'STRING'], ['as_of_date', 'DATE'], ['valid_from', 'TIMESTAMP'], ['valid_to', 'TIMESTAMP'], ['is_current', 'BOOLEAN'],
    ['change_source', 'STRING'], ['changed_by', 'STRING']];
  const schema = { manifest: { schema: { columns: columns.map(([name, kind]) => ({ name, type_name: kind, type_text: kind })) } }, result: { data_array: [] } };
  return {
    ws,
    state: {
      history: [row], forwardedToken: PERSON, forwardedEmail: OWNER, useCaseAlerts: realAlerts(), workspace: (call) => ws.handle(call),
      statements: {
        [`SELECT * FROM ${quoted(table)} LIMIT 0`]: schema,
        'SELECT DISTINCT CAST(`priority_tier`': { manifest: { schema: { columns: [{ name: 'v', type_name: 'STRING' }] } },
          result: { data_array: [['Act now'], ['Monitor'], ['Review']] } },
        'WITH latest AS': { manifest: { schema: { columns: [{ name: 'watched_value', type_name: 'LONG' }] } }, result: { data_array: [['7']] } },
      },
    },
  };
}

async function openAlertDrawer(state) {
  const ui = await openUi('implement', state);
  try {
    const open = ui.page.locator('[data-asset-tile="alert"]').locator('[data-tile-versions], [data-tile-add]').first();
    await open.waitFor({ timeout: 20000 });
    await open.click();
    await ui.page.locator('[data-mvp-panel="alert"]').waitFor({ timeout: 15000 });
  } catch (e) {
    await ui.close();
    throw e;
  }
  return ui;
}

const alertsPanel = (page) => page.getByRole('region', { name: 'Alerts of this use case' });

test('Add alert in the Alert drawer opens the alert form on the page, never the MVP wizard', { skip }, async () => {
  const { state } = scene();
  const ui = await openAlertDrawer(state);
  const { page } = ui;
  try {
    const panel = page.locator('[data-mvp-panel="alert"]');
    await panel.getByRole('button', { name: /^Add (the )?alert$/i }).first().click();
    await page.getByRole('form', { name: 'New alert' }).waitFor({ timeout: 15000 });
    assert.equal(await page.getByRole('dialog', { name: /^Start Use Case MVP with Genie/ }).count(), 0, 'the wizard did not open');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a person sets up an alert on the tiers to act on, it is created in Databricks as them, and they pause, resume, edit and delete it on the tab', { skip }, async () => {
  const { state, ws } = scene();
  const ui = await openAlertDrawer(state);
  const { page, made } = ui;
  try {
    const panel = alertsPanel(page);
    await panel.getByText('No alerts on this use case yet.', { exact: true }).waitFor({ timeout: 20000 });
    await panel.getByRole('button', { name: 'Add alert', exact: true }).click();
    const form = page.getByRole('form', { name: 'New alert' });
    assert.equal(await form.getByLabel('What to watch').inputValue(), 'records');
    assert.equal(await form.getByLabel('Email addresses').inputValue(), OWNER, 'the signed-in person by default');
    await form.getByRole('checkbox', { name: 'Act now' }).check();
    await form.getByLabel('Number', { exact: true }).fill('-2');
    await form.getByRole('button', { name: 'Set up the alert' }).click();
    await form.getByRole('alert').getByText('Records on the list counts rows, so it is never below 0; set a threshold of 0 or more').waitFor();
    assert.deepEqual(ws.writes(), [], 'a refused alert saves nothing');
    await form.getByLabel('Number', { exact: true }).fill('5');
    await form.getByRole('button', { name: 'Check the value now' }).click();
    await form.getByText('Now: 7. It would send an email.', { exact: true }).waitFor();
    await form.getByLabel('Email addresses').fill(`${OWNER}, ${SAM}`);
    await form.getByLabel('Check it').selectOption('hourly');
    const clears = form.getByRole('checkbox', { name: 'Email again when it clears' });
    assert.equal(await clears.isChecked(), true, 'one more email when it clears unless the person turns it off');
    await clears.uncheck();
    await form.getByRole('button', { name: 'Set up the alert' }).click();
    const row = panel.locator('[data-alert-row]').filter({ hasText: 'Records on the list is at or above 5' });
    await row.waitFor({ timeout: 20000 });
    await row.getByText('Tier: Act now', { exact: true }).waitFor();
    await row.getByText(`Set up by ${OWNER}`, { exact: true }).waitFor();
    await row.getByText(/No email when it clears/).waitFor();
    const [posted] = ws.writes();
    assert.deepEqual([posted.method, posted.token, posted.body.parent_path], ['POST', PERSON, FOLDER], 'created with the person token');
    assert.equal(posted.body.schedule.quartz_cron_schedule, '0 0 * * * ?');
    assert.deepEqual(posted.body.evaluation.notification.subscriptions, [{ user_email: OWNER }, { user_email: SAM }]);
    assert.equal(posted.body.evaluation.notification.notify_on_ok, false);
    assert.ok(made.sqlCalls.some((c) => c.sql.startsWith('WITH latest AS') && c.token === PERSON), 'the check ran as the person');
    await row.getByRole('button', { name: 'Pause' }).click();
    await row.getByText('Paused', { exact: true }).waitFor();
    await row.getByRole('button', { name: 'Resume' }).click();
    await row.getByRole('button', { name: 'Pause' }).waitFor();
    await row.getByRole('button', { name: 'Edit' }).click();
    const edit = page.getByRole('form', { name: 'Change the alert' });
    assert.equal(await edit.getByLabel('Number', { exact: true }).inputValue(), '5');
    assert.equal(await edit.getByRole('checkbox', { name: 'Email again when it clears' }).isChecked(), false, 'the edit form shows what the person chose');
    await edit.getByLabel('Number', { exact: true }).fill('8');
    await edit.getByRole('button', { name: 'Save the alert' }).click();
    await panel.locator('[data-alert-row]').filter({ hasText: 'is at or above 8' }).waitFor();
    assert.deepEqual(ws.writes().map((c) => [c.method, c.token]), [['POST', PERSON], ['PATCH', PERSON], ['PATCH', PERSON], ['PATCH', PERSON]]);
    assert.equal(ws.writes().pop().body.evaluation.notification.notify_on_ok, false, 'the edit keeps no email when it clears');
    const changed = panel.locator('[data-alert-row]').first();
    await changed.getByRole('button', { name: 'Delete' }).click();
    await changed.getByRole('button', { name: 'Delete the alert' }).click();
    await panel.getByText('No alerts on this use case yet.', { exact: true }).waitFor();
    const last = ws.writes().pop();
    assert.deepEqual([last.method, last.token], ['DELETE', PERSON]);
    const text = await panel.textContent();
    assert.doesNotMatch(text, /\u2014|\u2013/);
    assert.deepEqual(ui.pageErrors.filter((e) => !/status of 400 \(Bad Request\)/.test(e)), [], 'only the refused threshold answered 400');
  } finally {
    await ui.close();
  }
});

test('the alert Genie built with the MVP stays listed, labeled as built by Genie, next to the alerts people set up', { skip }, async () => {
  const { state } = scene({ alert: true });
  const ui = await openAlertDrawer(state);
  const { page } = ui;
  try {
    const builtRow = alertsPanel(page).locator('[data-alert-built]');
    await builtRow.waitFor({ timeout: 20000 });
    await builtRow.getByText('Built by Genie', { exact: true }).waitFor();
    await builtRow.getByText('Churn over 25', { exact: true }).waitFor();
    await builtRow.getByText('Firing', { exact: true }).waitFor();
    await builtRow.getByText('Emails again when it clears', { exact: true }).waitFor();
    assert.equal(await builtRow.getByRole('link', { name: 'Open in Databricks' }).getAttribute('href'), 'https://workspace.example.com/sql/alerts-v2/a1');
    assert.equal(await builtRow.getByRole('button').count(), 0, 'Genie rebuilds it with the MVP, so the tab does not change it');
    assert.equal(await page.locator('[data-asset-panel="alert"]').count(), 1, 'the built alert keeps its output panel');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('without the forwarded sign-in the tab says why it cannot add an alert and offers no button', { skip }, async () => {
  const { state } = scene();
  const ui = await openAlertDrawer({ ...state, forwardedToken: '' });
  const { page } = ui;
  try {
    await alertsPanel(page).getByText('Inspire saves alerts as you, and this request carries no sign-in of yours.', { exact: false }).waitFor({ timeout: 20000 });
    assert.equal(await alertsPanel(page).getByRole('button', { name: 'Add alert', exact: true }).count(), 0);
    assert.deepEqual(ui.pageErrors.filter((e) => !/401/.test(e)), []);
  } finally {
    await ui.close();
  }
});
