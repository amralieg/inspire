import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import {
  CONTRACT, CURRENT, DECIDE, HISTORY, LABEL, OTHER, PERSON, ROWS, SUMMARY, TABLE, appInfo, chartsDrawn, isInboxAsk, lister, myWorkOf, openApp, prefsFirst, resizeTo, serveDist, tracked, until, pickCase, goRail,
} from './harness.mjs';
import { monitorRoutes } from './exampleRoutes.mjs';
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
const REFUSE_CLIPBOARD = () => {
  Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: () => Promise.reject(new DOMException('Write permission denied.', 'NotAllowedError')) } });
};

async function openWith(info, routes, { prefs, hash = '#/n01_u05/work', init, width } = {}) {
  const watch = async (page) => {
    if (init) await page.addInitScript(init);
    if (prefs) await prefsFirst(MY, PERSON, prefs)(page);
  };
  return openApp(browser, served.base, info, { routes, clock: CLOCK, width, timezone: 'Asia/Dubai', hash, watch });
}

const lists = (seen) => seen.records.filter((b) => !isInboxAsk(b));
const waitList = (page) => page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length > 0 && document.querySelector('.list-tools'));

function dueList(rows) {
  return ({ route, json, seen }) => {
    const body = route.request().postDataJSON();
    seen.records.push(body);
    const dated = body.window ? rows : rows.map(({ _inspire_due, _inspire_snooze, ...r }) => r);
    const shown = body.window === 'today' ? dated.filter((r) => !r._inspire_due || r._inspire_due <= TODAY) : dated;
    const narrowed = body.filters?.category?.length ? [] : shown;
    const from = body.offset || 0;
    return json(200, { rows: narrowed.slice(from, from + body.limit), total: narrowed.length, offset: from, limit: body.limit, actions: true,
      changes: false, summary: SUMMARY, errors: {} });
  };
}

const item = (key, labelText, due, extra = {}) => ({ key, label: labelText, tier: 'Act now', money: 100, why: null, owner: PERSON, status: 'New', reason: null, due, ...extra });
const entry = (items) => ({
  visible: true, tracked: true, money: true, actions: true, categories: [], served: 'delta', items, total: items.length, truncated: false,
  done: { fixed: 0, fixed_q: 0, dismissed: 0, dismissed_q: 0, saved_n: 0, saved: 0, saved_q_n: 0, saved_q: 0, first_fixed: null, first_saved: null },
  weeks: [], runs: { updated: '2026-10-27T06:00:00Z', as_of: '2026-10-27', cadence_days: 7, next: '2026-11-03', stale: false, count: 3, failed: false },
});
test('My view is in Settings for everyone, the window chips follow it, it survives a reload, and the list asks the server for that window', async () => {
  const { routes } = tracked();
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes);
  await waitList(page);
  assert.deepEqual([lists(seen)[0].window, lists(seen)[0].time_zone, 'window_limit' in lists(seen)[0]], ['all', 'Asia/Dubai', false],
    'All open names its window from the first read, with no limit');
  await goRail(page, 'settings');
  await page.locator('[data-settings] [data-group="my_view"]').waitFor();
  assert.equal(await page.locator('select[name="my_window"]').inputValue(), 'all');
  assert.equal(await page.locator('select[name="my_limit"]').inputValue(), '0');
  await page.locator('select[name="my_window"]').selectOption('week');
  await goRail(page, 'work');
  await until(() => lists(seen).at(-1).window === 'week');
  assert.equal(lists(seen).at(-1).time_zone, 'Asia/Dubai', 'the list says which week it means, here in Dubai time');
  const chips = page.getByRole('group', { name: 'Your window' });
  await chips.waitFor();
  assert.deepEqual(await chips.locator('button').allInnerTexts(), ['This hour', 'Today', 'This week', 'This month', 'All open', 'Everything']);
  assert.equal(await chips.getByRole('button', { name: 'This week' }).getAttribute('aria-pressed'), 'true');
  assert.equal((await mine(page)).window, 'week');
  const before = lists(seen).length;
  await page.reload();
  await waitList(page);
  assert.equal(lists(seen)[before].window, 'week', 'the first list request after a reload already asks for the window');
  await chips.getByRole('button', { name: 'Today' }).click();
  await until(() => lists(seen).at(-1).window === 'today');
  await goRail(page, 'settings');
  assert.equal(await page.locator('select[name="my_window"]').inputValue(), 'today', 'the setting follows the chip');
  await goRail(page, 'work');
  await chips.getByRole('button', { name: 'All open' }).click();
  await until(() => lists(seen).at(-1).window === 'all');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a window chip hides a record outside the window while an overdue record stays, first, on the list and in the inbox', async () => {
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
  await page.locator('[data-rail="inbox"]').click();
  const due = page.locator('[data-inbox-group="due"] [data-inbox-item]');
  await due.first().waitFor();
  assert.deepEqual(await due.locator('.inbox-t bdi').allInnerTexts(), [label(3), label(1)], 'the inbox lists the overdue record first and leaves out the one due next week');
  assert.match(await due.first().locator('small').innerText(), /Overdue since/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a limit shows the top N on the list with a line that says how many more there are', async () => {
  const { routes } = tracked();
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes, { prefs: { limit: 10 } });
  await waitList(page);
  assert.equal(await page.locator('.card--table tbody tr').count(), 10);
  assert.deepEqual([seen.records.at(-1).limit, seen.records.at(-1).window_limit, seen.records.at(-1).window], [10, 10, 'all']);
  assert.equal(await page.locator('.pager-n').innerText(), 'Showing 1 to 10 of 10');
  assert.equal(await page.getByRole('button', { name: 'Next page' }).isDisabled(), true);
  assert.equal(await page.locator('.card--table [data-limit]').innerText(), 'Your limit shows the top 10 of 30. 20 more are not shown; change the limit in Settings.');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Compact density fits more rows, and it and the rows per page are kept for the person', async () => {
  const { routes } = tracked();
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes);
  await waitList(page);
  const pad = () => page.locator('.card--table tbody td').nth(1).evaluate((td) => getComputedStyle(td).paddingTop);
  assert.equal(await pad(), '9px');
  await goRail(page, 'settings');
  await page.locator('select[name="my_density"]').selectOption('compact');
  assert.equal(await page.locator('.app').getAttribute('data-density'), 'compact');
  await goRail(page, 'work');
  await waitList(page);
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
  const { page, seen, context } = await openWith(info, {}, { hash: '#/n01_u05/dashboard' });
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
  await pickCase(page, 'Second desk 1');
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  await page.waitForFunction(chartsDrawn, 4);
  assert.equal(await page.locator('.card--folded, .fold-s.is-folded').count(), 0, 'another page keeps its own folds');
  assert.equal(await page.getByRole('button', { name: 'Unfold Loss to discounts by month' }).count(), 0);
  await pickCase(page, 'Price-loss decision desk');
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
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes, { hash: '#/n01_u05/dashboard' });
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

