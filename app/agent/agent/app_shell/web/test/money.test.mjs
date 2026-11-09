import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { ASK_GROUPS, TABLE, appInfo, askAudit, openApp, pageData, said, serveDist, steadyBox, until } from './harness.mjs';
import { amountText, moneyOf, recordFormula, ruleText, sumFormula } from '../src/money.js';
import { nothingReason, nothingText } from '../src/hub.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const OWNER = ['owner', 'example.com'].join('@');
const TODAY = '2026-10-24';
const RUNS = { updated: '2026-10-20T06:00:00Z', as_of: '2026-10-20', cadence_days: 7, next: '2026-10-27', stale: false, count: 6, failed: false };
const MODEL = {
  currency: 'USD', basis: 'measured', act_now_amount: 5000, review_amount: 1000, template: '{units:number} units lost x {PRICE:money} a unit x {KEEP:percent} kept',
  parts: [{ column: 'units', kind: 'number' }, { text: ' units lost x ' }, { assumption: 'PRICE', kind: 'money' }, { text: ' a unit x ' },
    { assumption: 'KEEP', kind: 'percent' }, { text: ' kept' }],
  columns: ['units'], inputs: 'columns', expression: 'greatest(0, units * PRICE * KEEP)', recomputes: true, changed: true, problem: '',
  assumptions: [{ name: 'PRICE', kind: 'money', value: 30, run_value: 20, changed_by: OWNER, changed_at: '2026-10-23T09:00:00Z', note: 'list price' },
    { name: 'KEEP', kind: 'percent', value: 0.5, run_value: 0.5, changed_by: '', changed_at: null, note: '' }],
};
const item = (key, label, tier, money, fx, extra = {}) => ({ key, label, tier, money, fx, why: null, owner: null, status: null, reason: 'Discount too deep', due: null, ...extra });
const done = { fixed: 4, fixed_q: 2, dismissed: 1, dismissed_q: 1, saved_n: 3, saved: 2500, saved_q_n: 2, saved_q: 1500, first_fixed: '2026-09-01T10:00:00Z', first_saved: '2026-09-08T06:00:00Z' };
const WEEKS = Array.from({ length: 12 }, (_, i) => ({ week: new Date(Date.UTC(2026, 7, 3 + 7 * i)).toISOString().slice(0, 10), saved: i === 11 ? 1500 : 0 }));
const entry = (items, extra = {}) => ({ visible: true, tracked: true, money: true, categories: ['ai_cat_driver'], served: 'delta', items,
  total: items.length, truncated: false, done, weeks: WEEKS, runs: RUNS, money_model: MODEL, ...extra });
const HUB = {
  today: TODAY, quarter: '2026-10-01', since: WEEKS[0].week, errors: {},
  pages: {
    n01_u05: entry([item('a', 'Blue denim jacket', 'Act now', 7500, '500.0'), item('b', 'Wool coat', 'Act now', 1350, '90.0')]),
    n02_u01: entry([item('c', 'Linen trousers', 'Review', 600, '40.0')], { money_model: null }),
    n02_u02: entry([], { money_model: null }),
  },
};
const run = (extra) => ({ summary: null, nothing_to_act: null, decision_basis: 'measured', currency: 'USD', as_of_date: '2026-10-20', act_now_records: 0, ...extra });
const SUMMARIES = {
  n01_u05: { run: run({ act_now_records: 2 }), categories: {}, note: '' },
  n02_u01: { run: run({}), categories: {}, note: '' },
  n02_u02: { run: run({ decision_basis: 'predicted', nothing_to_act: 'No model passed this use case\'s acceptance check in the last run, so no record is actionable yet.' }), categories: {}, note: '' },
};
const MONEY = { model: MODEL, editable: true, why: '', history: [{ name: 'PRICE', value: 30, kind: 'money', changed_by: OWNER, changed_at: '2026-10-23T09:00:00Z', note: 'list price' },
  { name: 'PRICE', value: 25, kind: 'money', changed_by: OWNER, changed_at: '2026-10-22T09:00:00Z', note: '' }] };

