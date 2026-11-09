import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { GROUPING_INSTRUCTION, HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { closeBrowser, onStep, openUi, profileAt } from './uiSupport.mjs';

test.after(closeBrowser);

const require = createRequire(import.meta.url);
const R = require('../../../backend/lib/groupingRule.js');
const GP = require('../../../backend/lib/groupingProfile.js');

const TABLE = 'main.s.orders';
const ME = { me: { userName: OWNER, displayName: 'Owner' } };
const counted = (profile) => ({ readinessRows: [{ row_count: String(profile.records) }] });
const DUMP = process.env.WIZARD_SCREENS || '';

function profileOf(groups, perGroup, { values = (i) => `store-${i}`, type = 'STRING', technique = 'Anomaly Detection' } = {}) {
  const columns = [{ column_name: 'store', data_type: type }, { column_name: 'order_date', data_type: 'DATE' }];
  const candidates = R.groupingCandidates(columns, {}, TABLE);
  const rows = [];
  for (let i = 0; i < groups; i += 1) rows.push({ col: '0', value: values(i), records: String(perGroup) });
  const view = GP.profileView({ table: TABLE, technique, columns, candidates, stats: { records: String(groups * perGroup), d0: String(groups), n0: '0', recent: '0' },
    sample: [{ kind: 'size', coarse: '0', fine: '-1', groups: String(groups), records: String(groups * perGroup) }],
    values: groups <= GP.PROFILE_APPROX_MAX ? rows : [], paths: null, time: { column: 'order_date' }, days: 30, readAt: '2026-11-09T09:00:00Z' });
  return { ...view, deep_suggestion: null };
}

const stepLabels = (page) => page.locator('[data-wizard-header] ol li').allTextContents();
const current = async (page) => (await page.locator('[aria-current="step"]').innerText()).replace(/^\s*\d+\.\s*/, '').trim();

async function overflowing(page) {
  return page.evaluate(() => {
    const body = document.querySelector('[data-wizard-body]') || document.querySelector('[role="dialog"]');
    if (!body) return ['no wizard body'];
    const box = body.getBoundingClientRect();
    return [...body.querySelectorAll('*')].filter((el) => {
      const r = el.getBoundingClientRect();
      return r.width > 0 && el.offsetParent !== null && (r.right > box.right + 2 || r.left < box.left - 2) && getComputedStyle(el).position !== 'fixed';
    }).slice(0, 5).map((el) => `${el.tagName.toLowerCase()} "${(el.innerText || '').slice(0, 60)}"`);
  });
}

async function walk(page, name, actions = {}) {
  const seen = [];
  for (let i = 0; i < 12; i += 1) {
    const step = await current(page);
    await page.waitForTimeout(400);
    await page.getByText(/^Inspire is reading/).first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => null);
    if (actions[step]) await actions[step](page);
    await page.waitForTimeout(200);
    const text = await page.locator('[role="dialog"]').innerText();
    seen.push({ step, text, overflow: await overflowing(page) });
    if (DUMP) await page.screenshot({ path: `${DUMP}/${name}-${i + 1}.png` });
    const next = page.getByRole('button', { name: 'Next', exact: true });
    if (!(await next.count()) || step === 'Summary') break;
    if (await next.isDisabled()) {
      seen.push({ step, text: `NEXT DISABLED: ${(await page.locator('[role="alert"]').allInnerTexts()).join(' | ')}`, overflow: [] });
      break;
    }
    await next.click();
    await page.waitForFunction((was) => (document.querySelector('[aria-current="step"]')?.innerText || '').replace(/^\s*\d+\.\s*/, '').trim() !== was, step,
      { timeout: 15000 }).catch(() => null);
    if ((await current(page)) === step) {
      seen.push({ step, text: `NEXT DID NOT MOVE: ${(await page.locator('[role="alert"]').allInnerTexts()).join(' | ')}`, overflow: [] });
      break;
    }
  }
  const labels = await stepLabels(page);
  if (DUMP) {
    fs.mkdirSync(DUMP, { recursive: true });
    fs.writeFileSync(`${DUMP}/${name}.txt`, [`STEPS: ${labels.join(' | ')}`, ...seen.map((s) => `\n===== ${s.step}\n${s.text}\n-- overflow: ${s.overflow.join('; ')}`)].join('\n'));
  }
  return { labels, seen };
}

