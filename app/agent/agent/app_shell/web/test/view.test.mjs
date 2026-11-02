import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
  CONTRACT, CURRENT, DECIDE, HISTORY, LABEL, OTHER, PERSON, ROWS, SUMMARY, TABLE, appInfo, chartsDrawn, lister, openApp, resizeTo, serveDist, tracked, until,
} from './harness.mjs';
import { encodeFilters } from '../src/links.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const CLOCK = new Date('2026-10-27T09:30:00Z');
const TODAY = '2026-10-27';
const MY = 'inspire-app-my';
const label = (n) => `Item number ${n} with a long descriptive name`;
const labels = (page) => page.locator('.card--table tbody .cell-t b').allInnerTexts();
const mine = (page) => page.evaluate(([key, who]) => JSON.parse(localStorage.getItem(key) || '{}')[who] || null, [MY, PERSON]);
const STUB_CLIPBOARD = () => {
  window.__copied = [];
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: (t) => { window.__copied.push(t); return Promise.resolve(); } } });
};

async function openWith(info, routes, { prefs, hash = '#/n01_u05', init, width } = {}) {
  const opened = await openApp(browser, served.base, info, { routes, clock: CLOCK, width, timezone: 'Asia/Dubai' });
  if (init) await opened.page.addInitScript(init);
  if (prefs) await opened.page.evaluate(([key, who, value]) => localStorage.setItem(key, JSON.stringify({ [who]: value })), [MY, PERSON, prefs]);
  await opened.page.goto('about:blank');
  await opened.page.goto(`${served.base}${hash}`);
  return opened;
}

const waitList = (page) => page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length > 0 && document.querySelector('.list-tools'));

function dueList(rows) {
  return ({ route, json, seen }) => {
    const body = route.request().postDataJSON();
    seen.records.push(body);
    const dated = body.window ? rows : rows.map(({ _inspire_due, _inspire_snooze, ...r }) => r);
    const shown = body.window === 'today' ? dated.filter((r) => !r._inspire_due || r._inspire_due <= TODAY) : dated;
    const narrowed = body.filters?.category?.length ? [] : shown;
    return json(200, { rows: narrowed.slice(body.offset, body.offset + body.limit), total: narrowed.length, offset: body.offset, limit: body.limit, actions: true,
      changes: false, summary: SUMMARY, errors: {} });
  };
}

const item = (key, labelText, due, extra = {}) => ({ key, label: labelText, tier: 'Act now', money: 100, why: null, owner: PERSON, status: 'New', reason: null, due, ...extra });
const entry = (items) => ({
  visible: true, tracked: true, money: true, actions: true, categories: [], served: 'delta', items, total: items.length, truncated: false,
  done: { fixed: 0, fixed_q: 0, dismissed: 0, dismissed_q: 0, saved_n: 0, saved: 0, saved_q_n: 0, saved_q: 0, first_fixed: null, first_saved: null },
  weeks: [], runs: { updated: '2026-10-27T06:00:00Z', as_of: '2026-10-27', cadence_days: 7, next: '2026-11-03', stale: false, count: 3, failed: false },
});
function hubOf(items) {
  return ({ route, json, seen }) => {
    const body = route.request().postDataJSON();
    (seen.hub ||= []).push(body);
    const shown = body.window === 'today' ? items.filter((i) => !i.due || i.due <= TODAY) : items;
    const top = body.window_limit ? shown.slice(0, body.window_limit) : shown;
    return json(200, { today: TODAY, quarter: '2026-10-01', since: '2026-08-03', errors: {},
      window: body.window ? { window: body.window, limit: body.window_limit ?? null, today: TODAY } : null,
      pages: { n01_u05: { ...entry(top), total: shown.length, truncated: shown.length > top.length }, n02_u01: entry([]) } });
  };
}

