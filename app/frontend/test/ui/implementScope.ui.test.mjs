import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { HARNESS_SETTINGS, HARNESS_USE_CASE, OWNER, built } from './implementFixtures.js';
import { FIRST_RUN_TITLE, GROUPING_JOINED_NOTE, GROUPING_PLAIN, GROUPING_TITLE, RUN_SCOPE_UNRECORDED, RUN_SCOPE_UNRECORDED_HIDDEN } from '../../src/lib/runScope.js';
import { closeBrowser, lowContrast, onStep, openAsset, openBuild, openSettings, openUi, toVibes, until, goToStep, toSummary } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { userName: OWNER, displayName: 'Owner' };
const PERSON = 'person-token';
const PROFILE = {
  table: 'main.sales.orders', records: 48210, applies: true, qualifies: true, standalone: false,
  reason: 'Inspire recommends region, then country because Anomaly Detection works out what is normal inside each group, and country splits main.sales.orders into 31 groups.',
  columns: [{ name: 'region', type: 'string', distinct: 4, smallest: 210, largest: 30110, nulls: 0, parent: null },
    { name: 'country', type: 'string', distinct: 31, smallest: 12, largest: 18200, nulls: 3, parent: 'region' }],
  recommended: ['region', 'country'],
  example: { column: 'country', small_groups: [{ value: 'Cyprus', records: 12 }], moves_to: 'Europe' },
  time_column: 'order_date', recent: { days: 30, records: 3120 },
  suggested_groups: [{ value: 'USA', records: 18200, kind: 'biggest' }, { value: 'Spain', records: 1400, kind: 'typical' }, { value: 'Cyprus', records: 12, kind: 'smallest' }],
  group_column: 'country', group_sizes: [{ value: 'USA', records: 18200 }, { value: 'Spain', records: 1400 }, { value: 'Germany', records: 600 },
    { value: 'Ireland', records: 300 }, { value: 'Malta', records: 40 }],
  groups_for: 'region, country',
  group_list: [['AMER', 'USA', 18200], ['EMEA', 'Spain', 1400], ['EMEA', 'Germany', 600], ['EMEA', 'Ireland', 300], ['EMEA', 'Malta', 40]]
    .map(([region, country, records]) => ({ value: `${region} / ${country}`, records, parts: [{ column: 'region', value: region }, { column: 'country', value: country }] })),
  column_groups: { region: [{ value: 'AMER', records: 30110 }, { value: 'EMEA', records: 17890 }, { value: 'APAC', records: 210 }],
    country: [{ value: 'USA', records: 18200 }, { value: 'Spain', records: 1400 }, { value: 'Germany', records: 600 }, { value: 'Ireland', records: 300 },
      { value: 'Malta', records: 40 }] },
  first_run: { all: 48210, groups: 19612, recent: 3120, records: null }, default_scope: 'records', read_at: '2026-11-01T15:00:00Z',
};
const INSTRUCTION = '## Parameters\n| widget | type | default | allowed | used for |\n|---|---|---|---|---|\n'
  + '| `act_now_share` | text | 0.05 | 0 to 1 | Act now share |\n| `group_by` | text | all | | Data groups |\n| `run_scope` | text | all | | First run |\n';

const profileAt = (calls, answer, { status = 200, after = 0 } = {}) => async (page) => {
  await page.route('**/api/grouping/profile', async (route) => {
    calls.push(JSON.parse(route.request().postData() || '{}'));
    if (after) await new Promise((done) => setTimeout(done, after));
    await route.fulfill({ status, contentType: 'application/json', body: JSON.stringify(answer) });
  });
};
const next = (page) => page.getByRole('button', { name: 'Next' }).click();
const stepBar = (page) => page.locator('[aria-current="step"]').locator('xpath=..').locator('li').allTextContents();
const insertsOf = (made) => made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
  .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));

async function toStep(page, label) {
  for (let i = 0; i < 12 && await page.locator('[aria-current="step"]', { hasText: label }).count() === 0; i += 1) {
    const from = await page.locator('[aria-current="step"]').innerText();
    await next(page);
    await page.waitForFunction((was) => document.querySelector('[aria-current="step"]')?.innerText !== was, from, { timeout: 30000 });
  }
  await onStep(page, label);
}

const SHOTS = process.env.SCOPE_SHOTS || '';

async function atWidths(page, name, section, { whole = false } = {}) {
  const was = page.viewportSize();
  for (const width of [390, 1440]) {
    await page.setViewportSize({ width, height: 900 });
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    if (SHOTS) {
      fs.mkdirSync(SHOTS, { recursive: true });
      await (whole ? page : section).screenshot({ path: path.join(SHOTS, `scope_${name}_${width}.png`) });
    }
    const side = await page.evaluate(() => ({ page: document.scrollingElement.scrollWidth, view: window.innerWidth }));
    assert.ok(side.page <= side.view, `${name} at ${width}: the page runs off the side (${side.page} > ${side.view})`);
    const box = await section.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
    assert.ok(box.scroll <= box.client + 1, `${name} at ${width}: the section runs off its side (${box.scroll} > ${box.client})`);
  }
  if (was) await page.setViewportSize(was);
}

const checkedChoice = (page, attr) => page.locator(`[${attr}]`).evaluateAll((rows, name) => rows.filter((r) => r.querySelector('input[type="radio"]')?.checked)
  .map((r) => r.getAttribute(name)), attr);

