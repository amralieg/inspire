import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { GROUPING_INSTRUCTION, GROUPING_PROFILE, HARNESS_USE_CASE, OWNER } from './implementFixtures.js';
import { closeBrowser, goToStep, idle, onStep, openRow, openUi, profileAt } from './uiSupport.mjs';

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

const settle = (page) => idle(page, { timeout: 90000 });

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
  for (let i = 0; i < 20; i += 1) {
    await settle(page);
    const step = await current(page);
    if (actions[step]) {
      await actions[step](page);
      await settle(page);
    }
    const text = await page.locator('[role="dialog"]').innerText();
    seen.push({ step, text, overflow: await overflowing(page) });
    if (DUMP) await page.screenshot({ path: `${DUMP}/${name}-${i + 1}.png` });
    while (await page.locator('[data-money-next]').count() && await page.locator('[data-money-next]').isVisible()) { await page.locator('[data-money-next]').click(); await settle(page); }
    const next = page.getByRole('button', { name: 'Next', exact: true });
    if (!(await next.count()) || step === 'Review & build') break;
    if (await next.isDisabled()) {
      seen.push({ step, text: `NEXT DISABLED: ${(await page.locator('[role="alert"]').allInnerTexts()).join(' | ')}`, overflow: [] });
      break;
    }
    await next.click();
    await settle(page);
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

async function scenario(name, { profile, useCase = {}, viewport = { width: 1440, height: 900 }, extra = {}, actions = {}, delay = 0, status = 200, calls = [], init } = {}) {
  const ui = await openUi('wizard', { ...ME, useCase: { ...HARNESS_USE_CASE, genie_instruction: GROUPING_INSTRUCTION, ...useCase }, ...extra }, '',
    { init: init || (profile ? profileAt(calls, profile, { after: delay, status }) : undefined) });
  try {
    await ui.page.setViewportSize(viewport);
    await settle(ui.page);
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
      assert.equal(seen.at(-1).step, 'Review & build', seen.at(-1).text.slice(0, 300));
    } finally {
      await ui.close();
    }
  });
}

test('group values in Arabic read right to left inside the Data groups and First run steps', async () => {
  const steps = [];
  const keep = async (page) => { steps.push(`${await page.locator('[role="dialog"]').textContent()}\n${(await page.locator('[data-first-run-group]').allTextContents()).join('\n')}`); };
  const { seen, ui } = await scenario('groups-rtl', { profile: profileOf(31, 40, { values: (i) => `فرع ${i + 1}` }), actions: { 'Data groups': keep, 'First run': keep } });
  try {
    noLeaks(seen, 'groups-rtl');
    const all = `${seen.map((x) => x.text).join('\n')}\n${steps.join('\n')}`;
    assert.equal(steps.length, 2, 'the walk passed Data groups and First run');
    assert.match(steps[1], /store = \u2068فرع \d+\u2069/, 'each Arabic group on First run is isolated, so its count stays after it');
    assert.doesNotMatch(all, /(?<!\u2068)فرع \d+(?![\d\u2069])/, 'never a bare right-to-left value beside a count or a comma (must-exclude)');
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
const freshPress = (name) => async (page) => { await openRow(page, 'Keep it fresh'); await press(name)(page); };
const both = (...fns) => async (page) => { for (const fn of fns) await fn(page); };

const COMBOS = [
  ['app-off', { 'What to deliver': uncheck(/^App /) }],
  ['app-off-alert-dashboard', { 'What to deliver': both(uncheck(/^App /), check(/^Dashboard/), check(/^Alert/)) }],
  ['per-user', { 'Who uses the App': radio(/^Sensitive data/) }],
  ['per-user-edit', { 'Who uses the App': radio(/^Sensitive data/), 'App pages': check(/^Let people edit data/) }],
  ['one-app-per-use-case', { 'Where it lives': radio(/^One App per use case/) }],
  ['inside-inspire', { 'Where it lives': radio(/^Inside Inspire/) }],
  ['schedule-off-holdout-off', { 'Data & results': freshPress('Off'), 'Run it': uncheck(/^Hold back/) }],
  ['schedule-weekly', { 'Data & results': freshPress('Weekly') }],
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
      for (const s of seen) assert.deepEqual(s.overflow, [], `${name} / ${s.step} at 1440 by 900`);
      assert.deepEqual(ui.pageErrors, []);
      assert.equal(seen.at(-1).step, 'Review & build', seen.at(-1).text.slice(0, 400));
    } finally {
      await ui.close();
    }
  });
}

