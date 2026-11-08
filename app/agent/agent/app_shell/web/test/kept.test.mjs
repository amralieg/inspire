import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { PERSON, TABLE, appInfo, openApp, pageData, serveDist } from './harness.mjs';
import { NOT_IN_RUN, changeBadge, keptText, missingSince, notInRunText } from '../src/records.js';
import { STATES, closedRows } from '../src/impact.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const DECIDE = { options: { modify: false, replace_edits: false, decisions: true } };
const LEFT = '2026-10-20T06:00:00.000Z';
const F = (name, kind, role = 'business', type = 'STRING') => ({ name, kind, role, type, editable: role === 'business' && kind != null });
const FIELDS = [F('entity_id', 'text', 'id'), F('entity_label', 'text'), F('priority_tier', 'text'), F('record_key', 'text', 'history'),
  F('valid_from', 'timestamp', 'history', 'TIMESTAMP'), F('is_current', 'boolean', 'history', 'BOOLEAN'), F('change_source', 'text', 'history'),
  F('changed_by', 'text', 'history'), F('action_owner', 'text', 'action'), F('action_status', 'text', 'action'), F('action_due', 'date', 'action', 'DATE'),
  F('action_note', 'text', 'action'), F('dismiss_reason', 'text', 'action'), F('action_outcome', 'text', 'action'),
  F('edited_by_person', 'boolean', 'kept', 'BOOLEAN'), F('not_listed_since', 'timestamp', 'kept', 'TIMESTAMP')];
const ROWS = pageData({}).records.rows.slice(0, 4).map((r, i) => ({ ...r, record_key: r.entity_id, _inspire_key: r.entity_id, _inspire_version: String(100 + i),
  _inspire_owner: null, _inspire_status: null, _inspire_change: i === 1 ? 'new' : null, _inspire_moved_to: null, _inspire_missing: i === 0 ? LEFT : null }));
const version = (row, extra) => ({ ...row, valid_from: '2026-10-15T09:00:00.000Z', is_current: true, change_source: 'edit', changed_by: 'pat.lee@example.com',
  valid_from_us: '201', action_owner: null, action_status: 'New', action_due: null, action_note: null, dismiss_reason: null, action_outcome: null,
  edited_by_person: true, not_listed_since: null, ...extra });

function routes() {
  return {
    records: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      seen.records.push(body);
      return json(200, { rows: ROWS, total: ROWS.length, offset: 0, limit: body.limit, actions: true, changes: true, errors: {},
        summary: { open: 2, done: 0, resolved: 0, left: 3, kept: 1, owners: [] } });
    },
    'records/fields': ({ json }) => json(200, { fields: FIELDS, key_field: 'entity_id', actions: true }),
    'records/history': ({ json, url }) => {
      const key = url.searchParams.get('record_key');
      const row = ROWS.find((r) => r.record_key === key);
      const current = version(row, { not_listed_since: row._inspire_missing, change_source: row._inspire_missing ? 'edit' : 'run' });
      return json(200, { record_key: key, fields: FIELDS, versions: [current], current, deleted: false, truncated: false });
    },
  };
}

test('one rule names a record the runs no longer list, and only that record', () => {
  assert.equal(NOT_IN_RUN, 'Not in the latest run');
  assert.deepEqual(changeBadge({ _inspire_missing: LEFT }), { text: NOT_IN_RUN, kind: 'missing' }, 'the list row carries the tag');
  assert.deepEqual(changeBadge({ not_listed_since: LEFT, _inspire_change: null }), { text: NOT_IN_RUN, kind: 'missing' }, 'the current version carries it too');
  assert.deepEqual(changeBadge({ _inspire_change: 'new', _inspire_missing: null }), { text: 'New', kind: 'new' }, 'an untagged record keeps its other badge');
  assert.equal(changeBadge({ not_listed_since: null }), null);
  assert.equal(missingSince({ _inspire_missing: null, not_listed_since: LEFT }), LEFT);
  assert.equal(keptText(1), '1 record not in the latest run, kept because people changed it');
  assert.equal(keptText(4), '4 records not in the latest run, kept because people changed them');
  assert.equal(keptText(0), '');
  assert.equal(notInRunText(LEFT), "The runs stopped listing this record on Oct 20, 2026. It stays because a person changed or added it, and this App keeps people's changes.");
  assert.equal(STATES.missing, NOT_IN_RUN);
  assert.deepEqual(closedRows({ records: [{ key: 'g1', status: 'Done', state: 'missing', at_close: 900, now: 0, measured: 900, closed: LEFT },
    { key: 'f2', status: 'Done', state: 'left', at_close: 700, now: 0, measured: 700, closed: LEFT }] }, 'USD').map((r) => r.state), [NOT_IN_RUN, 'Left the list']);
});

