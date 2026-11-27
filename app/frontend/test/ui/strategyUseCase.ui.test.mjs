import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, openUi, toView } from './uiSupport.mjs';
import { REVIEW_RESULTS, REVIEW_STATE } from './reviewFixtures.js';
import * as V from '../../src/lib/v130UseCase.js';
import { openReader, closeReader, readerOf } from './reviewRows.mjs';

test.after(closeBrowser);

const list = (page) => page.getByRole('region', { name: 'Use case list' });
const cards = (page) => list(page).locator('[data-use-case-row]');
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

// REQ-511: the chips, strategy line and KPI badges live in the reader (the full card), not in the row.
async function openCard(page, name) {
  const reader = await openReader(page, card(page, name));
  await reader.locator('[data-strategy-line]').first().waitFor();
  return reader.locator('[data-strategy-line]');
}

async function chipOf(page, name) {
  const reader = await openReader(page, card(page, name));
  const chips = reader.locator('[data-strategy-chip]');
  const text = (await chips.count()) ? (await chips.first().innerText()).trim() : null;
  await closeReader(page);
  return text;
}

test('the Strategy coverage card is gone; each use case names the goal and priorities it serves, and one tied to nothing says so', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: CUSTOMER });
  const { page } = ui;
  try {
    await ready(page);
    await toView(page, 'Overview');
    await page.locator('[data-insights-grid]').waitFor();
    assert.equal(await page.locator('[data-insight="Strategy coverage"]').count(), 0, 'no Strategy coverage card');
    assert.equal(await page.getByText('use cases not aligned to any entry').count(), 0);
    await toView(page, 'Use cases');

    assert.equal(await chipOf(page, 'Predict churn'), 'Keep customers');
    assert.equal(await chipOf(page, 'Score upsell'), 'Sell more');
    assert.equal(await chipOf(page, 'Price elasticity'), V.STRATEGY_NOT_TIED);
    assert.equal(await chipOf(page, 'Forecast stock'), null, 'no chip without strategy data');

    const line = await openCard(page, 'Predict churn');
    const text = (await line.innerText()).replace(/\s+/g, ' ');
    assert.match(text, /Serves Keep customers, part of Grow/);
    assert.match(text, /Business priorities: Cut churn/);
    assert.match(text, /Measured by: Churn rate/);
    assert.doesNotMatch(text, /built-in goals/, 'a customer strategy is not called built-in');
    assert.equal(await list(page).getByText('Priority Alignment', { exact: true }).count(), 0, 'the priorities are not repeated in a tile');
    await closeReader(page);

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
    assert.equal(await chipOf(page, 'Predict churn'), 'Increase Revenue');
    assert.equal(await chipOf(page, 'Score upsell'), V.STRATEGY_NOT_TIED);
    const line = await openCard(page, 'Predict churn');
    assert.match((await line.innerText()).replace(/\s+/g, ' '), /Serves Increase Revenue \(Strategic Goal\)/);
    const note = readerOf(page).locator('[data-strategy-builtin]');
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
    const reader = await openReader(page, card(page, 'Score upsell'));
    await reader.getByText('Score upsell pays back').waitFor();
    assert.equal(await reader.locator('[data-strategy-chip]').count(), 0);
    assert.equal(await reader.locator('[data-strategy-line]').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const LEVELED = withUseCases({
  ...REVIEW_RESULTS,
  strategy_coverage: { ...REVIEW_RESULTS.strategy_coverage, levels: ['Theme', 'Ambition'], entries: REVIEW_RESULTS.strategy_coverage.entries.map((e) => ({ ...e, level: '' })) },
}, {
  'N01-U01': { kpis: JSON.stringify([{ name: 'Churn rate', direction: 'decrease', source: 'strategy' }, { name: 'Save rate', source: 'proposed' }]) },
  'N01-U02': { kpis: JSON.stringify([{ name: 'Basket size', source: 'proposed' }]) },
  'N02-U01': { strategy_alignment: JSON.stringify([{ id: 'S4', path: 'Run lean > Stock right', evidence: 'stock' }]),
    kpis: JSON.stringify([{ name: 'churn rate', source: 'strategy' }]) },
});

test('with the user own level names, each card and detail names the entry at every level, and Results filters by each level and by KPI', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: LEVELED });
  const { page } = ui;
  try {
    await ready(page);
    assert.equal(await chipOf(page, 'Predict churn'), 'Ambition: Keep customers');
    assert.equal(await chipOf(page, 'Price elasticity'), V.STRATEGY_NOT_TIED);
    assert.equal(await page.getByRole('button', { name: /^Strategy\b/ }).count(), 0, 'the level panels replace the single Strategy tree');

    await openCard(page, 'Predict churn');
    const levels = readerOf(page).locator('[data-strategy-levels]');
    assert.equal((await levels.innerText()).replace(/\s+/g, ' ').trim(), 'Theme Grow Ambition Keep customers');
    const origins = await readerOf(page).locator('[data-kpi-origin]').allInnerTexts();
    assert.deepEqual(origins.map((t) => t.trim()), [V.KPI_FROM_STRATEGY, V.KPI_PROPOSED]);
    await closeReader(page);

    await panel(page, 'Theme').click();
    await page.getByRole('button', { name: /^Run lean\b/ }).click();
    await card(page, 'Predict churn').waitFor({ state: 'detached' });
    assert.deepEqual(await shown(page), ['Forecast stock']);
    await page.getByRole('button', { name: /^Grow\b/ }).click();
    await card(page, 'Predict churn').waitFor();
    assert.deepEqual(await shown(page), ['Predict churn', 'Score upsell']);

    await panel(page, 'Ambition').click();
    await page.getByRole('button', { name: /^Sell more\b/ }).click();
    await card(page, 'Predict churn').waitFor({ state: 'detached' });
    assert.deepEqual(await shown(page), ['Score upsell']);
    await page.getByRole('button', { name: /^Sell more\b/ }).click();
    await page.getByRole('button', { name: /^Grow\b/ }).click();
    await card(page, 'Forecast stock').waitFor();

    await panel(page, 'KPIs').click();
    const kpiButtons = await page.getByRole('button', { name: /^(Churn rate|Save rate|Basket size)\b/ }).allInnerTexts();
    assert.deepEqual(kpiButtons.map((t) => t.split('\n')[0].trim()), ['Churn rate', 'Basket size', 'Save rate'], 'your KPIs first, then proposed ones');
    await page.getByRole('button', { name: /^Churn rate\b/ }).click();
    await card(page, 'Score upsell').waitFor({ state: 'detached' });
    assert.deepEqual(await shown(page), ['Forecast stock', 'Predict churn'], 'a KPI name matches whatever its case');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('without user level names the card, detail and filters stay as they were (must-exclude)', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: CUSTOMER });
  const { page } = ui;
  try {
    await ready(page);
    assert.equal(await chipOf(page, 'Score upsell'), 'Sell more');
    assert.equal(await page.getByRole('button', { name: /^KPIs\b/ }).count(), 0);
    assert.equal(await page.getByRole('button', { name: /^Strategy\b/ }).count(), 1);
    await openCard(page, 'Predict churn');
    assert.equal(await readerOf(page).locator('[data-strategy-levels]').count(), 0);
    assert.equal(await readerOf(page).locator('[data-kpi-origin]').count(), 0, 'a KPI with no source gets no badge');
  } finally {
    await ui.close();
  }
});

