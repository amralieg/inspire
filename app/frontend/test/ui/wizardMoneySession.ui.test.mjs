import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, goToStep, openUi, profileAt, stubMoney } from './uiSupport.mjs';
import { LIVE_RATES, MONEY_PROFILE } from './implementFixtures.js';

test.after(closeBrowser);

// The money previews read their tables through the Data Filters of the use case's session, so every money call from the wizard carries
// the session the wizard itself reads its profile with (the same inspire database, warehouse, session and use case).
const OWNER = ['owner', 'example.com'].join('@');
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const PREVIEW = { rows: [{ stake: 100, currency: 'AED' }] };

test('every money call from the Measure step names the session the profile reads, so the previews read through its Data Filters', async () => {
  const profiles = [];
  const calls = { currency: [], preview: [] };
  const init = async (page) => {
    await profileAt([], MONEY_PROFILE)(page);
    await stubMoney('currency-rates', () => LIVE_RATES, calls.currency)(page);
    await stubMoney('value-preview', () => PREVIEW, calls.preview)(page);
    page.on('request', (req) => {
      if (req.url().includes('/api/grouping/profile') && req.method() === 'POST') profiles.push(JSON.parse(req.postData() || '{}'));
    });
  };
  const ui = await openUi('wizard', ME, '', { init });
  const { page } = ui;
  try {
    await goToStep(page, 'Measure');
    await page.waitForFunction(() => document.querySelector('[data-money-part]') != null, null, { timeout: 15000 });
    await page.locator('[data-money-method="fixed"]').check({ force: true }).catch(() => {});
    await page.waitForTimeout(500);
    assert.ok(profiles.length > 0, 'the wizard read its profile with a session');
    const session = profiles[0];
    assert.ok(session.session_id && session.inspire_database && session.warehouse_id && session.use_case_id, JSON.stringify(session));
    const money = [...calls.currency, ...calls.preview];
    assert.ok(money.length > 0, 'the Measure step made money calls');
    for (const body of money) {
      assert.equal(body.session_id, session.session_id, 'the money call names the profile session');
      assert.equal(body.inspire_database, session.inspire_database, 'the money call names the profile inspire database');
      assert.equal(body.warehouse_id, session.warehouse_id, 'the money call names the profile warehouse');
      assert.equal(body.use_case_id, session.use_case_id, 'the money call names the profile use case');
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
