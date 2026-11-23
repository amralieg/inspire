const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const Q = 'inspire_database=main.inspire&warehouse_id=wh1&session_id=42&use_case_id=N01-U01';
const OUT = 'result_table=main.inspire.churn_out';
const SOURCE = 'main.s.orders';
const PERSON = 'person-tok';

async function preflight(overrides) {
  const { app } = makeApp(overrides);
  const srv = await listen(app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/preflight?${Q}&${OUT}`);
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}

const baseOverrides = (extra) => ({
  useCase: { id: 'N01-U01', use_case: 'Assess water assets', primary_table: SOURCE, tables_involved: SOURCE },
  tokenKind: 'app',
  ...extra,
});

test('preflight refuses a source whose ABAC policies the App cannot read, even with no person sign-in (must fail before the fix)', async () => {
  const got = await preflight(baseOverrides({ abacUnreadable: true }));
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.checks.sources.ok, false, 'the build reads the policies, so the preflight must refuse');
  assert.match(got.data.checks.sources.detail, /cannot read/);
  assert.equal(got.data.ok, false);
});

test('preflight offers the READ METADATA grant for a source the App cannot read the policies of, when the person can (must fail before the fix)', async () => {
  const got = await preflight(baseOverrides({ forwardedToken: PERSON, readableTables: { tok: [SOURCE] },
    appMe: { applicationId: 'app-sp-2', displayName: 'riverside-assets' },
    workspace: ({ token, path }) => (token !== PERSON && /^\/api\/2\.1\/unity-catalog\/policies\/table\//.test(path)
      ? [{ error_code: 'PERMISSION_DENIED', message: 'User does not have READ METADATA on Table' }, 403] : undefined) }));
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.checks.sources.ok, false);
  const offer = got.data.app_unreadable;
  assert.ok(offer, 'the preflight returns the grant offer the wizard shows');
  assert.equal(offer.can_grant, true, 'the person can grant it, so the offer carries the grants');
  assert.ok(offer.grants.some((g) => /^GRANT READ METADATA ON (TABLE .*orders|SCHEMA `main`\.`s`) TO `app-sp-2`$/.test(g)),
    `READ METADATA is among the grants: ${JSON.stringify(offer.grants)}`);
});

test('a source the App cannot read the metadata of is refused before the build in two plain sentences, with the App grant action (REQ-037 negative, must fail before the fix)', async () => {
  const got = await preflight(baseOverrides({ forwardedToken: PERSON, readableTables: { tok: [SOURCE] },
    appMe: { applicationId: 'app-sp-2', displayName: 'riverside-assets' },
    probeErrors: { '`main`.`s`.`orders`': "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have USE SCHEMA on Schema 'main.s'." },
    workspace: ({ token, path }) => (token !== PERSON && /^\/api\/2\.1\/unity-catalog\/policies\/table\//.test(path)
      ? [{ error_code: 'PERMISSION_DENIED', message: 'User does not have READ METADATA on Table' }, 403] : undefined) }));
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.ok, false, 'the build stops before it starts');
  const detail = got.data.checks.sources.detail;
  assert.match(detail, /^The App cannot read the access policies of the source table, so Inspire cannot tell whether the results keep them\. The build cannot read a source table: /, detail);
  assert.doesNotMatch(detail, /\. the build /, 'the second sentence starts with a capital, never a fragment');
  // REQ-131, REQ-260: the sentence names no GRANT; the App grant action is the check's Permission Required entry (must-keep)
  assert.doesNotMatch(detail, /GRANT /, 'no GRANT in the detail (must-exclude)');
  assert.deepEqual([...got.data.checks.sources.permission.statements].sort(), [
    'GRANT READ METADATA ON SCHEMA `main`.`s` TO `app-sp-2`', 'GRANT SELECT ON SCHEMA `main`.`s` TO `app-sp-2`',
    'GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp-2`'],
  'the dialog payload asks at schema level (REQ-408)');
});

test('preflight passes when the App reads the table and its policies (must-exclude control)', async () => {
  const got = await preflight(baseOverrides({ forwardedToken: PERSON, readableTables: { tok: [SOURCE] } }));
  assert.equal(got.data.checks.sources.ok, true);
  assert.equal(got.data.app_unreadable ?? null, null);
});

