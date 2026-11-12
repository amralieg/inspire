import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { GROUPING_INSTRUCTION as INSTRUCTION, GROUPING_PROFILE as PROFILE, HARNESS_SETTINGS, HARNESS_USE_CASE, OWNER, built } from './implementFixtures.js';
import { FIRST_RUN_TITLE, GROUPING_JOINED_NOTE, GROUPING_PLAIN, GROUPING_TITLE, RUN_SCOPE_UNRECORDED, RUN_SCOPE_UNRECORDED_HIDDEN } from '../../src/lib/runScope.js';
import { closeBrowser, nextUntil, profileAt, stepHolding, goToStep, idle, lowContrast, onStep, openAsset, openBuild, openSettings, openUi, toSummary, toVibes, until } from './uiSupport.mjs';

test.after(closeBrowser);

const ME = { userName: OWNER, displayName: 'Owner' };
const PERSON = 'person-token';
const next = (page) => page.getByRole('button', { name: 'Next' }).click();
const stepBar = (page) => page.locator('[aria-current="step"]').locator('xpath=..').locator('li').allTextContents();
const insertsOf = (made) => made.sqlCalls.filter((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'))
  .map((c) => JSON.parse(c.parameters.find((p) => p.name === 'spec').value));

async function toStep(page, part) {
  await nextUntil(page, part);
  await onStep(page, part);
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

test('a first build asks Data groups on their own step with the reason and the columns to combine, then First run with each choice, never everything by default, and sends what the person picked', async () => {
  const calls = [];
  const ui = await openUi('wizard', { me: ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: INSTRUCTION } }, '', { init: profileAt(calls, PROFILE) });
  const { page, made } = ui;
  try {
    await toStep(page, 'Data groups');
    assert.deepEqual(await stepBar(page), ['1. What to deliver', '2. Data & results', '3. Data groups', '4. First run', '5. Measure', '6. Where it lives', '7. Who uses the App', '8. Page storage', '9. App look', '10. Run it', '11. Review & build']);
    await page.setViewportSize({ width: 1440, height: 900 });
    assert.deepEqual(await page.locator('[data-wizard-header] ol').evaluate((ol) => ({ overflow: ol.scrollWidth > ol.clientWidth + 1,
      rows: new Set([...ol.children].map((li) => Math.round(li.getBoundingClientRect().top))).size })), { overflow: false, rows: 1 },
    'all eleven steps on one line at 1440x900');
    assert.ok(calls.length >= 1 && calls.every((c) => JSON.stringify(c) === JSON.stringify(calls[0])), JSON.stringify(calls));
    assert.deepEqual(Object.keys(calls[0]).sort(), ['inspire_database', 'session_id', 'table', 'use_case_id', 'warehouse_id']);
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
    assert.match(await grouping.locator('[data-grouping-choice="region, country"]').innerText(), /^region, then country\n31 groups\nRecommended/);
    assert.equal(await grouping.locator('[data-grouping-cards] [data-recommended]').count(), 1, 'one Recommended card');
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
    await goToStep(page, 'First run');
    const firstRun = page.getByRole('region', { name: FIRST_RUN_TITLE, exact: true });
    assert.equal(await firstRun.locator('[data-first-run-held]').textContent(),
      'main.sales.orders holds 48,210 records, so Inspire suggests a smaller First run to show results sooner.');
    assert.deepEqual(await firstRun.locator('[data-first-run-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.firstRunChoice)),
      ['one', 'groups', 'records', 'recent', 'all']);
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['records'], 'the first run defaults to about 1,000 records, never everything (must-exclude)');
    assert.equal(await firstRun.locator('[data-first-run-covers]').textContent(), 'The First run covers 940 records in 3 whole groups. No group is cut.');
    const recordsRow = firstRun.locator('[data-first-run-choice="records"]');
    assert.equal(await recordsRow.locator('label .font-medium').first().innerText(), '940 records in 3 whole groups', 'the option is one short line with the exact count');
    await recordsRow.locator('[data-first-run-details="records"] summary').click();
    assert.deepEqual(await recordsRow.locator('[data-first-run-group]').allInnerTexts(), ['country = Germany · 600 records', 'country = Ireland · 300 records', 'country = Malta · 40 records'],
      'the whole groups are listed under Details');
    for (const id of ['one', 'groups']) assert.match(await firstRun.locator(`[data-first-run-choice="${id}"] [data-first-run-records]`).innerText(), /· [\d,]+ records?$/, `${id} shows its records`);
    await firstRun.locator('[data-first-run-choice="groups"] input[type="radio"]').check();
    assert.deepEqual(await firstRun.locator('[data-scope-group]').allInnerTexts(), PROFILE.group_list.map((g) => `${g.parts.map((p) => `${p.column} = ${p.value}`).join(' and ')} · ${g.records.toLocaleString('en-US')} records`),
      'the groups of the chosen Data groups, with their sizes');
    await firstRun.locator('[data-scope-group] input').evaluateAll((boxes) => boxes.filter((b) => b.checked).forEach((b) => b.click()));
    await page.getByText('Groups to run on is empty; pick at least one group', { exact: true }).waitFor();
    await firstRun.locator('[data-scope-group="AMER / USA"] input').check();
    await firstRun.locator('[data-scope-group="EMEA / Spain"] input').check();
    assert.equal(await firstRun.locator('[data-first-run-covers]').textContent(), 'The First run covers 2 groups of region, then country: region = AMER and country = USA; '
      + 'region = EMEA and country = Spain, 19,600 records. Every other group waits for a run on everything.');
    await firstRun.locator('[data-first-run-choice="one"] input[type="radio"]').check();
    assert.equal(await firstRun.locator('[data-scope-group] input[type="radio"]').count(), PROFILE.group_list.length, 'one group is picked with radios');
    await firstRun.locator('[data-scope-group="EMEA / Malta"] input').check();
    assert.equal(await firstRun.locator('[data-first-run-covers]').textContent(), 'The First run covers 1 group of region, then country: region = EMEA and country = Malta, '
      + '40 records. Every other group waits for a run on everything.');
    await firstRun.getByText('Only the first run uses this test scope. Every later run, scheduled or not, covers all the records in the Data groups.', { exact: true }).waitFor();
    const contrast = await lowContrast(page, ['[data-scope-step="first_run"]']);
    assert.ok(contrast.checked >= 8, `measured ${contrast.checked}`);
    assert.deepEqual(contrast.low, []);
    await atWidths(page, 'first_run', firstRun, { whole: true });
    await firstRun.locator('[data-first-run-choice="groups"] input[type="radio"]').check();
    await firstRun.locator('[data-scope-group="AMER / USA"] input').check();
    await toStep(page, 'Review & build');
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

test('the First run saved is exactly the one the person picked: a group picked last is sent as groups with that group, never with the days of another choice, and the Summary says what is sent', async () => {
  const ui = await openUi('wizard', { me: ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: INSTRUCTION } }, '', { init: profileAt([], PROFILE) });
  const { page, made } = ui;
  const firstRunRow = () => page.locator('[data-picked-row="first_run"] [data-picked-value]').textContent();
  try {
    await toStep(page, 'First run');
    const firstRun = page.getByRole('region', { name: FIRST_RUN_TITLE, exact: true });
    await firstRun.locator('[data-first-run-choice="one"] input[type="radio"]').check();
    await firstRun.locator('[data-scope-group="EMEA / Malta"] input').check();
    await firstRun.locator('[data-first-run-choice="recent"] input[type="radio"]').check();
    await firstRun.getByLabel('Days to run on').fill('14');
    await toStep(page, 'Review & build');
    assert.equal(await firstRunRow(), 'The last 14 days of order_date · 3,120 records', 'the Summary names the recent period the person picked last, as the step words it');
    await page.locator('[data-picked-change="first_run"]').click();
    await onStep(page, 'First run');
    await firstRun.locator('[data-first-run-choice="one"] input[type="radio"]').check();
    assert.deepEqual(await firstRun.locator('[data-scope-group] input').evaluateAll((boxes) => boxes.filter((b) => b.checked).map((b) => b.closest('[data-scope-group]').dataset.scopeGroup)),
      ['EMEA / Malta'], 'switching back keeps the group the person picked');
    await page.getByRole('button', { name: 'Back to Summary' }).click();
    await onStep(page, 'Review & build');
    assert.equal(await firstRunRow(), 'One group · 40 records: region = EMEA and country = Malta', 'the Summary names the group that is sent, as the step words it');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'All Good, Build it Now' && !b.disabled), null, { timeout: 30000 });
    await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the build', 30000);
    const [sent] = insertsOf(made);
    const { group_by: groupBy, run_scope: runScope, scope_groups: groups, ...rest } = sent.config.widgets;
    assert.deepEqual([groupBy, runScope, JSON.parse(groups)], ['region, country', 'groups', [[{ column: 'region', value: 'EMEA' }, { column: 'country', value: 'Malta' }]]]);
    assert.deepEqual(Object.keys(rest).filter((name) => name.startsWith('scope_')), [], 'the days of the recent period the person left are not saved (must-exclude)');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('while the groups of a new Data groups pick are read, One group and Several groups stay in place but cannot be picked, so no row moves under the pointer', async () => {
  const REGION = { ...PROFILE, groups_for: 'region', group_column: 'region', suggested_groups: [{ value: 'AMER', records: 30110, kind: 'biggest' }],
    group_list: PROFILE.column_groups.region.map((g) => ({ ...g, parts: [{ column: 'region', value: g.value }] })) };
  const BASE = { ...PROFILE, column_groups: { country: PROFILE.column_groups.country } };
  const init = async (page) => {
    await page.route('**/api/grouping/profile', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      if (body.group_by) await new Promise((done) => setTimeout(done, 4000));
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body.group_by ? REGION : BASE) });
    });
  };
  const ui = await openUi('wizard', { me: ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: INSTRUCTION } }, '', { init });
  const { page } = ui;
  try {
    await toStep(page, 'Data groups');
    await page.locator('[data-grouping-choice="region"] input').check();
    await goToStep(page, 'First run');
    const firstRun = page.getByRole('region', { name: FIRST_RUN_TITLE, exact: true });
    await firstRun.locator('[data-first-run-groups-reading]').waitFor();
    const rows = () => firstRun.locator('[data-first-run-choice]').evaluateAll((all) => all.map((r) => [r.dataset.firstRunChoice, r.querySelector('input').disabled]));
    assert.deepEqual(await rows(), [['one', true], ['groups', true], ['records', false], ['recent', false], ['all', false]], 'the group rows wait in place');
    await firstRun.locator('[data-first-run-groups-reading]').waitFor({ state: 'detached', timeout: 15000 });
    assert.deepEqual(await rows(), [['one', false], ['groups', false], ['records', false], ['recent', false], ['all', false]]);
    assert.equal(await firstRun.locator('[data-first-run-waiting]').count(), 0, 'no row waits once the groups are read (must-exclude)');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Next on Data waits for a slow read and then opens the Data groups step with its pick made, and a first run the person picked stays picked after Back', async () => {
  const calls = [];
  const ui = await openUi('wizard', { me: ME }, '', { init: profileAt(calls, PROFILE, { after: 8000 }) });
  const { page } = ui;
  try {
    await goToStep(page, 'Data');
    assert.deepEqual(await stepBar(page), ['1. What to deliver', '2. Data & results', '3. Data groups', '4. First run', '5. Measure', '6. Where it lives', '7. Who uses the App', '8. Page storage', '9. App look', '10. Run it', '11. Review & build'],
      'while the table is read the steps it may need already show, so the count never grows under the person');
    await next(page);
    await page.getByRole('button', { name: /Reading the table/ }).waitFor({ timeout: 8000 });
    await page.getByRole('button', { name: /Reading the table/ }).waitFor({ state: 'detached', timeout: 30000 });
    await onStep(page, 'Data groups');
    assert.equal(await page.locator('[aria-current="step"]').innerText(), '3. Data groups', 'Next lands on the Data groups step once the table is read');
    assert.deepEqual(await stepBar(page), ['1. What to deliver', '2. Data & results', '3. Data groups', '4. First run', '5. Measure', '6. Where it lives', '7. Who uses the App', '8. Page storage', '9. App look', '10. Run it', '11. Review & build']);
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['region, country']);
    await goToStep(page, 'First run');
    await page.locator('[data-first-run-choice="all"] input').check();
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await onStep(page, 'Data groups');
    await goToStep(page, 'First run');
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
    const grouping = page.getByRole('region', { name: 'How do you split the data into groups?', exact: true });
    await grouping.locator('[data-grouping-choice]').first().waitFor();
    assert.deepEqual(await grouping.locator('[data-grouping-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.groupingChoice)),
      ['all', 'stores.region, store_id', 'region, country', 'region', 'country']);
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['stores.region, store_id'], 'the Deep grouping is picked before the person chooses');
    assert.match(await grouping.locator('[data-grouping-choice="stores.region, store_id"]').innerText(),
      /^stores\.region, then store_id\ngroups counted once picked\nSuggested by discovery\nRecommended/);
    assert.equal(await grouping.locator('[data-grouping-cards] [data-recommended]').count(), 1, 'the picked Deep grouping is the one Recommended card');
    assert.equal(await grouping.locator('[data-grouping-choice="region, country"] [data-recommended]').count(), 0, 'must-exclude: no second Recommended');
    assert.equal(await grouping.locator('[data-grouping-record-level]').textContent(), 'Discovery found one record per order_id in main.sales.orders.');
    assert.equal(await grouping.locator('[data-grouping-chosen-by="deep"]').textContent(),
      'Discovery picked this grouping. It becomes your choice when you pick it or another one.');
    await grouping.locator('[data-grouping-choice="all"] input').check();
    assert.equal(await grouping.locator('[data-grouping-chosen-by]').count(), 0, 'once the person picks, the grouping is theirs');
    await goToStep(page, 'First run');
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await onStep(page, 'Data groups');
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['all'], 'the person picked the whole data, so going back never puts the Deep grouping back');
    await toStep(page, 'Review & build');
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

test('the Data groups picked by discovery are the ones First run highlights and lists, after Back and Next and after a reload, and the build sends groups of that grouping', async () => {
  const calls = [];
  const join = { table: 'main.sales.stores', key: 'store_id', ref_column: 'store_id' };
  const deep = { ...PROFILE, deep_suggestion: { columns: ['stores.region'], record_level: 'order_id' },
    columns: [...PROFILE.columns, { name: 'stores.region', type: 'string', distinct: 2, smallest: 20110, largest: 28100, nulls: 0, parent: null, join }] };
  const byStore = { ...deep, groups_for: 'stores.region', group_count: 2,
    group_list: [['North', 28100], ['South', 20110]].map(([value, records]) => ({ value, records, parts: [{ column: 'stores.region', value, join }] })) };
  const init = async (page) => {
    await page.route('**/api/grouping/profile', async (route) => {
      const body = JSON.parse(route.request().postData() || '{}');
      calls.push(body);
      await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(body.group_by === 'stores.region' ? byStore : deep) });
    });
  };
  const ui = await openUi('wizard', { me: ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: INSTRUCTION } }, '', { init });
  const { page, made } = ui;
  const firstRun = page.getByRole('region', { name: FIRST_RUN_TITLE, exact: true });
  const offered = () => firstRun.locator('[data-first-run-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.firstRunChoice));
  const highlighted = async () => {
    await toStep(page, 'First run');
    assert.equal(await page.locator('[data-grouping-chosen]').innerText(), 'Data groups: stores.region · 2 groups. The First run runs inside these groups.');
    await until(async () => (await offered()).includes('groups'), 'the groups of the picked Data groups', 30000);
    assert.deepEqual(await offered(), ['one', 'groups', 'records', 'recent', 'all'], 'one or several groups of stores.region are offered');
    await firstRun.locator('[data-first-run-choice="groups"] input[type="radio"]').check();
    assert.deepEqual(await firstRun.locator('[data-scope-group]').allInnerTexts(), ['North · 28,100 records', 'South · 20,110 records'],
      'the groups listed are those of the Data groups picked, never those of country (must-exclude)');
  };
  try {
    await toStep(page, 'Data groups');
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['stores.region']);
    await highlighted();
    assert.ok(calls.some((c) => c.group_by === 'stores.region'), JSON.stringify(calls));
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await onStep(page, 'Data groups');
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['stores.region'], 'Back keeps the pick');
    await highlighted();
    await page.reload();
    await goToStep(page, 'Data groups');
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['stores.region'], 'a reload keeps the pick');
    await highlighted();
    await firstRun.locator('[data-scope-group="North"] input').check();
    await firstRun.locator('[data-scope-group="South"] input').uncheck();
    await toStep(page, 'Review & build');
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some((b) => b.textContent.trim() === 'All Good, Build it Now' && !b.disabled), null, { timeout: 30000 });
    await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
    await until(() => made.jobs.length === 1, 'the build', 30000);
    const [sent] = insertsOf(made);
    assert.deepEqual([sent.config.widgets.run_scope, JSON.parse(sent.config.widgets.scope_groups)], ['groups', [[{ column: 'stores.region', value: 'North', join }]]]);
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
    await toStep(page, 'Review & build');
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
    const grouping = page.getByRole('region', { name: 'How do you split the data into groups?', exact: true });
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['store_id']);
    assert.equal(await grouping.locator('[data-grouping-why]').textContent(), GROUPING_PLAIN);
    assert.equal(await grouping.locator('[data-grouping-example]').count(), 0, 'no example of country for a store_id grouping (must-exclude)');
    await goToStep(page, 'First run');
    const groupsRow = page.locator('[data-first-run-choice="groups"]');
    const offered = () => page.locator('[data-first-run-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.firstRunChoice));
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['records']);
    assert.deepEqual(await offered(), ['records', 'recent', 'all'], 'groups of store_id were not listed with sizes, so no group choice is offered (must-exclude)');
    assert.match(await page.locator('[data-first-run-choice="records"]').innerText(), /^~1,000 records in whole groups of store_id/);
    await page.getByRole('button', { name: 'Back', exact: true }).click();
    await onStep(page, 'Data groups');
    await grouping.locator('[data-grouping-choice="region, country"] input').check();
    assert.match(await grouping.locator('[data-grouping-example]').textContent(), /Grouped by country/);
    await goToStep(page, 'First run');
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
    const grouping = page.getByRole('region', { name: 'How do you split the data into groups?', exact: true });
    assert.equal(await grouping.locator('[data-grouping-chosen-by="deep"]').count(), 1);
    await grouping.locator('[data-grouping-choice="store_id"] input').click();
    await grouping.locator('[data-grouping-chosen-by]').waitFor({ state: 'detached' });
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['store_id']);
    await toStep(page, 'Review & build');
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
    await toStep(page, 'First run');
    assert.deepEqual(await stepBar(page), ['1. What to deliver', '2. Data & results', '3. First run', '4. Measure', '5. Where it lives', '6. Who uses the App', '7. Page storage', '8. App look', '9. Run it', '10. Review & build'], 'no Data groups step when groups do not apply (must-exclude)');
    assert.equal(await page.locator('[data-first-run-held]').textContent(), 'main.sales.orders holds 800 records, so the First run covers all of it.');
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['records'], 'a profile that still says all is never the default');
    assert.equal(await page.locator('[data-first-run-covers]').textContent(), 'The First run covers all 800 records of main.sales.orders, since it holds no more than 1,000 records.');
    assert.deepEqual(await page.locator('[data-first-run-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.firstRunChoice)), ['records', 'recent', 'all'],
      'each record stands alone, so a number of records is offered and no group is (must-exclude)');
    await page.locator('[data-first-run-choice="records"] input[type="radio"]').check();
    await page.getByRole('textbox', { name: 'Records to run on' }).fill('0');
    await page.locator('[data-scope-problem]').getByText("Records to run on is '0'; allowed: a whole number, at least 1", { exact: true }).waitFor();
    await next(page);
    await page.getByRole('alert').getByText("Records to run on is '0'; allowed: a whole number, at least 1").waitFor();
    assert.equal(await page.locator('[aria-current="step"]').innerText(), '3. First run', 'a refused value keeps the person on First run');
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
    await toStep(page, 'First run');
    assert.deepEqual((await stepBar(page)).slice(0, 3), ['1. What to deliver', '2. Data & results', '3. First run']);
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
    assert.deepEqual([await groups.locator('h4').textContent(), await firstRun.locator('h4').textContent()], ['Data groups', 'First run']);
    assert.deepEqual(await panel.locator('[data-setting]').evaluateAll((rows) => rows.map((r) => r.dataset.setting)), ['act_now_share'],
      'the five scope settings show once, in their own two sections');
    assert.equal(await groups.locator('[data-scope-part="first_run"]').count(), 0, 'Data groups holds no First run choice');
    assert.equal(await firstRun.locator('[data-scope-part="grouping"]').count(), 0, 'First run holds no Data groups choice');
    await groups.locator('[data-grouping-choice]').first().waitFor();
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['all']);
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['groups']);
    assert.equal(await panel.getByRole('button', { name: /^Save (Data groups|First run)$/ }).count(), 0, 'nothing changed, nothing to save');
    await groups.locator('[data-grouping-choice="country"] input').check();
    assert.equal(await firstRun.getByRole('button', { name: 'Save First run' }).count(), 0, 'a Data groups change never offers to save First run (must-exclude)');
    await groups.getByRole('textbox', { name: 'Note for the Data groups change' }).fill('  compare countries  ');
    await groups.getByRole('button', { name: 'Save Data groups', exact: true }).click();
    await until(() => saves().length === 1, 'the Data groups save', 30000);
    await groups.getByText('Saved Data groups. Stored results follow at the next run.', { exact: true }).waitFor();
    assert.deepEqual(saves(), [{ page: 'n01_u01', name: 'group_by', value: 'country', was: 'all', note: 'compare countries' }], 'only Data groups is saved');
    await firstRun.locator('[data-scope-group="Spain"] input').uncheck();
    await firstRun.locator('[data-scope-group="Malta"] input').check();
    await firstRun.getByRole('textbox', { name: 'Note for the First run change' }).fill('  skip Spain  ');
    await firstRun.getByRole('button', { name: 'Save First run', exact: true }).click();
    await until(() => saves().length === 2, 'the First run save', 30000);
    await firstRun.getByText('Saved First run. Stored results follow at the next run.', { exact: true }).waitFor();
    assert.deepEqual(saves()[1], { page: 'n01_u01', name: 'scope_groups', value: '[[{"column":"country","value":"USA"}],[{"column":"country","value":"Malta"}],[{"column":"country","value":"Cyprus"}]]',
      was: 'USA, Spain, Cyprus', note: 'skip Spain' }, 'only First run is saved, and a saved group the table read did not list is kept');
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
    const section = page.getByRole('region', { name: 'Data groups and First run of this use case', exact: true });
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
    await idle(quiet.page);
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

