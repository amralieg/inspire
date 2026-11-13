import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_STATE, built } from './implementFixtures.js';
import { closeBrowser, closeOnLoadPermission, expandBuild, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const PERSON = 'person-tok';
const SP = 'app-sp-2';
const CATALOG = 'GRANT USE CATALOG ON CATALOG `main` TO `app-sp-2`';
const SCHEMA = 'GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp-2`';
const SELECT = 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-2`';
const CARD = 'The App cannot read part of its data';
const CLEARED = 'The App can read all its data now';
const ACCESS = 'Let Inspire read these tables';

const unreadBuild = () => {
  const row = built({ status: 'ready_with_warnings' });
  const assets = JSON.parse(row.asset_status);
  assets.app.unread = { app: SP, tables: [{ table: 'main.s.orders', owner: 'data-eng', grants: [CATALOG, SCHEMA, SELECT] }] };
  return { ...row, asset_status: JSON.stringify(assets) };
};

function grantableWorkspace({ canGrant = true } = {}) {
  const fixed = { value: false };
  const grants = [];
  const mine = canGrant ? 'true' : 'false';
  const rows = () => [
    { level: 'catalog', privilege: 'OWNER', principal: canGrant ? 'owner@example.com' : 'admins', mine, me: 'owner@example.com' },
    { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'owner@example.com' },
    { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'owner@example.com' },
  ];
  return {
    fixed,
    grants,
    state: {
      ...STUDIO_STATE,
      history: [unreadBuild()],
      forwardedToken: PERSON,
      tokenKind: 'app',
      abacUnreadable: (token) => token === 'tok' && !fixed.value,
      workspace: ({ token, path }) => (path.includes('/scim/v2/Me')
        ? [token === 'tok' ? { displayName: 'inspire-manual', applicationId: SP } : { userName: 'owner@example.com', displayName: 'Owner' }]
        : undefined),
      statements: {
        'system.information_schema.catalogs': () => ({ rows: rows() }),
        'GRANT ': (sql) => {
          grants.push(sql);
          fixed.value = true;
          return { rows: [] };
        },
      },
    },
  };
}

test('a refused App read is granted with the person sign-in, and the card shows the current state, never the stale refusal (REQ-042)', async () => {
  const w = grantableWorkspace();
  const ui = await openUi('implement', w.state);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    await page.getByRole('status', { name: 'Grant result' }).waitFor({ timeout: 15000 });
    assert.ok(w.grants.length >= 1, 'the grant route ran with the person sign-in');
    await page.getByRole('region', { name: CLEARED }).waitFor({ timeout: 15000 });
    assert.equal(await page.getByRole('region', { name: CARD }).count(), 0, 'the refusal card is replaced once the grant lands');
    assert.equal(await page.getByText(CARD, { exact: false }).count(), 0, 'no stale refusal text stays on the page');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a refused App read the person cannot grant shows Check again, and after the owner grants it Check again clears the card (REQ-042)', async () => {
  const w = grantableWorkspace({ canGrant: false });
  const ui = await openUi('implement', w.state);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    // A person who cannot grant must act: Permission Required opens on load with the owner's GRANTs. It covers the drawer, so close it first.
    await closeOnLoadPermission(page, { expect: true });
    await expandBuild(page);
    const card = page.getByRole('region', { name: CARD });
    await card.waitFor({ timeout: 15000 });
    assert.equal(await card.getByRole('button', { name: ACCESS, exact: true }).count(), 0, 'no grant button the person cannot use');
    assert.equal(w.grants.length, 0, 'nothing is granted by Inspire');
    const check = card.getByRole('button', { name: 'Check again', exact: true });
    await check.waitFor({ timeout: 15000 });
    w.fixed.value = true;
    await check.click();
    await page.getByRole('region', { name: CLEARED }).waitFor({ timeout: 15000 });
    assert.equal(await page.getByRole('region', { name: CARD }).count(), 0, 'the refusal is cleared by Check again');
    assert.match(await page.getByRole('region', { name: CLEARED }).innerText(), /The App can read all its data now/, 'the cleared card says so');
    assert.equal(await page.getByText(CARD, { exact: false }).count(), 0, 'no stale refusal text stays on the page');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a grant the person can make that fails opens Permission Required with the GRANT it tried, grouped by grantee (REQ-042)', async () => {
  const w = grantableWorkspace();
  w.state.statements['GRANT '] = (sql) => {
    w.grants.push(sql);
    throw new Error('[PERMISSION_DENIED] User does not have MANAGE on Table main.s.orders.');
  };
  const ui = await openUi('implement', w.state);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await closeOnLoadPermission(page, { expect: true });
    await expandBuild(page);
    // The card's grant button arrives with the app-reads check; wait for the card before reading the button.
    await page.getByRole('region', { name: CARD }).waitFor({ timeout: 15000 });
    // The card's grant choice is labelled "Grant access with my permissions" (appReadsChoices), not the Build-card action.
    const access = page.getByRole('button', { name: 'Grant access with my permissions', exact: true });
    await access.click({ timeout: 15000 });
    const dialog = page.locator('[data-permission-dialog=""]');
    await dialog.waitFor({ timeout: 15000 });
    const statements = await dialog.locator('[data-permission-statements=""]').innerText();
    assert.match(statements, /GRANT SELECT ON TABLE `main`\.`s`\.`orders` TO `app-sp-2`;/, 'the failed grant is listed in Permission Required');
    assert.ok(w.grants.length >= 1, 'the grant ran with the person sign-in');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
