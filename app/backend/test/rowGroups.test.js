const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const { makeApp, listen } = require('./support/implementApp');

const PERSON = 'person-tok';
const TABLE = 'main.s.orders';
const GROUPS = [{ column: 'brand_name', op: 'in', values: ['Tokyo Tidbits', 'Golden Gate Ginger'], group: true }];
const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

test('Load groups counts one column top 500 by row count, and leaves the null group out', () => {
  const st = I.groupCountsStatement(TABLE, ['brand_name'], { top: 500 });
  assert.match(st.sql, /ORDER BY records DESC/);
  assert.match(st.sql, /LIMIT 501/, 'one row over the cap, so the route can tell the list was cut');
  assert.match(st.sql, /`brand_name` IS NOT NULL/);
});

test('Load groups on a second column reads only the rows inside the groups already picked', () => {
  const st = I.groupCountsStatement(TABLE, ['location'], { top: 500, filters: GROUPS });
  assert.match(st.sql, /CAST\(`brand_name` AS STRING\) IN \(/);
  assert.deepEqual(st.parameters.map((p) => p.value), ['Tokyo Tidbits', 'Golden Gate Ginger']);
});

test('the group-counts route caps Load groups at 500 and sends the picked groups as the person', async () => {
  const groupCounts = Array.from({ length: 501 }, (_, i) => ({ brand_name: `brand ${i}`, records: String(1000 - i) }));
  const made = makeApp({ forwardedToken: PERSON, groupCounts });
  const srv = await listen(made.app);
  let body;
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/group-counts?warehouse_id=wh1`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ table: TABLE, columns: ['brand_name'], filters: GROUPS, top: 500 }),
    });
    assert.equal(resp.status, 200);
    body = await resp.json();
  } finally {
    await srv.close();
  }
  assert.equal(body.groups.length, 500, 'at most 500 values are returned');
  assert.equal(body.truncated, true, 'the list says it was cut');
  assert.equal(body.groups[0].brand_name, 'brand 0');
  const call = made.sqlCalls.find((c) => /ORDER BY records DESC/.test(c.sql));
  assert.ok(call, 'the top-500 statement ran');
  assert.equal(call.token, PERSON, 'it runs as the person, not the App');
  assert.ok(call.parameters.some((p) => p.value === 'Tokyo Tidbits'), 'the picked group narrows the statement');
});

test('the grouping profile reads only the rows inside the Launch scope of its table', async () => {
  const made = makeApp({
    forwardedToken: PERSON, forwardedEmail: 'amr@example.com',
    useCase: { id: 'N01-U01', primary_table: TABLE, tables_involved: TABLE, analytics_technique: 'Anomaly Detection' },
    session: {
      business_name: 'Acme', tables_str: TABLE, catalogs: '', schemas_str: '', inspire_database_name: 'main.inspire', generation_path: '/tmp/out',
      table_scope: JSON.stringify({ [TABLE]: { columns: ['brand_name', 'location'], rows: [{ column: 'brand_name', op: '=', values: ['Tokyo Tidbits'] }] } }),
    },
  });
  const srv = await listen(made.app);
  try {
    await fetch(`${srv.url}/api/grouping/profile`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ inspire_database: 'main.inspire', session_id: '42', use_case_id: 'N01-U01', warehouse_id: 'wh1' }),
    });
  } finally {
    await srv.close();
  }
  const scoped = made.sqlCalls.filter((c) => c.sql.includes('(SELECT `brand_name`, `location` FROM `main`.`s`.`orders` WHERE'));
  assert.ok(scoped.length >= 1, `the profile statements read the scoped rows and columns (${scoped.length} found)`);
  assert.ok(!made.sqlCalls.some((c) => c.sql.includes('SELECT * FROM `main`.`s`.`orders`')), 'no profile statement reads every column of the table');
  assert.ok(scoped.every((c) => c.parameters.some((p) => p.value === 'Tokyo Tidbits')), 'every scoped statement carries the scope value');
});

test('the label names only the picked groups: one to three joined, more than three as the first two and N more; a row filter names nothing', async () => {
  const T = await lib('tableScope.js');
  const W = await lib('implementWizard.js');
  const groupsOf = (values) => ({ [TABLE]: { columns: ['brand_name'], rows: [{ column: 'brand_name', op: 'in', values, group: true }] } });
  const filterOnly = { [TABLE]: { columns: ['brand_name'], rows: [{ column: 'brand_name', op: '=', values: ['Starbucks'] }] } };
  assert.equal(W.groupLabelOf(['Tokyo Tidbits']), 'Tokyo Tidbits');
  assert.equal(W.groupLabelOf(['Tokyo Tidbits', 'Golden Gate Ginger']), 'Tokyo Tidbits and Golden Gate Ginger');
  assert.equal(W.groupLabelOf(['A', 'B', 'C']), 'A, B and C');
  assert.equal(W.groupLabelOf(['A', 'B', 'C', 'D', 'E']), 'A and B and 3 more');
  assert.equal(T.filterValuesOf(filterOnly, [TABLE]).length, 0, 'an is filter feeds no label');
  assert.deepEqual(T.filterValuesOf(groupsOf(['Tokyo Tidbits']), [TABLE]), ['Tokyo Tidbits']);
  assert.equal(T.serializeTableScopes(filterOnly, [TABLE], 'Anything'), JSON.stringify({ [TABLE]: { columns: ['brand_name'], rows: [{ column: 'brand_name', op: '=', values: ['Starbucks'] }] } }),
    'a label is written only when a group names it');
});
