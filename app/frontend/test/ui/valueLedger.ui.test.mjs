import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, lowContrast, openUi, setDark } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import { valueChips } from '../../src/lib/valueLedger.js';
import { SHOWCASE_NOTE } from '../../src/lib/showcase.js';
import { openShowcase } from '../../../scripts/showcaseRecorder.mjs';

test.after(closeBrowser);

const AT_STAKE = [
  { kind: 'money', unit: 'AED', amount: 2400 },
  { kind: 'money', unit: 'USD', amount: 1200 },
  { kind: 'time', unit: 'hours', amount: 40 },
  { kind: 'count', unit: 'records', amount: 300 },
  { kind: 'money', unit: 'AED', amount: 600 },
];
const SAVED = [
  { kind: 'money', unit: 'AED', amount: 900 },
  { kind: 'time', unit: 'hours', amount: 12 },
];
const RUN_AT_STAKE = [
  { kind: 'money', unit: 'AED', amount: 9000 },
  { kind: 'money', unit: 'USD', amount: 4000 },
  { kind: 'time', unit: 'hours', amount: 120 },
];
const RUN_SAVED = [{ kind: 'money', unit: 'AED', amount: 1500 }];

const VALUE = {
  use_cases: {
    'N01-U01': { at_stake: AT_STAKE, saved: SAVED, measured: true },
    'N01-U02': { at_stake: [], saved: [], measured: false },
  },
  run: { at_stake: RUN_AT_STAKE, saved: RUN_SAVED, mvps_measured: 2 },
};
const OVERALL = {
  at_stake: [{ kind: 'money', unit: 'AED', amount: 12000 }, { kind: 'money', unit: 'USD', amount: 4000 }, { kind: 'time', unit: 'hours', amount: 120 }],
  saved: [{ kind: 'money', unit: 'AED', amount: 1500 }],
  runs: 6,
  businesses: 3,
};

const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
const RUNS = { runs: { 42: VALUE.run } };
const valueHits = [];
const mountValue = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.use('/api/inspire/value', (req, _res, next) => { valueHits.push(req.originalUrl); next(); });
  app.get('/api/inspire/value', (_req, res) => res.json(VALUE));
  app.get('/api/inspire/value/overall', (_req, res) => res.json(OVERALL));
  app.get('/api/inspire/value/runs', (_req, res) => res.json(RUNS));
};
const withValue = (results, runs) => ({ ...REVIEW_STATE, results, ...runs });

test('valueChips keeps one chip per currency and per unit, largest first, and counts the overflow', () => {
  const { shown, more } = valueChips(AT_STAKE, 3);
  assert.deepEqual(shown.map((c) => c.text), ['AED 3K', '$1.2K', '300 records']);
  assert.equal(more, 1, 'hours is the overflow, counted as +1');
  assert.deepEqual(valueChips(AT_STAKE, 5).shown.map((c) => c.text), ['AED 3K', '$1.2K', '300 records', '40 hours']);
  assert.deepEqual(valueChips(RUN_SAVED, 3), { shown: [{ kind: 'money', unit: 'AED', amount: 1500, text: 'AED 1.5K' }], more: 0 });
  assert.deepEqual(valueChips([{ kind: 'money', unit: 'AED', amount: 'NaN' }, { kind: 'money', unit: '', amount: 5 }, null]), { shown: [], more: 0 });
  assert.deepEqual(valueChips(undefined), { shown: [], more: 0 });
});