test('a first build asks Data groups after Data with the reason and the columns to combine, then First run with each choice, never everything by default, and sends what the person picked', async () => {
  const calls = [];
  const ui = await openUi('wizard', { me: ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: INSTRUCTION } }, '', { init: profileAt(calls, PROFILE) });
  const { page, made } = ui;
  try {
    await toStep(page, 'Data groups');
    assert.deepEqual(await stepBar(page), ['1. Delivery consumption', '2. Data', '3. Data groups', '4. MVP Test Run', '5. Results', '6. App placement', '7. App access', '8. App look', '9. Settings', '10. Vibes', '11. Summary']);
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.deepEqual(await page.locator('[data-wizard-header] ol').evaluate((ol) => ({ overflow: ol.scrollWidth > ol.clientWidth + 1,
      rows: new Set([...ol.children].map((li) => Math.round(li.getBoundingClientRect().top))).size })), { overflow: false, rows: 1 },
    'all eleven steps on one line at 1440x900');
    assert.ok(calls.length >= 1 && calls.every((c) => JSON.stringify(c) === JSON.stringify(calls[0])), JSON.stringify(calls));
    assert.deepEqual(Object.keys(calls[0]).sort(), ['inspire_database', 'session_id', 'use_case_id', 'warehouse_id']);
    assert.deepEqual([calls[0].inspire_database, calls[0].use_case_id, calls[0].warehouse_id],
      [HARNESS_SETTINGS.inspireDatabase, HARNESS_USE_CASE.id, HARNESS_SETTINGS.warehouseId], 'the route reads the use case from the tracking database');
    const grouping = page.getByRole('region', { name: GROUPING_TITLE, exact: true });
    await grouping.getByRole('heading', { name: GROUPING_TITLE }).waitFor();
    assert.equal(await grouping.locator('[data-grouping-why]').textContent(), GROUPING_PLAIN);
    assert.equal(await grouping.locator('[data-grouping-reason]').textContent(), PROFILE.reason, 'one plain sentence says why Inspire recommends it');
    assert.equal(await grouping.locator('[data-grouping-moves]').textContent(),
      'A group too small to compare fairly moves up a level: Cyprus has 12 records, so it is measured with Europe.');
    assert.deepEqual(await grouping.locator('[data-grouping-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.groupingChoice)),
      ['all', 'region, country', 'region', 'country'], 'the whole data first, the recommended grouping, each column, and no custom SQL');
    assert.equal(await grouping.locator('[data-grouping-choice="all"]').innerText(), 'Whole data as one group\n1 group');
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['region, country'], 'the recommended grouping is pre-picked, never a silent whole data');
    assert.match(await grouping.locator('[data-grouping-choice="region, country"]').innerText(), /^region, then country\n5 groups\nHighly Recommended/);
    assert.equal(await grouping.locator('[data-grouping-cards] [data-highly-recommended]').count(), 1, 'one Highly Recommended card');
    assert.equal(await grouping.getByText(/custom|SQL/i).count(), 0, 'no custom SQL is offered');
    const combine = grouping.getByRole('group', { name: 'Combine columns, coarse to fine' });
    assert.deepEqual(await combine.locator('[data-grouping-combine-column]').allInnerTexts(), ['region · 4 groups', 'country · 31 groups'], 'coarse to fine by their groups');
    assert.deepEqual(await combine.locator('input').evaluateAll((boxes) => boxes.map((b) => b.checked)), [true, true]);
    await combine.locator('[data-grouping-combine-column="region"] input').uncheck();
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['country'], 'unticking a column leaves the finer one');
    await grouping.locator('[data-grouping-choice="all"] input').check();
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['all'], 'the whole data stays selectable');
    await atWidths(page, 'grouping', grouping, { whole: true });
    await grouping.locator('[data-grouping-choice="region, country"] input').check();
    await goToStep(page, 'MVP Test Run');
    const firstRun = page.getByRole('region', { name: FIRST_RUN_TITLE, exact: true });
    assert.equal(await firstRun.locator('[data-first-run-held]').textContent(),
      'main.sales.orders holds 48,210 records, so Inspire suggests a smaller MVP Test Run to show results sooner.');
    assert.deepEqual(await firstRun.locator('[data-first-run-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.firstRunChoice)),
      ['one', 'groups', 'records', 'recent', 'all']);
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['records'], 'the first run defaults to about 1,000 records, never everything (must-exclude)');
    assert.equal(await firstRun.locator('[data-first-run-covers]').textContent(), 'The MVP Test Run covers about 1,000 records, in 3 whole groups so no group is cut: '
      + 'country = Germany, 600 records; country = Ireland, 300 records; country = Malta, 40 records.');
    await firstRun.locator('[data-first-run-choice="groups"] input[type="radio"]').check();
    assert.deepEqual(await firstRun.locator('[data-scope-group]').allInnerTexts(), PROFILE.group_list.map((g) => `${g.parts.map((p) => `${p.column} = ${p.value}`).join(' and ')} · ${g.records.toLocaleString('en-US')} records`),
      'the groups of the chosen Data groups, with their sizes');
    await firstRun.locator('[data-scope-group] input').evaluateAll((boxes) => boxes.filter((b) => b.checked).forEach((b) => b.click()));
    await page.getByText('Groups to run on is empty; pick at least one group', { exact: true }).waitFor();
    await firstRun.locator('[data-scope-group="AMER / USA"] input').check();
    await firstRun.locator('[data-scope-group="EMEA / Spain"] input').check();
    assert.equal(await firstRun.locator('[data-first-run-covers]').textContent(), 'The MVP Test Run covers 2 groups of region, then country: region = AMER and country = USA; '
      + 'region = EMEA and country = Spain, 19,600 records. Every other group waits for a run on everything.');
    await firstRun.locator('[data-first-run-choice="one"] input[type="radio"]').check();
    assert.equal(await firstRun.locator('[data-scope-group] input[type="radio"]').count(), PROFILE.group_list.length, 'one group is picked with radios');
    await firstRun.locator('[data-scope-group="EMEA / Malta"] input').check();
    assert.equal(await firstRun.locator('[data-first-run-covers]').textContent(), 'The MVP Test Run covers 1 group of region, then country: region = EMEA and country = Malta, '
      + '40 records. Every other group waits for a run on everything.');
    await firstRun.getByText('Schedules keep this scope until someone presses Run on everything.', { exact: true }).waitFor();
    const contrast = await lowContrast(page, ['[data-scope-step="first_run"]']);
    assert.ok(contrast.checked >= 8, `measured ${contrast.checked}`);
    assert.deepEqual(contrast.low, []);
    await atWidths(page, 'first_run', firstRun, { whole: true });
    await firstRun.locator('[data-first-run-choice="groups"] input[type="radio"]').check();
    await firstRun.locator('[data-scope-group="AMER / USA"] input').check();
    await toStep(page, 'Settings');
    const settings = page.getByRole('region', { name: 'Use case settings', exact: true });
    assert.deepEqual(await settings.locator('[data-setting]').evaluateAll((rows) => rows.map((r) => r.dataset.setting)), ['act_now_share'],
      'Data groups and MVP Test Run have their own steps, so the Settings step does not list them again');
    await toStep(page, 'Summary');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'All Good, Build it Now' && !b.disabled), null, { timeout: 30000 });
    await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the build', 30000);
    const [sent] = insertsOf(made);
    assert.deepEqual([sent.config.widgets.group_by, sent.config.widgets.run_scope, JSON.parse(sent.config.widgets.scope_groups)], ['region, country', 'groups',
      [[{ column: 'region', value: 'AMER' }, { column: 'country', value: 'USA' }], [{ column: 'region', value: 'EMEA' }, { column: 'country', value: 'Malta' }]]],
      'the one group picked first stays picked when the person moves to several groups');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Next on Data waits for a slow read and lands on Data groups, and a first run the person picked stays picked after Back', async () => {
  const calls = [];
  const ui = await openUi('wizard', { me: ME }, '', { init: profileAt(calls, PROFILE, { after: 8000 }) });
  const { page } = ui;
  try {
    await onStep(page, 'Delivery consumption');
    await goToStep(page, 'Data');
    assert.deepEqual(await stepBar(page), ['1. Delivery consumption', '2. Data', '3. Results', '4. App placement', '5. App access', '6. App look', '7. Settings', '8. Vibes', '9. Summary'], 'the table is still being read');
    await next(page);
    await page.getByRole('button', { name: /Reading the table/ }).waitFor({ timeout: 8000 });
    await onStep(page, 'Data groups');
    assert.equal(await page.locator('[aria-current="step"]').innerText(), '3. Data groups');
    await goToStep(page, 'MVP Test Run');
    await page.locator('[data-first-run-choice="all"] input').check();
    await page.getByRole('button', { name: 'Back' }).click();
    await onStep(page, 'Data groups');
    await goToStep(page, 'MVP Test Run');
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['all'], 'the default never replaces a choice the person made');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a Deep discovery grouping is picked and marked on a first build, the person can still pick the whole data as one group, and all is what is sent', async () => {
  const calls = [];
  const deep = { ...PROFILE, deep_suggestion: { columns: ['stores.region', 'store_id'], record_level: 'order_id' } };
  const ui = await openUi('wizard', { me: ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: INSTRUCTION } }, '', { init: profileAt(calls, deep) });
  const { page, made } = ui;
  try {
    await toStep(page, 'Data groups');
    const grouping = page.getByRole('region', { name: 'How is the data split into groups?', exact: true });
    await grouping.locator('[data-grouping-choice]').first().waitFor();
    assert.deepEqual(await grouping.locator('[data-grouping-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.groupingChoice)),
      ['all', 'stores.region, store_id', 'region, country', 'region', 'country']);
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['stores.region, store_id'], 'the Deep grouping is picked before the person chooses');
    assert.match(await grouping.locator('[data-grouping-choice="stores.region, store_id"]').innerText(),
      /^stores\.region, then store_id\ngroups counted once picked\nSuggested by discovery\nHighly Recommended/);
    assert.equal(await grouping.locator('[data-grouping-cards] [data-highly-recommended]').count(), 1, 'the picked Deep grouping is the one Highly Recommended card');
    assert.equal(await grouping.locator('[data-grouping-choice="region, country"] [data-highly-recommended]').count(), 0, 'must-exclude: no second Highly Recommended');
    assert.equal(await grouping.locator('[data-grouping-record-level]').textContent(), 'Discovery found one record per order_id in main.sales.orders.');
    assert.equal(await grouping.locator('[data-grouping-chosen-by="deep"]').textContent(),
      'Discovery picked this grouping. It becomes your choice when you pick it or another one.');
    await grouping.locator('[data-grouping-choice="all"] input').check();
    assert.equal(await grouping.locator('[data-grouping-chosen-by]').count(), 0, 'once the person picks, the grouping is theirs');
    await goToStep(page, 'MVP Test Run');
    await page.getByRole('button', { name: 'Back' }).click();
    await onStep(page, 'Data groups');
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['all'], 'the person picked the whole data, so going back never puts the Deep grouping back');
    await toStep(page, 'Summary');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'All Good, Build it Now' && !b.disabled), null, { timeout: 30000 });
    await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the build', 30000);
    const [sent] = insertsOf(made);
    assert.equal(sent.config.widgets.group_by, 'all');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a Deep discovery grouping left as picked is never sent as the person\'s choice, and its first run is about 1,000 records, never everything', async () => {
  const calls = [];
  const deep = { ...PROFILE, deep_suggestion: { columns: ['store_id'], record_level: 'order_id' } };
  const ui = await openUi('wizard', { me: ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: INSTRUCTION } }, '', { init: profileAt(calls, deep) });
  const { page, made } = ui;
  try {
    await toStep(page, 'Data groups');
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['store_id']);
    await toStep(page, 'Summary');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'All Good, Build it Now' && !b.disabled), null, { timeout: 30000 });
    await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the build', 30000);
    const [sent] = insertsOf(made);
    assert.deepEqual([sent.config.widgets.group_by ?? '', sent.config.widgets.run_scope, sent.config.widgets.scope_groups || ''], ['', 'records', ''],
      'no group_by is sent, so the agent builds on the Deep grouping and records it as chosen by Deep discovery, and no group of another column is sent');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a Deep discovery grouping the profile could not size shows no example, count or groups of another column, and the profiled grouping still does (must-exclude)', async () => {
  const calls = [];
  const deep = { ...PROFILE, deep_suggestion: { columns: ['store_id'], record_level: 'order_id' } };
  const ui = await openUi('wizard', { me: ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: INSTRUCTION } }, '', { init: profileAt(calls, deep) });
  const { page } = ui;
  try {
    await toStep(page, 'Data groups');
    const grouping = page.getByRole('region', { name: 'How is the data split into groups?', exact: true });
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['store_id']);
    assert.equal(await grouping.locator('[data-grouping-why]').textContent(), GROUPING_PLAIN);
    assert.equal(await grouping.locator('[data-grouping-example]').count(), 0, 'no example of country for a store_id grouping (must-exclude)');
    await goToStep(page, 'MVP Test Run');
    const groupsRow = page.locator('[data-first-run-choice="groups"]');
    const offered = () => page.locator('[data-first-run-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.firstRunChoice));
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['records']);
    assert.deepEqual(await offered(), ['records', 'recent', 'all'], 'groups of store_id were not listed with sizes, so no group choice is offered (must-exclude)');
    assert.match(await page.locator('[data-first-run-choice="records"]').innerText(), /^About 1,000 records, in whole groups of store_id so no group is cut/);
    await page.getByRole('button', { name: 'Back' }).click();
    await onStep(page, 'Data groups');
    await grouping.locator('[data-grouping-choice="region, country"] input').check();
    assert.match(await grouping.locator('[data-grouping-example]').textContent(), /Grouped by country/);
    await goToStep(page, 'MVP Test Run');
    assert.deepEqual(await offered(), ['one', 'groups', 'records', 'recent', 'all']);
    await groupsRow.locator('input[type="radio"]').check();
    assert.ok(await groupsRow.locator('[data-scope-group]').count() > 0, 'the profiled grouping lists its own groups');
    assert.equal(await groupsRow.locator('[data-first-run-run-picks]').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('confirming the Deep discovery grouping makes it the person\'s choice, and that is what the build sends', async () => {
  const calls = [];
  const deep = { ...PROFILE, deep_suggestion: { columns: ['store_id'], record_level: 'order_id' } };
  const ui = await openUi('wizard', { me: ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: INSTRUCTION } }, '', { init: profileAt(calls, deep) });
  const { page, made } = ui;
  try {
    await toStep(page, 'Data groups');
    const grouping = page.getByRole('region', { name: 'How is the data split into groups?', exact: true });
    assert.equal(await grouping.locator('[data-grouping-chosen-by="deep"]').count(), 1);
    await grouping.locator('[data-grouping-choice="store_id"] input').click();
    await grouping.locator('[data-grouping-chosen-by]').waitFor({ state: 'detached' });
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['store_id']);
    await toStep(page, 'Summary');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'All Good, Build it Now' && !b.disabled), null, { timeout: 30000 });
    await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the build', 30000);
    const [sent] = insertsOf(made);
    assert.equal(sent.config.widgets.group_by, 'store_id');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a technique Data groups do not apply to asks only for the first run, and a small table still runs first on about 1,000 records, never everything by default (must-exclude)', async () => {
  const calls = [];
  const small = { ...PROFILE, records: 800, applies: false, qualifies: false, standalone: true, default_scope: 'all', first_run: { all: 800, groups: 600, recent: 120, records: 800 }, recent: { days: 30, records: 120 } };
  const ui = await openUi('wizard', { me: ME }, '', { init: profileAt(calls, small) });
  const { page } = ui;
  try {
    await toStep(page, 'MVP Test Run');
    assert.deepEqual(await stepBar(page), ['1. Delivery consumption', '2. Data', '3. MVP Test Run', '4. Results', '5. App placement', '6. App access', '7. App look', '8. Settings', '9. Vibes', '10. Summary']);
    assert.equal(await page.locator('[data-first-run-held]').textContent(), 'main.sales.orders holds 800 records, so the MVP Test Run covers all of it.');
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['records'], 'a profile that still says all is never the default');
    assert.equal(await page.locator('[data-first-run-covers]').textContent(), 'The MVP Test Run covers all 800 records of main.sales.orders, since it holds no more than 1,000 records.');
    assert.deepEqual(await page.locator('[data-first-run-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.firstRunChoice)), ['records', 'recent', 'all'],
      'each record stands alone, so a number of records is offered and no group is (must-exclude)');
    await page.locator('[data-first-run-choice="records"] input[type="radio"]').check();
    await page.getByRole('textbox', { name: 'Records to run on' }).fill('0');
    await page.locator('[data-scope-problem]').getByText("Records to run on is '0'; allowed: a whole number, at least 1", { exact: true }).waitFor();
    await next(page);
    await page.getByRole('alert').getByText("Records to run on is '0'; allowed: a whole number, at least 1").waitFor();
    assert.equal(await page.locator('[aria-current="step"]').innerText(), '3. MVP Test Run', 'a refused value keeps the person on MVP Test Run');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('when Inspire cannot read the table, First run says why and still lets the person pick, and Data groups is not asked', async () => {
  const calls = [];
  const ui = await openUi('wizard', { me: ME }, '', { init: profileAt(calls, { error: 'You cannot read main.sales.orders' }, { status: 403 }) });
  const { page } = ui;
  try {
    await toStep(page, 'MVP Test Run');
    assert.deepEqual((await stepBar(page)).slice(0, 4), ['1. Delivery consumption', '2. Data', '3. MVP Test Run', '4. Results']);
    const refusal = await page.locator('[data-scope-profile="error"]').textContent();
    assert.match(refusal, /^Inspire could not read the table for its suggestions: .*You cannot read main\.sales\.orders/);
    assert.deepEqual(await page.locator('[data-first-run-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.firstRunChoice)), ['one', 'groups', 'records', 'recent', 'all']);
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['records'], 'an unread table never starts on everything (must-exclude)');
    assert.deepEqual(ui.pageErrors.filter((e) => !/status of 403 \(Forbidden\)/.test(e)), [], 'only the refused read answered 403');
  } finally {
    await ui.close();
  }
});

const SCOPE_MODEL = [
  { name: 'act_now_share', label: 'Act now share', group: 'flagging', kind: 'percent', low: 0, high: 1, allowed: '0 to 1', source: 'widget', default: '0.05', unit: '%',
    reason: "Inspire's default", help: 'The share that is Act now.', applies: 'run' },
  { name: 'group_by', label: 'Data groups (columns coarse to fine, or all)', group: 'scope', kind: 'text', allowed: 'all or columns', source: 'widget',
    default: 'all', choices: ['region', 'country'], unit: '', reason: '', help: '', applies: 'run' },
  { name: 'run_scope', label: 'First run', group: 'scope', kind: 'choice', choices: ['all', 'groups', 'recent', 'records'], source: 'widget', default: 'all', unit: '',
    reason: '', help: '', applies: 'run' },
  { name: 'scope_groups', label: 'Groups to run on', group: 'scope', kind: 'choice', many: true, choices: [], source: 'widget', default: '', unit: '', reason: '', help: '', applies: 'run' },
  { name: 'scope_days', label: 'Days to run on', group: 'scope', kind: 'days', low: 1, high: null, allowed: 'at least 1', source: 'widget', default: '30', unit: '',
    reason: '', help: '', applies: 'run' },
  { name: 'scope_records', label: 'Records to run on', group: 'scope', kind: 'integer', low: 1, high: null, allowed: 'at least 1', source: 'widget', default: '1000', unit: '',
    reason: '', help: '', applies: 'run' },
];
const SAVED = { act_now_share: '0.08', group_by: 'all', run_scope: 'groups', scope_groups: 'USA, Spain, Cyprus', scope_days: '30', scope_records: '1000' };
const RUNS = [
  { run_id: 'r3', status: 'succeeded', scope: { scope: 'groups', key: 'groups|country|USA,Spain' }, scope_text: 'First run: 2 groups of country (USA, Spain)',
    facts: { covered: 'The first run covered 19,600 of 48,210 records (2 groups) in 4 minutes.',
      everything: 'Run on everything covers all 48,210 records, about 4 to 10 minutes.' } },
  { run_id: 'r2', status: 'succeeded', scope: { scope: 'all', key: 'all' }, scope_text: 'All records', facts: { covered: '', everything: '' } },
];
const TRACKED = {
  name: 'Hours saved', source: 'inspire', picked_by: 'inspire', kpi_id: null, direction: 'increase', unit: 'hours', impact_kind: 'hours', impact_unit: 'hours',
  computable: true, query: 'SELECT sum(hours) AS v FROM main.s.orders', reason: '', baseline: 40, baseline_on: '2026-10-29', target: 60,
  target_text: 'Raise hours saved to 60', options: ['Hours saved'],
};
const KPI_SUMMARY = {
  use_case_id: 'N01-U01', run_id: 'r3', updated_at: '2026-10-30T06:00:00Z', currency: 'USD', decision_basis: 'measured', act_now_records: '3', review_records: '2',
  records: '40', value_at_stake: '75', impact_kind: 'hours', impact_unit: 'hours', kpi_name: 'Hours saved', kpi_source: 'inspire', kpi_direction: 'increase',
  kpi_unit: 'hours', kpi_baseline: '40', kpi_latest: '46.5', kpi_target: '60', kpi_baseline_on: '2026-10-29', kpi_target_text: 'Raise hours saved to 60',
  kpi_status: 'measured', kpi_reason: null, kpi_measured_at: '2026-10-30T06:00:00Z',
};
const viewOf = (values) => ({
  settings: SCOPE_MODEL.map((s) => ({ ...s, value: values[s.name], saved: false, editable: true })), history: [], editable: true, why: '', can_run: true, job: true,
});
const withScopeModel = () => {
  const row = built();
  return { ...row, notebook_path: '/W/impl/N01-U01', asset_status: JSON.stringify({ ...JSON.parse(row.asset_status), notebook: { state: 'ready', spec_version: 1, result_history: 1 }, settings: SCOPE_MODEL }) };
};

test('the Build page has a Data groups section and a First run section, each read from the App and saved on its own through the App settings route, with the raw value before and the note', async () => {
  const calls = [];
  let values = { ...SAVED };
  const appApi = {
    'GET /api/settings': [() => viewOf(values)],
    'POST /api/settings/save': [(call) => { values = { ...values, [call.body.name]: call.body.value }; return viewOf(values); }],
  };
  const ui = await openBuild({ history: [withScopeModel()], forwardedToken: PERSON, appApi }, { init: profileAt(calls, PROFILE) });
  const { page, made } = ui;
  const saves = () => made.appCalls.filter((c) => c.url.endsWith('/api/settings/save')).map((c) => c.body);
  try {
    const panel = (await openAsset(page, 'notebook')).getByRole('region', { name: 'Settings', exact: true });
    const groups = panel.locator('[data-setting-group="data_groups"]');
    const firstRun = panel.locator('[data-setting-group="run_scope"]');
    await groups.waitFor({ timeout: 30000 });
    assert.deepEqual([await groups.locator('h4').textContent(), await firstRun.locator('h4').textContent()], ['Data groups', 'MVP Test Run']);
    assert.deepEqual(await panel.locator('[data-setting]').evaluateAll((rows) => rows.map((r) => r.dataset.setting)), ['act_now_share'],
      'the five scope settings show once, in their own two sections');
    assert.equal(await groups.locator('[data-scope-part="first_run"]').count(), 0, 'Data groups holds no MVP Test Run choice');
    assert.equal(await firstRun.locator('[data-scope-part="grouping"]').count(), 0, 'MVP Test Run holds no Data groups choice');
    await groups.locator('[data-grouping-choice]').first().waitFor();
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['all']);
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['groups']);
    assert.equal(await panel.getByRole('button', { name: /^Save (Data groups|MVP Test Run)$/ }).count(), 0, 'nothing changed, nothing to save');
    await groups.locator('[data-grouping-choice="country"] input').check();
    assert.equal(await firstRun.getByRole('button', { name: 'Save MVP Test Run' }).count(), 0, 'a Data groups change never offers to save MVP Test Run (must-exclude)');
    await groups.getByRole('textbox', { name: 'Note for the Data groups change' }).fill('  compare countries  ');
    await groups.getByRole('button', { name: 'Save Data groups', exact: true }).click();
    await until(() => saves().length === 1, 'the Data groups save', 30000);
    await groups.getByText('Saved Data groups. Stored results follow at the next run.', { exact: true }).waitFor();
    assert.deepEqual(saves(), [{ page: 'n01_u01', name: 'group_by', value: 'country', was: 'all', note: 'compare countries' }], 'only Data groups is saved');
    await firstRun.locator('[data-scope-group="Spain"] input').uncheck();
    await firstRun.locator('[data-scope-group="Malta"] input').check();
    await firstRun.getByRole('textbox', { name: 'Note for the MVP Test Run change' }).fill('  skip Spain  ');
    await firstRun.getByRole('button', { name: 'Save MVP Test Run', exact: true }).click();
    await until(() => saves().length === 2, 'the MVP Test Run save', 30000);
    await firstRun.getByText('Saved MVP Test Run. Stored results follow at the next run.', { exact: true }).waitFor();
    assert.deepEqual(saves()[1], { page: 'n01_u01', name: 'scope_groups', value: '[[{"column":"country","value":"USA"}],[{"column":"country","value":"Malta"}],[{"column":"country","value":"Cyprus"}]]',
      was: 'USA, Spain, Cyprus', note: 'skip Spain' }, 'only MVP Test Run is saved, and a saved group the table read did not list is kept');
    await atWidths(page, 'build_settings', panel);
    assert.ok(made.appCalls.every((c) => c.headers.Authorization === `Bearer ${PERSON}`));
    assert.ok(calls.length >= 1 && calls.every((c) => c.use_case_id === HARNESS_USE_CASE.id && c.inspire_database === HARNESS_SETTINGS.inspireDatabase));
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Run tab states the scope of the last run, changes Data groups and First run through the same two sections, and Run on everything saves all and then runs, with its measured estimate', async () => {
  const calls = [];
  let values = { ...SAVED };
  const appApi = {
    'GET /api/settings': [() => viewOf(values)],
    'GET /api/runs': [{ runs: RUNS, total: 2, offset: 0, limit: 20 }],
    'POST /api/settings/save': [(call) => { values = { ...values, [call.body.name]: call.body.value }; return viewOf(values); }],
    'POST /api/settings/run': [{ ok: true, run_id: 13 }],
  };
  const row = withScopeModel();
  const registry = [{ ...row, spec_json: JSON.stringify({ ...JSON.parse(row.spec_json), use_case_name: 'Predict churn' }) }];
  const state = { registry, useCaseScope: [{ session_id: '42', use_case_id: 'N01-U01', domain: 'Retention' }], history: [row], forwardedToken: PERSON, appApi };
  const ui = await openUi('run', state, '', { init: profileAt(calls, PROFILE) });
  const { page, made } = ui;
  try {
    const section = page.getByRole('region', { name: 'Data groups and MVP Test Run of this use case', exact: true });
    await section.waitFor({ timeout: 30000 });
    assert.equal(await section.locator('[data-run-scope-text]').textContent(), 'Last run: First run: 2 groups of country (USA, Spain)');
    assert.equal(await section.locator('[data-run-scope-covered]').textContent(), 'The first run covered 19,600 of 48,210 records (2 groups) in 4 minutes.');
    assert.equal(await section.locator('[data-run-scope-note]').textContent(), 'The previous run covered a different scope.', 'a fact, never a warning');
    assert.equal(await section.locator('[data-run-scope-note][role="alert"]').count(), 0);
    await section.locator('[data-scope-part="grouping"] [data-grouping-choice]').first().waitFor();
    assert.ok(calls.length >= 1 && calls.every((c) => c.inspire_database === HARNESS_SETTINGS.inspireDatabase && c.use_case_id === 'N01-U01'), JSON.stringify(calls));
    assert.equal(await section.locator('[data-scope-part="first_run"]').count(), 1, 'the same sections as the Build page');
    assert.deepEqual(await section.locator('[data-setting-group]').evaluateAll((rows) => rows.map((r) => r.dataset.settingGroup)), ['data_groups', 'run_scope']);
    assert.equal(await section.locator('[data-run-everything-estimate]').textContent(), 'Run on everything covers all 48,210 records, about 4 to 10 minutes.');
    await atWidths(page, 'run_tab', section);
    const runAll = section.getByRole('button', { name: 'Run on everything', exact: true });
    assert.equal(await runAll.evaluate((b) => b.className.includes('bg-db-red-solid')), true, 'Run on everything is the main red button');
    await runAll.click();
    assert.equal(await section.locator('[data-run-everything-confirm], [role="alertdialog"]').count(), 0, 'one click starts the run with no extra confirm (must-exclude)');
    await until(() => made.appCalls.some((c) => c.url.endsWith('/api/settings/run')), 'the run on everything', 30000);
    const sent = made.appCalls.filter((c) => c.method === 'POST').map((c) => [new URL(c.url).pathname, c.body]);
    assert.deepEqual(sent, [
      ['/api/settings/save', { page: 'n01_u01', name: 'run_scope', value: 'all', was: 'groups', note: 'Run on everything' }],
      ['/api/settings/run', { page: 'n01_u01' }],
    ], 'every record first, then the run, so the schedule keeps covering everything');
    await section.locator('[data-run-scope-message]').getByText('The run on everything started; schedules now cover every record.', { exact: true }).waitFor();
    await section.getByRole('button', { name: 'Run on everything' }).waitFor({ state: 'detached', timeout: 30000 });
    assert.ok(made.appCalls.every((c) => c.headers.Authorization === `Bearer ${PERSON}`));
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('the Build page states the scope of the last run next to its numbers, and that the previous run covered a different scope, as a fact', async () => {
  const row = withScopeModel();
  const assets = JSON.parse(row.asset_status);
  const kpiRow = { ...row, asset_status: JSON.stringify({ ...assets, notebook: { ...assets.notebook, impact: { kind: 'hours', unit: 'hours', kpi: 'Hours saved' } },
    value_formula: { state: 'ready', spec_version: 1 }, target_kpi: TRACKED }) };
  const appApi = { 'GET /api/settings': [() => viewOf(SAVED)], 'GET /api/runs': [{ runs: RUNS, total: 2, offset: 0, limit: 20 }] };
  const ui = await openBuild({ history: [kpiRow], moneySummary: [KPI_SUMMARY], forwardedToken: PERSON, appApi }, { init: profileAt([], PROFILE) });
  const { page } = ui;
  try {
    const card = (await openAsset(page, 'notebook')).getByRole('region', { name: 'Target KPI', exact: true });
    await card.locator('[data-run-scope-text]').waitFor({ timeout: 30000 });
    assert.equal(await card.locator('[data-run-scope-text]').textContent(), 'Last run: First run: 2 groups of country (USA, Spain)');
    assert.equal(await card.locator('[data-run-scope-covered]').textContent(), 'The first run covered 19,600 of 48,210 records (2 groups) in 4 minutes.');
    assert.equal(await card.locator('[data-run-scope-note]').textContent(), 'The previous run covered a different scope.');
    assert.equal(await card.locator('[data-run-scope-last] [role="alert"], [data-run-scope-last][role="alert"]').count(), 0, 'a fact, never a warning');
    await atWidths(page, 'target_kpi', card);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const quiet = await openBuild({ history: [kpiRow], moneySummary: [KPI_SUMMARY], forwardedToken: PERSON,
    appApi: { ...appApi, 'GET /api/runs': [{ runs: [RUNS[1], RUNS[1]], total: 2 }] } }, { init: profileAt([], PROFILE) });
  try {
    const card = (await openAsset(quiet.page, 'notebook')).getByRole('region', { name: 'Target KPI', exact: true });
    await card.locator('h4').waitFor({ timeout: 30000 });
    await quiet.page.waitForTimeout(1500);
    assert.equal(await card.locator('[data-run-scope-last]').count(), 0, 'a run on every record after another one on every record adds no line');
  } finally {
    await quiet.close();
  }
});

const RECORDED_RUN_SCOPE = JSON.parse(fs.readFileSync(new URL('../../../agent/tests/fixtures/run_scope_legacy_cases.json', import.meta.url), 'utf8')).declaration;
const recordedAsNumber = () => {
  const row = withScopeModel();
  const status = JSON.parse(row.asset_status);
  return { ...row, asset_status: JSON.stringify({ ...status, settings: status.settings.map((s) => (s.name === 'run_scope' ? RECORDED_RUN_SCOPE : s)) }) };
};
const NOT_QUALIFYING = { ...PROFILE, applies: false, qualifies: false, reason: 'Data groups do not apply: Sentiment Analysis looks at each record on its own, so every record is in one group.',
  recommended: [], default_scope: 'all' };

for (const [name, profile] of [['the data qualifies for Data groups', PROFILE], ['the data does not qualify for Data groups', NOT_QUALIFYING]]) {
  test(`all settings on a built version that recorded First run as a number walk First run${profile.applies ? ', Data groups' : ''} and Vibes and save the choice, when ${name}`, async () => {
    const calls = [];
    let answered = 0;
    const init = async (page) => {
      await page.route('**/api/grouping/profile', async (route) => {
        calls.push(JSON.parse(route.request().postData() || '{}'));
        await new Promise((done) => setTimeout(done, 4000));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) });
        answered += 1;
      });
    };
    const ui = await openBuild({ me: ME, history: [recordedAsNumber()], forwardedToken: PERSON }, { init });
    const { page, made } = ui;
    try {
      await openSettings(page);
      assert.ok(answered < calls.length, `the wizard is still reading the table (${answered} of ${calls.length} reads answered)`);
      assert.ok((await stepBar(page)).some((s) => s.endsWith('. MVP Test Run')), `MVP Test Run is a step while the table is read: ${(await stepBar(page)).join(' | ')}`);
      await until(() => calls.length >= 1 && answered === calls.length, 'every read of the table is answered', 30000);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const steps = (await stepBar(page)).map((s) => s.replace(/^\d+\. /, ''));
      assert.equal(steps.includes('Data groups'), profile.applies, `Data groups only when the technique groups: ${steps.join(' | ')}`);
      assert.ok(steps.indexOf('MVP Test Run') > steps.indexOf('Data') && steps.indexOf('MVP Test Run') < steps.indexOf('Vibes'), steps.join(' | '));
      if (profile.applies) assert.equal(steps.indexOf('Data groups') + 1, steps.indexOf('MVP Test Run'));
      const back = page.getByRole('button', { name: 'Back' });
      const first = profile.applies ? 'Data groups' : 'MVP Test Run';
      for (let i = 0; i < steps.length && !(await page.locator('[aria-current="step"]').innerText()).includes(first); i += 1) await back.click();
      await onStep(page, first);
      if (profile.applies) {
        await page.locator('[data-grouping-choice]').first().waitFor();
        await goToStep(page, 'MVP Test Run');
      }
      await page.locator('[data-first-run-choice="recent"] input').check();
      await toVibes(page);
      assert.deepEqual((await page.locator('[role="alert"] p').allTextContents()).filter((t) => /run_scope|MVP Test Run/.test(t)), [], 'no MVP Test Run problem');
      const keep = page.getByRole('radio', { name: /^Keep v\d+ live/ });
      await toSummary(page);
      await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
      if (await keep.count()) {
        await keep.check();
        await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
      }
      await until(() => made.jobs.length === 1, 'the build', 30000);
      const [sent] = insertsOf(made);
      assert.equal(sent.config.widgets.run_scope, 'recent', JSON.stringify(sent.config.widgets));
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}

const withRecordedValue = (row, value) => {
  const spec = JSON.parse(row.spec_json);
  return { ...row, spec_json: JSON.stringify({ ...spec, config: { ...spec.config, widgets: { ...(spec.config.widgets || {}), run_scope: value } } }) };
};

for (const [name, profile] of [['the data qualifies for Data groups', PROFILE], ['the data does not qualify for Data groups', NOT_QUALIFYING]]) {
  test(`all settings on an old spec whose First run is a number open, start from the suggested First run with a plain note, walk to Vibes and save a valid choice, when ${name}`, async () => {
    const calls = [];
    let answered = 0;
    const init = async (page) => {
      await page.route('**/api/grouping/profile', async (route) => {
        calls.push(JSON.parse(route.request().postData() || '{}'));
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) });
        answered += 1;
      });
    };
    const ui = await openBuild({ me: ME, history: [withRecordedValue(recordedAsNumber(), '5')], forwardedToken: PERSON }, { init });
    const { page, made } = ui;
    try {
      await openSettings(page);
      await until(() => calls.length >= 1 && answered === calls.length, 'every read of the table is answered', 30000);
      await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
      const steps = (await stepBar(page)).map((s) => s.replace(/^\d+\. /, ''));
      assert.ok(steps.includes('MVP Test Run'), steps.join(' | '));
      const back = page.getByRole('button', { name: 'Back' });
      for (let i = 0; i < steps.length && !(await page.locator('[aria-current="step"]').innerText()).includes('MVP Test Run'); i += 1) await back.click();
      await onStep(page, 'MVP Test Run');
      const step = page.locator('[data-scope-step="first_run"]');
      await step.locator('[data-first-run-choice]').first().waitFor();
      assert.equal(await step.locator('[data-first-run-unrecorded]').textContent(), RUN_SCOPE_UNRECORDED);
      assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['records'], 'the MVP Test Run step default, never everything, even when the profile still says all (must-exclude)');
      assert.equal(await step.locator('[data-scope-problem]').count(), 0, 'no MVP Test Run problem');
      await toVibes(page);
      assert.deepEqual((await page.locator('[role="alert"] p').allTextContents()).filter((t) => /run_scope|MVP Test Run/.test(t)), [], 'no MVP Test Run problem');
      const keep = page.getByRole('radio', { name: /^Keep v\d+ live/ });
      await toSummary(page);
      await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
      if (await keep.count()) {
        await keep.check();
        await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
      }
      await until(() => made.jobs.length === 1, 'the build', 30000);
      const [sent] = insertsOf(made);
      assert.equal(sent.config.widgets.run_scope, 'records', JSON.stringify(sent.config.widgets));
      assert.deepEqual(ui.pageErrors, []);
    } finally {
      await ui.close();
    }
  });
}

const NOT_FOUND_LOAD = 'Failed to load resource: the server responded with a status of 404 (Not Found)';
const otherErrors = (ui) => ui.pageErrors.filter((e) => e !== NOT_FOUND_LOAD);

test('all settings on an old spec whose First run is a number, when the table read answers not found, show the note on Vibes and build on about 1,000 records, never everything', async () => {
  const calls = [];
  const ui = await openBuild({ me: ME, history: [withRecordedValue(recordedAsNumber(), '5')], forwardedToken: PERSON },
    { init: profileAt(calls, { error: 'No use case N01-U01 in this session.' }, { status: 404 }) });
  const { page, made } = ui;
  try {
    await openSettings(page);
    await until(() => calls.length >= 1, 'the table read', 30000);
    await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
    const steps = (await stepBar(page)).map((s) => s.replace(/^\d+\. /, ''));
    assert.ok(!steps.includes('MVP Test Run') && !steps.includes('Data groups'), `MVP Test Run is hidden: ${steps.join(' | ')}`);
    const back = page.getByRole('button', { name: 'Back' });
    for (let i = 0; i < steps.length && !(await page.locator('[aria-current="step"]').innerText()).includes(steps[0]); i += 1) {
      assert.equal(await page.locator('[data-first-run-unrecorded]').count(),
        (await page.locator('[aria-current="step"]').innerText()).includes('Vibes') ? 1 : 0, 'the note is on Vibes only');
      await back.click();
    }
    assert.equal(await page.locator('[data-first-run-unrecorded]').count(), 0, 'the note is on Vibes only');
    await toVibes(page);
    await onStep(page, 'Vibes');
    assert.deepEqual(await page.locator('[data-first-run-unrecorded]').allTextContents(), [RUN_SCOPE_UNRECORDED_HIDDEN]);
    assert.deepEqual((await page.locator('[role="alert"] p').allTextContents()).filter((t) => /run_scope|MVP Test Run/.test(t)), [], 'no MVP Test Run problem');
    const keep = page.getByRole('radio', { name: /^Keep v\d+ live/ });
    await toSummary(page);
    await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
    if (await keep.count()) {
      await keep.check();
      await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
    }
    await until(() => made.jobs.length === 1, 'the build', 30000);
    const [sent] = insertsOf(made);
    assert.equal(sent.config.widgets.run_scope, 'records', JSON.stringify(sent.config.widgets));
    assert.deepEqual(otherErrors(ui), [], 'the table read that answers not found is the only error');
  } finally {
    await ui.close();
  }
});

test('all settings on an old spec whose First run is a valid choice show no unrecorded note on Vibes when the table read answers not found (must-exclude)', async () => {
  const calls = [];
  const ui = await openBuild({ me: ME, history: [withRecordedValue(recordedAsNumber(), 'recent')], forwardedToken: PERSON },
    { init: profileAt(calls, { error: 'No use case N01-U01 in this session.' }, { status: 404 }) });
  const { page } = ui;
  try {
    await openSettings(page);
    await until(() => calls.length >= 1, 'the table read', 30000);
    await toVibes(page);
    await onStep(page, 'Vibes');
    assert.equal(await page.locator('[data-first-run-unrecorded]').count(), 0);
    assert.deepEqual(otherErrors(ui), [], 'the table read that answers not found is the only error');
  } finally {
    await ui.close();
  }
});

test('the Build page of an old App whose First run was recorded as a number shows the unrecorded note when the table read answers not found', async () => {
  const calls = [];
  const oldView = () => {
    const view = viewOf({ ...SAVED, run_scope: '5' });
    return { ...view, settings: view.settings.map((s) => (s.name === 'run_scope' ? { ...RECORDED_RUN_SCOPE, value: '5', saved: false, editable: true } : s)) };
  };
  const ui = await openBuild({ history: [withRecordedValue(recordedAsNumber(), '5')], forwardedToken: PERSON, appApi: { 'GET /api/settings': [oldView] } },
    { init: profileAt(calls, { error: 'No use case N01-U01 in this session.' }, { status: 404 }) });
  const { page } = ui;
  try {
    const panel = (await openAsset(page, 'notebook')).getByRole('region', { name: 'Settings', exact: true });
    const scope = panel.locator('[data-setting-group="run_scope"]');
    await scope.locator('[data-first-run-unrecorded]').waitFor({ timeout: 30000 });
    assert.equal(await scope.locator('[data-first-run-unrecorded]').textContent(), RUN_SCOPE_UNRECORDED);
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['records'], 'about 1,000 records, never everything, as no table read gives a count (must-exclude)');
    assert.deepEqual(otherErrors(ui), [], 'the table read that answers not found is the only error');
  } finally {
    await ui.close();
  }
});