const deliverOf = (seen) => seen.find((s) => s.step === 'What to deliver').text;
const summaryOf = (seen) => seen.find((s) => s.step === 'Review & build').text;

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
    actions: { 'What to deliver': async (page) => assert.equal(await page.getByRole('checkbox', { name: /^Alert/ }).first().isChecked(), false) } });
  try {
    noLeaks(seen, 'no-alerts');
    assert.match(deliverOf(seen), /Alerts are turned off in this workspace\./);
    assert.equal(seen.at(-1).step, 'Review & build');
  } finally {
    await ui.close();
  }
});

test('a workspace with Genie Agents turned off unticks the Genie Agent like the App, so Next is never refused for an option nobody picked', async () => {
    const { seen, ui } = await scenario('no-genie', { profile: PROFILE, extra: { ...counted(PROFILE), spacesOk: false } });
    try {
      assert.equal(seen.at(-1).step, 'Review & build', seen.at(-1).text.slice(0, 300));
      assert.doesNotMatch(seen.map((s) => s.text).join('\n'), /run the grant/);
      assert.equal(summaryOf(seen).split('Genie Agents are turned off in this workspace.').length - 1, 1, 'the Summary names why the Genie Agent is not built once');
      assert.doesNotMatch(summaryOf(seen), /Not picked in What to deliver[^\n]*(Genie Agent|the App)/, 'an output the workspace cannot build is never called not picked (must-exclude)');
    } finally {
      await ui.close();
    }
  });

test('an empty table never offers a 1,000-record sample of 0 records', async () => {
  const { seen, ui } = await scenario('groups-0-first-run', { profile: profileOf(0, 40) });
  try {
    const text = seen.map((s) => s.text).join('\n');
    assert.doesNotMatch(text, /all 0 records|1,000 records spread across the whole table[^\n]*0 records/);
    assert.doesNotMatch(text, /Pick how to split the data below|No column splits the data into fair groups/, 'an empty table never asks for a pick it cannot offer (must-exclude)');
    const groups = seen.find((s) => s.step === 'Data groups');
    if (groups) {
      assert.match(groups.text, /holds no records yet, so there is nothing to split and nothing to pick here\./);
      assert.doesNotMatch(groups.text, /Recommended/);
    }
    assert.match(summaryOf(seen), /0 records yet/);
  } finally {
    await ui.close();
  }
});

test('a table read that fails says so once, and the Summary First run matches the option the step showed', async () => {
  const { seen, ui } = await scenario('profile-error', { profile: { error: 'the warehouse is stopped' }, status: 500 });
  try {
    const text = seen.map((s) => s.text).join('\n');
    const said = 'the SQL warehouse is stopped, so start it';
    assert.ok(seen.some((s) => s.text.includes(said)), 'the read error is shown as a plain sentence');
    for (const step of seen) assert.ok(step.text.split(said).length <= 2, `${step.step} says the error more than once`);
    assert.doesNotMatch(text, /could not read the groups of the Data groups you chose/, 'no groups were chosen, so no groups error (must-exclude)');
    const first = seen.find((s) => s.step === 'First run');
    const row = summaryOf(seen);
    if (/spread across the whole table/.test(first?.text || '')) assert.doesNotMatch(row, /keeping related records together/);
    assert.doesNotMatch(row, /about 1,000 records, keeping related records together/);
  } finally {
    await ui.close();
  }
});