test('My view is in Settings for everyone, the window chips follow it, it survives a reload, and the list asks the server for that window', async () => {
  const { routes } = tracked();
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes);
  await waitList(page);
  assert.deepEqual([seen.records[0].window, seen.records[0].time_zone, 'window_limit' in seen.records[0]], ['all', 'Asia/Dubai', false],
    'All open names its window from the first read, with no limit');
  await page.click('[data-settings-open]');
  await page.locator('[data-settings] [data-group="my_view"]').waitFor();
  assert.equal(await page.locator('select[name="my_window"]').inputValue(), 'all');
  assert.equal(await page.locator('select[name="my_limit"]').inputValue(), '0');
  await page.locator('select[name="my_window"]').selectOption('week');
  await until(() => seen.records.at(-1).window === 'week');
  assert.equal(seen.records.at(-1).time_zone, 'Asia/Dubai', 'the list says which week it means, here in Dubai time');
  const chips = page.getByRole('group', { name: 'Your window' });
  assert.deepEqual(await chips.locator('button').allInnerTexts(), ['This hour', 'Today', 'This week', 'This month', 'All open', 'Everything']);
  assert.equal(await chips.getByRole('button', { name: 'This week' }).getAttribute('aria-pressed'), 'true');
  assert.equal((await mine(page)).window, 'week');
  const before = seen.records.length;
  await page.reload();
  await waitList(page);
  assert.equal(seen.records[before].window, 'week', 'the first list request after a reload already asks for the window');
  await chips.getByRole('button', { name: 'Today' }).click();
  await until(() => seen.records.at(-1).window === 'today');
  await page.click('[data-settings-open]');
  assert.equal(await page.locator('select[name="my_window"]').inputValue(), 'today', 'the setting follows the chip');
  await chips.getByRole('button', { name: 'All open' }).click();
  await until(() => seen.records.at(-1).window === 'all');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a window chip hides a record outside the window while an overdue record stays, first, on the list and in Your work', async () => {
  const rows = [{ ...ROWS[0], _inspire_due: TODAY }, { ...ROWS[1], _inspire_due: '2026-11-04' }, { ...ROWS[2], _inspire_due: '2026-10-20', _inspire_status: null }];
  const { routes } = tracked({ records: dueList(rows) });
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes);
  await waitList(page);
  assert.deepEqual(await labels(page), [label(3), label(1), label(2)], 'overdue first, then the order the server ranked');
  assert.equal(await page.locator('[data-overdue]').innerText(), 'Overdue: 1 record on this page, shown first.');
  assert.equal(await page.locator('.card--table tbody tr.is-late .chg-b--late').innerText(), 'Overdue');
  await page.getByRole('group', { name: 'Your window' }).getByRole('button', { name: 'Today' }).click();
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length === 2);
  assert.deepEqual(await labels(page), [label(3), label(1)]);
  assert.ok(!(await labels(page)).includes(label(2)), 'the record due next week is outside Today');
  await context.close();

  const items = [item('w', 'Due next week', '2026-11-04'), item('t', 'Due today', TODAY), item('o', 'Overdue one', '2026-10-21')];
  const hub = await openWith(appInfo(DECIDE, 2, TABLE), { overview: hubOf(items) }, { hash: '#/overview' });
  const work = hub.page.getByRole('region', { name: 'Your work' });
  await work.locator('tbody tr').first().waitFor();
  const firsts = () => work.locator('tbody tr td:first-child').allInnerTexts();
  assert.deepEqual(await firsts(), ['Overdue one', 'Due today', 'Due next week']);
  assert.equal(await work.locator('tbody tr').first().getAttribute('class').then((c) => c.includes('is-late')), true);
  await work.getByRole('group', { name: 'Your window' }).getByRole('button', { name: 'Today' }).click();
  await until(() => hub.seen.hub?.at(-1)?.window === 'today');
  await hub.page.waitForFunction(() => document.querySelectorAll('[aria-label="Your work"] tbody tr').length === 2);
  assert.deepEqual(await firsts(), ['Overdue one', 'Due today']);
  assert.deepEqual([...seen.errors, ...hub.seen.errors], []);
  await hub.context.close();
});

test('a limit shows the top N with a line that says how many more there are, on the list and in Your work, and asks the Overview for it', async () => {
  const { routes } = tracked();
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes, { prefs: { limit: 10 } });
  await waitList(page);
  assert.equal(await page.locator('.card--table tbody tr').count(), 10);
  assert.deepEqual([seen.records.at(-1).limit, seen.records.at(-1).window_limit, seen.records.at(-1).window], [10, 10, 'all']);
  assert.equal(await page.locator('.pager-n').innerText(), 'Showing 1 to 10 of 10');
  assert.equal(await page.getByRole('button', { name: 'Next page' }).isDisabled(), true);
  assert.equal(await page.locator('.card--table [data-limit]').innerText(), 'Your limit shows the top 10 of 30. 20 more are not shown; change the limit in Settings.');
  await context.close();
  const items = Array.from({ length: 12 }, (_, i) => item(`k${i}`, `Mine ${i + 1}`, null, { money: 1000 - i }));
  const hub = await openWith(appInfo(DECIDE, 2, TABLE), { overview: hubOf(items) }, { hash: '#/overview', prefs: { limit: 10 } });
  const work = hub.page.getByRole('region', { name: 'Your work' });
  await work.locator('tbody tr').first().waitFor();
  assert.deepEqual(hub.seen.hub.at(-1), { window: 'all', window_limit: 10, time_zone: 'Asia/Dubai' });
  await work.getByRole('button', { name: 'Show all 10' }).click();
  assert.equal(await work.locator('tbody tr').count(), 10, 'Your work shows what the server kept under the limit');
  assert.equal(await work.locator('[data-limit]').innerText(), 'Your limit keeps the top 10 of 12 records in Price-loss decision desk. Change the limit in Settings.');
  assert.deepEqual([...seen.errors, ...hub.seen.errors], []);
  await hub.context.close();
  const all = await openWith(appInfo(DECIDE, 2, TABLE), { overview: hubOf(items.slice(0, 8)) }, { hash: '#/overview', prefs: { limit: 10 } });
  const sent = all.page.getByRole('region', { name: 'Your work' });
  await sent.locator('tbody tr').first().waitFor();
  assert.equal(await sent.locator('[data-limit]').count(), 0, 'the server sent every record in the window, so nothing is held back');
  assert.deepEqual(all.seen.errors, []);
  await all.context.close();
});

