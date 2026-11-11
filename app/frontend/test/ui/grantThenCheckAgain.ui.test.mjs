import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_STATE, built } from './implementFixtures.js';
import { BUILD_IT, closeBrowser, expandBuild, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const PERSON = 'person-tok';
const SP = 'app-sp-2';
const CATALOG = 'GRANT USE CATALOG ON CATALOG `main` TO `app-sp-2`';
const SCHEMA = 'GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp-2`';
const SELECT = 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-2`';
const CARD = 'The App cannot read part of its data';
const ACCESS = 'Let Inspire read these tables';

const unreadBuild = () => {
  const row = built({ status: 'ready_with_warnings' });
  const assets = JSON.parse(row.asset_status);
  assets.app.unread = { app: SP, tables: [{ table: 'main.s.orders', owner: 'data-eng', grants: [CATALOG, SCHEMA, SELECT] }] };
  return { ...row, asset_status: JSON.stringify(assets) };
};

function grantableWorkspace() {
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
          fixed.value = true;
          return { rows: [] };
        },
      },
    },
  };
}

test('grant then Check again: Let Inspire read these tables runs the grants, Check again clears the refusal, and Build appears (REQ-042)', async () => {
  const w = grantableWorkspace();
  const ui = await openUi('implement', w.state);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    const card = page.getByRole('region', { name: CARD });
    await card.waitFor({ timeout: 15000 });
    await card.getByRole('button', { name: ACCESS, exact: true }).click();
    await page.getByRole('status', { name: 'Grant result' }).waitFor({ timeout: 15000 });
    assert.ok(w.grants.length >= 1, 'the grant route ran with the person sign-in');
    await card.getByRole('button', { name: 'Check again' }).click();
    await page.getByRole('region', { name: CARD }).waitFor({ state: 'detached', timeout: 15000 });
    assert.equal(await page.getByText(CARD, { exact: false }).count(), 0, 'the refusal is gone after Check again');
    const build = page.getByRole('button', { name: BUILD_IT, exact: true });
    await build.waitFor({ timeout: 15000 });
    assert.equal(await build.isDisabled(), false, 'Build appears and is enabled once the App can read');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
