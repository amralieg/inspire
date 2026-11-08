import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, NO_JOB, ROWS, SUMMARY, TABLE, appInfo, lister, openApp, resizeTo, serveDist, until } from './harness.mjs';

const NOW = Date.parse('2026-10-27T09:30:00Z');
const JOB_URL = 'https://ws.example.com/jobs/4242';
const LAST = { run_id: '101', trigger: 'scheduled', by: 'the schedule', started: '2026-10-27T07:25:00Z', ended: '2026-10-27T07:30:00Z', result: 'succeeded', message: '', url: `${JOB_URL}/runs/101` };
const IDLE = { ...NO_JOB, has_job: true, source: 'job', last_success: LAST, last_run: LAST, data_through: '2026-10-26', cadence_days: 1, can_refresh: true, reason: '', run_url: LAST.url };
const RUN = { run_id: '9000', state: 'running', result: 'running', started: '2026-10-27T09:27:00Z', by: 'the schedule', url: `${JOB_URL}/runs/9000` };
const STAGED = { ...RUN, stage: 'Scoring the records', stage_index: 3, stage_total: 5, rows_done: 1200000, rows_total: 4000000, percent: 30, eta_s: 380 };
const DONE = { ...RUN, state: 'terminated', result: 'succeeded', ended: '2026-10-27T09:31:00Z', message: '' };

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

function freshRoutes(first, more = {}) {
  const state = { fresh: first, polls: {} };
  return {
    state,
    routes: {
      freshness: ({ json, url }) => {
        const id = url.searchParams.get('page');
        state.polls[id] = (state.polls[id] || 0) + 1;
        return json(200, typeof state.fresh === 'function' ? state.fresh(id) : state.fresh);
      },
      ...more,
    },
  };
}

const bar = (page, scope = '.ph .fresh') => page.locator(`${scope} [role="progressbar"]`).first().evaluate((el) => ({
  now: el.getAttribute('aria-valuenow'), width: el.querySelector('i').style.width, open: el.classList.contains('is-open'),
}));

test('a running refresh says its step, rows and time left, draws a bar as wide as the percent the server sent, and keeps the data it shows with its date', async () => {
  const { routes } = freshRoutes({ ...IDLE, active: STAGED, can_refresh: false, reason: 'busy', typical_s: 300 });
  const { page, seen, context } = await openApp(browser, served.base, appInfo(), { routes, clock: NOW });
  await page.locator('.ph .fresh-d [data-progress]').waitFor();
  assert.equal(await page.locator('.ph .fresh-d [data-progress]').innerText(), 'Step 3 of 5: Scoring the records · 1,200,000 of 4,000,000 rows · about 6 min left');
  assert.deepEqual(await bar(page), { now: '30', width: '30%', open: false });
  assert.equal(await page.locator('.fresh-asof').innerText(), 'Until it finishes you see the data of the update on Oct 27, 07:30 AM UTC');
  assert.ok(await page.locator('.kpi-v').first().isVisible(), 'the numbers stay on screen while it runs');
  const room = await page.evaluate(() => {
    const h1 = document.querySelector('.ph h1');
    return { lines: Math.round(h1.getBoundingClientRect().height / parseFloat(getComputedStyle(h1).lineHeight)), clipped: h1.scrollWidth > h1.clientWidth + 1,
      busy: Math.round(document.querySelector('.fresh-busy').getBoundingClientRect().width) };
  });
  assert.deepEqual({ ...room, busy: room.busy <= 460 }, { lines: 1, clipped: false, busy: true }, `the progress keeps to its corner and leaves the title its line: ${JSON.stringify(room)}`);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('with no percent the bar moves with no width and no number, and with no step from the server the running-for line stays', async () => {
  for (const [active, text] of [
    [{ ...STAGED, percent: null, eta_s: null }, 'Step 3 of 5: Scoring the records · 1,200,000 of 4,000,000 rows · running for 3 min, usually about 5 min'],
    [RUN, 'running for 3 min, usually about 5 min'],
  ]) {
    const { routes } = freshRoutes({ ...IDLE, active, can_refresh: false, reason: 'busy', typical_s: 300 });
    const { page, seen, context } = await openApp(browser, served.base, appInfo(), { routes, clock: NOW });
    await page.locator('.ph .fresh-d [data-progress]').waitFor();
    assert.equal(await page.locator('.ph .fresh-d [data-progress]').innerText(), text);
    assert.deepEqual(await bar(page), { now: null, width: '', open: true }, 'no percent from the server means no width and no value');
    assert.doesNotMatch(`${await page.locator('.ph .fresh').innerText()} ${await page.locator('.ph .fresh-d').innerText()}`, /%|\d+ min left/, 'no percent and no time left the server did not send');
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('when the run finishes a toast says Refreshed, and See what changed turns on Changed since the last run on the list', async () => {
  const rows = ROWS.map((r) => ({ ...r }));
  const { state, routes } = freshRoutes({ ...IDLE, active: STAGED, can_refresh: false, reason: 'busy' }, {
    records: lister(rows, { actions: true, changes: true, summary: SUMMARY }),
  });
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes, clock: NOW, hash: '#/n01_u05/work' });
  await page.locator('.fresh-busy').waitFor();
  await page.waitForFunction(() => document.querySelector('.card--table tbody tr'));
  state.fresh = { ...IDLE, last_success: DONE, last_run: DONE };
  await page.clock.fastForward(10000);
  await page.waitForFunction(() => document.querySelector('.toast.is-on .toast-t')?.textContent === 'Refreshed');
  assert.deepEqual(await page.locator('.toast-a button').allInnerTexts(), ['See what changed']);
  const asked = seen.records.length;
  await page.locator('.toast-a').getByRole('button', { name: 'See what changed' }).click();
  await until(() => seen.records.slice(asked).some((b) => b.changed === true));
  assert.equal(await page.getByRole('button', { name: 'Changed since the last run' }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('while a refresh runs, its full progress line never squeezes the page title: at 1440, 1024 and 390 the title keeps at least 300px and the top row sits above it, never over it', async () => {
  const { routes } = freshRoutes({ ...IDLE, active: STAGED, can_refresh: false, reason: 'busy', typical_s: 300 });
  for (const width of [1440, 1024, 390]) {
    const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 2, TABLE), { routes, clock: NOW, width, hash: '#/n01_u05' });
    await page.locator('.ph .fresh-d [data-progress]').waitFor();
    await resizeTo(page, width);
    const box = await page.evaluate(() => {
      const r = (el) => el.getBoundingClientRect();
      const h1 = document.querySelector('.ph h1');
      const top = r(document.querySelector('.top'));
      return { h1: Math.round(r(h1).width), fits: h1.scrollWidth <= h1.clientWidth + 1, apart: top.bottom <= r(h1).top + 1 };
    });
    assert.ok(box.h1 >= 300, `at ${width} the title is ${box.h1}px wide`);
    assert.ok(box.fits, `at ${width} the title text runs out of its box`);
    assert.ok(box.apart, `at ${width} the actions cover the title`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});
