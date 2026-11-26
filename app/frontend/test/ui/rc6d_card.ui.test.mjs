import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';
import { HARNESS_INSPIRE_URL, HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID } from './implementFixtures.js';
import { closeBrowser, lowContrast, openAsset, openUi, setDark, until } from './uiSupport.mjs';

const OWNER = ['owner', 'example.com'].join('@');
const START = 'Start Use Case MVP with Genie';

test.after(closeBrowser);

const builtSpec = (top = {}) => {
  const spec = defaultSpecFromUseCase(HARNESS_USE_CASE, { warehouseId: HARNESS_SETTINGS.warehouseId, inspireDatabase: HARNESS_SETTINGS.inspireDatabase, sessionId: HARNESS_SESSION_ID, owner: OWNER });
  return { ...spec, ...top, outputs: { ...spec.outputs, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp', alert: true, alert_recipients: [OWNER],
    inspire_url: HARNESS_INSPIRE_URL } };
};
const ready = (version, extra = {}) => ({ state: 'ready', spec_version: version, ...extra });
const LIVE = { dashboard: ready(3, { snapshot: true }), genie_space: ready(3, { snapshot: true }), app: ready(3, { snapshot: true }), alert: ready(3) };

const versionRow = (version, { assets = LIVE, top = {}, ...extra } = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: version, status: 'ready', change_classes: version === 1 ? 'initial' : 'outputs', created_by: OWNER,
  updated_at: `2026-10-2${version}T04:00:00Z`, spec_json: JSON.stringify(builtSpec(top)), job_id: '77', last_preview_run_id: '9001', result_rows: '3',
  notebook_path: '/Users/owner@example.com/inspire/Acme_implemented/N01-U01',
  dashboard_id: 'd1', dashboard_url: 'https://workspace.example.com/dashboardsv3/d1/published',
  genie_space_id: 'g1', genie_space_url: 'https://workspace.example.com/genie/rooms/g1',
  app_name: 'churn-desk', app_url: 'https://churn-desk-1.aws.example.com',
  alert_id: 'a1', alert_url: 'https://workspace.example.com/sql/alerts-v2/a1',
  asset_status: JSON.stringify(assets),
  ...extra,
});

const GONE = { dashboard_id: null, dashboard_url: null, genie_space_id: null, genie_space_url: null, app_name: null, app_url: null, alert_id: null, alert_url: null,
  job_id: null, notebook_path: null, last_preview_run_id: null };
const uninstalledRow = (version) => versionRow(version, {
  ...GONE, status: 'uninstalled', change_classes: 'uninstall', top: { uninstall: true },
  status_message: "Dashboard: d1 also holds use case N02-U01, so Inspire did not delete it; this use case's part stays in it",
  assets: { dashboard: { state: 'deleted' }, genie_space: { state: 'deleted' }, app: { state: 'deleted' }, alert: { state: 'deleted' }, notebook: { state: 'deleted' }, kept: { state: 'kept', assets: [] } },
});

const HISTORY = [versionRow(3), versionRow(2), versionRow(1)];
const STATE = { history: HISTORY, appExists: true, app: { name: 'churn-desk', description: 'Inspire use case N01-U01 (session 42): Predict churn', compute_status: { state: 'ACTIVE' }, app_status: { state: 'RUNNING' } } };

async function openBuild(state = STATE) {
  const ui = await openUi('implement', state);
  try {
    await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await ui.page.getByRole('heading', { name: 'Predict churn', exact: true }).waitFor({ timeout: 15000 });
  } catch (e) {
    await ui.close();
    throw e;
  }
  return ui;
}

// RC6-D-05 (T-UNI-01, REQ-339, REQ-354): the dialog names the use case, and the card says which version was uninstalled.
test('the uninstall dialog names the use case, and the card after the uninstall says which version was uninstalled', async () => {
  const ui = await openBuild();
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Uninstall this use case', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Uninstall everything Predict churn built', exact: true });
    await dialog.waitFor({ timeout: 15000 });
    assert.equal(await dialog.getByRole('button', { name: 'Uninstall Predict churn', exact: true }).count(), 1, 'the button names the use case');
    assert.match(await dialog.textContent(), /N01-U01/, 'the id stays as the thing to type');
  } finally {
    await ui.close();
  }
  const after = await openBuild({ ...STATE, history: [uninstalledRow(4), ...HISTORY] });
  try {
    const shown = after.page.locator('[data-uninstalled-version]').first();
    await shown.waitFor({ timeout: 15000 });
    assert.match((await shown.textContent()).trim(), /^v3 uninstalled$/, 'the version that was uninstalled (v3), not the uninstall row (v4)');
    assert.equal((await after.page.locator('[data-use-case-meta] [data-implement-status]').textContent()).trim(), 'MVP uninstalled');
  } finally {
    await after.close();
  }
});
