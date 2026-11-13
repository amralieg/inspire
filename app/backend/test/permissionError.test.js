const test = require('node:test');
const assert = require('node:assert/strict');
const { deniedObjectOf, permissionFor } = require('../lib/permissionError');

const SCHEMA_DENIED = "[PERMISSION_DENIED] User does not have USE SCHEMA on Schema 'adb_fe_uae_01.demo_telco'.";
const TABLE_DENIED = "[PERMISSION_DENIED] User does not have SELECT on Table 'adb_fe_uae_01.demo_telco.customers'.";
const CATALOG_DENIED = "[PERMISSION_DENIED] User does not have USE CATALOG on Catalog 'adb_fe_uae_01'.";
const PERSON = 'harness.person@example.com';

test('a schema refusal maps to USE CATALOG, USE SCHEMA and SELECT on the schema for the named principal', () => {
  const p = permissionFor(SCHEMA_DENIED, PERSON);
  assert.deepEqual(p.statements, [
    `GRANT USE CATALOG ON CATALOG \`adb_fe_uae_01\` TO \`${PERSON}\``,
    `GRANT USE SCHEMA ON SCHEMA \`adb_fe_uae_01\`.\`demo_telco\` TO \`${PERSON}\``,
    `GRANT SELECT ON SCHEMA \`adb_fe_uae_01\`.\`demo_telco\` TO \`${PERSON}\``,
  ]);
  assert.equal(p.principal, PERSON);
  assert.equal(p.why, 'Inspire reads this with your own access. Ask your workspace admin to run these commands, then click Try again.');
});

test('a table refusal maps to USE CATALOG, USE SCHEMA and SELECT on the table', () => {
  const p = permissionFor(TABLE_DENIED, PERSON);
  assert.ok(p.statements.includes(`GRANT SELECT ON TABLE \`adb_fe_uae_01\`.\`demo_telco\`.\`customers\` TO \`${PERSON}\``));
  assert.ok(p.statements.some((s) => s.startsWith('GRANT USE SCHEMA ON SCHEMA')));
});

test('a catalog refusal maps to USE CATALOG only on the catalog', () => {
  const p = permissionFor(CATALOG_DENIED, PERSON);
  assert.deepEqual(p.statements, [`GRANT USE CATALOG ON CATALOG \`adb_fe_uae_01\` TO \`${PERSON}\``]);
});

test('with no principal the mapper fails closed: no permission, never a GRANT with a blank grantee', () => {
  assert.equal(permissionFor(SCHEMA_DENIED, ''), null);
  assert.equal(permissionFor(SCHEMA_DENIED, '   '), null);
  assert.equal(permissionFor(SCHEMA_DENIED, undefined), null);
  assert.equal(permissionFor(SCHEMA_DENIED, null), null);
});

test('a message that is not a permission refusal maps to nothing', () => {
  assert.equal(permissionFor('Table not found: adb_fe_uae_01.demo_telco.customers', PERSON), null);
  assert.equal(deniedObjectOf('[PERMISSION_DENIED] something without an object'), null);
});

test('a volume refusal maps to nothing (volumes are not in the grant set)', () => {
  assert.equal(permissionFor("[PERMISSION_DENIED] User does not have READ VOLUME on Volume 'c.s.v'.", PERSON), null);
});
