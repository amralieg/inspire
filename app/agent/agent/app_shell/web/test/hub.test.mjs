import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { TABLE, appInfo, chartsDrawn, openApp, serveDist, until } from './harness.mjs';
import { wholeMoney } from '../src/format.js';
import {
  DEFAULT_VIEW, WORK_SHOWN, dueText, hubTimes, isMine, moneyText, myWork, myWorkText, nothingText, ownerName, pickReason, reasonFilters,
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
  };
}

const field = (name, kind, role = 'business', type = 'STRING') => ({ name, kind, role, type, editable: false });
const HISTORY_FIELDS = [field('entity_id', 'text', 'id'), field('entity_label', 'text'), field('priority_tier', 'text'), field('record_key', 'text', 'history'),
  field('valid_from', 'timestamp', 'history', 'TIMESTAMP'), field('valid_to', 'timestamp', 'history', 'TIMESTAMP'),
  field('is_current', 'boolean', 'history', 'BOOLEAN'), field('change_source', 'text', 'history'), field('changed_by', 'text', 'history')];

const open = (info, options = {}) => openApp(browser, served.base, info, { width: 1440, routes: hubRoutes(options.hub, options.summaries), ...options });
const tileTexts = (page) => page.locator('.kpi').evaluateAll((tiles) => tiles.map((t) => [t.querySelector('.kpi-l').innerText, t.querySelector('.kpi-v').innerText,
  t.querySelector('.kpi-s').innerText]));
const whatColumn = (page) => page.locator('.tbl--things tbody tr .it b').evaluateAll((cells) => cells.map((b) => b.firstChild.textContent));
const hashOf = (page) => page.evaluate(() => window.location.hash);

