import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, PERSON, ROWS, SUMMARY, TABLE, appInfo, goRail, lister, openApp, serveDist, tracked } from './harness.mjs';
import { dropCopies, fillWithCopies, wheelScrolls } from '../../../../../frontend/test/ui/wheelScroll.mjs';

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

const MANY = Array.from({ length: 6 }, (_, k) => ROWS.map((r) => ({ ...r, record_key: `${r.record_key}-${k}`, _inspire_key: `${r._inspire_key}-${k}`, entity_id: `${r.entity_id}-${k}` }))).flat();
const copies = (region, item, n) => ({ fill: () => fillWithCopies(region, item, n), unfill: () => dropCopies(region) });
const html = (page) => page.locator('html');
const real = (errors) => errors.filter((e) => !/Failed to load resource/.test(e));

const run = (i) => ({ run_id: `u${i}`, job_run_id: String(400 + i), url: '', started: new Date(Date.UTC(2026, 9, 27 - i, 6)).toISOString(), ended: null, duration_s: 180,
  status: 'done', trigger: 'schedule', by: 'the schedule', segments: null, tables: null, records: 40, to_fix: 5, could_save: null, currency: '',
  summary: `Run ${i} scored the records again.`, nothing_to_act: '', error: '' });
const RUNS = { runs: Array.from({ length: 20 }, (_, i) => run(i)), total: 20, offset: 0, limit: 20, job: { id: '4242', url: '', error: '' }, errors: {} };

async function open(hash, routes = {}) {
  const info = appInfo({ ...DECIDE, use_case_owners: { n01_u05: [PERSON] } }, 2, TABLE);
  const all = tracked({ records: lister(MANY, { actions: true, changes: true, summary: SUMMARY }), runs: ({ json }) => json(200, RUNS), ...routes }).routes;
  return openApp(browser, served.base, info, { width: 1280, height: 800, routes: all, hash, ready: '[data-page-section], [data-performance]' });
}

test('the mouse wheel scrolls the Work list, the record drawer, and the side rail to their last item at 1280x800 and 1024x700', async () => {
  const { page, seen, context } = await open('#/n01_u05/work');
  const rows = page.locator('.card--table tbody tr');
  await rows.nth(20).waitFor();
  await wheelScrolls(page, html(page), () => rows.last(), { name: 'Work list', over: () => page.locator('.card--table') });

  await page.setViewportSize({ width: 1280, height: 800 });
  await page.locator('.cell-t').first().click();
  const drawer = page.locator('dialog.drawer[open] .panel-b');
  await drawer.waitFor();
  await wheelScrolls(page, drawer, () => drawer.locator('[data-wheel-copy]').last(), { name: 'record drawer', ...copies(drawer, ':scope > :first-child', 8) });
  await page.keyboard.press('Escape');
  await page.locator('dialog.drawer[open]').waitFor({ state: 'detached' }).catch(() => null);

  await page.setViewportSize({ width: 1280, height: 800 });
  const side = page.locator('nav.side, .side').first();
  await wheelScrolls(page, side, () => side.locator('[data-wheel-copy]').last(), { name: 'side rail', ...copies(side, '[data-rail]', 12) });

  assert.deepEqual(real(seen.errors), []);
  await context.close();
});

test('the mouse wheel scrolls the Performance, Runs and Settings sections to their end at 1280x800 and 1024x700', async () => {
  const { page, seen, context } = await open('#/n01_u05/performance', {});
  const perf = page.locator('[data-performance]');
  await perf.locator('.imp-page').waitFor({ timeout: 15000 });
  await wheelScrolls(page, html(page), () => perf.locator('[data-wheel-copy]').last(), { name: 'Performance', over: () => perf, ...copies(perf, ':scope > *', 3) });

  await goRail(page, 'runs');
  const runs = page.locator('.runs .runs-tbl');
  await runs.waitFor();
  await wheelScrolls(page, html(page), () => runs.locator('tbody tr').last(), { name: 'Runs timeline', over: () => runs });

  await goRail(page, 'settings');
  const settings = page.locator('[data-settings]');
  await settings.waitFor();
  await wheelScrolls(page, html(page), () => settings.locator('[data-wheel-copy]').last(), { name: 'Settings', over: () => settings, ...copies(settings, ':scope > [data-group]', 6) });
  assert.deepEqual(real(seen.errors), []);
  await context.close();
});