test('Focus on the list folds every chart and the key numbers of a page that shows both, and Work, which has no chart, offers no Focus', async () => {
  const { routes } = tracked();
  const work = await openWith(appInfo(DECIDE, 1, TABLE), routes);
  await waitList(work.page);
  assert.equal(await work.page.getByRole('button', { name: 'Focus on the list' }).count(), 0, 'Work holds no chart or key number, so there is nothing to fold');
  assert.deepEqual(work.seen.errors, []);
  await work.context.close();
  const info = appInfo(DECIDE, 1, {}, 'examples/monitor_triage.json');
  const { page, seen, context } = await openApp(browser, served.base, info, { routes: monitorRoutes(), clock: CLOCK, timezone: 'Asia/Dubai' });
  const drawn = () => page.evaluate(() => document.querySelectorAll('[data-section] canvas').length);
  await page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 3);
  const charts = await drawn();
  const expanded = () => page.locator('[data-fold]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-expanded')));
  assert.ok((await expanded()).length >= 4 && (await expanded()).every((v) => v === 'true'));
  const focus = page.getByRole('button', { name: 'Focus on the list' });
  await focus.click();
  await page.waitForFunction(() => !document.querySelector('[data-section] canvas'));
  assert.ok((await expanded()).every((v) => v === 'false'));
  assert.equal(await focus.getAttribute('aria-pressed'), 'true');
  await focus.click();
  await page.waitForFunction((n) => document.querySelectorAll('[data-section] canvas').length === n, charts);
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
  assert.equal(new URL(copied).hash, '#/n01_u05/work?rec=R001');
  const other = await openWith(appInfo(DECIDE, 1, TABLE), tracked().routes, { hash: new URL(copied).hash });
  await other.page.waitForFunction((t) => document.querySelector('dialog.drawer[open] h2')?.textContent === t, LABEL);
  assert.deepEqual([...seen.errors, ...other.seen.errors], []);
  await other.context.close();
  await context.close();
});

