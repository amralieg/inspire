import test from 'node:test';
import assert from 'node:assert/strict';
import { HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { closeBrowser, goToStep, onStep, openUi, profileAt, startMvp, toSummary } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { userName: OWNER, displayName: 'Owner' };
const COLUMNS = [{ column_name: 'order_id', data_type: 'STRING', ordinal_position: 1 }, { column_name: 'status', data_type: 'STRING', ordinal_position: 2 }];
const VALUES = { status: ['gold', 'silver'] };
const PROFILE = {
  table: 'main.s.orders', records: 48210, applies: true, qualifies: true, reason: 'anomaly detection compares each record with its group', standalone: false,
  columns: [{ name: 'status', type: 'string', distinct: 2, smallest: 900, largest: 47310, nulls: 0, parent: null }],
  recommended: ['status'], time_column: 'order_date', recent: { days: 30, records: 3120 },
  suggested_groups: [{ value: 'gold', records: 18200, kind: 'biggest' }], group_column: 'status',
  first_run: { all: 48210, groups: 19612, recent: 3120, records: null }, default_scope: 'records', read_at: '2026-11-01T15:00:00Z',
};

const block = (page, table) => page.locator(`[data-source-table="${table}"]`);
const pickStatus = async (page, table) => block(page, table).getByLabel(`Filter rows of ${table} by column`).selectOption('status');

function submittedSpec(made) {
  const inserts = made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
  assert.equal(inserts.length, 1);
  return JSON.parse(inserts[0].parameters.find((p) => p.name === 'spec').value);
}

test('the data step gives each source table its own column list and row filter, outside Advanced', async () => {
  const ui = await openUi('wizard&discovery=Deep', { columns: COLUMNS, valuesByColumn: VALUES, me: ME });
  const { page, pageErrors } = ui;
  try {
    await goToStep(page, 'Data');
    await block(page, 'main.s.orders').waitFor();
    assert.equal(await page.locator('[data-source-table]').count(), 2, 'one block per source table');
    assert.equal(await page.getByRole('button', { name: 'Change data settings', exact: true }).getAttribute('aria-expanded'), 'false', 'Advanced stays closed');
    for (const table of ['main.s.orders', 'main.s.returns']) {
      await block(page, table).getByText(/^Columns Inspire reads:/).waitFor();
      await pickStatus(page, table);
      await block(page, table).getByText('Keep only these values', { exact: true }).waitFor();
      await block(page, table).getByText('Leave out these values', { exact: true }).waitFor();
    }
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('keeping one value counts that scope in review and submits the row filter with op in', async () => {
  const ui = await openUi('wizard&discovery=Deep', { columns: COLUMNS, valuesByColumn: VALUES, readinessByFilter: { gold: '120' }, me: ME });
  const { page, made, pageErrors } = ui;
  try {
    await goToStep(page, 'Data');
    const orders = block(page, 'main.s.orders');
    await pickStatus(page, 'main.s.orders');
    await orders.getByRole('button', { name: 'Load values' }).first().click();
    await orders.getByRole('checkbox', { name: 'gold', exact: true }).first().check();
    await toSummary(page);
    await page.getByText('Inspire found 120 rows to work with in main.s.orders.').waitFor();
    await startMvp(page);
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    assert.equal(made.jobs.length, 1);
    assert.deepEqual(submittedSpec(made).data.filters, [{ table: 'main.s.orders', column: 'status', op: 'in', values: ['gold'] }]);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the First run sizes the scope from its own count, not the whole table', async () => {
  const calls = [];
  const ui = await openUi('wizard', { me: ME, columns: COLUMNS, valuesByColumn: VALUES, readinessByFilter: { gold: '120' } }, '', { init: profileAt(calls, PROFILE) });
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    await pickStatus(page, 'main.s.orders');
    await block(page, 'main.s.orders').getByRole('button', { name: 'Load values' }).first().click();
    await block(page, 'main.s.orders').getByRole('checkbox', { name: 'gold', exact: true }).first().check();
    await goToStep(page, 'First run');
    const everything = page.locator('[data-first-run-choice="all"]');
    await everything.waitFor();
    const text = await everything.innerText();
    assert.match(text, /\b120 records\b/, text);
    assert.doesNotMatch(text, /48,210/, 'the whole table count is not shown for the narrowed scope');
  } finally {
    await ui.close();
  }
});

test('a scope under the forecast minimum shows one plain warning on the data step, and a scope over it shows none', async () => {
  const ui = await openUi('wizard&discovery=Deep', { columns: COLUMNS, readinessRows: [{ row_count: '30' }], useCase: { ...HARNESS_USE_CASE, analytics_technique: 'Forecasting' }, me: ME });
  const { page, made, pageErrors } = ui;
  try {
    await goToStep(page, 'Data');
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.locator('[data-too-few-rows]').waitFor();
    assert.equal(await page.locator('[data-too-few-rows]').innerText(), 'Only 30 rows are in this scope, fewer than the 60 this use case needs; you can still go on.');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await onStep(page, 'Data');
    made.state.readinessRows = [{ row_count: '61' }];
    await page.getByRole('button', { name: 'Next', exact: true }).click();
    await page.locator('[aria-current="step"]', { hasText: /^\s*Data\s*$/ }).waitFor({ state: 'detached' });
    assert.equal(await page.locator('[data-too-few-rows]').count(), 0);
    assert.deepEqual(pageErrors, []);
  } finally {
    await ui.close();
  }
});
