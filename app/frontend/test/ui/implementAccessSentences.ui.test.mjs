import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, goToStep } from './uiSupport.mjs';

test.after(closeBrowser);

const APP_TOKEN = 'tok';
const PERSON = 'person-tok';
const OWNER = ['owner', 'example.com'].join('@');
const DENIED = "[INSUFFICIENT_PERMISSIONS] Insufficient privileges: User does not have SELECT on Table 'main.s.orders'.";
const row = (level, privilege, principal, mine) => ({ level, privilege, principal, mine: String(mine), me: OWNER });
const OWNS = [row('catalog', 'OWNER', OWNER, true), row('catalog', 'USE_CATALOG', 'account users', true), row('schema', 'OWNER', 'data-eng', false),
  row('table', 'OWNER', 'data-eng', false)];

function appCannotRead() {
  const live = { appReads: false };
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
        'system.information_schema.catalogs': (_sql, _p, token) => ({ rows: token === APP_TOKEN ? [] : OWNS }),
        'GRANT ': () => ({ rows: [] }),
      },
    },
  };
}

test('the App read refusal shows one plain sentence, and its grant SQL sits under Details, never in the sentence (REQ-041)', async () => {
  const { state } = appCannotRead();
  const { page, close } = await openUi('wizard', state);
  try {
    await goToStep(page, 'Data');
    const panel = page.getByRole('region', { name: 'App read access', exact: true });
    await panel.waitFor({ timeout: 15000 });
    const details = panel.locator('[data-technical-details]');
    assert.ok(await details.count() >= 1, 'the grant SQL is held under a Details disclosure');
    const sentence = (await panel.innerText()).split('\nDetails')[0].trim();
    assert.doesNotMatch(sentence, /GRANT |PERMISSION_DENIED/, 'no GRANT line or raw error in the visible sentence');
    assert.match(await details.evaluateAll((els) => els.map((el) => el.textContent).join('\n')), /GRANT /, 'the grant SQL is under Details');
  } finally {
    await close();
  }
});

test('while the App cannot read a source the wizard shows no Build button (REQ-042, MVP-ADP-08)', async () => {
  const { state } = appCannotRead();
  const { page, close } = await openUi('wizard', state);
  try {
    await goToStep(page, 'Data');
    await page.getByRole('region', { name: 'App read access', exact: true }).waitFor({ timeout: 15000 });
    assert.equal(await page.locator('[data-build-now]').count(), 0, 'no Build button beside the grant refusal');
  } finally {
    await close();
  }
});