const THREE_LEVELS = withUseCases({
  ...REVIEW_RESULTS,
  strategy_coverage: {
    source: 'customer', levels: ['Pillar', 'Goal', 'Objective'], use_cases: 6, aligned: 3, not_aligned: 3,
    entries: [
      { id: 'S1', path: 'Grow', level: '', use_cases: 2, direct: 0 },
      { id: 'S2', path: 'Grow > Keep customers', level: '', use_cases: 1, direct: 1 },
      { id: 'S3', path: 'Grow > Sell more', level: '', use_cases: 1, direct: 1 },
      { id: 'S4', path: 'Grow > Keep customers > Win repeat buyers', level: '', use_cases: 0, direct: 0 },
    ],
    gaps: [], priorities: [], priority_gaps: [],
  },
}, {
  'N01-U01': { strategy_alignment: JSON.stringify([{ id: 'S2', path: 'Grow > Keep customers', evidence: 'orders' }]) },
  'N01-U02': { strategy_alignment: JSON.stringify([{ id: 'S3', path: 'Grow > Sell more', evidence: 'basket' }]) },
  'N02-U01': { strategy_alignment: '[]' },
});

test('a three-level strategy gets one filter per level the user named, the one nothing reaches included, and each narrows the list (REQ-075)', async () => {
  const ui = await openUi('results', { ...REVIEW_STATE, results: THREE_LEVELS });
  const { page } = ui;
  try {
    await ready(page);
    for (const title of ['Pillar', 'Goal', 'Objective']) {
      assert.equal(await panel(page, title).count(), 1, `a filter named ${title}`);
    }
    assert.equal(await page.getByRole('button', { name: /^Strategy\b/ }).count(), 0, 'no single Strategy tree next to the level filters');
    await panel(page, 'Objective').click();
    await page.getByRole('button', { name: /^Win repeat buyers\b/ }).waitFor();
    await panel(page, 'Pillar').click();
    await page.getByRole('button', { name: /^Grow\b/ }).click();
    await card(page, 'Predict churn').waitFor();
    assert.deepEqual(await shown(page), ['Predict churn', 'Score upsell']);
    await page.getByRole('button', { name: /^All use cases\b/ }).first().click();
    await card(page, 'Forecast stock').waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