test('the Build page of an App built before First run had choices shows the recorded First run locked with the reason, and still saves Data groups through the App', async () => {
  const calls = [];
  let values = { ...SAVED, run_scope: 'all' };
  const oldView = () => {
    const view = viewOf(values);
    return { ...view, settings: view.settings.map((s) => (s.name === 'run_scope' ? { ...RECORDED_RUN_SCOPE, value: 'all', saved: false, editable: true } : s)) };
  };
  const appApi = {
    'GET /api/settings': [oldView],
    'POST /api/settings/save': [(call) => { values = { ...values, [call.body.name]: call.body.value }; return oldView(); }],
  };
  const history = [withRecordedValue(recordedAsNumber(), 'recent')];
  const ui = await openBuild({ history, forwardedToken: PERSON, appApi }, { init: profileAt(calls, PROFILE) });
  const { page, made } = ui;
  try {
    const panel = (await openAsset(page, 'notebook')).getByRole('region', { name: 'Settings', exact: true });
    const scope = panel.locator('[data-setting-group="run_scope"]');
    await scope.locator('[data-first-run-choice]').first().waitFor({ timeout: 30000 });
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['recent'], 'the MVP Test Run Inspire recorded, not the old App default');
    assert.match(await scope.locator('[data-first-run-locked]').textContent(), /^This App was built before MVP Test Run had its choices, so it cannot save one\./);
    assert.ok(await scope.locator('[data-first-run-choice] input[type="radio"]').evaluateAll((inputs) => inputs.length > 0 && inputs.every((i) => i.disabled)));
    assert.equal(await panel.locator('[data-setting-group="data_groups"] [data-grouping-choice="country"] input').isDisabled(), false);
    const groups = panel.locator('[data-setting-group="data_groups"]');
    await groups.locator('[data-grouping-choice="country"] input').check();
    assert.equal(await scope.getByRole('button', { name: 'Save MVP Test Run' }).count(), 0, 'a locked MVP Test Run offers no save (must-exclude)');
    await groups.getByRole('button', { name: 'Save Data groups', exact: true }).click();
    await until(() => made.appCalls.filter((c) => c.url.endsWith('/api/settings/save')).length === 1, 'the Data groups save', 30000);
    await groups.getByText('Saved Data groups. Stored results follow at the next run.', { exact: true }).waitFor();
    assert.deepEqual(made.appCalls.filter((c) => c.url.endsWith('/api/settings/save')).map((c) => c.body.name), ['group_by'], 'MVP Test Run is never sent to the old App');
    assert.ok(await scope.locator('[data-first-run-choice] input[type="radio"]').evaluateAll((inputs) => inputs.every((i) => i.disabled)), 'still locked after the save');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const ITEM_JOIN = { table: 'main.retail.item', key: 'ss_item_sk', ref_column: 'i_item_sk' };
const STAR = {
  table: 'main.retail.store_sales', records: 2880404, applies: true, qualifies: true, standalone: false,
  reason: 'Inspire recommends ss_store_sk, then item.i_category because Forecasting works out what is normal inside each group, and item.i_category splits main.retail.store_sales into 10 groups.',
  columns: [{ name: 'ss_store_sk', type: 'int', distinct: 6, smallest: 470000, largest: 490000, nulls: 0, parent: null },
    { name: 'item.i_category', type: 'string', distinct: 10, smallest: 280000, largest: 295000, nulls: 0, parent: 'ss_store_sk', join: ITEM_JOIN }],
  recommended: ['ss_store_sk', 'item.i_category'], example: null, time_column: null, time_via: null, recent: null,
  suggested_groups: [
    { value: '1 / Electronics', records: 49210, kind: 'biggest', parts: [{ column: 'ss_store_sk', value: '1' }, { column: 'item.i_category', value: 'Electronics', join: ITEM_JOIN }] },
    { value: '7 / Home', records: 28180, kind: 'typical', parts: [{ column: 'ss_store_sk', value: '7' }, { column: 'item.i_category', value: 'Home', join: ITEM_JOIN }] }],
  group_column: 'ss_store_sk', group_sizes: [{ value: '1', records: 490000 }, { value: '7', records: 470000 }],
  groups_for: 'ss_store_sk, item.i_category',
  group_list: [['1', 'Electronics', 49210], ['7', 'Home', 28180]].map(([store, category, records]) => ({ value: `${store} / ${category}`, records,
    parts: [{ column: 'ss_store_sk', value: store }, { column: 'item.i_category', value: category, join: ITEM_JOIN }] })),
  column_groups: { ss_store_sk: [{ value: '1', records: 490000 }, { value: '7', records: 470000 }],
    'item.i_category': [{ value: 'Electronics', records: 295000 }, { value: 'Home', records: 280000 }] },
  first_run: { all: 2880404, groups: 77390, recent: null, records: null }, default_scope: 'records', read_at: '2026-11-04T05:00:00Z',
};
const STAR_BARE = { ...STAR, qualifies: false, columns: [], recommended: [], suggested_groups: [], group_column: null, group_sizes: [], groups_for: '', group_list: [], column_groups: {}, default_scope: 'records',
  first_run: { all: 2880404, groups: null, recent: null, records: null },
  reason: 'Inspire recommends the whole data as one group because no column of main.retail.store_sales or of a table it joins splits it into 2 to 500 groups with 30 records each on average.' };
const FORECAST = { ...HARNESS_USE_CASE, analytics_technique: 'Forecasting', genie_instruction: INSTRUCTION };

test('a forecast on a star fact table with no column to group by still asks Data groups with the whole data as one group picked and why, then First run right after it on the first 1,000 records', async () => {
  const calls = [];
  const ui = await openUi('wizard', { me: ME, useCase: FORECAST }, '', { init: profileAt(calls, STAR_BARE) });
  const { page } = ui;
  try {
    await toStep(page, 'Data groups');
    const steps = await stepBar(page);
    assert.ok(steps.some((s) => s.endsWith('. Data groups')), `the step list holds Data groups: ${steps}`);
    assert.equal(steps.findIndex((s) => s.endsWith('. MVP Test Run')), steps.findIndex((s) => s.endsWith('. Data groups')) + 1, 'MVP Test Run comes right after Data groups');
    const grouping = page.getByRole('region', { name: 'How is the data split into groups?', exact: true });
    assert.deepEqual(await grouping.locator('[data-grouping-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.groupingChoice)), ['all'],
      'only the whole data when no column qualifies, never a custom SQL choice');
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['all'], 'the whole data as one group is pre-picked');
    assert.equal(await grouping.locator('[data-grouping-reason]').textContent(), STAR_BARE.reason);
    await goToStep(page, 'MVP Test Run');
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['records'], 'above 1,000 records with nothing to group by, the first 1,000 records');
    assert.ok(!(await checkedChoice(page, 'data-first-run-choice')).includes('all'), 'everything is never the default (must-exclude)');
    assert.match(await page.locator('[data-first-run-choice="records"]').innerText(), /^The first 1,000 records of the whole data, which is one group/);
    assert.match(await page.locator('[data-first-run-choice="all"] [data-first-run-estimate]').textContent(), /^Everything is 2,880,404 records, about 2,880 times/);
    await page.locator('[data-first-run-choice="all"] input').check();
    await next(page);
    await page.locator('[aria-current="step"]', { hasText: 'Results' }).waitFor();
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a forecast on a star fact table recommends the store and the item category it joins, picks it with its join named and no grouping SQL, and First run names each whole group', async () => {
  const calls = [];
  const ui = await openUi('wizard', { me: ME, useCase: FORECAST, forwardedToken: PERSON, forwardedEmail: OWNER }, '', { init: profileAt(calls, STAR) });
  const { page } = ui;
  try {
    await toStep(page, 'Data groups');
    const grouping = page.getByRole('region', { name: 'How is the data split into groups?', exact: true });
    assert.deepEqual(await grouping.locator('[data-grouping-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.groupingChoice)),
      ['all', 'ss_store_sk, item.i_category', 'ss_store_sk', 'item.i_category']);
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['ss_store_sk, item.i_category'],
      'the recommended joined grouping is pre-picked by its table and column, never a silent whole data');
    assert.equal(await grouping.locator('[data-grouping-sql]').count(), 0, 'a joined grouping runs through its join, so no grouping SQL opens (must-exclude)');
    assert.equal(await grouping.locator('[data-grouping-choice="ss_store_sk, item.i_category"] [data-grouping-join-note]').textContent(),
      `item.i_category joins on ${ITEM_JOIN.key} = ${ITEM_JOIN.ref_column}. ${GROUPING_JOINED_NOTE}`);
    assert.equal(await grouping.locator('[data-grouping-choice="ss_store_sk"] [data-grouping-join-note]').count(), 0, 'a main-table column names no join');
    await goToStep(page, 'MVP Test Run');
    const firstRun = page.getByRole('region', { name: 'What should the MVP Test Run cover?', exact: true });
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['records'], 'a star-schema forecast runs first on whole groups, never on everything');
    assert.match(await firstRun.locator('[data-first-run-choice="records"]').innerText(),
      /^470,000 records in the smallest whole group, since every group of ss_store_sk holds more than 1,000 records, so no group is cut: ss_store_sk = 7, 470,000 records/);
    await firstRun.locator('[data-first-run-choice="groups"] input[type="radio"]').check();
    assert.deepEqual(await firstRun.locator('[data-scope-group] input:checked').evaluateAll((inputs) => inputs.length), 2, 'the suggested groups are picked');
    assert.equal(await firstRun.locator('[data-first-run-covers]').textContent(),
      'The MVP Test Run covers 2 groups of ss_store_sk, then item.i_category: ss_store_sk = 1 and item.i_category = Electronics; ss_store_sk = 7 and item.i_category = Home, 77,390 records. '
      + 'Every other group waits for a run on everything.');
    if (process.env.FIRST_RUN_TEXT) fs.writeFileSync(process.env.FIRST_RUN_TEXT, await firstRun.innerText());
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

const WIDE = {
  ...PROFILE,
  reason: 'Inspire recommends col_05 because each col_05 value behaves on its own.',
  columns: Array.from({ length: 20 }, (_, i) => ({ name: `col_${String(i + 1).padStart(2, '0')}`, type: 'string', distinct: (i + 1) * 3, smallest: 10, largest: 900, nulls: 0, parent: null })),
  recommended: ['col_05'],
};
const cardsOf = (grouping) => grouping.locator('[data-grouping-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.groupingChoice));

test('Data groups on a 20-column table shows the pick and the top cards with their group counts, the rest behind Show all with a search, and MVP Test Run highlights the pick', async () => {
  const ui = await openUi('wizard', { me: ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: INSTRUCTION } }, '', { init: profileAt([], WIDE) });
  const { page } = ui;
  try {
    await toStep(page, 'Data groups');
    const grouping = page.getByRole('region', { name: GROUPING_TITLE, exact: true });
    await grouping.locator('[data-grouping-choice="col_05"]').waitFor();
    assert.equal(await grouping.locator('[data-grouping-lead]').innerText(), 'col_05 splits the data into 15 groups. Inspire models each group on its own.');
    assert.deepEqual(await grouping.locator('[data-grouping-lead] strong').allInnerTexts(), ['col_05', '15 groups'], 'the pick and its count are bold');
    assert.deepEqual(await cardsOf(grouping), ['all', 'col_05', 'col_01', 'col_02', 'col_03', 'col_04'], 'the whole data, the pick and the top columns only');
    assert.equal(await grouping.locator('[data-grouping-choice="all"] [data-grouping-count]').innerText(), '1 group');
    assert.equal(await grouping.locator('[data-grouping-choice="col_05"] [data-grouping-count]').innerText(), '15 groups');
    assert.equal(await grouping.locator('[data-grouping-choice]:not(:has([data-grouping-count]))').count(), 0, 'every card says how many groups');
    assert.equal(await grouping.locator('[data-grouping-cards] [data-highly-recommended]').count(), 1, 'one Highly Recommended card');
    assert.equal(await grouping.locator('[data-grouping-choice="col_05"] [data-highly-recommended]').count(), 1);
    const more = grouping.locator('[data-show-all="grouping"]');
    assert.equal(await more.innerText(), 'Show all 20 columns');
    await more.click();
    assert.equal((await cardsOf(grouping)).length, 21, 'Show all lists every column');
    await grouping.getByRole('searchbox', { name: 'Find a column', exact: true }).fill('col_17');
    assert.deepEqual(await cardsOf(grouping), ['all', 'col_05', 'col_17'], 'the search keeps the whole data and the pick (must-exclude: col_01 is gone)');
    await grouping.locator('[data-grouping-choice="col_17"] input').check();
    const combine = grouping.getByRole('group', { name: 'Combine columns, coarse to fine' });
    assert.equal(await combine.locator('[data-grouping-combine-column]').count(), 6, 'Combine columns shows the top columns too');
    await combine.locator('[data-show-all="combine"]').click();
    assert.equal(await combine.locator('[data-grouping-combine-column]').count(), 20);
    await combine.getByRole('searchbox', { name: 'Find a column to combine' }).fill('col_2');
    assert.deepEqual(await combine.locator('[data-grouping-combine-column]').evaluateAll((rows) => rows.map((r) => r.dataset.groupingCombineColumn)), ['col_17', 'col_20'],
      'the search keeps the ticked column');
    await goToStep(page, 'MVP Test Run');
    assert.equal(await page.locator('[data-grouping-chosen]').innerText(), 'Data groups: col_17 · 51 groups. The MVP Test Run runs inside these groups.');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
  const narrow = await openUi('wizard', { me: ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: INSTRUCTION } }, '', { init: profileAt([], PROFILE) });
  try {
    await toStep(narrow.page, 'Data groups');
    await narrow.page.locator('[data-grouping-choice="region, country"]').waitFor();
    assert.equal(await narrow.page.locator('[data-show-all]').count(), 0, 'a 2-column table has no Show all (must-exclude)');
  } finally {
    await narrow.close();
  }
});