test('preflight refuses a primary source the App cannot SELECT, the same refusal the build gives (must fail before the fix)', async () => {
  const denied = "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table 'main.s.orders'.";
  const got = await preflight(baseOverrides({ probeErrors: { '`main`.`s`.`orders`': denied } }));
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.checks.sources.ok, false, 'the build refuses a missing or unreadable primary table, so the preflight does too');
  // REQ-418: a table the App cannot SELECT is a grant offer, not a missing table; the sentence names no id (catalogAccess.test.js),
  // the table is named in the offer and the Permission Required entry.
  assert.doesNotMatch(got.data.checks.sources.detail, /main\.s\.orders/);
  assert.deepEqual(got.data.app_unreadable.tables, [SOURCE]);
  assert.ok(got.data.checks.sources.permission.statements.some((g) => g.includes('`main`.`s`')), JSON.stringify(got.data.checks.sources.permission));
});

test('a built-in sample the App cannot read gets one plain sentence with the copy instruction and no grant (REQ-038, must fail before the fix)', async () => {
  const SAMPLE = 'samples.bakehouse.sales_transactions';
  const denied = `[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table '${SAMPLE}'.`;
  const got = await preflight({
    useCase: { id: 'N01-U01', use_case: 'Assess sales', primary_table: SAMPLE, tables_involved: SAMPLE },
    tokenKind: 'app', forwardedToken: PERSON,
    statements: { '`samples`.`bakehouse`.`sales_transactions` LIMIT 0': (_sql, _p, token) => {
      if (token !== PERSON) throw new Error(denied);
      return { rows: [] };
    } },
  });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const offer = got.data.app_unreadable;
  assert.ok(offer, 'the preflight names the sample as unreadable');
  assert.equal(offer.can_grant, false, 'no grant button for a sample Databricks owns');
  assert.deepEqual(offer.grants, []);
  assert.match(offer.text, /^samples\.bakehouse\.sales_transactions is in a built-in sample catalog that Databricks owns, so nobody can grant the App access to it: copy the table into a catalog you own with CREATE TABLE \.\.\. AS SELECT, and use the copy$/);
  assert.doesNotMatch(offer.text, /GRANT|PERMISSION_DENIED|READ METADATA/);
});

// REQ-418 (D-SL-10B): builds run as the App's service principal, so the person's own policy read no longer decides the preflight.
// This replaced the REQ-037 person-parity test, which pinned the person-token policy read REQ-418 removed.
test('a person who cannot read a source policies does not stop the build, and the preflight never reads the policies with the person token (REQ-418, must-exclude)', async () => {
  const personPolicyReads = [];
  const got = await preflight({
    useCase: { id: 'N01-U01', use_case: 'Assess water assets', primary_table: SOURCE, tables_involved: SOURCE },
    tokenKind: 'app', forwardedToken: PERSON, me: { userName: 'amr@x', displayName: 'Amr' },
    workspace: ({ token, path }) => {
      if (token !== PERSON || !/^\/api\/2\.1\/unity-catalog\/policies\/table\//.test(path)) return undefined;
      personPolicyReads.push(path);
      return [{ error_code: 'PERMISSION_DENIED', message: 'User does not have READ METADATA on Table' }, 403];
    },
  });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.checks.sources.ok, true, got.data.checks.sources.detail);
  assert.equal(got.data.app_unreadable ?? null, null);
  assert.deepEqual(personPolicyReads, [], 'the policies are read with the App token only');
});

test('the App-side refusal for an unreadable policy opens with the same sentence the build uses for the App principal (REQ-037 parity, must fail before the fix)', async () => {
  const got = await preflight(baseOverrides({ forwardedToken: PERSON, readableTables: { tok: [SOURCE] },
    appMe: { applicationId: 'app-sp-2', displayName: 'riverside-assets' },
    workspace: ({ token, path }) => (token !== PERSON && /^\/api\/2\.1\/unity-catalog\/policies\/table\//.test(path)
      ? [{ error_code: 'PERMISSION_DENIED', message: 'User does not have READ METADATA on Table' }, 403] : undefined) }));
  assert.equal(got.data.app_unreadable.text.startsWith("The App cannot read the access policies of the source table, so Inspire cannot tell whether the results keep them. "), true, got.data.app_unreadable.text);
});
