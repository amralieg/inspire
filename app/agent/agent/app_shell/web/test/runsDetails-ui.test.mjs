import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, openApp, serveDist } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const CARD = 'This App is waiting for access to this data. Ask your data owner to grant it.';
const RAW = 'PERMISSION_DENIED: User does not have SELECT on loss_desk_out_summary';
const run = { run_id: 'u3', job_run_id: null, url: '', started: '2026-10-25T06:04:00.000Z', ended: '2026-10-25T06:05:00.000Z', duration_s: 60, status: 'done',
  trigger: 'schedule', by: '', segments: [], tables: null, records: 10, to_fix: 10, could_save: null, currency: '', summary: '', nothing_to_act: '', error: '' };

test('a refused summary read on Runs keeps the plain sentence inline, the runs listed, and the raw refusal under Details', async () => {
  const routes = { runs: ({ json }) => json(200, { runs: [run], total: 1, offset: 0, limit: 20, job: null, errors: { summary: CARD }, detail: RAW, can_run: false }) };
  const { page, context, seen } = await openApp(browser, served.base, appInfo({}, 1, {}), { routes, clock: Date.parse('2026-10-27T09:30:00Z') });
  await page.locator('[data-rail="runs"]').click();
  await page.getByText(CARD).waitFor();
  assert.equal(await page.locator('[data-technical-details]').count(), 1, 'one Details block for the raw refusal');
  assert.equal(await page.locator('[data-technical-details] pre').textContent(), RAW, 'the raw refusal is available under Details');
  await page.locator('[data-technical-details] summary').click();
  assert.equal(await page.locator('[data-technical-details] pre').isVisible(), true);
  assert.equal(await page.locator('.runs-tbl tbody tr').count(), 1, 'the runs the job and table recorded stay listed');
  assert.deepEqual(seen.errors, []);
  await context.close();
});
