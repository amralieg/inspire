const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');

const SOURCE = 'main.s.orders';
const APP = 'app-sp-id';

test('a source plan never grants SELECT or MODIFY on a catalog or schema, even when the builder owns both (must-exclude)', () => {
  const rows = [
    { level: 'catalog', privilege: 'OWNER', principal: 'builder@x', mine: true, me: 'builder@x' },
    { level: 'schema', privilege: 'OWNER', principal: 'builder@x', mine: true, me: 'builder@x' },
    { level: 'table', privilege: 'OWNER', principal: 'builder@x', mine: true, me: 'builder@x' },
  ];
  const plan = I.accessPlan(SOURCE, rows, APP, { needs: I.IMPLEMENT_SOURCE_NEEDS });
  const planned = plan.grants.map((g) => [g.privilege, g.level, g.object]);
  assert.deepEqual(planned, [
    ['USE CATALOG', 'catalog', '`main`'],
    ['USE SCHEMA', 'schema', '`main`.`s`'],
    ['SELECT', 'table', '`main`.`s`.`orders`'],
    ['READ METADATA', 'table', '`main`.`s`.`orders`'],
  ]);
  for (const g of planned) {
    if (['SELECT', 'MODIFY', 'ALL PRIVILEGES'].includes(g[0])) assert.equal(g[1], 'table', `${g[0]} is only planned on the table`);
  }
});

test('a plan with no rows and no ownership still never names SELECT on the catalog or the schema', () => {
  const plan = I.accessPlan(SOURCE, [], APP, { needs: I.IMPLEMENT_SOURCE_NEEDS });
  for (const g of [...plan.grants, ...plan.gaps]) {
    if (g.privilege === 'SELECT' || g.privilege === 'MODIFY') assert.equal(g.level, 'table');
  }
});