test('Compact density fits more rows, and it and the rows per page are kept for the person', async () => {
  const { routes } = tracked();
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes);
  await waitList(page);
  const pad = () => page.locator('.card--table tbody td').nth(1).evaluate((td) => getComputedStyle(td).paddingTop);
  assert.equal(await pad(), '9px');
  await page.click('[data-settings-open]');
  await page.locator('select[name="my_density"]').selectOption('compact');
  assert.equal(await page.locator('.app').getAttribute('data-density'), 'compact');
  assert.equal(await pad(), '5px');
  assert.equal((await mine(page)).density, 'compact');
  await page.getByLabel('Rows per page').selectOption('50');
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length === 30);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length === 30);
  assert.equal(await page.getByLabel('Rows per page').inputValue(), '50', 'rows per page is kept for the person too');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('each chart, the key numbers and a block fold with a one-line summary, stay folded after a reload, and each page keeps its own', async () => {
  const info = appInfo({ layout: 'sidebar' }, 2);
  info.pages[0].blocks = [{ id: 'guide', kind: 'text', place: { where: 'top' }, width: 'full', align: 'left', content: '## How to read this page\nStart with the list.' }];
  const { page, seen, context } = await openWith(info, {});
  await page.waitForFunction(chartsDrawn, 4);
  await page.getByRole('button', { name: 'Fold Loss to discounts by month' }).click();
  await page.getByRole('button', { name: 'Fold Key numbers' }).click();
  await page.getByRole('button', { name: 'Fold How to read this page' }).click();
  const state = () => page.evaluate(() => ({
    chart: !!document.querySelector('[data-card="loss_trend"].card--folded') && !document.querySelector('[data-card="loss_trend"] canvas'),
    others: document.querySelectorAll('.charts canvas').length,
    kpis: document.querySelectorAll('.kpi').length,
    sum: document.querySelector('.fold-s.is-folded .fold-sum')?.textContent || '',
    block: document.querySelector('[data-block="guide"] .blk-sum')?.textContent || '',
  }));
  const folded = await state();
  assert.deepEqual({ ...folded, sum: '' }, { chart: true, others: 3, kpis: 0, sum: '', block: 'How to read this page' });
  assert.match(folded.sum, /^Loss to discounts \S.* · Loss rate \S.* · Items on the list \S+$/);
  assert.deepEqual((await mine(page)).folds, { n01_u05: { 'chart:loss_trend': true, kpis: true, 'block:guide': true } });
  await page.reload();
  await page.waitForFunction(chartsDrawn, 3);
  assert.deepEqual({ ...(await state()), sum: '' }, { ...folded, sum: '' }, 'the folds come back after a reload');
  await page.locator('.side .nav-i', { hasText: 'Second desk 1' }).click();
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  await page.waitForFunction(chartsDrawn, 4);
  assert.equal(await page.locator('.card--folded, .fold-s.is-folded').count(), 0, 'another page keeps its own folds');
  assert.equal(await page.getByRole('button', { name: 'Unfold Loss to discounts by month' }).count(), 0);
  await page.locator('.side .nav-i', { hasText: 'Price-loss decision desk' }).click();
  await page.waitForFunction(chartsDrawn, 3);
  await page.getByRole('button', { name: 'Unfold Loss to discounts by month' }).click();
  await page.waitForFunction(chartsDrawn, 4);
  assert.deepEqual((await mine(page)).folds, { n01_u05: { kpis: true, 'block:guide': true } });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the money panel folds to its title, stays folded after a reload, and unfolds again', async () => {
  const model = { currency: 'USD', basis: 'measured', act_now_amount: 5000, review_amount: 1000, parts: [{ column: 'units', kind: 'number' }, { text: ' units lost' }],
    columns: ['units'], assumptions: [], changed: false, problem: '' };
  const overview = ({ json }) => json(200, { today: TODAY, quarter: '2026-10-01', since: '2026-08-03', errors: {},
    pages: { n01_u05: { ...entry([item('a', 'Blue denim jacket', null)]), money_model: model } } });
  const { routes } = tracked({ overview, money: ({ json }) => json(200, { model, editable: false, why: 'Only the owners of this App can change its assumptions', history: [] }) });
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes);
  const card = page.getByRole('region', { name: 'How the money at stake is worked out' });
  await card.locator('.rule').waitFor();
  await card.getByRole('button', { name: 'Fold How the money at stake is worked out' }).click();
  await page.waitForFunction(() => document.querySelector('.money--folded'));
  assert.equal(await card.locator('.rule, .tiers').count(), 0, 'a folded panel keeps only its title');
  assert.deepEqual((await mine(page)).folds, { n01_u05: { money: true } });
  await page.reload();
  await page.locator('.money--folded').waitFor();
  await card.getByRole('button', { name: 'Unfold How the money at stake is worked out' }).click();
  await card.locator('.rule').waitFor();
  assert.deepEqual((await mine(page)).folds, {});
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Focus on the list folds every chart and the key numbers at once, and pressing it again unfolds them', async () => {
  const { routes } = tracked();
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes);
  await waitList(page);
  await page.waitForFunction(chartsDrawn, 4);
  const expanded = () => page.locator('[data-fold]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-expanded')));
  assert.ok((await expanded()).length >= 5 && (await expanded()).every((v) => v === 'true'));
  const focus = page.getByRole('button', { name: 'Focus on the list' });
  await focus.click();
  await page.waitForFunction(() => !document.querySelector('.charts canvas'));
  assert.ok((await expanded()).every((v) => v === 'false'));
  assert.equal(await focus.getAttribute('aria-pressed'), 'true');
  await focus.click();
  await page.waitForFunction(chartsDrawn, 4);
  assert.ok((await expanded()).every((v) => v === 'true'));
  assert.equal(await focus.getAttribute('aria-pressed'), 'false');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Copy a link to a record copies an address that opens that record', async () => {
  const { routes } = tracked();
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes, { init: STUB_CLIPBOARD });
  await waitList(page);
  await page.locator('.cell-t').first().click();
  await page.locator('dialog.drawer .dr-act').waitFor();
  await page.getByRole('button', { name: 'Copy a link to this record' }).click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'Link to this record copied');
  const [copied] = await page.evaluate(() => window.__copied);
  assert.equal(new URL(copied).hash, '#/n01_u05?rec=R001');
  const other = await openWith(appInfo(DECIDE, 1, TABLE), tracked().routes, { hash: new URL(copied).hash });
  await other.page.waitForFunction((t) => document.querySelector('dialog.drawer[open] h2')?.textContent === t, LABEL);
  assert.deepEqual([...seen.errors, ...other.seen.errors], []);
  await other.context.close();
  await context.close();
});

