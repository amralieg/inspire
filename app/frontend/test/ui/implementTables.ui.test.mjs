import test from 'node:test';
import assert from 'node:assert/strict';
import { REMOVE_TABLE, pickedTable } from '../../src/lib/implementWizard.js';
import { OWNER, built, builtSpec } from './implementFixtures.js';
import { createRequire } from 'node:module';
import { closeBrowser, lowContrast, onStep, openAsset, openBuild, openUi, until, goToStep } from './uiSupport.mjs';

const { NO_PERSON_TOKEN } = createRequire(import.meta.url)('../../../backend/lib/routePolicy.js');

test.after(closeBrowser);

const PERSON = 'person-token';
const OTHER = ['someone.else', 'example.com'].join('@');
const ORDERS = [['order_id', 'STRING'], ['customer_id', 'STRING'], ['order_date', 'DATE'], ['amount', 'DECIMAL(10,2)']];
const rows = (pairs) => pairs.map(([column_name, data_type], i) => ({ column_name, data_type, ordinal_position: i + 1 }));
const COLUMNS = {
  'main.s.orders': rows(ORDERS),
  'main.s.orders_v2': rows([...ORDERS, ['channel', 'STRING']]),
  'main.s.orders_lite': rows(ORDERS.slice(0, 3)),
  'main.s.returns': rows([['return_id', 'STRING'], ['order_id', 'STRING']]),
};
const SWAPS = [{ table_schema: 's', table_name: 'orders_v2', matched: '4', total: '4' }, { table_schema: 's', table_name: 'orders_lite', matched: '3', total: '4' }];
const VIEW = { settings: [], history: [], editable: true, why: '', can_run: false };
const STATE = { history: [built()], forwardedToken: PERSON, columnsByTable: COLUMNS, swapRows: SWAPS, appApi: { 'GET /api/settings': [VIEW] } };
const SETTINGS = 'The next run reads main.s.orders_v2. Nothing is rebuilt.';
const REBUILD = 'Inspire rebuilds this use case with Genie as version 2 and shows the checklist. Missing on main.s.orders_lite: amount.';
const OWNERS_ONLY = 'Only the owners of this use case can change its settings: the person who asked for v1 and the App owners it names';
const DROPPED = 'Inspire rebuilds this use case with Genie as version 2 and shows the checklist.';
const UNREAD = 'Inspire could not compare the tables: Inspire cannot read the columns of main.s.orders_v2 with your sign-in: the table does not exist or you '
  + 'cannot read it';
const NO_SIGN_IN = 'Inspire looks for similar tables with your own sign-in, and this request carries none, so it suggests none';
const SECRET = { table_schema: 'hr', table_name: 'salaries', matched: '4', total: '4' };

const tablesOf = async (page) => (await openAsset(page, 'notebook')).getByRole('region', { name: 'Settings', exact: true }).locator('[data-settings-tables]');

