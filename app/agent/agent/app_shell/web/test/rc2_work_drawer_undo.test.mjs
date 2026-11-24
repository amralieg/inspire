// REQ-288: the record panel offers the kind's undo word for a merged row in Work mode too (Start working), not only in the list.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { CURRENT, DECIDE, FIELDS, ROWS, TABLE, appInfo, openApp, pageData, serveDist } from './harness.mjs';

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

const BATCH = 'b'.repeat(32);
const CLOSED = { _inspire_status: 'Done', _inspire_choice: 'merge', _inspire_closed_by: 'sam.roe@example.com', _inspire_closed_at: '2026-11-10T09:00:00Z',
  _inspire_closed_batch: BATCH, _inspire_closed_can_undo: true };

async function openMerged(info) {
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
  return openApp(browser, served.base, info, { routes: { records, 'records/history': history } });
}

test('a merged row in Work mode offers Unmerge in the record panel, the same word as the list', async () => {
  const { page, context } = await openMerged(appInfo({ ...DECIDE }, 1, { ...TABLE }, 'examples/entity_matching.json'));
  try {
    await page.locator('[data-mode="screen"]').click();
    await page.locator('.card--table tbody tr .cell-t').first().waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Start working' }).click();
    const drawer = page.locator('dialog[open]');
    await drawer.locator('.work-f').waitFor({ timeout: 15000 });
    const trigger = drawer.locator('footer [data-undo-close]');
    assert.equal(await trigger.count(), 1, 'a merged record in Work mode offers its undo in the panel');
    assert.equal((await trigger.innerText()).trim(), 'Unmerge', 'the panel names the kind word');
  } finally {
    await context.close();
  }
});