test('when the browser refuses the clipboard, the record link shows selected in a dialog to copy by hand', async () => {
  const { routes } = tracked();
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes, { init: REFUSE_CLIPBOARD });
  await waitList(page);
  await page.locator('.cell-t').first().click();
  await page.locator('dialog.drawer .dr-act').waitFor();
  for (const round of ['refused', 'missing']) {
    if (round === 'missing') await page.evaluate(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: undefined }));
    await page.getByRole('button', { name: 'Copy a link to this record' }).click();
    const dialog = page.getByRole('dialog', { name: 'Copy this link' });
    await dialog.waitFor();
    const field = await page.evaluate(() => {
      const input = document.querySelector('dialog[aria-label="Copy this link"] input');
      return { value: input.value, focused: document.activeElement === input, start: input.selectionStart, end: input.selectionEnd, readOnly: input.readOnly };
    });
    const url = `${new URL(page.url()).origin}${new URL(page.url()).pathname}#/n01_u05/work?rec=R001`;
    assert.deepEqual(field, { value: url, focused: true, start: 0, end: url.length, readOnly: true }, round);
    assert.notEqual(await page.evaluate(() => document.querySelector('.toast .toast-t')?.textContent || ''), 'Link to this record copied', round);
    await dialog.getByRole('button', { name: 'Done' }).click();
    await dialog.waitFor({ state: 'hidden' });
  }
  assert.deepEqual(seen.errors, []);
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
  const linked = await openWith(appInfo(DECIDE, 1, TABLE), routes, { hash: `#/n01_u05/work?f=${encodeFilters({ s: { category: ['Music'] } })}` });
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