const withRecordedValue = (row, value) => {
  const spec = JSON.parse(row.spec_json);
  return { ...row, spec_json: JSON.stringify({ ...spec, config: { ...spec.config, widgets: { ...(spec.config.widgets || {}), run_scope: value } } }) };
};

for (const [name, profile] of [['the data qualifies for Data groups', PROFILE], ['the data does not qualify for Data groups', NOT_QUALIFYING]]) {
  for (const [recorded, value] of [['recorded First run as a number', null], ['whose First run is a number', '5']]) {
    test(`all settings on a built version that ${recorded} never ask First run again, since runs 2 onward use all groups, and build on about 1,000 records, never everything, when ${name} (must-exclude)`, async () => {
      const calls = [];
      let answered = 0;
      const init = async (page) => {
        await page.route('**/api/grouping/profile', async (route) => {
          calls.push(JSON.parse(route.request().postData() || '{}'));
          await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(profile) });
          answered += 1;
        });
      };
      const row = value === null ? recordedAsNumber() : withRecordedValue(recordedAsNumber(), value);
      const ui = await openBuild({ me: ME, history: [row], forwardedToken: PERSON }, { init });
      const { page, made } = ui;
      try {
        await openSettings(page);
        await until(() => calls.length >= 1 && answered === calls.length, 'every read of the table is answered', 30000);
        await page.evaluate(() => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))));
        const steps = (await stepBar(page)).map((s) => s.replace(/^\d+\. /, ''));
        const groups = profile === PROFILE ? ['Data groups'] : [];
        assert.deepEqual(steps, ['What to deliver', 'Data & results', ...groups, 'Measure', 'Where it lives', 'Who uses the App', 'Page storage', 'App look', 'Run it', 'Review & build'],
          'no First run step on a rebuild, and Data groups only when the data qualifies');
        assert.equal(await page.locator('[data-first-run-choice]').count(), 0, 'no First run choice anywhere');
        await toSummary(page);
        assert.deepEqual((await page.locator('[role="alert"] p').allTextContents()).filter((t) => /run_scope|First run/.test(t)), [], 'no First run problem');
        const keep = page.getByRole('radio', { name: /^Keep v\d+ live/ });
        await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
        if (await keep.count()) {
          await keep.check();
          await page.getByRole('button', { name: 'All Good, Build it Now', exact: true }).click();
        }
        await until(() => made.jobs.length === 1, 'the build', 30000);
        const [sent] = insertsOf(made);
        assert.notEqual(sent.config.widgets.run_scope, 'all', JSON.stringify(sent.config.widgets));
        assert.ok(!/^\d+$/.test(String(sent.config.widgets.run_scope ?? '')), `a number is never sent as First run: ${JSON.stringify(sent.config.widgets)}`);
        assert.deepEqual(ui.pageErrors, []);
      } finally {
        await ui.close();
      }
    });
  }
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
    assert.ok(!steps.includes('First run') && !steps.includes('Data groups'), `First run is hidden: ${steps.join(' | ')}`);
    const back = page.getByRole('button', { name: 'Back', exact: true });
    for (let i = 0; i < steps.length && !(await page.locator('[aria-current="step"]').innerText()).includes(steps[0]); i += 1) {
      assert.equal(await page.locator('[data-first-run-unrecorded]').count(),
        (await page.locator('[aria-current="step"]').innerText()).includes('Review & build') ? 1 : 0, 'the note is on Summary only');
      await back.click();
    }
    assert.equal(await page.locator('[data-first-run-unrecorded]').count(), 0, 'the note is on Summary only');
    await toVibes(page);
    await onStep(page, 'Vibes');
    assert.deepEqual(await page.locator('[data-first-run-unrecorded]').allTextContents(), [RUN_SCOPE_UNRECORDED_HIDDEN]);
    assert.deepEqual((await page.locator('[role="alert"] p').allTextContents()).filter((t) => /run_scope|First run/.test(t)), [], 'no First run problem');
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
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['recent'], 'the First run Inspire recorded, not the old App default');
    assert.match(await scope.locator('[data-first-run-locked]').textContent(), /^This App was built before First run had its choices, so it cannot save one\./);
    assert.ok(await scope.locator('[data-first-run-choice] input[type="radio"]').evaluateAll((inputs) => inputs.length > 0 && inputs.every((i) => i.disabled)));
    assert.equal(await panel.locator('[data-setting-group="data_groups"] [data-grouping-choice="country"] input').isDisabled(), false);
    const groups = panel.locator('[data-setting-group="data_groups"]');
    await groups.locator('[data-grouping-choice="country"] input').check();
    assert.equal(await scope.getByRole('button', { name: 'Save First run' }).count(), 0, 'a locked First run offers no save (must-exclude)');
    await groups.getByRole('button', { name: 'Save Data groups', exact: true }).click();
    await until(() => made.appCalls.filter((c) => c.url.endsWith('/api/settings/save')).length === 1, 'the Data groups save', 30000);
    await groups.getByText('Saved Data groups. Stored results follow at the next run.', { exact: true }).waitFor();
    assert.deepEqual(made.appCalls.filter((c) => c.url.endsWith('/api/settings/save')).map((c) => c.body.name), ['group_by'], 'First run is never sent to the old App');
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

