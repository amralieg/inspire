import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER, STUDIO_STATE, builtSpec, built } from './implementFixtures.js';
import { closeBrowser, expandBuild, openUi, sqlStatementsOf } from './uiSupport.mjs';

test.after(closeBrowser);

// REQ-406 (D41): the Build page never opens Permission Required by itself. An inline note carries the reason and See the grant; the dialog opens on a click.
// REQ-456, REQ-460 (D44): the per-use-case card button is "Uninstall this use case"; its confirm button is "Uninstall <id>".
const DIALOG = '[data-permission-dialog=""]';
const STATEMENT = 'GRANT SELECT ON TABLE `main`.`inspire`.`churn_scope` TO `app-sp-2`';
const PERMISSION = { statements: [STATEMENT], instructions: [], principal: 'app-sp-2', why: 'The App cannot read its Data Filters view yet, so the filters show nothing.' };

function buildWithPermission() {
  const row = built({ status: 'ready_with_warnings' });
  const assets = JSON.parse(row.asset_status);
  assets.permissions = [PERMISSION];
  return { ...row, asset_status: JSON.stringify(assets) };
}

test('a build with a grant entry opens no dialog on load, shows an inline note with See the grant, and the click opens the exact GRANT', async () => {
  const ui = await openUi('implement', { ...STUDIO_STATE, history: [buildWithPermission()] });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    const note = page.locator('[data-permission-note]');
    await note.waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator(DIALOG).count(), 0, 'no Permission Required dialog on load or after a poll');
    assert.match(await note.innerText(), /cannot read its Data Filters view/);
    await note.getByRole('button', { name: 'Request permission', exact: true }).waitFor();
    await note.getByRole('button', { name: 'See the grant', exact: true }).click();
    const dialog = page.locator(DIALOG);
    await dialog.waitFor({ timeout: 15000 });
    assert.deepEqual(sqlStatementsOf(await dialog.locator('[data-permission-statements=""]').textContent()), [STATEMENT]);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a person who cannot grant the App reads sees no dialog on load; See the grant on the inline card opens the GRANT lines', async () => {
  const SELECT = 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-id`';
  const unread = { app: 'app-sp-id', tables: [{ table: 'main.s.orders', owner: 'data-eng', grants: [SELECT] }] };
  const level = (l, privilege, principal) => ({ level: l, privilege, principal, mine: 'false', me: OWNER });
  const ui = await openUi('implement', {
    ...STUDIO_STATE,
    me: { userName: OWNER, displayName: 'Owner' },
    tokenKind: 'app',
    forwardedToken: 'person-tok',
    abacUnreadable: true,
    abacUnreadableAppOnly: true,
    history: [{ session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', change_classes: 'initial', created_by: OWNER,
      updated_at: '2026-10-25T04:00:00Z', spec_json: JSON.stringify(builtSpec()), app_name: 'churn-desk', asset_status: JSON.stringify({ app: { unread } }) }],
    workspace: ({ token, path }) => (path.includes('/scim/v2/Me')
      ? [token === 'tok' ? { displayName: 'inspire-manual', applicationId: 'app-sp-id' } : { userName: OWNER, displayName: 'Owner' }]
      : undefined),
    statements: {
      'system.information_schema.catalogs': (_sql, _p, token) => ({ rows: token === 'tok' ? [] : [level('catalog', 'OWNER', 'admins'), level('schema', 'OWNER', 'data-eng'), level('table', 'OWNER', 'data-eng')] }),
      'GRANT ': () => { throw new Error('PERMISSION_DENIED: User does not have MANAGE on Table main.s.orders'); },
    },
  });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    const card = page.locator('[data-app-reads]');
    await card.waitFor({ timeout: 15000 });
    await page.waitForTimeout(1500);
    assert.equal(await page.locator(DIALOG).count(), 0, 'no Permission Required dialog on load');
    await card.locator('[data-app-reads-primary="copy"]').click();
    const dialog = page.locator(DIALOG);
    await dialog.waitFor({ timeout: 15000 });
    assert.match(await dialog.innerText(), /GRANT SELECT/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the per-use-case card button reads Uninstall this use case, and the confirm button reads Uninstall <id>', async () => {
  const ui = await openUi('implement', STUDIO_STATE);
  const { page } = ui;
  try {
    await page.getByRole('button', { name: 'Uninstall this use case', exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await page.getByRole('button', { name: 'Uninstall all', exact: true }).count(), 0, 'the session-sounding label is gone');
    await page.getByRole('button', { name: 'Uninstall this use case', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Uninstall everything Predict churn built' });
    await dialog.getByRole('button', { name: 'Uninstall Predict churn', exact: true }).waitFor({ timeout: 15000 });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
