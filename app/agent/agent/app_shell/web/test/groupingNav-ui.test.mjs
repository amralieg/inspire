import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { FILTERS, appInfo, goRail, openApp, serveDist } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const PROMISED = { value: 'Fewer late returns', benefits: ['Returns decided the same day'] };
const GROUPED = { mode: 'columns', group_by: [{ column: 'channel', label: 'Channel' }, { column: 'return_reason', label: 'Return reason' }] };
const TOP = FILTERS.filters.slice(0, 1);
const GROUP_FILTERS = [
  { column: 'channel', type: 'multi_select', label: 'Channel', options: ['Online', 'Stores'], grouping: true },
  { column: 'return_reason', type: 'multi_select', label: 'Return reason', options: ['Damaged', 'Late'], grouping: true },
];
const meta = (grouping, list = GROUP_FILTERS) => ({ filters: TOP, columns: { list, tables: {} }, grouping });
const rail = (page) => page.locator('[data-rail]').evaluateAll((items) => items.map((i) => i.dataset.rail));
const topLabels = (page) => page.locator('.fbar .fld > span').allTextContents();

test('a page built with a grouping shows the grouping chip and its columns as top filters with the Work list labels', async () => {
  const info = appInfo({}, 1, {});
  const { page, context } = await openApp(browser, served.base, info, { routes: { filters: ({ json }) => json(200, meta(GROUPED)) } });
  await page.locator('[data-grouping]').waitFor();
  assert.equal((await page.locator('[data-grouping]').textContent()).trim(), 'Grouped by Channel, Return reason');
  const labels = (await topLabels(page)).map((t) => t.trim());
  assert.ok(labels.includes('Channel') && labels.includes('Return reason'), `top filters are ${labels.join(', ')}`);
  await context.close();
});

test('a page built with no grouping shows no grouping chip and no grouping filter', async () => {
  const info = appInfo({}, 1, {});
  const { page, context } = await openApp(browser, served.base, info, { routes: { filters: ({ json }) => json(200, meta({}, [])) } });
  await page.locator('.fbar').waitFor();
  assert.equal(await page.locator('[data-grouping]').count(), 0);
  const labels = (await topLabels(page)).map((t) => t.trim());
  assert.ok(!labels.includes('Channel') && !labels.includes('Return reason'), `top filters are ${labels.join(', ')}`);
  await context.close();
});

test('an owner sees Impact, Feedback and Reported issues in the nav, and each opens its screen', async () => {
  const info = appInfo({}, 1, { promised: PROMISED });
  info.pages[0].is_owner = true;
  const reported = { items: [{ feedback_id: 'f1', text: 'Totals look wrong', section: 'work', reported_by: 'sam.roe', reported_at: '2026-11-10', status: 'new' }],
    everyone: true, missing: false, limit: 2000 };
  const { page, context } = await openApp(browser, served.base, info, { routes: { feedback: ({ json }) => json(200, reported) } });
  await page.locator('[data-rail]').first().waitFor();
  const items = await rail(page);
  assert.ok(items.includes('impact') && items.includes('feedback') && items.includes('reports'), `rail is ${items.join(', ')}`);
  await goRail(page, 'feedback');
  await page.locator('[data-feedback-screen] [data-feedback-form]').waitFor();
  await goRail(page, 'reports');
  await page.locator('[data-reported-issues] [data-feedback-item="f1"]').waitFor();
  await goRail(page, 'impact');
  await page.locator('[data-section-title]', { hasText: 'Impact' }).waitFor();
  await context.close();
});

test('a person who is not an owner sees Feedback but not Reported issues, and a page with no impact data has no Impact entry', async () => {
  const info = appInfo({}, 1, {});
  info.pages[0].is_owner = false;
  const { page, context } = await openApp(browser, served.base, info);
  await page.locator('[data-rail]').first().waitFor();
  const items = await rail(page);
  assert.ok(items.includes('feedback'), `rail is ${items.join(', ')}`);
  assert.ok(!items.includes('reports'), 'Reported issues stays with the owners');
  assert.ok(!items.includes('impact'), 'no results table and no promised impact, no Impact entry');
  await context.close();
});

test('Impact shows whenever the page has impact data, even with no promised text', async () => {
  const info = appInfo({}, 1, {});
  info.pages[0].history = true;
  const { page, context } = await openApp(browser, served.base, info);
  await page.locator('[data-rail]').first().waitFor();
  assert.ok((await rail(page)).includes('impact'), 'a page that keeps results has impact data');
  await goRail(page, 'impact');
  await page.locator('[data-section-title]', { hasText: 'Impact' }).waitFor();
  await context.close();
});

test('Report an issue opens the form on every page type, including a page with no results table', async () => {
  const info = appInfo({}, 1, { promised: PROMISED });
  const { page, context } = await openApp(browser, served.base, info);
  await page.locator('[data-feedback-open]').click();
  await page.locator('[data-feedback-form]').waitFor();
  await page.keyboard.press('Escape');
  await goRail(page, 'impact');
  await page.locator('[data-section-title]', { hasText: 'Impact' }).waitFor();
  await page.locator('[data-feedback-open]').click();
  await page.locator('[data-feedback-form]').first().waitFor();
  await context.close();
});
