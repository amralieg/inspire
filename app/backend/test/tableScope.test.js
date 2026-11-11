const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const jobParams = require('../lib/inspireJobParams');
const implement = require('../lib/inspireImplement');

const ORDERS = 'main.sales.orders';
const SCOPE = {
  [ORDERS]: {
    columns: ['brand_name', 'location', 'total_sales'],
    rows: [{ column: 'brand_name', op: '=', values: ['Starbucks'] }],
  },
};

test('a scope names the columns read and the row filters kept, and a bad scope is refused with the reason', async () => {
  const T = await lib('tableScope.js');
  const ok = T.scopesFromObject(SCOPE);
  assert.deepEqual(ok.problems, []);
  assert.deepEqual(ok.scopes[ORDERS], SCOPE[ORDERS]);
  assert.deepEqual(T.scopesFromObject(undefined), { scopes: {}, problems: [] });
  assert.match(T.scopesFromObject({ orders: SCOPE[ORDERS] }).problems[0], /must be a catalog\.schema\.table name/);
  assert.match(T.scopesFromObject({ [ORDERS]: { columns: [], rows: [] } }).problems[0], /Pick at least one column/);
  assert.match(T.scopesFromObject({ [ORDERS]: { columns: ['a'], rows: [{ column: 'a', op: 'like', values: ['x'] }] } }).problems[0], /operator/);
  assert.throws(() => jobParams.validateTableScopeParams({ '01_uc_metadata': 'main.sales', '17_table_scope': '{nope' }), /not valid JSON/);
  assert.throws(() => jobParams.validateTableScopeParams({ '01_uc_metadata': 'main.sales', '17_table_scope': '["x"]' }), /Table scope/);
});

test('every filter operator takes the number of values its wizard row shows, and an empty value is refused', async () => {
  const T = await lib('tableScope.js');
  const row = (op, values, column = 'amount') => ({ column, op, values });
  assert.deepEqual(T.scopeProblems({ columns: ['a'], rows: [row('between', ['1', '9'])] }), []);
  assert.match(T.scopeProblems({ columns: ['a'], rows: [row('between', ['1'])] })[0], /needs two values/);
  assert.match(T.scopeProblems({ columns: ['a'], rows: [row('>=', [])] })[0], /needs one value/);
  assert.deepEqual(T.scopeProblems({ columns: ['a'], rows: [row('is null', [])] }), []);
  assert.match(T.scopeProblems({ columns: ['a'], rows: [row('is null', ['x'])] })[0], /needs no value/);
  assert.match(T.scopeProblems({ columns: ['a'], rows: [row('in', [])] })[0], /needs at least one value/);
  assert.match(T.scopeProblems({ columns: ['a'], rows: [row('=', [''])] })[0], /empty value/);
  assert.match(T.scopeProblems({ columns: ['a'], rows: [{ column: '', op: '=', values: ['x'] }] })[0], /needs a column/);
});

test('a filter column may be any column of the table, and a column the table lacks is refused', async () => {
  const T = await lib('tableScope.js');
  const table = ['brand_name', 'location', 'total_sales', 'store_id'];
  const scope = { columns: ['brand_name', 'location', 'total_sales'], rows: [{ column: 'store_id', op: '=', values: ['7'] }] };
  assert.deepEqual(T.scopeProblems(scope, table), [], 'store_id is not selected but a filter may use it');
  assert.deepEqual(T.scopeProblems({ columns: ['nope'], rows: [] }, table), ['Column nope is not in this table.']);
  assert.match(T.scopeProblems({ columns: ['brand_name'], rows: [{ column: 'ghost', op: '=', values: ['1'] }] }, table).join(' '),
    /Filter 1 uses ghost, which is not in this table/);
});

test('the job parameter keeps only tables still picked and only valid scopes, so a run never reads an unpicked table', async () => {
  const T = await lib('tableScope.js');
  const text = T.serializeTableScopes({ ...SCOPE, 'main.sales.returns': SCOPE[ORDERS] }, [ORDERS]);
  assert.deepEqual(Object.keys(JSON.parse(text)), [ORDERS]);
  assert.equal(T.serializeTableScopes(SCOPE, []), '', 'no picked table, no scope text');
  assert.equal(T.serializeTableScopes({ [ORDERS]: { columns: [], rows: [] } }, [ORDERS]), '', 'a scope with no column is never sent');
  assert.equal(T.tableScopeOf(SCOPE, 'MAIN.SALES.ORDERS').columns.length, 3, 'the table is matched without regard to case');
});

