import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import * as V from '../../src/lib/v130UseCase.js';

test.after(closeBrowser);

const list = (page) => page.getByRole('region', { name: 'Use case list' });
const cards = (page) => list(page).locator('[aria-expanded]');
const card = (page, name) => cards(page).filter({ hasText: name });
const panel = (page, title) => page.getByRole('button', { name: new RegExp(`^${title}\\b`) }).first();
const NAMES = ['Predict churn', 'Score upsell', 'Segment shoppers', 'Price elasticity', 'Forecast stock', 'Spot late suppliers'];
const shown = async (page) => (await cards(page).allInnerTexts()).map((text) => NAMES.find((n) => text.includes(n))).sort();

function withUseCases(results, edit) {
  return {
    ...results,
    domains: results.domains.map((d) => ({ ...d, use_cases: d.use_cases.map((uc) => ({ ...uc, ...(edit[uc.No] || {}) })) })),
  };
}

const CUSTOMER = withUseCases(REVIEW_RESULTS, {
  'N01-U01': { 'Business Priority Alignment': 'Cut churn' },
  'N01-U02': { 'Business Priority Alignment': 'Grow basket size' },
});

const builtinResults = (entries, align) => withUseCases({
  ...REVIEW_RESULTS,
  strategy_coverage: { source: 'builtin', levels: entries.length ? ['Strategic Goal'] : [], use_cases: 6, aligned: align ? 1 : 0,
    not_aligned: align ? 1 : 2, entries, gaps: [], priorities: [], priority_gaps: [] },
}, {
  'N01-U01': { strategy_alignment: JSON.stringify(align ? [{ id: 'S1', path: 'Increase Revenue', evidence: 'orders drive revenue' }] : []) },
  'N01-U02': { strategy_alignment: '[]' },
});

async function ready(page) {
  await list(page).waitFor();
  await cards(page).first().waitFor();
}

async function openCard(page, name) {
  await card(page, name).click();
  await list(page).locator('[data-strategy-line]').first().waitFor();
  return list(page).locator('[data-strategy-line]');
}

test('the Strategy coverage card is gone; each use case names the goal and priorities it serves, and one tied to nothing says so', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: CUSTOMER });
  const { page } = ui;
  try {
    await ready(page);
    await page.locator('[data-insights-grid]').waitFor();
    assert.equal(await page.locator('[data-insight="Strategy coverage"]').count(), 0, 'no Strategy coverage card');
    assert.equal(await page.getByText('use cases not aligned to any entry').count(), 0);

    assert.equal((await card(page, 'Predict churn').locator('[data-strategy-chip]').innerText()).trim(), 'Keep customers');
    assert.equal((await card(page, 'Score upsell').locator('[data-strategy-chip]').innerText()).trim(), 'Sell more');
    assert.equal((await card(page, 'Price elasticity').locator('[data-strategy-chip]').innerText()).trim(), V.STRATEGY_NOT_TIED);
    assert.equal(await card(page, 'Forecast stock').locator('[data-strategy-chip]').count(), 0, 'no chip without strategy data');

    const line = await openCard(page, 'Predict churn');
    const text = (await line.innerText()).replace(/\s+/g, ' ');
    assert.match(text, /Serves Keep customers, part of Grow/);
    assert.match(text, /Business priorities: Cut churn/);
    assert.match(text, /Measured by: Churn rate/);
    assert.doesNotMatch(text, /built-in goals/, 'a customer strategy is not called built-in');
    assert.equal(await list(page).getByText('Priority Alignment', { exact: true }).count(), 0, 'the priorities are not repeated in a tile');
    await card(page, 'Predict churn').click();

    const notTied = await openCard(page, 'Price elasticity');
    assert.match((await notTied.innerText()).replace(/\s+/g, ' '), /Not tied to your strategy\. It was found in your data/);
    assert.doesNotMatch(await notTied.innerText(), /\u2014/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Strategy and Business priorities filters slice the list by goal, by priority and by use cases tied to nothing', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: CUSTOMER });
  const { page } = ui;
  try {
    await ready(page);
    await panel(page, 'Strategy').click();
    await page.getByRole('button', { name: /^Sell more\b/ }).click();
    await card(page, 'Predict churn').waitFor({ state: 'detached' });
    assert.deepEqual(await shown(page), ['Score upsell']);
    await page.getByRole('button', { name: /^Grow\b/ }).click();
    await card(page, 'Predict churn').waitFor();
    assert.deepEqual(await shown(page), ['Predict churn', 'Score upsell']);
    await page.getByRole('button', { name: new RegExp(`^${V.STRATEGY_NOT_TIED}`) }).click();
    await card(page, 'Predict churn').waitFor({ state: 'detached' });
    assert.deepEqual(await shown(page), ['Price elasticity']);
    await page.getByRole('button', { name: /^All use cases\b/ }).click();
    await card(page, 'Forecast stock').waitFor();

    await panel(page, 'Business priorities').click();
    await page.getByRole('button', { name: /^Cut churn\b/ }).click();
    await card(page, 'Score upsell').waitFor({ state: 'detached' });
    assert.deepEqual(await shown(page), ['Predict churn']);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('with no strategy given, the detail says once that the goals are the built-in ones', async () => {
  const entries = [{ id: 'S1', path: 'Increase Revenue', level: 'Strategic Goal', use_cases: 1, direct: 1 }];
  const ui = await openUi('results', { ...REVIEW_STATE, results: builtinResults(entries, true) });
  const { page } = ui;
  try {
    await ready(page);
    assert.equal((await card(page, 'Predict churn').locator('[data-strategy-chip]').innerText()).trim(), 'Increase Revenue');
    assert.equal((await card(page, 'Score upsell').locator('[data-strategy-chip]').innerText()).trim(), V.STRATEGY_NOT_TIED);
    const line = await openCard(page, 'Predict churn');
    assert.match((await line.innerText()).replace(/\s+/g, ' '), /Serves Increase Revenue \(Strategic Goal\)/);
    const note = list(page).locator('[data-strategy-builtin]');
    assert.equal(await note.count(), 1, 'said once');
    assert.equal((await note.innerText()).trim(), V.STRATEGY_BUILTIN_NOTE);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('with no strategy and no built-in goals, nothing is called Not tied to your strategy (must-exclude)', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: builtinResults([], false) });
  const { page } = ui;
  try {
    await ready(page);
    assert.equal(await list(page).locator('[data-strategy-chip]').count(), 0);
    assert.equal(await page.getByText(V.STRATEGY_NOT_TIED).count(), 0);
    await card(page, 'Score upsell').click();
    await list(page).getByText('Score upsell pays back').waitFor();
    assert.equal(await list(page).locator('[data-strategy-line]').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
