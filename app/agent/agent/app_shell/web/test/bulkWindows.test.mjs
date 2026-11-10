import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, PERSON, ROWS, SUMMARY, TABLE, actBody, appInfo, lister, openApp, prefsFirst, serveDist, tracked, until } from './harness.mjs';
import { OPEN_STATUSES } from '../src/records.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const CLOCK = new Date('2026-10-27T09:30:00Z');
const AS_OF = String((CLOCK.getTime() - 5000) * 1000);
const MY = 'inspire-app-my';
const COUNTS = { open: 2, all: 5, mine: 1, choices: {} };

function routesFor(writes) {
  return tracked({
    records: lister(ROWS, { actions: true, changes: true, summary: SUMMARY, as_of_us: AS_OF, status_counts: COUNTS }),
    'records/act': ({ route, json }) => {
      const body = actBody(route);
      writes.push(body);
      return json(200, { written: body.record_keys || [], conflicts: [], batch_id: `b${'0'.repeat(31)}2` });
    },
  }).routes;
}

async function openEverything(writes) {
  const opened = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: routesFor(writes), clock: CLOCK, timezone: 'Asia/Dubai',
    hash: '#/n01_u05/work', watch: prefsFirst(MY, PERSON, { window: 'everything' }) });
  await opened.page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length > 0 && document.querySelector('.list-tools'));
  return opened;
}

test('Act on all the open records is visible in the Everything window too, and says how many open records it covers', async () => {
  const writes = [];
  const { page, seen, context } = await openEverything(writes);
  const act = page.locator('[data-act-all]');
  await act.waitFor();
  assert.equal((await act.innerText()).trim(), 'Act on all 2 matching');
  assert.equal(seen.errors?.length ?? 0, 0);
  await context.close();
});

test('Mark all as done confirms the open count, says the closed records stay, and writes only open records', async () => {
  const writes = [];
  const { page, context } = await openEverything(writes);
  await page.locator('[data-act-all]').click();
  await page.getByRole('button', { name: 'Mark all as done…' }).click();
  await page.getByText(/closed records? stays? as /).waitFor();
  assert.match(await page.locator('[data-closed-note]').innerText(), /^\d+ closed records? stays? as/);
  await page.getByRole('button', { name: 'Mark 2 open records as done?' }).click();
  await until(() => writes.length === 1);
  assert.deepEqual(writes[0].match.view.column_filters, { action_status: OPEN_STATUSES }, 'the bulk write names open statuses only');
  assert.deepEqual(writes[0].values, { action_status: 'Done' });
  await context.close();
});

test('with My actions on, the same control reads Clear my queue and covers only the open records of the person', async () => {
  const writes = [];
  const { page, context } = await openEverything(writes);
  await page.getByRole('button', { name: 'My actions' }).click();
  const clear = page.locator('[data-act-all]');
  await clear.waitFor();
  assert.match((await clear.innerText()).trim(), /^Clear my queue: \d+ open$/);
  await clear.click();
  await page.getByRole('button', { name: /Mark all as done…/ }).click();
  await page.getByRole('button', { name: /Mark \d+ open records as done\?/ }).click();
  await until(() => writes.length === 1);
  assert.equal(writes[0].match.view.mine, true, 'the queue is the person\'s own records');
  assert.deepEqual(writes[0].match.view.column_filters, { action_status: OPEN_STATUSES });
  await context.close();
});

test('Clear my queue is a visible button in the list header that confirms, writes only the open records assigned to the person, and offers Undo', async () => {
  const writes = [];
  const { page, context } = await openEverything(writes);
  const clear = page.locator('[data-clear-queue]');
  await clear.waitFor();
  assert.equal((await clear.innerText()).trim(), 'Clear my queue · 1');
  await clear.click();
  assert.equal(writes.length, 0, 'opening the button writes nothing');
  await page.locator('[data-clear-confirm]').click();
  await until(() => writes.length === 1);
  assert.equal(writes[0].match.view.mine, true, 'only the records assigned to the person');
  assert.deepEqual(writes[0].match.view.column_filters, { action_status: OPEN_STATUSES });
  assert.deepEqual(writes[0].values, { action_status: 'Done' });
  await page.locator('.toast button', { hasText: 'Undo' }).waitFor();
  await context.close();
});
