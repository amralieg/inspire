const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');

const SP = 'fd5bc9c6-5c93-4266-9dc4-71c1eb3b12d7';
const ROW = (level, privilege, principal = SP) => ({ level, privilege, principal, mine: 'false', me: 'owner@example.com' });

test('a catalog-level BROWSE, USE CATALOG, USE SCHEMA and SELECT the App inherits means it reads the table: no READ METADATA grant is issued', () => {
  const rows = [ROW('catalog', 'USE CATALOG'), ROW('catalog', 'USE SCHEMA'), ROW('catalog', 'SELECT'), ROW('catalog', 'BROWSE')];
  const plan = I.accessPlan('sample_catalog.sales.customer', rows, SP, { needs: I.IMPLEMENT_SOURCE_NEEDS });
  assert.deepEqual(plan.grants, [], 'no grant is issued for an App that already reads through the catalog');
  assert.deepEqual(plan.gaps, []);
});

test('without BROWSE and without MANAGE the App still needs READ METADATA on the table (the probe is not silenced)', () => {
  const rows = [ROW('catalog', 'USE CATALOG'), ROW('catalog', 'USE SCHEMA'), ROW('catalog', 'SELECT')];
  const plan = I.accessPlan('sample_catalog.sales.customer', rows, SP, { needs: I.IMPLEMENT_SOURCE_NEEDS });
  assert.ok(plan.gaps.concat(plan.grants).some((g) => g.privilege === 'READ METADATA'));
});
