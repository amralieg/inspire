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
const OWNS = [row('catalog', 'OWNER', OWNER, true), row('schema', 'OWNER', 'data-eng', false), row('table', 'OWNER', 'data-eng', false)];

function freshApp(rights) {
  const live = { grants: [] };
  const unread = { app: 'app-sp-id', tables: [{ table: 'main.s.orders', owner: 'data-eng', grants: [SCHEMA, SELECT, METADATA] }] };
  return {
    live,
    state: {
      ...STUDIO_STATE,
      me: { userName: OWNER, displayName: 'Owner' },
      tokenKind: 'app',
      forwardedToken: PERSON,
      history: [{ session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', change_classes: 'initial', created_by: OWNER,
        updated_at: '2026-10-25T04:00:00Z', spec_json: JSON.stringify(builtSpec()), app_name: 'churn-desk',
        asset_status: JSON.stringify({ app: { unread } }) }],
      workspace: ({ token, path }) => (path.includes('/scim/v2/Me')
        ? [token === APP_TOKEN ? { displayName: 'inspire-manual', applicationId: 'app-sp-id' } : { userName: OWNER, displayName: 'Owner' }]
        : undefined),
      statements: {
        'system.information_schema.catalogs': (_sql, _p, token) => ({ rows: token === APP_TOKEN ? [] : rights.rows }),
        'GRANT ': (sql, _p, token) => {
          live.grants.push([sql, token]);
          return { rows: [] };
        },
      },
    },
  };
}

test('a fresh App whose service principal cannot read its sources is granted automatically by the person who can grant, with no click', async () => {
  const { live, state } = freshApp({ rows: OWNS });
  const ui = await openUi('implement', state);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    await page.locator('[data-app-reads-result]').first().waitFor({ timeout: 15000 });
    assert.deepEqual(live.grants.map(([sql]) => sql), [SCHEMA, SELECT, METADATA], 'the recorded grants run automatically on the build view');
    assert.ok(live.grants.every(([, token]) => token === PERSON), 'every grant runs with the person sign-in, never the App');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