test('Add a note writes only the note, so the status stays as it was', async () => {
  const { calls, routes } = tracked();
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes);
  await waitList(page);
  await page.locator('.cell-t').first().click();
  const note = page.getByRole('region', { name: 'Add a note' });
  await note.waitFor();
  assert.equal(await note.getByRole('button', { name: 'Add note' }).isDisabled(), true, 'an empty note cannot be added');
  await note.locator('textarea[name="record_note"]').fill('  Called the store, they ship Monday  ');
  await note.getByRole('button', { name: 'Add note' }).click();
  await until(() => calls.acts.length === 1);
  assert.deepEqual(calls.acts[0], { page: 'n01_u05', record_keys: ['R001'], seen: { R001: '102' }, values: { note: 'Called the store, they ship Monday' } });
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'Note added. The status stays as it was.');
  assert.equal(await note.locator('textarea[name="record_note"]').inputValue(), '');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('an empty list says what to do: all caught up in a window with Show all open, and filtered to nothing with Clear filters', async () => {
  const { routes } = tracked({ records: dueList([{ ...ROWS[0], _inspire_due: '2026-11-04' }]) });
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes, { prefs: { window: 'today' } });
  await page.waitForFunction(() => document.querySelector('.card--table .more .empty-t'));
  assert.equal(await page.locator('.card--table .more .empty-t').innerText(), 'All caught up: nothing is due or new for today.');
  await page.locator('.card--table .more').getByRole('button', { name: 'Show all open' }).click();
  await until(() => seen.records.at(-1).window === 'all');
  await waitList(page);
  assert.equal(await page.getByRole('group', { name: 'Your window' }).getByRole('button', { name: 'All open' }).getAttribute('aria-pressed'), 'true');
  await context.close();
  const linked = await openWith(appInfo(DECIDE, 1, TABLE), routes, { hash: `#/n01_u05?f=${encodeFilters({ s: { category: ['Music'] } })}` });
  await linked.page.waitForFunction(() => document.querySelector('.card--table .more .empty-t')?.textContent === 'No record matches these filters.');
  assert.deepEqual(linked.seen.records.at(-1).filters.category, ['Music']);
  await linked.page.locator('.card--table .more').getByRole('button', { name: 'Clear filters' }).click();
  await until(() => !linked.seen.records.at(-1).filters.category);
  await waitList(linked.page);
  assert.equal(await linked.page.locator('.chips .chip').count(), 0, 'the page filters are cleared too');
  assert.deepEqual([...seen.errors, ...linked.seen.errors], []);
  await linked.context.close();
});

