import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  DEFAULT_PREFS, MY_KEY, browserZone, cleanPrefs, isFolded, listLimit, listWindow, localDay, markVisit, narrowWindow, nextDay, pickedWindow, readPrefs, setFolds, utcOffset, visitedAt,
  windowLabel, windowParams, writePrefs,
} from '../src/prefs.js';
import { isQuiet, progressShare, progressText, stepText, untilText } from '../src/freshness.js';
import {
  CODES, NO_AS_OF, STALE_LIST, UNDO_CLOSE, actError, actOutcome, actedText, asOfText, batchText, byWords, changeWords, closedText, conflictText, isOverdue, isStaleRecord,
  listAsOf, matchOf, overdueFirst, recordsText, undoBatchOf, undoText, closedBatchOf, UNDO_THEIRS,
} from '../src/records.js';
import { doneDay, doneTodayOf, limitText, myWorkText } from '../src/hub.js';
import { blockTitle } from '../src/blocks.js';
import { parseHash, withRecord } from '../src/links.js';
import { CONTRACT, fileNames } from './harness.mjs';
import { DEMO_NOTE, actRecords, failureOf, toneOf } from '../src/api.js';

const SRC = join(dirname(fileURLToPath(import.meta.url)), '..', 'src');
const ME = ['pat.lee', 'example.com'].join('@');
const SAM = ['sam.roe', 'example.com'].join('@');
const NOW = Date.parse('2026-10-27T09:30:00Z');

function memory(start = {}) {
  const data = { ...start };
  return { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => { data[k] = String(v); }, data };
}

test('no request names a fixed utc_offset_min, which the server refuses; every window names its time zone', () => {
  const sending = fileNames(SRC).filter((name) => /\.(js|jsx)$/.test(name) && readFileSync(join(SRC, name), 'utf8').includes('utc_offset_min'));
  assert.deepEqual(sending, []);
  for (const window of ['hour', 'today', 'week', 'month', 'all', 'everything']) {
    assert.equal('utc_offset_min' in listWindow({ ...DEFAULT_PREFS, window }, 'Asia/Dubai'), false, window);
  }
});

test('My view starts at All open with no limit, drops what storage holds that it does not know, and keeps each person apart', () => {
  assert.deepEqual(cleanPrefs(null), DEFAULT_PREFS);
  assert.deepEqual(DEFAULT_PREFS, { window: 'all', limit: 0, density: 'comfortable', rows: 25, folds: {}, seen: {}, columns: {} });
  assert.deepEqual(cleanPrefs({ window: 'decade', limit: 7, density: 'tiny', rows: 30, folds: { p: { a: true, b: 'yes', c: false }, q: 3, r: {} }, seen: { p: -1, q: 'x', r: 5 },
    columns: { g: ['b', 'a', 'b', 7, ''], h: 'a', i: [] } }),
  { window: 'all', limit: 0, density: 'comfortable', rows: 25, folds: { p: { a: true } }, seen: { r: 5 }, columns: { g: ['b', 'a'] } });
  assert.equal(cleanPrefs({ rows: 100 }).rows, 100);
  const store = memory();
  assert.equal(writePrefs(store, ME, { ...DEFAULT_PREFS, window: 'week', limit: 25 }), true);
  assert.equal(writePrefs(store, SAM, { ...DEFAULT_PREFS, density: 'compact' }), true);
  assert.deepEqual(Object.keys(JSON.parse(store.data[MY_KEY])), [ME, SAM]);
  assert.equal(readPrefs(store, ` ${ME.toUpperCase()} `).window, 'week', 'the same person in another case reads the same view');
  assert.equal(readPrefs(store, SAM).window, 'all');
  assert.equal(readPrefs(store, SAM).density, 'compact');
  assert.deepEqual(readPrefs(memory({ [MY_KEY]: '{not json' }), ME), DEFAULT_PREFS);
  assert.deepEqual(readPrefs(memory({ [MY_KEY]: '[1,2]' }), ME), DEFAULT_PREFS);
  assert.equal(writePrefs({ getItem: () => null, setItem: () => { throw new Error('full'); } }, ME, DEFAULT_PREFS), false, 'a full storage never throws');
  assert.deepEqual(windowParams(DEFAULT_PREFS, ''), { window: 'all' }, 'All open still names its window, so the server sends due and snooze dates and leaves snoozed records out');
  assert.deepEqual(windowParams({ ...DEFAULT_PREFS, window: 'today', limit: 10 }, ''), { window: 'today', window_limit: 10 });
  assert.deepEqual(windowParams({ ...DEFAULT_PREFS, limit: 25 }, ''), { window: 'all', window_limit: 25 }, 'a limit alone still names the window it limits');
  assert.deepEqual(windowParams({ ...DEFAULT_PREFS, window: 'week' }, 'Asia/Dubai'), { window: 'week', time_zone: 'Asia/Dubai' }, 'the window names the time zone its days are in');
  assert.equal(windowParams(DEFAULT_PREFS).time_zone, Intl.DateTimeFormat().resolvedOptions().timeZone, 'by default the browser names its own time zone');
  assert.equal(browserZone(), Intl.DateTimeFormat().resolvedOptions().timeZone);
  const dubai = { getTimezoneOffset: () => -240, getTime: () => Date.parse('2026-10-26T21:30:00Z') };
  assert.equal(utcOffset(dubai), 240);
  assert.deepEqual(listWindow({ ...DEFAULT_PREFS, window: 'today' }, 'Asia/Dubai'), { window: 'today', time_zone: 'Asia/Dubai' }, 'the list says which today it means');
  assert.deepEqual(listWindow(DEFAULT_PREFS, 'Asia/Dubai'), { window: 'all', time_zone: 'Asia/Dubai' });
  assert.deepEqual(listWindow(DEFAULT_PREFS, ''), { window: 'all' }, 'a browser that names no time zone sends none, and the server counts the day in UTC');
  assert.equal(localDay(dubai), '2026-10-27', 'at 01:30 in Dubai it is already the 27th');
  assert.deepEqual(['hour', 'today', 'week', 'month', 'all', 'everything', 'odd'].map(windowLabel),
    ['This hour', 'Today', 'This week', 'This month', 'All open', 'Everything', 'All open']);
});

