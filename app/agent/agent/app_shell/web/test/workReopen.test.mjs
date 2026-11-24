import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { CURRENT, DECIDE, NO_JOB, ROWS, TABLE, actBody, appInfo, openApp, serveDist, until } from './harness.mjs';

// REQ-289 (REQ-057, REQ-223, REQ-257): Reopen on closed rows and in the drawer, Unassign on owned rows and in the drawer,
// and the App build time in the header next to the data refresh time.

let served;
let browser;

before(async () => {
  served = await serveDist();
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

const BATCH = 'a'.repeat(32);
const CLOSED = { _inspire_status: 'Done', _inspire_closed_by: 'sam.roe@example.com', _inspire_closed_at: '2026-11-10T09:00:00Z' };
const WITH_BATCH = { ...CLOSED, _inspire_closed_batch: BATCH, _inspire_closed_can_undo: true };
const OWNER = 'sam.roe@example.com';
const LAST = { run_id: '101', trigger: 'scheduled', by: 'the schedule', started: '2026-10-27T07:25:00Z', ended: '2026-10-27T07:30:00Z',
  result: 'succeeded', message: '', url: 'https://ws.example.com/jobs/4242/runs/101' };
const FRESH = { ...NO_JOB, has_job: true, source: 'job', last_success: LAST, last_run: LAST, data_through: '2026-10-26', cadence_days: 1,
  can_refresh: true, reason: '', run_url: LAST.url };

/** The Work list with the first row closed by `closed` (or left open when null), every other row as the example has it. */
function listing(closed) {
  return ({ route, json, seen }) => {
    const body = route.request().postDataJSON();
    seen.records.push(body);
    const all = ROWS.map((r, i) => (i === 0 && closed ? { ...r, ...closed } : r));
    const offset = body.offset || 0;
    return json(200, { rows: all.slice(offset, offset + (body.limit || 25)), total: all.length, offset, limit: body.limit || 25,
      actions: true, changes: false, summary: null, errors: {} });
  };
}

/** The drawer's history for the record `row` as the server would return it, with its current status and owner. */
function history(row) {
  return ({ json }) => json(200, { record_key: row.record_key, fields: [], versions: [CURRENT],
    current: { ...CURRENT, ...row, record_key: row.record_key, action_status: row._inspire_status || 'New', action_owner: row._inspire_owner || null,
      valid_from_us: row._inspire_version }, deleted: false, truncated: false });
}

async function openWork(example, { closed = null, row = null, freshness = null } = {}) {
  const writes = [];
  const routes = {
    records: listing(closed),
    'records/history': history(row || { ...ROWS[0], ...(closed || {}) }),
    'records/act': ({ route, json }) => {
      const body = actBody(route);
      writes.push(body);
      return json(200, { written: body.record_keys, conflicts: [], conflicts_count: 0, left_out: 0, batch_id: BATCH });
    },
    ...(freshness ? { freshness: ({ json }) => json(200, freshness) } : {}),
  };
  const opened = await openApp(browser, served.base, appInfo({ ...DECIDE }, 1, { ...TABLE }, example), { routes });
  return { ...opened, writes };
}

test('a closed merged row on Work offers Reopen beside its Unmerge, and Reopen writes the open status through records/act', async () => {
  const { page, writes, context } = await openWork('examples/entity_matching.json', { closed: WITH_BATCH, row: { ...ROWS[0], ...WITH_BATCH } });
  try {
    const first = page.locator('.card--table tbody tr').first();
    await first.locator('[data-row-undo]').waitFor({ timeout: 20000 });
    assert.equal((await first.locator('[data-row-undo]').innerText()).trim(), 'Unmerge', 'the undo keeps the kind\'s own word');
    assert.equal((await first.locator('[data-row-reopen]').innerText()).trim(), 'Reopen', 'a closed row offers Reopen (REQ-057)');
    await first.locator('[data-row-reopen]').click();
    assert.equal(writes.length, 0, 'opening Reopen writes nothing until it is confirmed');
    await page.locator('.row-ask button', { hasText: 'Reopen' }).click();
    await until(() => writes.length === 1);
    assert.deepEqual(writes[0].values, { action_status: 'New', note: 'Reopened' }, 'Reopen writes the open status, as Done writes its status');
    assert.deepEqual(writes[0].record_keys, [ROWS[0].record_key]);
  } finally {
    await context.close();
  }
});

test('a closed row with no undo on Work offers Reopen on the row and in the drawer, and the drawer Reopen writes the open status', async () => {
  const { page, writes, context } = await openWork('examples/monitor_triage.json', { closed: CLOSED, row: { ...ROWS[0], ...CLOSED } });
  try {
    const first = page.locator('.card--table tbody tr').first();
    await first.locator('[data-row-reopen]').waitFor({ timeout: 20000 });
    assert.equal(await first.locator('[data-row-undo]').count(), 0, 'nothing to undo, so the row offers Reopen alone');
    await first.locator('.cell-t').click();
    const drawer = page.locator('dialog[open]');
    await drawer.locator('footer [data-reopen]').waitFor({ timeout: 15000 });
    assert.equal((await drawer.locator('footer [data-reopen]').innerText()).trim(), 'Reopen', 'the drawer of a closed record offers Reopen (REQ-057)');
    await drawer.locator('footer [data-reopen]').click();
    await drawer.locator('footer .row-ask button', { hasText: 'Reopen' }).click();
    await until(() => writes.length === 1);
    assert.deepEqual(writes[0].values, { action_status: 'New', note: 'Reopened' });
  } finally {
    await context.close();
  }
});

test('an owned open row on Work offers Unassign, which clears the owner through records/act and changes nothing else', async () => {
  const { page, writes, context } = await openWork('examples/monitor_triage.json', { row: ROWS[1] });
  try {
    const owned = page.locator('.card--table tbody tr', { has: page.locator('[data-row-unassign]') }).first();
    await owned.locator('[data-row-unassign]').waitFor({ timeout: 20000 });
    assert.equal((await owned.locator('[data-row-unassign]').innerText()).trim(), 'Unassign', 'the decided word for clearing an owner (REQ-223)');
    await owned.locator('[data-row-unassign]').click();
    await until(() => writes.length === 1);
    assert.deepEqual(writes[0].values, { action_owner: '' }, 'the write Give to uses to clear the owner');
    assert.deepEqual(writes[0].record_keys, [ROWS[1].record_key]);
  } finally {
    await context.close();
  }
});

test('the drawer of an owned open record has Unassign beside its owner, and clears the owner', async () => {
  const { page, writes, context } = await openWork('examples/monitor_triage.json', { row: { ...ROWS[1], _inspire_owner: OWNER } });
  try {
    await page.locator('.card--table tbody tr').nth(1).locator('.cell-t').click();
    const drawer = page.locator('dialog[open]');
    await drawer.locator('[data-unassign]').waitFor({ timeout: 15000 });
    assert.equal((await drawer.locator('[data-unassign]').innerText()).trim(), 'Unassign');
    await drawer.locator('[data-unassign]').click();
    await until(() => writes.length === 1);
    assert.equal(writes[0].values.action_owner, '', 'the owner is cleared');
    assert.deepEqual(writes[0].record_keys, [ROWS[1].record_key]);
  } finally {
    await context.close();
  }
});

test('the header shows the data refresh time and the App publish time as two times, not one', async () => {
  const { page, context } = await openWork('examples/monitor_triage.json', { freshness: FRESH });
  try {
    const banner = page.locator('.ph [data-fresh-dot]');
    await banner.waitFor({ timeout: 20000 });
    const says = ((await banner.getAttribute('title')) || '').replace(/\. Select to refresh now$/, '');
    assert.match(says, /^Data refreshed Oct 27, 07:30 AM UTC( · data through Oct 26, 2026)? · App published Oct 26, (2026, )?10:00 AM UTC$/,
      'the refresh time and the App publish time show together (REQ-257 D-UPDATED)');
  } finally {
    await context.close();
  }
});