test('Performance says what you did today: the Today chip asks for today in your time zone and shows what you closed, with no read of any use case changes', async () => {
  const asked = [];
  const routes = {
    my_work: ({ route, json, seen }) => {
      (seen.work ||= []).push(route.request().postDataJSON());
      return json(200, { ...myWorkOf('n01_u05'), period: { window: 'today', zone: 'Asia/Dubai', today: TODAY, start_day: TODAY, end_day: '2026-10-28' } });
    },
    'records/batches': ({ json, url }) => { asked.push(url.searchParams.get('page')); return json(200, { batches: [], limit: 20 }); },
  };
  const { page, seen, context } = await openWith(appInfo(DECIDE, 2, TABLE), routes, { hash: '#/n01_u05/performance' });
  await page.locator('[data-performance] .kpi').first().waitFor();
  await page.locator('[data-period]').getByRole('button', { name: 'Today' }).click();
  await until(() => seen.work?.at(-1)?.window === 'today');
  assert.deepEqual(seen.work.at(-1), { page: 'n01_u05', window: 'today', time_zone: 'Asia/Dubai' });
  await page.locator('[data-performance] .kpi').first().waitFor();
  assert.equal(await page.locator('[data-performance] [data-tile="cleared"] .kpi-v').innerText(), '4 (40%)', 'the 4 items you closed today show');
  assert.deepEqual(asked, [], 'my_work already counts it, so no use case is asked for its changes');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

function layoutCheck() {
  const shown = (el) => getComputedStyle(el).display !== 'none' && getComputedStyle(el).visibility !== 'hidden' && el.getBoundingClientRect().width > 0;
  const bleed = [...document.querySelectorAll('.app *')].filter((el) => shown(el) && !el.closest('.tbl-wrap, .tabs, .work-tabs, .side:not(.is-open)')
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

test('the list, its tools, the selection bar and Performance fit 1440, 1024 and 390 pixels, and every control is 40 pixels or more on a phone', async () => {
  const { routes } = tracked({ my_work: ({ json }) => json(200, myWorkOf('n01_u05')) });
  const { page, seen, context } = await openWith(appInfo(DECIDE, 2, TABLE), routes, { width: 1440 });
  await waitList(page);
  await page.getByRole('checkbox', { name: `Select ${label(1)}` }).check();
  for (const screen of ['list', 'performance']) {
    if (screen === 'performance') {
      await page.goto(`${served.base}#/n01_u05/performance`);
      await page.locator('[data-performance] [data-overdue-row]').first().waitFor();
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

test('a window reaches only lists that keep actions: a list that keeps none reads in full, is refused at most once, and is remembered after that', async () => {
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
  await page.locator('[data-rail="inbox"]').waitFor();
  assert.deepEqual([lists(seen)[0].page, lists(seen)[0].window, lists(seen)[0].window_limit], ['n01_u05', 'today', 10],
    'a list that keeps actions gets the window and the limit on its first read');
  await page.goto(`${served.base}#/n02_u01/work`);
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  await listed(page);
  assert.equal(refused.length, 1, 'the one refused read is asked again without the window');
  await until(() => seen.records.some((b) => b.page === 'n02_u01' && b.changed));
  await page.waitForFunction(() => !document.querySelector('[data-rail="inbox"]'));
  assert.deepEqual(seen.records.filter((b) => b.page === 'n02_u01' && (b.mine || b.unowned)), [], 'the inbox never asks a list that keeps no actions for your records');
  assert.equal(await page.locator('[data-rail="inbox"]').count(), 0, 'a list that keeps no actions has no inbox and never asks it for your records');
  assert.equal(await page.locator('.card--table tbody tr').count(), 25, 'no limit applies to a list that keeps no actions');
  assert.equal(await page.locator('.tile-err').count(), 0, 'the refusal is not shown as an error');
  await until(() => !('window' in seen.records.at(-1)));
  await page.goto(`${served.base}#/n01_u05/work`);
  await waitList(page);
  const back = seen.records.length;
  await page.goto(`${served.base}#/n02_u01/work`);
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  await listed(page);
  await until(() => seen.records.slice(back).some((b) => b.page === 'n02_u01'));
  assert.deepEqual(seen.records.slice(back).filter((b) => b.page === 'n02_u01' && 'window' in b), [], 'the App remembers that this list keeps no actions');
  assert.equal(refused.length, 1);
  assert.deepEqual(fetchErrors(seen.errors), []);
  await context.close();

  const plain = await openWith(appInfo({}, 1, TABLE), {}, { prefs: { window: 'today', limit: 10 } });
  await listed(plain.page);
  assert.deepEqual(plain.seen.records.filter((b) => 'window' in b || 'window_limit' in b), [], 'a page that tracks no decisions never sends the window');
  assert.deepEqual(plain.seen.errors, []);
  await plain.context.close();

  const informational = appInfo(DECIDE, 1, TABLE);
  informational.pages[0].layout = { ...informational.pages[0].layout, decides: false, informational: true };
  const board = await openWith(informational, {}, { prefs: { window: 'today', limit: 10 } });
  await listed(board.page);
  assert.deepEqual(board.seen.records.filter((b) => 'window' in b || 'window_limit' in b), [], 'an informational page tracks no decisions, so it never sends the window');
  assert.deepEqual(board.seen.errors, []);
  await board.context.close();
});

const BATCH_DONE = 'a'.repeat(32);
const DONE = { ...ROWS[1], _inspire_status: 'Done', _inspire_owner: OTHER, _inspire_closed_by: OTHER, _inspire_closed_at: '2026-10-26T15:20:00.000Z',
  _inspire_closed_batch: BATCH_DONE, _inspire_closed_undo: false, _inspire_closed_can_undo: true, _inspire_closed_note: 'Repriced the shelf', _inspire_closed_reason: null,
  _inspire_closed_comment: 'Called the store' };
const GONE = { ...ROWS[2], _inspire_status: 'Dismissed', _inspire_closed_by: PERSON, _inspire_closed_at: '2026-10-25T08:00:00.000Z', _inspire_closed_batch: 'b'.repeat(32),
  _inspire_closed_undo: true, _inspire_closed_can_undo: true, _inspire_closed_note: null, _inspire_closed_reason: 'Known issue', _inspire_closed_comment: null };
const OPEN = { ...ROWS[0], _inspire_status: 'New' };

function everything(calls, done = DONE) {
  const all = [OPEN, done, GONE];
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
  await goRail(page, 'settings');
  await page.locator('[data-settings] [data-group="my_view"]').waitFor();
  assert.deepEqual(await page.locator('select[name="my_window"] option').allInnerTexts(), ['This hour', 'Today', 'This week', 'This month', 'All open', 'Everything']);
  await page.locator('select[name="my_window"]').selectOption('everything');
  await goRail(page, 'work');
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
  assert.deepEqual(await page.locator('.card--table tbody td .status').allInnerTexts(), ['New', 'Done', 'Not an issue']);
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

test('a record someone else closed offers no Undo to a person who owns no part of the use case, and says who can undo it', async () => {
  const calls = { undos: [] };
  const { routes } = everything(calls, { ...DONE, _inspire_closed_can_undo: false });
  const { page, seen, context } = await openWith(appInfo(EDIT_TOO, 1, TABLE), routes, { prefs: { window: 'everything' } });
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length === 3);
  await page.locator('.cell-t').nth(1).click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('[data-read-only]').waitFor();
  assert.equal(await drawer.locator('[data-read-only]').innerText(),
    'Read-only in Everything. Only the person who made this change or an owner of this use case can undo it.');
  assert.deepEqual(await drawer.locator('.panel-f button').allInnerTexts(), ['Close']);
  assert.equal(calls.undos.length, 0);
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
  const rowActs = page.locator('.card--table tbody .row-acts:not(.row-next-acts)');
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
  assert.equal(await page.locator('.bulk').getByRole('button', { name: /^Select all \d+ matching/ }).count(), 1, 'Everything offers Select all of the open matches only, never the closed ones');
  await page.locator('.bulk').getByRole('button', { name: 'Mark done…' }).click();
  await page.getByRole('button', { name: 'Mark 1 record done' }).click();
  await until(() => made.acts.length === 1);
  assert.deepEqual(made.acts[0].record_keys, [OPEN.record_key], 'the act names the open record only');
  assert.equal(made.acts[0].match, undefined);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