function routes(seen, money = MONEY) {
  const state = { money };
  return {
    overview: ({ route, json }) => {
      const body = route.request().postDataJSON();
      (seen.hub ||= []).push(body);
      return json(200, body.page ? { ...HUB, pages: { [body.page]: HUB.pages[body.page] } } : HUB);
    },
    summary: ({ json, url }) => json(200, SUMMARIES[url.searchParams.get('page')] || { run: null, categories: {}, note: 'none' }),
    money: ({ json }) => { (seen.money ||= []).push(1); return json(200, state.money); },
    'money/assumption': ({ route, json }) => {
      const body = route.request().postDataJSON();
      (seen.changes ||= []).push(body);
      const model = { ...MODEL, assumptions: MODEL.assumptions.map((a) => (a.name === body.name ? { ...a, value: body.value, changed_by: OWNER } : a)) };
      state.money = { ...state.money, model };
      return json(200, state.money);
    },
    'records/history': ({ json, url }) => json(200, { record_key: url.searchParams.get('record_key'), fields: [], versions: [], current: null,
      deleted: false, truncated: false }),
    records: ({ route, json }) => {
      const body = route.request().postDataJSON();
      const rows = pageData(body.filters).records.rows.slice(0, 3).map((r, i) => ({ ...r, record_key: r.entity_id, value_at_stake: [5000, 900, 300][i],
        _inspire_money: [7500, 1350, 450][i], _inspire_fx: ['500.0', '90.0', '30.0'][i] }));
      return json(200, { rows, total: 3, offset: 0, limit: 25, actions: false, changes: false, summary: null, errors: {}, money: MODEL });
    },
  };
}

const INFO = (extra = {}) => appInfo({ business: 'Contoso Retail', ...extra }, 3, {
  ...TABLE, records: { title: 'Decision list', key: 'entity_id', label: 'entity_label', rank: 'rank', tier: 'priority_tier',
    columns: [{ column: 'value_at_stake', label: 'Could save', format: 'currency', currency: 'USD' }] },
});

async function tipOf(page, target) {
  await steadyBox(page, target);
  await target.hover();
  const id = await target.getAttribute('aria-describedby');
  await page.waitForFunction((tip) => document.getElementById(tip)?.classList.contains('is-on'), id);
  return page.evaluate((tip) => document.getElementById(tip).textContent, id);
}

test('each record formula fills in the record numbers and the assumptions as they stand now', () => {
  assert.equal(amountText(1234.5, 'money', 'USD'), '1,234.5 USD');
  assert.equal(amountText(0.255, 'percent'), '25.5%');
  assert.equal(amountText(12, 'number'), '12');
  assert.equal(recordFormula(MODEL, { _inspire_money: 7500, _inspire_fx: '500.0' }), '500 units lost x 30 USD a unit x 50% kept = 7,500 USD');
  assert.equal(recordFormula(MODEL, { money: 1350, fx: '90.0' }), '90 units lost x 30 USD a unit x 50% kept = 1,350 USD');
  assert.equal(recordFormula(MODEL, { money: 1350, fx: '' }), '', 'a record without its numbers shows no made up formula');
  assert.equal(recordFormula(MODEL, { money: null, fx: '90' }), '');
  assert.equal(recordFormula({ inputs: 'said' }, { money: 10, fx: 'stock 10 x price 1 = 10 USD' }), 'stock 10 x price 1 = 10 USD');
  assert.deepEqual(moneyOf(MODEL, { _inspire_money: 7500, _inspire_fx: '500.0', value_at_stake: 5000 }),
    { amount: 7500, currency: 'USD', text: '$7,500', formula: '500 units lost x 30 USD a unit x 50% kept = 7,500 USD' });
  assert.equal(ruleText(MODEL), '[units] units lost x 30 USD a unit x 50% kept');
  assert.equal(sumFormula([{ label: 'A', money: 10, currency: 'USD' }, { label: 'B', money: 5, currency: 'EUR' }, { label: 'C', money: null }], 'Money at stake'),
    'Money at stake: A $10 + B €5 = $10 + €5. Open a record to see how its money is worked out.');
});