test('a list with no records at all says the next run fills it, and a date range that leaves none says the filters do', async () => {
  const { routes } = tracked({ records: lister([], { actions: true, changes: false, summary: SUMMARY }, 0) });
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes);
  await page.waitForFunction(() => document.querySelector('.card--table .more .empty-t'));
  assert.equal(await page.locator('.card--table .more').innerText(), 'No record matches these filters.', 'a date range may hide records, so nothing to clear is offered');
  await page.locator('.fld--range select').selectOption('all');
  await until(() => !seen.records.at(-1).filters.run_date);
  await page.waitForFunction(() => document.querySelector('.card--table .more')?.textContent === 'No records yet. The next run of this use case fills this list.');
  assert.equal(await page.locator('.card--table .more button').count(), 0);
  assert.equal(await page.locator('[data-start-work]').count(), 0, 'nothing to work through, so no Start working');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('New since your last visit marks the records that changed between visits and shows only them on request', async () => {
  const last = CLOCK.getTime() - 3600000;
  const rows = ROWS.map((r, i) => ({ ...r, _inspire_version: i < 2 ? String((last + 60000 * (i + 1)) * 1000) : String((last - 60000) * 1000) }));
  const { routes } = tracked({ records: dueList(rows) });
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes, { prefs: { seen: { n01_u05: last } } });
  await waitList(page);
  const chip = page.locator('[data-fresh]');
  assert.equal(await chip.innerText(), 'New since your last visit · 2 on this page');
  assert.equal(await page.locator('.card--table tbody .chg-b--you').count(), 2);
  await chip.click();
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length === 2);
  assert.deepEqual(await labels(page), [label(1), label(2)]);
  const stamp = (await mine(page)).seen.n01_u05;
  assert.ok(stamp >= CLOCK.getTime() && stamp < CLOCK.getTime() + 60000, `this visit is stamped for the next one: ${stamp}`);
  await page.reload();
  await waitList(page);
  assert.equal(await page.locator('[data-fresh]').count(), 0, 'after the visit nothing is new any more');
  assert.equal(await page.locator('.chg-b--you').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Overview says what you did today: assigned, overdue, due today and done today from the overview reply, with no read of any use case changes', async () => {
  const items = [item('t', 'Due today', TODAY), item('o', 'Overdue one', '2026-10-21'), item('n', 'Later', '2026-11-20')];
  const mine = CONTRACT.overview_window.page_fields.done.mine_today;
  const asked = [];
  const overview = ({ route, json, seen }) => {
    (seen.hub ||= []).push(route.request().postDataJSON());
    const counted = (e, n) => ({ ...e, done: { ...e.done, mine_today: n } });
    return json(200, { today: TODAY, quarter: '2026-10-01', since: '2026-08-03', errors: {}, window: { window: 'all', limit: null, today: TODAY },
      pages: { n01_u05: counted(entry(items), mine), n02_u01: counted(entry([]), 1) } });
  };
  const routes = { overview, 'records/batches': ({ json, url }) => { asked.push(url.searchParams.get('page')); return json(200, { batches: [], limit: 20 }); } };
  const { page, seen, context } = await openWith(appInfo(DECIDE, 2, TABLE), routes, { hash: '#/overview' });
  const work = page.getByRole('region', { name: 'Your work' });
  await page.waitForFunction(() => /done today/.test(document.querySelector('[aria-label="Your work"] [data-today]')?.textContent || ''));
  assert.equal(await work.locator('[data-today]').innerText(), `3 assigned to you · 1 overdue · 1 due today · ${mine + 1} done today`);
  assert.deepEqual(asked, [], 'the Overview reply already counts it, so no use case is asked for its changes');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

function layoutCheck() {
  const shown = (el) => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
  const bleed = [...document.querySelectorAll('.app *')].filter((el) => shown(el) && !el.closest('.tbl-wrap, .tabs, .side:not(.is-open)')
    && (el.getBoundingClientRect().right > window.innerWidth + 1 || el.getBoundingClientRect().left < -1)).slice(0, 5)
    .map((el) => `${el.tagName.toLowerCase()}.${[...el.classList].join('.')}`);
  const overlap = (sel) => {
    const boxes = [...document.querySelectorAll(sel)].filter(shown).map((el) => el.getBoundingClientRect());
    return boxes.some((a, i) => boxes.some((b, j) => j > i && a.left < b.right - 1 && b.left < a.right - 1 && a.top < b.bottom - 1 && b.top < a.bottom - 1));
  };
  const reach = (el) => {
    const hit = getComputedStyle(el, '::before');
    const r = el.getBoundingClientRect();
    return hit.content !== 'none' && hit.position === 'absolute' ? [Math.max(r.width, parseFloat(hit.width)), Math.max(r.height, parseFloat(hit.height))] : [r.width, r.height];
  };
  const small = [...document.querySelectorAll('.main button, .main select, .main .pick-l')].filter((el) => shown(el)
    && !el.matches('.cell-t, .link, .lnk') && !el.closest('.pick-l')).map((el) => [el.getAttribute('aria-label') || el.textContent.trim().slice(0, 24),
    ...reach(el).map(Math.round)]).filter(([, w, h]) => w < 40 || h < 40);
  const head = document.querySelector('.card--list > .card-h > div:first-child');
  return { scroll: document.documentElement.scrollWidth - window.innerWidth, bleed, tools: overlap('.list-tools > *'), bulk: overlap('.bulk > button'),
    chips: overlap('.wchips > button'), small, title: head ? head.getBoundingClientRect().width >= Math.min(260, head.parentElement.clientWidth - 32) : true };
}

test('the list, its tools, the selection bar and the Overview fit 1440, 1024 and 390 pixels, and every control is 40 pixels or more on a phone', async () => {
  const items = [item('t', 'Due today', TODAY), item('o', 'Overdue one', '2026-10-21')];
  const { routes } = tracked({ overview: hubOf(items) });
  const { page, seen, context } = await openWith(appInfo(DECIDE, 2, TABLE), routes, { width: 1440 });
  await waitList(page);
  await page.getByRole('checkbox', { name: `Select ${label(1)}` }).check();
  for (const screen of ['list', 'overview']) {
    if (screen === 'overview') {
      await page.goto(`${served.base}#/overview`);
      await page.getByRole('region', { name: 'Your work' }).locator('tbody tr').first().waitFor();
    }
    for (const width of [1440, 1024, 390]) {
      await resizeTo(page, width);
      const m = await page.evaluate(layoutCheck);
      const at = `${screen} at ${width}px`;
      assert.equal(m.scroll, 0, `${at} scrolls sideways`);
      assert.deepEqual(m.bleed, [], at);
      assert.equal(m.tools, false, `${at}: the list tools overlap`);
      assert.equal(m.bulk, false, `${at}: the selection bar buttons overlap`);
      assert.equal(m.chips, false, `${at}: the window chips overlap`);
      assert.equal(m.title, true, `${at}: the list title keeps at least 260 pixels beside its tools`);
      if (width === 390) assert.deepEqual(m.small, [], `${at}: every control is a 40 pixel touch target on a phone`);
    }
  }
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a window reaches only lists that keep actions: a list that keeps none reads in full, is refused at most once, and never when the Overview already says so', async () => {
  const refusal = 'this decision list keeps no actions, so it has no window of actions to show';
  const refused = [];
  const records = ({ route, json, seen }) => {
    const body = route.request().postDataJSON();
    seen.records.push(body);
    const keeps = body.page === 'n01_u05';
    if (!keeps && ('window' in body || 'window_limit' in body)) {
      refused.push(body);
      return json(400, { error: refusal, code: 'no_window' });
    }
    return json(200, { rows: ROWS.slice(body.offset, body.offset + body.limit), total: ROWS.length, offset: body.offset, limit: body.limit, actions: keeps,
      changes: false, summary: keeps ? SUMMARY : null, errors: {} });
  };
  const fetchErrors = (errors) => errors.filter((e) => !/status of 400/.test(e));
  const listed = (page) => page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length > 0);
  const { page, seen, context } = await openWith(appInfo(DECIDE, 2, TABLE), tracked({ records }).routes, { prefs: { window: 'today', limit: 10 } });
  await waitList(page);
  assert.deepEqual([seen.records[0].page, seen.records[0].window, seen.records[0].window_limit], ['n01_u05', 'today', 10],
    'a list that keeps actions gets the window and the limit on its first read');
  await page.goto(`${served.base}#/n02_u01`);
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  await listed(page);
  assert.equal(refused.length, 1, 'the one refused read is asked again without the window');
  assert.equal(await page.locator('.card--table tbody tr').count(), 25, 'no limit applies to a list that keeps no actions');
  assert.equal(await page.locator('.tile-err').count(), 0, 'the refusal is not shown as an error');
  await until(() => !('window' in seen.records.at(-1)));
  await page.goto(`${served.base}#/n01_u05`);
  await waitList(page);
  const back = seen.records.length;
  await page.goto(`${served.base}#/n02_u01`);
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  await listed(page);
  await until(() => seen.records.slice(back).some((b) => b.page === 'n02_u01'));
  assert.deepEqual(seen.records.slice(back).filter((b) => b.page === 'n02_u01' && 'window' in b), [], 'the App remembers that this list keeps no actions');
  assert.equal(refused.length, 1);
  assert.deepEqual(fetchErrors(seen.errors), []);
  await context.close();

  const hub = { today: TODAY, quarter: '2026-10-01', since: '2026-08-03', errors: {}, pages: { n01_u05: entry([]), n02_u01: { ...entry([]), actions: false, money: false } } };
  const known = await openWith(appInfo(DECIDE, 2, TABLE), tracked({ records, overview: ({ json }) => json(200, hub) }).routes,
    { prefs: { window: 'today', limit: 10 }, hash: '#/overview' });
  await known.page.getByRole('region', { name: 'Your work' }).waitFor();
  await known.page.goto(`${served.base}#/n02_u01`);
  await listed(known.page);
  assert.deepEqual(known.seen.records.filter((b) => b.page === 'n02_u01' && ('window' in b || 'window_limit' in b)), [],
    'the Overview already said this use case keeps no actions, so its list is never asked with the window');
  assert.equal(refused.length, 1);
  assert.deepEqual(known.seen.errors, []);
  await known.context.close();

  const plain = await openWith(appInfo({}, 1, TABLE), {}, { prefs: { window: 'today', limit: 10 } });
  await listed(plain.page);
  assert.deepEqual(plain.seen.records.filter((b) => 'window' in b || 'window_limit' in b), [], 'a page that tracks no decisions never sends the window');
  assert.deepEqual(plain.seen.errors, []);
  await plain.context.close();
});

test('All open names its window to the Overview, and a use case that keeps no actions is called out only once you pick a window or a limit', async () => {
  const note = 'this use case keeps no actions, so the window does not apply to it';
  const overview = ({ route, json, seen }) => {
    (seen.hub ||= []).push(route.request().postDataJSON());
    return json(200, { today: TODAY, quarter: '2026-10-01', since: '2026-08-03', errors: {}, window: { window: 'all', limit: null, today: TODAY },
      pages: { n01_u05: { ...entry([item('t', 'Due today', TODAY)]), window_note: '' }, n02_u01: { ...entry([]), actions: false, money: false, window_note: note } } });
  };
  for (const [prefs, said] of [[undefined, null], [{ window: 'week' }, 'Your window does not apply to Second desk 1, because it keeps no actions.'],
    [{ limit: 10 }, 'Your window does not apply to Second desk 1, because it keeps no actions.']]) {
    const { page, seen, context } = await openWith(appInfo(DECIDE, 2, TABLE), { overview }, { hash: '#/overview', prefs });
    await page.getByRole('region', { name: 'Your work' }).locator('tbody tr').first().waitFor();
    if (!prefs) assert.deepEqual(seen.hub.at(-1), { window: 'all', time_zone: 'Asia/Dubai' }, 'the default asks for All open by name, in the time zone of the person');
    if (said) assert.equal(await page.locator('[data-window-note]').innerText(), said);
    else assert.equal(await page.locator('[data-window-note]').count(), 0, 'nobody picked a window, so none is called out');
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

const BATCH_DONE = 'a'.repeat(32);
const DONE = { ...ROWS[1], _inspire_status: 'Done', _inspire_owner: OTHER, _inspire_closed_by: OTHER, _inspire_closed_at: '2026-10-26T15:20:00.000Z',
  _inspire_closed_batch: BATCH_DONE, _inspire_closed_undo: false, _inspire_closed_note: 'Repriced the shelf', _inspire_closed_reason: null, _inspire_closed_comment: 'Called the store' };
const GONE = { ...ROWS[2], _inspire_status: 'Dismissed', _inspire_closed_by: PERSON, _inspire_closed_at: '2026-10-25T08:00:00.000Z', _inspire_closed_batch: 'b'.repeat(32),
  _inspire_closed_undo: true, _inspire_closed_note: null, _inspire_closed_reason: 'Known issue', _inspire_closed_comment: null };
const OPEN = { ...ROWS[0], _inspire_status: 'New' };

function everything(calls) {
  const all = [OPEN, DONE, GONE];
  const byKey = Object.fromEntries(all.map((r) => [r.record_key, r]));
  return tracked({
    records: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      seen.records.push(body);
      const shown = body.window ? [OPEN] : all;
      return json(200, { rows: shown.slice(body.offset, body.offset + body.limit), total: shown.length, offset: body.offset, limit: body.limit, actions: true,
        changes: false, summary: SUMMARY, errors: {}, as_of_us: '5555555555555555' });
    },
    'records/history': ({ url, json }) => {
      const r = byKey[url.searchParams.get('record_key')] || OPEN;
      const current = { ...CURRENT, ...r, action_status: r._inspire_status, action_owner: r._inspire_owner || null };
      return json(200, { ...HISTORY, record_key: r.record_key, current, versions: [current] });
    },
    'records/undo': ({ route, json }) => { calls.undos.push(route.request().postDataJSON()); return json(200, CONTRACT.undo.response); },
  });
}

test('Everything shows the fixed and dismissed records All open hides, each with who closed it, when and why, and its window is kept like the others', async () => {
  const calls = { undos: [] };
  const { routes } = everything(calls);
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes);
  await waitList(page);
  assert.deepEqual(await labels(page), [label(1)], 'All open shows the open record only');
  await page.click('[data-settings-open]');
  await page.locator('[data-settings] [data-group="my_view"]').waitFor();
  assert.deepEqual(await page.locator('select[name="my_window"] option').allInnerTexts(), ['This hour', 'Today', 'This week', 'This month', 'All open', 'Everything']);
  await page.locator('select[name="my_window"]').selectOption('everything');
  await until(() => !('window' in seen.records.at(-1)));
  assert.equal((await mine(page)).window, 'everything', 'the window is kept in this browser like the others');
  const before = seen.records.length;
  await page.reload();
  await waitList(page);
  const asked = seen.records[before];
  assert.deepEqual(['window', 'window_limit', 'time_zone', 'utc_offset_min'].filter((k) => k in asked), [], 'Everything sends no window, so the server lists every record');
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length === 3);
  assert.deepEqual(await labels(page), [label(1), label(2), label(3)]);
  const chips = page.getByRole('group', { name: 'Your window' });
  assert.equal(await chips.getByRole('button', { name: 'Everything' }).getAttribute('aria-pressed'), 'true');
  assert.equal(await page.locator('[data-start-work]').count(), 0, 'Start working goes through open records, so it waits for a window of open ones');
  assert.deepEqual(await page.locator('.card--table tbody td .status').allInnerTexts(), ['New', 'Fixed', 'Not a real issue']);
  assert.deepEqual(await page.locator('.card--table tbody [data-closed-by]').allInnerTexts(), [
    `By ${OTHER} on Oct 26, 2026, 03:20 PM UTC. Note: Repriced the shelf`,
    `By ${PERSON} on Oct 25, 2026, 08:00 AM UTC. Why: Known issue`]);
  await chips.getByRole('button', { name: 'All open' }).click();
  await until(() => seen.records.at(-1).window === 'all');
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length === 1);
  assert.equal(await page.locator('.card--table tbody [data-closed-by]').count(), 0, 'All open hides the fixed and the dismissed record');
  assert.equal(await page.locator('[data-start-work]').count(), 1);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a closed record undoes the change that closed it from its own page, after saying what Undo puts back, and an undo that closed it offers none', async () => {
  const calls = { undos: [] };
  const { routes } = everything(calls);
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes, { prefs: { window: 'everything' } });
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length === 3);
  await page.locator('.cell-t').nth(1).click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('.done').waitFor();
  assert.equal(await drawer.locator('[data-closed-by]').innerText(), `By ${OTHER} on Oct 26, 2026, 03:20 PM UTC. Note: Repriced the shelf`);
  await drawer.getByRole('button', { name: 'Undo this change' }).click();
  const ask = drawer.getByRole('group', { name: 'Undo this change' });
  assert.equal(await ask.locator('span').innerText(), 'Undo puts back every record this change touched, as they were before it, and keeps both versions in their history.');
  assert.equal(calls.undos.length, 0, 'nothing is undone until the person says so');
  await ask.getByRole('button', { name: 'Undo it' }).click();
  await until(() => calls.undos.length === 1);
  assert.deepEqual(calls.undos[0], { page: 'n01_u05', batch_id: BATCH_DONE });
  await page.waitForFunction(() => /^Undone: 1 record is back as it was\./.test(document.querySelector('.toast .toast-t')?.textContent || ''));
  await page.keyboard.press('Escape');
  await page.locator('.cell-t').nth(2).click();
  await drawer.locator('[data-closed-by]').waitFor();
  assert.equal(await drawer.getByRole('button', { name: 'Undo this change' }).count(), 0, 'the close was itself an undo, so it is not undone from the record');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const SKIPPED = (n) => `Skipped ${n} record${n === 1 ? '' : 's'} already closed: fixed, dismissed or could not fix. To reopen one, open it and undo its change.`;
