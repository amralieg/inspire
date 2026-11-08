import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { build } from 'vite';
import react from '@vitejs/plugin-react';
import { actBody, CURRENT, DECIDE, F, FIELDS, FILTERS, HISTORY, LABEL, OTHER, PERSON, ROWS, SUMMARY, TABLE, appInfo, holdClock, lister, openApp, serveDist, tracked, until }
  from './harness.mjs';
import { actOutcome, actedText, actionForm, actionProblem, actionValues, changeBadge, explainContext, impactText, leftText, pageText, recordRef, undoText }
  from '../src/records.js';
import { matching, searchHint } from '../src/filters.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');

let served;
let base;
let browser;

before(async () => {
  served = await serveDist();
  base = served.base;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

const open = (info, routes = {}, options = {}) => openApp(browser, base, info, { hash: '#/n01_u05/work', ...options, routes });
const rowsShown = (page) => page.locator('.card--table tbody tr').count();

test('the list text, badges and impact line read like a person wrote them', () => {
  assert.equal(pageText(0, 50, 2341882), 'Showing 1 to 50 of 2,341,882');
  assert.equal(pageText(25, 5, 30), 'Showing 26 to 30 of 30');
  assert.equal(pageText(0, 0, 0), 'No records');
  assert.equal(pageText(1000, 0, 30), 'No records on this page; the list has 30');
  assert.equal(pageText(0, 25, 10000, true), 'Showing 1 to 25 of more than 10,000');
  assert.equal(pageText(20000, 0, 10000, true), 'No records on this page; the list has more than 10,000');
  assert.equal(impactText({ open: 14, done: 9, resolved: 6 }), 'Actions: 14 open · 9 done · 6 resolved by a later run (6/9)');
  assert.equal(impactText({ open: 3, done: 0, resolved: 0 }), 'Actions: 3 open · 0 done');
  assert.equal(impactText(null), '');
  assert.equal(impactText({ left: 4 }), '');
  assert.equal(leftText(12), '12 records left the list since the last run');
  assert.equal(leftText(1), '1 record left the list since the last run');
  assert.equal(leftText(0), '');
  assert.deepEqual(changeBadge({ _inspire_change: 'new' }), { text: 'New', kind: 'new' });
  assert.deepEqual(changeBadge({ _inspire_change: 'moved', _inspire_moved_to: 'Monitor' }), { text: 'Moved to Monitor', kind: 'moved' });
  assert.equal(changeBadge({ _inspire_change: 'moved' }), null);
  assert.equal(changeBadge({}), null);
  assert.deepEqual(recordRef({ key: 'entity_id' }, { entity_id: 'R1', _inspire_key: 'k-9' }), { record_key: 'k-9' });
});

test('an action sends only what changed, and a dismissal needs a reason of at most 300 characters', () => {
  const current = { action_owner: PERSON, action_status: 'Dismissed', action_due: '2026-11-01', action_note: 'n', dismiss_reason: 'Closed store' };
  const form = actionForm(current, OTHER);
  assert.deepEqual(form, { owner: PERSON, status: 'Dismissed', due: '2026-11-01', note: 'n', reason: 'Closed store', saved: '', how: '' });
  assert.deepEqual(actionValues(current, form), {});
  assert.deepEqual(actionValues(current, { ...form, status: 'Done' }), { action_status: 'Done' });
  assert.deepEqual(actionValues(current, { ...form, reason: 'Sold' }), { action_status: 'Dismissed', dismiss_reason: 'Sold' });
  assert.deepEqual(actionValues(null, actionForm(null, PERSON)), { action_owner: PERSON, action_status: 'New' });
  assert.deepEqual(actionValues({ action_owner: PERSON }, { owner: `  ${OTHER} `, status: 'In progress', due: '', note: ' ', reason: '' }),
    { action_owner: OTHER, action_status: 'In progress' });
  assert.equal(actionProblem({ status: 'Dismissed', reason: '  ' }), 'Say why it is not an issue');
  assert.equal(actionProblem({ status: 'Dismissed', reason: 'x'.repeat(301) }), 'Keep the reason to 300 characters');
  assert.equal(actionProblem({ status: 'Dismissed', reason: 'x'.repeat(300) }), '');
  assert.equal(actionProblem({ status: 'Done', reason: '' }), '');
});

test('the explain context carries at most 40 fields and the latest 10 versions', () => {
  const meta = { key: 'entity_id', label: 'entity_label', tier: 'priority_tier', action: 'recommended_action', columns: [], detail: [] };
  const many = Array.from({ length: 50 }, (_, i) => F(`metric_${String(i).padStart(2, '0')}`, 'text'));
  const versions = Array.from({ length: 12 }, (_, i) => ({ metric_00: `v${i}`, priority_tier: 'Review', recommended_action: 'Cut it', change_source: i ? 'edit' : 'run',
    changed_by: i ? OTHER : 'run 1', valid_from: `2026-10-${String(i + 1).padStart(2, '0')}T06:00:00Z`, ...Object.fromEntries(many.slice(1).map((f) => [f.name, 'x'])) }));
  const context = explainContext(meta, { fields: many, versions, current: versions.at(-1) }, { priority_tier: 'Review' });
  assert.equal(Object.keys(context.fields).length, 40);
  assert.equal(context.fields['Metric 00'], 'v11');
  assert.equal(context.history.length, 10);
  assert.match(context.history.at(-1), /^Oct 12, 2026, 06:00 AM UTC, sam\.roe@example\.com, Edited: Metric 00: v10 to v11$/);
  assert.equal(context.tier, 'Review');
  assert.equal(context.action, 'Cut it');
  const bare = explainContext({ ...meta, columns: [{ column: 'value', label: 'Loss', format: 'currency', currency: 'USD' }] }, null, { entity_label: 'A', entity_id: 'R1', value: 12 });
  assert.deepEqual(bare, { fields: { Item: 'A', Id: 'R1', Loss: '$12' }, tier: null, action: null, history: [] });
});

test('a searchable filter matches locally until the server answers', () => {
  assert.deepEqual(matching(['Books', 'Music', 7], 'o'), ['Books']);
  assert.deepEqual(matching(['Books', 7], ''), ['Books', '7']);
  const filter = { searchable: true, options: Array.from({ length: 500 }, (_, i) => `v${i}`) };
  assert.equal(searchHint(filter, '', {}), 'Showing the first 500 choices. Type to search all of them.');
  assert.equal(searchHint(filter, 'zz', { q: 'z', busy: false }), 'Searching all the choices…');
  assert.equal(searchHint(filter, 'zz', { q: 'zz', busy: false, options: Array(50).fill('a') }), 'Showing the first 50 matches. Type more to narrow them.');
  assert.equal(searchHint(filter, 'zz', { q: 'zz', busy: false, error: 'boom', options: [] }), 'The search failed: boom');
  assert.equal(searchHint(filter, 'zz', { q: 'zz', busy: false, options: ['a'] }), '');
  assert.equal(searchHint({ options: [] }, 'zz', {}), '');
});

test('the list pages through the server with 25, 50 or 100 rows and says where it is', async () => {
  const total = 2341882;
  const slice = (body) => Array.from({ length: body.limit }, (_, i) => ({ ...ROWS[0], entity_id: `R${body.offset + i + 1}`, entity_label: `Row ${body.offset + i + 1}`, rank: body.offset + i + 1 }));
  const { page, seen, context } = await open(appInfo(), { records: lister(slice, {}, total) });
  await page.waitForFunction(() => document.querySelector('.pager-n')?.textContent === 'Showing 1 to 25 of 2,341,882');
  assert.equal(await rowsShown(page), 25);
  assert.equal(await page.getByRole('button', { name: 'Previous page' }).isDisabled(), true);
  assert.match(await page.locator('.card--table .card-h p').first().innerText(), /^2,341,882 records\. Items from the latest run/);
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.waitForFunction(() => document.querySelector('.pager-n')?.textContent === 'Showing 26 to 50 of 2,341,882');
  assert.deepEqual([seen.records.at(-1).offset, seen.records.at(-1).limit], [25, 25]);
  assert.equal(await page.locator('.card--table tbody tr .cell-t b').first().innerText(), 'Row 26');
  await page.getByLabel('Rows per page').selectOption('100');
  await page.waitForFunction(() => document.querySelector('.pager-n')?.textContent === 'Showing 1 to 100 of 2,341,882');
  assert.deepEqual([seen.records.at(-1).offset, seen.records.at(-1).limit], [0, 100]);
  assert.equal(await rowsShown(page), 100);
  assert.deepEqual(await page.getByLabel('Rows per page').locator('option').allInnerTexts(), ['25', '50', '100']);
  assert.ok(seen.records.every((b) => b.limit <= 100));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('clicking a header sorts on the server and goes back to the first page', async () => {
  const { page, seen, context } = await open(appInfo());
  await page.waitForFunction(() => document.querySelector('.pager-n'));
  await page.getByRole('button', { name: 'Next page' }).click();
  await until(() => seen.records.at(-1).offset === 25);
  await page.getByRole('button', { name: 'Tier', exact: true }).click();
  await until(() => seen.records.at(-1).sort?.key === 'priority_tier');
  assert.deepEqual([seen.records.at(-1).sort, seen.records.at(-1).offset], [{ key: 'priority_tier', dir: 'asc' }, 0]);
  await page.getByRole('button', { name: /^Tier/ }).click();
  await until(() => seen.records.at(-1).sort?.dir === 'desc');
  assert.equal(await page.locator('th[aria-sort="descending"]').innerText(), 'TIER ↓');
  await page.getByRole('button', { name: 'Rank', exact: true }).click();
  await until(() => seen.records.at(-1).sort?.key === 'rank');
  assert.deepEqual(seen.records.at(-1).sort, { key: 'rank', dir: 'desc' });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('search waits 300 ms, asks the server once, and a late answer never replaces a newer one', async () => {
  const rows = (label) => [{ ...ROWS[0], entity_label: label }];
  const delays = { it: 900, ite: 50 };
  const answered = [];
  const routes = {
    records: async ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      seen.records.push(body);
      await new Promise((r) => setTimeout(r, delays[body.search] ?? 0));
      const label = body.search === 'it' ? 'Stale answer' : body.search === 'ite' ? 'Fresh answer' : 'Everything';
      const sent = await json(200, { rows: rows(label), total: 1, offset: 0, limit: body.limit, errors: {} });
      answered.push(body.search);
      return sent;
    },
  };
  const { page, seen, context } = await open(appInfo(), routes, { clock: Date.parse('2026-10-27T09:30:00Z') });
  await page.waitForFunction(() => document.querySelector('.card--table tbody .cell-t'));
  await holdClock(page);
  const box = page.getByLabel('Search the list');
  const asked = () => seen.records.map((b) => b.search);
  await box.pressSequentially('i');
  await page.clock.runFor(299);
  await box.pressSequentially('t');
  await page.clock.runFor(299);
  assert.deepEqual(asked(), [''], 'no request while each key comes within 300 ms of the last');
  await page.clock.runFor(1);
  await until(() => seen.records.some((b) => b.search === 'it'));
  await box.pressSequentially('e');
  await page.clock.runFor(300);
  await page.waitForFunction(() => document.querySelector('.card--table tbody .cell-t b')?.textContent === 'Fresh answer');
  await until(() => answered.includes('it'));
  await page.waitForTimeout(200);
  assert.equal(await page.locator('.card--table tbody .cell-t b').innerText(), 'Fresh answer');
  assert.deepEqual(asked(), ['', 'it', 'ite'], 'one request per pause in typing, none for the single i');
  await box.fill('');
  for (const key of '50%_x') {
    await box.pressSequentially(key);
    await page.clock.runFor(150);
  }
  await page.clock.runFor(300);
  await until(() => seen.records.at(-1).search === '50%_x');
  assert.equal(seen.records.filter((b) => b.search.startsWith('5')).length, 1);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('an empty list and a search with no match say so, with no pager', async () => {
  const routes = { records: lister((body) => [], {}, 0) };
  const { page, seen, context } = await open(appInfo(), routes);
  await page.waitForFunction(() => document.querySelector('.card--table .more')?.textContent === 'No record matches these filters.');
  assert.equal(await page.locator('.card--table .pager').count(), 0);
  assert.match(await page.locator('.card--table .card-h p').first().innerText(), /^0 records\./);
  await page.getByLabel('Search the list').fill('nothing like this');
  await page.waitForFunction(() => document.querySelector('.card--table .more .empty-t')?.textContent === 'No record matches this search.');
  await page.locator('.card--table .more').getByRole('button', { name: 'Clear filters' }).click();
  await page.waitForFunction(() => document.querySelector('.card--table .more')?.textContent === 'No record matches these filters.');
  assert.equal(await page.getByLabel('Search the list').inputValue(), '', 'Clear filters empties the search box');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a list that fails to load says why', async () => {
  const routes = { records: ({ json }) => json(502, { error: 'TABLE_OR_VIEW_NOT_FOUND' }) };
  const { page, seen, context } = await open(appInfo(), routes);
  await page.waitForFunction(() => /The list could not load: TABLE_OR_VIEW_NOT_FOUND/.test(document.querySelector('.card--table .tile-err')?.textContent || ''));
  assert.deepEqual(seen.errors.filter((e) => !/502/.test(e)), []);
  await context.close();
});

test('a filter with 500 choices searches the server and keeps the picked values in view', async () => {
  const many = { filters: FILTERS.filters.map((f) => (f.id === 'category' ? { ...f, options: Array.from({ length: 500 }, (_, i) => `v${String(i).padStart(3, '0')}`), searchable: true } : f)) };
  const asked = [];
  const routes = {
    filters: ({ json }) => json(200, many),
    'filters/options': ({ json, url }) => {
      asked.push(Object.fromEntries(url.searchParams));
      return json(200, { filter: 'category', q: url.searchParams.get('q'), options: ['zz-first', 'zz-second'] });
    },
  };
  const { page, seen, context } = await open(appInfo(), routes, { clock: Date.parse('2026-10-27T09:30:00Z') });
  await page.getByRole('button', { name: /^All/ }).first().click();
  const pop = page.getByRole('dialog', { name: 'Category' });
  assert.equal(await pop.locator('.msel-hint').innerText(), 'Showing the first 500 choices. Type to search all of them.');
  await page.getByRole('listbox', { name: 'Category' }).getByText('v001').click();
  const box = page.getByLabel('Search Category');
  await holdClock(page);
  await box.pressSequentially('z');
  await page.clock.runFor(200);
  await box.pressSequentially('z');
  await page.clock.runFor(200);
  assert.deepEqual(asked, [], 'no request while each key comes within the typing pause of the last');
  await page.clock.runFor(50);
  await page.clock.resume();
  await page.waitForFunction(() => [...document.querySelectorAll('.msel-pop .opt span')].some((s) => s.textContent === 'zz-first'));
  assert.deepEqual(asked, [{ page: 'n01_u05', filter: 'category', q: 'zz' }], 'one request after the typing pause');
  assert.deepEqual(await page.locator('.msel-pop .opt span').allInnerTexts(), ['v001', 'zz-first', 'zz-second']);
  assert.equal(await page.locator('.msel-pop .opt input').first().isChecked(), true);
  await page.getByRole('listbox', { name: 'Category' }).getByText('zz-second').click();
  await page.keyboard.press('Escape');
  await until(() => JSON.stringify(seen.records.at(-1)?.filters?.category) === JSON.stringify(['v001', 'zz-second']));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a decision on records the viewer cannot read says how many were left out, in the act and the undo text', () => {
  const outcome = actOutcome({ written: ['R1'], conflicts: [], conflicts_count: 0, left_out: 2, batch_id: 'b' });
  assert.equal(outcome.leftOut, 2);
  assert.equal(actedText(outcome, { action_status: 'Done' }), '1 record marked done. 2 records you cannot read were left out.');
  assert.equal(actedText(actOutcome({ written: ['R1'], conflicts_count: 1, left_out: 1 }), { action_status: 'Done' }),
    '1 record marked done. 1 record changed since you loaded it and was left as it is. 1 record you cannot read was left out.');
  assert.equal(actOutcome({ written: ['R1'] }).leftOut, 0, 'an older server that sends no count leaves nothing out');
  assert.equal(undoText({ restored: 1, skipped: 0, left_out: 1 }), 'Undone: 1 record is back as it was. 1 record you cannot read was left out.');
  assert.equal(undoText({ restored: 2, skipped: 1, skipped_sample: [{ record_key: 'R3' }], left_out: 3 }),
    'Undone: 2 records are back as they were. 1 record changed since and was left as it is: R3. 3 records you cannot read were left out.');
  assert.equal(undoText({ restored: 1, skipped: 0 }), 'Undone: 1 record is back as it was.');
});

test('in a per-user App with decisions on the list offers the tracker, and a bulk act says how many records were left out', async () => {
  const info = appInfo({ ...DECIDE, auth: 'user' }, 1, TABLE);
  assert.equal(info.auth, 'user');
  assert.equal(info.options.decisions, true, 'a per-user App keeps decisions on');
  const { calls, routes } = tracked({
    'records/act': ({ route, json }) => {
      const body = actBody(route);
      calls.acts.push(body);
      return json(200, { written: body.record_keys.slice(1), conflicts: [], conflicts_count: 0, left_out: 1, batch_id: 'a'.repeat(32) });
    },
  });
  const { page, seen, context } = await open(info, routes);
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody input[type="checkbox"]').length === 25);
  assert.equal(await page.getByRole('button', { name: 'My actions' }).count(), 1);
  assert.equal(await page.locator('.impact').count(), 1);
  await page.getByRole('checkbox', { name: `Select ${LABEL}` }).check();
  await page.getByRole('checkbox', { name: 'Select Item number 2 with a long descriptive name' }).check();
  await page.getByRole('button', { name: 'Assign to…' }).click();
  await page.locator('input[name="bulk_owner"]').fill(OTHER);
  await page.getByRole('button', { name: 'Assign 2 records' }).click();
  await until(() => calls.acts.length === 1);
  assert.deepEqual(calls.acts[0].record_keys, ['R001', 'R002']);
  await page.waitForFunction((who) => document.querySelector('.toast .toast-t')?.textContent
    === `1 record given to ${who}. 1 record you cannot read was left out.`, OTHER);
  await page.locator('.cell-t').first().click();
  await page.locator('dialog.drawer .dr-act').waitFor();
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('without the decisions option the list offers no action tracker, in a shared or a per-user App', async () => {
  const off = { options: { modify: true, replace_edits: false, decisions: false } };
  for (const info of [appInfo(off, 1, TABLE), appInfo({ ...off, auth: 'user' }, 1, TABLE)]) {
    const { calls, routes } = tracked();
    const { page, seen, context } = await open(info, routes);
    await page.waitForFunction(() => document.querySelector('.card--table tbody .cell-t'));
    assert.equal(info.options.decisions, false);
    assert.equal(calls.fields, 0);
    assert.equal(await page.getByRole('button', { name: 'Owner' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'My actions' }).count(), 0);
    assert.equal(await page.getByRole('checkbox').count(), 0);
    assert.equal(await page.locator('.impact').count(), 0);
    assert.equal(await page.locator('[data-act-all], [data-start-work]').count(), 0);
    await page.locator('.cell-t').first().click();
    await page.locator('dialog.drawer .hist-i').first().waitFor();
    assert.equal(await page.locator('.dr-act').count(), 0);
    assert.equal(await page.locator('dialog.drawer [data-act]').count(), 0, 'the drawer of an informational row has no Mark done, Not an issue or Ask Genie to fix');
    assert.equal(await page.locator('dialog.drawer').getByRole('button', { name: /^Explain/ }).count(), 1, 'the drawer offers Explain while Genie is on');
    assert.deepEqual(calls.acts, []);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('a page whose layout does not decide offers no action tracker even when the list keeps actions, in a shared or a per-user App', async () => {
  for (const info of [appInfo(DECIDE, 1, TABLE), appInfo({ ...DECIDE, auth: 'user' }, 1, TABLE)]) {
    info.pages[0].layout = { ...info.pages[0].layout, decides: false, informational: true };
    const { calls, routes } = tracked();
    const { page, seen, context } = await open(info, routes);
    await page.waitForFunction(() => document.querySelector('.card--table tbody .cell-t'));
    assert.equal(calls.fields, 0);
    assert.equal(await page.getByRole('button', { name: 'Owner' }).count(), 0);
    assert.equal(await page.getByRole('button', { name: 'My actions' }).count(), 0);
    assert.equal(await page.getByRole('checkbox').count(), 0);
    assert.equal(await page.locator('.impact').count(), 0);
    assert.equal(await page.locator('[data-act-all], [data-start-work]').count(), 0);
    await page.locator('.cell-t').first().click();
    await page.locator('dialog.drawer .hist-i').first().waitFor();
    assert.equal(await page.locator('.dr-act').count(), 0);
    assert.equal(await page.locator('dialog.drawer [data-act]').count(), 0, 'the drawer of an informational row has no Mark done, Not an issue or Ask Genie to fix');
    assert.equal(await page.locator('dialog.drawer').getByRole('button', { name: /^Explain/ }).count(), 1, 'the drawer offers Explain while Genie is on');
    assert.deepEqual(calls.acts, []);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('a table without the action columns hides the tracker even with decisions on', async () => {
  const { calls, routes } = tracked({ records: lister(ROWS, { actions: false, changes: true, summary: { left: 0 } }) });
  const { page, seen, context } = await open(appInfo(DECIDE, 1, TABLE), routes);
  assert.equal(calls.fields, 0, 'the list answer says whether people can act, so no second request');
  await page.waitForFunction(() => document.querySelector('.card--table tbody .cell-t'));
  await page.waitForTimeout(200);
  assert.equal(await page.getByRole('button', { name: 'Owner' }).count(), 0);
  assert.equal(await page.locator('.impact').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('with decisions on the list shows owners, status, change badges, my actions and the impact line', async () => {
  const { routes } = tracked();
  const { page, seen, context } = await open(appInfo(DECIDE, 1, TABLE), routes);
  await page.locator('.impact').waitFor();
  assert.equal(await page.locator('.impact').innerText(), 'Actions: 14 open · 9 done · 6 resolved by a later run (6/9)');
  assert.equal(await page.locator('.left-n').innerText(), '12 records left the list since the last run');
  const heads = await page.locator('.card--table thead th').allInnerTexts();
  assert.ok(heads.includes('OWNER') && heads.includes('STATUS'), heads.join('|'));
  const first = page.locator('.card--table tbody tr').first();
  assert.equal(await first.locator('.chg-b').innerText(), 'New');
  assert.equal(await page.locator('.card--table tbody tr').nth(1).locator('.chg-b').innerText(), 'Moved to Act now');
  assert.match(await page.locator('.card--table tbody tr').nth(1).innerText(), /sam\.roe@example\.com\s+In progress/);
  assert.match(await first.innerText(), /Unassigned/);
  await page.getByRole('button', { name: 'My actions' }).click();
  await until(() => seen.records.at(-1).mine === true);
  assert.equal(await page.getByRole('button', { name: 'My actions' }).getAttribute('aria-pressed'), 'true');
  await page.getByRole('button', { name: 'Changed since the last run' }).click();
  await until(() => seen.records.at(-1).changed === true);
  assert.deepEqual([seen.records.at(-1).mine, seen.records.at(-1).offset], [true, 0]);
  await page.getByRole('button', { name: 'Owner', exact: true }).click();
  await until(() => seen.records.at(-1).sort?.key === 'action_owner');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the drawer saves an action with the version it read, and a dismissal needs a reason', async () => {
  const { calls, routes } = tracked();
  const { page, seen, context } = await open(appInfo(DECIDE, 1, TABLE), routes, { clock: new Date('2026-10-27T09:30:00Z') });
  await page.locator('.cell-t').first().click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('.dr-act').waitFor();
  assert.equal(await drawer.locator('input[name="action_owner"]').inputValue(), PERSON);
  assert.deepEqual(await drawer.locator('select[name="action_status"] option').allInnerTexts(), ['New', 'In progress', 'Done', 'Not an issue', 'Could not fix']);
  assert.ok(await drawer.locator(`datalist option[value="${OTHER}"]`).count() === 1, 'owner suggestions come from the current owners');
  await drawer.locator('select[name="action_status"]').selectOption('Done');
  await drawer.locator('input[name="action_due"]').fill('2026-11-15');
  await drawer.locator('textarea[name="action_note"]').fill('Called the store');
  const loads = calls.history;
  await drawer.getByRole('button', { name: 'Save action' }).click();
  await until(() => calls.acts.length === 1);
  assert.deepEqual(calls.acts[0], { page: 'n01_u05', record_keys: ['R001'], values: { action_status: 'Done', action_due: '2026-11-15', action_note: 'Called the store' },
    seen: { R001: '102' } });
  await page.locator('.toast.is-on').waitFor();
  assert.match(await page.locator('.toast').innerText(), /Action saved/);
  await until(() => calls.history > loads);
  await page.waitForFunction(() => document.querySelector('dialog.drawer select[name="action_status"]')?.value === 'New');
  await page.evaluate(() => window.addEventListener('click', () => { window.focusedByClick = document.activeElement?.name ?? null; }, { once: true }));
  await drawer.getByRole('button', { name: 'Not an issue' }).click();
  const reason = drawer.locator('textarea[name="dismiss_reason"]');
  await reason.waitFor();
  assert.equal(await page.evaluate(() => window.focusedByClick), 'dismiss_reason', 'the reason box takes focus with the click, before any timer runs');
  assert.equal(await page.evaluate(() => document.activeElement?.name), 'dismiss_reason');
  assert.equal(await reason.getAttribute('maxlength'), '300');
  assert.match(await drawer.locator('label:has(textarea[name="dismiss_reason"]) > span').innerText(), /^Why is it not an issue\? \*/);
  assert.equal(await drawer.getByRole('button', { name: 'Save action' }).isDisabled(), true);
  assert.equal(await drawer.locator('.in-err').innerText(), 'Say why it is not an issue');
  await reason.fill('The store closed in May');
  await drawer.getByRole('button', { name: 'Save action' }).click();
  await until(() => calls.acts.length === 2);
  assert.deepEqual(calls.acts[1].values, { action_status: 'Dismissed', dismiss_reason: 'The store closed in May' });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a conflicting action says who changed the record and reloads it on request', async () => {
  const message = `${OTHER} changed this record on Oct 27, 2026 at 03:01 UTC, after you opened it. Reload it to see that change, then make yours again`;
  const { calls, routes } = tracked({ 'records/act': ({ json }) => json(409, { error: message, written: [], conflicts: [{ record_key: 'R001', error: message }], code: 'stale_record' }) });
  const { page, seen, context } = await open(appInfo(DECIDE, 1, TABLE), routes);
  await page.locator('.cell-t').first().click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('.dr-act').waitFor();
  await drawer.locator('select[name="action_status"]').selectOption('In progress');
  await drawer.getByRole('button', { name: 'Save action' }).click();
  await drawer.locator('.hint--box').waitFor();
  assert.equal(await drawer.locator('.hint--box span').innerText(), message);
  const loads = calls.history;
  await drawer.getByRole('button', { name: 'Reload the record' }).click();
  await until(() => calls.history === loads + 1);
  await page.waitForFunction(() => !document.querySelector('dialog.drawer .hint--box'));
  assert.deepEqual(seen.errors.filter((e) => !/409/.test(e)), []);
  await context.close();
});

test('a change the read-only demo refuses reads as a calm note in plain words, and a real server failure still reads as an error', async () => {
  const demo = 'This is the demo, so nothing in it changes. Choose Get Started to find use cases and build MVPs on your own data.';
  let reply = [403, { error: demo, showcase: true }];
  const { routes } = tracked({ 'records/act': ({ json }) => json(...reply) });
  const { page, seen, context } = await open(appInfo(DECIDE, 1, TABLE), routes);
  await page.locator('.cell-t').first().click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('.dr-act').waitFor();
  await drawer.locator('select[name="action_status"]').selectOption('In progress');
  await drawer.getByRole('button', { name: 'Save action' }).click();
  const calm = drawer.locator('[data-calm]');
  await calm.waitFor();
  assert.equal(await calm.innerText(), 'This is a demo, so it is read-only: nothing you do here changes any data.');
  assert.equal(await calm.getAttribute('role'), 'status');
  assert.equal(await calm.evaluate((el) => el.classList.contains('note')), true);
  assert.equal(await drawer.locator('.hint--box, [role="alert"]').count(), 0, 'nothing reads as an error in the demo');
  await page.keyboard.press('Escape');
  await page.locator('.card--table tbody tr').first().waitFor();
  await page.keyboard.press('j');
  await page.keyboard.press('d');
  await page.locator('.toast.is-on').waitFor();
  assert.equal(await page.locator('.toast .toast-t').innerText(), 'This is a demo, so it is read-only: nothing you do here changes any data.');
  assert.equal(await page.locator('.toast').evaluate((el) => el.classList.contains('toast--error')), false);
  reply = [500, { error: 'the warehouse stopped' }];
  await page.locator('.cell-t').first().click();
  await drawer.locator('.dr-act').waitFor();
  await drawer.locator('select[name="action_status"]').selectOption('In progress');
  await drawer.getByRole('button', { name: 'Save action' }).click();
  await drawer.locator('.hint--box').waitFor();
  assert.equal(await drawer.locator('.hint--box span').innerText(), 'the warehouse stopped');
  assert.equal(await drawer.locator('.hint--box').getAttribute('role'), 'alert');
  assert.equal(await drawer.locator('[data-calm]').count(), 0);
  reply = [403, { error: 'this App does not let people record decisions on its records' }];
  await drawer.getByRole('button', { name: 'Save action' }).click();
  await page.waitForFunction(() => document.querySelector('dialog.drawer .hint--box span')?.textContent === 'this App does not let people record decisions on its records');
  assert.equal(await drawer.locator('[data-calm]').count(), 0, 'a 403 that is not the demo is a refusal, not a note');
  assert.deepEqual(seen.errors.filter((e) => !/40[39]|500/.test(e)), []);
  await context.close();
});

test('an action refused for any other reason says why and offers no reload, since reloading would not help', async () => {
  const message = 'the result table keeps no snooze_until yet; rebuild the use case so its runs write it';
  const { routes } = tracked({ 'records/act': ({ json }) => json(409, { error: message }) });
  const { page, seen, context } = await open(appInfo(DECIDE, 1, TABLE), routes);
  await page.locator('.cell-t').first().click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('.dr-act').waitFor();
  await drawer.locator('select[name="action_status"]').selectOption('In progress');
  await drawer.getByRole('button', { name: 'Save action' }).click();
  await drawer.locator('.hint--box').waitFor();
  assert.equal(await drawer.locator('.hint--box span').innerText(), message);
  assert.equal(await drawer.getByRole('button', { name: 'Reload the record' }).count(), 0);
  assert.deepEqual(seen.errors.filter((e) => !/409/.test(e)), []);
  await context.close();
});

test('row checkboxes feed one bulk call to assign or set status, and conflicts are counted', async () => {
  let reply = null;
  const { calls, routes } = tracked({
    'records/act': ({ route, json }) => {
      const body = actBody(route);
      calls.acts.push(body);
      return json(200, reply || { written: body.record_keys, conflicts: [] });
    },
  });
  const { page, seen, context } = await open(appInfo(DECIDE, 1, TABLE), routes);
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody input[type="checkbox"]').length === 25);
  await page.getByRole('checkbox', { name: `Select ${LABEL}` }).check();
  await page.getByRole('checkbox', { name: 'Select Item number 2 with a long descriptive name' }).check();
  assert.equal(await page.locator('.bulk b').innerText(), '2 selected:');
  assert.equal(await page.locator('.card--table tbody tr.is-picked').count(), 2);
  assert.equal(await page.locator('dialog.drawer[open]').count(), 0, 'ticking a row does not open its drawer');
  await page.getByRole('button', { name: 'Assign to…' }).click();
  await page.locator('input[name="bulk_owner"]').fill(OTHER);
  const lists = seen.records.length;
  await page.getByRole('button', { name: 'Assign 2 records' }).click();
  await until(() => calls.acts.length === 1);
  assert.deepEqual(calls.acts[0], { page: 'n01_u05', record_keys: ['R001', 'R002'], values: { action_owner: OTHER }, seen: { R001: '100', R002: '101' } });
  await page.locator('.toast.is-on').waitFor();
  assert.equal(await page.locator('.toast .toast-t').innerText(), `2 records given to ${OTHER}.`);
  await until(() => seen.records.length > lists);
  await page.waitForFunction(() => !document.querySelector('.bulk'));
  await page.getByRole('checkbox', { name: 'Select every record on this page' }).check();
  assert.equal(await page.locator('.bulk b').innerText(), '25 selected:');
  await page.getByRole('button', { name: 'Set status…' }).click();
  await page.locator('select[name="bulk_status"]').selectOption('Dismissed');
  const apply = page.getByRole('button', { name: 'Set status of 25 records' });
  assert.equal(await apply.isDisabled(), true);
  await page.locator('textarea[name="bulk_reason"]').fill('These items left the range');
  reply = { written: ['R001'], conflicts: Array.from({ length: 24 }, (_, i) => ({ record_key: `R0${i + 2}`, error: 'changed' })) };
  await apply.click();
  await until(() => calls.acts.length === 2);
  assert.equal(calls.acts[1].record_keys.length, 25);
  assert.deepEqual(calls.acts[1].values, { action_status: 'Dismissed', dismiss_reason: 'These items left the range' });
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent
    === '1 record marked as not an issue. 24 records changed since you loaded them and were left as they are.');
  assert.match(await page.locator('.conflicts').innerText(),
    /^24 records changed since you loaded them and were left as they are: R02, R03, (?:[^,]+, ){17}Item number 21 with a long descriptive name, and 4 more\.$/,
    'the notice names the 20 the server sampled, by label when the record is on the page, and counts the rest');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the selection stops at 200 records per call', async () => {
  const rows = Array.from({ length: 300 }, (_, i) => ({ ...ROWS[0], entity_id: `R${i}`, record_key: `R${i}`, _inspire_key: `R${i}`, _inspire_version: String(1000 + i),
    entity_label: `Record ${i}`, _inspire_change: null }));
  const { routes } = tracked({ records: lister(rows, { actions: true, changes: false, summary: SUMMARY }) });
  const { page, seen, context } = await open(appInfo(DECIDE, 1, TABLE), routes);
  await page.waitForFunction(() => document.querySelector('.pager-n'));
  await page.getByLabel('Rows per page').selectOption('100');
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length === 100);
  for (let n = 0; n < 2; n += 1) {
    await page.getByRole('checkbox', { name: 'Select every record on this page' }).check();
    await page.getByRole('button', { name: 'Next page' }).click();
    await page.waitForFunction((at) => document.querySelector('.pager-n')?.textContent.startsWith(`Showing ${at}`), String((n + 1) * 100 + 1));
  }
  await page.getByRole('checkbox', { name: 'Select every record on this page' }).click();
  await page.locator('.toast.is-on').waitFor();
  assert.equal(await page.locator('.toast').innerText(), 'You can act on 200 records at a time');
  assert.equal(await page.locator('.bulk b').innerText(), '200 selected:');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const ENTRY = `
import { createElement as h } from 'react';
import { createRoot } from 'react-dom/client';
import { ToastProvider } from ${JSON.stringify(join(SRC, 'ui.jsx'))};
import Records from ${JSON.stringify(join(SRC, 'Records.jsx'))};
window.explained = [];
window.asked = [];
window.addEventListener('inspire:genie-ask', (e) => window.asked.push(e.detail));
createRoot(document.getElementById('root')).render(h(ToastProvider, null, h(Records, { ...window.props, onExplain: (kind, title, context) => window.explained.push({ kind, title, context }) })));
`;

async function recordsBundle() {
  const entry = { name: 'records-entry', resolveId: (id) => (id === 'records-entry' ? '\0records-entry' : null), load: (id) => (id === '\0records-entry' ? ENTRY : null) };
  const out = await build({ root: SRC, configFile: false, logLevel: 'silent', plugins: [react(), entry],
    build: { write: false, minify: false, rollupOptions: { input: 'records-entry', output: { format: 'iife', inlineDynamicImports: true } } } });
  return (Array.isArray(out) ? out[0] : out).output.find((o) => o.type === 'chunk').code;
}

async function isolated(code, props, routes) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', (e) => errors.push(e.message));
  await page.route('**/api/**', (route) => {
    const path = new URL(route.request().url()).pathname.replace(/^\/api\//, '');
    const handler = routes[path];
    return handler ? handler(route) : route.fulfill({ status: 404, contentType: 'application/json', body: '{"error":"no route"}' });
  });
  await page.route('http://records.test/', (route) => route.fulfill({ status: 200, contentType: 'text/html; charset=utf-8',
    body: `<!doctype html><html><head><meta charset="utf-8"></head><body><div id="root"></div><script>window.props = ${JSON.stringify(props)};</script><script>${code}</script></body></html>` }));
  await page.goto('http://records.test/');
  return { page, context, errors };
}

test('Explain sends the record with its fields, tier, action and history when the page passes onExplain and Genie is on', async () => {
  const code = await recordsBundle();
  const info = appInfo(DECIDE, 1, TABLE);
  const json = (data) => (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  const routes = {
    records: json({ rows: ROWS.slice(0, 3), total: 3, offset: 0, limit: 25, actions: true, changes: true, summary: SUMMARY, errors: {} }),
    'records/fields': json({ fields: FIELDS, key_field: 'entity_id', actions: true }),
    'records/history': json({ ...HISTORY, versions: [{ ...CURRENT, change_source: 'run', valid_from_us: '101', recommended_action: 'Hold' }, CURRENT] }),
  };
  const props = { meta: info.pages[0].records, app: info, pageId: 'n01_u05', filters: {}, history: true, ready: true };
  const on = await isolated(code, props, routes);
  await on.page.locator('.cell-t').first().click();
  await on.page.locator('dialog.drawer .dr-act').waitFor();
  const why = on.page.getByRole('region', { name: 'Why it is flagged' });
  assert.equal(await why.locator('.unexplained p').innerText(), 'Not explained yet');
  assert.equal(await on.page.locator('dialog.drawer .conf, dialog.drawer .save').count(), 0, 'a record without AI text shows no confidence and no saving');
  assert.equal(await on.page.locator('dialog.drawer .nba .do').innerText(), 'Cut the standing discount to 10%');
  await why.getByRole('button', { name: 'Explain' }).click();
  const [ask] = await on.page.evaluate(() => window.explained);
  assert.equal(ask.kind, 'record');
  assert.equal(ask.title, LABEL);
  assert.equal(ask.context.tier, 'Act now');
  assert.equal(ask.context.action, 'Cut the standing discount to 10%');
  assert.equal(ask.context.fields.Owner, PERSON);
  assert.equal(ask.context.fields.Status, 'New');
  assert.ok(Object.keys(ask.context.fields).length <= 40);
  assert.equal(ask.context.history.length, 2);
  assert.match(ask.context.history[1], /Recommended action: Hold to Cut the standing discount to 10%/);
  assert.deepEqual(on.errors, []);
  await on.context.close();
  const pageOff = { ...info, pages: info.pages.map((p) => ({ ...p, genie: { ...p.genie, enabled: false } })) };
  const off = await isolated(code, { ...props, app: pageOff }, routes);
  await off.page.locator('.cell-t').first().click();
  await off.page.locator('dialog.drawer .dr-act').waitFor();
  assert.equal(await off.page.getByRole('button', { name: 'Explain' }).count(), 0, 'no Explain while Genie is off');
  assert.equal(await off.page.getByRole('region', { name: 'Ask Genie about this' }).count(), 0, 'no Genie questions while Genie is off');
  assert.equal(await off.page.locator('dialog.drawer .unexplained p').innerText(), 'Not explained yet');
  await off.context.close();
});

const AI_FIELDS = ['ai_explanation', 'ai_evidence', 'ai_confidence_reason', 'confidence_level', 'ai_next_action', 'ai_expected_result', 'ai_other_option',
  'value_at_stake_formula'].map((n) => F(n, 'text', 'ai'));
const ALIASES = { ai_explanation: '_inspire_ai_explanation', confidence_level: '_inspire_confidence_level' };
const EXPLAINED = {
  ai_explanation: 'It has been 40% off for 6 weeks and is not selling more, so each week loses about $1,400 of margin.',
  ai_evidence: JSON.stringify(['The discount went from 20% to 40% on Sep 7.', 'Sales stayed at about 35 a week, before and after.']),
  confidence_level: 'High', ai_confidence_reason: 'Six weeks of sales since the change.', ai_next_action: 'Cut the discount to 20%',
  ai_expected_result: 'About $1,400 of margin a week comes back.', ai_other_option: 'End the promotion at the next price change.',
  value_at_stake: 8400, currency: 'USD', value_at_stake_formula: '$1,400 margin lost a week x 6 weeks left in the season',
};

function panelRoutes(current, calls = { acts: [] }) {
  const json = (data) => (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(data) });
  const rows = ROWS.slice(0, 3).map((r, i) => (i ? r : { ...r, _inspire_ai_explanation: current.ai_explanation ?? null, _inspire_confidence_level: current.confidence_level ?? null }));
  const now = { ...CURRENT, ...current };
  return {
    records: json({ rows, total: 3, offset: 0, limit: 25, actions: true, changes: true, summary: SUMMARY, errors: {}, ai: { columns: ALIASES, categories: [], picked: {} } }),
    'records/fields': json({ fields: [...FIELDS, ...AI_FIELDS], key_field: 'entity_id', actions: true }),
    'records/history': json({ ...HISTORY, fields: [...FIELDS, ...AI_FIELDS], versions: [{ ...now, is_current: false, valid_from_us: '101', ai_explanation: 'An older reason.' }, now], current: now }),
    'records/act': (route) => { const body = actBody(route); calls.acts.push(body); return json({ written: body.record_keys, conflicts: [] })(route); },
  };
}

test('each record shows the first two lines of its AI reason under its label', async () => {
  const why = 'It has been 40% off for 6 weeks and is not selling more, so each week loses about $1,400 of margin. '.repeat(4).trim();
  const rows = ROWS.slice(0, 4).map((r, i) => ({ ...r, _inspire_ai_explanation: [why, '   ', null, 'Short reason.'][i] }));
  const { page, seen, context } = await open(appInfo(), { records: lister(rows, { ai: { columns: ALIASES, categories: [], picked: {} } }) });
  const first = page.locator('.card--table tbody tr').first();
  await first.locator('.cell-ai').waitFor();
  assert.equal(await first.locator('.cell-ai').textContent(), why);
  const box = await first.locator('.cell-ai').evaluate((el) => {
    const s = getComputedStyle(el);
    return { clamp: s.webkitLineClamp, lines: el.getBoundingClientRect().height / parseFloat(s.lineHeight), clipped: el.scrollHeight > el.clientHeight + 1 };
  });
  assert.equal(box.clamp, '2');
  assert.ok(box.lines <= 2.05 && box.clipped, JSON.stringify(box));
  assert.deepEqual(await page.locator('.card--table .cell-ai').allTextContents(), [why, 'Short reason.'], 'a blank or missing reason shows nothing');
  assert.ok(!(await first.locator('.cell-t').innerText()).includes('40% off'), 'the reason is not part of the label button');
  const left = await first.evaluate((tr) => ['.cell-t', '.cell-ai', '.chg-b'].map((s) => Math.round(tr.querySelector(s).getBoundingClientRect().left)));
  assert.equal(new Set(left).size, 1, `the label, its reason and its badge line up: ${left}`);
  await context.close();
  const plain = await open(appInfo(), { records: lister(rows.map((r, i) => (i ? r : { ...r, ai_explanation: 'From the dataset.' }))) });
  await plain.page.waitForFunction(() => document.querySelector('.card--table tbody .cell-t'));
  assert.deepEqual(await plain.page.locator('.card--table .cell-ai').allTextContents(), ['From the dataset.'],
    'without the list naming its AI columns only a dataset ai_explanation shows');
  assert.deepEqual([...seen.errors, ...plain.seen.errors], []);
  await plain.context.close();
});

test('under a record name the list and the record panel show only the key and segment words the name does not already show', async () => {
  const parts = [
    { entity_label: 'zip 10001', entity_id: '10001 | 2016-02-29 00:00 | own series', category: '2016-02-29 00:00 | own series' },
    { entity_label: 'Fleet fare revenue 2016-03-01', entity_id: 'Fleet fare revenue 2016-03-01', category: '2016-03-01' },
    { entity_label: 'Wool coat', entity_id: 'R003', category: 'Outerwear' },
  ];
  const rows = parts.map((p, i) => ({ ...ROWS[i], ...p, record_key: p.entity_id, _inspire_key: p.entity_id }));
  const { page, seen, context } = await open(appInfo(), { records: lister(rows) });
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody .cell-t').length === 3);
  const shown = Object.fromEntries(await page.locator('.card--table tbody .cell-t').evaluateAll((els) => els.map((e) => [
    e.querySelector('b').textContent, e.querySelector('small')?.textContent ?? null])));
  assert.deepEqual(shown, { 'zip 10001': '2016-02-29 00:00 | own series', 'Fleet fare revenue 2016-03-01': null, 'Wool coat': 'R003 · Outerwear' });
  const panel = page.locator('dialog.drawer[open] .panel-meta');
  await page.locator('.card--table tbody .cell-t', { hasText: 'Fleet fare revenue 2016-03-01' }).click();
  await page.waitForFunction(() => document.querySelector('dialog.drawer[open] h2')?.textContent === 'Fleet fare revenue 2016-03-01');
  assert.ok(!(await panel.innerText()).includes('2016-03-01'), 'the panel does not repeat a segment the name already shows');
  await page.keyboard.press('Escape');
  await page.locator('.card--table tbody .cell-t', { hasText: 'Wool coat' }).click();
  await page.waitForFunction(() => document.querySelector('dialog.drawer[open] h2')?.textContent === 'Wool coat');
  assert.ok((await panel.innerText()).includes('Outerwear'), 'a segment that adds words still shows in the panel');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the record panel shows the saving with its formula, why the AI flagged it, how sure it is, the next best action and Genie questions', async () => {
  const code = await recordsBundle();
  const info = appInfo(DECIDE, 1, TABLE);
  const calls = { acts: [] };
  const props = { meta: info.pages[0].records, app: info, pageId: 'n01_u05', filters: {}, history: true, ready: true };
  const { page, context, errors } = await isolated(code, props, panelRoutes({ ...EXPLAINED, action_due: '2020-01-05' }, calls));
  await page.locator('.cell-t').first().click();
  const panel = page.locator('dialog.drawer.panel');
  await panel.locator('.dr-act').waitFor();
  assert.equal(await panel.locator('.panel-h h2').innerText(), LABEL);
  const meta = await panel.locator('.panel-meta').innerText();
  for (const part of ['Price-loss decision desk', 'Books', PERSON, 'Due Jan 5, 2020']) assert.ok(meta.includes(part), `${part} in ${meta}`);
  assert.equal(await panel.locator('.panel-meta .owner i').innerText(), 'PL');
  assert.equal(await panel.locator('.panel-meta .late').innerText(), 'Due Jan 5, 2020');
  const saving = panel.getByRole('region', { name: 'Could save' });
  assert.equal(await saving.locator('.save').innerText(), '$8,400');
  assert.equal(await saving.locator('.fx').innerText(), EXPLAINED.value_at_stake_formula);
  const why = panel.getByRole('region', { name: 'Why it is flagged' });
  assert.equal(await why.locator('p').first().innerText(), EXPLAINED.ai_explanation);
  assert.deepEqual(await why.locator('.ev li').allInnerTexts(), JSON.parse(EXPLAINED.ai_evidence));
  assert.equal(await why.locator('.why-x').getByRole('button', { name: `Explain ${LABEL}` }).count(), 1, 'an explained record still offers Explain, after its reason');
  assert.equal(await panel.getByRole('button', { name: /^Explain/ }).count(), 1);
  assert.equal(await panel.locator('.conf.conf--High').innerText(), 'High');
  assert.match(await panel.locator('.conf-l').innerText(), /Six weeks of sales since the change\./);
  const next = panel.getByRole('region', { name: 'Next best action' });
  assert.equal(await next.locator('.do').innerText(), 'Cut the discount to 20%');
  assert.deepEqual(await next.locator('dt').allInnerTexts(), ['What should happen', 'Other option']);
  assert.deepEqual(await next.locator('dd').allInnerTexts(), [EXPLAINED.ai_expected_result, EXPLAINED.ai_other_option]);
  assert.deepEqual(await panel.locator('.panel-b > section h3').allInnerTexts(),
    ['Could save', 'Why it is flagged', 'How sure the AI is', 'Next best action', 'Action', 'Add a note', 'Ask Genie about this', 'Details', 'History']);
  assert.match(await panel.locator('.hist-i').first().innerText(), /No value changed\./, 'a new AI reason is never shown as a business change');
  assert.deepEqual(await panel.locator('.panel-f > button').allInnerTexts(), ['Mark done', 'Not an issue', 'Could not fix', 'Snooze…', 'Draft message', 'Ask Genie to fix']);
  assert.deepEqual(await panel.getByLabel('Give to someone').locator('option').allInnerTexts(),
    [`With ${PERSON}`, `Give to ${OTHER}`, 'Someone else…']);
  const ask = panel.getByRole('region', { name: 'Ask Genie about this' });
  assert.deepEqual(await ask.locator('.sugg').allInnerTexts(), ['Show the history of this item', 'Are there others like this?', 'What happens if we do nothing?']);
  await ask.getByRole('button', { name: 'Are there others like this?' }).click();
  await page.waitForFunction(() => !document.querySelector('dialog.drawer[open]'));
  assert.deepEqual(await page.evaluate(() => window.asked), [{ pageId: 'n01_u05', recordKey: 'R001', label: LABEL, question: 'Are there others like this?' }]);
  await page.locator('.cell-t').first().click();
  await panel.locator('.dr-act').waitFor();
  await panel.getByRole('button', { name: 'Ask your own question' }).click();
  assert.deepEqual((await page.evaluate(() => window.asked)).at(-1), { pageId: 'n01_u05', recordKey: 'R001', label: LABEL, question: '' });
  await page.locator('.cell-t').first().click();
  await panel.locator('.dr-act').waitFor();
  await panel.getByRole('button', { name: 'Mark done' }).click();
  await until(() => calls.acts.length === 1);
  assert.deepEqual(calls.acts[0], { page: 'n01_u05', record_keys: ['R001'], values: { action_status: 'Done' }, seen: { R001: '102' } });
  await page.locator('.toast.is-on').waitFor();
  assert.equal(await page.locator('.toast').innerText(), 'Marked done. The next run checks whether it worked.');
  await panel.getByLabel('Give to someone').selectOption(`Give to ${OTHER}`);
  await until(() => calls.acts.length === 2);
  assert.deepEqual(calls.acts[1].values, { action_owner: OTHER });
  await panel.getByLabel('Give to someone').selectOption('Someone else…');
  assert.equal(await page.evaluate(() => document.activeElement?.name), 'action_owner');
  assert.equal(calls.acts.length, 2, 'picking someone else only moves to the owner field');
  assert.deepEqual(errors, []);
  await context.close();
});

test('a record whose AI reasoning failed the checks shows a plain flag and still lets you ask Genie to explain it', async () => {
  const code = await recordsBundle();
  const info = appInfo(DECIDE, 1, TABLE);
  const props = { meta: info.pages[0].records, app: info, pageId: 'n01_u05', filters: {}, history: true, ready: true };
  const held = await isolated(code, props, panelRoutes({ ai_explanation: null, ai_check: 'hedged explanation', confidence_level: 'Medium' }));
  await held.page.locator('.cell-t').first().click();
  await held.page.locator('dialog.drawer .dr-act').waitFor();
  const why = held.page.getByRole('region', { name: 'Why it is flagged' });
  assert.equal(await why.locator('.unexplained p').innerText(),
    'Inspire left out the AI reasoning for this record because it failed a check after one repair round: hedged explanation.');
  await why.getByRole('button', { name: 'Explain' }).click();
  const [ask] = await held.page.evaluate(() => window.explained);
  assert.equal(ask.context.confidence, 'Medium', 'Genie gets the level the notebook set');
  assert.deepEqual(held.errors, []);
  await held.context.close();
});

test('a low confidence record says so, an older table shows only what it has, and a done record shows its outcome without the action buttons', async () => {
  const code = await recordsBundle();
  const info = appInfo(DECIDE, 1, TABLE);
  const props = { meta: info.pages[0].records, app: info, pageId: 'n01_u05', filters: {}, history: true, ready: true };
  const low = await isolated(code, props, panelRoutes({ ...EXPLAINED, confidence_level: 'Low', ai_confidence_reason: 'Only 2 weeks of sales since the markdown.' }));
  await low.page.locator('.cell-t').first().click();
  await low.page.locator('dialog.drawer .dr-act').waitFor();
  assert.equal(await low.page.locator('dialog.drawer .conf.conf--Low').innerText(), 'Low');
  await low.context.close();
  const older = { ai_explanation: 'Margin fell after the second markdown.', confidence_level: 'Medium' };
  const old = await isolated(code, props, { ...panelRoutes(older), 'records/history': () => new Promise(() => {}) });
  await old.page.locator('.cell-t').first().click();
  const panel = old.page.locator('dialog.drawer.panel');
  await panel.waitFor({ state: 'visible' });
  assert.equal(await panel.getByRole('region', { name: 'Why it is flagged' }).locator('p').first().innerText(), older.ai_explanation, 'the list row explains the record while its history loads');
  assert.equal(await panel.locator('.conf.conf--Medium').innerText(), 'Medium');
  assert.equal(await panel.locator('.ev, .save, .nba dl, .conf-l span + span').count(), 0, 'no evidence, saving or reason the table does not hold');
  assert.equal(await panel.locator('.nba .do').innerText(), 'Cut the standing discount to 10%');
  await old.context.close();
  const done = await isolated(code, props, panelRoutes({ ...EXPLAINED, action_status: 'Done', action_outcome: 'Resolved' }));
  await done.page.locator('.cell-t').first().click();
  await done.page.locator('dialog.drawer .dr-act').waitFor();
  assert.equal(await done.page.locator('dialog.drawer .done').innerText(), 'Marked done. A later run found it resolved.');
  assert.deepEqual(await done.page.locator('dialog.drawer .panel-f > button').allInnerTexts(), ['Close']);
  assert.equal(await done.page.getByLabel('Give to someone').count(), 0);
  assert.deepEqual([...low.errors, ...old.errors, ...done.errors], []);
  await done.context.close();
});

test('while Genie is still answering, the record panel Explain waits and says why, for an explained and an unexplained record', async () => {
  const code = await recordsBundle();
  const info = appInfo(DECIDE, 1, TABLE);
  const props = { meta: info.pages[0].records, app: info, pageId: 'n01_u05', filters: {}, history: true, ready: true };
  for (const [current, where] of [[EXPLAINED, '.why-x'], [{}, '.unexplained']]) {
    for (const genieBusy of [true, false]) {
      const { page, context, errors } = await isolated(code, { ...props, genieBusy }, panelRoutes(current));
      await page.locator('.cell-t').first().click();
      await page.locator('dialog.drawer .dr-act').waitFor();
      const button = page.locator(`dialog.drawer ${where}`).getByRole('button', { name: `Explain ${LABEL}` });
      assert.deepEqual([await button.isDisabled(), await button.getAttribute('title')], genieBusy ? [true, 'Genie is still answering'] : [false, null], `${where} ${genieBusy}`);
      if (!genieBusy) {
        await button.click();
        assert.deepEqual((await page.evaluate(() => window.explained)).map((e) => [e.kind, e.title]), [['record', LABEL]]);
      }
      assert.deepEqual(errors, []);
      await context.close();
    }
  }
});
