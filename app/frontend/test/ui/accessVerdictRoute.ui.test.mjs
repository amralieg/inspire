import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER, STUDIO_STATE, builtSpec } from './implementFixtures.js';
import { BUILD_IT, closeBrowser, expandBuild, openSettings, openUi, toSummary } from './uiSupport.mjs';

test.after(closeBrowser);

const PERSON = 'person-tok';
const PREFLIGHT = '/api/inspire/implement/preflight';
const VIBE = 'Answer in euros\nCount returns by week';

const publishedRow = () => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', change_classes: 'initial', created_by: OWNER,
  updated_at: '2026-10-25T04:00:00Z', spec_json: JSON.stringify(builtSpec()), app_name: 'churn-desk', asset_status: JSON.stringify({}),
});

const scim = ({ token, path }) => (path.includes('/scim/v2/Me')
  ? [token === 'tok' ? { displayName: 'inspire-manual', applicationId: 'app-sp-id' } : { userName: OWNER, displayName: 'Owner' }]
  : undefined);

const base = (extra = {}) => ({ ...STUDIO_STATE, me: { userName: OWNER, displayName: 'Owner' }, history: [publishedRow()], workspace: scim, ...extra });

async function walkToSummary(overrides, { change = false, mount } = {}) {
  const ui = await openUi('implement', base(overrides), '', mount ? { mount } : {});
  const preflightLogs = [];
  ui.page.on('console', (m) => { if (m.text().startsWith('[preflight]')) preflightLogs.push(m.text()); });
  try {
    await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(ui.page);
    await openSettings(ui.page);
    if (change) await ui.page.getByRole('region', { name: 'Vibes', exact: true }).getByRole('textbox', { name: 'Vibes for the MVP', exact: true }).fill(VIBE, { timeout: 15000 });
    await toSummary(ui.page);
  } catch (e) {
    await ui.close();
    throw e;
  }
  return { ...ui, preflightLogs };
}

const mountPreflight = (handler) => ({ mount: (app) => app.post(PREFLIGHT, handler) });

