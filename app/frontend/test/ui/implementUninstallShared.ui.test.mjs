import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';
import { HARNESS_INSPIRE_URL, HARNESS_USE_CASE, HARNESS_SETTINGS, HARNESS_SESSION_ID } from './implementFixtures.js';
import { closeBrowser, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-460: when the use case's App is shared with other built use cases, the uninstall dialog names them and, once confirmed, removes them too.
const OWNER = ['owner', 'example.com'].join('@');
const ready = (version, extra = {}) => ({ state: 'ready', spec_version: version, ...extra });
const specFor = (id, name) => {
  const spec = defaultSpecFromUseCase({ ...HARNESS_USE_CASE, id }, { warehouseId: HARNESS_SETTINGS.warehouseId, inspireDatabase: HARNESS_SETTINGS.inspireDatabase, sessionId: HARNESS_SESSION_ID, owner: OWNER });
  return { ...spec, use_case_name: name, outputs: { ...spec.outputs, app: true, app_name: 'churn-desk', app_access: 'sp', inspire_url: HARNESS_INSPIRE_URL } };
};
const rowFor = (id, name) => ({
  session_id: '42', use_case_id: id, spec_version: 3, status: 'ready', change_classes: 'outputs', created_by: OWNER, updated_at: '2026-10-23T04:00:00Z',
  spec_json: JSON.stringify(specFor(id, name)), job_id: '77', result_rows: '3', notebook_path: `/Users/owner@example.com/inspire/Acme_implemented/${id}`,
  app_name: 'churn-desk', app_url: 'https://churn-desk-1.aws.example.com',
  asset_status: JSON.stringify({ app: ready(3, { snapshot: true }) }),
});
const OWN = rowFor('N01-U01', 'Predict churn');
const OTHER = rowFor('N02-U01', 'Forecast demand');
const APP = { name: 'churn-desk', description: 'Inspire use case N01-U01 (session 42): Predict churn', compute_status: { state: 'ACTIVE' }, app_status: { state: 'RUNNING' } };
const insertsOf = (made) => made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
  .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));

async function open(state) {
  const ui = await openUi('implement', state);
  try {
    await ui.page.getByRole('heading', { name: 'Predict churn', exact: true }).waitFor({ timeout: 15000 });
  } catch (e) {
    await ui.close();
    throw e;
  }
  return ui;
}

test('the uninstall dialog names the use case that shares the App, and confirming uninstalls both', async () => {
  const ui = await open({ history: [OWN, OTHER], registry: [OWN, OTHER], appExists: true, app: APP });
  const { page, made } = ui;
  try {
    await page.getByRole('button', { name: 'Uninstall this use case', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Uninstall everything Predict churn built' });
    const warning = dialog.locator('[data-uninstall-shared]');
    await warning.waitFor({ timeout: 15000 });
    assert.match(await warning.innerText(), /also uninstall/i);
    assert.equal(await warning.locator('li').count(), 1);
    assert.match(await warning.locator('li').first().innerText(), /Forecast demand/);
    await dialog.getByRole('textbox', { name: 'Type the use case id to confirm' }).fill('N01-U01');
    await dialog.getByRole('button', { name: 'Uninstall Predict churn', exact: true }).click();
    await until(() => made.jobs.length === 2, 'both uninstall runs');
    assert.deepEqual(insertsOf(made).map((s) => [s.use_case_id, s.uninstall]), [['N01-U01', true], ['N02-U01', true]]);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a use case whose App nobody else shares has no warning, and only it is uninstalled', async () => {
  const ui = await open({ history: [OWN], registry: [OWN], appExists: true, app: APP });
  const { page, made } = ui;
  try {
    await page.getByRole('button', { name: 'Uninstall this use case', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Uninstall everything Predict churn built' });
    await dialog.getByRole('textbox', { name: 'Type the use case id to confirm' }).waitFor();
    assert.equal(await dialog.locator('[data-uninstall-shared]').count(), 0);
    await dialog.getByRole('textbox', { name: 'Type the use case id to confirm' }).fill('N01-U01');
    await dialog.getByRole('button', { name: 'Uninstall Predict churn', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the uninstall');
    assert.deepEqual(insertsOf(made).map((s) => s.use_case_id), ['N01-U01']);
  } finally {
    await ui.close();
  }
});
