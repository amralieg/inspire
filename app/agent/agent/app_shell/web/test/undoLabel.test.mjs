import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { CURRENT, DECIDE, FIELDS, ROWS, TABLE, appInfo, goRail, openApp, pageData, serveDist } from './harness.mjs';

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
const CLOSED = { _inspire_status: 'Done', _inspire_closed_by: 'sam.roe@example.com', _inspire_closed_at: '2026-11-10T09:00:00Z',
  _inspire_closed_batch: BATCH, _inspire_closed_can_undo: true };

async function openClosedRecord(info) {
  const records = ({ route, json, seen }) => {
    const body = route.request().postDataJSON();
    seen.records.push(body);
    const all = pageData(body.filters).records.rows.map((r, i) => (i === 0 ? { ...r, ...CLOSED } : r));
    const offset = body.offset || 0;
    return json(200, { rows: all.slice(offset, offset + (body.limit || 25)), total: all.length, offset, limit: body.limit || 25,
      actions: true, changes: false, summary: null, errors: {} });
  };
  const history = ({ json }) => json(200, { record_key: ROWS[0].record_key, fields: FIELDS, versions: [CURRENT],
    current: { ...CURRENT, ...CLOSED, action_status: 'Done', record_key: ROWS[0].record_key }, deleted: false, truncated: false });
  const opened = await openApp(browser, served.base, info, { routes: { records, 'records/history': history } });
  await goRail(opened.page, 'work');
  await opened.page.locator('.card--table tbody tr .cell-t').first().waitFor({ timeout: 20000 });
  await opened.page.locator('.cell-t').first().click();
  await opened.page.locator('dialog[open] footer').waitFor({ timeout: 15000 });
  return opened;
}

const undoButton = (page) => page.locator('dialog[open] footer [data-undo-close]');

test('a closed record in a decision list offers Reopen, not a generic Undo this change', async () => {
  const { page, context } = await openClosedRecord(appInfo({ ...DECIDE }, 1, { ...TABLE }, 'examples/monitor_triage.json'));
  try {
    await undoButton(page).waitFor({ timeout: 10000 });
    assert.equal((await undoButton(page).innerText()).trim(), 'Reopen');
  } finally {
    await context.close();
  }
});

test('a closed merged record whose kind names its undo word offers that word, Unmerge', async () => {
  const { page, context } = await openClosedRecord(appInfo({ ...DECIDE }, 1, { ...TABLE }, 'examples/entity_matching.json'));
  try {
    await undoButton(page).waitFor({ timeout: 10000 });
    assert.equal((await undoButton(page).innerText()).trim(), 'Unmerge');
  } finally {
    await context.close();
  }
});
