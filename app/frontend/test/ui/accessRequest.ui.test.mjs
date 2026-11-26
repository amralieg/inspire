// REQ-311 + REQ-406: the Permission Required dialog always shows Request access. An offered send goes out as the person; any other outcome
// (no destination, a refused send) opens the Databricks request form for the object in a new tab, with one plain line, never a raw error.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, idle, openUi, until } from './uiSupport.mjs';

test.after(closeBrowser);

const BUSINESS = 'e.g. Contoso, Acme Corp, Retail Division';
const STATE = { catalogs: ['main'], schemas: { main: ['s'] }, tables: { 'main.s': ['orders'] } };
const PERSON = 'signed-in@example.com';
// REQ-408: the dialog asks for the schema, not the table.
const STATEMENTS = [
  `GRANT USE CATALOG ON CATALOG \`main\` TO \`${PERSON}\``,
  `GRANT USE SCHEMA ON SCHEMA \`main\`.\`s\` TO \`${PERSON}\``,
  `GRANT SELECT ON SCHEMA \`main\`.\`s\` TO \`${PERSON}\``,
];
const FORM = { type: 'SCHEMA', full_name: 'main.s', url: 'https://workspace.example.com/explore/data/main/s' };
const PERMISSION = { statements: STATEMENTS, principal: PERSON, why: 'Launch reads main.s.orders with your own access, and you cannot read it yet.' };
// REQ-313: the one instruction line sits under Advanced (REQ-300: exactly one instruction line).
const COPY_LINE = 'Copy the text below and pass it on to your Databricks admin.';

async function openDialog(overrides) {
  const ui = await openUi('launch', { ...STATE, checkPermissions: [PERMISSION], ...overrides });
  const { page } = ui;
  await page.getByPlaceholder(BUSINESS).fill('Acme');
  await page.locator('button[title="main"]').click();
  await page.locator('button[title="s"]').click();
  await page.locator('button[title="orders"]').click();
  await idle(page);
  await until(async () => !(await page.getByRole('button', { name: 'Get Started' }).isDisabled()), 'Get Started opens');
  await page.getByRole('button', { name: 'Get Started' }).click();
  await page.locator('[data-launch-run-unsaved]').click();
  const dialog = page.locator('[data-permission-dialog=""]');
  await dialog.waitFor({ timeout: 15000 });
  return { ui, page, dialog };
}

test('when a destination is set, Request access sends the grants and says where the request went', async () => {
  const { ui, page, dialog } = await openDialog({
    accessCheck: { offered: true, destinations: ['owner@example.com'], reason: '' },
    accessSend: { sent: true, destinations: ['owner@example.com'], reason: '' },
  });
  const button = dialog.getByRole('button', { name: 'Request access' });
  await button.waitFor({ timeout: 15000 });
  assert.equal(await dialog.locator('details[data-permission-advanced=""]').evaluate((el) => el.open), false, 'a destination: the SQL stays under the closed Advanced section');
  await button.click();
  const result = dialog.locator('[data-access-request-result=""]');
  await result.waitFor({ timeout: 15000 });
  assert.equal((await result.textContent()).trim(), 'Request sent to owner@example.com');
  assert.deepEqual(ui.made.state.accessSent, STATEMENTS, 'the dialog sends its own grants');
  await dialog.locator('details[data-permission-advanced=""]').evaluate((el) => { el.open = true; });
  assert.equal(await dialog.getByRole('button', { name: 'Copy' }).count(), 1, 'the copy text stays under Advanced, beside the request');
  assert.ok(page);
});

test('when a destination is set, Request access sends the grants and says where the request went', async () => {
  const { ui, page, dialog } = await openDialog({
    accessCheck: { offered: true, destinations: ['owner@example.com'], reason: '', links: [FORM] },
    accessSend: { sent: true, destinations: ['owner@example.com'], reason: '', links: [FORM] },
  });
  const button = dialog.getByRole('button', { name: 'Request access' });
  await button.waitFor({ timeout: 15000 });
  assert.equal(await dialog.locator('details[data-permission-advanced=""]').evaluate((el) => el.open), false, 'a destination: the SQL stays under the closed Advanced section');
  await button.click();
  const result = dialog.locator('[data-access-request-result=""]');
  await result.waitFor({ timeout: 15000 });
  assert.equal((await result.textContent()).trim(), 'Request sent to owner@example.com');
  assert.deepEqual(ui.made.state.accessSent, STATEMENTS, 'the dialog sends its own grants');
  await dialog.locator('details[data-permission-advanced=""]').evaluate((el) => { el.open = true; });
  assert.equal(await dialog.getByRole('button', { name: 'Copy' }).count(), 1, 'the copy text stays under Advanced, beside the request');
  assert.ok(page);
});

