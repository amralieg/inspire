import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, ASK_GROUPS, askAudit, chartsDrawn, goRail, idle, myWorkOf, openApp, pickCase, serveDist, TABLE, until } from './harness.mjs';
import { wholeMoney } from '../src/format.js';
import {
  DEFAULT_VIEW, dueText, isMine, moneyText, nothingText, ownerName, pickReason, reasonFilters,
  sortThings, totals, useCaseState, viewRows, viewWords,
} from '../src/hub.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const ME = ['pat.lee', 'example.com'].join('@');
const SAM = ['sam.ortiz', 'example.com'].join('@');
const TODAY = '2026-10-24';
const WEEKS = Array.from({ length: 12 }, (_, i) => new Date(Date.UTC(2026, 7, 3 + 7 * i)).toISOString().slice(0, 10));
const RUNS = { updated: '2026-10-20T06:00:00Z', as_of: '2026-10-20', cadence_days: 7, next: '2026-10-27', stale: false, count: 6, failed: false };
const item = (key, label, tier, money, extra = {}) => ({ key, label, tier, money, why: null, owner: null, status: null, reason: null, due: null, ...extra });
const DESK = [
  item('a', 'Blue denim jacket, store 12', 'Act now', 8400, { owner: ME, status: 'In progress', reason: 'Discount too deep', due: TODAY,
    why: 'It has been 40% off for 6 weeks and is not selling more, so each week loses about $1,400 of margin.' }),
  item('b', 'Wool coat, store 4', 'Act now', 7200, { reason: 'Price below cost', why: 'It has sold below cost since 1 October, after a second markdown.' }),
  item('d', 'Leather boots, store 2', 'Act now', 6000, { owner: ME, reason: 'Stock in the wrong store', due: '2026-10-30' }),
  item('h', 'Linen trousers, store 12', 'Review', 1800, { reason: 'Discount too deep' }),
  item('m', 'Rain boots, store 9', 'Monitor', 50, { owner: SAM, due: '2026-10-20', reason: 'Discount too deep' }),
];
const INVOICES = [
  item('c', 'Supplier 3381, invoice 77188', 'Act now', 6950, { owner: ME, due: '2026-10-22', reason: 'Same amount and date' }),
  item('f', 'Supplier 1150, invoice 66102', 'Act now', 5300, { reason: 'Same amount, new number' }),
];
const done = (fixed, fixedQ, dismissedQ, saved, savedN, savedQ, savedQN) => ({
  fixed, fixed_q: fixedQ, dismissed: dismissedQ + 1, dismissed_q: dismissedQ, saved_n: savedN, saved, saved_q_n: savedQN, saved_q: savedQ,
  first_fixed: '2026-09-01T10:00:00Z', first_saved: '2026-09-08T06:00:00Z',
});
const entry = (items, extra = {}) => ({
  visible: true, tracked: true, money: true, categories: ['ai_cat_driver'], served: 'delta', items, total: items.length, truncated: false,
  done: done(12, 5, 1, 9750, 9, 4100, 4), weeks: WEEKS.map((week, i) => ({ week, saved: i > 8 ? 1000 * (i - 8) : 0 })), runs: RUNS, ...extra,
});
const HUB = {
  today: TODAY, quarter: '2026-10-01', since: WEEKS[0], errors: {},
  pages: {
    n01_u05: entry(DESK),
    n02_u01: entry(INVOICES, { done: done(9, 3, 1, 11500, 7, 3000, 2) }),
    n02_u02: entry([], { done: done(15, 2, 0, 20050, 15, 0, 0), runs: { ...RUNS, updated: '2026-10-10T06:00:00Z', as_of: '2026-10-10', next: '2026-10-17', stale: true } }),
    n02_u03: entry([], { done: done(0, 0, 0, 0, 0, 0, 0) }),
    n02_u04: { visible: false, tracked: false, note: '' },
  },
};
const CATEGORIES = { ai_cat_driver: { meaning: 'why the item is on the list', values: ['Discount too deep', 'Price below cost', 'Stock in the wrong store'] } };
const run = (extra) => ({ summary: null, nothing_to_act: null, decision_basis: 'measured', currency: 'USD', as_of_date: '2026-10-20', ...extra });
const SUMMARIES = {
  n01_u05: { run: run({ summary: 'Deep discounts on winter wear are losing margin without selling more.' }), categories: CATEGORIES, note: '' },
  n02_u01: { run: run({}), categories: {}, note: '' },
  n02_u02: { run: run({}), categories: {}, note: '' },
  n02_u03: { run: run({ decision_basis: 'predicted', nothing_to_act: 'The forecast is still learning and is not accurate enough to act on.' }), categories: {}, note: '' },
};
const INFO = () => appInfo({ business: 'Contoso Retail' }, 5, TABLE);

function hubRoutes(hub = HUB, summaries = SUMMARIES) {
  return {
    overview: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      (seen.hub ||= []).push(body);
      if (!body.page) return json(200, hub);
      const picked = body.ai?.ai_cat_driver || [];
      const one = hub.pages[body.page];
      const items = picked.length ? one.items.filter((i) => picked.includes(i.reason)) : one.items;
      return json(200, { ...hub, pages: { [body.page]: { ...one, items, total: items.length } } });
    },
    summary: ({ json, url }) => json(200, summaries[url.searchParams.get('page')] || { run: null, categories: {}, note: 'none' }),
    'records/history': ({ json, url, seen }) => {
      const key = url.searchParams.get('record_key') || url.searchParams.get('key');
      (seen.history ||= []).push(Object.fromEntries(url.searchParams));
      const found = Object.values(hub.pages).flatMap((e) => e.items || []).find((i) => i.key === key);
      const listed = /^R(\d+)$/.exec(key || '');
      const current = { entity_id: key, entity_label: found?.label || (listed ? `Item number ${Number(listed[1])} with a long descriptive name` : `Item ${key}`), priority_tier: found?.tier || 'Act now', record_key: key,
        valid_from: '2026-10-20T06:00:00.000Z', valid_to: null, is_current: true, change_source: 'run', changed_by: 'run 7', valid_from_us: '101' };
      return json(200, { record_key: key, fields: HISTORY_FIELDS, versions: [current], current, deleted: false, truncated: false });
    },
    my_work: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      (seen.work ||= []).push(body);
      const items = OVERDUE[body.page] || [];
      return json(200, myWorkOf(body.page, { overdue: { n: items.length, items } }));
    },
    impact: ({ json, url, seen }) => {
      (seen.impact ||= []).push(url.searchParams.get('page'));
      return json(200, IMPACT);
    },
  };
}