test('the use case card shows at stake and saved as separate currency and unit chips, and says Not measured yet when the value is not measured', async () => {
  const results = { ...REVIEW_RESULTS };
  const ui = await openUi('results', withValue(results, {}), '', { mount: mountValue });
  const { page } = ui;
  try {
    const list = page.getByRole('region', { name: 'Use case list' });
    await list.locator('[aria-expanded]').first().waitFor();
    const card = (name) => list.locator('[aria-expanded]').filter({ hasText: name });
    const badge = card('Predict churn').locator('[data-value-badge]');
    await badge.waitFor({ timeout: 15000 });
    const atStake = await badge.locator('[data-value-group="at stake"] [data-value-chip]').evaluateAll((els) => els.map((el) => el.textContent.trim()));
    const saved = await badge.locator('[data-value-group="saved"] [data-value-chip]').evaluateAll((els) => els.map((el) => el.textContent.trim()));
    assert.deepEqual(atStake, ['AED 3K', '$1.2K', '300 records']);
    assert.equal((await badge.locator('[data-value-group="at stake"] [data-value-more]').innerText()).trim(), '+1');
    assert.deepEqual(saved, ['AED 900', '12 hours']);
    assert.equal(await badge.locator('[data-value-more]').count(), 1, 'only the at stake side overflows');
    assert.match(await badge.innerText(), /at stake[\s\S]*saved/i);

    const notMeasured = card('Score upsell');
    await notMeasured.locator('[data-value-state="not-measured"]').waitFor();
    assert.equal((await notMeasured.locator('[data-value-state="not-measured"]').innerText()).trim(), 'Not measured yet');
    assert.equal(await notMeasured.locator('[data-value-chip]').count(), 0, 'no number is shown for a value that is not measured');

    assert.equal(await card('Forecast stock').locator('[data-value-badge], [data-value-state]').count(), 0, 'no MVP, no value line on the card');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the run header totals the run across its MVPs, with the same chip rules and from how many MVPs', async () => {
  const ui = await openUi('results', withValue(REVIEW_RESULTS, {}), '', { mount: mountValue });
  const { page } = ui;
  try {
    const header = page.locator('[data-run-heading]');
    await header.locator('[data-value-badge]').waitFor({ timeout: 15000 });
    assert.deepEqual(await header.locator('[data-value-group="at stake"] [data-value-chip]').evaluateAll((els) => els.map((el) => el.textContent.trim())), ['AED 9K', '$4K', '120 hours']);
    assert.deepEqual(await header.locator('[data-value-group="saved"] [data-value-chip]').evaluateAll((els) => els.map((el) => el.textContent.trim())), ['AED 1.5K']);
    assert.equal((await header.locator('[data-value-mvps]').innerText()).trim(), 'from 2 MVPs');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Start shows one overall banner across runs with at stake and saved, and each run card carries its own value line', async () => {
  const ui = await openUi('app', { ...REVIEW_STATE }, '', { mount: mountValue });
  const { page } = ui;
  try {
    valueHits.length = 0;
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await page.locator('[data-run="42"]').waitFor({ timeout: 20000 });
    const banner = page.locator('[data-value-overall]');
    await banner.waitFor({ timeout: 15000 });
    assert.match(await banner.innerText(), /across 6 runs, 3 businesses/);
    assert.match(await banner.innerText(), /reported by owners/);
    assert.deepEqual(await banner.locator('[data-value-group="at stake"] [data-value-chip]').evaluateAll((els) => els.map((el) => el.textContent.trim())), ['AED 12K', '$4K', '120 hours']);
    assert.deepEqual(await banner.locator('[data-value-group="saved"] [data-value-chip]').evaluateAll((els) => els.map((el) => el.textContent.trim())), ['AED 1.5K']);
    const runValue = page.locator('[data-run="42"] [data-run-value]');
    await runValue.locator('[data-value-badge]').waitFor({ timeout: 15000 });
    const runsCalls = valueHits.filter((u) => u.startsWith('/api/inspire/value/runs'));
    assert.ok(runsCalls.length >= 1 && new Set(runsCalls).size === 1, `one runs read for every run on Start: ${runsCalls.length}`);
    assert.equal(valueHits.filter((u) => u.startsWith('/api/inspire/value?')).length, 0, 'no per-run call on Start');
    assert.deepEqual(await runValue.locator('[data-value-chip]').evaluateAll((els) => els.map((el) => el.textContent.trim())), ['AED 9K', '$4K', '120 hours', 'AED 1.5K']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('value chips and the overall banner keep 4.5:1 contrast in light and dark', async () => {
  const ui = await openUi('results', withValue(REVIEW_RESULTS, {}), '', { mount: mountValue });
  const { page } = ui;
  try {
    await page.locator('[data-run-heading] [data-value-badge]').waitFor({ timeout: 15000 });
    for (const dark of [false, true]) {
      await setDark(page, dark);
      const measured = await lowContrast(page, ['[data-run-heading]', '[data-use-case-no="N01-U01"]', '[data-use-case-no="N01-U02"]']);
      assert.ok(measured.checked >= 6, `${dark ? 'dark' : 'light'}: measured ${measured.checked}`);
      assert.deepEqual(measured.low, [], `${dark ? 'dark' : 'light'} value text`);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('showcase mode never calls the value routes, because the demo has none', async () => {
  const ui = await openUi('app', { ...REVIEW_STATE }, '', {
    mount: (app) => {
      app.get('/api/showcase', (_req, res) => res.json({ showcases: [{ id: 'acme', session_id: '42', title: 'Acme retail', business: 'Acme', summary: 'Demo' }] }));
      mountValue(app);
    },
  });
  const { page } = ui;
  try {
    valueHits.length = 0;
    await openShowcase(page);
    await page.getByRole('region', { name: 'Demo' }).getByText(SHOWCASE_NOTE).waitFor({ timeout: 20000 });
    valueHits.length = 0;
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => null);
    await page.locator('[data-run-heading], [data-portfolio]').first().waitFor({ timeout: 20000 }).catch(() => null);
    assert.deepEqual(valueHits, [], 'no value request while the showcase is open');
    assert.equal(await page.locator('[data-value-overall], [data-run-value]').count(), 0);
  } finally {
    await ui.close();
  }
});