test('Everything is kept like any window, sends the list no window and no limit, and asks the Overview what All open asks', () => {
  const store = memory();
  assert.equal(writePrefs(store, ME, { ...DEFAULT_PREFS, window: 'everything', limit: 25 }), true);
  assert.deepEqual(readPrefs(store, ME), { ...DEFAULT_PREFS, window: 'everything', limit: 25 });
  assert.equal(cleanPrefs({ window: 'Everything' }).window, 'all', 'only the exact id is kept');
  const every = { ...DEFAULT_PREFS, window: 'everything' };
  assert.deepEqual(listWindow(every, 'Asia/Dubai'), {});
  assert.deepEqual(listWindow({ ...every, limit: 25 }, 'Asia/Dubai'), {}, 'the server ranks no list without a window, so no limit goes with it');
  assert.equal(listLimit({ ...every, limit: 25 }), 0);
  assert.equal(listLimit({ ...DEFAULT_PREFS, limit: 25 }), 25);
  assert.deepEqual(windowParams(every), windowParams(DEFAULT_PREFS));
  assert.deepEqual(windowParams({ ...every, limit: 10 }), windowParams({ ...DEFAULT_PREFS, limit: 10 }));
  assert.equal(pickedWindow(every), false, 'Everything picks no window for the Overview');
  assert.equal(pickedWindow({ ...every, limit: 10 }), true);
  assert.deepEqual(['hour', 'today', 'week', 'month', 'all', 'everything'].map((window) => narrowWindow({ ...DEFAULT_PREFS, window })), [true, true, true, true, false, false]);
});

