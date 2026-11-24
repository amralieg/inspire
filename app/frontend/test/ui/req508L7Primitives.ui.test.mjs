// REQ-508 L7 (Art Director pass, "A Calm Console"): "Not calculated" is a neutral badge, not a dashed red box, and the Review section
// tabs use the one underline Tabs style, centred, with a 200 ms panel fade. Audit scratch/req508_art_director.md F24, F25.
// Fail-pre (15eb146b9): a run with no value draws a dashed red-bordered box (ValueTotalsPanel.jsx:202) and ResultsNav draws boxed pills
// with a filled background (ResultsNav.jsx:44-46). The red value boxes for runs with a value stay (must-keep, REQ-505).
import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, totalsQueryMissing } from './uiSupport.mjs';
import { REVIEW_SESSIONS, REVIEW_STATE } from './reviewFixtures.js';

test.after(closeBrowser);

const rgb = (s) => (String(s).match(/[\d.]+/g) || []).map(Number);
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const value = (calculated, estimated) => ({ totals: [{ currency: 'USD', amount: calculated + estimated, calculated, estimated }], n: 3,
  n_calculated: calculated ? 1 : 0, n_estimated: estimated ? 1 : 0, n_measured: 0, n_none: 0, n_shared: 0 });
const NONE = { totals: [], n: 2, n_calculated: 0, n_estimated: 0, n_measured: 0, n_none: 2, n_shared: 0 };
const TOTALS = { runs: [
  { session_id: '42', name: 'Acme', ...value(3.1e6, 0), run_value: value(3.1e6, 0) },
  { session_id: '51', name: 'Gamma', ...NONE, run_value: NONE },
], all: value(3.1e6, 0), truncated: false, cap: 20 };
const mount = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(TOTALS));
};

test('F24: a run with no value shows "Not calculated" as a neutral grey badge with no dashed or red border; a run with a value keeps its red box', async () => {
  const ui = await openUi('app', REVIEW_STATE, '', { mount });
  const { page } = ui;
  try {
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    const red = page.locator('[data-run="42"] [data-run-value-box]');
    await red.waitFor({ timeout: 20000 });
    const [r, g, b] = rgb(await red.evaluate((el) => getComputedStyle(el).backgroundColor));
    assert.ok(r >= 180 && g <= 90 && b <= 90, `run 42 keeps its solid red value box (must-keep), got rgb(${r},${g},${b})`);
    const badge = page.locator('[data-run="51"]').getByText('Not calculated', { exact: true }).first();
    await badge.waitFor({ timeout: 20000 });
    const facts = await badge.evaluate((el) => {
      const boxes = [];
      for (let n = el; n && !n.matches('[data-run]'); n = n.parentElement) {
        const s = getComputedStyle(n);
        boxes.push({ style: s.borderTopStyle, width: s.borderTopWidth, border: s.borderTopColor, bg: s.backgroundColor });
      }
      const s = getComputedStyle(el);
      return { boxes, bg: s.backgroundColor, radius: s.borderTopLeftRadius };
    });
    assert.ok(!facts.boxes.some((x) => x.style === 'dashed'), `no dashed box around "Not calculated": ${JSON.stringify(facts.boxes)}`);
    const redBorder = facts.boxes.find((x) => x.style !== 'none' && parseFloat(x.width) > 0 && rgb(x.border)[0] >= 180 && rgb(x.border)[1] <= 90);
    assert.equal(redBorder, undefined, 'no red border around "Not calculated"');
    const [br, bg, bb, ba = 1] = rgb(facts.bg);
    assert.ok(ba > 0 && Math.max(br, bg, bb) - Math.min(br, bg, bb) <= 16, `the badge has a neutral grey fill (got ${facts.bg})`);
    assert.equal(facts.radius, '6px', 'badges use radius sm');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('F25: the Results section tabs are underline tabs (2px primary underline on the current one, no filled pill), still centred', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: REVIEW_SESSIONS }, '', { init: (page) => page.setViewportSize({ width: 1440, height: 900 }) });
  const { page } = ui;
  try {
    const list = page.getByRole('tablist', { name: 'Results sections' });
    await list.waitFor({ timeout: 20000 });
    const tabs = await list.getByRole('tab').evaluateAll((els) => els.map((el) => {
      const s = getComputedStyle(el);
      return { selected: el.getAttribute('aria-selected') === 'true', bw: s.borderBottomWidth, bc: s.borderBottomColor, bg: s.backgroundColor, top: s.borderTopWidth };
    }));
    const current = tabs.find((t) => t.selected);
    assert.ok(current, 'one tab is selected');
    assert.equal(current.bw, '2px', 'the current tab has a 2px underline');
    const [r, g, b] = rgb(current.bc);
    assert.ok(r >= 180 && g <= 90 && b <= 90, `the underline is primary red (got ${current.bc})`);
    assert.equal(current.top, '0px', 'no box border around the current tab');
    assert.ok(tabs.every((t) => (rgb(t.bg)[3] ?? 1) === 0 || t.bg === 'transparent'), `no tab has a filled background: ${tabs.map((t) => t.bg).join(' | ')}`);
    assert.ok(tabs.filter((t) => !t.selected).every((t) => t.bw === '0px' || (rgb(t.bc)[3] ?? 1) === 0), 'other tabs show no underline');
    const box = await list.boundingBox();
    assert.ok(Math.abs(box.x + box.width / 2 - 720) <= 40, `the tabs stay centred (must-keep, REQ-504): centre ${box.x + box.width / 2}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('F27: switching section tab fades the new panel in over 200 ms (--dur-base)', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, sessions: REVIEW_SESSIONS }, '', { init: (page) => page.setViewportSize({ width: 1440, height: 900 }) });
  const { page } = ui;
  try {
    const list = page.getByRole('tablist', { name: 'Results sections' });
    await list.waitFor({ timeout: 20000 });
    const other = list.getByRole('tab', { selected: false }).first();
    await other.click();
    await page.waitForFunction(() => document.querySelector('[role="tabpanel"]:not([hidden])'), null, { timeout: 5000 });
    const anim = await page.locator('[role="tabpanel"]:not([hidden])').first().evaluate((el) => {
      const s = getComputedStyle(el);
      return [s.animationName, s.animationDuration];
    });
    assert.notEqual(anim[0], 'none', 'the panel has an enter animation');
    assert.equal(anim[1], '0.2s');
  } finally {
    await ui.close();
  }
});