test('the list tags the kept record, counts it beside the records that left, and its panel says why it stays', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: routes(), hash: '#/n01_u05/work' });
  await page.locator('.left-n').waitFor();
  assert.equal(await page.locator('.left-n').innerText(), '3 records left the list since the last run · 1 record not in the latest run, kept because people changed it');
  const rows = page.locator('.card--table tbody tr');
  assert.equal(await rows.nth(0).locator('.chg-b').innerText(), NOT_IN_RUN);
  assert.equal(await rows.nth(1).locator('.chg-b').innerText(), 'New', 'a record the newest run lists never reads Not in the latest run');
  assert.equal(await rows.nth(2).locator('.chg-b').count(), 0);
  await rows.nth(0).click();
  await page.locator('dialog.drawer .kept').waitFor();
  assert.equal(await page.locator('dialog.drawer .kept').innerText(), notInRunText(LEFT));
  assert.equal(await page.locator('dialog.drawer .panel-meta .chg-b').innerText(), NOT_IN_RUN);
  await page.keyboard.press('Escape');
  await rows.nth(2).click();
  await page.locator('dialog.drawer .sec').first().waitFor();
  assert.equal(await page.locator('dialog.drawer .kept').count(), 0, 'a record the runs still list says nothing about being kept');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Your work tags the kept record and leaves the others as they are', async () => {
  const items = [{ key: 'e1', label: 'Wool coat, store 4', tier: 'Act now', money: 400, why: null, owner: PERSON, status: null, reason: null, due: null, not_listed_since: LEFT },
    { key: 'a1', label: 'Blue denim jacket, store 12', tier: 'Act now', money: 1000, why: null, owner: PERSON, status: null, reason: null, due: null, not_listed_since: null }];
  const entry = { visible: true, tracked: true, money: true, categories: [], served: 'delta', items, total: 2, truncated: false,
    done: { fixed: 0, fixed_q: 0, dismissed: 0, dismissed_q: 0, saved_n: 0, saved: null, saved_q_n: 0, saved_q: null }, weeks: [],
    runs: { updated: '2026-10-20T06:00:00Z', as_of: '2026-10-20', cadence_days: 7, next: '2026-10-27', stale: false, count: 3, failed: false } };
  const hub = { today: '2026-10-24', quarter: '2026-10-01', since: '2026-08-03', errors: {}, pages: { n01_u05: entry, n02_u01: { ...entry, items: [], total: 0 } } };
  const summary = { run: { currency: 'USD', decision_basis: 'measured', as_of_date: '2026-10-20' }, categories: {}, note: '' };
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 2, TABLE), {
    routes: { overview: ({ json }) => json(200, hub), summary: ({ json }) => json(200, summary) }, hash: '#/n01_u05/performance' });
  await page.locator('.tbl--mine tbody tr').nth(1).waitFor();
  const cells = await page.locator('.tbl--mine tbody tr .it b').evaluateAll((all) => all.map((b) => [b.firstChild.textContent, b.querySelector('.chg-b')?.textContent || '']));
  assert.deepEqual(cells, [['Blue denim jacket, store 12', ''], ['Wool coat, store 4', NOT_IN_RUN]]);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Impact reads Not in the latest run for a fixed record the runs stopped listing', async () => {
  const entry = {
    visible: true, tracked: true, money: true, holds: false, since: '2026-10-01', served: 'delta', current: { records: 20, held: 0 },
    estimated: { 'Act now': { n: 0, money: 0 }, Review: { n: 0, money: 0 } }, reported: { n: 0, n_since: 0, money: null, money_since: null },
    measured: { n: 2, n_since: 2, money: 1600, money_since: 1600 },
    closed: { Done: { n: 2, n_since: 2 }, Dismissed: { n: 0, n_since: 0 }, 'Could not fix': { n: 0, n_since: 0 } },
    outcomes: { left: 1, missing: 1, resolved: 0, flagged: 0, unchecked: 0 }, reasons: [], holdout: null,
    records: [{ key: 'g1', label: 'Wool coat, store 4', status: 'Done', state: 'missing', reason: null, note: null, at_close: 900, now: 0, measured: 900, reported: null, closed: LEFT },
      { key: 'f2', label: 'Linen trousers', status: 'Done', state: 'left', reason: null, note: null, at_close: 700, now: 0, measured: 700, reported: null, closed: LEFT }],
  };
  const summary = { run: { currency: 'USD', decision_basis: 'measured', as_of_date: '2026-10-20' }, categories: {}, note: '' };
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), {
    routes: { impact: ({ json }) => json(200, entry), summary: ({ json }) => json(200, summary) } });
  await page.goto(`${served.base}#/impact`);
  await page.locator('.tbl--closed tbody tr').nth(1).waitFor();
  const states = await page.locator('.tbl--closed tbody tr').evaluateAll((trs) => trs.map((tr) => tr.querySelectorAll('td')[2].innerText));
  assert.deepEqual(states, [NOT_IN_RUN, 'Left the list']);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