test('a closed record says who closed it, when and why, and offers Undo only for a close that was not itself an undo', () => {
  const row = { _inspire_status: 'Done', _inspire_closed_by: SAM, _inspire_closed_at: '2026-10-26T15:20:00.000Z', _inspire_closed_batch: 'a'.repeat(32),
    _inspire_closed_undo: false, _inspire_closed_can_undo: true, _inspire_closed_note: ' Repriced the shelf ', _inspire_closed_reason: null,
    _inspire_closed_comment: 'Called the store' };
  assert.equal(closedText(row), `By ${SAM} on Oct 26, 2026, 03:20 PM UTC. Note: Repriced the shelf`);
  assert.equal(closedText({ ...row, _inspire_closed_note: '' }), `By ${SAM} on Oct 26, 2026, 03:20 PM UTC. Note: Called the store`, 'the note on the record when no note came with the act');
  assert.equal(closedText({ ...row, _inspire_status: 'Dismissed', _inspire_closed_reason: 'Known issue' }),
    `By ${SAM} on Oct 26, 2026, 03:20 PM UTC. Why: Known issue. Note: Repriced the shelf`);
  assert.equal(closedText({ ...row, _inspire_closed_by: 'run 77', _inspire_closed_note: null, _inspire_closed_comment: null }), 'By the job, run 77 on Oct 26, 2026, 03:20 PM UTC');
  for (const open of [{ ...row, _inspire_status: 'New' }, { ...row, _inspire_status: 'In progress' }, { ...row, _inspire_status: null }, {}, null]) assert.equal(closedText(open), '');
  assert.equal(closedText({ _inspire_status: 'Done' }), '', 'a closed record with no close found says nothing rather than guess');
  assert.equal(undoBatchOf(row, ME), 'a'.repeat(32));
  for (const [r, who] of [[{ ...row, _inspire_closed_undo: true }, ME], [row, ''], [row, '  '], [{ ...row, _inspire_closed_batch: 'nope' }, ME],
    [{ ...row, _inspire_closed_batch: null }, ME], [{ ...row, _inspire_status: 'New' }, ME], [{ ...row, _inspire_closed_can_undo: false }, ME],
    [{ ...row, _inspire_closed_can_undo: undefined }, ME], [{ ...row, _inspire_closed_can_undo: 'yes' }, ME]]) {
    assert.equal(undoBatchOf(r, who), '', JSON.stringify([r?._inspire_closed_batch, r?._inspire_closed_can_undo, who]));
  }
  assert.equal(closedBatchOf({ ...row, _inspire_closed_can_undo: false }), 'a'.repeat(32), 'the close is still undoable by its author or an owner');
  for (const r of [{ ...row, _inspire_closed_undo: true }, { ...row, _inspire_status: 'New' }, { ...row, _inspire_closed_batch: 'nope' }]) assert.equal(closedBatchOf(r), '');
  assert.equal(UNDO_THEIRS, 'Only the person who made this change or an owner of this use case can undo it.');
  assert.equal(UNDO_CLOSE, 'Undo puts back every record this change touched, as they were before it, and keeps both versions in their history.');
});

test('a fold is kept per page, folding one page never touches another, and the last visit is per page', () => {
  let prefs = setFolds(DEFAULT_PREFS, 'n01', ['chart:a', 'kpis'], true);
  prefs = setFolds(prefs, 'n02', ['chart:a'], true);
  assert.equal(isFolded(prefs, 'n01', 'chart:a'), true);
  assert.equal(isFolded(prefs, 'n01', 'chart:b'), false);
  prefs = setFolds(prefs, 'n01', ['chart:a', 'kpis'], false);
  assert.deepEqual(prefs.folds, { n02: { 'chart:a': true } }, 'an emptied page leaves no entry behind');
  prefs = markVisit(prefs, 'n01', NOW);
  assert.equal(visitedAt(prefs, 'n01'), NOW);
  assert.equal(visitedAt(prefs, 'n02'), 0);
  assert.equal(nextDay('2026-10-31'), '2026-11-01');
  assert.equal(nextDay('2026-12-31T23:00:00Z'), '2027-01-01');
});

test('the progress line says the step, the rows and the time left only from what the server sent, and never a percent', () => {
  const active = { result: 'running', started: '2026-10-27T09:27:00Z', stage: 'Scoring the records', stage_index: 3, stage_total: 5, rows_done: 1200000,
    rows_total: 4000000, percent: 30, eta_s: 380 };
  assert.equal(stepText(active, NOW, 300), 'Step 3 of 5: Scoring the records · 1,200,000 of 4,000,000 rows · about 6 min left');
  assert.equal(stepText({ ...active, eta_s: 25 }, NOW), 'Step 3 of 5: Scoring the records · 1,200,000 of 4,000,000 rows · under a minute left');
  assert.equal(stepText({ ...active, eta_s: null, rows_total: null }, NOW, 300), 'Step 3 of 5: Scoring the records · 1,200,000 rows · running for 3 min, usually about 5 min');
  assert.equal(stepText({ ...active, stage_index: 6 }, NOW), 'Scoring the records · 1,200,000 of 4,000,000 rows · about 6 min left', 'a step past the total is not shown');
  const bare = { result: 'running', started: '2026-10-27T09:27:00Z' };
  assert.equal(stepText(bare, NOW, 300), progressText(bare, NOW, 300));
  assert.equal(stepText(bare, NOW, 300), 'running for 3 min, usually about 5 min');
  assert.equal(stepText({ ...bare, stage: null, stage_index: null, stage_total: null, rows_done: null, rows_total: null, percent: null, eta_s: null }, NOW), 'running for 3 min');
  for (const one of [active, bare, { ...active, eta_s: null }]) assert.doesNotMatch(stepText(one, NOW, 300), /%/);
  assert.equal(progressShare(active), 30);
  assert.equal(progressShare({ ...active, percent: 140 }), 100);
  assert.equal(progressShare({ ...active, percent: '' }), null);
  assert.equal(progressShare(bare), null, 'no percent from the server means no bar width');
  assert.equal(untilText({ last_success: { ended: '2026-10-27T07:30:00Z' } }, NOW), 'Until it finishes you see the data of the update on Oct 27, 07:30 AM UTC');
  assert.equal(untilText({ last_success: null }, NOW), '');
});

