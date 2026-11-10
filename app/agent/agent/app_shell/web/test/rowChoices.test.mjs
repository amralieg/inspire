import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, ROWS, SUMMARY, TABLE, actBody, appInfo, lister, openApp, serveDist, tracked } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const CLOCK = new Date('2026-10-27T09:30:00Z');
const AS_OF = String((CLOCK.getTime() - 5000) * 1000);

function listRoutes(writes) {
  return tracked({
    records: lister(ROWS, { actions: true, changes: true, summary: SUMMARY, as_of_us: AS_OF }),
    'records/act': ({ route, json }) => {
      const body = actBody(route);
      writes.push(body);
      return json(200, { written: body.record_keys || [], conflicts: [], batch_id: `b${'0'.repeat(31)}1` });
    },
  }).routes;
}

async function openList(routes, page = TABLE) {
  const opened = await openApp(browser, served.base, appInfo(DECIDE, 1, page), { routes, clock: CLOCK, timezone: 'Asia/Dubai', hash: '#/n01_u05/work' });
  await opened.page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length > 0 && document.querySelector('.list-tools'));
  return opened;
}

test('every row of a decision list carries its own Mark done and Could not fix buttons, and Not an issue opens the record to give the reason', async () => {
  const writes = [];
  const { page, seen, context } = await openList(listRoutes(writes));
  const firstRow = page.locator('.card--table tbody tr').first();
  assert.deepEqual(await firstRow.locator('[data-row-choice]').evaluateAll((b) => b.map((x) => x.dataset.rowChoice)), ['done', 'not-an-issue', 'could-not-fix'],
    'the page\'s closing choices, one button each, on the row');
  await firstRow.locator('[data-row-choice="done"]').click();
  await page.waitForTimeout(300);
  assert.equal(writes.length, 1, 'one click, one write');
  assert.deepEqual(writes[0].values, { action_status: 'Done' });
  assert.equal(writes[0].record_keys.length, 1);
  await firstRow.locator('[data-row-choice="not-an-issue"]').click();
  await page.locator('dialog.drawer').waitFor();
  assert.equal(writes.length, 1, 'Not an issue needs a reason, so it opens the record and writes nothing yet');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a list of a page that keeps no decisions shows no per-row choice buttons', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo({}, 1, TABLE), { routes: {}, clock: CLOCK, timezone: 'Asia/Dubai', hash: '#/n01_u05/work' });
  await page.locator('.card--table tbody tr').first().waitFor();
  assert.equal(await page.locator('[data-row-choice]').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
