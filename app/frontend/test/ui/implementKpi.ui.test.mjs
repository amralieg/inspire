import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { HARNESS_USE_CASE, OWNER, built } from './implementFixtures.js';
import { closeBrowser, dataToResults, lowContrast, onStep, openAsset, openBuild, openUi, startMvp, until, goToStep } from './uiSupport.mjs';

test.after(closeBrowser);

const KPIS = [
  { name: 'Churn rate', direction: 'decrease', unit: '%', kpi_id: 'K1', computable: true },
  { name: 'Hours saved', direction: 'increase', unit: 'hours' },
];
const withKpis = (kpis) => ({ ...HARNESS_USE_CASE, kpis: JSON.stringify(kpis) });
const ME = { userName: OWNER, displayName: 'Owner' };
const next = (page) => page.getByRole('button', { name: 'Next' }).click();
const picker = (page) => page.getByRole('combobox', { name: 'Target KPI', exact: true });
const insertsOf = (made) => made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
  .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));

const TRACKED = {
  name: 'Hours saved', source: 'inspire', picked_by: 'inspire', kpi_id: null, direction: 'increase', unit: 'hours', impact_kind: 'hours', impact_unit: 'hours',
  computable: true, query: 'SELECT sum(hours) AS v FROM main.s.orders', reason: '', baseline: 40, baseline_on: '2026-10-29', target: 60,
  target_text: 'Raise hours saved to 60', options: ['Churn rate', 'Hours saved'],
};

const builtWith = (kpi, notebookImpact = { kind: kpi.impact_kind, unit: kpi.impact_unit, kpi: kpi.name }) => {
  const row = built();
  const assets = JSON.parse(row.asset_status);
  return { ...row, asset_status: JSON.stringify({ ...assets, notebook: { state: 'ready', spec_version: 1, modified_at: 1, impact: notebookImpact },
    value_formula: { state: 'ready', spec_version: 1 }, target_kpi: kpi }) };
};

const SUMMARY = {
  use_case_id: 'N01-U01', run_id: 'r-9', updated_at: '2026-10-30T06:00:00Z', currency: 'USD', decision_basis: 'measured', act_now_amount: '50', review_amount: '10',
  act_now_records: '3', review_records: '2', records: '40', value_at_stake: '75', impact_kind: 'hours', impact_unit: 'hours',
  value_formula: '{late_hours:number} late hours x {SHARE:percent} recovered', value_expression: 'late_hours * SHARE',
  value_assumptions: JSON.stringify([{ name: 'SHARE', value: 0.5, kind: 'percent' }]),
  kpi_name: 'Hours saved', kpi_source: 'inspire', kpi_direction: 'increase', kpi_unit: 'hours', kpi_baseline: '40', kpi_latest: '46.5', kpi_target: '60',
  kpi_baseline_on: '2026-10-29', kpi_target_text: 'Raise hours saved to 60', kpi_status: 'measured', kpi_reason: null, kpi_measured_at: '2026-10-30T06:00:00Z',
};

