const test = require('node:test');
const assert = require('node:assert/strict');
const PM = require('../lib/permissions');
const { readStatementsFor } = PM;

const APP = '11111111-2222-3333-4444-555555555555';

test('a permission carries its statements once, its principal and its reason, and an empty list is no permission', () => {
  const p = PM.permissionRequired({ statements: ['GRANT SELECT ON TABLE `a`.`b`.`c` TO `x`', ' GRANT SELECT ON TABLE `a`.`b`.`c` TO `x` ', ''], principal: 'the App', why: 'Discover reads it' });
  // SEC-01 (W3): the table read stays table-level, once.
  assert.deepEqual(p, { statements: ['GRANT SELECT ON TABLE `a`.`b`.`c` TO `x`'], instructions: [], steps: [], principal: 'the App', why: 'Discover reads it' });
  assert.equal(PM.permissionRequired({ statements: [], principal: 'x' }), null);
  assert.equal(PM.permissionRequired({}), null);
});

test('a table the App cannot read yields its source needs, READ METADATA included, as structured statements, never as warning text', () => {
  const found = { missing: [{ table: 'main.sales.orders', reason: 'no SELECT' }], app_unreadable: undefined };
  const got = PM.appReadPermissions(found, APP);
  assert.deepEqual(got.warnings, []);
  assert.equal(got.permissions.length, 1);
  const [permission] = got.permissions;
  assert.equal(permission.principal, APP);
  assert.deepEqual(permission.statements, [
    `GRANT USE CATALOG ON CATALOG \`main\` TO \`${APP}\``,
    `GRANT USE SCHEMA ON SCHEMA \`main\`.\`sales\` TO \`${APP}\``,
    `GRANT SELECT ON TABLE \`main\`.\`sales\`.\`orders\` TO \`${APP}\``,
    `GRANT READ METADATA ON TABLE \`main\`.\`sales\`.\`orders\` TO \`${APP}\``,
  ]);
  assert.match(permission.why, /Discover reads main\.sales\.orders as the App, and the App cannot read it yet/);
});

test('an App that cannot read a table the person can grants nothing itself: the permission names the grant its plan lacks, at schema level', () => {
  const offer = { tables: [{ table: 'main.sales.orders' }], app: { name: 'inspire-app', id: APP },
    grants: [`GRANT SELECT ON TABLE \`main\`.\`sales\`.\`orders\` TO \`${APP}\``], can_grant: false };
  const got = PM.appReadPermissions({ app_unreadable: offer, missing: [] }, APP);
  assert.deepEqual(got.permissions.map((p) => p.statements), [[`GRANT SELECT ON TABLE \`main\`.\`sales\`.\`orders\` TO \`${APP}\``]]);
  assert.equal(got.permissions[0].principal, 'inspire-app');
  assert.deepEqual(got.warnings, []);
});

test('nothing unreadable means no permission and no warning', () => {
  assert.deepEqual(PM.appReadPermissions({ missing: [] }, APP), { warnings: [], permissions: [] });
});

test('a table read needs USE CATALOG, USE SCHEMA and SELECT, in that order, once each', () => {
  assert.deepEqual(PM.readStatements('main.s.orders', APP), [
    `GRANT USE CATALOG ON CATALOG \`main\` TO \`${APP}\``,
    `GRANT USE SCHEMA ON SCHEMA \`main\`.\`s\` TO \`${APP}\``,
    `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${APP}\``,
  ]);
});

test('a schema read needs USE CATALOG and USE SCHEMA, and a catalog read needs USE CATALOG', () => {
  assert.deepEqual(PM.readStatements('main.s', APP), [
    `GRANT USE CATALOG ON CATALOG \`main\` TO \`${APP}\``,
    `GRANT USE SCHEMA ON SCHEMA \`main\`.\`s\` TO \`${APP}\``,
  ]);
  assert.deepEqual(PM.readStatements('main', APP), [`GRANT USE CATALOG ON CATALOG \`main\` TO \`${APP}\``]);
});

test('several tables sharing a schema send the shared USE grants once', () => {
  const got = PM.readStatementsFor(['main.s.a', 'main.s.b'], APP);
  assert.equal(got.filter((s) => s.startsWith('GRANT USE SCHEMA')).length, 1);
  assert.equal(got.filter((s) => s.startsWith('GRANT USE CATALOG')).length, 1);
  assert.equal(got.filter((s) => s.startsWith('GRANT SELECT')).length, 2);
});

test('the App read grant offered as a permission carries the grants its plan lacks, and repeats no grant the App holds', () => {
  const offer = { tables: [{ table: 'main.s.orders' }], app: { name: 'inspire-app', id: APP },
    grants: [`GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${APP}\``], can_grant: false };
  const [permission] = PM.appReadPermissions({ app_unreadable: offer, missing: [] }, APP).permissions;
  assert.deepEqual(permission.statements, [`GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders\` TO \`${APP}\``]);
  assert.equal(permission.principal, 'inspire-app');
});