test('a forecast on a star fact table with no column to group by still asks Data groups on their own step with the whole data as one group picked and why, then First run right after it on the first 1,000 records', async () => {
  const calls = [];
  const ui = await openUi('wizard', { me: ME, useCase: FORECAST }, '', { init: profileAt(calls, STAR_BARE) });
  const { page } = ui;
  try {
    await toStep(page, 'Data groups');
    assert.deepEqual((await stepBar(page)).slice(0, 4), ['1. What to deliver', '2. Data & results', '3. Data groups', '4. First run'], 'Data groups follow Data and First run comes right after them');
    const grouping = page.getByRole('region', { name: 'How do you split the data into groups?', exact: true });
    assert.deepEqual(await grouping.locator('[data-grouping-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.groupingChoice)), ['all'],
      'only the whole data when no column qualifies, never a custom SQL choice');
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['all'], 'the whole data as one group is pre-picked');
    assert.equal(await grouping.locator('[data-grouping-nothing]').textContent(), `${STAR_BARE.reason.replace(/[.!?]?$/, '.')} There is nothing else to pick here.`);
    assert.equal(await grouping.locator('[data-recommended]').count(), 0, 'one choice is no pick, so no Recommended badge (must-exclude)');
    await goToStep(page, 'First run');
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['records'], 'above 1,000 records with nothing to group by, the first 1,000 records');
    assert.ok(!(await checkedChoice(page, 'data-first-run-choice')).includes('all'), 'everything is never the default (must-exclude)');
    assert.match(await page.locator('[data-first-run-choice="records"]').innerText(), /^~1,000 records/);
    assert.match(await page.locator('[data-first-run-covers]').textContent(), /Spread across the whole table, the same records every run; the whole data is one group\./);
    assert.match(await page.locator('[data-first-run-choice="all"] [data-first-run-estimate]').textContent(), /^Everything is 2,880,404 records, about 2,880 times/);
    await page.locator('[data-first-run-choice="all"] input').check();
    await next(page);
    await page.locator('[aria-current="step"]', { hasText: 'Measure' }).waitFor();
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
    const grouping = page.getByRole('region', { name: 'How do you split the data into groups?', exact: true });
    assert.deepEqual(await grouping.locator('[data-grouping-choice]').evaluateAll((rows) => rows.map((r) => r.dataset.groupingChoice)),
      ['all', 'ss_store_sk, item.i_category', 'ss_store_sk', 'item.i_category']);
    assert.deepEqual(await checkedChoice(page, 'data-grouping-choice'), ['ss_store_sk, item.i_category'],
      'the recommended joined grouping is pre-picked by its table and column, never a silent whole data');
    assert.equal(await grouping.locator('[data-grouping-sql]').count(), 0, 'a joined grouping runs through its join, so no grouping SQL opens (must-exclude)');
    assert.equal(await grouping.locator('[data-grouping-choice="ss_store_sk, item.i_category"] [data-grouping-join-note]').textContent(),
      `item.i_category joins on ${ITEM_JOIN.key} = ${ITEM_JOIN.ref_column}. ${GROUPING_JOINED_NOTE}`);
    assert.equal(await grouping.locator('[data-grouping-choice="ss_store_sk"] [data-grouping-join-note]').count(), 0, 'a main-table column names no join');
    await goToStep(page, 'First run');
    const firstRun = page.getByRole('region', { name: 'What should the First run cover?', exact: true });
    assert.deepEqual(await checkedChoice(page, 'data-first-run-choice'), ['records'], 'a star-schema forecast runs first on whole groups, never on everything');
    assert.match(await firstRun.locator('[data-first-run-choice="records"]').innerText(),
      /^470,000 records in 1 whole group\n/);
    assert.equal(await firstRun.locator('[data-first-run-choice="records"] [data-first-run-records]').count(), 0, 'a label that already says the exact count does not repeat it (must-exclude)');
    assert.equal(await firstRun.locator('[data-first-run-details="records"] p').textContent(), 'All of ss_store_sk = 7, the smallest group, since every group holds more than 1,000 records.');
    await firstRun.locator('[data-first-run-choice="groups"] input[type="radio"]').check();
    assert.deepEqual(await firstRun.locator('[data-scope-group] input:checked').evaluateAll((inputs) => inputs.length), 2, 'the suggested groups are picked');
    assert.equal(await firstRun.locator('[data-first-run-covers]').textContent(),
      'The First run covers 2 groups of ss_store_sk, then item.i_category: ss_store_sk = 1 and item.i_category = Electronics; ss_store_sk = 7 and item.i_category = Home, 77,390 records. '
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

test('Data groups on a 20-column table shows the pick and the top cards with their group counts, the rest behind Show all with a search, and First run highlights the pick', async () => {
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
    assert.equal(await grouping.locator('[data-grouping-cards] [data-recommended]').count(), 1, 'one Recommended card');
    assert.equal(await grouping.locator('[data-grouping-choice="col_05"] [data-recommended]').count(), 1);
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
    await goToStep(page, 'First run');
    assert.equal(await page.locator('[data-grouping-chosen]').innerText(), 'Data groups: col_17 · 51 groups. The First run runs inside these groups.');
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

test('a use case that names no main table sends no grouping profile request, reports no page error, and says why in the scope step', async () => {
  const requests = [];
  const noTable = { ...HARNESS_USE_CASE, primary_table: '', tables_involved: '' };
  const ui = await openUi('wizard', { me: ME, useCase: noTable }, '&noTable=1', {
    init: (page) => page.on('request', (r) => { if (r.url().includes('/api/grouping/profile')) requests.push(r.method()); }),
  });
  const { page, pageErrors } = ui;
  try {
    await toStep(page, 'First run');
    await page.getByText(/names no main table as catalog\.schema\.table, so Inspire cannot read it for Data groups\./).waitFor({ timeout: 20000 });
    assert.deepEqual(requests, [], 'no grouping profile is requested for a use case with no main table (must-exclude the 400)');
    assert.deepEqual(pageErrors, [], 'no page error or console 400 reaches the page');
  } finally {
    await ui.close();
  }
});