test('the walk route asks the App for its access verdict before the Summary shows anything', async () => {
  const ui = await walkToSummary({});
  try {
    for (let i = 0; i < 60 && ui.preflightLogs.length === 0; i += 1) await ui.page.waitForTimeout(250);
    assert.ok(ui.preflightLogs.length >= 1, 'a preflight request completes on the walk route and logs its shape');
    assert.match(ui.preflightLogs[0], /^\[preflight\] \{"ok":true|^\[preflight\] error:/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Summary shows Checking access while the verdict is pending, never Nothing changed (fails before the fix)', async () => {
  const ui = await walkToSummary({ hold: { '/preflight': new Promise(() => {}) } });
  try {
    const pending = ui.page.locator('[data-access-verdict="pending"]');
    await pending.waitFor({ timeout: 15000 });
    assert.equal(await pending.innerText(), 'Checking access');
    assert.equal(await ui.page.getByRole('note', { name: 'Nothing to build' }).count(), 0, 'no unchanged note without a verdict');
    assert.equal(await ui.page.locator('footer button').filter({ hasText: /Checking access|Build it Now/ }).first().isDisabled(), true, 'no Build while the access is pending');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a preflight that errors shows Could not check access with Try again, and no Build (fails before the fix)', async () => {
  const ui = await walkToSummary({}, mountPreflight((req, res) => res.status(500).json({ error: 'Cannot reach the Databricks workspace (fetch failed)' })));
  try {
    const verdict = ui.page.locator('[data-access-verdict="error"]');
    await verdict.waitFor({ timeout: 15000 });
    assert.match(await verdict.innerText(), /Could not check access/);
    assert.equal(await ui.page.locator('[data-access-retry]').count(), 1, 'Try again is offered');
    assert.equal(await ui.page.getByRole('button', { name: BUILD_IT, exact: true }).isDisabled(), true);
    assert.deepEqual(ui.pageErrors.filter((e) => !/status of 500/.test(e)), [], 'only the injected 500 is expected');
  } finally {
    await ui.close();
  }
});

test('a preflight without a sources check is unknown, never ok, so no Build (fails before the fix)', async () => {
  const ui = await walkToSummary({}, mountPreflight((req, res) => res.json({
    ok: true, identity: 'owner', checks: { warehouse: { ok: true, detail: 'ran' }, output: { ok: true, detail: 'written' } },
  })));
  try {
    const verdict = ui.page.locator('[data-access-verdict="unknown"]');
    await verdict.waitFor({ timeout: 15000 });
    assert.match(await verdict.innerText(), /Could not check access/);
    assert.equal(await ui.page.getByRole('button', { name: BUILD_IT, exact: true }).isDisabled(), true, 'an unknown verdict never enables Build');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a verdict that is ok enables Build with no refusal (must-exclude control)', async () => {
  const ui = await walkToSummary({}, { change: true });
  try {
    const build = ui.page.getByRole('button', { name: BUILD_IT, exact: true });
    await build.waitFor({ timeout: 20000 });
    assert.equal(await build.isDisabled(), false, 'a clean verdict with a change enables Build');
    assert.equal(await ui.page.locator('[data-access-verdict="error"], [data-access-verdict="unknown"]').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the refused source reads as one plain sentence, with GRANT only under Details (REQ-041, fails before the fix)', async () => {
  const ui = await walkToSummary({ tokenKind: 'app', forwardedToken: PERSON, abacUnreadable: true, abacUnreadableAppOnly: true });
  try {
    const checks = ui.page.locator('[aria-label="Access checks"]');
    await checks.waitFor({ timeout: 20000 });
    const plain = await checks.innerText();
    assert.doesNotMatch(plain, /GRANT |PERMISSION_DENIED/, 'GRANT and PERMISSION_DENIED stay under Details');
    assert.doesNotMatch(plain, /owner@example\.com/, 'the owner is named by role, not by email');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const STORED_NO_BUSINESS_TABLE = { ...publishedRow(), spec_json: JSON.stringify({ ...builtSpec(), config: { ...builtSpec().config, result_table: 'main._inspire_n01_u01.n01_u01_results' } }) };
const NO_SCHEMA_OWN = [
  { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: OWNER },
  { level: 'catalog', privilege: 'USE_CATALOG', principal: 'account users', mine: 'true', me: OWNER },
];
const CAN_CREATE_SCHEMA = [{ kind: 'right', schema_name: '', value: 'CREATE_SCHEMA' }, { kind: 'me', schema_name: '', value: OWNER }];
const schemaOwnStatements = (rightRows) => ({
  'information_schema.schema_tags': (_sql, _params, token) => ({ rows: token === PERSON ? rightRows : [] }),
  'AS mine, current_user() AS me FROM (': { rows: NO_SCHEMA_OWN },
});

test('a first build whose result schema does not exist yet reads First run creates it and enables Build (REQ-037, fails before the fix)', async () => {
  const ui = await walkToSummary({ history: [STORED_NO_BUSINESS_TABLE], tokenKind: 'app', forwardedToken: PERSON,
    statements: schemaOwnStatements(CAN_CREATE_SCHEMA) }, { change: true });
  try {
    const checks = ui.page.locator('[aria-label="Access checks"]');
    await checks.waitFor({ timeout: 20000 });
    const plain = await checks.innerText();
    await ui.page.getByRole('button', { name: 'Change checks and plan', exact: true }).click();
    const shown = await ui.page.innerText('body');
    assert.match(shown, /First run creates it/, 'the verdict says the first run creates the schema');
    assert.doesNotMatch(plain, /does not exist or you have no access/, plain);
    assert.equal(await ui.page.locator('[data-access-verdict="error"]').count(), 0);
    const build = ui.page.getByRole('button', { name: BUILD_IT, exact: true });
    await build.waitFor({ timeout: 20000 });
    assert.equal(await build.isDisabled(), false, 'the schema the first run creates never blocks Build');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a missing result schema the person cannot create refuses Build with the missing schema named (must-exclude, REQ-037)', async () => {
  const ui = await walkToSummary({ history: [STORED_NO_BUSINESS_TABLE], tokenKind: 'app', forwardedToken: PERSON,
    statements: schemaOwnStatements([{ kind: 'me', schema_name: '', value: OWNER }]) }, { change: true });
  try {
    const checks = ui.page.locator('[aria-label="Access checks"]');
    await checks.waitFor({ timeout: 20000 });
    const plain = await checks.innerText();
    assert.match(plain, /does not exist or you have no access/, plain);
    assert.doesNotMatch(plain, /First run creates it/, plain);
    assert.equal(await ui.page.getByRole('button', { name: BUILD_IT, exact: true }).isDisabled(), true, 'a real denial keeps Build disabled');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a source the App cannot read the metadata of is refused in two plain sentences, with no sentence fragment (REQ-037 negative, fails before the fix)', async () => {
  const ui = await walkToSummary({ tokenKind: 'app', forwardedToken: PERSON, abacUnreadable: true, abacUnreadableAppOnly: true });
  try {
    const checks = ui.page.locator('[aria-label="Access checks"]');
    await checks.waitFor({ timeout: 20000 });
    const plain = await checks.innerText();
    assert.match(plain, /cannot read the access policies of the source table, so Inspire cannot tell whether the results keep them\. The build cannot read (a|\d+) source tables?: /, plain);
    assert.doesNotMatch(plain, /\. the build/, plain);
    const build = ui.page.getByRole('button', { name: BUILD_IT, exact: true });
    assert.ok(await build.count() === 0 || await build.isDisabled(), 'an unreadable source keeps Build off');
    assert.doesNotMatch(plain, /GRANT |PERMISSION_DENIED/, 'GRANT stays under Details');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