const LEAKS = [/\bundefined\b/, /\bNaN\b/, /\[object Object\]/, /\bnull\b/, /Infinity/];

function noLeaks(seen, name) {
  for (const s of seen) for (const leak of LEAKS) assert.doesNotMatch(s.text, leak, `${name} / ${s.step}`);
}

async function scenario(name, { profile, useCase = {}, viewport = { width: 1440, height: 900 }, extra = {}, actions = {}, delay = 0, status = 200 } = {}) {
  const ui = await openUi('wizard', { ...ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: GROUPING_INSTRUCTION, ...useCase }, ...extra }, '',
    { init: profile ? profileAt([], profile, { after: delay, status }) : undefined });
  try {
    await ui.page.setViewportSize(viewport);
    await onStep(ui.page, 'Use case');
    const got = await walk(ui.page, name, actions);
    return { ...got, ui };
  } catch (e) {
    await ui.close();
    throw e;
  }
}

for (const [name, groups, per] of [['groups-0', 0, 40], ['groups-1', 1, 40], ['groups-31', 31, 40], ['groups-540', 540, 40]]) {
  test(`Data groups with ${groups} groups: every step reads without a raw value and Next reaches the Summary`, async () => {
    const { seen, ui } = await scenario(name, { profile: profileOf(groups, per) });
    try {
      noLeaks(seen, name);
      assert.deepEqual(ui.pageErrors, []);
      assert.equal(seen.at(-1).step, 'Summary', seen.at(-1).text.slice(0, 300));
    } finally {
      await ui.close();
    }
  });
}

