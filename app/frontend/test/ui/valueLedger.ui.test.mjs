import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, lowContrast, openUi, setDark, totalsQueryMissing } from './uiSupport.mjs';
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
const DEFAULTS = { envSkipsSetupWizard: true, isDatabricksApp: true, databricksHost: 'https://workspace.example.com', warehouseId: 'wh1',
  inspireDatabase: 'main.inspire', notebookPath: '/Shared/inspire_ai' };
// FX-34 (REQ-448): the one run value the Review header and the Start page render.
const RUN_VALUE = { totals: [{ currency: 'AED', amount: 12000, calculated: 9000, estimated: 3000 }], n: 2, n_calculated: 1, n_estimated: 1, n_measured: 0, n_none: 0, n_shared: 0 };
const TOTALS_ONE = { run: { ...RUN_VALUE, excluded: [], by_verb: [] }, use_cases: {}, run_value: RUN_VALUE };
const TOTALS_ALL = { runs: [{ session_id: '42', name: 'Acme', ...RUN_VALUE, run_value: RUN_VALUE }], all: RUN_VALUE, truncated: false, cap: 20 };
const valueHits = [];
const mountValue = (app) => {
  app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
  app.get('/api/showcase', (_req, res) => res.json({}));
  app.use('/api/inspire/value', (req, _res, next) => { valueHits.push(req.originalUrl); next(); });
  app.get('/api/inspire/value', (_req, res) => res.json(VALUE));
  app.get('/api/inspire/value/totals', (req, res) => totalsQueryMissing(req, res) || res.json(req.query.session_id ? TOTALS_ONE : TOTALS_ALL));
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

test('the use case card headlines the largest at stake amount, the saved amount in green, and puts the other amounts and the counts beside them', async () => {
  const results = { ...REVIEW_RESULTS };
  const ui = await openUi('results', withValue(results, {}), '', { mount: mountValue });
  const { page } = ui;
  try {
    const list = page.getByRole('region', { name: 'Use case list' });
    await list.locator('[data-use-case-row]').first().waitFor();
    const card = (name) => list.locator('[data-use-case-row]').filter({ hasText: name });
    const badge = card('Predict churn').locator('[data-value-badge]');
    await badge.waitFor({ timeout: 15000 });
    assert.equal((await badge.locator('[data-value-headline="at stake"]').innerText()).trim(), 'AED 3K');
    assert.equal((await badge.locator('[data-value-headline="saved"]').innerText()).trim(), 'AED 900');
    assert.deepEqual(await badge.locator('[data-value-secondary] [data-value-chip]').evaluateAll((els) => els.map((el) => el.textContent.trim())),
      ['$1.2K', '40 hours', '12 hours saved']);
    assert.equal((await badge.locator('[data-value-mvps]').innerText()).trim(), '300 records', 'a count is not money and goes on the meta line');
    assert.equal(await badge.locator('[data-value-headline="at stake"]').evaluate((el) => getComputedStyle(el).color === getComputedStyle(document.body).color), false, 'headline is not the body colour');
    assert.equal(await badge.locator('[data-value-headline="saved"]').evaluate((el) => getComputedStyle(el).color.replace(/\s/g, '') !== 'rgb(220,38,38)'), true, 'saved is not an error red');

    const notMeasured = card('Score upsell');
    await notMeasured.locator('[data-value-state="not-measured"]').waitFor();
    assert.equal((await notMeasured.locator('[data-value-state="not-measured"]').innerText()).trim(), 'Not measured yet');
    assert.equal(await notMeasured.locator('[data-value-headline]').count(), 0, 'no number is shown for a value that is not measured');

    assert.equal(await card('Forecast stock').locator('[data-value-badge], [data-value-state]').count(), 0, 'no MVP, no value on the card');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

// FX-34 (REQ-448, W16 D2/D3/D9) replaced the header MVP badge and the Start "reported by owners" banner: the Review header and the Start
// page render the one run value from /value/totals, so they cannot disagree with the Business panel.
test('the run header shows the run value from the totals, with its counts and the short disclaimer', async () => {
  const ui = await openUi('results', withValue(REVIEW_RESULTS, {}), '', { mount: mountValue });
  const { page } = ui;
  try {
    const header = page.locator('[data-run-heading] [data-run-header-value]');
    await header.locator('[data-run-value-total]').waitFor({ timeout: 15000 });
    assert.equal((await header.locator('[data-run-value-total]').innerText()).trim(), 'AED 12K');
    assert.match(await header.innerText(), /1 reviewed calculation · 1 provisional estimate/);
    assert.equal(await header.locator('[data-value-disclaimer]').count(), 1);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Start shows one value panel across runs, each run card carries its run value and a Go to Build button, from one totals read', async () => {
  const ui = await openUi('app', { ...REVIEW_STATE }, '', { mount: mountValue });
  const { page } = ui;
  try {
    valueHits.length = 0;
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await page.locator('[data-run="42"]').waitFor({ timeout: 20000 });
    const banner = page.locator('[data-value-overall]');
    await banner.waitFor({ timeout: 15000 });
    assert.equal(await banner.count(), 1, 'one value panel');
    assert.equal((await banner.locator('[data-total-amount]').first().innerText()).trim(), 'AED 12K');
    const runValue = page.locator('[data-run="42"] [data-run-value] [data-run-value-total]');
    await runValue.waitFor({ timeout: 15000 });
    assert.equal((await runValue.innerText()).trim(), 'AED 12K');
    assert.equal(await page.locator('[data-run="42"] [data-run-go-build]').count(), 1, 'a run with MVPs and none building shows Go to Build');
    const totalsCalls = valueHits.filter((u) => u.startsWith('/api/inspire/value/totals'));
    assert.ok(totalsCalls.length >= 1 && new Set(totalsCalls).size === 1, `one totals read for every run on Start: ${totalsCalls.length}`);
    assert.equal(valueHits.filter((u) => /^\/api\/inspire\/value(\?|\/runs|\/overall|\/estimates)/.test(u)).length, 0, 'no per-run or second value read on Start');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('when the totals route is missing, Start lists its runs with no value line and no per-run reads', async () => {
  const ui = await openUi('app', { ...REVIEW_STATE }, '', {
    mount: (app) => {
      app.get('/api/defaults', (_req, res) => res.json(DEFAULTS));
      app.get('/api/showcase', (_req, res) => res.json({}));
      app.use('/api/inspire/value', (req, _res, next) => { valueHits.push(req.originalUrl); next(); });
      app.get('/api/inspire/value/totals', (_req, res) => res.status(404).json({ error: 'not found' }));
    },
  });
  const { page } = ui;
  try {
    valueHits.length = 0;
    await page.getByRole('button', { name: 'Get Started', exact: true }).first().click();
    await page.locator('[data-run="42"]').waitFor({ timeout: 20000 });
    await page.waitForLoadState('networkidle', { timeout: 20000 }).catch(() => null);
    assert.equal(await page.locator('[data-run-value], [data-value-overall]').count(), 0, 'no value line without the route');
    assert.equal(await page.locator('[data-run="42"]').count(), 1, 'the run still lists');
    assert.equal(valueHits.filter((u) => u.startsWith('/api/inspire/value?')).length, 0, 'no per-run fallback');
    assert.deepEqual(ui.pageErrors.filter((e) => !/404/.test(e)), [], 'the only error is the 404 the test set up');
  } finally {
    await ui.close();
  }
});

test('value chips and the overall banner keep 4.5:1 contrast in light and dark', async () => {
  const ui = await openUi('results', withValue(REVIEW_RESULTS, {}), '', { mount: mountValue });
  const { page } = ui;
  try {
    await page.locator('[data-run-heading] [data-run-value-total]').waitFor({ timeout: 15000 });
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
