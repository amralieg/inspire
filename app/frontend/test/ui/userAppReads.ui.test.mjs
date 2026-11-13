import test from 'node:test';
import assert from 'node:assert/strict';
import { STUDIO_STATE, built } from './implementFixtures.js';
import { closeBrowser, expandBuild, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

// A user-authorization App: its scope view is read as each person who may open it. The Build page must list the
// viewers' missing grants with their exact SQL, must not reopen the dialog on a repeat check, and must clear a viewer's
// grant once it is run.
const PERSON = 'person-tok';
const VIEW = 'main.s.orders_scope';
const OWNER = 'data-eng';
const ME = 'owner@example.com';
const BOB = 'bob@example.com';
const ALICE = 'alice@example.com';
const APP = 'churn-desk';
const CARD = 'The App cannot read part of its data';
const SELECT_BOB = `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders_scope\` TO \`${BOB}\``;
const SELECT_ALICE = `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders_scope\` TO \`${ALICE}\``;
const grantsTo = (who) => [`GRANT USE CATALOG ON CATALOG \`main\` TO \`${who}\``, `GRANT USE SCHEMA ON SCHEMA \`main\`.\`s\` TO \`${who}\``,
  `GRANT SELECT ON TABLE \`main\`.\`s\`.\`orders_scope\` TO \`${who}\``, `GRANT READ METADATA ON TABLE \`main\`.\`s\`.\`orders_scope\` TO \`${who}\``];
const DENIED = `[PERMISSION_DENIED] User does not have MANAGE on Table '${VIEW}'.`;

const userBuild = () => {
  const row = built({ status: 'ready' });
  const assets = JSON.parse(row.asset_status);
  assets.app.views = [VIEW];
  assets.app.access_mode = 'user';
  return { ...row, asset_status: JSON.stringify(assets) };
};

function userWorkspace() {
  const held = {};
  const grants = [];
  const acl = { access_control_list: [
    { user_name: BOB, all_permissions: [{ permission_level: 'CAN_USE' }] },
    { user_name: ME, all_permissions: [{ permission_level: 'IS_OWNER' }] },
  ] };
  const rows = () => [
    { level: 'catalog', privilege: 'OWNER', principal: 'admins', mine: 'false', me: ME },
    { level: 'schema', privilege: 'OWNER', principal: OWNER, mine: 'false', me: ME },
    { level: 'table', privilege: 'OWNER', principal: OWNER, mine: 'false', me: ME },
    { level: 'schema', privilege: 'MANAGE', principal: ME, mine: 'true', me: ME },
    ...Object.entries(held).flatMap(([principal, privileges]) => privileges.map((privilege) => ({
      level: privilege === 'USE CATALOG' ? 'catalog' : privilege === 'USE SCHEMA' ? 'schema' : 'table', privilege, principal, mine: 'false', me: ME }))),
  ];
  return {
    acl,
    grants,
    state: {
      ...STUDIO_STATE,
      history: [userBuild()],
      forwardedToken: PERSON,
      tokenKind: 'app',
      responses: { [`GET /api/2.0/permissions/apps/${APP}`]: [acl, 200] },
      workspace: ({ path }) => (path.includes('/scim/v2/Me') ? [{ userName: ME, displayName: 'Owner' }] : undefined),
      statements: {
        'system.information_schema.catalogs': () => ({ rows: rows() }),
        'GRANT ': (sql) => {
          grants.push(sql);
          const m = /^GRANT (USE CATALOG|USE SCHEMA|SELECT|READ METADATA) ON \w+ .+ TO `([^`]+)`$/.exec(sql);
          if (m && m[1] === 'SELECT' && m[2] === BOB) throw new Error(DENIED);
          if (m) (held[m[2]] = held[m[2]] || []).push(m[1]);
          return { rows: [] };
        },
      },
    },
  };
}

const viewerRowTexts = (page) => page.locator('[data-viewer-row]').allInnerTexts();
const listed = async (page) => (await page.locator('[data-permission-statements=""]').innerText()).split('\n').map((s) => s.replace(/;$/, '').trim()).filter(Boolean);
const dialogOpen = (page) => page.locator('[data-permission-dialog=""]').count().then((n) => n > 0);

test('a user-authorization Build lists the viewer the scope view refuses, with its exact SQL, and a repeat check opens nothing new (REQ-150)', async () => {
  const w = userWorkspace();
  const ui = await openUi('implement', w.state);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    // The first check of this build lists the gap once: the dialog opens with bob's SELECT and its exact SQL.
    const dialog = page.locator('[data-permission-dialog=""]');
    await dialog.waitFor({ timeout: 15000 });
    // Both people who may open the App still need grants: bob all four; the owner holds MANAGE, which covers READ METADATA, so three.
    assert.deepEqual(await viewerRowTexts(page), [`${BOB}: needs USE CATALOG, USE SCHEMA, SELECT, READ METADATA on ${VIEW}`, `${ME}: needs USE CATALOG, USE SCHEMA, SELECT on ${VIEW}`]);
    assert.deepEqual((await listed(page)).sort(), [...grantsTo(BOB), ...grantsTo(ME).slice(0, 3)].sort(), 'the dialog lists the exact SQL each viewer still needs');
    await dialog.getByRole('button', { name: 'Close' }).click();
    await page.getByRole('region', { name: CARD }).waitFor({ timeout: 15000 });
    await expandBuild(page);

    // An unchanged gap: a repeat check opens nothing.
    await page.getByRole('region', { name: CARD }).getByRole('button', { name: 'Check again' }).click();
    await page.waitForTimeout(400);
    assert.equal(await dialogOpen(page), false, 'a repeat check with the same gap opens no dialog');
    assert.deepEqual(w.grants, [], 'a check grants nothing');

    // The grant runs for bob: his SELECT is refused and the dialog lists it again with the same SQL.
    await page.getByRole('region', { name: CARD }).getByRole('button', { name: 'Grant access with my permissions' }).click();
    await page.locator('[data-permission-dialog=""]').waitFor({ timeout: 15000 });
    assert.deepEqual(await listed(page), [SELECT_BOB]);
    await page.locator('[data-permission-dialog=""]').getByRole('button', { name: 'Close' }).click();

    // A viewer shared after the build: her grant is listed on the next check, and running it clears her gap; bob's stays.
    w.acl.access_control_list.push({ user_name: ALICE, all_permissions: [{ permission_level: 'CAN_USE' }] });
    await page.getByRole('region', { name: CARD }).getByRole('button', { name: 'Check again' }).click();
    await page.locator('[data-permission-dialog=""]').waitFor({ timeout: 15000 });
    assert.deepEqual((await listed(page)).sort(), [...grantsTo(ALICE), SELECT_BOB].sort(), 'the check lists the new viewer and bob, still refused');
    // The owner's grants already landed on the first grant, so the owner has no row now.
    assert.deepEqual((await viewerRowTexts(page)).sort(), [`${ALICE}: needs USE CATALOG, USE SCHEMA, SELECT, READ METADATA on ${VIEW}`, `${BOB}: needs SELECT on ${VIEW}`].sort(), 'a row per viewer still refused');
    await page.locator('[data-permission-dialog=""]').getByRole('button', { name: 'Close' }).click();

    await page.getByRole('region', { name: CARD }).getByRole('button', { name: 'Grant access with my permissions' }).click();
    await page.locator('[data-permission-dialog=""]').waitFor({ timeout: 15000 });
    const after = await listed(page);
    assert.ok(!after.includes(SELECT_ALICE), 'alice grant ran, so her SQL is no longer listed');
    assert.deepEqual(after, [SELECT_BOB], 'bob, refused, is still listed with his SQL');
    // The owner's and alice's rows clear once their grants land; bob's row stays and now needs only SELECT.
    assert.deepEqual(await viewerRowTexts(page), [`${BOB}: needs SELECT on ${VIEW}`], 'only the viewer still refused keeps a row');
    assert.ok(w.grants.includes(SELECT_ALICE), 'the grant for the newly shared viewer ran with the person token');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