test('REQ-406 (a, b): with no destination the button still shows, and a click opens the Catalog Explorer page of the object', async () => {
  const { page, dialog } = await openDialog({ accessCheck: { offered: false, destinations: [], reason: 'no one has set up where access requests for these go yet', links: [FORM] } });
  const button = dialog.getByRole('button', { name: 'Request access' });
  await button.waitFor({ timeout: 15000 });
  await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(String(url)); return { opener: null, close() { window.__opened.push('closed'); }, set location(v) { window.__opened.push(String(v)); } }; }; });
  await button.click();
  const result = dialog.locator('[data-access-request-result=""]');
  await result.waitFor({ timeout: 15000 });
  assert.deepEqual(await page.evaluate(() => window.__opened), ['about:blank', FORM.url], 'the tab opens inside the click, then goes to the form');
  assert.equal((await result.textContent()).trim(), 'Opened the access request form for main.s in a new tab. Send the request there.');
  assert.equal(await page.locator('[data-permission-dialog=""]').count(), 1, 'the dialog stays open');
  assert.equal(await dialog.getByText(COPY_LINE).count(), 1, 'the copy-paste line stays');
  assert.equal(await dialog.locator('details[data-permission-advanced=""]').evaluate((el) => el.open), true, 'no destination: Advanced opens by default');
  const said = (await dialog.innerText()).match(/admin/gi) || [];
  assert.equal(said.length, 1, 'exactly one admin instruction in the dialog (REQ-300)');
});

test('REQ-406 (c): a refused send opens the form and shows one plain line, never the raw workspace error', async () => {
  const { ui, page, dialog } = await openDialog({
    accessCheck: { offered: true, destinations: ['owner@example.com'], reason: '', links: [FORM] },
    accessSend: { sent: false, destinations: [], reason: 'PERMISSION_DENIED: you cannot request this securable', links: [FORM] },
  });
  await page.evaluate(() => { window.__opened = []; window.open = (url) => { window.__opened.push(String(url)); return { opener: null, close() { window.__opened.push('closed'); }, set location(v) { window.__opened.push(String(v)); } }; }; });
  await dialog.getByRole('button', { name: 'Request access' }).click();
  const result = dialog.locator('[data-access-request-result=""]');
  await result.waitFor({ timeout: 15000 });
  assert.deepEqual(await page.evaluate(() => window.__opened), ['about:blank', FORM.url]);
  const text = (await result.textContent()).trim();
  assert.equal(text, 'Opened the access request form for main.s in a new tab. Send the request there.');
  assert.doesNotMatch(await dialog.innerText(), /Request not sent|PERMISSION_DENIED/, 'no raw error on the dialog');
  assert.equal(await ui.page.locator('[data-permission-dialog=""]').count(), 1, 'one dialog, not a second one');
});

test('REQ-406: several securables open the first and list the rest as plain links', async () => {
  const other = { type: 'TABLE', full_name: 'main.s.orders', url: 'https://workspace.example.com/explore/data/main/s/orders' };
  // c23: the dialog lists only securables its own statements name, so this dialog also asks for the table.
  const withTable = { ...PERMISSION, statements: [...STATEMENTS, `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${PERSON}\``] };
  const { dialog } = await openDialog({ checkPermissions: [withTable], accessCheck: { offered: false, destinations: [], reason: '', links: [FORM, other] } });
  await dialog.getByRole('button', { name: 'Request access' }).waitFor({ timeout: 15000 });
  const links = dialog.locator('[data-request-links=""] a');
  assert.deepEqual(await links.evaluateAll((els) => els.map((el) => el.getAttribute('href'))), [other.url]);
});

// REQ-406: a blocked tab is not "Opened": the dialog gives the form link to open instead.
test('REQ-406: when the browser blocks the tab, the line says to use the link and the form link is on the dialog', async () => {
  const { page, dialog } = await openDialog({ accessCheck: { offered: false, destinations: [], reason: '', links: [FORM] } });
  await dialog.getByRole('button', { name: 'Request access' }).waitFor({ timeout: 15000 });
  await page.evaluate(() => { window.open = () => null; });
  await dialog.getByRole('button', { name: 'Request access' }).click();
  const result = dialog.locator('[data-access-request-result=""]');
  await result.waitFor({ timeout: 15000 });
  assert.equal((await result.textContent()).trim(), 'Open the access request form for main.s with the link below. Send the request there.');
  assert.equal(await dialog.locator('[data-request-form-link=""]').getAttribute('href'), FORM.url);
});
