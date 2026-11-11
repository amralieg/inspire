import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_READS_LABEL } from '../../src/lib/implementWizard.js';
import { STUDIO_STATE, built } from './implementFixtures.js';
import { BUILD_IT, closeBrowser, expandBuild, openUi, toSharedAccess, toSummary } from './uiSupport.mjs';

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

const unreadBuild = () => {
  const row = built({ status: 'ready_with_warnings' });
  const assets = JSON.parse(row.asset_status);
  assets.app.unread = { app: SP, tables: [{ table: 'main.s.orders', owner: 'data-eng', grants: [CATALOG, SCHEMA, SELECT] }] };
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
      const [, privilege, level] = /^GRANT (USE CATALOG|USE SCHEMA|SELECT) ON (\w+)/.exec(sql);
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
      abacUnreadable: true,
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

const allowClipboard = async (page, origin) => { await page.context().grantPermissions(['clipboard-read', 'clipboard-write'], { origin }); };

test('a build whose App cannot read its data ends as action needed; a person who cannot grant gets copy and check, never a grant button', async () => {
  const w = grantsWorkspace(false);
  const ui = await openUi('implement', w.state, '', { init: allowClipboard });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    const card = page.getByRole('region', { name: 'The App cannot read part of its data' });
    await card.waitFor();
    assert.match(await card.innerText(), /cannot read 2 tables, so its pages show no data from them yet/, 'the card counts the tables; their names sit under Details');
    assert.deepEqual(await card.locator('[data-app-reads-choice]').evaluateAll((els) => els.map((e) => e.dataset.appReadsChoice)), ['copy', 'check']);
    assert.equal(await card.getByRole('button', { name: 'Grant access with my permissions' }).count(), 0, 'no grant button when the live verdict says it cannot grant');
    await card.getByRole('button', { name: 'Copy the grant SQL to send to your data owner' }).waitFor();
    assert.equal(await page.getByText(APP_READS_LABEL, { exact: true }).count() > 0, true, 'the build reads as action needed, not plain Done');
    assert.equal(await page.locator('[data-app-reads]').getByText(/^Done$/).count(), 0);

    await card.getByRole('button', { name: 'Copy the grant SQL to send to your data owner' }).click();
    await card.getByText('The grant SQL is copied.', { exact: false }).first().waitFor();
    assert.equal(await page.evaluate(() => navigator.clipboard.readText()), [CATALOG, SCHEMA, SELECT, METADATA, SELECT_RETURNS, METADATA_RETURNS].map((g) => `${g};`).join('\n'));

    w.grants.length = 0;
    await card.getByRole('button', { name: 'Check again' }).click();
    await card.locator('[data-app-reads-result="check"]').waitFor();
    assert.deepEqual(w.grants, [], 'Check again grants nothing');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('when the person can grant everything the card says the App reads its data and drops the choices', async () => {
  const w = grantsWorkspace(true);
  const ui = await openUi('implement', w.state);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    const card = page.locator('[data-app-reads]');
    await card.getByText('The App can read all its data now', { exact: true }).first().waitFor();
    assert.equal(await card.locator('[data-app-reads-choice]').count(), 0, 'the choices are dropped once the grants ran');
    assert.deepEqual([...new Set(w.grants.map(([sql]) => sql))].sort(), [CATALOG, SCHEMA, SELECT, METADATA, SELECT_RETURNS, METADATA_RETURNS].sort(),
      'the App grants run once, as the person, because the person can grant everything');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a build whose App reads everything shows no access card (must-exclude)', async () => {
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [built({ status: 'ready_with_warnings' })] });
  try {
    await ui.page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(ui.page);
    await ui.page.locator('[data-mvp-progress]').waitFor();
    assert.equal(await ui.page.locator('[data-app-reads]').count(), 0);
    assert.equal(await ui.page.getByText(APP_READS_LABEL, { exact: true }).count(), 0);
  } finally {
    await ui.close();
  }
});

test('the wizard warns on Summary when Inspire cannot share a picked table with the App it will make, naming the table and owner', async () => {
  const readsOnly = [
    { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: 'inspire-sp' },
    { level: 'schema', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'inspire-sp' },
    { level: 'table', privilege: 'OWNER', principal: 'data-eng', mine: 'false', me: 'inspire-sp' },
    { level: 'table', privilege: 'SELECT', principal: 'inspire-sp', mine: 'true', me: 'inspire-sp' },
  ];
  const manages = [{ ...readsOnly[0], principal: 'inspire-sp', mine: 'true' }, ...readsOnly.slice(1, 3)];
  for (const [rows, shared, warned] of [[readsOnly, true, true], [manages, true, false], [readsOnly, false, false]]) {
    const ui = await openUi('wizard', { accessBySchema: { s: rows } });
    try {
      if (shared) await toSharedAccess(ui.page);
      await toSummary(ui.page);
      await ui.page.waitForFunction((label) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === label && !b.disabled), BUILD_IT, { timeout: 30000 });
      const note = ui.page.getByRole('note', { name: 'Data the new App cannot read' });
      if (warned) {
        await note.waitFor();
        const said = await note.textContent();
        assert.match(said, /^Inspire cannot share main\.s\.orders \(owner admins and data-eng\)/);
        assert.match(said, /the Build page offers Grant access with my permissions/);
      } else {
        await ui.page.waitForTimeout(1500);
        assert.equal(await note.count(), 0, shared ? 'no warning when Inspire manages the data (must-exclude)' : 'no warning for a per-user App, which reads as each viewer (must-exclude)');
      }
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});
