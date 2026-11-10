import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER, STUDIO_STATE, builtSpec } from './implementFixtures.js';
import { closeBrowser, expandBuild, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const APP_TOKEN = 'tok';
const PERSON = 'person-tok';
const SCHEMA = 'GRANT USE SCHEMA ON SCHEMA `main`.`s` TO `app-sp-id`';
const SELECT = 'GRANT SELECT ON TABLE `main`.`s`.`orders` TO `app-sp-id`';
const METADATA = 'GRANT READ METADATA ON TABLE `main`.`s`.`orders` TO `app-sp-id`';
const row = (level, privilege, principal, mine) => ({ level, privilege, principal, mine: String(mine), me: OWNER });
const READS_ONLY = [row('catalog', 'OWNER', 'admins', false), row('schema', 'OWNER', 'data-eng', false), row('table', 'OWNER', 'data-eng', false)];

test('a person who cannot grant sees one plain sentence naming the owner, the GRANT copyable, and the build stays needs-access', async () => {
  const live = { grants: [] };
  const unread = { app: 'app-sp-id', tables: [{ table: 'main.s.orders', owner: 'data-eng', grants: [SCHEMA, SELECT, METADATA] }] };
  const ui = await openUi('implement', {
    ...STUDIO_STATE,
    me: { userName: OWNER, displayName: 'Owner' },
    tokenKind: 'app',
    forwardedToken: PERSON,
    history: [{ session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', change_classes: 'initial', created_by: OWNER,
      updated_at: '2026-10-25T04:00:00Z', spec_json: JSON.stringify(builtSpec()), app_name: 'churn-desk', asset_status: JSON.stringify({ app: { unread } }) }],
    workspace: ({ token, path }) => (path.includes('/scim/v2/Me')
      ? [token === APP_TOKEN ? { displayName: 'inspire-manual', applicationId: 'app-sp-id' } : { userName: OWNER, displayName: 'Owner' }]
      : undefined),
    statements: {
      'system.information_schema.catalogs': (_sql, _p, token) => ({ rows: token === APP_TOKEN ? [] : READS_ONLY }),
      'GRANT ': (sql, _p, token) => {
        live.grants.push([sql, token]);
        throw new Error('PERMISSION_DENIED: User does not have MANAGE on Table main.s.orders');
      },
    },
  });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    const card = page.locator('[data-app-reads]');
    await card.waitFor({ timeout: 15000 });
    const text = await card.innerText();
    assert.match(text, /The App cannot read part of its data/);
    assert.match(text, /data-eng/, 'the owner is named');
    assert.doesNotMatch(text, /@/, 'no internal email on the build card');
    assert.ok(live.grants.every(([, token]) => token === PERSON), 'the refused grants ran with the person sign-in only');
    await card.getByRole('button', { name: /Copy the grant SQL to send to admins and data-eng/ }).click();
    await page.locator('[data-app-reads-result="copy"]').waitFor({ timeout: 15000 }).catch(() => null);
    assert.equal(await card.locator('[data-app-reads-result]').count() > 0, true, 'the copy outcome is shown on the card');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
