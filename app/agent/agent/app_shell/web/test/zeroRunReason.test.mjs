// REQ-297 (P87 round 4): a zero-result run says what it did on Dashboard, KPIs and Work, in plain words, and never reads
// 'Not recorded' or 'No rows match these filters'. The page data is the zero-result shape the server sends (kpi_missing with a
// run summary of 583 records checked and nothing to act on, and a flat chart set with zero_state).
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, DECIDE, FIELDS, lister, openApp, pageData, serveDist } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const SAYS = 'This run checked 583 records and found nothing to act on';
const REASON = { en: SAYS, fr: 'Cette exécution a contrôlé 583 enregistrements et n’a rien trouvé à traiter' };
const BANNED = /Not recorded|No rows match/;

function zeroPage() {
  const data = pageData({});
  const charts = Object.fromEntries(Object.entries(data.charts).map(([id, c]) => [id, { ...c, rows: c.rows.map((r) => ({ ...r, y0: 0 })) }]));
  const kpis = Object.fromEntries(Object.keys(data.kpis).map((id) => [id, { now: 0, before: null, empty: REASON }]));
  return { ...data, charts, kpis, zero_state: { charts: Object.keys(charts).sort(), rows_checked: 583 } };
}

const EMPTY_RECORDS = lister([], { actions: true, changes: true, summary: null }, 0);
const ROUTES = (pageBody) => ({
  page: ({ json }) => json(200, pageBody),
  records: EMPTY_RECORDS,
  'records/fields': ({ json }) => json(200, { fields: FIELDS, key_field: 'entity_id', actions: true }),
});

async function visibleText(page) {
  await page.waitForFunction(() => !document.querySelector('[aria-busy="true"]'), null, { timeout: 15000 });
  return page.locator('main').innerText();
}

test('the Dashboard KPIs and zero panel say the run checked 583 records, and never Not recorded or No rows match', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo({ ...DECIDE }), { routes: ROUTES(zeroPage()), hash: '#/n01_u05/dashboard' });
  await page.waitForSelector('[data-zero-state]', { timeout: 15000 });
  const text = await visibleText(page);
  assert.ok(text.includes(SAYS), 'the zero panel names what the run did');
  assert.doesNotMatch(text, BANNED, 'no banned blank wording on the Dashboard');
  const reasons = await page.locator('.kpi-s[data-empty-reason]').allInnerTexts();
  assert.ok(reasons.length >= 1, 'each KPI with no value shows the reason');
  for (const r of reasons) assert.equal(r, SAYS);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Work tab says the run checked 583 records, and never Not recorded or No rows match', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo({ ...DECIDE }), { routes: ROUTES(zeroPage()), hash: '#/n01_u05/work' });
  await page.waitForFunction(() => document.querySelector('[data-page-section="work"]') !== null, null, { timeout: 15000 });
  const text = await visibleText(page);
  assert.ok(text.includes(SAYS), 'the Work tab names what the run did');
  assert.doesNotMatch(text, BANNED, 'no banned blank wording on Work');
  assert.deepEqual(seen.errors, []);
  await context.close();
});
