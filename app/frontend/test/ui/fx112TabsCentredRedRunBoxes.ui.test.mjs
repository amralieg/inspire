// FX-112 (REQ-504, REQ-505): the Results tabs sit at the top middle of the page; every run on the Runs page shows its value in a solid red
// box with white text (approved wireframe req503 frame 4); a run with no value shows a dashed box instead.
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, totalsQueryMissing } from './uiSupport.mjs';
import { REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const rgb = (s) => (s.match(/\d+(\.\d+)?/g) || []).slice(0, 3).map(Number);

for (const [width, height] of [[1440, 900], [1280, 800]]) {
  test(`REQ-504: at ${width}x${height} the Use cases / Business / Assets tabs are centred at the top of the page`, async () => {
    const ui = await openUi('results', { ...REVIEW_STATE, sessions: REVIEW_SESSIONS }, '', { init: (page) => page.setViewportSize({ width, height }) });
    const { page } = ui;
    try {
      const list = page.getByRole('tablist', { name: 'Results sections' });
      await list.getByRole('tab').first().waitFor();
      const tabs = await list.getByRole('tab').evaluateAll((els) => els.map((el) => el.getBoundingClientRect()).map((r) => ({ left: r.left, right: r.right })));
      const left = Math.min(...tabs.map((t) => t.left));
      const right = Math.max(...tabs.map((t) => t.right));
      const vw = await page.evaluate(() => document.documentElement.clientWidth);
      assert.ok(Math.abs((left + right) / 2 - vw / 2) <= 40, `tabs centred: centre ${(left + right) / 2} vs page ${vw / 2}`);
      assert.ok(right - left <= vw * 0.6, `tabs are a centred group, not full width (${right - left} of ${vw})`);
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const value = (calculated, estimated) => ({ totals: [{ currency: 'USD', amount: calculated + estimated, calculated, estimated }], n: 3,
  n_calculated: calculated ? 1 : 0, n_estimated: estimated ? 1 : 0, n_measured: 0, n_none: 0, n_shared: 0 });
const NONE = { totals: [], n: 2, n_calculated: 0, n_estimated: 0, n_measured: 0, n_none: 2, n_shared: 0 };
const TOTALS = { runs: [
  { session_id: '42', name: 'Acme', ...value(3.1e6, 0), run_value: value(3.1e6, 0) },
  { session_id: '50', name: 'Beta Foods', ...value(0, 25e6), run_value: value(0, 25e6) },
  { session_id: '51', name: 'Gamma', ...NONE, run_value: NONE },
], all: value(3.1e6, 25e6), truncated: false, cap: 20 };
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(TOTALS));
};

test('REQ-505: each run with a value shows it in a solid red box with white text; a run with none shows a dashed box', async () => {
  const ui = await openUi('app', REVIEW_STATE, '', { mount });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    for (const [sid, want] of [['42', '$3.1M'], ['50', '$20M+']]) {
      const box = page.locator(`[data-run="${sid}"] [data-run-value-box]`);
      await box.waitFor({ timeout: 20000 });
      const [r, g, b] = rgb(await box.evaluate((el) => getComputedStyle(el).backgroundColor));
      assert.ok(r >= 180 && g <= 90 && b <= 90, `run ${sid}: solid red background, got rgb(${r},${g},${b})`);
      const amount = box.getByText(want, { exact: false }).first();
      await amount.waitFor();
      const [tr, tg, tb] = rgb(await amount.evaluate((el) => getComputedStyle(el).color));
      assert.ok(tr >= 240 && tg >= 240 && tb >= 240, `run ${sid}: white value text, got rgb(${tr},${tg},${tb})`);
    }
    const none = page.locator('[data-run="51"] [data-run-value-box]');
    await none.waitFor({ timeout: 20000 });
    assert.ok((await none.innerText()).includes('Not calculated'));
    assert.equal(await none.evaluate((el) => getComputedStyle(el).borderTopStyle), 'dashed', 'a run with no value: dashed box');
    const [r, g, b] = rgb(await none.evaluate((el) => getComputedStyle(el).backgroundColor));
    assert.ok(!(r >= 180 && g <= 90 && b <= 90), 'a run with no value is not a filled red box');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
