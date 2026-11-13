import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_STATE, built } from './implementFixtures.js';
import { BUILD_IT, closeBrowser, closeOnLoadPermission, expandBuild, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const PERSON = 'person-tok';
const SP = 'app-sp-2';
const CATALOG = 'GRANT USE CATALOG ON CATALOG `main` TO `app-sp-2`';
const SCHEMA = 'GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp-2`';
const SELECT = 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-2`';
const METADATA = 'GRANT READ METADATA ON TABLE `main`.`s`.`orders` TO `app-sp-2`';
const DENIED = "[PERMISSION_DENIED] User does not have MANAGE on Catalog 'main'.";
const CARD = 'The App cannot read part of its data';

const unreadBuild = () => {
  const row = built({ status: 'ready_with_warnings' });
  const assets = JSON.parse(row.asset_status);
  assets.app.unread = { app: SP, tables: [{ table: 'main.s.orders', owner: 'data-eng', grants: [CATALOG, SCHEMA, SELECT, METADATA] }] };
  return { ...row, asset_status: JSON.stringify(assets) };
};

/** A build whose App cannot read `main.s.orders`, and a person who cannot grant it. `fixed.value` flips once the policy read is granted outside Inspire. */
function refusedWorkspace() {
  const fixed = { value: false };
  const grants = [];
  const rows = () => [
    { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'owner@example.com' },
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
          throw new Error(DENIED);
        },
      },
    },
  };
}


test('a service-principal Build keeps one row per table the App cannot read, and no viewer rows (REQ-150)', async () => {
  const w = refusedWorkspace();
  const ui = await openUi('implement', w.state);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await closeOnLoadPermission(page, { expect: true });
    await expandBuild(page);
    const card = page.getByRole('region', { name: CARD });
    await card.waitFor({ timeout: 15000 });
    const rows = await card.locator('[data-table-row]').allInnerTexts();
    assert.deepEqual(rows, ['main.s.orders: needs USE CATALOG, USE SCHEMA, SELECT, READ METADATA', 'main.s.returns: needs USE CATALOG, USE SCHEMA, SELECT, READ METADATA'], 'one row per table with its grants');
    assert.equal(await card.locator('[data-viewer-row]').count(), 0, 'a service-principal App has no viewer rows');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
