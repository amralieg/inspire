import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, NO_JOB, ROWS, SILENT, SUMMARY, TABLE, appInfo, lister, openApp, resizeTo, serveDist, until } from './harness.mjs';

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
  await page.locator('.fresh-busy [data-progress]').waitFor();
  assert.equal(await page.locator('.fresh-busy [data-progress]').innerText(), 'Step 3 of 5: Scoring the records · 1,200,000 of 4,000,000 rows · about 6 min left');
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
    await page.locator('.fresh-busy [data-progress]').waitFor();
    assert.equal(await page.locator('.fresh-busy [data-progress]').innerText(), text);
    assert.deepEqual(await bar(page), { now: null, width: '', open: true }, 'no percent from the server means no width and no value');
    assert.doesNotMatch(await page.locator('.ph .fresh').innerText(), /%|\d+ min left/, 'no percent and no time left the server did not send');
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('when the run finishes a toast says Refreshed, and See what changed turns on Changed since the last run on the list', async () => {
  const rows = ROWS.map((r) => ({ ...r }));
  const { state, routes } = freshRoutes({ ...IDLE, active: STAGED, can_refresh: false, reason: 'busy' }, {
    records: lister(rows, { actions: true, changes: true, summary: SUMMARY }),
  });
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes, clock: NOW });
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

const hubEntry = (active) => ({
  visible: true, tracked: true, money: false, actions: false, categories: [], served: 'delta', items: [], total: 0, truncated: false, weeks: [], window_note: '',
  done: { fixed: 0, fixed_q: 0, dismissed: 0, dismissed_q: 0, saved_n: 0, saved: 0, saved_q_n: 0, saved_q: 0, first_fixed: null, first_saved: null },
  runs: { updated: '2026-10-27T06:00:00Z', as_of: '2026-10-27', cadence_days: 1, next: '2026-10-28', stale: false, count: 3, failed: false, active },
});
const hubRuns = (actives) => ({ json }) => json(200, { today: '2026-10-27', quarter: '2026-10-01', since: '2026-08-03', errors: {},
  window: { window: 'all', limit: null, today: '2026-10-27' }, pages: Object.fromEntries(['n01_u05', 'n02_u01', 'n02_u02'].map((id) => [id, hubEntry(actives[id] || null)])) });

async function openOverview(routes) {
  const opened = await openApp(browser, served.base, appInfo({ layout: 'sidebar' }, 3), { routes, clock: NOW });
  await opened.page.goto('about:blank');
  return opened;
}

test('the Overview lists each running refresh from the overview reply, asks only the use cases that run for news, and says when one finishes with a link to what changed', async () => {
  const { state, routes } = freshRoutes((id) => (id === 'n02_u01' ? { ...IDLE, active: STAGED } : IDLE), { overview: hubRuns({ n02_u01: STAGED }) });
  const { page, seen, context } = await openOverview(routes);
  state.polls = {};
  await page.goto(`${served.base}#/overview`);
  const running = page.getByRole('region', { name: 'Running now' });
  await running.locator('[data-running]').first().waitFor();
  assert.deepEqual(state.polls, {}, 'the overview reply already says what runs, so no use case is asked for its freshness');
  assert.deepEqual(await running.locator('[data-running] b').allInnerTexts(), ['Second desk 1']);
  assert.equal(await running.locator('[data-running="n02_u01"] [data-progress]').innerText(),
    'Step 3 of 5: Scoring the records · 1,200,000 of 4,000,000 rows · about 6 min left');
  assert.deepEqual(await bar(page, '[data-running="n02_u01"]'), { now: '30', width: '30%', open: false });
  state.fresh = (id) => (id === 'n02_u01' ? { ...IDLE, last_success: DONE, last_run: DONE } : IDLE);
  await page.clock.fastForward(10000);
  await page.waitForFunction(() => document.querySelector('.toast.is-on .toast-t')?.textContent === 'Second desk 1: Refreshed');
  assert.deepEqual(Object.keys(state.polls), ['n02_u01'], 'only the use case that runs is asked for news');
  await running.waitFor({ state: 'detached' });
  await page.locator('.toast-a').getByRole('button', { name: 'See what changed' }).click();
  await page.waitForFunction(() => document.querySelector('.ph h1')?.textContent === 'Second desk 1');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Overview shows a run the server says has gone quiet with the server note and no bar', async () => {
  const { state, routes } = freshRoutes(() => ({ ...IDLE, active: SILENT }), { overview: hubRuns({ n02_u02: SILENT }) });
  const { page, seen, context } = await openOverview(routes);
  state.polls = {};
  await page.goto(`${served.base}#/overview`);
  const item = page.getByRole('region', { name: 'Running now' }).locator('[data-running="n02_u02"]');
  await item.waitFor();
  assert.equal(await item.locator('[data-progress]').innerText(), SILENT.message);
  assert.equal(await item.locator('[role="progressbar"]').count(), 0);
  assert.deepEqual(state.polls, {});
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('while a refresh runs, its full progress line never squeezes the page title: at 1440, 1024 and 390 the title keeps at least 300px and the actions sit beside it or under it, never over it', async () => {
  const { routes } = freshRoutes({ ...IDLE, active: STAGED, can_refresh: false, reason: 'busy', typical_s: 300 });
  for (const width of [1440, 1024, 390]) {
    const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 2, TABLE), { routes, clock: NOW, width });
    await page.goto('about:blank');
    await page.goto(`${served.base}#/n01_u05`);
    await page.locator('.ph .fresh-busy [data-progress]').waitFor();
    await resizeTo(page, width);
    const box = await page.evaluate(() => {
      const r = (el) => el.getBoundingClientRect();
      const title = r(document.querySelector('.ph .pg-h > div:first-child'));
      const h1 = document.querySelector('.ph h1');
      const acts = r(document.querySelector('.ph .hdr-act'));
      return { h1: Math.round(r(h1).width), fits: h1.scrollWidth <= h1.clientWidth + 1, apart: title.right <= acts.left + 1 || acts.top >= title.bottom - 1 };
    });
    assert.ok(box.h1 >= 300, `at ${width} the title is ${box.h1}px wide`);
    assert.ok(box.fits, `at ${width} the title text runs out of its box`);
    assert.ok(box.apart, `at ${width} the actions cover the title`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});
