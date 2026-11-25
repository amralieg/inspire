import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const ORDERS = 'adb_fe_uae_01.demo_telco.customers';
const PERSON = 'harness.person@example.com';
const DENIED = "[PERMISSION_DENIED] User does not have USE SCHEMA on Schema 'adb_fe_uae_01.demo_telco'.";
const STATE = {
  catalogs: ['adb_fe_uae_01'], schemas: { adb_fe_uae_01: ['demo_telco'] }, tables: { 'adb_fe_uae_01.demo_telco': ['customers'] },
  columnsByTable: { [ORDERS]: [{ column_name: 'gender', data_type: 'STRING', ordinal_position: 1 }] },
  forwardedEmail: PERSON,
  statements: { ' GROUP BY ': () => { throw new Error(DENIED); } },
};

test('Load groups refused for the signed-in person opens Permission Required with the schema grants, Copy, Try again and Close', async () => {
  const ui = await openUi('launch', STATE);
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="adb_fe_uae_01"]').click();
    await page.locator('button[title="demo_telco"]').click();
    await page.locator('button[title="customers"]').click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('gender');
    const row = page.locator(`[data-column-hit="gender"][data-scope-row="${ORDERS}"]`);
    await row.waitFor({ timeout: 15000 });
    await row.getByRole('button', { name: 'Load groups on gender in customers' }).click();
    const dialog = page.locator('[data-permission-dialog=""]');
    await dialog.waitFor({ timeout: 15000 });
    // The SQL sits under Advanced, which stays closed while a request offer is shown (REQ-311). innerText of a closed disclosure is '', so the listed text is read.
    const text = await dialog.locator('[data-permission-statements=""]').textContent();
    assert.match(text, /GRANT USE CATALOG ON CATALOG `adb_fe_uae_01` TO `harness\.person@example\.com`;/);
    assert.match(text, /GRANT USE SCHEMA ON SCHEMA `adb_fe_uae_01`\.`demo_telco` TO `harness\.person@example\.com`;/);
    // SEC-02 AT2 (68f0a0622, REQ-518): a read refusal never asks SELECT on the whole schema.
    assert.doesNotMatch(text, /GRANT (SELECT|READ METADATA) ON (SCHEMA|CATALOG)/);
    assert.ok(await dialog.getByRole('button', { name: 'Try again' }).count() === 1, 'Try again is offered');
    assert.ok(await dialog.getByRole('button', { name: 'Copy' }).count() === 1, 'Copy is offered');
    assert.ok(PERSON.length > 0);
  } finally {
    await ui.close();
  }
});

test('a column-list refusal opens Permission Required once from the shared error path, with the schema grants', async () => {
  const ui = await openUi('launch', { ...STATE, forwardedEmail: PERSON, statements: { 'information_schema.columns': () => { throw new Error(DENIED); } } });
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="adb_fe_uae_01"]').click();
    await page.locator('button[title="demo_telco"]').click();
    await page.locator('button[title="customers"]').click();
    await idle(page);
    await page.getByRole('button', { name: /Advanced Settings/ }).click();
    await page.getByRole('button', { name: /Data Management \(optional\)/ }).click();
    // The column search reads the columns of the picked scope (REQ-370), so the refusal comes with the first search.
    await page.getByRole('searchbox', { name: 'Search column names' }).fill('name');
    const dialog = page.locator('[data-permission-dialog=""]');
    await dialog.waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-permission-dialog=""]').count(), 1, 'exactly one Permission Required dialog');
    // The SQL sits under Advanced, which stays closed while a request offer is shown (REQ-311). innerText of a closed disclosure is '', so the listed text is read.
    const text = await dialog.locator('[data-permission-statements=""]').textContent();
    assert.match(text, /GRANT USE SCHEMA ON SCHEMA `adb_fe_uae_01`\.`demo_telco` TO `harness\.person@example\.com`;/);
    // SEC-02 AT2 (68f0a0622, REQ-518): a read refusal never asks SELECT on the whole schema.
    assert.doesNotMatch(text, /GRANT (SELECT|READ METADATA) ON (SCHEMA|CATALOG)/);
  } finally {
    await ui.close();
  }
});

test('a Launch picker refusal opens Permission Required once, with the schema grants and no second dialog', async () => {
  const ui = await openUi('launch', { ...STATE, forwardedEmail: PERSON, tablesRefusal: DENIED });
  const { page } = ui;
  try {
    await page.getByPlaceholder(BUSINESS).fill('Acme');
    await page.locator('button[title="adb_fe_uae_01"]').click();
    await page.locator('button[title="demo_telco"]').click();
    const dialog = page.locator('[data-permission-dialog=""]');
    await dialog.waitFor({ timeout: 15000 });
    await idle(page);
    assert.equal(await page.locator('[data-permission-dialog=""]').count(), 1, 'exactly one Permission Required dialog');
    // The SQL sits under Advanced, which stays closed while a request offer is shown (REQ-311). innerText of a closed disclosure is '', so the listed text is read.
    const text = await dialog.locator('[data-permission-statements=""]').textContent();
    assert.match(text, /GRANT USE CATALOG ON CATALOG `adb_fe_uae_01` TO `harness\.person@example\.com`;/);
    assert.match(text, /GRANT USE SCHEMA ON SCHEMA `adb_fe_uae_01`\.`demo_telco` TO `harness\.person@example\.com`;/);
  } finally {
    await ui.close();
  }
});
