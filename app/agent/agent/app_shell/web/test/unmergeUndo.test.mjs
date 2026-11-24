// REQ-223: a reversible decision names its undo with one word. The trigger and its confirm button read the
// same label, and confirming sends records/undo for the merge batch and reloads the Work list.
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
const CLOSED = { _inspire_status: 'Done', _inspire_closed_by: 'sam.roe@example.com', _inspire_closed_at: '2026-11-10T09:00:00Z',
  _inspire_closed_batch: BATCH, _inspire_closed_can_undo: true };
const UNDO_OUT = { restored: 1, skipped: 0, skipped_sample: [], left_out: 0, batch_id: 'c'.repeat(32), undoes: BATCH };

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
  const undo = ({ route, json, seen }) => { seen.undo = route.request().postDataJSON(); return json(200, UNDO_OUT); };
  return openApp(browser, served.base, info, { routes: { records, 'records/history': history, 'records/undo': undo } });
}

test('Unmerge in the record panel: the confirm button repeats the trigger word and sends records/undo, then reloads', async () => {
  const { page, context, seen } = await openMerged(appInfo({ ...DECIDE }, 1, { ...TABLE }, 'examples/entity_matching.json'));
  try {
    await page.locator('.card--table tbody tr .cell-t').first().waitFor({ timeout: 20000 });
    await page.locator('.cell-t').first().click();
    const trigger = page.locator('dialog[open] footer [data-undo-close]');
    await trigger.waitFor({ timeout: 15000 });
    const word = (await trigger.innerText()).trim();
    assert.equal(word, 'Unmerge');
    await trigger.click();
    const confirm = page.locator('.undo-ask').getByRole('button', { name: word, exact: true });
    await confirm.waitFor({ timeout: 5000 });
    const before = seen.records.length;
    await confirm.click();
    await page.waitForTimeout(1500);
    assert.ok(seen.undo, 'confirming must send records/undo');
    assert.equal(seen.undo.batch_id, BATCH);
    assert.ok(seen.records.length > before, 'the Work list must reload after the undo');
  } finally {
    await context.close();
  }
});