test('an owner changes a table from the Settings panel and is told before Save whether it is a settings change or a rebuild', async () => {
  const ui = await openBuild({ me: { userName: OWNER, displayName: 'Owner' }, ...STATE });
  const { page, made } = ui;
  try {
    const tables = await tablesOf(page);
    await tables.locator('[data-table="main.s.orders"]').waitFor({ timeout: 15000 });
    assert.deepEqual(await tables.locator('[data-table]').evaluateAll((list) => list.map((t) => t.dataset.table)), ['main.s.orders', 'main.s.returns']);
    assert.equal(await tables.locator('[data-table-change]').count(), 0, 'nothing to say before a change');
    const pick = tables.getByLabel('Table to use for main.s.orders');
    const choose = async (table) => {
      await tables.locator('[data-table="main.s.orders"]').getByRole('button', { name: 'Change', exact: true }).click();
      await pick.locator('option', { hasText: 'main.s.orders_v2 (4 of 4 columns match)' }).waitFor({ state: 'attached', timeout: 15000 });
      await pick.selectOption(table);
      await pick.waitFor({ state: 'detached' });
    };
    await choose('main.s.orders_v2');
    assert.equal(await tables.locator('[data-table="main.s.orders"] .font-mono').textContent(), 'main.s.orders_v2');
    await tables.locator('[data-table-change]').getByText(SETTINGS, { exact: true }).waitFor({ timeout: 15000 });
    await tables.getByRole('button', { name: 'Save as a settings change', exact: true }).waitFor();
    await choose('main.s.orders_lite');
    await tables.locator('[data-table-change]').getByText(REBUILD, { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await tables.getByRole('button', { name: 'Save as a settings change' }).count(), 0);
    await tables.getByRole('button', { name: 'Save and rebuild as version 2', exact: true }).waitFor();
    await choose('main.s.orders_v2');
    const save = tables.getByRole('button', { name: 'Save as a settings change', exact: true });
    await save.waitFor({ timeout: 15000 });
    const contrast = await lowContrast(page, ['[data-settings-tables]']);
    assert.ok(contrast.checked >= 6, `measured ${contrast.checked}`);
    assert.deepEqual(contrast.low, []);
    await save.click();
    await until(() => made.jobs.length === 1, 'the settings version');
    const insert = made.sqlCalls.find((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
    const sent = JSON.parse(insert.parameters.find((p) => p.name === 'spec').value);
    assert.deepEqual([sent.data.tables, insert.parameters.find((p) => p.name === 'classes').value], [{ 'main.s.orders': 'main.s.orders_v2' }, 'settings']);
    const reads = made.sqlCalls.filter((c) => /^SELECT column_name, data_type, ordinal_position FROM/.test(String(c.sql)));
    assert.ok(reads.length >= 2 && reads.every((c) => c.token === PERSON), 'the tables are compared with the person\u2019s own sign-in');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('anyone but an owner sees the tables read only, with the owners text and nothing to change', async () => {
  const ui = await openBuild({ me: { userName: OTHER, displayName: 'Someone' }, ...STATE });
  const { page } = ui;
  try {
    const tables = await tablesOf(page);
    await tables.locator('[data-tables-why]').waitFor({ timeout: 15000 });
    assert.equal(await tables.locator('[data-tables-why]').textContent(), OWNERS_ONLY);
    assert.deepEqual(await tables.locator('[data-table]').evaluateAll((list) => list.map((t) => t.dataset.table)), ['main.s.orders', 'main.s.returns']);
    assert.equal(await tables.getByRole('button').count(), 0, 'no Change, no Save');
    assert.equal(await tables.getByRole('combobox').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const savedSpec = (made) => made.sqlCalls.find((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));

test('an owner stops using a table from the Settings panel, is told it rebuilds, can use it again before Save, and saves the rebuild', async () => {
  const ui = await openBuild({ me: { userName: OWNER, displayName: 'Owner' }, ...STATE });
  const { page, made } = ui;
  try {
    const tables = await tablesOf(page);
    const card = (table) => tables.locator(`[data-table="${table}"]`);
    await card('main.s.returns').waitFor({ timeout: 15000 });
    await card('main.s.orders').getByRole('button', { name: 'Change', exact: true }).click();
    const primary = tables.getByLabel('Table to use for main.s.orders').locator(`option[value="${REMOVE_TABLE}"]`);
    await primary.waitFor({ state: 'attached', timeout: 15000 });
    assert.equal(await primary.textContent(), "Don't use this table (the primary table can be swapped, not removed)");
    assert.equal(await primary.isDisabled(), true);
    await card('main.s.orders').getByRole('button', { name: 'Change', exact: true }).click();
    await tables.getByLabel('Table to use for main.s.orders').waitFor({ state: 'detached' });
    const drop = async () => {
      await card('main.s.returns').getByRole('button', { name: 'Change', exact: true }).click();
      const pick = tables.getByLabel('Table to use for main.s.returns');
      const option = pick.locator(`option[value="${REMOVE_TABLE}"]`);
      await option.waitFor({ state: 'attached', timeout: 15000 });
      assert.deepEqual([await option.textContent(), await option.isDisabled()], ["Don't use this table", false]);
      await pick.selectOption(REMOVE_TABLE);
      await pick.waitFor({ state: 'detached' });
    };
    await drop();
    await tables.getByText(pickedTable(builtSpec(), 'main.s.returns', REMOVE_TABLE).notice, { exact: true }).waitFor();
    assert.equal(await card('main.s.returns').locator('.line-through').textContent(), 'main.s.returns');
    await tables.locator('[data-table-change]').getByText(DROPPED, { exact: true }).waitFor({ timeout: 15000 });
    const save = tables.getByRole('button', { name: 'Save and rebuild as version 2', exact: true });
    await save.waitFor();
    assert.equal(await tables.getByRole('button', { name: 'Save as a settings change' }).count(), 0, 'a dropped table is never a settings change');
    await card('main.s.returns').getByRole('button', { name: 'Use it again', exact: true }).click();
    await tables.locator('[data-table-change]').waitFor({ state: 'detached', timeout: 15000 });
    assert.equal(await card('main.s.returns').locator('.line-through').count(), 0);
    assert.equal(await tables.getByRole('button', { name: /^Save/ }).count(), 0, 'nothing changed, so nothing to save');
    await drop();
    await save.waitFor({ timeout: 15000 });
    assert.match(await card('main.s.returns').locator('[data-table-name]').getAttribute('class'), /\bopacity-60\b/, 'the table no longer used fades');
    assert.doesNotMatch(await card('main.s.returns').getAttribute('class'), /\bopacity-/, 'and its Use it again button does not');
    const contrast = await lowContrast(page, ['[data-settings-tables] [data-table="main.s.returns"] button', '[data-table-change]',
      '[data-settings-tables] > button']);
    assert.equal(contrast.checked, 3, `measured ${contrast.checked}`);
    assert.deepEqual(contrast.low, []);
    await save.click();
    await until(() => savedSpec(made), 'the rebuild version');
    const insert = savedSpec(made);
    const sent = JSON.parse(insert.parameters.find((p) => p.name === 'spec').value);
    assert.deepEqual(sent.data.removed_tables, ['main.s.returns']);
    assert.ok(insert.parameters.find((p) => p.name === 'classes').value.split(',').includes('data'), 'the version is a rebuild');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('when Inspire cannot compare the tables the Settings panel says why on the error line and offers no Save', async () => {
  const unread = Object.fromEntries(Object.entries(COLUMNS).filter(([table]) => table !== 'main.s.orders_v2'));
  const ui = await openBuild({ me: { userName: OWNER, displayName: 'Owner' }, ...STATE, columnsByTable: unread });
  const { page, made } = ui;
  try {
    const tables = await tablesOf(page);
    await tables.locator('[data-table="main.s.orders"]').getByRole('button', { name: 'Change', exact: true }).click({ timeout: 15000 });
    const pick = tables.getByLabel('Table to use for main.s.orders');
    await pick.locator('option', { hasText: 'main.s.orders_v2 (4 of 4 columns match)' }).waitFor({ state: 'attached', timeout: 15000 });
    await pick.selectOption('main.s.orders_v2');
    const line = tables.locator('[data-table-change]');
    await line.getByText(UNREAD, { exact: true }).waitFor({ timeout: 15000 });
    assert.match(await line.getAttribute('class'), /\btext-error-fg\b/);
    assert.equal(await tables.getByRole('button', { name: /^Save/ }).count(), 0, 'no Save while the change cannot be told apart');
    const contrast = await lowContrast(page, ['[data-table-change]']);
    assert.ok(contrast.checked >= 1, `measured ${contrast.checked}`);
    assert.deepEqual(contrast.low, []);
    assert.equal(savedSpec(made), undefined);
    assert.deepEqual(ui.pageErrors, ['Failed to load resource: the server responded with a status of 409 (Conflict)'], 'the refused comparison is the only error');
  } finally {
    await ui.close();
  }
});

const optionTexts = (pick) => pick.locator('option').allTextContents();

test('similar tables come from the person\u2019s own sign-in: a table only the App can see never shows, and with no sign-in none shows and both pickers say why', async () => {
  const seen = { [PERSON]: SWAPS, tok: [...SWAPS, SECRET] };
  const me = { userName: OWNER, displayName: 'Owner' };
  let ui = await openBuild({ me, ...STATE, swapRowsByToken: seen });
  try {
    const tables = await tablesOf(ui.page);
    await tables.locator('[data-table="main.s.orders"]').getByRole('button', { name: 'Change', exact: true }).click({ timeout: 15000 });
    const pick = tables.getByLabel('Table to use for main.s.orders');
    await pick.locator('option', { hasText: 'main.s.orders_v2 (4 of 4 columns match)' }).waitFor({ state: 'attached', timeout: 15000 });
    const shown = await optionTexts(pick);
    assert.ok(shown.some((t) => t.startsWith('main.s.orders_lite')), shown.join(' | '));
    assert.equal(shown.some((t) => t.includes('salaries')), false, `a table the person cannot see: ${shown.join(' | ')}`);
    const asked = ui.made.sqlCalls.filter((c) => String(c.sql).includes('WITH o AS'));
    assert.ok(asked.length >= 1 && asked.every((c) => c.token === PERSON), 'Inspire looks for similar tables with the person\u2019s token only');
    assert.equal(await tables.locator('[data-swaps-why]').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const appOnly = { me, ...STATE, forwardedToken: '', forwardedEmail: OWNER, tokenKind: 'app', swapRowsByToken: seen };
  ui = await openBuild(appOnly);
  try {
    const tables = await tablesOf(ui.page);
    await tables.locator('[data-table="main.s.orders"]').getByRole('button', { name: 'Change', exact: true }).click({ timeout: 15000 });
    const why = tables.locator('[data-swaps-why]');
    await why.waitFor({ timeout: 15000 });
    assert.equal(await why.textContent(), NO_SIGN_IN);
    assert.deepEqual(await optionTexts(tables.getByLabel('Table to use for main.s.orders')),
      ["main.s.orders (Inspire's pick)", "Don't use this table (the primary table can be swapped, not removed)"]);
    assert.equal(ui.made.sqlCalls.filter((c) => String(c.sql).includes('WITH o AS')).length, 0, 'nothing is read as the App');
    const contrast = await lowContrast(ui.page, ['[data-swaps-why]']);
    assert.ok(contrast.checked >= 1, `measured ${contrast.checked}`);
    assert.deepEqual(contrast.low, []);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  ui = await openUi('wizard', appOnly);
  try {
    const { page } = ui;
    await goToStep(page, 'Data');
    await page.getByRole('alert').getByText(NO_PERSON_TOKEN, { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(ui.made.sqlCalls.filter((c) => /information_schema\.columns/.test(String(c.sql))).length, 0, 'the column picker reads nothing as the App');
    await page.locator('[data-table="main.s.orders"]').getByRole('button', { name: 'Change', exact: true }).click();
    await page.locator('[data-table="main.s.orders"] [data-swaps-why]').getByText(NO_SIGN_IN, { exact: true }).waitFor({ timeout: 15000 });
    const shown = await optionTexts(page.getByLabel('Table to use for main.s.orders'));
    assert.equal(shown.some((t) => t.includes('salaries') || t.includes('orders_v2') || t === 'No similar table found'), false, shown.join(' | '));
    assert.equal(ui.made.sqlCalls.filter((c) => String(c.sql).includes('WITH o AS')).length, 0);
    assert.deepEqual(ui.pageErrors.filter((line) => !/status of 401/.test(line)), []);
  } finally {
    await ui.close();
  }
});