test('an act says how many records it wrote and how many it left as they were, and Undo says what came back', () => {
  const most = actOutcome({ written: 28, conflicts_count: 2, conflicts: [{ record_key: 'R4' }, { record_key: 'R9' }], batch_id: 'b-1' });
  assert.deepEqual(most, { written: 28, conflicts: 2, sample: [{ record_key: 'R4' }, { record_key: 'R9' }], batch: 'b-1', matched: null, leftOut: 0, changed: [] });
  assert.deepEqual(actOutcome({ written: ['R1', 'R2'], conflicts: [] }), { written: 2, conflicts: 0, sample: [], batch: '', matched: null, leftOut: 0, changed: [] });
  assert.deepEqual(actOutcome({ written: 1, changed: ['R7', 9] }).changed, ['R7', '9']);
  const hidden = actOutcome({ written: 5, conflicts: [], left_out: 3 });
  assert.equal(hidden.leftOut, 3);
  assert.equal(actedText(hidden, { action_status: 'Done' }), '5 records marked done. 3 records you cannot read were left out.');
  assert.equal(actedText(actOutcome({ written: 1, left_out: 1 }), { action_status: 'Done' }), '1 record marked done. 1 record you cannot read was left out.');
  assert.equal(undoText({ restored: 2, skipped: [], left_out: 4 }), 'Undone: 2 records are back as they were. 4 records you cannot read were left out.');
  assert.equal(actOutcome({ written: 1, conflicts_count: 900, conflicts: Array.from({ length: 30 }, (_, i) => ({ record_key: `k${i}` })) }).sample.length, 20);
  assert.equal(actedText(most, { action_status: 'Done', note: 'Closed the promo' }),
    '28 records marked done. 2 records changed since you loaded them and were left as they are.');
  assert.equal(actedText(actOutcome({ written: ['R1'] }), { action_owner: SAM }), `1 record given to ${SAM}.`);
  assert.equal(actedText(actOutcome({ written: 3 }), { snooze_until: '2026-11-03' }), '3 records snoozed until Nov 3, 2026.');
  assert.equal(changeWords({ note: 'Called them' }), 'noted');
  assert.equal(changeWords({ action_status: 'In progress', note: 'x' }), 'set to In progress');
  assert.equal(conflictText(1), '1 record changed since you loaded it and was left as it is');
  assert.equal(conflictText(2400), '2,400 records changed since you loaded them and were left as they are');
  assert.equal(conflictText(0), '');
  assert.equal(undoText({ restored: 28, skipped: ['R11'] }), 'Undone: 28 records are back as they were. 1 record changed since and was left as it is.');
  assert.equal(undoText({ restored: ['R1'], skipped: [] }), 'Undone: 1 record is back as it was.');
  assert.equal(undoText({ restored: 0, skipped: 3 }), 'Nothing was undone. 3 records changed since and were left as they are.');
  assert.equal(recordsText(1234567), '1,234,567 records');
});

test('Select all matching sends the list filters and view as of the load time, never keys, paging or sort', () => {
  const body = { page: 'n01', filters: { category: ['Books'] }, ai: {}, search: 'coat', mine: true, changed: false, column_filters: { tier: ['Act now'] }, window: 'week',
    sort: { key: 'rank', dir: 'asc' }, offset: 25, limit: 25, cursor: { dir: 'next', value: 3, key: 'R3' } };
  const match = matchOf(body, 5555555555555555);
  assert.deepEqual(match, { filters: { category: ['Books'] }, view: { ai: {}, search: 'coat', mine: true, changed: false, column_filters: { tier: ['Act now'] }, window: 'week' },
    as_of_us: '5555555555555555' });
  for (const gone of ['record_keys', 'seen', 'sort', 'offset', 'limit', 'cursor', 'page']) assert.ok(!(gone in match) && !(gone in match.view), gone);
  assert.deepEqual(matchOf({ filters: {} }, '5').view, {}, 'a view key the list did not send is not invented');
  assert.deepEqual(matchOf({ filters: {}, window: 'today', time_zone: 'Asia/Dubai', window_limit: 25, limit: 10 }, '5').view, { window: 'today', time_zone: 'Asia/Dubai', window_limit: 25 },
    'select all acts on what the limit shows, the same records the list counts, and never on the page size');
  assert.equal(asOfText(5555555555555555), 'Jan 18, 2146, 09:52 AM UTC');
  assert.equal(asOfText(''), '');
});