test('a use case with nothing to fix always says why, from the run or from what the App sees', () => {
  const tracked = (items, extra = {}) => ({ tracked: true, items, ...extra });
  assert.equal(nothingReason(tracked([item('a', 'A', 'Act now', 1)]), { run: run({ nothing_to_act: 'x' }) }), '');
  assert.equal(nothingReason(tracked([]), { run: run({ nothing_to_act: '  AUC 0.55 is below 0.60.  ' }) }), 'AUC 0.55 is below 0.60.');
  assert.equal(nothingReason(tracked([]), { run: run({ act_now_records: 3 }) }), 'the 3 records to act on from the last update are done or set aside');
  assert.equal(nothingReason(tracked([], { truncated: true }), { run: run({ act_now_records: 3 }) }), 'no record reached Act now or Review in the last update');
  assert.equal(nothingReason(tracked([item('r', 'R', 'Review', 1)]), null), 'no record reached Act now in the last update, and 1 record is worth a look');
  assert.equal(nothingReason(tracked([]), undefined), 'no record reached Act now or Review in the last update');
  assert.equal(nothingReason({ tracked: false, items: [] }, null), '');
  assert.equal(nothingText(nothingReason(tracked([]), undefined)), 'Nothing to act on yet, because no record reached Act now or Review in the last update');
});