const EDIT_TOO = { options: { modify: true, replace_edits: false, decisions: true } };
const toastText = (page) => page.locator('.toast.is-on .toast-t').innerText();

test('in Everything a closed record is read-only: its closure line, its history and Undo, and no action form, note, edit or delete', async () => {
  const calls = { undos: [] };
  const { routes, calls: made } = everything(calls);
  const { page, seen, context } = await openWith(appInfo(EDIT_TOO, 1, TABLE), routes, { prefs: { window: 'everything' } });
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length === 3);
  const rowActs = page.locator('.card--table tbody .row-acts');
  assert.deepEqual(await Promise.all([0, 1, 2].map((i) => rowActs.nth(i).locator('button').count())), [3, 1, 1], 'a closed row keeps only its history');
  const drawer = page.locator('dialog.drawer');
  await page.locator('.cell-t').nth(1).click();
  await drawer.locator('.done').waitFor();
  assert.equal(await drawer.locator('[data-closed-by]').innerText(), `By ${OTHER} on Oct 26, 2026, 03:20 PM UTC. Note: Repriced the shelf`);
  assert.equal(await drawer.locator('[data-read-only]').innerText(), 'Read-only in Everything. To reopen it, undo this change.');
  assert.deepEqual(await Promise.all(['Action', 'Add a note'].map((name) => drawer.getByRole('region', { name, exact: true }).count())), [0, 0]);
  assert.equal(await drawer.getByRole('region', { name: 'Next best action', exact: true }).count(), 1, 'what the AI advised stays readable');
  assert.equal(await drawer.locator('form').count(), 0, 'no form can change a closed record here');
  assert.equal(await drawer.locator('.dr-hist').count(), 1, 'its history stays');
  assert.deepEqual(await drawer.locator('.panel-f button').allInnerTexts(), ['Undo this change', 'Close']);
  for (const key of ['d', 's', 'a']) {
    await page.keyboard.press(key);
    await page.waitForFunction((text) => document.querySelector('.toast.is-on .toast-t')?.textContent === text, SKIPPED(1));
  }
  assert.equal(made.acts.length, 0, 'no key acts on the closed record in the open drawer');
  await page.keyboard.press('Escape');
  await page.locator('.cell-t').nth(2).click();
  await drawer.locator('[data-read-only]').waitFor();
  assert.equal(await drawer.locator('[data-read-only]').innerText(), 'Read-only in Everything. This change cannot be undone here, so the record stays closed.');
  assert.deepEqual(await drawer.locator('.panel-f button').allInnerTexts(), ['Close']);
  await page.keyboard.press('Escape');
  await page.locator('.cell-t').nth(0).click();
  await drawer.getByRole('region', { name: 'Action', exact: true }).waitFor();
  assert.equal(await drawer.locator('[data-read-only]').count(), 0, 'an open record keeps its action form in Everything');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('in Everything the keys and the selection skip closed records and say how many they skipped, and act on the open ones only', async () => {
  const calls = { undos: [] };
  const { routes, calls: made } = everything(calls);
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes, { prefs: { window: 'everything' } });
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length === 3);
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr')[1]?.classList.contains('is-cursor'));
  for (const key of ['d', 's', 'x']) {
    await page.keyboard.press(key);
    await page.waitForFunction((text) => document.querySelector('.toast.is-on .toast-t')?.textContent === text, SKIPPED(1));
  }
  assert.equal(await page.locator('.bulk').count(), 0, 'x selected nothing');
  const boxes = page.locator('.card--table tbody .pick-l input');
  assert.deepEqual(await Promise.all([0, 1, 2].map((i) => boxes.nth(i).isDisabled())), [false, true, true]);
  assert.equal(await boxes.nth(1).getAttribute('title'), 'Already closed, so it cannot be selected');
  await page.getByRole('checkbox', { name: 'Select every record on this page' }).check();
  await page.waitForFunction((text) => document.querySelector('.toast.is-on .toast-t')?.textContent === text, SKIPPED(2));
  assert.equal(await page.locator('.bulk b').innerText(), '1 selected:');
  assert.equal(await page.locator('.bulk').getByRole('button', { name: /^Select all/ }).count(), 0, 'Everything never selects every match, closed ones among them');
  await page.locator('.bulk').getByRole('button', { name: 'Mark done…' }).click();
  await page.getByRole('button', { name: 'Mark 1 record done' }).click();
  await until(() => made.acts.length === 1);
  assert.deepEqual(made.acts[0].record_keys, [OPEN.record_key], 'the act names the open record only');
  assert.equal(made.acts[0].match, undefined);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Everything leaves the Overview counts as All open has them, with a limit or without, and names no window note', async () => {
  const items = [item('t', 'Due today', TODAY), item('w', 'Due next week', '2026-11-04')];
  const asked = {};
  for (const prefs of [{ window: 'all' }, { window: 'everything' }, { window: 'all', limit: 10 }, { window: 'everything', limit: 10 }]) {
    const { page, seen, context } = await openWith(appInfo(DECIDE, 2, TABLE), { overview: hubOf(items) }, { hash: '#/overview', prefs });
    const work = page.getByRole('region', { name: 'Your work' });
    await work.locator('tbody tr').first().waitFor();
    asked[JSON.stringify(prefs)] = { body: seen.hub.at(-1), rows: await work.locator('tbody tr').allInnerTexts(), note: await page.locator('[data-window-note]').count() };
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
  assert.deepEqual(asked['{"window":"everything"}'], asked['{"window":"all"}']);
  assert.deepEqual(asked['{"window":"everything","limit":10}'], asked['{"window":"all","limit":10}']);
  assert.deepEqual(asked['{"window":"everything"}'].body, { window: 'all', time_zone: 'Asia/Dubai' });
  assert.equal(asked['{"window":"everything"}'].note, 0);
});