const OVERDUE = {
  n01_u05: [{ key: 'a', label: 'Blue denim jacket, store 12', due: '2026-10-20' }, { key: 'd', label: 'Leather boots, store 2', due: '2026-10-21' },
    { key: 'b', label: 'Wool coat, store 4', due: '2026-10-22' }],
  n02_u01: [{ key: 'c', label: 'Supplier 3381, invoice 77188', due: '2026-10-22' }],
};
const closedRecord = (key, label, measured, reported) => ({ key, label, status: 'Done', state: 'left', reason: null, note: null, at_close: measured || reported, now: 0,
  measured, reported, closed: '2026-10-21T06:00:00Z' });
const IMPACT = {
  visible: true, tracked: true, money: true, holds: false, since: '2026-10-01', served: 'delta', current: { records: 20, held: 0 },
  estimated: { 'Act now': { n: 2, money: 15600 }, Review: { n: 1, money: 1800 } }, reported: { n: 1, n_since: 1, money: 2400, money_since: 2400 },
  measured: { n: 2, n_since: 2, money: 13550, money_since: 13550 },
  closed: { Done: { n: 3, n_since: 3 }, Dismissed: { n: 0, n_since: 0 }, 'Could not fix': { n: 0, n_since: 0 } },
  outcomes: { left: 3, missing: 0, resolved: 0, flagged: 0, unchecked: 0 }, reasons: [], holdout: null,
  records: [closedRecord('g1', 'Rain jacket with a long descriptive name, store 7', 8400, null), closedRecord('g2', 'Supplier 2207, invoice 51120', 5150, null),
    closedRecord('g3', 'Canvas tote, store 3', null, 2400)],
};

const field = (name, kind, role = 'business', type = 'STRING') => ({ name, kind, role, type, editable: false });
const HISTORY_FIELDS = [field('entity_id', 'text', 'id'), field('entity_label', 'text'), field('priority_tier', 'text'), field('record_key', 'text', 'history'),
  field('valid_from', 'timestamp', 'history', 'TIMESTAMP'), field('valid_to', 'timestamp', 'history', 'TIMESTAMP'),
  field('is_current', 'boolean', 'history', 'BOOLEAN'), field('change_source', 'text', 'history'), field('changed_by', 'text', 'history')];

const open = (info, options = {}) => openApp(browser, served.base, info, { width: 1440, routes: hubRoutes(options.hub, options.summaries), ...options });
const tileTexts = (page) => page.locator('.kpi').evaluateAll((tiles) => tiles.map((t) => [t.querySelector('.kpi-l').innerText, t.querySelector('.kpi-v').innerText,
  t.querySelector('.kpi-s').innerText]));
const hashOf = (page) => page.evaluate(() => window.location.hash);

