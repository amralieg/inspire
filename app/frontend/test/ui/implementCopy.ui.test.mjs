import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { closeBrowser, goToStep, openUi, toSummary } from './uiSupport.mjs';

test.after(closeBrowser);

const PERSON = 'person-token';
const SAMPLE = 'samples.nyctaxi.trips';
const COPY = 'inspire_kinds_rc7.walk_rc7e.nyctaxi_trips';
const FOREIGN = 'other.x.trips_copy';
const ME = { userName: OWNER, displayName: 'Owner' };
const SAMPLE_CASE = { ...HARNESS_USE_CASE, primary_table: SAMPLE, tables_involved: SAMPLE };
const ORDERS_COLUMNS = [['order_id', 'STRING'], ['customer_id', 'STRING'], ['order_date', 'DATE'], ['amount', 'DECIMAL(10,2)']];
const TRIP_COLUMNS = [['vendor_id', 'STRING'], ['pickup_datetime', 'TIMESTAMP'], ['trip_distance', 'DOUBLE'], ['fare_amount', 'DOUBLE']];
const rows = (pairs) => pairs.map(([column_name, data_type], i) => ({ column_name, data_type, ordinal_position: i + 1 }));
const COLUMNS = { 'main.s.orders': rows(ORDERS_COLUMNS), 'samples.nyctaxi.trips': rows(TRIP_COLUMNS), [COPY]: rows(TRIP_COLUMNS) };
const COPY_ROW = { table_catalog: 'inspire_kinds_rc7', table_schema: 'walk_rc7e', table_name: 'nyctaxi_trips', matched: '4', total: '4', owned: '1' };
const SAMPLE_DENIED = '[PERMISSION_DENIED] User does not have SELECT on Table samples.nyctaxi.trips';
const FOREIGN_DENIED = '[PERMISSION_DENIED] User does not have SELECT on Table other.x.trips_copy';
const BUILT_IN = 'is in a built-in sample catalog that Databricks owns';

const optionTexts = (select) => select.locator('option').allTextContents().then((list) => list.map((t) => t.trim()));
const tableRow = (page, table) => page.locator(`[data-table="${table}"]`);
const picker = (page, table) => page.getByLabel(`Table to use for ${table}`, { exact: true });

test('a built-in sample source is refused, the picker lists the person’s own copy first, and choosing that copy lets the build go ahead', async () => {
  const ui = await openUi('wizard', {
    me: ME, useCase: SAMPLE_CASE, history: [], forwardedToken: PERSON, columnsByTable: COLUMNS,
    swapRowsByToken: { [PERSON]: [COPY_ROW] }, appProbeErrors: { '`samples`.`nyctaxi`.`trips`': SAMPLE_DENIED },
  });
  try {
    const { page } = ui;
    await goToStep(page, 'Data');
    await page.getByText(BUILT_IN, { exact: false }).first().waitFor({ timeout: 15000 });
    await tableRow(page, SAMPLE).getByRole('button', { name: 'Change', exact: true }).click();
    const options = await optionTexts(picker(page, SAMPLE));
    assert.deepEqual(options.slice(0, 2), [`${SAMPLE} (Inspire's pick)`, `Your copy of ${SAMPLE} (${COPY})`], options.join(' | '));
    await picker(page, SAMPLE).selectOption(COPY);
    await picker(page, SAMPLE).waitFor({ state: 'detached', timeout: 15000 });
    assert.equal(await tableRow(page, SAMPLE).locator('.font-mono').textContent(), COPY);
    await toSummary(page);
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'All Good, Build it Now' && !b.disabled), null, { timeout: 15000 });
    assert.deepEqual(ui.pageErrors.filter((line) => !/status of 401/.test(line)), []);
  } finally {
    await ui.close();
  }
});

test('a slow catalog search does not hold the copy: the copy is listed within 2 s and the similar tables arrive later', async () => {
  const SIMILAR = { table_catalog: 'main', table_schema: 's2', table_name: 'orders_v2', matched: '5', total: '6' };
  const ui = await openUi('wizard', {
    me: ME, useCase: SAMPLE_CASE, history: [], forwardedToken: PERSON, columnsByTable: COLUMNS,
    swapRowsByToken: { [PERSON]: [COPY_ROW] }, appProbeErrors: { '`samples`.`nyctaxi`.`trips`': SAMPLE_DENIED },
    statements: { 'GREATEST(2, CEIL(': async () => {
      await new Promise((done) => setTimeout(done, 5000));
      return { rows: [SIMILAR, COPY_ROW] };
    } },
  });
  try {
    const { page } = ui;
    await goToStep(page, 'Data');
    await page.getByText(BUILT_IN, { exact: false }).first().waitFor({ timeout: 15000 });
    const started = Date.now();
    await tableRow(page, SAMPLE).getByRole('button', { name: 'Change', exact: true }).click();
    await page.waitForFunction((text) => [...document.querySelectorAll('option')].some((o) => o.textContent.trim() === text),
      `Your copy of ${SAMPLE} (${COPY})`, { timeout: 2000 });
    assert.ok(Date.now() - started < 2000 + 1000, 'the copy did not wait for the slow search');
    assert.equal((await optionTexts(picker(page, SAMPLE))).some((t) => t.includes('columns match')), false, 'the similar tables have not arrived yet');
    await picker(page, SAMPLE).locator('option', { hasText: 'main.s2.orders_v2 (5 of 6 columns match)' }).waitFor({ state: 'attached', timeout: 15000 });
    assert.deepEqual((await optionTexts(picker(page, SAMPLE))).slice(0, 2), [`${SAMPLE} (Inspire's pick)`, `Your copy of ${SAMPLE} (${COPY})`]);
    assert.deepEqual(ui.pageErrors.filter((line) => !/status of 401/.test(line)), []);
  } finally {
    await ui.close();
  }
});

test('a table typed into the picker is checked with the person’s sign-in: a readable table in another catalog is used, and one they cannot read is refused (must-exclude)', async () => {
  const ui = await openUi('wizard', {
    me: ME, history: [], forwardedToken: PERSON, columnsByTable: COLUMNS, probeErrors: { '`other`.`x`.`trips_copy`': FOREIGN_DENIED },
  });
  try {
    const { page } = ui;
    await goToStep(page, 'Data');
    const orders = tableRow(page, 'main.s.orders');
    await orders.getByRole('button', { name: 'Change', exact: true }).click();
    const find = page.getByLabel('Search for another table instead of main.s.orders', { exact: true });
    await find.fill(FOREIGN);
    await page.getByRole('button', { name: 'Use this table', exact: true }).click();
    const note = orders.locator('[data-find-note]');
    await note.waitFor({ timeout: 15000 });
    assert.match(await note.textContent(), /^You can't read other\.x\.trips_copy: no read access\./);
    assert.equal(await orders.locator('.font-mono').first().textContent(), 'main.s.orders', 'a refused table is not used');
    assert.equal((await optionTexts(picker(page, 'main.s.orders'))).some((t) => t.includes(FOREIGN)), false);
    await find.fill(COPY);
    await page.getByRole('button', { name: 'Use this table', exact: true }).click();
    await picker(page, 'main.s.orders').waitFor({ state: 'detached', timeout: 15000 });
    assert.equal(await tableRow(page, 'main.s.orders').locator('.font-mono').textContent(), COPY, 'a readable table in another catalog is used as picked');
    assert.deepEqual(ui.pageErrors.filter((line) => !/status of 401/.test(line)), []);
  } finally {
    await ui.close();
  }
});