test('the header carries the Databricks logo, the hub title and when the use cases update', async () => {
  const { page, seen, context } = await open(INFO());
  assert.equal(await page.locator('.mark-t b').innerText(), 'Contoso Retail - Databricks Inspire Use Cases Hub');
  await page.waitForFunction(() => document.querySelector('.mark-t small').textContent.startsWith('Updated'));
  assert.equal(await page.locator('.mark-t small').innerText(), 'Updated Oct 20 · next update Oct 27');
  const logo = await page.locator('.mark-tile.logo img').getAttribute('src');
  assert.match(logo, /^data:image\/png;base64,/);
  assert.equal(await page.evaluate(() => document.querySelector('link[rel="icon"]').href), logo);
  assert.equal(await page.evaluate(() => document.title), 'Contoso Retail - Databricks Inspire Use Cases Hub');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the side menu lists the Overview, each use case with its status and the Impact page, and hides a use case the viewer may not read', async () => {
  const { page, seen, context } = await open(INFO());
  await page.waitForFunction(() => document.querySelector('.nav-t small.warn'));
  const items = await page.locator('.side .nav-t').evaluateAll((all) => all.map((t) => [t.querySelector('b').innerText, t.querySelector('small')?.innerText,
    t.querySelector('small')?.className || '']));
  assert.deepEqual(items, [['Overview', 'All use cases', ''], ['My work', 'What you did, and when', ''], ['Impact', 'What the use cases delivered', ''],
    ['Price-loss decision desk', '3 to fix', ''], ['Second desk 1', '2 to fix', ''], ['Second desk 2', 'Not updated', 'bad'], ['Second desk 3', 'Not ready yet', 'warn']],
    'My work sits right below the Overview, and Impact below it');
  assert.equal(await page.locator('.side .side-h').innerText(), 'USE CASES');
  assert.equal(await page.locator('.side .nav-i.is-on .nav-t b').innerText(), 'Overview');
  const zone = await page.evaluate(() => Intl.DateTimeFormat().resolvedOptions().timeZone);
  assert.deepEqual(seen.hub[0], { window: 'all', time_zone: zone }, 'the hub reads every use case in one request, in the All open window and the time zone of the browser');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Overview tiles count the things to fix, their money with its formula, the overdue ones and the measured savings', async () => {
  const { page, seen, context } = await open(INFO());
  assert.equal(await page.locator('.pg-h h1').innerText(), 'Overview');
  assert.deepEqual(await tileTexts(page), [
    ['To fix', '5', '3 of them are yours'],
    ['Could save', '$33,850', 'Money at stake on the 5 things to fix, added up'],
    ['Overdue', '2', 'past their due date'],
    ['Saved this quarter', '$7,100', 'Money at stake when fixed, less what a later run still finds, on 6 fixes a later run confirmed since Oct 1']]);
  assert.equal(await page.locator('[data-tile="late"] .kpi-v').evaluate((el) => el.classList.contains('red')), true);
  assert.deepEqual(await whatColumn(page), ['Blue denim jacket, store 12', 'Supplier 3381, invoice 77188', 'Leather boots, store 2', 'Wool coat, store 4',
    'Supplier 1150, invoice 66102'], 'mine first, then the biggest saving');
  const first = page.locator('.tbl--things tbody tr').first();
  assert.deepEqual(await first.locator('td').allInnerTexts(), [
    'Blue denim jacket, store 12\nIt has been 40% off for 6 weeks and is not selling more, so each week loses about $1,400 of margin.',
    'Price-loss decision desk', 'PL\nPat Lee', 'Today', '$8,400', 'Ask Genie']);
  assert.equal(await page.locator('.tbl--things tbody tr').nth(1).locator('td.late').innerText(), '2 days late');
  assert.equal(await page.locator('.tbl--things tbody tr').nth(3).locator('.owner.is-none').innerText(), 'Nobody yet');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Owner and Show filters narrow the tiles and the list, and Clear filters brings them back', async () => {
  const { page, seen, context } = await open(INFO());
  await page.getByLabel('Owner').selectOption('me');
  assert.deepEqual((await tileTexts(page)).slice(0, 2), [['To fix', '3', '3 of them are yours'], ['Could save', '$21,350', 'Money at stake on the 3 things to fix, added up']]);
  assert.deepEqual(await whatColumn(page), ['Blue denim jacket, store 12', 'Supplier 3381, invoice 77188', 'Leather boots, store 2']);
  await page.getByLabel('Owner').selectOption('none');
  await page.getByLabel('Show').selectOption('all');
  assert.deepEqual(await whatColumn(page), ['Wool coat, store 4', 'Supplier 1150, invoice 66102', 'Linen trousers, store 12']);
  assert.equal(await page.locator('.tbl--things .look').innerText(), 'worth a look');
  await page.getByRole('button', { name: 'Clear filters' }).click();
  assert.equal(await page.locator('.tbl--things tbody tr').count(), 5);
  assert.equal(await page.getByRole('button', { name: 'Clear filters' }).count(), 0);
  assert.deepEqual(seen.hub.length, 1, 'owner and show filter what the page already read');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Overview charts rank the money by use case and open it on a click, and show the savings by week', async () => {
  const { page, seen, context } = await open(INFO());
  const bars = page.locator('[data-bars="by_use_case"] .hb');
  assert.deepEqual(await bars.allInnerTexts(), ['Price-loss decision desk\n$21,600', 'Second desk 1\n$12,250']);
  const weeks = await page.locator('[data-bars="saved_weeks"] .vb-c b').allInnerTexts();
  assert.equal(weeks.length, 12);
  assert.deepEqual(weeks.slice(-3), ['$4K', '$8K', '$12K'], 'the weeks of every measured use case add up');
  await bars.nth(1).click();
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  assert.equal(await hashOf(page), '#/n02_u01');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a click on a thing to fix opens that record on its use case page', async () => {
  const { page, seen, context } = await open(INFO());
  await page.locator('.tbl--things tbody tr').nth(1).click();
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  assert.equal(await hashOf(page), '#/n02_u01?rec=c');
  await page.waitForTimeout(500);
  assert.match(await hashOf(page), /[?&]rec=c(&|$)/, 'the page keeps the record in its link once its filters load');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a record link opens that record on its use case page, and closing it takes the record out of the link', async () => {
  const { page, seen, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: hubRoutes() });
  await page.goto(`${served.base}#/n01_u05?rec=R002`);
  const panel = page.locator('dialog.drawer[open]');
  await page.waitForFunction(() => document.querySelector('dialog.drawer[open] h2')?.textContent === 'Item number 2 with a long descriptive name');
  await panel.locator('.panel-h [aria-label="Close"]').click();
  await panel.waitFor({ state: 'detached' });
  assert.match(await hashOf(page), /^#\/n01_u05/);
  assert.doesNotMatch(await hashOf(page), /rec=/);
  await page.waitForTimeout(300);
  assert.equal(await page.locator('dialog.drawer[open]').count(), 0, 'the closed record stays closed');
  await page.goto(`${served.base}#/n02_u01?rec=c`);
  await page.waitForFunction(() => document.querySelector('dialog.drawer[open] h2')?.textContent === 'Supplier 3381, invoice 77188');
  assert.deepEqual(seen.history.at(-1), { page: 'n02_u01', record_key: 'c' }, 'a record off the first page of the list loads by its key');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Genie button on a thing to fix asks Genie about that record by click or Enter, and the Overview stays open', async () => {
  const { page, seen, context } = await open(INFO());
  assert.equal(await page.getByRole('button', { name: 'Ask Genie about Supplier 3381, invoice 77188' }).innerText(), 'Ask Genie', 'the button reads Ask Genie');
  await page.getByRole('button', { name: 'Ask Genie about Supplier 3381, invoice 77188' }).focus();
  await page.keyboard.press('Enter');
  await page.locator('aside.genie').waitFor();
  assert.equal(await page.locator('.g-chip-t').innerText(), 'About: Supplier 3381, invoice 77188');
  assert.match(await page.locator('aside.genie .g-h small').innerText(), /^Answers from the Genie Agent/, 'the record use case answers on the Overview');
  await page.locator('aside.genie .g-sugg .sugg').first().click();
  await until(() => seen.asks.length === 1);
  assert.deepEqual([seen.asks[0].page, seen.asks[0].record_key], ['n02_u01', 'c']);
  await page.locator('aside.genie .msg--genie').waitFor();
  await page.waitForTimeout(300);
  assert.equal(await page.locator('.pg-h h1').innerText(), 'Overview', 'Enter on the Genie button does not open the record');
  assert.doesNotMatch(await hashOf(page), /rec=/);
  await page.getByRole('button', { name: 'Ask Genie about Wool coat, store 4' }).click();
  assert.equal(await page.locator('.g-chip-t').innerText(), 'About: Wool coat, store 4');
  assert.equal(await page.locator('aside.genie .msg').count(), 0, 'a record of another use case opens that use case chat');
  await page.getByRole('button', { name: 'Stop asking about Wool coat, store 4' }).click();
  assert.ok(await page.locator('aside.genie .g-pick-list').isVisible(), 'with no record picked the Overview offers the use cases again');
  assert.equal(await page.locator('.pg-h h1').innerText(), 'Overview');
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
  await page.goto(`${served.base}#/n01_u05`);
  await page.waitForFunction(() => document.querySelectorAll('[data-bars="by_reason"] .hb').length === 3 && document.querySelectorAll('.card--table tbody tr').length);
  await page.locator('[data-bars="by_reason"] .hb', { hasText: 'Price below cost' }).click();
  await until(() => seen.records.at(-1)?.ai?.ai_cat_driver?.[0] === 'Price below cost');
  assert.deepEqual(seen.records.at(-1).ai, { ai_cat_driver: ['Price below cost'] });
  await page.locator('[data-bars="by_reason"] .hb.is-on').click();
  await until(() => Object.keys(seen.records.at(-1)?.ai || { x: 1 }).length === 0);
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

const JOINED_NOTE = 'Ask Genie is off on this page because it joined this App before each use case had its own Genie Agent here. Build this use case again with Edit MVP on Inspire\'s Build page to turn Ask Genie on.';
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

test('on the Overview Ask Genie lists only the use cases that answer and that the viewer may read, and picking one opens it with Ask Genie open', async () => {
  const info = withJoined();
  const { page, seen, context } = await openApp(browser, served.base, info, { width: 1440, routes: pageGenie() });
  await page.locator('[data-bars="by_use_case"] .hb').first().waitFor();
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  const panel = page.locator('aside.genie');
  await panel.waitFor();
  assert.equal(await panel.locator('.g-h small').innerText(), 'Each use case has its own Genie Agent');
  assert.equal(await panel.locator('.g-pick p').innerText(), HUB_NOTE);
  const shownTitles = await page.locator('.side .nav-t b').allInnerTexts();
  const expected = info.pages.filter((p) => p.genie.enabled && shownTitles.includes(p.title)).map((p) => `${p.use_case_id} · ${p.title}`);
  assert.deepEqual(await panel.locator('.g-pick-list .sugg').allInnerTexts(), expected);
  assert.ok(!expected.some((t) => t.endsWith('Second desk 2')), 'a page with Ask Genie off is not offered');
  assert.ok(!expected.some((t) => t.endsWith('Second desk 4')), 'a use case the viewer may not read is not offered');
  assert.equal(await page.getByLabel('Your question').isDisabled(), true);
  assert.equal(await page.getByLabel('Your question').getAttribute('placeholder'), 'Pick a use case first');
  await panel.locator('.g-pick-list .sugg', { hasText: 'Second desk 1' }).click();
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  assert.equal(await panel.isVisible(), true, 'Ask Genie stays open on the picked use case');
  assert.equal(await page.getByLabel('Your question').getAttribute('placeholder'), 'Ask about the data in this use case');
  await page.getByLabel('Your question').fill('Which invoices repeat?');
  await page.getByRole('button', { name: 'Send' }).click();
  await until(() => seen.asks.length === 1);
  assert.deepEqual(seen.asks[0], { question: 'Which invoices repeat?', conversation_id: '', page: 'n02_u01' });
  assert.deepEqual(seen.errors, []);
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
  await page.locator('.side .nav-i', { hasText: 'Second desk 1' }).click();
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  assert.equal(await page.locator('aside.genie .msg').count(), 0, 'another use case starts its own chat');
  await ask('Which invoices repeat?');
  await page.locator('.msg--genie', { hasText: 'Answer from n02_u01' }).waitFor({ timeout: 15000 });
  assert.deepEqual(seen.asks.map((a) => [a.page, a.conversation_id]), [['n01_u05', ''], ['n02_u01', '']], 'a new use case starts a new Genie conversation');
  await page.locator('.side .nav-i', { hasText: 'Price-loss decision desk' }).click();
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Price-loss decision desk');
  assert.deepEqual(await page.locator('aside.genie .msg--you p').allInnerTexts(), ['Which items lose the most?'], 'coming back shows this use case chat only');
  await ask('And last month?');
  await until(() => seen.asks.length === 3);
  assert.deepEqual([seen.asks[2].page, seen.asks[2].conversation_id], ['n01_u05', 'c-n01_u05'], 'the chat goes on in the same Genie conversation');
  await page.locator('.side .nav-i', { hasText: 'Second desk 2' }).click();
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
  const wrap = document.querySelector('.tbl--things').closest('.tbl-wrap');
  const edge = wrap.getBoundingClientRect().right + 1;
  return {
    scroll: wrap.scrollWidth - wrap.clientWidth, page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
    money: [...document.querySelectorAll('.tbl--things td.c-money')].every((td) => td.getBoundingClientRect().right <= edge && td.offsetWidth > 40),
    ask: [...document.querySelectorAll('.tbl--things .row-ask')].every((b) => b.getBoundingClientRect().right <= b.closest('td').getBoundingClientRect().right + 0.5),
  };
});

for (const [width, label] of [[1440, 'Ask Genie'], [1024, 'Ask Genie'], [390, '']]) {
  test(`the money of every thing to fix stays in view without a sideways scroll at ${width} px`, async () => {
    const { page, seen, context } = await open(INFO(), { width });
    assert.deepEqual(await tableFit(page), { scroll: 0, page: 0, money: true, ask: true });
    assert.deepEqual(new Set(await page.locator('.tbl--things .row-ask').allInnerTexts()), new Set([label]));
    assert.deepEqual(seen.errors, []);
    await context.close();
  });
}

test('a wide Genie window narrows the Overview to one chart column and 2 by 2 tiles, and nothing scrolls sideways', async () => {
  const { page, seen, context } = await open(INFO(), { width: 1440 });
  await page.getByRole('button', { name: 'Ask Genie', exact: true }).click();
  await page.locator('.genie').waitFor();
  await page.addStyleTag({ content: '.genie{width:760px!important;max-width:none!important}' });
  await page.waitForFunction(() => document.querySelector('.main').getBoundingClientRect().width < 760);
  const shape = await page.evaluate(() => ({
    charts: getComputedStyle(document.querySelector('.charts')).gridTemplateColumns.split(' ').length,
    tiles: getComputedStyle(document.querySelector('.kpis')).gridTemplateColumns.split(' ').length,
  }));
  assert.deepEqual(shape, { charts: 1, tiles: 2 });
  assert.deepEqual(await tableFit(page), { scroll: 0, page: 0, money: true, ask: true });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the things to fix end with a column the Genie row button fills, its header read only by screen readers, and long use case names wrap', async () => {
  const { page, seen, context } = await open(INFO());
  assert.equal(await page.locator('.tbl--things thead th:last-child .sr').textContent(), 'Ask Genie');
  assert.equal(await page.locator('.tbl--things thead th:last-child .sr').evaluate((el) => el.getBoundingClientRect().width <= 1), true);
  assert.equal(await page.locator('.tbl--things tbody tr td:last-child.c-ask').count(), 5);
  assert.equal(await page.locator('.tbl--things td.c-uc .ucn').first().evaluate((el) => getComputedStyle(el).whiteSpace), 'normal');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

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

test('a use case page leads with its area, title, Notify me, AI summary, four tiles, the AI reason filter and two charts', async () => {
  const { page, seen, context } = await openApp(browser, served.base, INFO(), { width: 1440, routes: hubRoutes() });
  await page.goto(`${served.base}#/n01_u05`);
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Price-loss decision desk' && document.querySelectorAll('.kpi-v').length === 4);
  assert.equal(await page.locator('.ph .ph-dom').innerText(), 'PRICING › MARKDOWN CONTROL');
  const notify = page.getByRole('link', { name: 'Notify me' });
  assert.equal(await notify.getAttribute('href'), 'https://example.com/sql/alerts');
  assert.equal(await notify.getAttribute('target'), '_blank');
  assert.match(await page.locator('.sum').innerText(), /^AI summary\s+Deep discounts on winter wear are losing margin without selling more\.$/);
  assert.deepEqual(await tileTexts(page), [
    ['To fix', '3', '2 of them are yours'], ['Could save', '$21,600', 'Money at stake on the 3 things to fix, added up'],
    ['Fixed so far', '12', 'since Sep 1'], ['Saved so far', '$9,750', 'Money at stake when fixed, less what a later run still finds, on 9 fixes a later run confirmed']]);
  assert.equal(await page.locator('.fbar .fld > span').first().innerText(), 'REASON (FROM AI)');
  assert.deepEqual(await page.locator('.fbar .fld > span').allInnerTexts(), ['REASON (FROM AI)', 'RUN DATE', 'CATEGORY', 'CHANNEL', 'REGION', 'OWNER', 'SHOW']);
  assert.deepEqual(await page.locator('[data-bars="by_reason"] .hb').allInnerTexts(), ['Discount too deep\n$8,400', 'Price below cost\n$7,200',
    'Stock in the wrong store\n$6,000']);
  await page.waitForFunction(chartsDrawn, 4);
  assert.deepEqual(await page.locator('section.charts:not(.charts--more) > *').evaluateAll((cards) => cards.map((c) => c.dataset.bars || c.dataset.card)),
    ['by_reason', 'loss_trend'], 'the reasons sit next to the page trend chart');
  assert.deepEqual(await page.locator('[data-drivers] [data-card]').evaluateAll((cards) => cards.map((c) => c.dataset.card)), ['by_category'],
    'the Drivers chart sits under its heading');
  assert.deepEqual(await page.locator('.charts--more [data-card]').evaluateAll((cards) => cards.map((c) => c.dataset.card)), ['channel_mix', 'pareto']);
  assert.ok(await page.evaluate(() => ['.charts--more', '[data-drivers]'].every((s) => document.querySelector(s).getBoundingClientRect().bottom
    <= document.querySelector('.card--table').getBoundingClientRect().top)), 'every chart, the Drivers section with them, sits above the things to fix');
  assert.ok(await page.evaluate(() => document.querySelector('main .page').lastElementChild.matches('.card--table')), 'the table is the last part of the page');
  assert.equal(await page.locator('.story').count(), 0);
  assert.equal(await page.locator('.ph-q').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
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
  assert.equal(await page.locator('[data-bars="by_reason"] .hb.is-on').innerText(), 'Price below cost\n$7,200');
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
    const [bar, charts, table] = ['.ph ~ .fbar', '.charts--more', '.card--table'].map((s) => document.querySelector(s).getBoundingClientRect());
    return bar.bottom <= charts.top && charts.bottom <= table.top && document.querySelector('main .page').lastElementChild.matches('.card--table');
  }), 'the filters come first, then the charts, and the table is last, so the table can be filtered');
  await page.goto(`${served.base}#/n02_u01`);
  await page.waitForSelector('.uc-status:not(.is-bad):not(.is-wait)');
  assert.equal(await page.locator('.uc-status').innerText(), 'Nothing to act on yet, because no record has 5,000 USD or more at stake, the amount this use case reviews from.');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a hub with no money recorded says Not measured yet instead of an amount, and still counts what is overdue', async () => {
  const bare = JSON.parse(JSON.stringify(HUB));
  Object.values(bare.pages).forEach((e) => { if (e.tracked) Object.assign(e, { money: false, weeks: [] }); e.items?.forEach((i) => { i.money = null; }); });
  const { page, seen, context } = await open(INFO(), { hub: bare });
  assert.deepEqual((await tileTexts(page)).map((t) => t[1]), ['5', 'Not measured yet', '2', 'Not measured yet']);
  assert.equal(await page.locator('[data-bars="saved_weeks"] .empty').innerText(), 'Not measured yet');
  assert.equal(await page.locator('[data-bars="by_use_case"] .empty').innerText(), 'Not measured yet');
  assert.deepEqual(await page.locator('.tbl--things td.c-money').allInnerTexts(), Array(5).fill('Not measured yet'));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the tabs layout puts the Overview first, then My work and the Impact page', async () => {
  const { page, seen, context } = await open(appInfo({ layout: 'tabs' }, 3, TABLE));
  assert.deepEqual(await page.locator('.tabs .tab').allInnerTexts(), ['Overview', 'My work', 'Impact', 'Price-loss decision desk', 'Second desk 1', 'Second desk 2']);
  await page.locator('.tabs .tab', { hasText: 'Impact' }).click();
  await page.waitForFunction(() => document.querySelector('.pg-h h1')?.textContent === 'Impact');
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

test('the header times take the latest update and the next one still to come', () => {
  assert.equal(hubTimes([{ tracked: true, runs: RUNS }, { tracked: true, runs: { updated: '2026-10-21T06:00:00Z', next: '2026-10-23' } }], TODAY),
    'Updated Oct 21 · next update Oct 27');
  assert.equal(hubTimes([{ tracked: true, runs: { updated: '2026-10-01T06:00:00Z', next: '2026-10-08' } }], TODAY), 'Updated Oct 1');
  assert.equal(hubTimes([{ tracked: false }, undefined], TODAY), '');
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

test('my work is what is assigned to me, overdue first, then due today, then by date, and the filters read as words', () => {
  const user = { email: ME };
  const rows = [item('n', 'No date', 'Act now', 900, { owner: ME }), item('l2', 'Late two', 'Review', 10, { owner: ME, due: '2026-10-20' }),
    item('t', 'Today', 'Act now', 5, { owner: ME, due: TODAY }), item('s', 'Sam', 'Act now', 99999, { owner: SAM, due: '2026-10-01' }),
    item('l1', 'Late one', 'Monitor', 20, { owner: ` ${ME.toUpperCase()} `, due: '2026-10-23' }), item('w', 'Next week', 'Act now', 1, { owner: ME, due: '2026-10-31' }),
    item('w2', 'Next week too', 'Act now', 3, { owner: ME, due: '2026-10-31' }), item('u', 'Nobody', 'Act now', 50, { due: '2026-10-01' })];
  const work = myWork(rows, user, TODAY);
  assert.deepEqual(work.rows.map((r) => r.key), ['l2', 'l1', 't', 'w2', 'w', 'n']);
  assert.deepEqual([work.late, work.today], [2, 1]);
  assert.equal(myWorkText(work), '6 assigned to you · 2 overdue · 1 due today');
  assert.equal(myWorkText(myWork([rows[0]], user, TODAY)), '1 assigned to you');
  assert.deepEqual(rows.map((r) => r.key), ['n', 'l2', 't', 's', 'l1', 'w', 'w2', 'u'], 'the hub items keep their order');
  assert.deepEqual(myWork(rows, { email: '' }, TODAY).rows, [], 'an unsigned viewer has no work');
  assert.equal(viewWords(DEFAULT_VIEW), 'Owner: Everyone; Show: To fix');
  assert.equal(viewWords({ owner: 'me', show: 'all' }, [{ name: 'ai_cat_driver', label: 'Reason (from AI)' }, { name: 'ai_cat_fix', label: 'Fix (from AI)' }],
    { ai: { ai_cat_driver: ['Price below cost', 'Seasonal'] } }), 'Owner: Me; Show: To fix and worth a look; Reason (from AI): Price below cost, Seasonal');
});

const workRows = (page) => page.locator('.tbl--mine tbody tr').evaluateAll((trs) => trs.map((tr) => [...tr.querySelectorAll('td')].map((td) => td.innerText)));

test('Your work lists what is assigned to me, overdue first, with its status and due date, ignores the filters and opens a record on a click', async () => {
  const { page, seen, context } = await open(INFO());
  const work = page.getByRole('region', { name: 'Your work' });
  await work.locator('tbody tr').first().waitFor();
  assert.equal(await work.locator('.card-h p').innerText(), '3 assigned to you · 1 overdue · 1 due today');
  assert.deepEqual(await work.locator('thead th').allTextContents(), ['What', 'Use case', 'Status', 'Due', 'Could save']);
  assert.deepEqual(await workRows(page), [
    ['Supplier 3381, invoice 77188', 'Second desk 1', 'New', '2 days late', '$6,950'],
    [`Blue denim jacket, store 12\n${DESK[0].why}`, 'Price-loss decision desk', 'In progress', 'Today', '$8,400'],
    ['Leather boots, store 2', 'Price-loss decision desk', 'New', 'Fri, Oct 30', '$6,000']]);
  assert.equal(await work.locator('td.c-due.late').innerText(), '2 days late');
  assert.equal(await work.locator('.status--in-progress').innerText(), 'In progress');
  assert.equal(await work.getByRole('button', { name: /^Ask Genie/ }).count(), 0, 'each record keeps one Ask Genie button, on the things to fix');
  assert.ok(await page.evaluate(() => Boolean(document.querySelector('[aria-label="Your work"]').compareDocumentPosition(document.querySelector('.fbar'))
    & Node.DOCUMENT_POSITION_FOLLOWING)), 'your work comes before the filters');
  await page.getByLabel('Owner').selectOption('none');
  await page.getByLabel('Show').selectOption('all');
  assert.equal(await work.locator('tbody tr').count(), 3, 'the Owner and Show filters narrow the things to fix, not your work');
  await work.locator('tbody tr').first().click();
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  assert.equal(await hashOf(page), '#/n02_u01?rec=c');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Your work keeps an overdue Monitor record that is mine, shows eight at first and says when a use case sent only its biggest records', async () => {
  const mine = Array.from({ length: 10 }, (_, i) => item(`k${i}`, `Mine ${i}`, i ? 'Act now' : 'Monitor', 100 + i, { owner: ME, due: i ? null : '2026-10-23' }));
  const hub = { ...HUB, pages: { ...HUB.pages, n01_u05: entry(mine, { truncated: true, total: 900 }), n02_u01: entry([]) } };
  const { page, seen, context } = await open(INFO(), { hub });
  const work = page.getByRole('region', { name: 'Your work' });
  await work.locator('tbody tr').first().waitFor();
  assert.equal(await work.locator('tbody tr').count(), WORK_SHOWN);
  assert.equal(await work.locator('tbody tr td:first-child').first().innerText(), 'Mine 0', 'an overdue Monitor record is still your work');
  assert.equal(await page.locator('.tbl--things tbody tr', { hasText: 'Mine 0' }).count(), 0, 'the things to fix keep only the tiers they show');
  await work.getByRole('button', { name: 'Show all 10' }).click();
  assert.equal(await work.locator('tbody tr').count(), 10);
  await work.getByRole('button', { name: 'Show fewer' }).click();
  assert.equal(await work.locator('tbody tr').count(), WORK_SHOWN);
  assert.equal(await work.locator('.more').last().innerText(),
    'Each use case sends the Overview its biggest open records only. Open a use case and pick My actions to see all of yours.');
  assert.deepEqual(seen.errors, []);
  await context.close();
  const whole = await open(INFO());
  await whole.page.getByRole('region', { name: 'Your work' }).locator('tbody tr').first().waitFor();
  assert.equal(await whole.page.getByRole('region', { name: 'Your work' }).locator('.more').count(), 0, 'a whole list needs no note and no Show all');
  await whole.context.close();
});

test('Your work says plainly why it is empty: loading, nothing mine, a use case that failed, no results yet, not signed in, the Overview failed', async () => {
  const samOnly = { ...HUB, pages: { ...HUB.pages, n01_u05: entry(DESK.map((i) => ({ ...i, owner: SAM }))), n02_u01: entry([]) } };
  const { n02_u01: _dropped, ...rest } = HUB.pages;
  const failedOne = { ...HUB, errors: { n02_u01: 'PERMISSION_DENIED: no SELECT' }, pages: { ...rest, n01_u05: entry(DESK.map((i) => ({ ...i, owner: SAM }))) } };
  const noOwners = JSON.parse(JSON.stringify(HUB));
  Object.values(noOwners.pages).forEach((e) => { Object.assign(e, { tracked: false, items: [] }); });
  const unsigned = { ...INFO(), user: { email: '', name: '' } };
  const cases = [[samOnly, INFO(), 'Nothing is assigned to you right now.'], [failedOne, INFO(), 'Nothing is assigned to you in the use cases that loaded.'],
    [noOwners, INFO(), 'No use case keeps owners yet, so nothing is assigned to you.'], [HUB, unsigned, 'Sign in to see what is assigned to you.']];
  for (const [hub, info, said] of cases) {
    const { page, seen, context } = await open(info, { hub });
    const work = page.getByRole('region', { name: 'Your work' });
    await work.locator('.nomatch').waitFor();
    assert.equal(await work.locator('.nomatch').innerText(), said);
    assert.equal(await work.locator('table').count(), 0, said);
    assert.equal(await work.locator('.card-h p').innerText(), 'Things assigned to you, overdue and due today first');
    assert.deepEqual(seen.errors.filter((e) => !/status of 403/.test(e)), []);
    await context.close();
  }
  let hold = false;
  const routes = hubRoutes();
  const overview = routes.overview;
  routes.overview = (args) => (hold ? new Promise(() => {}) : overview(args));
  const slow = await openApp(browser, served.base, INFO(), { width: 1440, routes });
  hold = true;
  await slow.page.reload();
  await slow.page.getByRole('region', { name: 'Your work' }).locator('.more').waitFor();
  assert.equal(await slow.page.getByRole('region', { name: 'Your work' }).locator('.more').innerText(), 'Loading your work…');
  await slow.context.close();
  const down = await openApp(browser, served.base, INFO(), { width: 1440, routes: { ...hubRoutes(), overview: ({ json }) => json(500, { error: 'the warehouse is stopped' }) } });
  const failed = down.page.getByRole('region', { name: 'Your work' });
  await failed.locator('.nomatch').waitFor();
  assert.equal(await failed.locator('.nomatch').innerText(), 'Your work could not load.');
  await down.context.close();
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

const HUB_NOTE = 'Each use case has its own Genie Agent. Open a use case to ask Genie about it or to explain its charts.';

test('with several use cases the Overview and Impact charts have no Explain and say where to explain them, and with one use case Impact explains its charts', async () => {
  const many = await open(INFO());
  await many.page.locator('[data-bars="by_use_case"] .hb').first().waitFor();
  assert.equal(await many.page.locator('.explain-btn').count(), 0, 'no use case Genie Agent explains a chart across use cases');
  assert.equal(await many.page.locator('.charts + .note').innerText(), HUB_NOTE);
  await many.page.goto(`${served.base}#/impact`);
  await many.page.getByRole('heading', { name: 'Impact', exact: true }).waitFor();
  await many.page.locator('[data-bars="saved_weeks"] .vb').waitFor();
  assert.equal(await many.page.locator('.explain-btn').count(), 0);
  assert.equal(await many.page.locator('.charts + .note').innerText(), HUB_NOTE);
  assert.deepEqual(many.seen.errors, []);
  await many.context.close();

  const { calls, routes, release } = explainHub();
  const { page, seen, context } = await openApp(browser, served.base, appInfo({ business: 'Contoso Retail' }, 1, TABLE), { width: 1440, routes });
  await page.goto(`${served.base}#/impact`);
  await page.getByRole('heading', { name: 'Impact', exact: true }).waitFor();
  await page.locator('[data-bars="saved_weeks"] .vb').waitFor();
  assert.equal(await page.locator('.note', { hasText: HUB_NOTE }).count(), 0, 'one use case answers about its own Impact charts');
  const buttons = page.locator('.charts .explain-btn');
  assert.ok(await buttons.count() >= 1);
  await page.locator('[data-bars="saved_weeks"] .explain-btn').click();
  await until(() => calls.explain.length === 1);
  const weeks = calls.explain[0];
  assert.deepEqual([weeks.kind, weeks.page, weeks.title, weeks.context.type, weeks.context.x, weeks.context.measures, weeks.context.row_count, weeks.context.filters, weeks.context.hint],
    ['chart', 'impact', 'Saved per week', 'bar', 'Week', ['Saved'], 12, '', 'Measured on fixes a later run confirmed, by week']);
  assert.deepEqual([weeks.context.rows.at(-1).Week, weeks.context.rows.at(-1).Saved], ['Oct 19', 3000]);
  await page.locator('aside.genie .g-step').waitFor();
  assert.equal(await page.locator('.msg--you').last().locator('p').innerText(), 'Explain \u201cSaved per week\u201d');
  assert.ok((await buttons.evaluateAll((els) => els.map((e) => [e.disabled, e.title]))).every(([d, t]) => d && t === 'Genie is still answering'));
  release();
  await page.locator('.msg-sql').waitFor({ timeout: 15000 });
  assert.ok((await buttons.evaluateAll((els) => els.map((e) => e.disabled))).every((d) => !d));
  assert.deepEqual(seen.errors, []);
  await context.close();
  const off = await open(appInfo({ business: 'Contoso Retail', genie: null, genie_note: 'The Genie Agent did not build.' }, 1, TABLE));
  await off.page.goto(`${served.base}#/impact`);
  await off.page.locator('[data-bars="saved_weeks"] .vb').waitFor();
  assert.equal(await off.page.locator('.explain-btn').count(), 0, 'no Explain while Ask Genie is off');
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
    rows: [{ 'Reason (from AI)': 'Price below cost', 'Could save': 7200, 'Shown as': '$7,200' }] } });
  assert.equal(await page.locator('[data-bars="by_reason"] .card-h p').innerText(), 'The AI groups each item by reason. Click a bar to filter.');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a hub whose Impact screen is off lists no Impact page and its link opens the Overview', async () => {
  const info = appInfo({ business: 'Contoso Retail', screens: { impact: false } }, 5, TABLE);
  assert.deepEqual(info.screens, { runs: true, impact: false });
  const { page, seen, context } = await open(info);
  await page.waitForFunction(() => document.querySelector('.nav-t small.warn'));
  assert.deepEqual(await page.locator('.side .nav-t b').allInnerTexts(),
    ['Overview', 'My work', 'Price-loss decision desk', 'Second desk 1', 'Second desk 2', 'Second desk 3']);
  await page.goto(`${served.base}#/impact`);
  await page.waitForFunction(() => document.querySelector('.pg-h h1')?.textContent === 'Overview');
  assert.equal(await page.locator('.side .nav-i.is-on .nav-t b').innerText(), 'Overview');
  assert.equal(await page.locator('.imp').count(), 0);
  assert.equal(await page.evaluate(() => document.title), 'Contoso Retail - Databricks Inspire Use Cases Hub');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a use case whose Runs screen is off shows only Things to fix and never asks for its run history', async () => {
  const info = appInfo({ business: 'Contoso Retail', screens: { runs: false } }, 5, TABLE);
  const { page, seen, context } = await open(info);
  const asked = [];
  page.on('request', (r) => { if (new URL(r.url()).pathname === '/api/runs') asked.push(r.url()); });
  await page.goto(`${served.base}#/n01_u05?v=runs`);
  await page.waitForFunction(() => document.querySelector('[role="tab"][aria-selected="true"]')?.dataset.view === 'overview');
  assert.deepEqual(await page.locator('[role="tab"] > span').allInnerTexts(), ['Things to fix']);
  assert.equal(await page.locator('section.runs').count(), 0);
  assert.deepEqual(asked, []);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