test('similar records are named by the values they share, and a change in the history reads like a person wrote it', () => {
  assert.equal(byWords([{ filter: 'category', label: 'Category', value: 'Books' }, { filter: 'region', label: 'Region', value: 'South' }]), 'Category Books, Region South');
  assert.equal(byWords([{ filter: 'store', value: 12 }]), 'store 12', 'a filter with no label is named by its id');
  assert.equal(byWords(null), '');
  assert.equal(byWords([null, {}]), '');
  assert.equal(batchText({ batch_id: 'b', editor: ME, at: '2026-10-27T09:10:00Z', count: 30, values: { action_status: 'Done' }, note: ' Closed the promo ' }),
    `Oct 27, 2026, 09:10 AM UTC, ${ME}: 30 records marked done. Note: Closed the promo`);
  assert.equal(batchText({ at: '2026-10-27T09:10:00Z', count: 1, values: { action_owner: SAM } }), `Oct 27, 2026, 09:10 AM UTC, someone: 1 record given to ${SAM}`);
  assert.equal(batchText({ at: '2026-10-27T09:12:00Z', editor: 'dana', count: 2, values: { action_status: 'New' }, undoes: 'b-1' }),
    'Oct 27, 2026, 09:12 AM UTC, dana: undid an earlier change on 2 records');
});

test('only an open record past its due date is overdue, and overdue records go first in the order they came', () => {
  const today = '2026-10-27';
  assert.equal(isOverdue('2026-10-26', 'New', today), true);
  assert.equal(isOverdue('2026-10-26T23:00:00Z', null, today), true);
  assert.equal(isOverdue('2026-10-27', 'New', today), false, 'due today is not late yet');
  assert.equal(isOverdue('2026-10-01', 'Done', today), false, 'a done record is never late');
  assert.equal(isOverdue(null, 'New', today), false);
  const rows = [{ k: 1, _inspire_due: '2026-10-30' }, { k: 2, _inspire_due: '2026-10-20', _inspire_status: 'In progress' }, { k: 3 }, { k: 4, _inspire_due: '2026-10-01' }];
  const out = overdueFirst(rows, today);
  assert.deepEqual(out.rows.map((r) => r.k), [2, 4, 1, 3]);
  assert.equal(out.late, 2);
  assert.deepEqual(overdueFirst([{ k: 1 }], today), { rows: [{ k: 1 }], late: 0 });
});

test('done today adds up the count of records each use case says I marked done today, and says nothing when no use case knows', () => {
  const page = (mine) => ({ done: { fixed: 9, mine_today: mine } });
  const dubai = { name: 'Asia/Dubai', sent: true };
  assert.deepEqual(doneTodayOf([page(CONTRACT.overview_window.page_fields.done.mine_today), page(2), page(null), {}], dubai), { n: 5, utc: false });
  assert.deepEqual(doneTodayOf([page(0), page(0)], dubai), { n: 0, utc: false });
  assert.equal(doneTodayOf([page(null), page(undefined), {}, null], dubai), null, 'no use case counted, for a person not signed in or a count that could not be read');
  assert.equal(doneTodayOf([], dubai), null);
  const work = { rows: [1, 2], late: 1, today: 1 };
  assert.equal(myWorkText(work, { n: 5, utc: false }), '2 assigned to you · 1 overdue · 1 due today · 5 done today');
  assert.equal(myWorkText(work, { n: 0, utc: false }), '2 assigned to you · 1 overdue · 1 due today');
  assert.equal(myWorkText(work), '2 assigned to you · 1 overdue · 1 due today');
  const utc = doneTodayOf([page(3)], { name: 'UTC', sent: false });
  assert.deepEqual(utc, { n: 3, utc: true }, 'a day the server counted in UTC because the browser named no time zone');
  assert.equal(myWorkText(work, utc), '2 assigned to you · 1 overdue · 1 due today · 3 done today (UTC)');
  assert.deepEqual([doneDay(utc), doneDay({ n: 3, utc: false }), doneDay(null)], ['today (UTC)', 'today', 'today']);
  assert.deepEqual(doneTodayOf([page(3)], { name: 'UTC', sent: true }), { n: 3, utc: false }, 'a person whose own time zone is UTC reads plain today');
});

