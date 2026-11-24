// SEC-01 AT4 (W3, D3): a read grant stays table-level. permissionRequired keeps the exact statements by default; coarseGrants is no
// longer applied to read grants, because a schema-level SELECT opens every unrelated table in that schema.
const test = require('node:test');
const assert = require('node:assert/strict');
const { permissionRequired } = require('../lib/permissions');

const TABLE_GRANT = 'GRANT SELECT ON TABLE `c`.`s`.`t` TO `sp`';

test('AT4: permissionRequired keeps a table-level SELECT as it is, with no schema-level SELECT', () => {
  const got = permissionRequired({ statements: [TABLE_GRANT] });
  const wider = got.statements.filter((sql) => /^GRANT\s+SELECT\s+ON\s+(SCHEMA|CATALOG)\b/i.test(sql));
  assert.deepEqual(wider, [], `AT4: permissionRequired widened a table grant to ${JSON.stringify(wider)} (coarseGrants is still applied)`);
  assert.deepEqual(got.statements, [TABLE_GRANT], `AT4: the table-level statement must come back unchanged: ${JSON.stringify(got.statements)}`);
});

test('AT4: two tables of one schema stay two table-level grants', () => {
  const two = [TABLE_GRANT, 'GRANT SELECT ON TABLE `c`.`s`.`u` TO `sp`'];
  const got = permissionRequired({ statements: two });
  assert.deepEqual(got.statements, two, `AT4: approving two tables must not open the whole schema: ${JSON.stringify(got.statements)}`);
});
