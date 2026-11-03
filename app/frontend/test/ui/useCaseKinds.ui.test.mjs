import test from 'node:test';
import assert from 'node:assert/strict';
import { closeBrowser, lowContrast, openUi, setDark } from './uiSupport.mjs';
import { RESULTS } from './implementFixtures.js';
import { KINDS } from '../../src/lib/kinds.js';

test.after(closeBrowser);

const LINES = {
  serving_summary: 'A forecast cockpit for the regional planner with the expected stock-out rate per store.',
  method_summary: 'Forecasting: past sales per store and day project the next 4 weeks with a range.',
  value_source: 'Better orders: fewer stock-outs per store each week.',
};
const KINDED = {
  ...RESULTS,
  domains: RESULTS.domains.map((d) => ({
    ...d,
    use_cases: d.use_cases.map((u) => (u.No === 'N02-U01'
      ? { ...u, use_case_kind: 'forecast', kind_family: 'predict', app_layout: 'forecast_cockpit', ...LINES }
      : u)),
  })),
};
const STATE = { results: KINDED, useCases: [] };
const familyColor = (id) => KINDS.families.find((f) => f.id === id).color;
const rgb = (hex) => `rgb(${[1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ')})`;

const list = (page) => page.getByRole('region', { name: 'Use case list' });
const cards = (page) => list(page).locator('[aria-expanded]');
const card = (page, name) => list(page).locator('.lift-on-hover').filter({ hasText: name });

async function ready(page) {
  await list(page).waitFor();
  await cards(page).first().waitFor();
}

test('each card carries its kind and technique chips in its family color, and an old use case derives its kind from the technique', async () => {
  const ui = await openUi('results', STATE);
  const { page } = ui;
  try {
    await ready(page);
    const forecast = card(page, 'Forecast stock');
    const chip = forecast.locator('[data-kind-chip]');
    assert.equal(await chip.getAttribute('data-kind-chip'), 'forecast');
    assert.equal((await chip.innerText()).trim(), 'Predict · Forecast');
    assert.equal(await chip.evaluate((el) => getComputedStyle(el).borderTopColor), rgb(familyColor('predict')));
    assert.equal((await forecast.locator('[data-technique-chip]').innerText()).trim(), 'Forecasting');
    const late = card(page, 'Spot late suppliers').locator('[data-kind-chip]');
    assert.equal(await late.getAttribute('data-kind-chip'), 'anomaly', 'Anomaly detection derives the anomaly kind');
    assert.equal(await late.getAttribute('data-kind-family'), 'detect_protect');
    assert.equal(await late.evaluate((el) => getComputedStyle(el).borderTopColor), rgb(familyColor('detect_protect')));
    const segment = card(page, 'Segment shoppers').locator('[data-kind-chip]');
    assert.equal(await segment.getAttribute('data-kind-family'), 'know_entities');
    assert.notEqual(await segment.evaluate((el) => getComputedStyle(el).borderTopColor),
      await late.evaluate((el) => getComputedStyle(el).borderTopColor), 'two families never share a color');
    assert.equal(await card(page, 'Score upsell').locator('[data-kind-chip]').count(), 0, 'Regression maps to no kind, so no chip');
    assert.match(await card(page, 'Score upsell').innerText(), /Regression/, 'a use case with no kind still shows its technique');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the kind filter narrows the cards to a family or a kind, its chip clears it, and Clear brings every card back', async () => {
  const ui = await openUi('results', STATE);
  const { page } = ui;
  try {
    await ready(page);
    const total = await cards(page).count();
    const select = page.getByRole('combobox', { name: 'Kind' });
    const options = await select.locator('option').evaluateAll((els) => els.map((el) => el.value));
    assert.equal(options[0], 'all');
    assert.ok(options.includes('family:predict') && options.includes('kind:forecast') && options.includes('kind:risk_propensity'), options.join());
    await select.selectOption('family:predict');
    const predicted = await cards(page).allInnerTexts();
    assert.ok(predicted.length >= 2 && predicted.length < total, `${predicted.length} of ${total}`);
    assert.ok(predicted.some((t) => /Forecast stock/.test(t)) && predicted.some((t) => /Predict churn/.test(t)));
    assert.ok(!predicted.some((t) => /Spot late suppliers|Score upsell/.test(t)), 'other families and kindless cards are dropped');
    await select.selectOption('kind:forecast');
    assert.deepEqual((await cards(page).allInnerTexts()).map((t) => /Forecast stock/.test(t)), [true]);
    await page.locator('span', { hasText: /^Forecast×$/ }).getByRole('button').click();
    assert.equal(await cards(page).count(), total);
    await select.selectOption('family:detect_protect');
    assert.equal(await cards(page).count(), 1);
    await page.getByRole('button', { name: /^Clear/ }).first().click();
    assert.equal(await cards(page).count(), total);
    assert.equal(await select.inputValue(), 'all');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('an open card says what you get above the problem statement, with the 3 lines, and an old use case shows the kind question', async () => {
  const ui = await openUi('results', STATE);
  const { page } = ui;
  try {
    await ready(page);
    const forecast = card(page, 'Forecast stock');
    await forecast.locator('[aria-expanded]').click();
    const section = forecast.locator('[data-what-you-get]');
    await section.waitFor();
    assert.deepEqual(await section.locator('[data-kind-line]').allInnerTexts(), [
      `What we serve: ${LINES.serving_summary}`, `How it works: ${LINES.method_summary}`, `Where the value comes from: ${LINES.value_source}`,
    ]);
    assert.match(await section.innerText(), /Predict · Forecast · Forecasting/);
    const above = await forecast.evaluate((el) => {
      const what = el.querySelector('[data-what-you-get]');
      const problem = [...el.querySelectorAll('h4')].find((h) => /Problem Statement/i.test(h.textContent));
      return Boolean(what && problem && (what.compareDocumentPosition(problem) & Node.DOCUMENT_POSITION_FOLLOWING));
    });
    assert.equal(above, true, 'What you get comes before the problem statement');
    const light = await lowContrast(page, ['[data-what-you-get]']);
    assert.ok(light.checked >= 4 && light.low.length === 0, JSON.stringify(light));
    await setDark(page, true);
    const dark = await lowContrast(page, ['[data-what-you-get]']);
    assert.ok(dark.checked >= 4 && dark.low.length === 0, `the section reads in the dark theme too: ${JSON.stringify(dark)}`);
    await setDark(page, false);
    const churn = card(page, 'Predict churn');
    await churn.locator('[aria-expanded]').click();
    const old = churn.locator('[data-what-you-get]');
    await old.waitFor();
    assert.equal(await old.locator('[data-kind-line]').count(), 0);
    assert.match(await old.innerText(), new RegExp(KINDS.kinds.find((k) => k.id === 'risk_propensity').question.replace(/[?.()]/g, '\\$&')));
    const upsell = card(page, 'Score upsell');
    await upsell.locator('[aria-expanded]').click();
    await upsell.getByText('Problem Statement').waitFor();
    assert.equal(await upsell.locator('[data-what-you-get]').count(), 0, 'no kind, no section');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});
