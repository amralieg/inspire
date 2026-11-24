// FX-104 (REQ-487, REQ-488): the Change run list (Review page) shows the red value box on every run and the number-only
// "Business value across all runs" panel, from the same all-runs totals read the Start page uses.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, totalsQueryMissing } from './uiSupport.mjs';
import { REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const value = (calculated, estimated) => ({ totals: [{ currency: 'USD', amount: calculated + estimated, calculated, estimated }], n: 3,
  n_calculated: calculated ? 1 : 0, n_estimated: estimated ? 1 : 0, n_measured: 0, n_none: 0, n_shared: 0 });
const NONE = { totals: [], n: 2, n_calculated: 0, n_estimated: 0, n_measured: 0, n_none: 2, n_shared: 0 };
// session_id is a number on the wire for one run (the gcp shape); the list must still match it.
const ALL = { runs: [
  { session_id: 41, name: 'Acme', ...value(3.1e6, 0), run_value: value(3.1e6, 0) },
  { session_id: '42', name: 'Beta', ...value(0, 1.35e6), run_value: value(0, 1.35e6) },
  { session_id: '43', name: 'Gamma', ...NONE, run_value: NONE },
], all: value(3.1e6, 1.35e6), truncated: false, cap: 20 };
const mount = (app) => {
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(req.query.session_id
    ? { run: value(0, 1.35e6), run_value: value(0, 1.35e6), use_cases: {} } : ALL));
};
const full = (sid, business) => ({ session_id: sid, completed_percent: 100, business_name: business, widget_values: { business },
  create_at: '2026-11-19T10:00:00Z', last_updated: '2026-11-19T10:00:00Z', completed_on: '2026-11-19T10:00:00Z', business_runs: [1, 1] });

test('Change run: every run row has a red value box and the all-runs number shows', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: [full('41', 'Acme'), full('42', 'Beta'), full('43', 'Gamma')] }, '', { mount });
  const { page } = ui;
  try {
    await page.locator('[data-run-heading]').getByRole('button', { name: 'Change run' }).click();
    const runs = page.getByRole('group', { name: 'Runs' });
    await runs.locator('[data-run="43"]').waitFor();
    // REQ-508 L7: a run with no value yet shows the Not calculated badge in [data-run-value] instead of the red box.
    for (const sid of ['41', '42']) {
      await runs.locator(`[data-run="${sid}"] [data-run-value-box]`).waitFor({ timeout: 15000 });
    }
    await runs.locator('[data-run="43"] [data-run-value]').waitFor({ timeout: 15000 });
    assert.ok((await runs.locator('[data-run="41"] [data-run-value-box]').innerText()).includes('$3.1M'));
    assert.ok((await runs.locator('[data-run="43"] [data-run-value]').innerText()).includes('Not calculated'));
    await page.locator('[data-value-all-panel]').locator('[data-total-amount]').first().waitFor({ timeout: 15000 });
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
