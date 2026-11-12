import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER, STUDIO_STATE, builtSpec } from './implementFixtures.js';
import { BUILD_IT, closeBrowser, expandBuild, openSettings, openUi, toSummary } from './uiSupport.mjs';

test.after(closeBrowser);

const PERSON = 'person-tok';
const REASON = 'The App cannot read its sources yet, so the build cannot start. Grant access first, then build.';
const ACCESS = 'Let Inspire read these tables';

const publishedRow = () => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', change_classes: 'initial', created_by: OWNER,
  updated_at: '2026-10-25T04:00:00Z', spec_json: JSON.stringify(builtSpec()), app_name: 'churn-desk', asset_status: JSON.stringify({}),
});

const scim = ({ token, path }) => (path.includes('/scim/v2/Me')
  ? [token === 'tok' ? { displayName: 'inspire-manual', applicationId: 'app-sp-id' } : { userName: OWNER, displayName: 'Owner' }]
  : undefined);

test('an unchanged edit still shows the source refusal and the access action, never only Nothing changed (regression guard for the edit path)', async () => {
  const ui = await openUi('implement', {
    ...STUDIO_STATE, me: { userName: OWNER, displayName: 'Owner' }, history: [publishedRow()], workspace: scim,
    tokenKind: 'app', forwardedToken: PERSON, abacUnreadable: true, abacUnreadableAppOnly: true,
  });
  const { page } = ui;
  try {
    await page.getByRole('heading', { name: 'Build', exact: true }).waitFor();
    await expandBuild(page);
    await openSettings(page);
    await toSummary(page);
    await page.locator('[data-source-refused]').waitFor({ timeout: 20000 });
    assert.equal((await page.locator('[data-source-refused]').innerText()).trim(), REASON);
    assert.equal(await page.getByRole('button', { name: BUILD_IT, exact: true }).count(), 0, 'no Build button beside the refusal');
    assert.ok(await page.getByRole('button', { name: ACCESS, exact: true }).count() > 0, 'the access action is shown');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