test('the create-schema builder grant is shown with USE CATALOG first, so the schema grant works', () => {
  const grant = 'GRANT USE SCHEMA, CREATE TABLE, CREATE MODEL, SELECT, MODIFY, MANAGE ON SCHEMA `main`.`s` TO `builder-sp`';
  const p = PM.builderPermission('main', grant, 'builder-sp');
  assert.deepEqual(p.statements, ['GRANT USE CATALOG ON CATALOG `main` TO `builder-sp`', grant]);
  assert.equal(p.principal, 'builder-sp');
});

test('the publish check names the read grant for each gap as statements, with the principal', () => {
  const I = require('../lib/inspireImplement');
  const gaps = [{ level: 'table', privilege: 'SELECT', object: '`main`.`s`.`orders`' }, { level: 'schema', privilege: 'USE SCHEMA', object: '`main`.`s`' }];
  const p = I.appAccessPermission(gaps, 'inspire-sp');
  assert.deepEqual(p.statements, ['GRANT SELECT ON TABLE `main`.`s`.`orders` TO `inspire-sp`', 'GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `inspire-sp`']);
  assert.equal(p.principal, 'inspire-sp');
});

test('a workspace folder the App cannot write to is shown as copyable steps, not SQL, with the Share step and the CLI line', () => {
  const p = PM.folderPermission('/Workspace/Users/pat@example.com/inspire_output', 'inspire-sp');
  assert.deepEqual(p.statements, []);
  assert.deepEqual(p.instructions, [], 'the steps are copied with Copy steps, not shown as plain notes');
  assert.equal(p.steps[0], 'In Workspace, open /Workspace/Users/pat@example.com/inspire_output > Share, add inspire-sp with Can Edit');
  assert.ok(p.steps.some((line) => line.startsWith('databricks api patch /api/2.0/permissions/directories/')), JSON.stringify(p.steps));
  assert.equal(p.principal, 'inspire-sp');
  assert.equal(PM.folderPermission('', 'inspire-sp'), null);
});

test('the output refusal body carries the folder permission for the dialog', () => {
  const U = require('../lib/ucReads');
  const body = U.writeRefusalBody('POST /api/run', { status: 403, message: 'cannot save', unwritable: ['/x'], permissions: [PM.folderPermission('/x', 'sp')] });
  assert.equal(body.permissions[0].principal, 'sp');
  assert.deepEqual(body.unwritable, ['/x']);
});

// REQ-408: the dialog payload is coarse at the choke point (permissionRequired), so every builder inherits it.
test('SEC-01 (W3): ten tables in one schema stay ten table-level SELECTs, with USE CATALOG and USE SCHEMA once each', () => {
  const tables = Array.from({ length: 10 }, (_, i) => `GRANT SELECT ON TABLE \`main\`.\`s\`.\`t${i}\` TO \`${APP}\``);
  const head = [`GRANT USE CATALOG ON CATALOG \`main\` TO \`${APP}\``, `GRANT USE SCHEMA ON SCHEMA \`main\`.\`s\` TO \`${APP}\``];
  const p = PM.permissionRequired({ statements: [...head, ...tables], principal: APP });
  assert.deepEqual(p.statements, [...head, ...tables]);
});

test('SEC-01 (W3): a whole-catalog pick stays table-level too', () => {
  const p = PM.permissionRequired({ statements: readStatementsFor(['main.s.a', 'main.s.b'], APP), principal: APP, wholeCatalogs: ['main'] });
  assert.deepEqual(p.statements.filter((s) => /^GRANT SELECT ON (SCHEMA|CATALOG)/.test(s)), []);
  assert.ok(p.statements.includes(`GRANT SELECT ON TABLE \`main\`.\`s\`.\`a\` TO \`${APP}\``));
});

test('REQ-408: a MODIFY on a table stays exact at table level', () => {
  const modify = `GRANT MODIFY ON TABLE \`main\`.\`s\`.\`out\` TO \`${APP}\``;
  assert.deepEqual(PM.permissionRequired({ statements: [modify], principal: APP }).statements, [modify]);
});

// REQ-408 must-keep: a user-authorization App's viewers get table-level view grants only, so the dialog never widens them to a schema.
test('REQ-408 must-keep: exact keeps the table-level view grant a viewer is given (no schema widening)', () => {
  const view = `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders_scope\` TO \`${APP}\``;
  assert.deepEqual(PM.permissionRequired({ statements: [view], principal: APP, exact: true }).statements, [view]);
  assert.deepEqual(PM.permissionRequired({ statements: [view], principal: APP }).statements, [view]);
});
