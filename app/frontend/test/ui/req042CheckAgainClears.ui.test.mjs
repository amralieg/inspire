import test from 'node:test';
import assert from 'node:assert/strict';
import { BUILD_IT, closeBrowser, openUi, goToStep, toSummary, until } from './uiSupport.mjs';

test.after(closeBrowser);

const APP_TOKEN = 'tok';
const PERSON = 'person-tok';
const OWNER = ['owner', 'example.com'].join('@');
const DENIED = "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table 'main.s.orders'.";
function appCannotRead() {
  const live = { appReads: false, grants: [] };
  return {
    live,
    state: {
      me: { userName: OWNER, displayName: 'Owner' },
      tokenKind: 'app',
      forwardedToken: PERSON,
      workspace: ({ token, path }) => (path.includes('/scim/v2/Me')
        ? [token === APP_TOKEN ? { displayName: 'inspire-manual', applicationId: 'app-sp-id' } : { userName: OWNER, displayName: 'Owner' }]
        : undefined),
      statements: {
        'LIMIT 0': (sql, _p, token) => {
          if (sql.includes('`orders`') && token === APP_TOKEN && !live.appReads) throw new Error(DENIED);
          return { rows: [] };
        },
        'GRANT ': (sql, _p, token) => { live.grants.push([sql, token]); return { rows: [] }; },
      },
    },
  };
}

test('after the owner grants outside Inspire, a fresh preflight clears the App refusal, the verdict reaches ok and Build shows (REQ-042)', async () => {
  const { live, state } = appCannotRead();
  const ui = await openUi('wizard', state);
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    const panel = page.getByRole('region', { name: 'App read access', exact: true });
    await panel.waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-build-now]').count(), 0, 'no Build while the App cannot read the source');
    if (await page.locator('[data-permission-dialog]').count()) await page.keyboard.press('Escape');
    // the owner grants outside Inspire; the next fresh preflight (entering the Build step) re-reads the App access
    live.appReads = true;
    await toSummary(page);
    await page.waitForFunction((label) => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === label && !b.disabled),
      BUILD_IT, { timeout: 20000 });
    assert.equal(await page.locator('[data-source-refused]').count(), 0, 'no stale refusal line on Summary');
    assert.equal(await page.getByRole('region', { name: 'App read access', exact: true }).count(), 0, 'the stale App refusal is gone');
    assert.deepEqual(live.grants, [], 'Check again grants nothing');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