test('the header carries the Databricks logo, the hub title and where the open use case sits', async () => {
  const { page, seen, context } = await open(INFO());
  assert.equal(await page.locator('.mark-t b').innerText(), 'Contoso Retail - Databricks Inspire Use Cases Hub');
  assert.equal(await page.locator('.mark-t small').innerText(), 'Pricing › Markdown control');
  assert.doesNotMatch(await page.locator('header.top').innerText(), /\bN\d\d-U\d\d\b/, 'the header shows no use case id (must-exclude)');
  const logo = await page.locator('.mark-tile.logo img').getAttribute('src');
  assert.match(logo, /^data:image\/png;base64,/);
  assert.equal(await page.evaluate(() => document.querySelector('link[rel="icon"]').href), logo);
  assert.equal(await page.evaluate(() => document.title), 'Price-loss decision desk · Contoso Retail - Databricks Inspire Use Cases Hub');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the switcher lists each use case with its status and hides a use case the viewer may not read, and the rail lists the sections', async () => {
  const { page, seen, context } = await open(INFO());
  await page.locator('[data-switcher]').click();
  await page.waitForFunction(() => document.querySelector('.switch-i small.warn'));
  const items = await page.locator('.switch-i .switch-t').evaluateAll((all) => all.map((t) => [t.querySelector('b').innerText, t.querySelector('small')?.innerText,
    t.querySelector('small')?.className || '']));
  assert.deepEqual(items, [['Price-loss decision desk', '3 to fix', ''], ['Second desk 1', '2 to fix', ''], ['Second desk 2', 'Not updated', 'bad'], ['Second desk 3', 'Not ready yet', 'warn']]);
  assert.equal(await page.locator('.switch-i[aria-selected="true"] .switch-t b').innerText(), 'Price-loss decision desk');
  await page.keyboard.press('Escape');
  assert.deepEqual(await page.locator('[data-rail]').evaluateAll((all) => all.map((r) => r.dataset.rail)), ['dashboard', 'work', 'performance', 'runs', 'settings']);
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.deepEqual(seen.hub.find((body) => !body.page), { window: 'all', time_zone: zone }, 'the hub reads every use case in one request, in the All open window and the time zone of the browser');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a record link opens that record on its use case page, and closing it takes the record out of the link', async () => {
  const { page, seen, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: hubRoutes() });
  await page.goto(`${served.base}#/n01_u05?rec=R002`);
  await page.waitForFunction(() => /^#\/n01_u05\/work\?.*rec=R002/.test(location.hash));
  const panel = page.locator('dialog.drawer[open]');
  await page.waitForFunction(() => document.querySelector('dialog.drawer[open] h2')?.textContent === 'Item number 2 with a long descriptive name');
  await panel.locator('.panel-h [aria-label="Close"]').click();
  await panel.waitFor({ state: 'detached' });
  assert.match(await hashOf(page), /^#\/n01_u05/);
  assert.doesNotMatch(await hashOf(page), /rec=/);
  await idle(page);
  assert.equal(await page.locator('dialog.drawer[open]').count(), 0, 'the closed record stays closed');
  await page.goto(`${served.base}#/n02_u01?rec=c`);
  await page.waitForFunction(() => document.querySelector('dialog.drawer[open] h2')?.textContent === 'Supplier 3381, invoice 77188');
  assert.deepEqual(seen.history.at(-1), { page: 'n02_u01', record_key: 'c' }, 'a record off the first page of the list loads by its key');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('on a use case page the AI reason narrows the list too, a row asks Genie about its record, and the panel questions wait while Genie answers', async () => {
  const routes = hubRoutes();
  let hold = true;
  routes['genie/ask'] = ({ route, json, seen }) => { seen.asks.push(route.request().postDataJSON()); return json(200, { conversation_id: 'c1', message_id: 'm1' }); };
  routes['genie/message'] = ({ json }) => json(200, hold ? { state: 'running', step: 'Writing the SQL' }
    : { state: 'done', text: 'Genie answered.', sql: 'SELECT 1', columns: [], rows: [], truncated: false });
  const { page, seen, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes });
  await page.goto(`${served.base}#/n01_u05/dashboard`);
  await page.waitForFunction(() => document.querySelectorAll('[data-bars="by_reason"] .hb').length === 3);
  await page.locator('[data-bars="by_reason"] .hb', { hasText: 'Price below cost' }).click();
  await page.locator('[data-rail="work"]').click();
  await until(() => seen.records.at(-1)?.ai?.ai_cat_driver?.[0] === 'Price below cost');
  assert.deepEqual(seen.records.at(-1).ai, { ai_cat_driver: ['Price below cost'] });
  await page.locator('[data-rail="dashboard"]').click();
  await page.locator('[data-bars="by_reason"] .hb.is-on').click();
  await page.locator('[data-rail="work"]').click();
  await until(() => Object.keys(seen.records.at(-1)?.ai || { x: 1 }).length === 0);
  await page.waitForFunction(() => document.querySelectorAll('[data-work] .card--table tbody tr').length);
  const list = page.locator('.card--table');
  await list.getByRole('button', { name: 'Ask Genie about Item number 2 with a long descriptive name' }).click();
  await page.locator('aside.genie').waitFor();
  assert.equal(await page.locator('.g-chip-t').innerText(), 'About: Item number 2 with a long descriptive name');
  assert.equal(await page.locator('dialog.drawer[open]').count(), 0, 'the row button does not open the record');
  await page.locator('aside.genie .g-sugg .sugg').first().click();
  await until(() => seen.asks.length === 1);
  assert.equal(seen.asks[0].record_key, 'R002');
  await list.locator('.cell-t').first().click();
  const panel = page.locator('dialog.drawer[open]');
  await panel.waitFor();
  const waiting = await panel.locator('.g-sugg .sugg').evaluateAll((els) => els.map((e) => e.disabled));
  assert.ok(waiting.length > 0 && waiting.every(Boolean), 'the panel questions wait while Genie is answering');
  hold = false;
  await page.waitForFunction(() => [...document.querySelectorAll('dialog.drawer[open] .g-sugg .sugg')].every((e) => !e.disabled));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const JOINED_NOTE = 'Ask Genie is off on this page because it joined this App before each use case had its own Genie Agent here. Build this use case again with Vibe/Add/Remove Features on Inspire\'s Build page to turn Ask Genie on.';
const withJoined = () => {
  const info = INFO();
  info.pages[2].genie = { enabled: false, title: '', url: '', note: JOINED_NOTE };
  return info;
};

function pageGenie() {
  const routes = hubRoutes();
  routes['genie/ask'] = ({ route, json, seen }) => {
    const body = route.request().postDataJSON();
    seen.asks.push(body);
    return json(200, { conversation_id: `c-${body.page}`, message_id: `m${seen.asks.length}` });
  };
  routes['genie/message'] = ({ json, url }) => json(200, { state: 'done', text: `Answer from ${url.searchParams.get('page')}`, sql: 'SELECT 1', columns: [], rows: [], truncated: false });
  return routes;
}

test("Genie's answer table shows each zip code as written and each count in full, matching the answer text", async () => {
  const routes = pageGenie();
  const rows = [[10001, 1227], [10003, 1189], [10011, 1104], [10016, 1043], [10018, 1012]];
  routes['genie/message'] = ({ json }) => json(200, {
    state: 'done', text: 'The top zip is 10001 with 1,227 trips.', sql: 'SELECT 1', truncated: false,
    columns: [{ name: 'PICKUP_ZIP', type: 'INT' }, { name: 'TRIP_COUNT', type: 'BIGINT' }],
    rows: rows.map(([zip, n]) => ({ PICKUP_ZIP: zip, TRIP_COUNT: n })),
  });
  const { page, seen, context } = await openApp(browser, served.base, withJoined(), { width: 1440, routes });
  await page.goto(`${served.base}#/n01_u05`);
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Price-loss decision desk');
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  await page.getByLabel('Your question').fill('Which 5 pickup zip codes have the most trips?');
  await page.getByRole('button', { name: 'Send' }).click();
  const table = page.locator('aside.genie .msg-t table');
  await table.waitFor({ timeout: 15000 });
  const cells = await table.locator('tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.textContent.trim())));
  assert.deepEqual(cells.map((r) => r.slice(-2)), rows.map(([zip, n]) => [String(zip), n.toLocaleString('en-US')]));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test("an answer whose table could not load says so in plain words with the code under Details, and Try again reads the answer again", async () => {
  const routes = pageGenie();
  let reads = 0;
  routes['genie/message'] = ({ json }) => {
    reads += 1;
    const base = { state: 'done', text: 'The top zip is 10001.', sql: 'SELECT 1', truncated: false };
    return json(200, reads === 1
      ? { ...base, columns: [], rows: [], result_error: 'PERMISSION_DENIED: User does not have SELECT on table main.trips.raw' }
      : { ...base, columns: [{ name: 'PICKUP_ZIP', type: 'INT' }], rows: [{ PICKUP_ZIP: 10001 }] });
  };
  const { page, seen, context } = await openApp(browser, served.base, withJoined(), { width: 1440, routes });
  await page.goto(`${served.base}#/n01_u05`);
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Price-loss decision desk');
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  await page.getByLabel('Your question').fill('Which pickup zip has the most trips?');
  await page.getByRole('button', { name: 'Send' }).click();
  const box = page.locator('aside.genie [data-result-error]');
  await box.waitFor({ timeout: 15000 });
  const shown = await box.innerText();
  assert.match(shown, /^The answer's table could not load: /);
  assert.doesNotMatch(shown, /PERMISSION_DENIED/, 'the code stays under Details (must-exclude)');
  assert.equal(await box.getByRole('button', { name: 'Copy what to send' }).count(), 1);
  await box.getByRole('button', { name: 'Try again' }).click();
  await page.locator('aside.genie .msg-t table').waitFor({ timeout: 15000 });
  assert.equal(await page.locator('aside.genie [data-result-error]').count(), 0);
  assert.equal(seen.asks.length, 1, 'Try again reads the same answer, it never asks Genie again');
  await context.close();
});

test('each use case keeps its own Genie chat with its own Genie Agent, and a page that joined the hub earlier has Ask Genie off with the reason', async () => {
  const { page, seen, context } = await openApp(browser, served.base, withJoined(), { width: 1440, routes: pageGenie() });
  await page.goto(`${served.base}#/n01_u05`);
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Price-loss decision desk');
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  const ask = async (text) => { await page.getByLabel('Your question').fill(text); await page.getByRole('button', { name: 'Send' }).click(); };
  await ask('Which items lose the most?');
  await page.locator('.msg--genie', { hasText: 'Answer from n01_u05' }).waitFor({ timeout: 15000 });
  await pickCase(page, 'Second desk 1');
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  assert.equal(await page.locator('aside.genie .msg').count(), 0, 'another use case starts its own chat');
  await ask('Which invoices repeat?');
  await page.locator('.msg--genie', { hasText: 'Answer from n02_u01' }).waitFor({ timeout: 15000 });
  assert.deepEqual(seen.asks.map((a) => [a.page, a.conversation_id]), [['n01_u05', ''], ['n02_u01', '']], 'a new use case starts a new Genie conversation');
  await pickCase(page, 'Price-loss decision desk');
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Price-loss decision desk');
  assert.deepEqual(await page.locator('aside.genie .msg--you p').allInnerTexts(), ['Which items lose the most?'], 'coming back shows this use case chat only');
  await ask('And last month?');
  await until(() => seen.asks.length === 3);
  assert.deepEqual([seen.asks[2].page, seen.asks[2].conversation_id], ['n01_u05', 'c-n01_u05'], 'the chat goes on in the same Genie conversation');
  await pickCase(page, 'Second desk 2');
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 2');
  await page.locator('aside.genie .g-off').waitFor();
  assert.equal(await page.locator('aside.genie .g-off span').innerText(), JOINED_NOTE);
  assert.equal(await page.getByLabel('Your question').isDisabled(), true);
  await page.waitForFunction(() => document.querySelectorAll('.charts .card').length > 0);
  assert.equal(await page.locator('.explain-btn').count(), 0, 'its charts have no Explain');
  assert.equal(await page.locator('.row-ask').count(), 0, 'its records have no Ask Genie');
  assert.equal(seen.asks.length, 3);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const tableFit = (page) => page.evaluate(() => {
  const wrap = document.querySelector('.tbl--closed').closest('.tbl-wrap');
  const edge = wrap.getBoundingClientRect().right + 1;
  const money = [...document.querySelectorAll('.tbl--closed tbody td.num')];
  return {
    scroll: wrap.scrollWidth - wrap.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    money: money.length === 6 && money.every((td) => td.getBoundingClientRect().right <= edge && td.offsetWidth > 40),
    ask: [...document.querySelectorAll('.tbl--closed tbody .ask-genie')].every((b) => b.getBoundingClientRect().right <= b.closest('td').getBoundingClientRect().right + 0.5),
  };
});

for (const width of [1440, 1024, 390]) {
  test(`the money of every closed record on Performance stays in view without a sideways scroll at ${width} px`, async () => {
    const { page, seen, context } = await open(INFO(), { width, hash: '#/n01_u05/performance' });
    await page.locator('.tbl--closed tbody tr').nth(2).waitFor();
    assert.deepEqual(await tableFit(page), { scroll: 0, page: 0, money: true, ask: true });
    assert.equal(await page.locator('.tbl--closed tbody .ask-genie').count(), 3, 'each closed record keeps its Ask Genie in view');
    assert.deepEqual(await page.locator('.tbl--closed tbody td.num').allInnerTexts().then((t) => t.filter((x) => x.trim()).length), 3);
    assert.deepEqual(seen.errors, []);
    await context.close();
  });
}

test('a use case counted in late shipments names its tiles in that unit and its saved tile with its verb, never money', async () => {
  const counted = { ...SUMMARIES, n01_u05: { ...SUMMARIES.n01_u05, run: run({ currency: '', unit: 'late shipments', impact_kind: 'count' }) } };
  const { page, seen, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: hubRoutes(HUB, counted) });
  await page.goto(`${served.base}#/n01_u05`);
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Price-loss decision desk' && document.querySelectorAll('.kpi-v').length === 4);
  const tiles = await tileTexts(page);
  assert.deepEqual(tiles.map((t) => t[0]), ['To fix', 'Could save', 'Fixed so far', 'Avoided so far']);
  assert.deepEqual([tiles[1][1], tiles[3][1]], ['21,600 late shipments', '9,750 late shipments']);
  assert.ok(!/\$|money/i.test(JSON.stringify(tiles)), JSON.stringify(tiles));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a use case dashboard leads with its area, title, AI summary, four tiles, the AI reason filter and its charts, and Notify me sits in Settings', async () => {
  const { page, seen, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: hubRoutes() });
  await page.goto(`${served.base}#/n01_u05`);
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Price-loss decision desk' && document.querySelectorAll('.kpi-v').length === 4);
  assert.equal(await page.locator('.top .mark-t small').innerText(), 'Pricing › Markdown control');
  assert.doesNotMatch(await page.locator('body').innerText(), /\bN\d\d-U\d\d\b/, 'no use case id shows on the page');
  assert.match(await page.locator('.sum').innerText(), /^AI summary\s+Deep discounts on winter wear are losing margin without selling more\.\s+Ask Genie$/);
  assert.deepEqual(await tileTexts(page), [
    ['To fix', '3', '2 of them are yours'], ['Could save', '$21,600', 'Money at stake on the 3 things to fix, added up'],
    ['Fixed so far', '12', 'since Sep 1'], ['Saved so far', '$9,750', 'Money at stake when fixed, less what a later run still finds, on 9 fixes a later run confirmed']]);
  assert.equal(await page.locator('.fbar .fld > span').first().innerText(), 'REASON (FROM AI)');
  assert.deepEqual(await page.locator('.fbar .fld > span').allInnerTexts(), ['REASON (FROM AI)', 'RUN DATE', 'CATEGORY', 'CHANNEL', 'REGION', 'OWNER', 'SHOW']);
  assert.deepEqual(await page.locator('[data-bars="by_reason"] .hb').allInnerTexts(), ['Discount too deep\n$8,400 on 1 record', 'Price below cost\n$7,200 on 1 record',
    'Stock in the wrong store\n$6,000 on 1 record']);
  await page.waitForFunction(chartsDrawn, 4);
  assert.deepEqual(await page.locator('section.charts:not(.charts--more) > *').evaluateAll((cards) => cards.map((c) => c.dataset.bars || c.dataset.card)),
    ['by_reason', 'loss_trend'], 'the reasons sit next to the page trend chart');
  assert.deepEqual(await page.locator('[data-drivers] [data-card]').evaluateAll((cards) => cards.map((c) => c.dataset.card)), ['by_category'],
    'the Drivers chart sits under its heading');
  assert.deepEqual(await page.locator('.charts--more [data-card]').evaluateAll((cards) => cards.map((c) => c.dataset.card)), ['channel_mix', 'pareto']);
  assert.equal(await page.locator('[data-page-section="dashboard"] .card--list').count(), 0, 'the records sit in Work, not on the dashboard');
  assert.equal(await page.locator('.story').count(), 0);
  assert.equal(await page.locator('.ph-q').count(), 0);
  await page.locator('[data-rail="settings"]').click();
  const notify = page.locator('[data-settings]').getByRole('link', { name: 'Notify me' });
  assert.equal(await notify.getAttribute('href'), 'https://example.com/sql/alerts');
  assert.equal(await notify.getAttribute('target'), '_blank');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const pageOrder = (page) => page.evaluate(() => {
  const main = document.querySelector('main .page');
  const box = (el) => el.getBoundingClientRect();
  const seen = (el) => box(el).height > 0 && getComputedStyle(el).display !== 'none';
  const charts = [...main.querySelectorAll('[data-card], [data-bars]')].filter(seen);
  const tables = [...main.querySelectorAll('.card--table')].filter((el) => seen(el) && el.getAttribute('aria-label') !== 'Your work');
  const parts = [...main.children].flatMap((el) => (el.matches('[data-work]') ? [...el.children] : [el])).filter(seen);
  const lowest = Math.max(...parts.map((el) => box(el).bottom));
  return {
    charts: charts.length, tables: tables.length,
    above: tables.length > 0 && charts.every((c) => box(c).bottom <= box(tables[0]).top + 1),
    last: parts.at(-1)?.matches('.card--table') === true && box(parts.at(-1)).bottom >= lowest - 1,
    label: parts.at(-1)?.getAttribute('aria-label') || parts.at(-1)?.className || '',
  };
});

const orderRun = (id, started, toFix) => ({ run_id: id, job_run_id: null, url: '', started, ended: null, duration_s: 120, status: 'done', trigger: 'schedule', by: '',
  segments: null, tables: null, records: 40, to_fix: toFix, could_save: null, currency: '', summary: '', nothing_to_act: '', error: '' });
const ORDER_RUNS = { runs: [orderRun('u2', '2026-10-20T06:00:00Z', 3), orderRun('u1', '2026-10-13T06:00:00Z', 5)], total: 2, offset: 0, limit: 20, job: null, errors: {} };

test('charts sit on the dashboard and the records table is the last part of Work and Runs, wide and narrow', async () => {
  for (const width of [1440, 375]) {
    const { page, seen, context } = await open(INFO(), { width, routes: { ...hubRoutes(), runs: ({ json }) => json(200, ORDER_RUNS) } });
    const where = `${width} px`;
    await page.goto(`${served.base}#/n01_u05/dashboard`);
    await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Price-loss decision desk');
    await page.waitForFunction(chartsDrawn, 4);
    const dashboard = await pageOrder(page);
    assert.ok(dashboard.charts >= 5, `${where}: the dashboard shows every chart of the use case`);
    await goRail(page, 'work');
    await page.waitForSelector('[data-work] .card--table tbody tr');
    const work = await pageOrder(page);
    assert.ok(work.tables >= 1 && work.last, `${where}: Work ends with its records table, not ${work.label}`);
    await goRail(page, 'runs');
    await page.waitForSelector('[data-bars="to_fix_runs"] .vb-c');
    const runs = await pageOrder(page);
    assert.ok(runs.charts >= 1 && runs.above, `${where}: the To fix per run chart sits above the runs table`);
    assert.ok(runs.last, `${where}: the Runs view ends with its table, not ${runs.label}`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
  for (const [width, history] of [[1440, true], [375, true], [1440, false], [375, false]]) {
    const info = appInfo({ business: 'Contoso Retail' }, 1, TABLE);
    if (!history) info.pages[0].history = null;
    const { page, seen, context } = await open(info, { width });
    const where = `${width} px, a one use case App ${history ? 'with' : 'without'} record history`;
    await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Price-loss decision desk');
    await page.waitForFunction(chartsDrawn, 4);
    assert.ok((await pageOrder(page)).charts >= 4, `${where}: the dashboard shows the charts`);
    await goRail(page, 'work');
    await page.waitForSelector('[data-work] .card--table');
    const work = await pageOrder(page);
    assert.ok(work.last, `${where}: Work ends with its table, not ${work.label}`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('a use case whose last run wrote no AI summary says so in place of the summary', async () => {
  const { page, seen, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: hubRoutes() });
  await page.goto(`${served.base}#/n02_u01`);
  await page.locator('.no-sum').waitFor();
  assert.equal(await page.locator('.no-sum').innerText(), 'The last run wrote no AI summary.');
  assert.equal(await page.locator('.sum').count(), 0);
  await page.goto(`${served.base}#/n01_u05`);
  await page.locator('.sum').waitFor();
  assert.equal(await page.locator('.no-sum').count(), 0, 'a run with its summary shows the summary only');
  assert.deepEqual(seen.errors, []);
  await context.close();
  const unwritten = { ...SUMMARIES, n02_u01: { run: null, categories: {}, note: 'no run of this use case has written its summary yet' } };
  const fresh = await open(INFO(), { summaries: unwritten });
  await fresh.page.goto(`${served.base}#/n02_u01`);
  await fresh.page.locator('.no-sum').waitFor();
  assert.equal(await fresh.page.locator('.no-sum').innerText(), 'No run has written an AI summary yet.');
  assert.equal(await fresh.page.locator('.sum').count(), 0);
  assert.deepEqual(fresh.seen.errors, []);
  await fresh.context.close();
});

test('a click on a reason bar filters the use case page by that AI reason and a second click clears it', async () => {
  const { page, seen, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: hubRoutes() });
  await page.goto(`${served.base}#/n01_u05`);
  await page.waitForFunction(() => document.querySelectorAll('[data-bars="by_reason"] .hb').length === 3);
  await page.locator('[data-bars="by_reason"] .hb', { hasText: 'Price below cost' }).click();
  await page.waitForFunction(() => document.querySelector('[data-tile="fix"] .kpi-v')?.textContent === '1');
  assert.deepEqual(seen.hub.at(-1).ai, { ai_cat_driver: ['Price below cost'] });
  assert.equal(seen.hub.at(-1).page, 'n01_u05');
  assert.equal(await page.locator('.chip').innerText(), 'Reason (from AI): Price below cost');
  assert.equal(await page.locator('[data-bars="by_reason"] .hb.is-on').innerText(), 'Price below cost\n$7,200 on 1 record');
  await page.locator('[data-bars="by_reason"] .hb.is-on').click();
  await page.waitForFunction(() => document.querySelector('[data-tile="fix"] .kpi-v')?.textContent === '3');
  assert.deepEqual(seen.hub.at(-1).ai, {});
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a use case that is not updated or not ready says so in plain words, and one with nothing to act on says why', async () => {
  const summaries = { ...SUMMARIES, n02_u01: { run: run({ nothing_to_act: 'No record has 5,000 USD or more at stake, the amount this use case reviews from.' }), categories: {}, note: '' } };
  const hub = { ...HUB, pages: { ...HUB.pages, n02_u01: entry([]) } };
  const { page, seen, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: hubRoutes(hub, summaries) });
  await page.goto(`${served.base}#/n02_u02`);
  await page.waitForSelector('.uc-status.is-bad');
  assert.equal(await page.locator('.uc-status.is-bad').innerText(), 'Not updated since Oct 10\nThe update planned for Oct 17 has not run. Its results are from Oct 10.');
  await page.waitForFunction(() => document.querySelectorAll('.kpi-v').length === 2);
  assert.deepEqual((await tileTexts(page)).map((t) => t[0]), ['Fixed so far', 'Saved so far']);
  await page.goto(`${served.base}#/n02_u03`);
  await page.waitForSelector('.uc-status.is-wait');
  assert.equal(await page.locator('.uc-status.is-wait').innerText(),
    'Not ready yet\nNothing to act on yet, because the forecast is still learning and is not accurate enough to act on. It is checked again on Oct 27.');
  assert.equal(await page.locator('.ph ~ .kpis, .ph ~ .charts:not(.charts--more)').count(), 0, 'a use case that is not ready shows no numbers to act on');
  await page.locator('.ph ~ .fbar').waitFor();
  await page.waitForFunction(chartsDrawn, 4);
  assert.deepEqual(await page.locator('.charts--more [data-card], [data-drivers] [data-card]').evaluateAll((cards) => cards.map((c) => c.dataset.card)),
    ['loss_trend', 'channel_mix', 'pareto', 'by_category'], 'every chart of the page still shows, the trend first and the Drivers chart under its heading');
  assert.ok(await page.evaluate(() => {
    const [bar, charts] = ['.ph ~ .fbar', '.charts--more'].map((s) => document.querySelector(s).getBoundingClientRect());
    return bar.bottom <= charts.top;
  }), 'the filters come first, then the charts');
  await page.goto(`${served.base}#/n02_u01`);
  await page.waitForSelector('[data-nothing-fix] [data-nothing]');
  assert.equal(await page.locator('[data-nothing-fix] [data-nothing]').innerText(), 'Nothing to act on yet, because no record has 5,000 USD or more at stake, the amount this use case reviews from.');
  assert.equal(await page.locator('.uc-status').count(), 0, 'nothing to act on is not a status warning');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a use case with no money recorded says Not measured yet instead of an amount, and still counts what is to fix', async () => {
  const bare = JSON.parse(JSON.stringify(HUB));
  Object.values(bare.pages).forEach((e) => { if (e.tracked) Object.assign(e, { money: false, weeks: [] }); e.items?.forEach((i) => { i.money = null; }); });
  const { page, seen, context } = await open(INFO(), { hub: bare, hash: '#/n01_u05/dashboard' });
  await page.waitForFunction(() => document.querySelectorAll('.kpi-v').length === 4);
  const tiles = (await tileTexts(page)).map((t) => t[1]);
  assert.deepEqual([tiles[0], tiles[1], tiles[3]], ['3', 'Not measured yet', 'Not measured yet']);
  assert.equal(await page.locator('[data-bars="by_reason"] .empty').innerText(), 'Not measured yet');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('due dates read as today, late, tomorrow or the weekday, and owners as names', () => {
  assert.deepEqual(dueText(TODAY, TODAY), { text: 'Today', late: false });
  assert.deepEqual(dueText('2026-10-22', TODAY), { text: '2 days late', late: true });
  assert.deepEqual(dueText('2026-10-23', TODAY), { text: '1 day late', late: true });
  assert.deepEqual(dueText('2026-10-25', TODAY), { text: 'Tomorrow', late: false });
  assert.deepEqual(dueText('2026-10-30T00:00:00Z', TODAY), { text: 'Fri, Oct 30', late: false });
  assert.deepEqual(dueText(null, TODAY), { text: 'No date', late: false, none: true });
  assert.equal(ownerName(ME), 'Pat Lee');
  assert.equal(ownerName('Ana Diaz'), 'Ana Diaz');
  assert.equal(ownerName(''), '');
  assert.equal(isMine(' PAT.LEE@EXAMPLE.COM ', { email: ME }), true);
  assert.equal(isMine(SAM, { email: ME }), false);
  assert.equal(isMine(null, { email: ME }), false);
  assert.equal(isMine('', { email: '' }), false, 'an unsigned viewer owns nothing');
});

test('the list puts my things first, then the biggest saving, and the Show filter keeps only the tiers it names', () => {
  const rows = [item('x', 'X', 'Act now', 10), item('y', 'Y', 'Act now', null), item('z', 'Z', 'Act now', 5, { owner: ME }), item('r', 'R', 'Review', 99)];
  assert.deepEqual(sortThings(rows, { email: ME }).map((r) => r.key), ['z', 'r', 'x', 'y']);
  const fixed = viewRows(rows, DEFAULT_VIEW, { email: ME });
  assert.deepEqual([fixed.fix.map((r) => r.key), fixed.shown.map((r) => r.key)], [['x', 'y', 'z'], ['z', 'x', 'y']]);
  assert.deepEqual(viewRows(rows, { owner: 'none', show: 'all' }, { email: ME }).shown.map((r) => r.key), ['r', 'x', 'y']);
});

test('money adds up per currency and never invents one', () => {
  assert.equal(wholeMoney(39250, 'USD'), '$39,250');
  assert.equal(wholeMoney(1234.6, ''), '1,235');
  assert.equal(moneyText(totals([{ money: 100, currency: 'USD' }, { money: 50, currency: 'EUR' }, { money: 25, currency: 'USD' }, { money: null, currency: 'USD' }])), '$125 + €50');
  assert.equal(moneyText(totals([])), '0');
});

test('the status line reads not updated, not ready yet or the count to fix, in that order', () => {
  const tracked = { tracked: true, items: [item('a', 'A', 'Act now', 1), item('b', 'B', 'Review', 1)], runs: { ...RUNS } };
  assert.deepEqual(useCaseState(tracked, SUMMARIES.n01_u05), { kind: 'fix', text: '1 to fix' });
  assert.equal(useCaseState({ ...tracked, runs: { ...RUNS, failed: true } }).reason, 'The last update failed. Its results are from Oct 20.');
  assert.equal(useCaseState({ ...tracked, runs: { ...RUNS, stale: true } }, SUMMARIES.n02_u03).text, 'Not updated');
  assert.equal(useCaseState(tracked, SUMMARIES.n02_u03).text, 'Not ready yet');
  assert.equal(useCaseState(tracked, { run: run({ nothing_to_act: 'No record passed.' }) }).text, '1 to fix', 'a measured use case is ready even with nothing to act on');
  assert.deepEqual(useCaseState({ visible: true, tracked: false, empty: true }).text, 'Not ready yet');
  assert.equal(useCaseState({ visible: false }).kind, 'hidden');
  assert.equal(useCaseState(undefined).kind, 'loading');
});

test('the reason filter labels the first AI category Reason (from AI) and offers its values, and a bar click toggles one reason', () => {
  const filters = reasonFilters({ categories: ['ai_cat_driver', 'ai_cat_fix'], items: [item('a', 'A', 'Act now', 1, { reason: 'Seasonal' })] },
    { categories: { ...CATEGORIES, ai_cat_fix: { meaning: 'what fixes it', values: ['Reprice'] } } });
  assert.deepEqual(filters, [
    { name: 'ai_cat_driver', label: 'Reason (from AI)', options: ['Discount too deep', 'Price below cost', 'Stock in the wrong store', 'Seasonal', 'Not explained yet'] },
    { name: 'ai_cat_fix', label: 'What fixes it (from AI)', options: ['Reprice', 'Not explained yet'] }]);
  const once = pickReason({ range: {}, sel: {} }, 'ai_cat_driver', 'Seasonal');
  assert.deepEqual(once.ai, { ai_cat_driver: ['Seasonal'] });
  assert.deepEqual(pickReason(once, 'ai_cat_driver', 'Seasonal').ai, {});
  assert.deepEqual(reasonFilters(undefined, undefined), []);
});

test('nothing to act on reads as one plain sentence', () => {
  assert.equal(nothingText('No record passed the decision test.'), 'Nothing to act on yet, because no record passed the decision test.');
  assert.equal(nothingText('AUC was 0.51.'), 'Nothing to act on yet, because AUC was 0.51.');
  assert.equal(nothingText(''), '');
});

test('the filters read as words', () => {
  assert.equal(viewWords(DEFAULT_VIEW), 'Owner: Everyone; Show: To fix');
  assert.equal(viewWords({ owner: 'me', show: 'all' }, [{ name: 'ai_cat_driver', label: 'Reason (from AI)' }, { name: 'ai_cat_fix', label: 'Fix (from AI)' }],
    { ai: { ai_cat_driver: ['Price below cost', 'Seasonal'] } }), 'Owner: Me; Show: To fix and worth a look; Reason (from AI): Price below cost, Seasonal');
});

function explainHub() {
  const calls = { explain: [] };
  let release = false;
  const routes = {
    ...hubRoutes(),
    'genie/explain': ({ route, json }) => { calls.explain.push(route.request().postDataJSON()); return json(200, { conversation_id: 'c1', message_id: `m${calls.explain.length}`, question: 'Sent.' }); },
    'genie/message': ({ json }) => json(200, release ? { state: 'done', text: 'It adds up.', sql: 'SELECT 1', columns: [], rows: [], truncated: false }
      : { state: 'running', step: 'Writing the SQL' }),
  };
  return { calls, routes, release: () => { release = true; } };
}

async function askRow(page, calls, scope, name, question) {
  await scope.getByRole('button', { name: `Ask Genie about ${name}`, exact: true }).click();
  await page.getByLabel(`Your question about ${name}`).fill(question);
  await page.locator('form.ask-box button[type="submit"]').click();
  await until(() => calls.explain.length > 0);
  return calls.explain.pop();
}

test('every card, key number and row on Performance and on a Runs view shows a visible Ask Genie, and each row sends Genie its own record', async () => {
  const { calls, routes, release } = explainHub();
  release();
  const { page, seen, context } = await open(INFO(), { routes: { ...routes, runs: ({ json }) => json(200, ORDER_RUNS) }, hash: '#/n01_u05/performance' });
  await page.locator('[data-overdue-row]').first().waitFor();
  await page.locator('.tbl--closed tbody tr').first().waitFor();
  const perf = await page.evaluate(askAudit, ASK_GROUPS);
  assert.deepEqual([perf.missing, perf.hidden], [[], []], 'Performance: 0 missing, 0 hidden');
  assert.ok(perf.counts.row >= 6, JSON.stringify(perf.counts));
  const overdue = page.getByRole('region', { name: 'Overdue items you own' });
  assert.equal(await overdue.locator('tbody .row-ask').count(), 3, 'with Genie on, each overdue record asks about itself, like a thing to fix');
  await overdue.getByRole('button', { name: 'Ask Genie about Leather boots, store 2', exact: true }).click();
  assert.equal(await page.locator('.g-chip-t').innerText(), 'About: Leather boots, store 2');
  assert.match(await page.locator('aside.genie .g-h small').innerText(), /^Answers from the Genie Agent/);
  await page.getByRole('button', { name: 'Stop asking about Leather boots, store 2' }).click();
  assert.equal(calls.explain.length, 0);
  await page.goto(`${served.base}#/n01_u05/dashboard`);
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Price-loss decision desk');
  await page.locator('[data-rail="runs"]').click();
  await page.locator('.runs-tbl tbody tr').first().waitFor();
  const runs = await page.evaluate(askAudit, ASK_GROUPS);
  assert.deepEqual([runs.missing, runs.hidden, runs.counts.row], [[], [], 2], 'the Runs view: 0 missing, 0 hidden');
  const name = await page.locator('.runs-tbl tbody tr').first().locator('.ask-genie').getAttribute('aria-label');
  const one = await askRow(page, calls, page.locator('.runs-tbl tbody tr').first(), name.replace('Ask Genie about ', ''), 'Why did it find 3?');
  assert.deepEqual([one.kind, one.page, one.context.hint, one.context.fields.Status, one.context.fields.Records, one.context.fields['To fix'], one.context.fields.When],
    ['record', 'n01_u05', 'A run of this use case.', 'Done', 40, 3, '2026-10-20T06:00:00Z']);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Ask Genie on a record of another use case from Performance keeps that record: the chip stays, the question names it, and only leaving for a third use case clears it', async () => {
  const other = { page: 'n02_u01', key: 'c', label: 'Supplier 3381, invoice 77188', kind: 'status', status: 'Done', at: '2026-10-22T06:00:00Z' };
  const routes = {
    ...hubRoutes(),
    my_work: ({ route, json }) => {
      const body = route.request().postDataJSON();
      const items = OVERDUE[body.page] || [];
      return json(200, myWorkOf(body.page, { overdue: { n: items.length, items } }, body.page === 'n01_u05' ? [other] : []));
    },
  };
  const { page, seen, context } = await open(INFO(), { routes, hash: '#/n01_u05/performance' });
  const did = page.getByRole('region', { name: 'What you did' });
  await did.locator('tbody tr').first().waitFor();
  await did.getByRole('button', { name: `Ask Genie about ${other.label}`, exact: true }).click();
  await page.locator('aside.genie').waitFor();
  await idle(page);
  assert.equal(await page.locator('.g-chip-t').count(), 1, 'the record chip stays while Performance of another use case is open');
  assert.equal(await page.locator('.g-chip-t').innerText(), `About: ${other.label}`);
  assert.equal(await page.getByLabel('Your question').getAttribute('placeholder'), `Ask about ${other.label}`);
  assert.match(await page.locator('aside.genie .g-h small').innerText(), /^Answers from the Genie Agent "Second desk 1"/, 'the Genie Agent of the record\'s use case answers');
  await page.locator('aside.genie .g-sugg .sugg').first().click();
  await until(() => seen.asks.length === 1);
  assert.deepEqual([seen.asks[0].page, seen.asks[0].record_key], ['n02_u01', 'c'], 'Genie of the record\'s own use case is asked about that record');
  await page.locator('aside.genie .msg--genie').waitFor();
  assert.equal(await page.locator('aside.genie .msg-about').first().innerText(), `About: ${other.label}`);
  assert.match(await hashOf(page), /^#\/n01_u05\/performance/);
  await page.evaluate(() => { window.location.hash = '#/n02_u01/dashboard'; });
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  assert.equal(await page.locator('.g-chip-t').innerText(), `About: ${other.label}`, 'opening the record\'s own use case keeps the chip');
  await page.evaluate(() => { window.location.hash = '#/n02_u02/dashboard'; });
  await page.locator('.g-chip').waitFor({ state: 'detached' });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a record of a use case with Ask Genie off still shows Ask Genie on Performance, and it opens the panel on why with nothing sent', async () => {
  const { calls, routes } = explainHub();
  const info = INFO();
  info.pages[0].genie = { enabled: false, title: '', url: '', note: 'The Genie Agent of this use case did not build.' };
  const { page, seen, context } = await open(info, { routes, hash: '#/n01_u05/performance' });
  await page.locator('[data-overdue-row]').first().waitFor();
  const found = await page.evaluate(askAudit, ASK_GROUPS);
  assert.deepEqual([found.missing, found.hidden], [[], []]);
  const overdue = page.getByRole('region', { name: 'Overdue items you own' });
  assert.deepEqual([await overdue.locator('tbody .row-ask').count(), await overdue.locator('tbody .ask-genie').count()], [0, 3], 'its 3 records keep a visible Ask Genie');
  await overdue.getByRole('button', { name: 'Ask Genie about Leather boots, store 2', exact: true }).click();
  await page.locator('aside.genie').waitFor();
  assert.equal(await page.locator('form.ask-box').count(), 0);
  assert.equal(calls.explain.length, 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
  const on = await open(info, { routes, hash: '#/n02_u01/performance' });
  await on.page.locator('[data-overdue-row]').first().waitFor();
  assert.equal(await on.page.getByRole('region', { name: 'Overdue items you own' }).locator('tbody .row-ask').count(), 1, 'a use case with Genie on asks about its record');
  assert.deepEqual(on.seen.errors, []);
  await on.context.close();
});

test('the Performance charts explain with the Genie of their own use case, wait while it answers, and have no Explain while Ask Genie is off', async () => {
  const { calls, routes, release } = explainHub();
  const { page, seen, context } = await open(INFO(), { routes, hash: '#/n01_u05/performance' });
  await page.locator('[data-bars="weekly_closed"] .vb').first().waitFor();
  const buttons = page.locator('.charts .explain-btn');
  assert.ok(await buttons.count() >= 1);
  await page.locator('[data-bars="weekly_closed"] .explain-btn').click();
  await until(() => calls.explain.length === 1);
  const weeks = calls.explain[0];
  assert.deepEqual([weeks.kind, weeks.page, weeks.title, weeks.context.x, weeks.context.measures],
    ['chart', 'n01_u05', 'Items you closed, by week', 'Week', ['Items']]);
  await page.locator('aside.genie .g-step').waitFor();
  assert.equal(await page.locator('.msg--you').last().locator('p').innerText(), 'Explain \u201cItems you closed, by week\u201d');
  assert.ok((await buttons.evaluateAll((els) => els.map((e) => [e.disabled, e.title]))).every(([d, t]) => d && t === 'Genie is still answering'));
  release();
  await page.locator('.msg-sql').waitFor({ timeout: 15000 });
  assert.ok((await buttons.evaluateAll((els) => els.map((e) => e.disabled))).every((d) => !d));
  assert.deepEqual(seen.errors, []);
  await context.close();
  const info = INFO();
  info.pages[0].genie = { enabled: false, title: '', url: '', note: 'The Genie Agent of this use case did not build.' };
  const off = await open(info, { hash: '#/n01_u05/performance' });
  await off.page.locator('[data-bars="weekly_closed"] .vb').first().waitFor();
  assert.equal(await off.page.locator('.explain-btn').count(), 0, 'no Explain while Ask Genie is off');
  assert.deepEqual(off.seen.errors, []);
  await off.context.close();
});

test('Explain on the reasons chart sends the page filters, the Owner and Show filters and the picked reason', async () => {
  const { calls, routes } = explainHub();
  const { page, seen, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes });
  await page.goto(`${served.base}#/n01_u05`);
  await page.waitForFunction(() => document.querySelectorAll('[data-bars="by_reason"] .hb').length === 3);
  await page.locator('[data-bars="by_reason"] .hb', { hasText: 'Price below cost' }).click();
  await page.waitForFunction(() => document.querySelectorAll('[data-bars="by_reason"] .hb').length === 1);
  await page.getByRole('button', { name: 'Explain Could save, by reason' }).click();
  await until(() => calls.explain.length === 1);
  assert.deepEqual(calls.explain[0], { kind: 'chart', page: 'n01_u05', title: 'Could save, by reason', conversation_id: '', context: {
    hint: 'The AI groups each item by reason.', type: 'horizontal_bar', x: 'Reason (from AI)', measures: ['Could save'], row_count: 1, truncated: false,
    filters: 'Run date: Nov 1, 2025 to Oct 15, 2026; Owner: Everyone; Show: To fix; Reason (from AI): Price below cost',
    rows: [{ 'Reason (from AI)': 'Price below cost', 'Could save': 7200, 'Shown as': '$7,200 on 1 record' }] } });
  assert.equal(await page.locator('[data-bars="by_reason"] .card-h p').innerText(), 'The AI groups each item by reason. Click a bar to filter.');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a hub whose Impact screen is off shows no Impact on Performance and its old link opens Performance', async () => {
  const info = appInfo({ business: 'Contoso Retail', screens: { impact: false } }, 5, TABLE);
  assert.deepEqual(info.screens, { runs: true, impact: false, performance: true }, 'the Performance screen is removable, and only Impact is off here');
  const { page, seen, context } = await open(info);
  await page.goto(`${served.base}#/impact`);
  await page.waitForFunction(() => location.hash === '#/n01_u05/performance');
  await page.locator('[data-performance] [data-overdue-row]').first().waitFor();
  assert.equal(await page.locator('[data-rail="performance"]').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('.imp').count(), 0);
  assert.deepEqual(seen.impact || [], [], 'the Impact screen is off, so Performance never asks for it');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a use case whose Runs screen is off shows only Things to fix and never asks for its run history', async () => {
  const info = appInfo({ business: 'Contoso Retail', screens: { runs: false } }, 5, TABLE);
  const { page, seen, context } = await open(info);
  const asked = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/runs') asked.push(r.url()); });
  await page.goto(`${served.base}#/n01_u05?v=runs`);
  await page.waitForFunction(() => location.hash === '#/n01_u05/dashboard');
  await page.locator('[data-page-section="dashboard"]').waitFor();
  assert.equal(await page.locator('[role="tab"]').count(), 0);
  assert.equal(await page.locator('[data-rail="runs"]').count(), 0, 'no Runs section when the Runs screen is off');
  assert.equal(await page.locator('section.runs').count(), 0);
  assert.deepEqual(asked, []);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
