import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { FILTERS, NO_MY_WORK, TABLE, appInfo, openApp, serveDist } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const overviews = (seen) => (seen.hub || []).filter((body) => !body.page);

function counting() {
  return {
    overview: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      (seen.hub ||= []).push(body);
      return json(200, { today: '2026-10-24', quarter: '2026-10-01', since: '2026-08-03', errors: {}, pages: {} });
    },
    my_work: ({ route, json, seen }) => {
      (seen.work ||= []).push(route.request().postDataJSON());
      return json(200, NO_MY_WORK);
    },
  };
}

test('the pager sends the cursor of the row it pages from, and the first page reads from the top', async () => {
  const keys = Array.from({ length: 60 }, (_, i) => `r${String(i).padStart(2, '0')}`);
  const routes = {
    records: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      seen.records.push(body);
      const offset = body.offset || 0;
      const rows = keys.slice(offset, offset + body.limit).map((k, i) => ({ record_key: k, entity_id: k, entity_label: `Item ${k}`, rank: offset + i + 1,
        priority_tier: 'Review' }));
      const cursors = { next: offset + body.limit < keys.length ? { dir: 'next', value: offset + body.limit, key: rows.at(-1).record_key } : null,
        prev: offset > 0 ? { dir: 'prev', value: offset + 1, key: rows[0].record_key } : null };
      return json(200, { rows, total: keys.length, offset, limit: body.limit, cursors, actions: false, changes: false, summary: null, errors: {} });
    },
  };
  const { page, seen, context } = await openApp(browser, served.base, appInfo({}, 1, TABLE), { routes, hash: '#/n01_u05/work' });
  await page.locator('.pager-n').waitFor();
  const last = () => seen.records.at(-1);
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.waitForFunction(() => document.querySelector('.pager-n')?.textContent.startsWith('Showing 26'));
  assert.deepEqual(last().cursor, { dir: 'next', value: 25, key: 'r24' });
  assert.equal(last().offset, 25);
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.waitForFunction(() => document.querySelector('.pager-n')?.textContent.startsWith('Showing 51'));
  assert.deepEqual(last().cursor, { dir: 'next', value: 50, key: 'r49' });
  await page.getByRole('button', { name: 'Previous page' }).click();
  await page.waitForFunction(() => document.querySelector('.pager-n')?.textContent.startsWith('Showing 26'));
  assert.deepEqual(last().cursor, { dir: 'prev', value: 51, key: 'r50' });
  await page.getByRole('button', { name: 'Previous page' }).click();
  await page.waitForFunction(() => document.querySelector('.pager-n')?.textContent.startsWith('Showing 1 '));
  assert.equal(last().offset, 0);
  assert.equal(last().cursor, undefined, 'the first page needs no cursor');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a list counted only up to the cap says more than the cap and still pages past it', async () => {
  const routes = {
    records: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      seen.records.push(body);
      const offset = body.offset || 0;
      const rows = Array.from({ length: body.limit }, (_, i) => ({ record_key: `r${offset + i}`, entity_id: `r${offset + i}`,
        entity_label: `Item ${offset + i}`, rank: offset + i + 1, priority_tier: 'Review' }));
      return json(200, { rows, total: 25, total_more: true, offset, limit: body.limit, cursors: { next: null, prev: null }, actions: false,
        changes: false, summary: null, errors: {} });
    },
  };
  const { page, seen, context } = await openApp(browser, served.base, appInfo({}, 1, TABLE), { routes, hash: '#/n01_u05/work' });
  await page.locator('.pager-n').waitFor();
  assert.equal(await page.locator('.pager-n').textContent(), 'Showing 1 to 25 of more than 25');
  await page.getByText(/^More than 25 records/).waitFor();
  await page.getByRole('button', { name: 'Next page' }).click();
  await page.waitForFunction(() => document.querySelector('.pager-n')?.textContent.startsWith('Showing 26'));
  assert.equal(seen.records.at(-1).offset, 25);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the decision list and the page start with the stored default dates while the filter bar still loads, and do not load again when it lands', async () => {
  const marks = {};
  const routes = {
    defaults: ({ json }) => json(200, { page: 'n01_u05', range: { run_date: { preset: '12m', from: '2025-11-01', to: '2026-10-15' } }, errors: {} }),
    filters: async ({ json }) => { await new Promise((r) => setTimeout(r, 1500)); marks.filters = Date.now(); return json(200, FILTERS); },
    records: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      seen.records.push({ ...body, at: Date.now() });
      return json(200, { rows: [], total: 0, offset: 0, limit: body.limit, cursors: { next: null, prev: null }, actions: false, changes: false, summary: null, errors: {} });
    },
  };
  const { page, seen, context } = await openApp(browser, served.base, appInfo({}, 1, TABLE), { routes, hash: '#/n01_u05/work' });
  await page.waitForFunction(() => !document.querySelector('.fbar .skel'));
  await page.waitForTimeout(500);
  assert.ok(seen.records.length >= 1 && seen.records[0].at < marks.filters, 'the list asked before the filter bar answered');
  assert.deepEqual(seen.records[0].filters, { run_date: { from: '2025-11-01', to: '2026-10-15' } });
  assert.equal(seen.records.length, 1, 'the filter bar starts on the same dates, so nothing loads twice');
  await page.locator('[data-rail="dashboard"]').click();
  await page.waitForTimeout(500);
  assert.deepEqual(seen.pages[0].filters, { run_date: { from: '2025-11-01', to: '2026-10-15' } });
  assert.equal(seen.pages.length, 1);
  assert.deepEqual(seen.errors.filter((e) => !/404/.test(e)), []);
  await context.close();
});

test('opening a use case page never asks for the overview of every use case or for Performance, and Performance asks for its own use case once it opens', async () => {
  const single = await openApp(browser, served.base, appInfo({}, 1, TABLE), { routes: counting() });
  await single.page.locator('.kpi-v').first().waitFor();
  await single.page.waitForTimeout(500);
  assert.deepEqual(overviews(single.seen), [], 'a one use case App never reads every use case');
  assert.ok((single.seen.hub || []).every((body) => body.page === 'n01_u05'), 'the page reads its own things to fix');
  await single.context.close();
  const hub = await openApp(browser, served.base, appInfo({ business: 'Contoso Retail' }, 2, TABLE), { routes: counting() });
  await hub.page.locator('.kpi-v').first().waitFor();
  await hub.page.waitForTimeout(500);
  assert.deepEqual([overviews(hub.seen), hub.seen.work || []], [[], []], 'a use case dashboard never reads every use case, nor Performance');
  await hub.page.locator('[data-rail="performance"]').click();
  await hub.page.locator('[data-performance]').waitFor();
  await hub.page.waitForTimeout(300);
  assert.deepEqual(overviews(hub.seen), [], 'Performance never reads every use case');
  assert.deepEqual(hub.seen.work.map((b) => b.page), ['n01_u05'], 'Performance reads its own use case once someone opens it');
  assert.deepEqual(hub.seen.errors, []);
  await hub.context.close();
});
