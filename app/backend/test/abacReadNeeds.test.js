// The ABAC policy read (GET /api/2.1/unity-catalog/policies/table) needs READ METADATA on the table (Unity Catalog docs, privileges:
// "READ METADATA ... Row filters and column masks, Attribute-based access control (ABAC) policies"). BROWSE does not expose policies,
// MANAGE and ALL PRIVILEGES do not include READ METADATA, and a READ METADATA grant on a schema or catalog is inherited by its tables.
const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const { appReadPermissions, readStatements } = require('../lib/permissions');

const SP = 'sp-app-id';
const ROW = (level, privilege, principal = SP, mine = 'false') => ({ level, privilege, principal, mine, me: 'owner@example.com' });
const APP_READS = [ROW('catalog', 'USE CATALOG'), ROW('schema', 'USE SCHEMA'), ROW('catalog', 'SELECT')];
// What the App still needs on the table: a need with no owner in the facts is a grant Inspire runs, otherwise a gap; both count as missing.
const missingOf = (rows, refused) => {
  const plan = I.accessPlan('main.s.orders', rows, SP, { needs: I.IMPLEMENT_SOURCE_NEEDS, refused });
  return [...plan.grants, ...plan.gaps].map((g) => g.privilege);
};

test('BROWSE on the catalog does not cover READ METADATA: the App still needs it (must fail before the fix)', () => {
  assert.deepEqual(missingOf([...APP_READS, ROW('catalog', 'BROWSE')]), ['READ METADATA']);
});

test('MANAGE held by the App does not cover READ METADATA, per the MANAGE doc (must fail before the fix)', () => {
  assert.deepEqual(missingOf([...APP_READS, ROW('catalog', 'MANAGE')]), ['READ METADATA']);
});

test('ALL PRIVILEGES does not include READ METADATA, per the ALL PRIVILEGES doc (must fail before the fix)', () => {
  assert.deepEqual(missingOf([...APP_READS, ROW('catalog', 'ALL PRIVILEGES')]), ['READ METADATA']);
});

test('a READ METADATA grant on the schema or the catalog covers the table: the inherited grant is what the doc describes', () => {
  assert.deepEqual(missingOf([...APP_READS, ROW('schema', 'READ METADATA')]), []);
  assert.deepEqual(missingOf([...APP_READS, ROW('catalog', 'READ METADATA', 'account users')]), []);
});

test('a refused ABAC read overrides a held-looking grant: the refusal is the live truth and READ METADATA is asked again (must fail before the fix)', () => {
  const held = [...APP_READS, ROW('schema', 'READ METADATA')];
  assert.deepEqual(missingOf(held), []);
  assert.deepEqual(missingOf(held, ['READ METADATA']), ['READ METADATA']);
});

test('the refusal override names the grant for a principal that may grant it, and the rest of the plan is unchanged', () => {
  const rows = [...APP_READS, ROW('table', 'OWNER', 'data-eng'), ROW('catalog', 'MANAGE', 'builder@example.com', 'true')];
  const plan = I.accessPlan('main.s.orders', rows, SP, { needs: I.IMPLEMENT_SOURCE_NEEDS, refused: ['READ METADATA'] });
  assert.deepEqual(plan.gaps, []);
  assert.deepEqual(plan.grants.map((g) => g.privilege), ['READ METADATA']);
});

test('the Discover dialog names the plan grant, READ METADATA at schema level, not the three read grants (must fail before the fix)', () => {
  const offer = { app: { id: SP, name: 'inspire-app' }, tables: ['main.s.orders'], can_grant: false, builtin: [],
    grants: [`GRANT READ METADATA ON TABLE \`main\`.\`s\`.\`orders\` TO \`${SP}\``] };
  const read = appReadPermissions({ app_unreadable: { ...offer, text: 'x' }, missing: [] }, SP);
  assert.deepEqual(read.permissions[0].statements, [`GRANT READ METADATA ON TABLE \`main\`.\`s\`.\`orders\` TO \`${SP}\``]);
});

test('a source the App cannot probe names every source need, READ METADATA included, at schema level (must fail before the fix)', () => {
  const read = appReadPermissions({ app_unreadable: null, missing: [{ table: 'main.s.orders', reason: 'no read access' }] }, SP);
  assert.ok(read.permissions[0].statements.includes(`GRANT READ METADATA ON TABLE \`main\`.\`s\`.\`orders\` TO \`${SP}\``), JSON.stringify(read.permissions[0]));
  assert.ok(read.permissions[0].statements.includes(`GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${SP}\``), JSON.stringify(read.permissions[0]));
});

test('an ABAC refusal with no grant left to name gives a warning, never an empty dialog (must-exclude)', () => {
  const read = appReadPermissions({ app_unreadable: { tables: ['main.s.orders'], app: { id: SP, name: 'inspire-app' }, grants: [], can_grant: false,
    builtin: [], text: 'x' }, missing: [] }, SP);
  assert.deepEqual(read.permissions, []);
  assert.equal(read.warnings.length, 1);
});

test('a person read keeps its three grants: the App-only READ METADATA is not added to what a person reads (regression guard)', () => {
  assert.deepEqual(readStatements('main.s.orders', 'bob@example.com'), [
    'GRANT USE CATALOG ON CATALOG `main` TO `bob@example.com`',
    'GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `bob@example.com`',
    'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `bob@example.com`']);
});