test('the scope summary names the columns and the filters in business words', async () => {
  const T = await lib('tableScope.js');
  assert.equal(T.tableScopeSummary(SCOPE[ORDERS]), '3 columns, rows where brand_name is Starbucks');
  assert.equal(T.tableScopeSummary({ columns: ['a'], rows: [] }), '1 column, all rows');
  assert.equal(T.tableScopeSummary({ columns: ['a'], rows: [{ column: 'x', op: 'is null', values: [] }] }), '1 column, rows where x is empty');
});

test('the job parameter is validated in the backend and reaches the notebook only when a table is picked', () => {
  const text = JSON.stringify(SCOPE);
  const kept = jobParams.validateTableScopeParams({ '01_uc_metadata': 'main.sales', '17_table_scope': text });
  assert.equal(JSON.parse(kept['17_table_scope'])[ORDERS].columns.length, 3);
  assert.throws(() => jobParams.validateTableScopeParams({ '01_uc_metadata': 'main.other', '17_table_scope': text }),
    /Table scope names main\.sales\.orders, which is not picked/);
  assert.throws(() => jobParams.validateTableScopeParams({ '01_uc_metadata': 'main.sales.orders', '17_table_scope': '{"main.sales.orders":{"columns":[]}}' }),
    /Pick at least one column/);
  const none = jobParams.validateTableScopeParams({ '01_uc_metadata': 'main.sales', '17_table_scope': '' });
  assert.equal('17_table_scope' in none, false, 'an empty scope is not sent to the notebook');
  assert.ok(jobParams.INSPIRE_NOTEBOOK_WIDGET_KEYS.includes('17_table_scope'));
});

test('the readiness row count and the Filter rows share one builder: is-null and typed range filters are real SQL', () => {
  const sql = (filters) => implement.readinessStatement('main.sales.orders', { filters }).sql;
  assert.equal(sql([{ column: 'note', op: 'is null', values: [] }]),
    'SELECT COUNT(*) AS row_count FROM `main`.`sales`.`orders` WHERE `note` IS NULL');
  assert.equal(sql([{ column: 'total_sales', op: '>=', values: ['100'] }]),
    'SELECT COUNT(*) AS row_count FROM `main`.`sales`.`orders` WHERE `total_sales` >= :f0_0');
  assert.equal(sql([{ column: 'brand_name', op: '=', values: ['Starbucks'] }]),
    'SELECT COUNT(*) AS row_count FROM `main`.`sales`.`orders` WHERE CAST(`brand_name` AS STRING) = :f0_0');
  assert.equal(sql([{ column: 'total_sales', op: 'between', values: ['1', '9'] }]),
    'SELECT COUNT(*) AS row_count FROM `main`.`sales`.`orders` WHERE `total_sales` BETWEEN :f0_0 AND :f0_1');
  assert.throws(() => sql([{ column: 'x', op: 'like', values: ['a'] }]), /operator 'like' is not supported/);
});

test('a Generate run rebuilt from a session carries the scope that session saved, and no scope key when it saved none', () => {
  const { notebookParamsFromSessionForGenerateRun } = require('../lib/inspireSessionParams');
  const session = { business_name: 'Acme', inspire_database_name: 'main.insp', tables_str: 'main.sales.orders', table_scope: JSON.stringify(SCOPE) };
  const kept = notebookParamsFromSessionForGenerateRun(session, '42');
  assert.equal(kept['17_table_scope'], JSON.stringify(SCOPE));
  assert.equal(kept['15_operation'], 'Generate Use Cases');
  const plain = notebookParamsFromSessionForGenerateRun({ business_name: 'Acme', tables_str: 'main.sales.orders' }, '42');
  assert.equal('17_table_scope' in plain, false);
});
