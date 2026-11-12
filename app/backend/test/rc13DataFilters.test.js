// rc13 Data Filters (REQ-119, REQ-021): the Launch-page scope and its use case label, end to end through the pure
// helpers the Launch page, the job validation and the Implement wizard all share.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const jobParams = require('../lib/inspireJobParams');

const ORDERS = 'main.sales.orders';
const WEB = 'main.sales.web';
const SCOPE = {
  [ORDERS]: {
    columns: ['brand_name', 'location', 'total_sales'],
    rows: [{ column: 'brand_name', op: '=', values: ['Starbucks'] }],
  },
};

test('the label rides in the scope object under its reserved key, and is never read as a table', async () => {
  const T = await lib('tableScope.js');
  const labelled = T.scopesFromObject({ ...SCOPE, use_case_label: '  Starbucks  ' });
  assert.deepEqual(labelled.problems, [], 'the label key is not flagged as a bad table name');
  assert.deepEqual(Object.keys(labelled.scopes), [ORDERS]);
  assert.equal(labelled.label, 'Starbucks');
  assert.equal(T.scopesFromObject(SCOPE).label, undefined, 'no label key means no label');
});

test('the label is written only when a picked table has a row filter to name', async () => {
  const T = await lib('tableScope.js');
  const text = T.serializeTableScopes(SCOPE, [ORDERS], 'Starbucks');
  assert.deepEqual(JSON.parse(text), { ...SCOPE, use_case_label: 'Starbucks' });
  const columnsOnly = { [ORDERS]: { columns: ['brand_name'], rows: [] } };
  assert.equal(T.serializeTableScopes(columnsOnly, [ORDERS], 'Starbucks'), JSON.stringify(columnsOnly), 'no row filter, no label written');
  assert.equal(T.serializeTableScopes(SCOPE, [ORDERS], '   '), JSON.stringify(SCOPE), 'a blank label is not written');
  assert.equal(T.serializeTableScopes(SCOPE, [WEB], 'Starbucks'), '', 'a table no longer picked drops its scope and the label');
});

test('the label prefill is the values of the is and is-one-of row filters, joined naturally, for picked tables only', async () => {
  const T = await lib('tableScope.js');
  const W = await lib('implementWizard.js');
  const filterLabelOf = (scopes, tables) => W.joinWords(T.filterValuesOf(scopes, tables));
  assert.equal(filterLabelOf(SCOPE, [ORDERS]), 'Starbucks');
  const several = {
    [ORDERS]: { columns: ['a'], rows: [{ column: 'brand_name', op: 'in', values: ['Starbucks', 'Costa'] }] },
    [WEB]: { columns: ['b'], rows: [{ column: 'region', op: '=', values: ['EMEA'] }, { column: 'total', op: '>=', values: ['10'] }] },
  };
  assert.equal(filterLabelOf(several, [ORDERS, WEB]), 'Starbucks, Costa and EMEA', 'the at-least filter names no value');
  assert.equal(filterLabelOf(several, [ORDERS]), 'Starbucks and Costa');
  assert.equal(filterLabelOf({ [ORDERS]: { columns: ['a'], rows: [] } }, [ORDERS]), '', 'no row filter, nothing to prefill');
  assert.deepEqual(T.filteredTablesOf(several, [ORDERS, WEB]), [ORDERS, WEB]);
});

test('the job validation keeps the label, so the notebook receives it', () => {
  const params = { '01_uc_metadata': `${ORDERS}`, '17_table_scope': JSON.stringify({ ...SCOPE, use_case_label: 'Starbucks' }) };
  const kept = jobParams.validateTableScopeParams(params);
  assert.equal(JSON.parse(kept['17_table_scope']).use_case_label, 'Starbucks');
  assert.deepEqual(Object.keys(JSON.parse(kept['17_table_scope'])), [ORDERS, 'use_case_label']);
});

test('the Implement readiness count applies the Launch row filters and is bounded by the Launch columns (REQ-021)', async () => {
  const w = await lib('implementWizard.js');
  const spec = {
    data: {
      tables: {},
      column_roles: { entity_id: `${ORDERS}.order_id`, measure: `${ORDERS}.total_sales` },
      filters: [{ table: ORDERS, column: 'location', op: 'in', values: ['Berlin'] }],
      window: {},
    },
  };
  const row = { primary_table: ORDERS, tables: [ORDERS] };
  const got = w.readinessScope(spec, row, { [ORDERS]: SCOPE[ORDERS] });
  assert.deepEqual(got.filters, [
    { table: ORDERS, column: 'brand_name', op: '=', values: ['Starbucks'] },
    { table: ORDERS, column: 'location', op: 'in', values: ['Berlin'] },
  ], 'the Launch row filter is counted, next to the wizard filter');
  assert.deepEqual(got.columns, ['total_sales'], 'order_id is outside the Launch columns, so only total_sales is read');
  const noRoleInside = { data: { ...spec.data, column_roles: { entity_id: `${ORDERS}.order_id` } } };
  assert.deepEqual(w.readinessScope(noRoleInside, row, { [ORDERS]: SCOPE[ORDERS] }).columns, SCOPE[ORDERS].columns,
    'no role inside the Launch columns: the Launch columns bound the read');
  assert.deepEqual(w.readinessScope(spec, row, {}).filters, spec.data.filters, 'no Launch scope: the count is unchanged');
  assert.deepEqual(w.readinessScope(spec, row, {}).columns, ['order_id', 'total_sales'], 'no Launch scope: every role column is read');
});