test('every money number on the Overview shows its formula on hover and on focus', async () => {
  const seen = {};
  const { page, seen: app, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: routes(seen) });
  await page.waitForSelector('.tbl--things tbody tr');
  const save = page.locator('[data-tile="save"] .kpi-v');
  assert.equal(await save.innerText(), '$8,850');
  assert.equal(await tipOf(page, save), 'Money at stake on the 2 things to fix, added up: Blue denim jacket $7,500 + Wool coat $1,350 = '
    + '$8,850. Open a record to see how its money is worked out.');
  const saved = page.locator('[data-tile="saved"] .kpi-v');
  assert.match(await tipOf(page, saved), /^The money at stake each fix had when it was fixed, less what a later run still finds, added up over the 6 fixes a later run confirmed since Oct 1 = \$4,500$/);
  const cell = page.locator('.tbl--things tbody tr').first().locator('.fx-n');
  assert.equal(await cell.innerText(), '$7,500', 'the formula stays out of sight until someone points at the number');
  await cell.focus();
  const id = await cell.getAttribute('aria-describedby');
  await page.waitForFunction((tip) => document.getElementById(tip)?.classList.contains('is-on'), id);
  assert.equal(await page.evaluate((tip) => document.getElementById(tip).textContent, id), '500 units lost x 30 USD a unit x 50% kept = 7,500 USD');
  await cell.blur();
  const bar = page.locator('[data-bars="by_use_case"] .hb').first();
  assert.match(await tipOf(page, bar), /^Money at stake on the 2 things to fix in Price-loss decision desk, added up: Blue denim jacket \$7,500 \+ Wool coat \$1,350 = \$8,850\./);
  const week = page.locator('[data-bars="saved_weeks"] .vb-c').last();
  assert.match(await tipOf(page, week), /^Money at stake when fixed, less what a later run still finds, on the fixes a later run confirmed in the week of Oct 19, added up = \$\d/);
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('the Overview lists each use case with nothing to act on and the real reason', async () => {
  const seen = {};
  const { page, seen: app, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: routes(seen) });
  await page.waitForSelector('[data-nothing]');
  assert.deepEqual(await page.locator('[data-nothing]').allInnerTexts(), [
    'Second desk 1 Nothing to act on yet, because no record reached Act now in the last update, and 1 record is worth a look',
    'Second desk 2 Nothing to act on yet, because no model passed this use case\'s acceptance check in the last run, so no record is actionable yet.']);
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('an owner reads how the money is worked out, changes an assumption with a note, and the page follows it', async () => {
  const seen = {};
  const { page, seen: app, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: routes(seen) });
  await page.goto(`${served.base}#/n01_u05`);
  const card = page.getByRole('region', { name: 'How the money at stake is worked out' });
  await card.waitFor();
  assert.equal(await card.locator('.rule').innerText(), 'Each record: units units lost x 30 USD a unit x 50% kept = its money at stake.');
  assert.deepEqual(await card.locator('tbody tr').evaluateAll((rows) => rows.map((r) => [...r.querySelectorAll('td')].slice(0, 3).map((td) => td.innerText))),
    [['Price', '30 USD', `${OWNER}, Oct 23, 2026`], ['Keep', '50%', 'As the notebook set it']]);
  assert.equal(await card.locator('.tiers').innerText(), 'Act now from $5,000 at stake, Review from $1,000, every other record Monitor. A changed assumption moves records between these tiers on the next update.');
  assert.deepEqual(await card.locator('.hist li').allInnerTexts(), [`Oct 23, 2026, ${OWNER} set Price from 25 USD to 30 USD: list price`, `Oct 22, 2026, ${OWNER} set Price to 25 USD`]);
  const before = seen.hub.filter((b) => b.page === 'n01_u05').length;
  await card.getByRole('button', { name: 'Change Keep' }).click();
  const input = card.locator('input[name="assumption_KEEP"]');
  assert.equal(await input.inputValue(), '50');
  await input.fill('140');
  assert.equal(await card.getByRole('button', { name: 'Save' }).isDisabled(), true);
  assert.equal(await card.locator('.err').innerText(), 'Enter a share from 0 to 100%');
  await input.fill('40');
  await card.locator('input[name="assumption_note"]').fill('fewer customers come back');
  await card.getByRole('button', { name: 'Save' }).click();
  await page.waitForFunction(() => document.querySelector('.toast')?.textContent.includes('Keep is 40% now'));
  assert.deepEqual(seen.changes, [{ page: 'n01_u05', name: 'KEEP', value: 0.4, was: 0.5, note: 'fewer customers come back' }]);
  await page.waitForFunction(() => document.querySelector('[data-assumption="KEEP"] td.num')?.textContent === '40%');
  await until(() => seen.hub.filter((b) => b.page === 'n01_u05').length > before);
  assert.ok(seen.hub.filter((b) => b.page === 'n01_u05').length > before, 'the things to fix and the tiles load again with the new money');
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('the money card asks Genie with its rule, its tiers and each assumption as it stands, folded or open', async () => {
  const seen = {};
  const explain = [];
  const asks = { 'genie/explain': ({ route, json }) => { explain.push(route.request().postDataJSON()); return json(200, { conversation_id: 'c1', message_id: 'm1', question: 'q' }); },
    'genie/message': ({ json }) => json(200, { state: 'done', text: 'Genie answered.', sql: 'SELECT 1', columns: [], rows: [], truncated: false }) };
  const { page, seen: app, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: { ...routes(seen), ...asks } });
  await page.goto(`${served.base}#/n01_u05`);
  const card = page.getByRole('region', { name: 'How the money at stake is worked out' });
  await card.waitFor();
  const found = await page.evaluate(askAudit, ASK_GROUPS);
  assert.deepEqual([found.missing, found.hidden], [[], []]);
  const price = await card.locator('[data-assumption="PRICE"]').getByRole('button', { name: 'Ask Genie about Price', exact: true });
  await price.click();
  await page.locator('form.ask-box .sugg').first().click();
  await until(() => explain.length === 1);
  assert.deepEqual([explain[0].kind, explain[0].context.fields], ['text', { Assumption: 'Price', Value: '30 USD', 'Set by the run': '20 USD',
    'Last change': `${OWNER}, Oct 23, 2026`, Why: 'list price' }]);
  await page.locator('.msg-sql').first().waitFor({ timeout: 15000 });
  await card.getByRole('button', { name: 'Ask Genie about How the money at stake is worked out', exact: true }).click();
  await page.locator('form.ask-box .sugg').first().click();
  await until(() => explain.length === 2);
  assert.equal(explain[1].kind, 'text');
  assert.equal(explain[1].context.hint, `Each record: ${ruleText(MODEL)} = its money at stake. Act now from $5,000 at stake, Review from $1,000, every other record Monitor.`
    + ' A changed assumption moves records between these tiers on the next update.');
  assert.deepEqual(explain[1].context.fields, { Price: '30 USD', Keep: '50%' });
  await page.locator('.msg-sql').nth(1).waitFor({ timeout: 15000 });
  await card.getByRole('button', { name: 'Fold How the money at stake is worked out', exact: true }).click();
  await page.locator('section.money--folded').waitFor();
  assert.equal(await page.locator('section.money--folded').getByRole('button', { name: 'Ask Genie about How the money at stake is worked out', exact: true }).count(), 1);
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('a use case counted in hours names its formula card in hours, and a card that cannot load says amount', async () => {
  const seen = {};
  const hours = { ...MONEY, model: { ...MODEL, currency: '', unit: 'hours' } };
  const { page, seen: app, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: routes(seen, hours) });
  await page.goto(`${served.base}#/n01_u05`);
  const card = page.getByRole('region', { name: 'How the hours at stake is worked out' });
  await card.waitFor();
  assert.equal(await card.locator('h2').textContent(), 'How the hours at stake is worked out');
  assert.ok((await card.locator('.rule').textContent()).endsWith('= its hours at stake.'));
  assert.ok(!(await card.textContent()).includes('money at stake'));
  assert.deepEqual(app.errors, []);
  await context.close();
  const broken = { ...routes({}), money: ({ json }) => json(500, { error: 'the warehouse is stopped' }) };
  const second = await openApp(browser, served.base, INFO(), { width: 1440, routes: broken });
  await second.page.goto(`${served.base}#/n01_u05`);
  const failed = second.page.locator('.tile-err', { hasText: 'is worked out could not load' });
  await failed.waitFor();
  assert.equal(await said(failed), 'How the amount at stake is worked out could not load: the SQL warehouse is stopped, so start it on the SQL Warehouses page or ask its owner to, then try again.');
  await second.context.close();
});

test('a use case counted in FTE names its formula card and tiers in FTE, never a currency', async () => {
  const seen = {};
  const fte = { ...MONEY, model: { ...MODEL, currency: '', unit: 'FTE', impact_kind: 'number' } };
  const { page, seen: app, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: routes(seen, fte) });
  await page.goto(`${served.base}#/n01_u05`);
  const card = page.getByRole('region', { name: 'How the FTE at stake is worked out' });
  await card.waitFor();
  assert.ok((await card.locator('.rule').textContent()).endsWith('= its FTE at stake.'));
  assert.ok((await card.locator('.tiers').textContent()).startsWith('Act now from 5,000 FTE at stake, Review from 1,000 FTE, '));
  assert.ok(!/\$|FTE\s\d/.test(await card.textContent()), 'FTE is never read as a currency code');
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('the money panel fits a phone: the assumptions table scrolls inside its card, never the page', async () => {
  const seen = {};
  const { page, seen: app, context } = await openApp(browser, served.base, INFO(), { width: 390, routes: routes(seen) });
  await page.goto(`${served.base}#/n01_u05`);
  const card = page.getByRole('region', { name: 'How the money at stake is worked out' });
  await card.locator('tbody tr').first().waitFor();
  assert.equal(await card.locator('.tbl-wrap > table').count(), 1);
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth), 0, 'the page never scrolls sideways');
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('a formula of only the record\u2019s own numbers lists no assumption and never says a changed assumption moves records', async () => {
  const seen = {};
  const own = { ...MODEL, template: '{units:number} units lost', parts: [{ column: 'units', kind: 'number' }, { text: ' units lost' }], expression: null,
    recomputes: false, changed: false, assumptions: [] };
  const { page, seen: app, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: routes(seen, { ...MONEY, model: own, history: [] }) });
  await page.goto(`${served.base}#/n01_u05`);
  const card = page.getByRole('region', { name: 'How the money at stake is worked out' });
  await card.waitFor();
  assert.equal(await card.locator('.rule').innerText(), 'Each record: units units lost = its money at stake.');
  assert.equal(await card.locator('tbody tr').count(), 0);
  assert.equal(await card.locator('.tiers').innerText(), 'Act now from $5,000 at stake, Review from $1,000, every other record Monitor.');
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('the tiers of a use case that holds records back say what held back means', async () => {
  const seen = {};
  const held = 'Held back records were flagged Act now or Review but are kept off the to fix list on purpose.';
  const { page, seen: app, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: routes(seen, { ...MONEY, held }) });
  await page.goto(`${served.base}#/n01_u05`);
  const card = page.getByRole('region', { name: 'How the money at stake is worked out' });
  await card.waitFor();
  assert.equal(await card.locator('.tiers').innerText(), 'Act now from $5,000 at stake, Review from $1,000, every other record Monitor. A changed assumption moves records between these tiers on the next update. '
    + held);
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('someone who is not an owner sees the assumptions and why they cannot change them', async () => {
  const seen = {};
  const money = { ...MONEY, editable: false, why: 'Only the owners of this use case can change its assumptions' };
  const { page, seen: app, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: routes(seen, money) });
  await page.goto(`${served.base}#/n01_u05`);
  const card = page.getByRole('region', { name: 'How the money at stake is worked out' });
  await card.waitFor();
  assert.equal(await card.getByRole('button', { name: /^Change/ }).count(), 0);
  assert.equal(await card.locator('.why').innerText(), 'You cannot change these assumptions here: only the owners of this use case can change its assumptions.');
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('the decision list shows the money an assumption change gives, with its formula in the list and in the record panel', async () => {
  const seen = {};
  const { page, seen: app, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: routes(seen) });
  await page.goto(`${served.base}#/n01_u05`);
  const cell = page.locator('.card--table[aria-label="Decision list"] tbody tr').first().locator('.fx-n');
  await cell.waitFor();
  assert.equal(await cell.innerText(), '$7.5K');
  assert.equal(await tipOf(page, cell), '500 units lost x 30 USD a unit x 50% kept = 7,500 USD');
  await page.locator('.card--table[aria-label="Decision list"] tbody tr').first().locator('.cell-t').click();
  const panel = page.locator('dialog.drawer[open] section[aria-label="Could save"]');
  await panel.waitFor();
  assert.equal(await panel.locator('.save').innerText(), '$7,500');
  assert.equal(await panel.locator('.fx').first().innerText(), '500 units lost x 30 USD a unit x 50% kept = 7,500 USD');
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('a prediction that is not ready says Nothing to act on yet with the run reason on its page', async () => {
  const seen = {};
  const { page, seen: app, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: routes(seen) });
  await page.goto(`${served.base}#/n02_u02`);
  await page.waitForSelector('.uc-status.is-wait');
  assert.equal(await page.locator('.uc-status.is-wait').innerText(),
    'Not ready yet\nNothing to act on yet, because no model passed this use case\'s acceptance check in the last run, so no record is actionable yet. It is checked again on Oct 27.');
  await page.goto(`${served.base}#/n02_u01`);
  await page.waitForSelector('[data-nothing-fix] [data-nothing]');
  assert.equal(await page.locator('[data-nothing-fix] [data-nothing]').innerText(),
    'Nothing to act on yet, because no record reached Act now in the last update, and 1 record is worth a look');
  assert.deepEqual(app.errors, []);
  await context.close();
});

test('a value outside the range the notebook declared cannot be saved from the money panel', async () => {
  const seen = {};
  const ranged = { ...MONEY, model: { ...MODEL, assumptions: MODEL.assumptions.map((a) => (a.name === 'KEEP'
    ? { ...a, low: 0.2, high: 0.9, setting: { name: 'KEEP', kind: 'percent', low: 0.2, high: 0.9, allowed: '0.2 to 0.9' } } : a)) } };
  const { page, seen: app, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: routes(seen, ranged) });
  await page.goto(`${served.base}#/n01_u05`);
  const card = page.getByRole('region', { name: 'How the money at stake is worked out' });
  await card.waitFor();
  await card.getByRole('button', { name: 'Change Keep' }).click();
  const input = card.locator('input[name="assumption_KEEP"]');
  await input.fill('95');
  assert.equal(await card.getByRole('button', { name: 'Save' }).isDisabled(), true);
  assert.equal(await card.locator('.err').innerText(), "KEEP is '0.95'; allowed: 0.2 to 0.9");
  await input.fill('60');
  await card.getByRole('button', { name: 'Save' }).click();
  await until(() => (seen.changes || []).length === 1);
  assert.deepEqual(seen.changes, [{ page: 'n01_u05', name: 'KEEP', value: 0.6, was: 0.5, note: '' }]);
  assert.deepEqual(app.errors, []);
  await context.close();
});
