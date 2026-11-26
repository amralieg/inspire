import test from 'node:test';
import assert from 'node:assert/strict';
import { OWNER } from './implementFixtures.js';
import { closeBrowser, openUi } from './uiSupport.mjs';

test.after(closeBrowser);

const hostedRecord = { id: 'n01-u01-a', source: '/Workspace/Users/someone/inspire/n01-u01-a/v2', version: 2, warehouse_id: 'wh2', page: 'n01_u01',
  published_at: '2026-10-30T05:00:00Z' };
const row = { session_id: '42', use_case_id: 'N01-U01', spec_version: 2, status: 'ready', created_by: OWNER, app_name: '', app_url: '',
  spec_json: JSON.stringify({ use_case_name: 'Predict churn', outputs: { app: true, app_owners: [] } }),
  asset_status: JSON.stringify({ app: { placement: 'inspire', hosted: hostedRecord, app_name: '', app_url: '' } }),
  updated_at: '2026-10-30T06:00:00Z', dashboard_id: null, genie_space_id: null };
const hostedFake = { useReader: () => {}, setListed: () => {}, stateOf: () => ({ reason: '', error: '', state: 'ready' }) };

// SEC-09: a hosted page's script must not share Inspire's origin, so its iframe is sandboxed without allow-same-origin.
test('the hosted page iframe is sandboxed: scripts and forms yes, same origin no', async () => {
  const ui = await openUi('run', { registry: [row], useCaseScope: [{ session_id: '42', use_case_id: 'N01-U01', domain: 'Retention' }], hostedRun: hostedFake }, '', {
    mount: (app) => app.get('/run/:id/{*rest}', (req, res) => res.type('html').send(`<p data-hosted="${req.params.id}">hosted page</p>`)),
    init: (page) => page.setExtraHTTPHeaders({ 'x-forwarded-access-token': 'user-token', 'x-forwarded-email': OWNER }),
  });
  const { page } = ui;
  try {
    await page.locator('[data-run-open="n01-u01-a"]').click();
    const frame = page.locator('[data-run-frame]');
    await frame.waitFor({ timeout: 20000 });
    const tokens = String(await frame.getAttribute('sandbox') || '').split(/\s+/).filter(Boolean);
    assert.ok(tokens.includes('allow-scripts'), `the page still runs its scripts: ${tokens}`);
    assert.ok(!tokens.includes('allow-same-origin'), `the sandbox never grants Inspire's origin: ${tokens}`);
    await page.frameLocator('[data-run-frame]').locator('[data-hosted="n01-u01-a"]').waitFor({ timeout: 15000 });
  } finally {
    await ui.close();
  }
});
