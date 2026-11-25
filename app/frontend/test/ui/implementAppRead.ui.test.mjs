import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_READ_ACTION, NEW_APPS_ACCESS_ACTION } from '../../src/lib/implementWizard.js';
import { closeBrowser, dataToResults, onStep, openUi, until, goToStep } from './uiSupport.mjs';

test.after(closeBrowser);

const APP_TOKEN = 'tok';
const PERSON = 'person-tok';
const OWNER = ['owner', 'example.com'].join('@');
const DENIED = "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table 'main.s.orders'.";
const SCHEMA_GRANT = 'GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp-id`';
const TABLE_GRANT = 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-id`';
const METADATA_GRANT = 'GRANT READ METADATA ON TABLE `main`.`s`.`orders` TO `app-sp-id`';
// REQ-408: the dialog and the Details copy name the table reads at schema level; Grant still runs the per-table grants.
const SELECT_SCHEMA_GRANT = 'GRANT SELECT ON SCHEMA `main`.`s` TO `app-sp-id`';
const METADATA_SCHEMA_GRANT = 'GRANT READ METADATA ON SCHEMA `main`.`s` TO `app-sp-id`';
const row = (level, privilege, principal, mine) => ({ level, privilege, principal, mine: String(mine), me: OWNER });
const OWNS = [row('catalog', 'OWNER', OWNER, true), row('catalog', 'USE_CATALOG', 'account users', true), row('schema', 'OWNER', 'data-eng', false),
  row('table', 'OWNER', 'data-eng', false)];
const READS = [row('catalog', 'OWNER', 'admins', false), row('catalog', 'USE_CATALOG', 'account users', true), row('schema', 'OWNER', 'data-eng', false),
  row('table', 'OWNER', 'data-eng', false), row('table', 'SELECT', OWNER, true)];

function appCannotRead(rights, { refuse = '' } = {}) {
  const live = { appReads: false, grants: [] };
  return {
    live,
    state: {
      me: { userName: OWNER, displayName: 'Owner' },
      tokenKind: 'app',
      forwardedToken: PERSON,
      workspace: ({ token, path }) => (path.includes('/scim/v2/Me')
        ? [token === APP_TOKEN ? { displayName: 'inspire-manual', applicationId: 'app-sp-id' } : { userName: OWNER, displayName: 'Owner' }]
        : undefined),
      statements: {
        'LIMIT 0': (sql, _p, token) => {
          if (sql.includes('`orders`') && token === APP_TOKEN && !live.appReads) throw new Error(DENIED);
          return { rows: [] };
        },
        'system.information_schema.catalogs': (_sql, _p, token) => ({ rows: token === APP_TOKEN ? [] : rights.rows }),
        'GRANT ': (sql, _p, token) => {
          live.grants.push([sql, token]);
          if (refuse && sql.startsWith(refuse)) throw new Error('PERMISSION_DENIED: the grant was refused');
          if (sql === TABLE_GRANT && token !== APP_TOKEN) live.appReads = true;
          return { rows: [] };
        },
      },
    },
  };
}

const panelOf = (page) => page.getByRole('region', { name: 'App read access', exact: true });
const listOf = (panel, name) => panel.getByRole('list', { name, exact: true }).locator('li').allTextContents();
// REQ-041: the grant SQL sits under Details. Ran and failed grants are lines there, prefixed Ran: or Failed:.
const detailLines = async (panel) => (await panel.locator('[data-technical-details] pre').allTextContents()).join('\n').split('\n').filter(Boolean);
// a Permission Required modal that is open covers the panel's button: Escape closes it (ModalDialog) before the press
const dismissDialog = async (page) => {
  if (await page.locator('[data-permission-dialog]').count()) await page.keyboard.press('Escape');
};
// REQ-131, REQ-260: the statements the panel raises reach the Permission Required channel for this session (permissionBus keeps
// the shown list in sessionStorage, REQ-138: a reload does not reopen a list the person already saw). The prose never carries them.
const grantsNeeded = async (panel) => (await panel.page().evaluate(() => JSON.parse(sessionStorage.getItem('inspire.permissionStatementsShown') || '[]')))
  .filter((g) => /^GRANT /.test(g));

test('Let Inspire read these tables runs the exact grants with the person sign-in, shows them, and clears the named reason', async () => {
  const rights = { rows: OWNS };
  const { live, state } = appCannotRead(rights);
  const ui = await openUi('wizard', state);
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    const panel = panelOf(page);
    await panel.waitFor({ timeout: 15000 });
    const reasonLine = panel.locator('p').filter({ hasText: /^the build cannot read a source table/ }).first();
    await reasonLine.waitFor({ timeout: 15000 });
    const reason = await reasonLine.textContent();
    assert.match(reason, /^the build cannot read a source table: builds run as the App inspire-manual, and the App cannot read this table/);
    assert.doesNotMatch(reason.split('Ask your data owner')[0], /main\.s\.orders/, 'the sentence names no id; the statements sit in Permission Required');
    assert.doesNotMatch(reason, /swap/i);
    await until(async () => (await grantsNeeded(panel)).length === 3, 'the three statements reach the Permission Required channel (REQ-131)');
    assert.deepEqual(await grantsNeeded(panel), [SCHEMA_GRANT, TABLE_GRANT, METADATA_GRANT]);
    await dismissDialog(page); await panel.getByRole('button', { name: APP_READ_ACTION, exact: true }).click();
    const result = panel.getByRole('status', { name: 'Grant result' });
    await result.getByText('Inspire ran 3 grants with your sign-in, and the App can now read these tables', { exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await panel.getByRole('status', { name: 'Grant result' }).getByText('Granted 3, failed 0.', { exact: true }).count(), 1, 'the counts replace the Ran lines (REQ-260)');
    assert.deepEqual(live.grants, [[SCHEMA_GRANT, PERSON], [TABLE_GRANT, PERSON], [METADATA_GRANT, PERSON]], 'only the person token grants');
    await until(async () => await panel.getByRole('button', { name: APP_READ_ACTION }).count() === 0, 'the action goes once the App can read');
    assert.equal(await panel.getByText('the details for your admin are in Permission Required', { exact: false }).count(), 0, 'the context probe no longer names the table');
    assert.ok(ui.made.sqlCalls.filter((c) => c.sql === 'SELECT * FROM `main`.`s`.`orders` LIMIT 0' && c.token === APP_TOKEN).length >= 3,
      'the context is probed again after the grants');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a person who cannot grant sees the named reason and the statements with no action, and a refusal after a click grants nothing', async () => {
  const rights = { rows: READS };
  const { live, state } = appCannotRead(rights);
  const ui = await openUi('wizard', state);
  const { page } = ui;
  try {
    const panel = panelOf(page);
    await panel.waitFor({ timeout: 15000 });
    const reasonLine = panel.locator('p').filter({ hasText: /the details for your admin are in Permission Required$/ }).first();
    await reasonLine.waitFor({ timeout: 15000 });
    const reason = await reasonLine.textContent();
    assert.doesNotMatch(reason, /GRANT /, 'the sentence names no grant; the grants are in Permission Required (REQ-260)');
    await until(async () => (await grantsNeeded(panel)).length === 3, 'the three grant lines are under Details');
    assert.deepEqual(await grantsNeeded(panel), [SCHEMA_GRANT, TABLE_GRANT, METADATA_GRANT]);
    assert.equal(await panel.getByRole('button', { name: APP_READ_ACTION }).count(), 0);
    assert.deepEqual(live.grants, []);
  } finally {
    await ui.close();
  }
  const later = { rows: OWNS };
  const second = appCannotRead(later);
  const ui2 = await openUi('wizard', second.state);
  try {
    const panel = panelOf(ui2.page);
    const action = panel.getByRole('button', { name: APP_READ_ACTION, exact: true });
    await action.waitFor({ timeout: 15000 });
    later.rows = READS;
    await dismissDialog(ui2.page); await action.click();
    const result = panel.getByRole('status', { name: 'Grant result' });
    await result.getByText(/^Your grant was refused: the build cannot read a source table: builds run as the App inspire-manual, and the App cannot read this table/).waitFor({ timeout: 15000 });
    assert.match(await result.locator('p').first().textContent(), /the details for your admin are in Permission Required$/);
    assert.doesNotMatch(await result.textContent(), /GRANT /, 'the refusal prose names no GRANT (REQ-260)');
    await until(async () => (await grantsNeeded(panel)).length === 3, 'the three statements reach the Permission Required channel (REQ-131)');
    assert.deepEqual(await grantsNeeded(panel), [SCHEMA_GRANT, TABLE_GRANT, METADATA_GRANT]);
    await until(async () => await panel.getByRole('button', { name: APP_READ_ACTION }).count() === 0, 'the action goes once the person cannot grant');
    assert.deepEqual(second.live.grants, [], 'a 403 runs no grant');
    assert.deepEqual(ui2.pageErrors.filter((e) => !/403/.test(e)), []);
  } finally {
    await ui2.close();
  }
});

test('the App tile offers to let new Apps use the result table catalog, grants with the person sign-in, and checks the output again', async () => {
  const appRows = [row('catalog', 'OWNER', 'admins', false), row('catalog', 'USE_CATALOG', 'inspire-manual', true), row('schema', 'OWNER', 'inspire-manual', true)];
  const grants = [];
  const below = [{ level: 'schema', schema_name: 'information_schema', object_name: 'information_schema', privilege: 'USE SCHEMA' }];
  const ui = await openUi('wizard', {
    me: { userName: OWNER, displayName: 'Owner' },
    warehousePermissions: { access_control_list: [{ service_principal_name: 'app-sp-id', all_permissions: [{ permission_level: 'CAN_MANAGE' }] }] }, // REQ-418: the App's principal manages it
    tokenKind: 'app',
    forwardedToken: PERSON,
    workspace: ({ token, path }) => (path.includes('/scim/v2/Me')
      ? [token === APP_TOKEN ? { displayName: 'inspire-manual', applicationId: 'app-sp-id' } : { userName: OWNER, displayName: 'Owner' }]
      : undefined),
    statements: {
      'system.information_schema.catalogs': (_sql, _p, token) => ({ rows: token === APP_TOKEN ? appRows : [row('catalog', 'OWNER', OWNER, true)] }),
      schema_privileges: () => ({ rows: below }),
      'GRANT ': (sql, _p, token) => {
        grants.push([sql, token]);
        if (token !== APP_TOKEN) appRows.push(row('catalog', 'USE_CATALOG', 'account users', true));
        return { rows: [] };
      },
    },
  });
  const { page } = ui;
  const CATALOG_GRANT = 'GRANT USE CATALOG ON CATALOG `main` TO `account users`';
  try {
    await goToStep(page, 'Data');
    await page.getByRole('button', { name: 'Next' }).click();
    await goToStep(page, 'What to deliver');
    const tile = page.locator('[data-output="app"]');
    await tile.locator('[data-blocked-reason="app"]').waitFor({ timeout: 15000 });
    // The block can show before its grant list does (the list comes with a later check result), so wait for the list too, not only the block.
    const grantList = tile.getByRole('list', { name: 'Grant Inspire can run for new Apps' });
    await grantList.locator('li').first().waitFor({ timeout: 15000 });
    assert.deepEqual(await grantList.locator('li').allTextContents(), [CATALOG_GRANT]);
    await tile.getByRole('button', { name: NEW_APPS_ACCESS_ACTION, exact: true }).click();
    const result = tile.getByRole('status', { name: 'New Apps access result' });
    await result.getByText('Inspire granted USE CATALOG on main to account users with your sign-in, which opens no data by itself', { exact: true })
      .waitFor({ timeout: 15000 });
    assert.deepEqual(await result.getByRole('list', { name: 'Grants Inspire ran for new Apps' }).locator('li').allTextContents(), [CATALOG_GRANT]);
    assert.deepEqual(grants, [[CATALOG_GRANT, PERSON]], 'one grant, with the person token');
    await until(async () => await tile.getByRole('button', { name: NEW_APPS_ACCESS_ACTION }).count() === 0, 'the action goes once new Apps can read');
    assert.equal(await tile.locator('[data-blocked-reason="app"]').count(), 0, 'the output check runs again and clears the refusal');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a partial grant shows the grants that ran, the ones that failed, and keeps the named reason', async () => {
  const rights = { rows: OWNS };
  const { live, state } = appCannotRead(rights, { refuse: 'GRANT SELECT' });
  const ui = await openUi('wizard', state);
  const { page } = ui;
  try {
    const panel = panelOf(page);
    await dismissDialog(page); await panel.getByRole('button', { name: APP_READ_ACTION, exact: true }).click({ timeout: 15000 });
    const result = panel.getByRole('status', { name: 'Grant result' });
    await result.getByText('Inspire ran 2 grants with your sign-in, and 1 grant failed, so the App still cannot read every table', { exact: true })
      .waitFor({ timeout: 15000 });
    assert.equal(await panel.getByRole('status', { name: 'Grant result' }).getByText('Granted 2, failed 1. The failed commands are in Permission Required.', { exact: true }).count(), 1);
    assert.ok((await grantsNeeded(panel)).includes(TABLE_GRANT), 'the failed statement reached the Permission Required channel (REQ-131)');
    assert.deepEqual(live.grants.map(([, token]) => token), [PERSON, PERSON, PERSON]);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('an App tile whose new-Apps offer comes back with no grant keeps the named reason, with no grant list and no action', async () => {
  // The person holds USE CATALOG but neither own nor MANAGE on the catalog, so the offer is empty for good.
  const appRows = [row('catalog', 'OWNER', 'admins', false), row('catalog', 'USE_CATALOG', 'inspire-manual', true), row('schema', 'OWNER', 'inspire-manual', true)];
  const personRows = [row('catalog', 'USE_CATALOG', OWNER, true)];
  const ui = await openUi('wizard', {
    me: { userName: OWNER, displayName: 'Owner' },
    warehousePermissions: { access_control_list: [{ service_principal_name: 'app-sp-id', all_permissions: [{ permission_level: 'CAN_MANAGE' }] }] }, // REQ-418: the App's principal manages it
    tokenKind: 'app',
    forwardedToken: PERSON,
    workspace: ({ token, path }) => (path.includes('/scim/v2/Me')
      ? [token === APP_TOKEN ? { displayName: 'inspire-manual', applicationId: 'app-sp-id' } : { userName: OWNER, displayName: 'Owner' }]
      : undefined),
    statements: {
      'system.information_schema.catalogs': (_sql, _p, token) => ({ rows: token === APP_TOKEN ? appRows : personRows }),
      schema_privileges: () => ({ rows: [{ level: 'schema', schema_name: 'information_schema', object_name: 'information_schema', privilege: 'USE SCHEMA' }] }),
    },
  });
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    await page.getByRole('button', { name: 'Next' }).click();
    await goToStep(page, 'What to deliver');
    const tile = page.locator('[data-output="app"]');
    const block = tile.locator('[data-blocked-reason="app"]');
    await block.waitFor({ timeout: 15000 });
    assert.match(await block.innerText(), /^Needs access Inspire does not have on the catalog\./);
    await page.waitForTimeout(500);
    assert.equal(await tile.getByRole('list', { name: 'Grant Inspire can run for new Apps' }).count(), 0, 'no offer, so no grant list');
    assert.equal(await tile.getByRole('button', { name: NEW_APPS_ACCESS_ACTION, exact: true }).count(), 0, 'no offer, so no action');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