test('the Results step offers the use case\u2019s own KPIs with Let Inspire pick first, picked by default, and a pick is sent as the target KPI', async () => {
  for (const [choice, sent] of [['Hours saved', { target: 'Hours saved' }], ['', null]]) {
    const ui = await openUi('wizard', { me: ME, useCase: withKpis(KPIS) });
    const { page, made } = ui;
    try {
      await onStep(page, 'Delivery consumption');
      await goToStep(page, 'Data');
      await dataToResults(page);
      const box = page.getByRole('group', { name: 'Target KPI', exact: true });
      await box.waitFor();
      assert.deepEqual(await picker(page).locator('option').allTextContents(), ['Let Inspire pick', 'Churn rate (%)', 'Hours saved (hours)']);
      assert.equal(await picker(page).inputValue(), '', 'Let Inspire pick is the default');
      assert.equal(await box.locator('[data-kpi-tracked]').textContent(),
        'Inspire picks it when it builds: your strategy\u2019s KPI, else the first it can compute. Records count in its unit, and in money only for a money KPI.');
      if (choice) await picker(page).selectOption({ label: 'Hours saved (hours)' });
      await startMvp(page);
      await until(() => made.jobs.length === 1, 'the first build');
      const [inserted] = insertsOf(made);
      if (sent) assert.deepEqual(inserted.kpi, sent);
      else assert.equal(Object.hasOwn(inserted, 'kpi'), false, 'Let Inspire pick sends no target');
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});

test('the picker shows the KPI the built version tracks, its unit and how records are counted, and why Inspire picked it; a use case with no KPI offers only Let Inspire pick', async () => {
  const ui = await openUi('wizard', { me: ME, useCase: withKpis(KPIS), history: [builtWith(TRACKED)] });
  const { page } = ui;
  try {
    await onStep(page, 'Delivery consumption');
    await goToStep(page, 'Data');
    await dataToResults(page);
    const box = page.getByRole('group', { name: 'Target KPI', exact: true });
    assert.equal(await box.locator('[data-kpi-tracked]').textContent(),
      'v1 tracks Hours saved, in hours, and counts each record in hours at stake. Inspire picked it: it is the first KPI of this use case Inspire can compute from its tables.');
    await picker(page).selectOption({ label: 'Churn rate (%)' });
    await box.getByText('A new target KPI rebuilds the notebook, so every run counts records in the new KPI\u2019s unit.').waitFor();
    const contrast = await lowContrast(page, ['[aria-label="Target KPI"]']);
    assert.ok(contrast.checked >= 3, `measured ${contrast.checked}`);
    assert.deepEqual(contrast.low, []);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const none = await openUi('wizard', { me: ME, useCase: withKpis([]) });
  try {
    await onStep(none.page, 'Delivery consumption');
    await goToStep(none.page, 'Data');
    await dataToResults(none.page);
    assert.deepEqual(await picker(none.page).locator('option').allTextContents(), ['Let Inspire pick']);
    await none.page.getByText('This use case has no Inspire KPI yet, so Inspire evaluates the best KPIs for it from its tables when it builds. After the build you can pick one of them here.').waitFor();
    assert.deepEqual(none.pageErrors, []);
  } finally {
    await none.close();
  }
});

test('the Build page and the notebook panel show the target KPI measured: unit, baseline with its date, latest, target and direction', async () => {
  const ui = await openBuild({ history: [builtWith(TRACKED)], moneySummary: [SUMMARY] });
  const { page } = ui;
  try {
    const card = (await openAsset(page, 'notebook')).getByRole('region', { name: 'Target KPI', exact: true });
    await card.waitFor({ timeout: 15000 });
    assert.equal(await card.getAttribute('data-kpi-status'), 'measured');
    assert.equal(await card.locator('h4').textContent(), 'Target KPI: Hours saved');
    assert.deepEqual(await card.locator('[data-kpi-fact]').evaluateAll((rows) => rows.map((r) => [r.querySelector('dt').textContent, r.querySelector('dd').textContent])),
      [['Unit', 'hours'], ['Baseline', '40 hoursmeasured Oct 29, 2026'], ['Latest', '46.5 hoursmeasured Oct 30, 2026'], ['Target', '60 hours'], ['Direction', 'Increase']]);
    assert.equal(await card.locator('[data-kpi-why]').textContent(), 'Inspire picked it: it is the first KPI of this use case Inspire can compute from its tables.');
    assert.equal(await card.locator('[data-kpi-impact]').textContent(), 'Each record is counted in hours at stake, not money.');
    await openAsset(page, 'notebook');
    const panel = page.locator('[data-asset-panel="notebook"]');
    await panel.locator('[data-kpi-line]').waitFor({ timeout: 15000 });
    assert.equal(await panel.locator('[data-kpi-line]').textContent(), 'Target KPI: Hours saved, 46.5 hours against a target of 60 hours, from a baseline of 40 hours.');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a KPI Inspire could not measure says Not measured with the reason, and a failed query says so in an error tone', async () => {
  const states = [
    ['not_measured', { kpi_status: 'not_measured', kpi_latest: null, kpi_measured_at: null, kpi_reason: 'its definition names no measure, table or column Inspire can aggregate, so it is tracked as text' },
      'Not measured: its definition names no measure, table or column Inspire can aggregate, so it is tracked as text'],
    ['failed', { kpi_status: 'failed', kpi_latest: null, kpi_measured_at: null, kpi_reason: 'its query failed: [TABLE_OR_VIEW_NOT_FOUND] main.s.orders' },
      'Not measured: its query failed: [TABLE_OR_VIEW_NOT_FOUND] main.s.orders'],
  ];
  for (const [status, change, note] of states) {
    const ui = await openBuild({ history: [builtWith(TRACKED)], moneySummary: [{ ...SUMMARY, ...change }] });
    try {
      const card = (await openAsset(ui.page, 'notebook')).getByRole('region', { name: 'Target KPI', exact: true });
      await card.waitFor({ timeout: 15000 });
      assert.equal(await card.getAttribute('data-kpi-status'), status);
      assert.equal(await card.locator('[data-kpi-note]').textContent(), note);
      assert.equal(await card.locator('[data-kpi-note]').getAttribute('data-tone'), status === 'failed' ? 'error' : 'warning');
      assert.equal(await card.locator('[data-kpi-fact]').nth(2).locator('dd').textContent(), 'Not measured');
      const contrast = await lowContrast(ui.page, ['[aria-label="Target KPI"]']);
      assert.deepEqual(contrast.low, [], status);
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});

test('a target KPI whose key result still carries placeholder tags reads in plain words on the card and the notebook panel, and its unset target reads No target set', async () => {
  const LEFTOVER = new RegExp(createRequire(import.meta.url)('../../../agent/tests/fixtures/placeholder_words_cases.json').leftover_tag, 'i');
  const tagged = 'Raise hours saved from [BASELINE] to [TARGET] within [WINDOW]';
  const kpi = { ...TRACKED, computable: false, query: null, baseline: null, baseline_on: null, target: null, target_text: tagged,
    reason: 'its definition names no measure, table or column Inspire can aggregate, so it is tracked as text' };
  const ui = await openBuild({ history: [builtWith(kpi)], moneySummary: [{ ...SUMMARY, kpi_status: 'not_measured', kpi_latest: null, kpi_baseline: null,
    kpi_measured_at: null, kpi_target: null, kpi_target_text: tagged, kpi_reason: kpi.reason }] });
  try {
    const card = (await openAsset(ui.page, 'notebook')).getByRole('region', { name: 'Target KPI', exact: true });
    await card.waitFor({ timeout: 15000 });
    assert.equal(await card.locator('[data-kpi-fact]').nth(3).locator('dd').textContent(), 'No target set');
    const shown = await card.textContent();
    assert.equal(LEFTOVER.test(shown), false, shown);
    await openAsset(ui.page, 'notebook');
    const line = ui.page.locator('[data-asset-panel="notebook"] [data-kpi-line]');
    await line.waitFor({ timeout: 15000 });
    assert.equal(LEFTOVER.test(await line.textContent()), false, await line.textContent());
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a baseline taken on another table than the one the KPI is measured on now is flagged on the card and on the notebook panel', async () => {
  const swapped = 'its baseline was measured on main.s.orders, but it is measured now on main.s.orders_v2, which you chose in its place, '
    + 'so the baseline and the latest value come from different tables';
  const flag = `Baseline: ${swapped.charAt(0).toUpperCase()}${swapped.slice(1)}.`;
  const ui = await openBuild({ history: [builtWith({ ...TRACKED, baseline_reason: swapped })], moneySummary: [{ ...SUMMARY, kpi_reason: swapped }] });
  const { page } = ui;
  try {
    const card = (await openAsset(page, 'notebook')).getByRole('region', { name: 'Target KPI', exact: true });
    await card.waitFor({ timeout: 15000 });
    assert.equal(await card.getAttribute('data-kpi-status'), 'measured', 'the KPI is measured, only its baseline comes from elsewhere');
    assert.equal(await card.locator('[data-kpi-baseline-flag]').textContent(), flag);
    assert.equal(await card.locator('[data-kpi-note]').count(), 0, 'a measured KPI says no Not measured');
    const contrast = await lowContrast(page, ['[aria-label="Target KPI"]']);
    assert.deepEqual(contrast.low, []);
    await openAsset(page, 'notebook');
    const line = page.locator('[data-asset-panel="notebook"] [data-kpi-line]');
    await line.waitFor({ timeout: 15000 });
    assert.equal(await line.textContent(), `Target KPI: Hours saved, 46.5 hours against a target of 60 hours, from a baseline of 40 hours. ${flag}`);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const plain = await openBuild({ history: [builtWith(TRACKED)], moneySummary: [SUMMARY] });
  try {
    const card = (await openAsset(plain.page, 'notebook')).getByRole('region', { name: 'Target KPI', exact: true });
    await card.waitFor({ timeout: 15000 });
    assert.equal(await card.locator('[data-kpi-baseline-flag]').count(), 0, 'a baseline on the same table raises no flag');
  } finally {
    await plain.close();
  }
});

test('an hours KPI never shows a currency or Money at stake anywhere on the MVP page, even when the run row still carries a currency', async () => {
  const ui = await openBuild({ history: [builtWith(TRACKED)], moneySummary: [SUMMARY] });
  const { page } = ui;
  try {
    await (await openAsset(page, 'notebook')).getByRole('region', { name: 'Target KPI', exact: true }).waitFor({ timeout: 15000 });
    const buildText = await page.locator('main, body').first().innerText();
    await openAsset(page, 'notebook');
    const panel = page.locator('[data-mvp-panel="notebook"]');
    await panel.getByRole('tablist', { name: 'Pick a part', exact: true }).getByRole('tab', { name: 'Hours at stake, Ready', exact: true }).click();
    const review = panel.getByRole('region', { name: 'Hours at stake review', exact: true });
    await review.waitFor({ timeout: 15000 });
    assert.equal(await review.locator('h5').textContent(), 'How Genie counts the hours at stake');
    assert.equal(await review.locator('[data-formula]').textContent(), 'Each row: late hours late hours x 50% recovered = its hours at stake.');
    assert.equal(await review.locator('[data-tiers]').textContent(), 'Act now from 50 hours at stake, Review from 10 hours, every other row Monitor.');
    assert.equal(await review.locator('[data-last-run]').textContent(), 'The last run flagged 3 Act now and 2 Review of 40 rows, with 75 hours at stake on them.');
    const notebookText = await page.locator('body').innerText();
    for (const text of [buildText, notebookText]) {
      assert.doesNotMatch(text, /money at stake/i);
      assert.doesNotMatch(text, /\bUSD\b|\$\s?\d/);
    }
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a target KPI whose filter does not match its name shows the reason on its card and never a number, next to a run that measured it before', async () => {
  const fixture = createRequire(import.meta.url)('../../../backend/test/fixtures/kpi_filter_parity.json');
  const mismatch = fixture.comparisons.find((c) => c.name === 'a stored negative-profit share filtered with = 0');
  const record = { ...TRACKED, name: mismatch.spec.name, unit: '%', direction: 'decrease', impact_kind: 'percent', impact_unit: '%', computable: false, query: null,
    reason: mismatch.problem, baseline: null, baseline_on: null, target: 1.5, target_text: 'Cut the share of loss-making orders', prior_rows: false };
  const before = { ...SUMMARY, kpi_name: mismatch.spec.name, kpi_unit: '%', kpi_direction: 'decrease', kpi_baseline: '0.0285', kpi_latest: '0.03', kpi_target: '1.5',
    kpi_target_text: '', kpi_status: 'measured', kpi_reason: null, kpi_query: null };
  const legacy = Object.fromEntries(Object.entries(record).filter(([key]) => key !== 'prior_rows'));
  for (const [label, kpi] of [['recorded with prior_rows', record], ['recorded before prior_rows', legacy]]) {
    const ui = await openBuild({ history: [builtWith(kpi)], moneySummary: [before] });
    try {
      const card = (await openAsset(ui.page, 'notebook')).getByRole('region', { name: 'Target KPI', exact: true });
      await card.waitFor({ timeout: 15000 });
      assert.equal(await card.locator('[data-kpi-note]').textContent(), `Not measured: ${mismatch.problem}`, label);
      const facts = await card.locator('[data-kpi-fact] dd').allTextContents();
      assert.ok(facts.length >= 3, label);
      for (const fact of facts) assert.doesNotMatch(fact, /[0-9]/, `${label}: ${facts.join(' | ')}`);
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  }
});
