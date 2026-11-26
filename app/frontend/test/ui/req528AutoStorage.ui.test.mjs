// REQ-528 (Amr, 2026-11-25): "user must have the app using Lakebase, if not found, or not able to create it, then use delta, but this is not a choice
// user can make any more". Fail-first contract: the SQL warehouse for the App step has no radio or option to pick Delta or Lakebase; Review & build carries one
// read-only line that names the storage and why; Lakebase when the check says it is available, Delta with the reason otherwise, Delta for per-user sign-in.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openFolded, openUi, toAppAccess, toSharedAccess, toSummary, POLICIED_SOURCE } from './uiSupport.mjs';
import { APP_STORAGE_LABEL } from '../../src/lib/implementWizard.js';

test.after(closeBrowser);

const OWNER = ['owner', 'example.com'].join('@');
const probe = (data, status) => ({ me: { userName: OWNER, displayName: 'Owner' }, responses: { 'GET /api/2.0/postgres/projects': [data, status] } });
const filtered = (fn, body) => ({
  ...probe({ projects: [] }, 200),
  policies: POLICIED_SOURCE,
  rowFilters: { 'main.s.orders': { function_name: fn, input_column_names: ['region'] } },
  responses: { ...probe({ projects: [] }, 200).responses, [`GET /api/2.1/unity-catalog/functions/${fn}`]: [{ routine_definition: body, input_params: { parameters: [{ name: 'region' }] } }, 200] },
});

async function storageHasNoChoice(page) {
  await page.getByRole('region', { name: APP_STORAGE_LABEL }).waitFor();
  const step = page.getByRole('region', { name: APP_STORAGE_LABEL });
  await step.getByRole('status').waitFor({ state: 'detached' });
  assert.equal(await step.getByRole('radio').count(), 0, 'no radio to pick Lakebase or Delta');
  assert.equal(await step.getByRole('group', { name: "How fast do the App's pages open?" }).count(), 0, 'the storage choice is gone');
  assert.equal(await step.getByText('Fast pages (Lakebase)', { exact: true }).count(), 0, 'no Fast pages option');
}

async function reviewLine(page) {
  await toSummary(page);
  const row = page.locator('[data-picked-row="app_storage"]');
  await row.waitFor();
  assert.equal(await row.locator('[data-picked-change]').count(), 0, 'a read-only line has no Change button');
  return (await row.locator('[data-picked-value]').innerText()).trim();
}

async function toStorage(page) {
  await goToStep(page, 'Data');
  await goToStep(page, 'What to build');
  await toSharedAccess(page);
  await goToStep(page, 'Where it lives');
  await openFolded(page, APP_STORAGE_LABEL);
}

test('Lakebase available: no storage choice, and Review says Fast pages (Lakebase)', async () => {
  const ui = await openUi('wizard', probe({ projects: [] }, 200));
  try {
    await toStorage(ui.page);
    await storageHasNoChoice(ui.page);
    assert.equal(await reviewLine(ui.page), 'Fast pages (Lakebase)');
    assert.deepEqual(ui.pageErrors, []);
  } finally { await ui.close(); }
});

test('Lakebase not in the workspace: Review says Delta and why, with no choice', async () => {
  const ui = await openUi('wizard', probe({ error_code: 'ENDPOINT_NOT_FOUND' }, 404));
  try {
    await toStorage(ui.page);
    await storageHasNoChoice(ui.page);
    assert.match(await reviewLine(ui.page), /^Delta, because Lakebase is not available here/);
  } finally { await ui.close(); }
});

test('Lakebase refused to Inspire: Review says Delta because it could not be created, with the reason', async () => {
  const ui = await openUi('wizard', probe({ message: 'PERMISSION_DENIED: Lakebase is not enabled for this user' }, 403));
  try {
    await toStorage(ui.page);
    await storageHasNoChoice(ui.page);
    assert.match(await reviewLine(ui.page), /^Delta tables \(Lakebase is not set up in this workspace\)$/);
  } finally { await ui.close(); }
});

test('per-user sign-in: Review says Delta, even with Lakebase available', async () => {
  const ui = await openUi('wizard', filtered('main.s.hide', 'SELECT true'));
  try {
    await goToStep(ui.page, 'Data');
    await goToStep(ui.page, 'What to build');
    await toAppAccess(ui.page);
    await ui.page.getByRole('region', { name: 'App access' }).getByRole('radio', { name: /^Sensitive data/ }).check();
    await goToStep(ui.page, 'Where it lives');
    await openFolded(ui.page, APP_STORAGE_LABEL);
    await storageHasNoChoice(ui.page);
    assert.match(await reviewLine(ui.page), /^Delta, because each person signs in as themselves/);
  } finally { await ui.close(); }
});
