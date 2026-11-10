import test from 'node:test';
import assert from 'node:assert/strict';
import { APP_READ_ACTION } from '../../src/lib/implementWizard.js';
import { OWNER, STUDIO_STATE, builtSpec } from './implementFixtures.js';
import { closeBrowser, expandBuild, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const APP_TOKEN = 'tok';
const PERSON = 'person-tok';
const SOURCE = 'main.s.orders';
const REASON = `The App's service principal inspire-manual cannot read the access policies of ${SOURCE}, so Inspire cannot tell whether the results keep them`;
const RAW = "Principal 'app-sp-id' does not have READ METADATA on Table main.s.orders";
const METADATA = 'GRANT READ METADATA ON TABLE `main`.`s`.`orders` TO `app-sp-id`';
const row = (level, privilege, principal, mine) => ({ level, privilege, principal, mine: String(mine), me: OWNER });
const OWNS = [row('catalog', 'OWNER', OWNER, true), row('schema', 'OWNER', 'data-eng', false), row('table', 'OWNER', 'data-eng', false)];

function protectionFailure(rights) {
  const live = { grants: [] };
  const record = { state: 'failed', spec_version: 1, reason: `Inspire did not publish. ${REASON}`, sql: [], check: true, details: RAW, tables: [SOURCE] };
  return {
    live,
    state: {
      me: { userName: OWNER, displayName: 'Owner' },
      tokenKind: 'app',
      forwardedToken: PERSON,
      ...STUDIO_STATE,
      history: [{ session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'failed', change_classes: 'initial', created_by: OWNER,
        updated_at: '2026-10-25T04:00:00Z', spec_json: JSON.stringify(builtSpec()), asset_status: JSON.stringify({ protection: record }) }],
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

test('a build stopped by a denied policy read shows the reason, Details with the raw error, and Let Inspire read these tables', async () => {
  const { live, state } = protectionFailure({ rows: OWNS });
  const ui = await openUi('implement', state);
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    const banner = page.getByRole('region', { name: 'Build failed', exact: true });
    await banner.getByText(REASON, { exact: false }).waitFor({ timeout: 15000 });
    const details = banner.locator('[data-protection-details]');
    assert.equal(await details.count(), 1, 'the raw error sits under Details');
    assert.equal(await details.locator('p').textContent(), RAW);
    await banner.getByRole('button', { name: APP_READ_ACTION, exact: true }).click();
    await page.locator('[data-protection-copy]').getByText('Inspire granted 1 grant with your sign-in', { exact: false }).waitFor({ timeout: 15000 });
    assert.deepEqual(live.grants, [[METADATA, PERSON]], 'only the person token grants, and only READ METADATA on the source');
    // The build resubmitted after the grant answers 400 on the harness fixture; it is not a page error of the grant flow.
    assert.deepEqual(ui.pageErrors.filter((e) => !/status of 400/.test(e)), []);
  } finally {
    await ui.close();
  }
});