test('the First run of 20 whole groups of 40 records says 800 records and lists the groups briefly', async () => {
  const { seen, ui } = await scenario('groups-31-first-run', { profile: PROFILE, extra: counted(PROFILE) });
  try {
    const row = summaryOf(seen).split('\n').find((l) => /whole groups/.test(l)) || '';
    const firstRun = seen.find((s) => s.step === 'First run').text;
    assert.doesNotMatch(`${row}\n${firstRun}`, /about 1,000 records|~1,000 records in \d+ whole groups/i);
    assert.match(`${row}\n${firstRun}`, /800 records/);
    assert.match(row, /^800 records in 20 whole groups$/);
    assert.ok(row.length < 400, `${row.length} characters`);
  } finally {
    await ui.close();
  }
});

test('a First run of several groups on a new schema of its own: Next creates the schema once and the Summary names the new table and the groups', async () => {
  const own = 'main._inspire_acme_n01_u01.n01_u01_results';
  const { seen, ui } = await scenario('own-schema-groups', { profile: PROFILE,
    extra: { ...counted(PROFILE), forwardedToken: 'person-tok', dbToken: 'person-tok', catalogs: ['main'], schemas: { main: ['inspire'] },
      statements: { 'information_schema.schema_tags': () => ({ rows: [{ kind: 'right', schema_name: '', value: 'CREATE_SCHEMA' }] }) } },
    actions: { 'First run': radio(/^Several groups/) } });
  try {
    noLeaks(seen, 'own-schema-groups');
    const summary = summaryOf(seen);
    assert.match(summary, new RegExp(`Result table\\n${own.replace(/\./g, '\\.')}`));
    assert.match(summary, /Data groups\nstore · 31 groups/);
    assert.equal(ui.made.sqlCalls.filter((c) => /^CREATE SCHEMA/.test(c.sql)).length, 1);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

async function recipients(page, text) {
  await page.getByRole('button', { name: 'Change delivery settings' }).click();
  const box = page.getByLabel('Email recipients (comma separated)');
  await box.fill(text);
  await settle(page);
}

const alertLine = async (page) => (await page.locator('[role="dialog"]').innerText()).split('\n').filter((l) => /^(Emails |Nobody gets it yet)/.test(l)).at(-1) || '';

test('ticking the Alert emails the owner by default, and the Summary and the build carry the recipients the person typed', async () => {
  const { seen, ui } = await scenario('alert-recipients', { profile: PROFILE, extra: counted(PROFILE),
    actions: { 'What to deliver': async (page) => {
      await check(/^Alert/)(page);
      await settle(page);
      assert.match(await alertLine(page), new RegExp(`^Emails ${OWNER.replace(/\./g, '\\.')} when `));
      await recipients(page, 'ops@example.com, شريك@example.com');
      assert.match(await alertLine(page), /^Emails ops@example\.com, شريك@example\.com when /);
    } } });
  try {
    noLeaks(seen, 'alert-recipients');
    assert.equal(seen.at(-1).step, 'Review & build', seen.at(-1).text.slice(0, 300));
    assert.match(summaryOf(seen), /Alert\nEmails ops@example\.com, شريك@example\.com when /);
    const { page, made } = ui;
    await page.getByRole('button', { name: 'All Good, Build it Now' }).click();
    await settle(page);
    const insert = made.sqlCalls.find((c) => String(c.sql).includes('INSERT INTO') && (c.parameters || []).some((p) => p.name === 'spec'));
    assert.ok(insert, 'the build was not submitted');
    assert.deepEqual(JSON.parse(insert.parameters.find((p) => p.name === 'spec').value).outputs.alert_recipients, ['ops@example.com', 'شريك@example.com']);
  } finally {
    await ui.close();
  }
});

for (const [name, typed, refusal] of [
  ['alert-bad-email', 'ops@example.com, not-an-email', /not an email address: not-an-email/],
  ['alert-nobody', '', /an alert needs at least one recipient email or notification destination/],
]) {
  test(`an Alert with ${name === 'alert-nobody' ? 'no recipient' : 'a recipient that is not an email'} is stopped on Deliver with the reason, never at the build`, async () => {
    const { seen, ui } = await scenario(name, { profile: PROFILE, extra: counted(PROFILE),
      actions: { 'What to deliver': async (page) => { await check(/^Alert/)(page); await settle(page); await recipients(page, typed); } } });
    try {
      const stop = seen.at(-1);
      assert.equal(stop.step, 'What to deliver');
      assert.match(stop.text, refusal);
      if (!typed) assert.equal(await alertLine(ui.page), 'Nobody gets it yet: add an email under Change delivery settings.');
      assert.equal(ui.made.jobs.length, 0);
    } finally {
      await ui.close();
    }
  });
}

test('the First run names the chosen Data groups in a plain note, never in the red error box', async () => {
  const { ui } = await scenario('first-run-note', { profile: PROFILE, extra: counted(PROFILE), actions: { 'First run': async (page) => {
    const note = page.locator('[data-grouping-chosen]');
    assert.equal(await note.getAttribute('role'), 'note');
    assert.equal(await note.evaluate((el) => Boolean(el.closest('[role="alert"]'))), false);
    assert.doesNotMatch(await note.getAttribute('class'), /error/);
  } } });
  await ui.close();
});

test('every question in the wizard shows at most one Recommended choice', async () => {
  const counts = [];
  const tally = async (page) => counts.push([await current(page), await page.locator('[role="radiogroup"]').evaluateAll((groups) => groups.map((g) => g.querySelectorAll('[data-recommended]').length))]);
  const steps = ['Data groups', 'First run', 'Results', 'What to deliver', 'Where it lives', 'Who uses the App', 'App pages', 'App look', RUN_IT];
  const { ui } = await scenario('one-recommended', { profile: PROFILE, extra: counted(PROFILE), actions: Object.fromEntries(steps.map((s) => [s, tally])) });
  try {
    assert.ok(counts.length >= 5, JSON.stringify(counts));
    for (const [step, groups] of counts) for (const n of groups) assert.ok(n <= 1, `${step}: ${JSON.stringify(groups)}`);
  } finally {
    await ui.close();
  }
});

test('a build clears the draft, so the next wizard opens on the Use case with no "picks are back" note', async () => {
  const { ui } = await scenario('draft-after-build', { profile: PROFILE, extra: counted(PROFILE), actions: { 'Data & results': freshPress('Weekly') } });
  try {
    const { page, made } = ui;
    await page.getByRole('button', { name: 'All Good, Build it Now' }).click();
    await settle(page);
    assert.equal(made.jobs.length, 1);
    await page.reload();
    await settle(page);
    assert.equal(await page.locator('[data-wizard-draft]').count(), 0);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('ticking two columns whose groups multiply past 500 says so before the build', async () => {
  const wide = { ...GROUPING_PROFILE, columns: [...GROUPING_PROFILE.columns, { name: 'store', type: 'string', distinct: 300, smallest: 40, largest: 900, nulls: 0, parent: null }] };
  const calls = [];
  const groupsOf = (by) => Array.from({ length: by.split(', ').length > 1 ? 1200 : 300 }, (_v, i) => ({ value: `g${i}`, records: 40, parts: [] }));
  const init = async (page) => page.route('**/api/grouping/profile', async (route) => {
    const body = JSON.parse(route.request().postData() || '{}');
    calls.push(body);
    const list = body.group_by ? groupsOf(body.group_by) : null;
    const answer = list ? { ...wide, groups_for: body.group_by, group_count: list.length, group_list: list.slice(0, 500) } : wide;
    await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(answer) });
  });
  const { seen, ui } = await scenario('combine-past-500', { profile: wide, calls, init, actions: { 'Data groups': async (page) => {
    const combine = page.getByRole('group', { name: 'Combine columns, coarse to fine' });
    for (const box of await combine.locator('input').all()) if (await box.isChecked()) await box.uncheck();
    await combine.locator('[data-grouping-combine-column="region"] input').check();
    await combine.locator('[data-grouping-combine-column="store"] input').check();
  } } });
  try {
    const groups = seen.find((s) => s.step === 'Data groups').text;
    if (DUMP) fs.writeFileSync(`${DUMP}/combine-past-500.groups.txt`, `${JSON.stringify(calls)}\n${groups}`);
    const summary = seen.find((st) => st.step === 'Review & build').text;
    if (DUMP) fs.writeFileSync(`${DUMP}/combine-past-500.summary.txt`, summary);
    assert.match(groups, /region, then store splits the data into 1,200 groups\. Inspire models each group on its own\.\s*That is more than the 500 groups Inspire models one by one/);
    assert.doesNotMatch(groups, /region, then country splits the data/, 'the headline is the split the person ticked, not the one Inspire suggested (must-exclude)');
    assert.match(summary, /region, then store · 1,200 groups/, 'the Summary has the Data groups row of the combined split');
    assert.doesNotMatch(summary, /whole groups of store(?!.)/m, 'the First run keeps every ticked column (must-exclude)');
  } finally {
    await ui.close();
  }
});

const RUN_IT = 'Run it';

async function summaryText(page) {
  await settle(page);
  await page.getByRole('button', { name: 'All Good, Build it Now' }).waitFor({ timeout: 5000 });
  return page.locator('[role="dialog"]').innerText();
}

async function toSummary(page) {
  for (let i = 0; i < 20 && (await current(page)) !== 'Review & build'; i += 1) {
    await settle(page);
    const was = await current(page);
    const moneyNext = page.locator('[data-money-next]');
    if (was === 'Measure' && await moneyNext.count() && await moneyNext.isVisible()) {
      await moneyNext.click();
      continue;
    }
    await page.getByRole('button', { name: /^(Next|Back to Summary)$/ }).click();
    await settle(page);
    assert.notEqual(await current(page), was, `Next did not leave ${was}`);
  }
}

test('Change on a Summary row opens that step, keeps every earlier answer and Back to Summary returns with the new answer', async () => {
  const { ui } = await scenario('change-from-summary', { profile: PROFILE, extra: counted(PROFILE), actions: { 'Data & results': freshPress('Weekly') } });
  try {
    const { page } = ui;
    assert.equal(await current(page), 'Review & build');
    assert.match(await page.locator('[role="dialog"]').innerText(), /Keep it fresh\nWeekly/);
    await page.getByRole('button', { name: 'Change Keep it fresh' }).click();
    await settle(page);
    assert.equal(await current(page), 'Data & results');
    await openRow(page, 'Keep it fresh');
    assert.equal(await page.getByRole('button', { name: 'Weekly', exact: true }).getAttribute('aria-pressed'), 'true');
    await press('Off')(page);
    await page.getByRole('button', { name: 'Back to Summary' }).click();
    await settle(page);
    assert.equal(await current(page), 'Review & build');
    const text = await page.locator('[role="dialog"]').innerText();
    assert.match(text, /Keep it fresh\nOff/);
    assert.match(text, /Data groups\nstore · 31 groups/);
    assert.deepEqual(ui.pageErrors, []);
  } finally {
    await ui.close();
  }
});

test('Back from the Summary walks every step in order to What to deliver and Next walks forward again to the same Summary', async () => {
  const { seen, ui } = await scenario('back-and-forth', { profile: PROFILE, extra: counted(PROFILE) });
  try {
    const { page } = ui;
    const forward = seen.map((s) => s.step);
    const summary = await summaryText(page);
    const back = [await current(page)];
    while ((await current(page)) !== 'What to deliver' && back.length < 12) {
      const was = await current(page);
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await settle(page);
      assert.notEqual(await current(page), was, `Back did not leave ${was}`);
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

test('reloading after only moving between steps opens the wizard again cleanly on What to deliver with no draft notice, and Start over goes back there too', async () => {
  const { ui } = await scenario('reload', { profile: PROFILE, extra: counted(PROFILE) });
  try {
    const { page } = ui;
    await page.reload();
    await settle(page);
    await onStep(page, 'What to deliver');
    assert.equal(await page.locator('[data-wizard-draft]').count(), 0, 'moving between steps is not a change, so no draft notice');
    await goToStep(page, 'Data');
    await toSummary(page);
    noLeaks([{ step: 'Review & build', text: await page.locator('[role="dialog"]').innerText() }], 'reload');
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
      assert.equal(seen.at(-1).step, 'Review & build', seen.at(-1).text.slice(0, 400));
    } finally {
      await ui.close();
    }
  });
}