test('group values in Arabic read right to left inside the Data groups and First run steps', async () => {
  const { seen, ui } = await scenario('groups-rtl', { profile: profileOf(31, 40, { values: (i) => `فرع ${i + 1}` }) });
  try {
    noLeaks(seen, 'groups-rtl');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('at 1280 by 800 no step overflows its dialog sideways', async () => {
  const { seen, ui } = await scenario('small-screen', { profile: profileOf(31, 40), viewport: { width: 1280, height: 800 } });
  try {
    for (const s of seen) assert.deepEqual(s.overflow, [], s.step);
  } finally {
    await ui.close();
  }
});

const PROFILE = profileOf(31, 40);
const check = (name) => async (page) => page.getByRole('checkbox', { name }).first().check();
const uncheck = (name) => async (page) => page.getByRole('checkbox', { name }).first().uncheck();
const radio = (name) => async (page) => page.getByRole('radio', { name }).first().check();
const press = (name) => async (page) => page.getByRole('button', { name, exact: true }).first().click();
const both = (...fns) => async (page) => { for (const fn of fns) await fn(page); };

const COMBOS = [
  ['app-off', { Deliver: uncheck(/^App /) }],
  ['app-off-alert-dashboard', { Deliver: both(uncheck(/^App /), check(/^Dashboard/), check(/^Alert/)) }],
  ['per-user', { 'Who uses the App': radio(/^Sensitive data/) }],
  ['per-user-edit', { 'Who uses the App': radio(/^Sensitive data/), 'App pages and look': check(/^Let people edit data/) }],
  ['one-app-per-use-case', { 'Who uses the App': radio(/^One App per use case/) }],
  ['inside-inspire', { 'Who uses the App': radio(/^Inside Inspire/) }],
  ['schedule-off-holdout-off', { 'Run it': both(press('Off'), uncheck(/^Hold back/)) }],
  ['schedule-weekly', { 'Run it': press('Weekly') }],
  ['first-run-everything', { 'First run': radio(/^Everything/) }],
  ['first-run-recent', { 'First run': radio(/^The last 30 days/) }],
  ['first-run-one-group', { 'First run': radio(/^One group/) }],
  ['first-run-several', { 'First run': radio(/^Several groups/) }],
  ['groups-whole', { 'Data groups': radio(/^Whole data as one group/) }],
];

for (const [name, actions] of COMBOS) {
  test(`combination ${name}: every step reads without a raw value and Next reaches the Summary`, async () => {
    const { seen, ui } = await scenario(name, { profile: PROFILE, actions, extra: counted(PROFILE) });
    try {
      noLeaks(seen, name);
      assert.deepEqual(ui.pageErrors, []);
      assert.equal(seen.at(-1).step, 'Summary', seen.at(-1).text.slice(0, 400));
    } finally {
      await ui.close();
    }
  });
}

const deliverOf = (seen) => seen.find((s) => s.step === 'Deliver').text;
const summaryOf = (seen) => seen.find((s) => s.step === 'Summary').text;

test('a workspace with Apps turned off dims the App on Deliver with the reason, drops the App steps and still reaches the Summary', async () => {
  const { seen, ui } = await scenario('no-apps', { profile: PROFILE, extra: { ...counted(PROFILE), appsOk: false } });
  try {
    noLeaks(seen, 'no-apps');
    assert.match(deliverOf(seen), /Apps are turned off in this workspace\./);
    assert.ok(!seen.some((s) => /^Who uses the App|^App pages/.test(s.step)), seen.map((s) => s.step).join(', '));
    assert.match(summaryOf(seen), /App: Apps are turned off in this workspace\./);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('a workspace with Alerts turned off leaves the Alert unticked with the reason and reaches the Summary', async () => {
  const { seen, ui } = await scenario('no-alerts', { profile: PROFILE, extra: { ...counted(PROFILE), alertsOk: false },
    actions: { Deliver: async (page) => assert.equal(await page.getByRole('checkbox', { name: /^Alert/ }).first().isChecked(), false) } });
  try {
    noLeaks(seen, 'no-alerts');
    assert.match(deliverOf(seen), /Alerts are turned off in this workspace\./);
    assert.equal(seen.at(-1).step, 'Summary');
  } finally {
    await ui.close();
  }
});

test('a workspace with Genie Agents turned off unticks the Genie Agent like the App, so Next is never refused for an option nobody picked',
  { todo: 'wiz-genie-off-blocks-next, wizard lane 8908fa46' }, async () => {
    const { seen, ui } = await scenario('no-genie', { profile: PROFILE, extra: { ...counted(PROFILE), spacesOk: false } });
    try {
      assert.equal(seen.at(-1).step, 'Summary', seen.at(-1).text.slice(0, 300));
      assert.doesNotMatch(seen.map((s) => s.text).join('\n'), /run the grant/);
    } finally {
      await ui.close();
    }
  });

test('an empty table never offers a 1,000-record sample of 0 records', { todo: 'wiz-first-run-empty-table, wizard lane 8908fa46' }, async () => {
  const { seen, ui } = await scenario('groups-0-first-run', { profile: profileOf(0, 40) });
  try {
    assert.doesNotMatch(seen.map((s) => s.text).join('\n'), /all 0 records|1,000 records spread across the whole table[^\n]*0 records/);
  } finally {
    await ui.close();
  }
});

test('the First run of 20 whole groups of 40 records says about 800 records and lists the groups briefly', { todo: 'wiz-first-run-about-1000-is-800, wizard lane 8908fa46' }, async () => {
  const { seen, ui } = await scenario('groups-31-first-run', { profile: PROFILE, extra: counted(PROFILE) });
  try {
    const row = summaryOf(seen).split('\n').find((l) => /whole groups/.test(l)) || '';
    assert.doesNotMatch(row, /About 1,000 records/);
    assert.ok(row.length < 400, `${row.length} characters`);
  } finally {
    await ui.close();
  }
});

const RUN_IT = 'Run it';

async function summaryText(page) {
  await page.getByRole('button', { name: 'All Good, Build it Now' }).waitFor({ timeout: 20000 });
  return page.locator('[role="dialog"]').innerText();
}

async function toSummary(page) {
  for (let i = 0; i < 12 && (await current(page)) !== 'Summary'; i += 1) {
    await page.getByText(/^Inspire is reading/).first().waitFor({ state: 'detached', timeout: 20000 }).catch(() => null);
    const was = await current(page);
    await page.getByRole('button', { name: /^(Next|Back to Summary)$/ }).click();
    await page.waitForFunction((w) => (document.querySelector('[aria-current="step"]')?.innerText || '').replace(/^\s*\d+\.\s*/, '').trim() !== w, was,
      { timeout: 15000 });
  }
}

test('Change on a Summary row opens that step, keeps every earlier answer and Back to Summary returns with the new answer', async () => {
  const { ui } = await scenario('change-from-summary', { profile: PROFILE, extra: counted(PROFILE), actions: { [RUN_IT]: press('Weekly') } });
  try {
    const { page } = ui;
    assert.equal(await current(page), 'Summary');
    assert.match(await page.locator('[role="dialog"]').innerText(), /Keep it fresh\nWeekly/);
    await page.getByRole('button', { name: 'Change Keep it fresh' }).click();
    assert.equal(await current(page), RUN_IT);
    assert.equal(await page.getByRole('button', { name: 'Weekly', exact: true }).getAttribute('aria-pressed'), 'true');
    await press('Off')(page);
    await page.getByRole('button', { name: 'Back to Summary' }).click();
    assert.equal(await current(page), 'Summary');
    const text = await page.locator('[role="dialog"]').innerText();
    assert.match(text, /Keep it fresh\nOff/);
    assert.match(text, /Data groups\nstore · 31 groups/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Back from the Summary walks every step in order to the Use case and Next walks forward again to the same Summary', async () => {
  const { seen, ui } = await scenario('back-and-forth', { profile: PROFILE, extra: counted(PROFILE) });
  try {
    const { page } = ui;
    const forward = seen.map((s) => s.step);
    const summary = await summaryText(page);
    const back = [await current(page)];
    while ((await current(page)) !== 'Use case' && back.length < 12) {
      const was = await current(page);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await page.waitForFunction((w) => (document.querySelector('[aria-current="step"]')?.innerText || '').replace(/^\s*\d+\.\s*/, '').trim() !== w, was);
      back.push(await current(page));
    }
    assert.deepEqual(back, [...forward].reverse());
    await toSummary(page);
    assert.equal(await summaryText(page), summary);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('reloading the page in the middle of the wizard opens it again cleanly with no page error', async () => {
  const { ui } = await scenario('reload', { profile: PROFILE, extra: counted(PROFILE) });
  try {
    const { page } = ui;
    await page.reload();
    await onStep(page, 'Use case');
    await toSummary(page);
    noLeaks([{ step: 'Summary', text: await page.locator('[role="dialog"]').innerText() }], 'reload');
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

for (const [name, opts] of [['slow-profile', { delay: 12000 }], ['profile-error', { status: 500 }], ['profile-denied', { status: 403 }]]) {
  test(`profile read ${name}: the wizard says what happened and still reaches the Summary`, async () => {
    const body = opts.status ? { error: 'Inspire could not read main.s.orders for Data groups.' } : PROFILE;
    const { seen, ui } = await scenario(name, { profile: body, ...opts, extra: counted(PROFILE) });
    try {
      noLeaks(seen, name);
      assert.equal(seen.at(-1).step, 'Summary', seen.at(-1).text.slice(0, 400));
    } finally {
      await ui.close();
    }
  });
}
