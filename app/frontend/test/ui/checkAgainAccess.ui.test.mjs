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
const METADATA = 'GRANT READ METADATA ON TABLE `main`.`s`.`orders` TO `app-sp-2`';
const DENIED = "[PERMISSION_DENIED] User does not have MANAGE on Catalog 'main'.";
const CARD = 'The App cannot read part of its data';

const unreadBuild = () => {
  const row = built({ status: 'ready_with_warnings' });
  const assets = JSON.parse(row.asset_status);
  assets.app.unread = { app: SP, tables: [{ table: 'main.s.orders', owner: 'data-eng', grants: [CATALOG, SCHEMA, SELECT] }] };
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

test('Check again re-reads the App access and clears a refusal that was fixed outside Inspire, without granting anything (REQ-042)', async () => {
  const w = refusedWorkspace();
  const ui = await openUi('implement', w.state);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    const card = page.getByRole('region', { name: CARD });
    await card.waitFor({ timeout: 15000 });
    w.fixed.value = true;
    await card.getByRole('button', { name: 'Check again' }).click();
    await page.getByRole('region', { name: CARD }).waitFor({ state: 'detached', timeout: 15000 });
    assert.equal(await page.getByText(CARD, { exact: false }).count(), 0, 'the stale refusal is gone after the re-read');
    assert.deepEqual(w.grants, [], 'Check again grants nothing');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('no Build button sits beside a grant refusal the App still has (REQ-042)', async () => {
  const w = refusedWorkspace();
  const ui = await openUi('implement', w.state);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    await page.getByRole('region', { name: CARD }).waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-build-now]').count(), 0, 'no build-now button while the source is refused');
    assert.equal(await page.getByRole('button', { name: BUILD_IT, exact: true }).count(), 0, 'no Build button beside the refusal');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