test('a folded block is named by its first words, never by its markup', () => {
  assert.equal(blockTitle({ kind: 'text', content: '\n## How to read **this** page\nMore text' }), 'How to read this page');
  assert.equal(blockTitle({ kind: 'html', content: '<style>p{color:red}</style><p>Read <b>this</b> first</p>' }), 'Read this first');
  assert.equal(blockTitle({ kind: 'image', content: { alt: 'Store map', caption: '' } }), 'Store map');
  assert.equal(blockTitle({ kind: 'text', content: '' }), 'Note');
  assert.equal(blockTitle({ kind: 'text', content: 'x'.repeat(200) }), `${'x'.repeat(89)}…`);
});

test('a record link keeps the page and its filters and names one record, and a done-toast link asks for what changed', () => {
  assert.equal(withRecord('#/n01_u05?f=abc', 'R 1'), '#/n01_u05?f=abc&rec=R+1');
  assert.equal(withRecord('#/n01_u05?rec=old&v=runs', 'R2'), '#/n01_u05?v=runs&rec=R2');
  assert.equal(withRecord('', 'R3'), '#/?rec=R3');
  assert.equal(parseHash(withRecord('#/n01_u05', 'R 1')).rec, 'R 1');
  assert.equal(parseHash('#/n01_u05?changed=1').changed, true);
  assert.equal(parseHash('#/n01_u05?changed=yes').changed, false);
  assert.equal(parseHash('#/n01_u05').present, false, 'the changed flag alone is not a filter link');
});

test('no new text in the App uses an en or em dash', () => {
  for (const file of ['prefs.js', 'MyView.jsx', 'Work.jsx', 'Freshness.jsx', 'freshness.js', 'Records.jsx', 'records.js', 'Home.jsx', 'hub.js', 'blocks.js', 'Settings.jsx',
    'styles/work.css']) {
    assert.doesNotMatch(readFileSync(join(SRC, file), 'utf8'), /[\u2013\u2014]/, file);
  }
});

test('a list that changed since it was loaded says so in plain words, and every other refusal keeps its own reason', () => {
  const refused = (status, body) => Object.assign(new Error(body.error), { status, detail: body, code: body.code || '' });
  const { stale_list: stale, unknown_copy: unknown, no_match: none } = CONTRACT.errors;
  assert.equal(STALE_LIST, 'The list changed since you loaded it. Reload and try again.');
  assert.equal(actError(refused(stale.status, stale.body)), STALE_LIST);
  assert.equal(actError(refused(unknown.status, unknown.body)), STALE_LIST);
  assert.equal(actError(refused(none.status, none.body)), STALE_LIST);
  const over = CONTRACT.act_match.over_cap;
  assert.equal(actError(refused(over.status, over.body)), 'These filters match 100,001 records. You can change up to 100,000 at once, so narrow the filters and try again.');
  for (const [status, error] of [
    [409, 'none of the 3 records changed: Someone changed this record'],
    [409, 'this decision list keeps no actions, so the App cannot act on its records'],
    [409, 'the App found no history of main.pricing.loss_desk_out, so it cannot tell what changed since you loaded the list; act on the records you picked instead'],
    [400, 'reload the list and try again'],
  ]) assert.equal(actError(refused(status, { error })), error, `${status} ${error}`);
  assert.equal(actError(new Error('')), 'The change could not be saved');
});

