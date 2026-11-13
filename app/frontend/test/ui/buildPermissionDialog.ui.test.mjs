import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_STATE, built } from './implementFixtures.js';
import { closeBrowser, expandBuild, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const PERSON = 'person-tok';
const SP = 'app-sp-2';
const CATALOG = 'GRANT USE CATALOG ON CATALOG `main` TO `app-sp-2`';
const SCHEMA = 'GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp-2`';
const METADATA = 'GRANT READ METADATA ON TABLE `main`.`s`.`orders` TO `app-sp-2`';
const SELECT_RETURNS = 'GRANT SELECT ON TABLE `main`.`s`.`returns` TO `app-sp-2`';
const METADATA_RETURNS = 'GRANT READ METADATA ON TABLE `main`.`s`.`returns` TO `app-sp-2`';
const SELECT = 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-2`';
const DENIED = "[PERMISSION_DENIED] User does not have MANAGE on Catalog 'main'.";

const unreadBuild = ({ appFailed = false } = {}) => {
  const row = built({ status: 'ready_with_warnings' });
  const assets = JSON.parse(row.asset_status);
  assets.app.unread = { app: SP, tables: [{ table: 'main.s.orders', owner: 'data-eng', grants: [CATALOG, SCHEMA, SELECT, METADATA] },
    { table: 'main.s.returns', owner: 'data-eng', grants: [CATALOG, SCHEMA, SELECT_RETURNS, METADATA_RETURNS] }] };
  if (appFailed) assets.app = { ...assets.app, state: 'failed', error: 'the App could not be given read access to 1 source table' };
  return { ...row, asset_status: JSON.stringify(assets) };
};

function grantsWorkspace(catalogMine) {
  const held = new Set();
  const grants = [];
  const rows = () => [
    { level: 'catalog', privilege: 'OWNER', principal: catalogMine ? 'owner@example.com' : 'admins', mine: String(catalogMine), me: 'owner@example.com' },
    { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'owner@example.com' },
    { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'owner@example.com' },
    { level: 'schema', privilege: 'MANAGE', principal: 'owner@example.com', mine: 'true', me: 'owner@example.com' },
    ...[...held].map((sql) => {
      const [, privilege, level] = /^GRANT (USE CATALOG|USE SCHEMA|SELECT|READ METADATA) ON (\w+)/.exec(sql);
      return { level: level.toLowerCase(), privilege, principal: SP, mine: 'false', me: 'owner@example.com' };
    }),
  ];
  return {
    grants,
    state: {
      ...STUDIO_STATE,
      history: [unreadBuild()],
      forwardedToken: PERSON,
      tokenKind: 'app',
      abacUnreadable: (token) => token === 'tok' && !held.has(METADATA),
      workspace: ({ token, path }) => (path.includes('/scim/v2/Me')
        ? [token === 'tok' ? { displayName: 'inspire-manual', applicationId: SP } : { userName: 'owner@example.com', displayName: 'Owner' }]
        : undefined),
      statements: {
        'system.information_schema.catalogs': () => ({ rows: rows() }),
        'GRANT ': (sql, _p, token) => {
          grants.push([sql, token]);
          if (sql.includes(' ON CATALOG ') && !catalogMine) throw new Error(DENIED);
          held.add(sql);
          return { rows: [] };
        },
      },
    },
  };
}

test('Check again on an unreadable build opens See the grant, with the full read set for each table and the copy', async () => {
  const w = grantsWorkspace(false);
  const ui = await openUi('implement', w.state);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    // rc.1 opens Permission Required on its own when a grant is missing: close it before the Build page is used.
    const dialog = page.locator('[data-permission-dialog=""]');
    await dialog.waitFor({ timeout: 15000 });
    await dialog.getByRole('button', { name: 'Close' }).click();
    await expandBuild(page);
    const card = page.getByRole('region', { name: 'The App cannot read part of its data' });
    await card.waitFor();
    await card.getByRole('button', { name: 'Check again' }).click();
    await card.locator('[data-app-reads-result="check"]').waitFor();
    // Check again shows the same grants the card showed, so Permission Required does not open a second time.
    await page.waitForTimeout(800);
    assert.equal(await page.locator('[data-permission-dialog=""]').count(), 0, 'Check again reopens nothing for the same grants');
    const see = card.locator('[data-see-grant=""]');
    await see.waitFor({ timeout: 15000 });
    await see.click();
    await dialog.waitFor({ timeout: 15000 });
    assert.match(await dialog.locator('#permission-required-title').innerText(), /^Permission Required$/);
    const statements = (await dialog.locator('[data-permission-statements=""]').innerText()).split('\n').map((s) => s.replace(/;$/, ''));
    assert.deepEqual(statements, [CATALOG, SCHEMA, SELECT, METADATA, SELECT_RETURNS, METADATA_RETURNS],
      'the App needs USE CATALOG, USE SCHEMA, then SELECT and READ METADATA on each of the two tables, once each (the same list the card shows)');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