test('the web tells refusals apart by their code alone, so new server wording never changes what a person reads', () => {
  const refused = (status, body) => Object.assign(new Error(body.error), { status, detail: body, code: body.code || '' });
  for (const code of ['stale_list', 'unknown_copy', 'no_match']) {
    assert.equal(actError(refused(409, { error: 'The table moved on while you were looking at it', code })), STALE_LIST, code);
  }
  assert.equal(actError(refused(409, { error: 'no record matches these filters any more; reload the list' })), 'no record matches these filters any more; reload the list',
    'the words reload the list without a code are only words');
  assert.equal(actError(refused(409, { error: 'Too many, ask for fewer', matched: 100001, cap: 100000, code: 'over_cap' })),
    'These filters match 100,001 records. You can change up to 100,000 at once, so narrow the filters and try again.');
  assert.equal(actError(refused(409, { error: 'Too many', matched: 100001, cap: 100000 })), 'Too many', 'counts without the code are not read as a cap');
  const record = CONTRACT.errors.stale_record;
  assert.equal(isStaleRecord(refused(record.status, record.body)), true);
  assert.equal(isStaleRecord(refused(409, { ...record.body, error: 'Other words entirely' })), true);
  for (const body of [{ error: record.body.error }, CONTRACT.errors.stale_list.body, { error: 'x', code: 'STALE_RECORD' }]) assert.equal(isStaleRecord(refused(409, body)), false);
  const served = Object.values(CONTRACT.errors).map((e) => e.body.code).concat(CONTRACT.act_match.over_cap.body.code).filter(Boolean).sort();
  assert.deepEqual(Object.values(CODES).sort(), served, 'the web knows exactly the codes the server sends');
});

test('a change the read-only demo refuses is a calm note, and every other failure stays the error it is', async () => {
  const real = globalThis.fetch;
  const answer = (status, body) => { globalThis.fetch = async () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } }); };
  try {
    answer(403, { error: 'This is the demo, so nothing in it changes. Choose Get Started to find use cases and build MVPs on your own data.', showcase: true });
    const demo = await actRecords({ page: 'n01_u05' }).catch((e) => e);
    assert.equal(DEMO_NOTE, 'This is a demo, so it is read-only: nothing you do here changes any data.');
    assert.deepEqual([demo.calm, demo.message, demo.status, toneOf(demo)], [true, DEMO_NOTE, 403, 'info']);
    assert.deepEqual(failureOf(demo), { text: DEMO_NOTE, calm: true });
    for (const [status, note] of [[404, 'The demo has no saved answer for this view.'], [409, DEMO_NOTE], [400, DEMO_NOTE]]) {
      answer(status, { error: 'The demo has no saved answer for this view.', showcase: true });
      const refused = await actRecords({ page: 'n01_u05' }).catch((e) => e);
      assert.deepEqual([refused.calm, refused.message, refused.status, toneOf(refused)], [true, note, status, 'info'], `${status} marked showcase`);
    }
    for (const [status, body] of [[500, { error: 'the warehouse stopped' }], [403, { error: 'this App does not let people change its data' }],
      [403, { error: 'not quite', showcase: 'true' }], [500, { error: 'the demo proxy broke', showcase: true }], [404, { error: 'no such page' }]]) {
      answer(status, body);
      const err = await actRecords({ page: 'n01_u05' }).catch((e) => e);
      assert.deepEqual([err.calm, err.message, toneOf(err)], [false, body.error, 'error'], `${status} ${JSON.stringify(body)}`);
      assert.deepEqual(failureOf(err), { text: body.error, calm: false });
    }
    assert.deepEqual(failureOf(new Error('plain'), 'Shown instead'), { text: 'Shown instead', calm: false });
  } finally {
    globalThis.fetch = real;
  }
});

test('no web file reads the words of a server refusal or a run error to decide what to show', () => {
  const sources = fileNames(SRC).filter((f) => /\.(js|jsx)$/.test(f));
  const wording = /\b(message|error|detail)\b(\s*(\|\||\?\?)\s*(''|""))?\s*\)?\s*\??\.(match|includes|startsWith|endsWith|indexOf|search)\(|\.test\([^)]*\b(message|error|detail)\b/;
  const status = /\.status\s*===\s*(400|409)\b/;
  const reads = ["err.message.includes('no window')", "(err.message || '').startsWith('x')", "String(error).match(/x/)", 'error.message?.includes("x")',
    "detail.indexOf('x')", "/x/.test(err.message)"];
  const codes = ['const refused = !!state.error && REFUSED.includes(state.error.status);', "const calm = error?.code === 'stale_list';",
    'if (error && ALLOWED.includes(code)) return;'];
  assert.deepEqual(reads.filter((line) => !wording.test(line)), [], 'each of these reads the words');
  assert.deepEqual(codes.filter((line) => wording.test(line)), [], 'each of these reads a code, never the words');
  const found = sources.flatMap((f) => readFileSync(join(SRC, f), 'utf8').split('\n').map((line, i) => [f, i + 1, line]))
    .filter(([, , line]) => wording.test(line) || status.test(line)).map(([f, n, line]) => `${f}:${n}: ${line.trim()}`);
  assert.deepEqual(found, []);
});

test('select all takes the moment the server read the list, and nothing when the server did not say', () => {
  assert.equal(listAsOf({ as_of_us: CONTRACT.records_window.response_fields.as_of_us }), '5555555555555555');
  assert.equal(listAsOf({ as_of_us: 5555555555555555 }), '5555555555555555');
  for (const as_of_us of [undefined, null, '', '0', 0, 'soon', '-5', '12.5', ' 7']) assert.equal(listAsOf({ as_of_us }), '', String(as_of_us));
  assert.equal(listAsOf(null), '');
  assert.equal(NO_AS_OF, 'The App cannot tell when this list was read, so it cannot act on every matching record. Reload the list and try again.');
});

test('a run that has gone quiet reads the server note and nothing that says it is moving', () => {
  const quiet = { started: '2026-10-27T09:00:30Z', stage: 'Running the use case', stage_index: 2, stage_total: 5, percent: null, eta_s: null,
    silent_since: '2026-10-27T09:08:20Z', message: 'No news from this run since 09:08 UTC. It may have stopped.' };
  assert.equal(isQuiet(quiet), true);
  assert.equal(stepText(quiet, NOW, 1500), 'No news from this run since 09:08 UTC. It may have stopped.');
  assert.equal(progressShare({ ...quiet, percent: 40 }), null, 'a percent sent with a quiet run is not drawn');
  assert.equal(stepText({ ...quiet, message: '' }, NOW), 'No news from this run. It may have stopped.');
  for (const moving of [{ ...quiet, silent_since: null }, { ...quiet, silent_since: '' }, { started: '2026-10-27T09:00:30Z' }]) {
    assert.equal(isQuiet(moving), false);
    assert.doesNotMatch(stepText(moving, NOW), /No news/);
  }
});

test('the limit line names what the server kept in each use case, and nothing when the server sent it all', () => {
  assert.equal(limitText([['Price desk', 10, 12]]), 'Your limit keeps the top 10 of 12 records in Price desk. Change the limit in Settings.');
  assert.equal(limitText([['A', 10, 12], ['B', 10, 1250], ['C', 10, 40]]),
    'Your limit keeps the top 10 of 12 records in A, the top 10 of 1,250 in B and the top 10 of 40 in C. Change the limit in Settings.');
  assert.equal(limitText([['A', 10, 10], ['B', 3, 3]]), '', 'nothing is held back');
  assert.equal(limitText([['A', 10, 10], ['B', 10, 11]]), 'Your limit keeps the top 10 of 11 records in B. Change the limit in Settings.');
  assert.equal(limitText([]), '');
});

test('undo names the records it left, and a match act says how many of the matching records it changed', () => {
  const names = { k2: 'Wool coat, store 4', k7: 'Blue jacket, store 12' };
  const nameOf = (s) => names[s.record_key] || s.record_key;
  assert.equal(undoText(CONTRACT.undo.response, nameOf), 'Undone: 1 record is back as it was. 1 record changed since and was left as it is: Wool coat, store 4.');
  assert.equal(undoText(CONTRACT.undo.response), 'Undone: 1 record is back as it was. 1 record changed since and was left as it is: k2.', 'with no label the key names it');
  assert.equal(undoText({ restored: 4, skipped: 5, skipped_sample: [{ record_key: 'k2' }, { record_key: 'k7' }] }, nameOf),
    'Undone: 4 records are back as they were. 5 records changed since and were left as they are: Wool coat, store 4, Blue jacket, store 12, and 3 more.');
  assert.equal(undoText({ restored: 2, skipped: 0, skipped_sample: [] }), 'Undone: 2 records are back as they were.');
  assert.equal(undoText({ restored: 0, skipped: 1, skipped_sample: [] }), 'Nothing was undone. 1 record changed since and was left as it is.');
  const matched = actOutcome(CONTRACT.act_match.response);
  assert.equal(matched.matched, 3);
  assert.equal(actedText(matched, CONTRACT.act_match.request.body.values),
    '2 of 3 matching records marked done. 1 record changed since you loaded it and was left as it is.');
  assert.equal(actedText(actOutcome({ written: 3, matched: 3, conflicts: [], conflicts_count: 0 }), { action_status: 'Done' }), '3 records marked done.');
  assert.equal(actOutcome(CONTRACT.act_keys.response).matched, null, 'an act on picked records names no match');
  assert.equal(actedText(actOutcome(CONTRACT.act_keys.response), CONTRACT.act_keys.request.body.values).startsWith('1 record '), true);
});
