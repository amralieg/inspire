import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { appInfo, FILTERS, goRail, idle, LOST, NO_JOB, openApp, said, saidAll, serveDist, SILENT, steadyBox, TABLE, until } from './harness.mjs';
import {
  BUSY, RUN_STATES, activeState, agoText, bannerText, couldSaveRunFormula, coveredText, errorText, foundText, groupingText, lastRunNote, lastRunText, lastedText,
  progressText, runBars, runFlag, runState, runsPageText, spanText, stampText, toastTone, triggerText,
} from '../src/freshness.js';

const NOW = Date.parse('2026-10-27T09:30:00Z');
const JOB_URL = 'https://ws.example.com/jobs/4242';
const ME = ['pat.lee', 'example.com'].join('@');
const DANA = ['dana', 'example.com'].join('@');
const SAM = ['sam', 'example.com'].join('@');
const LAST = { run_id: '101', trigger: 'scheduled', by: 'the schedule', started: '2026-10-27T07:25:00Z', ended: '2026-10-27T07:30:00Z', result: 'succeeded', message: '', url: `${JOB_URL}/runs/101` };
const IDLE = { ...NO_JOB, has_job: true, source: 'job', last_success: LAST, last_run: LAST, data_through: '2026-10-26', cadence_days: 1, can_refresh: true, reason: '', run_url: LAST.url };
const ONLY_ADMIN = 'Only the owners of this use case can run it now';
const REFUSED = "The App cannot read this page's job, so it cannot refresh it: GET /api/2.2/jobs/runs/list answered HTTP 403: the App may not view this job";

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

const real = (errors) => errors.filter((e) => !/Failed to load resource/.test(e));

function jobRoutes(first, onRefresh) {
  const state = { fresh: first, posts: [], polls: 0 };
  const routes = {
    freshness: ({ json }) => { state.polls += 1; return json(200, state.fresh); },
    refresh: ({ route, json }) => { state.posts.push(route.request().postDataJSON()); return onRefresh(state, json); },
  };
  return { state, routes };
}

const open = (routes, options = {}, info = appInfo()) => openApp(browser, served.base, info, { clock: NOW, ...options, routes });
const banner = (page) => page.locator('.ph .fresh');
const detail = (page) => page.locator('.ph .fresh-d');
const throughs = async (page) => (`${await page.locator('.top').innerText()} ${await page.locator('.ph').innerText()}`.match(/data through/gi) || []).length;

test('the header says when the use case was last updated, from the newest successful run', () => {
  assert.equal(bannerText(IDLE, NOW), 'Updated Oct 27, 07:30 AM UTC · data through Oct 26, 2026');
  const asked = { ...IDLE, last_success: { ...LAST, by: 'Dana', ended: '2026-10-27T09:20:00Z' }, data_through: null };
  assert.equal(bannerText(asked, NOW), 'Updated Oct 27, 09:20 AM UTC');
  const failedLater = { ...IDLE, last_run: { run_id: '102', result: 'failed', started: '2026-10-27T08:00:00Z', ended: '2026-10-27T08:02:00Z' } };
  assert.equal(bannerText(failedLater, NOW, false), 'Updated Oct 27, 07:30 AM UTC', 'a failed run never counts as an update');
  const table = { ...NO_JOB, last_success: { run_id: 'u3', started: '2026-10-24T06:00:00Z', ended: null, trigger: null, by: null }, data_through: '2026-10-24' };
  assert.equal(bannerText(table, NOW), 'Updated Oct 24, 06:00 AM UTC · data through Oct 24, 2026');
  assert.equal(bannerText(NO_JOB, NOW), 'Not updated yet', 'every use case says whether it was updated');
  assert.equal(bannerText(null, NOW), '', 'nothing shows before the freshness call answers');
  assert.equal(bannerText({ ...NO_JOB, data_through: '2026-10-24' }, NOW, false), 'Not updated yet');
  assert.equal(bannerText({ ...NO_JOB, has_job: true }, NOW), 'Not updated yet');
  assert.deepEqual([stampText('2025-12-30T06:00:00Z', NOW), stampText('2026-10-04T06:00:00Z', NOW), stampText(null, NOW)],
    ['Dec 30, 2025, 06:00 AM UTC', 'Oct 4, 06:00 AM UTC', ''], 'the year shows only when it is not this year');
  assert.equal(agoText('2026-10-27T09:29:31Z', NOW), 'just now');
  assert.equal(agoText('2026-10-26T09:29:00Z', NOW), '1 day ago');
  assert.equal(agoText('2026-09-01T09:29:00Z', NOW), 'on Sep 1, 2026');
  assert.equal(agoText(null, NOW), '');
  assert.equal(BUSY, 'Refreshing all the data');
  assert.equal(progressText({ result: 'running', started: '2026-10-27T09:26:40Z' }, NOW), 'running for 3 min');
  assert.equal(progressText({ result: 'queued', started: '2026-10-27T09:29:40Z' }, NOW), 'waiting in the queue for under a minute');
  assert.equal(progressText({ result: 'running', started: '2026-10-27T07:55:00Z' }, NOW), 'running for 1 h 35 min');
  assert.equal(progressText({ result: 'running' }, NOW), 'running');
  assert.equal(progressText({ result: 'running', started: '2026-10-27T09:26:40Z' }, NOW, 272), 'running for 3 min, usually about 5 min');
  assert.equal(progressText({ result: 'queued' }, NOW, 45), 'waiting in the queue, usually about 45 s');
  assert.deepEqual([spanText(45), spanText(120), spanText(272), spanText(3600), spanText(5400), spanText(null)], ['45 s', '2 min', '4 min 32 s', '1 h', '1 h 30 min', '']);
});

test('each run reads in plain words: how it ended, what started it, what it covered and why it failed', () => {
  assert.deepEqual(['done', 'failed', 'running', 'queued', 'canceled', 'skipped', 'unfinished', 'nonsense'].map((s) => runFlag(s).text),
    ['Done', 'Failed', 'Running', 'Waiting to start', 'Canceled', 'Skipped', 'Not finished', 'Not recorded']);
  assert.deepEqual([runFlag('done').tone, runFlag('failed').tone, runFlag('unfinished').tone], ['ok', 'bad', 'warn']);
  assert.deepEqual(['schedule', 'refresh', 'build', 'retry', ''].map(triggerText), ['Scheduled', 'Refresh now', 'Build', 'Retry', 'Not recorded']);
  assert.equal(coveredText([]), 'All data');
  assert.equal(coveredText(null), 'Not recorded');
  assert.equal(coveredText([{ label: 'Store', values: ['12', '4'] }, { label: 'Region', values: ['North'] }]), 'Store: 12, 4; Region: North');
  assert.equal(coveredText([{ label: 'Store', values: ['1', '2', '3', '4', '5', '6'], more: 44 }]), 'Store: 1, 2, 3, 4, 5 and 45 more');
  const why = (error_code, status = 'failed', error = 'whatever the job said') => errorText({ status, error, error_code }).lead;
  assert.equal(why('missing_table'), 'A table this use case reads is missing');
  assert.equal(why('missing_column'), 'A column this use case reads is missing');
  assert.equal(why('not_allowed'), 'The job is not allowed to read data it needs');
  assert.equal(why('timed_out'), 'The run took longer than its time limit and was stopped');
  assert.equal(why('no_compute'), 'The computer that runs the job could not start');
  assert.equal(why(''), 'The run stopped with an error');
  for (const odd of [undefined, null, 'constructor', '__proto__', 'toString', 'MISSING_TABLE']) assert.equal(why(odd), 'The run stopped with an error', String(odd));
  assert.equal(why('', 'failed', '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`s`.`items` cannot be found.'), 'The run stopped with an error',
    'the lead comes from the code the server sent, never from the words of the error');
  assert.equal(why('Canceled by Dana', 'canceled'), 'The run was stopped before it finished');
  assert.match(why('', 'skipped'), /^The job skipped this run/);
  assert.equal(errorText({ status: 'failed', error: ' Table not found ' }).detail, 'Table not found');
  assert.deepEqual([runsPageText(0, 20, 45), runsPageText(40, 5, 45), runsPageText(60, 0, 45), runsPageText(0, 0, 0)],
    ['Runs 1 to 20 of 45', 'Runs 41 to 45 of 45', 'No runs on this page; there are 45', 'No runs']);
  assert.equal(lastedText({ status: 'running', started: '2026-10-27T09:26:40Z' }, NOW), 'running for 3 min');
  assert.equal(lastedText({ status: 'queued', started: '2026-10-27T09:29:40Z' }, NOW), 'waiting for under a minute');
  assert.equal(lastedText({ status: 'done', duration_s: 272 }, NOW), '4 min 32 s');
  assert.equal(lastedText({ status: 'failed', duration_s: null }, NOW), '');
  assert.equal(foundText({ summary: 'Discount loss fell.', segments: [{ label: 'Category', values: ['Books'] }], records: 40, to_fix: 5, could_save: 1200 }),
    'Discount loss fell. It covered Category: Books, 40 records.');
  assert.equal(foundText({ summary: '', nothing_to_act: '', segments: [], records: 7420, to_fix: 6, could_save: 33900, currency: 'USD' }),
    '6 things to fix that could save $33.9K. It covered all the data, 7,420 records.');
  assert.equal(foundText({ segments: [], records: 1, to_fix: 1, could_save: null }), '1 thing to fix. It covered all the data, 1 record.');
  assert.equal(couldSaveRunFormula({ to_fix: 6, could_save: 33900, currency: 'USD' }),
    'Money at stake on its 6 things to fix in Act now and Review, added up when the run ended = $33.9K');
  assert.equal(couldSaveRunFormula({ to_fix: null, could_save: 12, currency: '' }), 'Money at stake on its things to fix in Act now and Review, added up when the run ended = 12');
  assert.equal(couldSaveRunFormula({ to_fix: 3, could_save: null }), '');
  assert.equal(foundText({ nothing_to_act: 'No record has 1000 USD or more at stake.', segments: null, records: 10, to_fix: 0 }),
    'No record has 1000 USD or more at stake. It checked 10 records.');
  assert.equal(foundText({ segments: null, records: null, to_fix: 0 }), 'Nothing to fix.');
  assert.equal(foundText({ segments: null, records: null, to_fix: null }), 'This run recorded nothing about what it found.');
  const texts = [runFlag, triggerText].flatMap((f) => ['done', 'failed', 'running', 'queued', 'canceled', 'skipped', 'unfinished', 'schedule', 'refresh', 'build'].map((s) => JSON.stringify(f(s))));
  const words = [...texts, why('x'), why('Table not found'), why('', 'skipped'), why('', 'canceled'), runsPageText(0, 20, 45)].join(' ');
  assert.doesNotMatch(words, /[\u2013\u2014]/, 'no en or em dash in what a business user reads');
});

test('only a latest run newer than the last success is called out, and the stats read plainly', () => {
  const failed = { run_id: '102', result: 'failed', message: 'Table not found', started: '2026-10-27T08:00:00Z' };
  assert.deepEqual(lastRunNote({ ...IDLE, last_run: failed }), { result: 'failed', tone: 'bad', text: 'The latest run failed: Table not found' });
  assert.equal(lastRunNote({ ...IDLE, last_run: { ...failed, started: '2026-10-27T07:00:00Z' } }), null);
  assert.equal(lastRunNote({ ...IDLE, last_run: { ...failed, started: null } }), null, 'a run with no start time is not said to be newer');
  assert.deepEqual(lastRunNote({ ...IDLE, last_success: null, last_run: failed }).text, 'The latest run failed: Table not found');
  assert.equal(lastRunNote(IDLE), null);
  assert.equal(lastRunNote({ ...IDLE, last_run: null }), null);
  assert.deepEqual(runFlag('failed'), { text: 'Failed', tone: 'bad' });
  assert.deepEqual(runFlag('nonsense'), { text: 'Not recorded', tone: 'neutral' });
});

test('every way the latest run can end has its own words, a run that went quiet among them', () => {
  const said = (result, message = '') => lastRunNote({ ...IDLE, last_run: { run_id: null, result, message, started: '2026-10-27T08:00:30Z' } });
  assert.equal(said('succeeded'), null, 'a run that succeeded is the update the header already names');
  const cases = [
    ['failed', 'Table not found', 'bad', 'The latest run failed: Table not found'],
    ['failed', '', 'bad', 'The latest run failed'],
    ['canceled', 'Canceled by Dana', 'fact', 'The latest run was stopped before it finished: Canceled by Dana'],
    ['skipped', '', 'fact', 'The job skipped the latest run, most often because another run of it was still going'],
    ['unknown', LOST.message, 'fact', `The latest run never said it finished: ${LOST.message}`],
    ['unknown', '', 'fact', 'The latest run never said it finished'],
    ['timedout', '', 'fact', 'The App cannot tell how the latest run ended'],
    ['constructor', '', 'fact', 'The App cannot tell how the latest run ended'],
    ['', '', 'fact', 'The App cannot tell how the latest run ended'],
  ];
  for (const [result, message, tone, text] of cases) assert.deepEqual(said(result, message), { result, tone, text }, `${result} ${message}`);
  const leads = new Set(['failed', 'canceled', 'skipped', 'unknown', 'other'].map((r) => said(r).text));
  assert.equal(leads.size, 5, 'each end has words of its own');
  assert.deepEqual(lastRunText(LOST), { result: 'unknown', tone: 'fact', text: `The latest run never said it finished: ${LOST.message}` });
  assert.doesNotMatch(cases.map((c) => c[3]).join(' '), /[\u2013\u2014]/);
});

test('the header says when the use case was last updated, with Refresh now beside it', async () => {
  const { routes } = jobRoutes(IDLE, () => {});
  const { page, seen, context } = await open(routes);
  await banner(page).waitFor();
  assert.equal(await banner(page).locator('.fresh-t').innerText(), 'Updated Oct 27, 07:30 AM UTC');
  assert.match(await page.locator('.ph-meta').innerText(), /^Data through Oct 15, 2026 · /);
  assert.equal(await throughs(page), 1);
  const button = page.getByRole('button', { name: 'Refresh now' });
  assert.equal(await button.isEnabled(), true);
  assert.equal(await banner(page).evaluate((el) => el.classList.contains('fresh--late')), false);
  assert.equal(await page.locator('.fresh-why').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('an overdue use case says Overdue in amber next to when it was updated', async () => {
  const { routes } = jobRoutes({ ...IDLE, overdue: true }, () => {});
  const { page, seen, context } = await open(routes);
  await banner(page).waitFor();
  assert.equal(await banner(page).evaluate((el) => el.classList.contains('fresh--late')), true);
  assert.equal(await page.locator('.ph .fresh .fresh-flag').innerText(), 'Overdue');
  const colors = await page.locator('.ph .fresh .fresh-flag').evaluate((el) => {
    const probe = document.createElement('span');
    probe.style.background = 'var(--amber-bg)';
    el.appendChild(probe);
    const amber = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { flag: getComputedStyle(el).backgroundColor, amber };
  });
  assert.equal(colors.flag, colors.amber);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('when the person may not refresh, the button is disabled and the reason shows beside it', async () => {
  for (const reason of [ONLY_ADMIN, REFUSED]) {
    const { routes } = jobRoutes({ ...IDLE, can_refresh: false, reason }, () => {});
    const { page, seen, context } = await open(routes, {}, appInfo({ auth: 'user' }));
    await banner(page).waitFor();
    const button = page.getByRole('button', { name: 'Refresh now' });
    assert.equal(await button.isDisabled(), true);
    const plain = reason.replace(' GET /api/2.2/jobs/runs/list answered HTTP 403:', '');
    assert.equal(await page.locator('.fresh-why').innerText(), plain);
    assert.equal(await page.locator('.fresh-why').isVisible(), true);
    const described = await button.getAttribute('aria-describedby');
    assert.equal(await page.locator(`#${described}`).innerText(), plain);
    assert.equal(await page.locator('[data-technical-details] pre').count(), reason === REFUSED ? 1 : 0);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('a page without a job shows when its result table changed, and Refresh now is off with the reason beside it', async () => {
  const fresh = { ...NO_JOB, last_success: { run_id: 'u3', started: '2026-10-24T06:00:00Z', ended: null, trigger: null, by: null }, data_through: '2026-10-24' };
  const { state, routes } = jobRoutes(fresh, () => {});
  const { page, seen, context } = await open(routes);
  await banner(page).waitFor();
  assert.equal(await banner(page).locator('.fresh-t').innerText(), 'Updated Oct 24, 06:00 AM UTC');
  assert.equal(await throughs(page), 1);
  const button = page.getByRole('button', { name: 'Refresh now' });
  assert.equal(await button.isDisabled(), true);
  assert.equal(await page.locator(`#${await button.getAttribute('aria-describedby')}`).innerText(), NO_JOB.reason);
  assert.equal(state.posts.length, 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a page without a date filter, or whose filters fail, says how far the data goes once, in the banner', async () => {
  for (const filters of [({ json }) => json(200, { filters: FILTERS.filters.slice(1) }), ({ json }) => json(502, { error: 'warehouse stopped' })]) {
    const { routes } = jobRoutes(IDLE, () => {});
    const { page, seen, context } = await open({ ...routes, filters });
    await banner(page).waitFor();
    await page.waitForFunction(() => !/Reading the data range/.test(document.querySelector('.ph-meta')?.textContent || 'Reading the data range'));
    assert.equal(await banner(page).locator('.fresh-t').innerText(), 'Updated Oct 27, 07:30 AM UTC · data through Oct 26, 2026');
    assert.doesNotMatch(await page.locator('.ph-meta').innerText(), /data through|Reading the data range/i);
    assert.equal(await throughs(page), 1);
    assert.deepEqual(real(seen.errors), []);
    await context.close();
  }
});

test('the default page with no job and no run says it was not updated and why it cannot be', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo());
  await banner(page).waitFor();
  assert.equal(await banner(page).locator('.fresh-t').innerText(), 'Not updated yet');
  assert.equal(await page.getByRole('button', { name: 'Refresh now' }).isDisabled(), true);
  assert.equal(await page.locator('.fresh-why').innerText(), NO_JOB.reason);
  await page.emulateMedia({ media: 'print' });
  assert.equal(await page.locator('.fresh-act').isVisible(), false, 'a printed page shows when it was refreshed, not the button');
  assert.equal(await banner(page).isVisible(), true);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Refresh now starts the job, says it is refreshing all the data, then reloads the page and says Refreshed', async () => {
  const queued = { run_id: '9000', state: 'queued', result: 'queued', started: '2026-10-27T09:30:00Z', by: ME, url: `${JOB_URL}/runs/9000` };
  const { state, routes } = jobRoutes(IDLE, (s, json) => {
    s.fresh = { ...IDLE, active: queued, can_refresh: false, reason: `A refresh is already waiting to run, queued 09:30 UTC by ${ME}`, run_url: queued.url };
    return json(200, { run_id: '9000', state: 'queued' });
  });
  const { page, seen, context } = await open(routes);
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await page.locator('.ph .fresh-d [data-progress]').waitFor();
  assert.deepEqual(state.posts, [{ page: 'n01_u05' }]);
  assert.equal(await page.locator('.fresh-busy b').innerText(), 'Waiting for the refresh to start');
  assert.equal(await page.locator('.fresh-busy').getAttribute('data-tone'), 'progress');
  assert.equal(await page.locator('.ph .fresh-d [data-progress]').innerText(), 'waiting in the queue for under a minute');
  assert.equal(await page.locator('.fresh-t').count(), 0, 'while it runs the header says it is refreshing, not when it last updated');
  const button = page.getByRole('button', { name: 'Refresh now' });
  assert.equal(await button.isDisabled(), true, 'Refresh now stays in place, off, while the refresh runs');
  assert.equal(await page.locator(`#${await button.getAttribute('aria-describedby')}`).getAttribute('role'), 'status');
  assert.equal(await banner(page).getByRole('link').count(), 0);
  state.fresh = { ...state.fresh, active: { ...queued, state: 'running', result: 'running', started: '2026-10-27T09:27:00Z' }, typical_s: 300 };
  const polls = state.polls;
  await page.clock.fastForward(10000);
  await until(() => state.polls > polls);
  await page.waitForFunction(() => /^running for 3 min, usually about 5 min$/.test(document.querySelector('.fresh-d [data-progress]')?.textContent || ''));
  assert.equal(await page.locator('.fresh-busy b').innerText(), 'Refreshing all the data');
  const loads = seen.pages.length;
  const done = { ...queued, trigger: 'manual', started: '2026-10-27T09:27:00Z', ended: '2026-10-27T09:30:05Z', result: 'succeeded', state: 'terminated', message: '' };
  state.fresh = { ...IDLE, last_success: done, last_run: done, run_url: done.url };
  await page.clock.fastForward(10000);
  await page.locator('.toast.is-on').waitFor();
  assert.equal(await page.locator('.toast .toast-t').innerText(), 'Refreshed');
  await until(() => seen.pages.length > loads);
  assert.equal(await banner(page).locator('.fresh-t').innerText(), 'Updated Oct 27, 09:30 AM UTC');
  assert.equal(await page.getByRole('button', { name: 'Refresh now' }).isEnabled(), true);
  const stopped = state.polls;
  await page.clock.fastForward(30000);
  await idle(page);
  assert.equal(state.polls, stopped, 'polling stops once no run is active');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a refresh that fails says why', async () => {
  const active = { run_id: '9000', state: 'running', result: 'running', started: '2026-10-27T09:29:00Z', by: ME, url: `${JOB_URL}/runs/9000` };
  const { state, routes } = jobRoutes({ ...IDLE, active, can_refresh: false, reason: 'busy' }, () => {});
  const { page, seen, context } = await open(routes);
  await page.locator('.fresh-busy').waitFor();
  const loads = seen.pages.length;
  const failed = { ...active, state: 'terminated', result: 'failed', message: 'Table not found', ended: '2026-10-27T09:30:02Z' };
  state.fresh = { ...IDLE, last_run: failed, run_url: failed.url };
  await page.clock.fastForward(10000);
  await page.locator('.toast.is-on').waitFor();
  assert.equal(await page.locator('.toast').innerText(), 'The latest run failed: Table not found');
  assert.equal(await page.locator('.toast').evaluate((el) => el.classList.contains('toast--error')), true);
  assert.equal(await page.locator('.fresh-note').innerText(), 'The latest run failed: Table not found');
  assert.equal(await page.locator('.fresh-note').getAttribute('data-tone'), 'bad');
  assert.equal(await banner(page).locator('.fresh-t').innerText(), 'Updated Oct 27, 07:30 AM UTC', 'the failed run is not the update');
  await idle(page);
  assert.equal(seen.pages.length, loads, 'a failed refresh changed no data, so the page does not reload');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the header names how the latest run ended for every end the server sends, a lost run inside Inspire among them', async () => {
  const at = '2026-10-27T08:00:30Z';
  const ends = [
    [{ ...LAST }, null, 'Updated Oct 27, 07:30 AM UTC'],
    [{ ...LAST, run_id: '102', started: at, result: 'failed', message: 'Table not found' }, 'The latest run failed: Table not found', 'bad'],
    [{ ...LAST, run_id: '103', started: at, result: 'canceled', message: 'Canceled by Dana' }, 'The latest run was stopped before it finished: Canceled by Dana', 'fact'],
    [{ ...LAST, run_id: '104', started: at, result: 'skipped', message: '' }, 'The job skipped the latest run, most often because another run of it was still going', 'fact'],
    [LOST, `The latest run never said it finished: ${LOST.message}`, 'fact'],
    [{ ...LOST, state: 'stopped', result: 'failed', message: 'The run stopped on RuntimeError: the model step failed', ended: '2026-10-27T08:12:00Z' },
      'The latest run failed: The run stopped on RuntimeError: the model step failed', 'bad'],
  ];
  const state = { fresh: IDLE };
  const { page, seen, context } = await open({ freshness: ({ json }) => json(200, state.fresh) });
  for (const [run, text, tone] of ends) {
    state.fresh = { ...IDLE, last_run: run };
    await page.reload();
    await banner(page).locator('.fresh-t').waitFor();
    if (!text) {
      assert.equal(await detail(page).locator('.fresh-note').count(), 0, 'a run that succeeded is the update itself');
      assert.equal(await banner(page).locator('.fresh-t').innerText(), tone);
      continue;
    }
    const note = detail(page).locator('.fresh-note');
    assert.equal(await note.innerText(), text, run.result);
    assert.equal(await note.getAttribute('data-tone'), tone, `${run.result} reads as ${tone}`);
    const ink = await note.evaluate(paints);
    assert.equal(ink.color === ink.danger, tone === 'bad', `${run.result} is red only when it failed`);
    assert.notEqual(ink.color, ink.amber, `${run.result} is a fact or a failure, never a warning`);
    assert.equal(await note.getAttribute('data-last-run'), run.result);
  }
  assert.deepEqual(seen.errors, []);
  await context.close();
});

function paints(el) {
  const probe = (value) => {
    const span = document.createElement('span');
    span.style.color = value;
    el.appendChild(span);
    const color = getComputedStyle(span).color;
    span.remove();
    return color;
  };
  return { color: getComputedStyle(el).color, danger: probe('var(--danger)'), amber: probe('var(--amber-ink)'), green: probe('var(--green-ink)'), muted: probe('var(--muted)') };
}

test('every state a refresh can be in has one heading, one tone and at most one action, for the banner and the toast alike', () => {
  const keys = ['running', 'queued', 'quiet', 'succeeded', 'failed', 'canceled', 'skipped', 'unknown'];
  assert.deepEqual(Object.keys(RUN_STATES), keys);
  assert.deepEqual(keys.map((k) => [k, RUN_STATES[k].heading, RUN_STATES[k].tone, RUN_STATES[k].action]), [
    ['running', 'Refreshing all the data', 'progress', ''],
    ['queued', 'Waiting for the refresh to start', 'progress', ''],
    ['quiet', 'The refresh has gone quiet', 'warn', 'Open the run'],
    ['succeeded', 'Refreshed', 'fact', 'See what changed'],
    ['failed', 'The latest run failed', 'bad', ''],
    ['canceled', 'The latest run was stopped before it finished', 'fact', ''],
    ['skipped', 'The job skipped the latest run, most often because another run of it was still going', 'fact', ''],
    ['unknown', 'The latest run never said it finished', 'fact', ''],
  ]);
  assert.equal(new Set(keys.map((k) => RUN_STATES[k].heading)).size, keys.length, 'each state says something of its own');
  assert.deepEqual(runState('constructor'), { key: 'constructor', heading: 'The App cannot tell how the latest run ended', tone: 'fact', action: '' });
  assert.deepEqual([activeState({ result: 'running' }), activeState({ result: 'queued' }), activeState(SILENT), activeState({ ...SILENT, result: 'running' })].map((s) => s.key),
    ['running', 'queued', 'quiet', 'quiet'], 'a run that went quiet is quiet whatever the job says');
  assert.deepEqual(keys.map((k) => toastTone(RUN_STATES[k].tone)), ['info', 'info', 'info', 'info', 'error', 'info', 'info', 'info'], 'only a failure is a red toast');
  assert.deepEqual(keys.filter((k) => RUN_STATES[k].tone === 'warn'), ['quiet'], 'only a quiet run warns');
  assert.doesNotMatch(keys.map((k) => RUN_STATES[k].heading).join(' '), /[\u2013\u2014]/);
});

test('while a run is on, the header says what is true: progress in green, a quiet run in amber with its one action, and the data it shows as a plain fact', async () => {
  const running = { run_id: '9', state: 'running', result: 'running', started: '2026-10-27T09:27:00Z', by: SAM, url: `${JOB_URL}/runs/9` };
  const quietJob = { ...running, silent_since: '2026-10-27T09:08:20Z', message: SILENT.message, percent: null, eta_s: null };
  const cases = [
    [running, 'running', 'Refreshing all the data', 'progress', null],
    [{ ...running, state: 'queued', result: 'queued', started: '2026-10-27T09:29:40Z' }, 'queued', 'Waiting for the refresh to start', 'progress', null],
    [quietJob, 'quiet', 'The refresh has gone quiet', 'warn', ['link', 'Open the run', `${JOB_URL}/runs/9`]],
    [SILENT, 'quiet', 'The refresh has gone quiet', 'warn', ['button', 'Check again', null]],
  ];
  const state = { fresh: IDLE, polls: 0 };
  const { page, seen, context } = await open({ freshness: ({ json }) => { state.polls += 1; return json(200, state.fresh); } });
  for (const [active, key, heading, tone, action] of cases) {
    state.fresh = { ...IDLE, active, can_refresh: false, reason: 'busy' };
    await page.reload();
    const busy = banner(page).locator('.fresh-busy');
    const more = detail(page);
    await more.locator('[data-progress]').waitFor();
    assert.deepEqual([await busy.getAttribute('data-run-state'), await busy.locator('b').innerText(), await busy.getAttribute('data-tone')], [key, heading, tone]);
    const ink = await busy.locator('b').evaluate(paints);
    assert.equal(ink.color, tone === 'warn' ? ink.amber : ink.green, `${key}: the heading tone`);
    assert.notEqual(ink.color, ink.danger, `${key} is never red`);
    const fact = more.locator('.fresh-asof');
    assert.equal(await fact.innerText(), 'Until it finishes you see the data of the update on Oct 27, 07:30 AM UTC');
    const plain = await fact.evaluate(paints);
    assert.equal(plain.color, plain.muted, `${key}: the data you see is a plain fact`);
    const acts = more.locator('.fresh-go');
    if (!action) {
      assert.equal(await acts.count(), 0, `${key} has no action of its own`);
      continue;
    }
    const [role, name, href] = action;
    assert.equal(await acts.count(), 1, `${key} has one action`);
    assert.equal(await more.getByRole(role, { name }).count(), 1, `${key}: ${name}`);
    if (href) assert.equal(await acts.getAttribute('href'), href);
  }
  const polls = state.polls;
  await detail(page).getByRole('button', { name: 'Check again' }).click();
  await until(() => state.polls > polls);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a click that loses the race to another refresh shows who started it', async () => {
  const running = { run_id: '8000', state: 'running', result: 'running', started: '2026-10-27T09:14:00Z', by: DANA, url: `${JOB_URL}/runs/8000` };
  const message = `A refresh is already running, started 09:14 UTC by ${DANA}`;
  const { state, routes } = jobRoutes(IDLE, (s, json) => {
    s.fresh = { ...IDLE, active: running, can_refresh: false, reason: message };
    return json(409, { error: message });
  });
  const { page, seen, context } = await open(routes);
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await page.locator('.toast.is-on').waitFor();
  assert.equal(await page.locator('.toast').innerText(), message);
  await page.locator('.ph .fresh-d [data-progress]').waitFor();
  assert.equal(await page.locator('.fresh-busy').getAttribute('title'), `Started by ${DANA}`);
  assert.equal(await page.locator('.ph .fresh-d [data-progress]').innerText(), 'running for 16 min');
  assert.equal(state.posts.length, 1);
  assert.deepEqual(real(seen.errors), []);
  await context.close();
});

test('a freshness call that fails leaves the header as it was', async () => {
  const routes = { freshness: ({ json }) => json(502, { error: 'warehouse stopped' }) };
  const { page, seen, context } = await open(routes);
  await idle(page);
  assert.equal(await page.locator('.fresh').count(), 0);
  assert.match(await page.locator('.ph-meta').innerText(), /Data through/);
  assert.deepEqual(real(seen.errors), []);
  await context.close();
});

test('on a phone the banner, the reason and the button wrap without sideways scroll', async () => {
  for (const fresh of [{ ...IDLE, overdue: true, can_refresh: false, reason: REFUSED },
    { ...IDLE, active: { run_id: '9', result: 'running', state: 'running', started: '2026-10-27T09:00:00Z', by: SAM, url: `${JOB_URL}/runs/9` } },
    { ...IDLE, last_run: { run_id: '7', result: 'failed', started: '2026-10-27T09:00:00Z', message: 'x'.repeat(30) + ' SPARK_JOB_CANCELLED '.repeat(6), url: `${JOB_URL}/runs/7` } }]) {
    const { routes } = jobRoutes(fresh, () => {});
    const { page, seen, context } = await open(routes, { width: 375, height: 800 });
    await detail(page).waitFor();
    const fit = await page.evaluate(fits);
    assert.equal(fit.scroll, 0, JSON.stringify(fresh));
    assert.deepEqual(fit.out, []);
    assert.ok(fit.iconBeside, 'the icon stays on the first line of the banner text');
    if (fresh.overdue || fresh.last_run?.result === 'failed') {
      await page.addStyleTag({ content: '.fresh-pt,.fresh-note{display:block!important}.fresh-pt>svg,.fresh-note>svg{display:block}' });
      assert.equal((await page.evaluate(fits)).iconBeside, false, 'the check catches an icon alone on its line');
    }
    if (fresh.reason) {
      await page.addStyleTag({ content: '.fresh-why{white-space:nowrap}' });
      assert.ok((await page.evaluate(fits)).out.includes('fresh-why'), 'the check catches a reason that does not wrap');
    }
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

function fits() {
  const out = [...document.querySelectorAll('.fresh, .fresh *, .fresh-d, .fresh-d *')].filter((el) => {
    const r = el.getBoundingClientRect();
    const spills = el instanceof HTMLElement && el.scrollWidth > el.clientWidth + 1 && getComputedStyle(el).display !== 'inline';
    return r.width > 0 && (r.right > window.innerWidth + 1 || r.left < -1 || spills);
  }).map((el) => String(el.className?.baseVal ?? el.className));
  const beside = (text) => {
    const svg = text.querySelector('svg');
    const icon = svg.getBoundingClientRect();
    const range = document.createRange();
    range.setStartAfter(svg);
    range.setEnd(text, text.childNodes.length);
    const first = [...range.getClientRects()].filter((r) => r.width > 0).sort((a, b) => a.top - b.top)[0];
    return !!first && Math.abs(icon.top - first.top) <= 6 && icon.right <= first.left + 1;
  };
  const iconBeside = [...document.querySelectorAll('.fresh-t, .fresh-pt, .fresh-note')].filter((el) => el.getClientRects().length > 0).every(beside);
  return { scroll: document.documentElement.scrollWidth - window.innerWidth, out, iconBeside };
}

const JOB = { id: '4242', url: JOB_URL, error: '' };
const MISSING = '[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`pricing`.`items` cannot be found.';
const run = (extra) => ({ run_id: null, job_run_id: null, url: '', started: null, ended: null, duration_s: null, status: 'done', trigger: '', by: '',
  segments: null, tables: null, records: null, to_fix: null, could_save: null, currency: '', summary: '', nothing_to_act: '', error: '', ...extra });
const FAILED = run({ job_run_id: '408', url: `${JOB_URL}/runs/408`, started: '2026-10-27T08:00:00Z', duration_s: 360, status: 'failed', trigger: 'refresh',
  by: SAM, error: MISSING, error_code: 'missing_table', segments: [], tables: [] });
const SCHEDULED = run({ run_id: 'u3', job_run_id: '407', url: `${JOB_URL}/runs/407`, started: '2026-10-25T06:00:00Z', duration_s: 180, trigger: 'schedule',
  segments: [{ column: 'category', label: 'Category', values: ['Books', 'Music'], more: 0 }],
  tables: [{ table: 'main.pricing.items', rows: 1200, updated_at: '2026-10-25T05:00:00Z' }, { table: 'main.pricing.loss_trend', rows: null, updated_at: null }],
  records: 40, to_fix: 5, could_save: 1200.5, currency: 'USD', summary: 'Discount loss fell 4% since the run before.' });
const OLD = run({ run_id: 'u0', started: '2026-10-04T06:00:00Z', records: 10, to_fix: 10, nothing_to_act: 'No record has 1000 USD or more at stake.' });
const history = (extra) => ({ runs: [FAILED, SCHEDULED, OLD], total: 3, offset: 0, limit: 20, job: JOB, errors: {}, ...extra });

async function openRuns(data, info = appInfo({}, 1, TABLE), options = {}) {
  const asked = { offsets: [] };
  const routes = { runs: ({ json, url }) => { asked.offsets.push(url.searchParams.get('offset')); return json(200, typeof data === 'function' ? data(url) : data); }, ...options.routes };
  const opened = await openApp(browser, served.base, info, { ...options, routes });
  await goRail(opened.page, 'runs');
  await opened.page.locator('.runs .runs-tbl').waitFor();
  return { ...opened, asked };
}

const texts = (locator) => locator.evaluateAll((els) => els.map((el) => el.textContent));
const mainRows = (page) => page.locator('.runs-tbl > tbody > tr:not(.runs-d)');

test('the Runs tab lists each run: when, how it ended, who started it, what it covered and what it found', async () => {
  const { page, seen, context, asked } = await openRuns(history());
  assert.deepEqual(asked.offsets, ['0'], 'the page reads the runs once, and the tab reuses them');
  assert.equal(await page.locator('[role="tab"]').count(), 0);
  assert.deepEqual(await texts(page.locator('[data-rail="runs"] small')), ['3'], 'there are 3 runs');
  assert.equal(await page.locator('.runs .card-h p').innerText(), 'Newest first. Click a run to see the tables it used. Refresh now updates all the data.');
  assert.deepEqual(await texts(page.locator('.runs-tbl > thead th')), ['Details', 'When', 'Status', 'Started by', 'What it covered', 'Records', 'To fix', 'Could save', 'Ask Genie']);
  assert.equal(await mainRows(page).count(), 3);
  assert.equal(await page.locator('.runs-d').count(), 0, 'every run starts closed');
  assert.match(await mainRows(page).nth(0).innerText(),
    new RegExp(`^\\s*Oct 27, 08:00 AM UTC\\s+6 min\\s+Failed\\s+Refresh now\\s+${SAM.replace('.', '\\.')}\\s+All data\\s+none\\s+none\\s+none\\s+Ask Genie\\s*$`));
  assert.equal(await mainRows(page).nth(0).locator('.run-st--bad').innerText(), 'Failed');
  assert.match(await mainRows(page).nth(1).innerText(), /^\s*Oct 25, 06:00 AM UTC\s+3 min\s+Done\s+Scheduled\s+Category: Books, Music\s+40\s+5\s+\$1\.2K\s+Ask Genie\s*$/);
  assert.equal(await mainRows(page).nth(1).locator('.run-st--ok').innerText(), 'Done');
  const saving = mainRows(page).nth(1).locator('td.money [data-fx]');
  assert.equal(await page.locator(`[id="${await saving.getAttribute('aria-describedby')}"]`).textContent(),
    'Money at stake on its 5 things to fix in Act now and Review, added up when the run ended = $1.2K', 'every money cell shows its formula');
  assert.equal(await mainRows(page).nth(2).locator('td.money [data-fx]').count(), 0, 'a run with no money has no formula');
  assert.match(await mainRows(page).nth(2).innerText(), /^\s*Oct 4, 06:00 AM UTC\s+Done\s+Not recorded\s+Not recorded\s+10\s+10\s+none\s+Ask Genie\s*$/);
  assert.equal(await page.locator('.runs .pager').count(), 0, 'three runs fit on one page');
  assert.equal(await page.locator('.fbar').count(), 0, 'the filters do not apply to the runs');
  assert.doesNotMatch(await page.locator('.runs').innerText(), /[\u2013\u2014]/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const BY_COUNTRY = { mode: 'columns', group_by: ['region', 'country'], groups: 9, levels: [{ level: 'country', groups: 7 }, { level: 'region', groups: 2 }],
  hash: 'h3', other_groups: null };
const BY_ONE = { ...BY_COUNTRY, group_by: ['country'], groups: 7, levels: [{ level: 'country', groups: 7 }] };
const AS_ONE = { mode: 'all', group_by: [], groups: 1, levels: [{ level: 'Global', groups: 1 }], hash: 'h1', other_groups: null };

test('a run says how it grouped its records in plain words, and says nothing when it recorded no grouping', () => {
  assert.equal(groupingText(BY_COUNTRY), 'Data groups: 9 groups by region, country (7 by country, 2 by region)');
  assert.equal(groupingText({ ...BY_COUNTRY, group_by: ['country'], groups: 1, levels: [{ level: 'country', groups: 1 }] }), 'Data groups: 1 group by country');
  assert.equal(groupingText(AS_ONE), 'Data groups: all records as one group');
  for (const none of [null, undefined, {}, { ...BY_COUNTRY, groups: null }]) assert.equal(groupingText(none), '');
  assert.equal(groupingText({ ...BY_COUNTRY, groups: 1234 }), 'Data groups: 1,234 groups by region, country (7 by country, 2 by region)');
});

test('the Runs tab shows each run grouping under what it covered, and an older run without one shows only what it covered', async () => {
  const runs = [run({ run_id: 'g3', started: '2026-10-27T06:00:00Z', segments: [], grouping: BY_COUNTRY }),
    run({ run_id: 'g2', started: '2026-10-26T06:00:00Z', segments: [], grouping: BY_ONE }),
    run({ run_id: 'g1', started: '2026-10-25T06:00:00Z', segments: [], grouping: AS_ONE }), run({ run_id: 'g0', started: '2026-10-24T06:00:00Z', segments: [] })];
  const { page, seen, context } = await openRuns(history({ runs, total: 4 }), appInfo({}, 1, TABLE), { clock: NOW });
  const cells = await mainRows(page).evaluateAll((rows) => rows.map((r) => r.cells[4].querySelector('[data-grouping]')?.textContent ?? null));
  assert.deepEqual(cells, [groupingText(BY_COUNTRY), groupingText(BY_ONE), groupingText(AS_ONE), null]);
  assert.match(await mainRows(page).nth(3).innerText(), /All data/);
  assert.doesNotMatch(await page.locator('.runs').innerText(), /[\u2013\u2014]/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the To fix per run bars go oldest to newest, leave out a run with no count, keep a real 0, and name every third run when crowded', () => {
  const runs = [run({ run_id: 'c', started: '2026-10-27T08:00:00Z', to_fix: 4 }), run({ run_id: 'b', started: '2026-10-20T06:00:00Z' }),
    run({ job_run_id: '9', started: '2026-10-13T06:00:00Z', to_fix: 0 }), run({ run_id: 'a', started: null, to_fix: 1234 })];
  assert.deepEqual(runBars(runs, NOW), [
    { key: 'a', label: 'Not recorded', value: 1234, text: '1,234', tick: 'Not recorded' },
    { key: 'job-9', label: 'Oct 13, 06:00 AM UTC', value: 0, text: '0', tick: 'Oct 13' },
    { key: 'c', label: 'Oct 27, 08:00 AM UTC', value: 4, text: '4', tick: 'Oct 27' }]);
  assert.deepEqual(runs.map((r) => r.run_id || r.job_run_id), ['c', 'b', '9', 'a'], 'the table keeps its newest-first order');
  assert.deepEqual(runBars([], NOW), []);
  assert.deepEqual(runBars(undefined, NOW), []);
  const many = Array.from({ length: 20 }, (_, i) => run({ run_id: `r${i}`, started: new Date(Date.UTC(2026, 9, 27) - i * 86400000).toISOString(), to_fix: i }));
  assert.deepEqual(runBars(many, NOW).map((b) => b.tick).filter(Boolean), ['Oct 8', 'Oct 11', 'Oct 14', 'Oct 17', 'Oct 20', 'Oct 23', 'Oct 26']);
  assert.equal(runBars([run({ run_id: 'old', started: '2025-12-01T06:00:00Z', to_fix: 2 })], NOW)[0].label, 'Dec 1, 2025, 06:00 AM UTC');
});

const TO_FIX = '[data-bars="to_fix_runs"]';
const TO_FIX_HINT = 'Each bar is a run listed below, oldest on the left.';

test('the Runs tab starts with a To fix per run chart: oldest run on the left, newest on the right, and a run that wrote no count gets no bar', async () => {
  const { page, seen, context } = await openRuns(history(), appInfo({}, 1, TABLE), { clock: NOW });
  const chart = page.locator(TO_FIX);
  await chart.locator('.vb-c').first().waitFor();
  assert.equal(await chart.locator('h2').innerText(), 'To fix per run');
  assert.equal(await chart.locator('.card-h p').innerText(), TO_FIX_HINT);
  assert.deepEqual(await texts(chart.locator('.vb-c span')), ['Oct 4', 'Oct 25'], 'the failed run of Oct 27 wrote no count, so it is left out, never drawn as 0');
  assert.deepEqual(await texts(chart.locator('.vb-c b')), ['10', '5']);
  assert.equal(await chart.locator('.cb').getAttribute('aria-label'), 'To fix per run: Oct 4, 06:00 AM UTC 10, Oct 25, 06:00 AM UTC 5');
  const heights = await chart.locator('.vb-c i').evaluateAll((els) => els.map((e) => e.getBoundingClientRect().height));
  assert.ok(heights[0] > heights[1], `the run with more to fix has the taller bar: ${heights}`);
  const drawn = await steadyBox(page, chart);
  const table = await steadyBox(page, page.locator('section.runs'));
  assert.ok(drawn.y + drawn.height < table.y, 'the chart sits above the runs table, with space between them');
  assert.doesNotMatch(await chart.innerText(), /[\u2013\u2014]/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the To fix per run chart shows a placeholder while the runs load, says when no run wrote a count, and is left out before the first run', async () => {
  let release;
  const held = new Promise((resolve) => { release = resolve; });
  const slow = await openApp(browser, served.base, appInfo({}, 1, TABLE), { clock: NOW, routes: { runs: async ({ json }) => { await held; return json(200, history()); } } });
  await slow.page.locator('[data-rail="runs"]').click();
  await slow.page.locator(`${TO_FIX} .chart-skel`).waitFor();
  assert.equal(await slow.page.locator(`${TO_FIX} .explain-btn`).count(), 0, 'nothing to explain while it loads');
  release();
  await slow.page.locator(`${TO_FIX} .vb-c`).first().waitFor();
  assert.equal(await slow.page.locator(`${TO_FIX} .chart-skel`).count(), 0);
  assert.deepEqual(slow.seen.errors, []);
  await slow.context.close();
  let opened = await openRuns(history({ runs: [FAILED, run({ run_id: 'u9', started: '2026-10-20T06:00:00Z', records: 10 })], total: 2 }), appInfo({}, 1, TABLE), { clock: NOW });
  assert.equal(await opened.page.locator(`${TO_FIX} .empty`).innerText(), 'No run listed below wrote a count of things to fix.');
  assert.equal(await opened.page.locator(`${TO_FIX} .vb-c`).count(), 0);
  assert.equal(await opened.page.locator(`${TO_FIX} .explain-btn`).count(), 0);
  assert.deepEqual(opened.seen.errors, []);
  await opened.context.close();
  opened = await openRuns(history({ runs: [run({ run_id: 'u8', started: '2026-10-20T06:00:00Z', records: 10, to_fix: 0 })], total: 1 }), appInfo({}, 1, TABLE), { clock: NOW });
  await opened.page.locator(`${TO_FIX} .vb-c`).first().waitFor();
  assert.deepEqual(await texts(opened.page.locator(`${TO_FIX} .vb-c b`)), ['0'], 'a run that counted nothing to fix is a real 0');
  await opened.context.close();
  opened = await openRuns(history({ runs: [], total: 0 }));
  assert.equal(await opened.page.locator('.runs .more').innerText(), 'The job has not run yet.');
  assert.equal(await opened.page.locator(TO_FIX).count(), 0, 'before the first run only the table says so');
  await opened.context.close();
});

test('the To fix per run chart follows the page of runs the table lists', async () => {
  const all = Array.from({ length: 45 }, (_, i) => run({ run_id: `r${44 - i}`, started: new Date(Date.UTC(2026, 9, 27) - i * 86400000).toISOString(), to_fix: 44 - i }));
  const page45 = (url) => {
    const offset = Number(url.searchParams.get('offset'));
    return history({ runs: all.slice(offset, offset + 20), total: 45, offset });
  };
  const { page, seen, context } = await openRuns(page45, appInfo({}, 1, TABLE), { clock: NOW });
  const values = page.locator(`${TO_FIX} .vb-c b`);
  await page.locator(`${TO_FIX} .vb-c`).first().waitFor();
  assert.deepEqual(await texts(values), Array.from({ length: 20 }, (_, i) => String(25 + i)));
  await page.getByRole('button', { name: 'Older runs' }).click();
  await page.waitForFunction((sel) => document.querySelector(sel)?.textContent === '5', `${TO_FIX} .vb-c b`);
  assert.deepEqual(await texts(values), Array.from({ length: 20 }, (_, i) => String(5 + i)));
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('on a phone twenty runs fit the To fix per run chart with no label over another and no sideways scroll', async () => {
  const all = Array.from({ length: 20 }, (_, i) => run({ run_id: `r${i}`, started: new Date(Date.UTC(2026, 9, 27) - i * 86400000).toISOString(), to_fix: 100 + i * 37 }));
  for (const width of [375, 1440]) {
    const { page, seen, context } = await openRuns(history({ runs: all, total: 20 }), appInfo({}, 1, TABLE), { clock: NOW, width, height: 800 });
    await page.locator(`${TO_FIX} .vb-c`).first().waitFor();
    const fit = await page.evaluate((sel) => {
      const shown = (q) => [...document.querySelectorAll(`${sel} ${q}`)].filter((e) => e.textContent && getComputedStyle(e).display !== 'none')
        .map((e) => e.getBoundingClientRect());
      const overlaps = (list) => list.some((a, i) => list.slice(i + 1).some((b) => a.left < b.right - 0.5 && b.left < a.right - 0.5));
      const card = document.querySelector(sel).getBoundingClientRect();
      const labels = [...shown('.vb-c span'), ...shown('.vb-c b')];
      return { scroll: document.documentElement.scrollWidth - window.innerWidth, ticks: overlaps(shown('.vb-c span')), values: overlaps(shown('.vb-c b')),
        inside: labels.every((r) => r.left >= card.left - 0.5 && r.right <= card.right + 0.5), ticksShown: shown('.vb-c span').length };
    }, TO_FIX);
    assert.deepEqual({ ...fit, ticksShown: fit.ticksShown > 1 }, { scroll: 0, ticks: false, values: false, inside: true, ticksShown: true }, `at ${width}px`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('opening a run shows the tables it used and what it found, and for a failed run what went wrong in plain words', async () => {
  const { page, seen, context } = await openRuns(history());
  const toggle = mainRows(page).nth(1).locator('.runs-tog');
  assert.equal(await toggle.getAttribute('aria-label'), 'Show the run of Oct 25, 06:00 AM UTC');
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'true');
  assert.equal(await toggle.getAttribute('aria-label'), 'Hide the run of Oct 25, 06:00 AM UTC');
  const details = page.locator(`#${await toggle.getAttribute('aria-controls')}`);
  assert.deepEqual(await texts(details.locator('h3')), ['Tables it used', 'What it found']);
  assert.deepEqual(await texts(details.locator('.runs-sub thead th')), ['Table', 'Rows read', 'Last updated', 'Ask Genie']);
  assert.deepEqual(await details.locator('.runs-sub tbody tr').allInnerTexts(), ['main.pricing.items\t1,200\tOct 25, 05:00 AM UTC\t\nAsk Genie', 'main.pricing.loss_trend\tnone\tnone\t\nAsk Genie']);
  assert.equal(await details.locator('section').nth(1).locator('p').innerText(), 'Discount loss fell 4% since the run before. It covered Category: Books, Music, 40 records.');
  assert.equal(await details.getByRole('link').count(), 0, 'a run that ended well needs no workspace link');
  await mainRows(page).nth(0).locator('td').nth(3).click();
  const failed = page.locator('.runs-d').first();
  assert.deepEqual(await texts(failed.locator('h3')), ['Tables it used', 'What went wrong']);
  assert.match(await failed.locator('.run-err').innerText(), /^A table this use case reads is missing\s+Details: \[TABLE_OR_VIEW_NOT_FOUND\][\s\S]+Open the run$/);
  assert.equal(await failed.getByRole('link', { name: 'Open the run' }).getAttribute('href'), `${JOB_URL}/runs/408`);
  assert.equal(await failed.locator('section').first().locator('p').innerText(), 'This run recorded no tables.');
  await mainRows(page).nth(2).locator('.runs-tog').click();
  const old = page.locator('.runs-d').nth(2);
  assert.equal(await old.locator('section').first().locator('p').innerText(), 'This run did not record the tables it used.');
  assert.equal(await old.locator('section').nth(1).locator('p').innerText(), 'No record has 1000 USD or more at stake. It checked 10 records.');
  assert.equal(await page.locator('.runs-d').count(), 3);
  await toggle.click();
  assert.equal(await toggle.getAttribute('aria-expanded'), 'false');
  assert.equal(await page.locator('.runs-d').count(), 2);
  await mainRows(page).nth(0).locator('.runs-tog').focus();
  await page.keyboard.press('Enter');
  assert.equal(await page.locator('.runs-d').count(), 1, 'the keyboard opens and closes a run too');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Runs tab pages twenty runs at a time, newest first', async () => {
  const all = Array.from({ length: 45 }, (_, i) => run({ run_id: `r${44 - i}`, started: new Date(Date.UTC(2026, 9, 27) - i * 86400000).toISOString(), records: 44 - i }));
  const page45 = (url) => {
    const offset = Number(url.searchParams.get('offset'));
    return history({ runs: all.slice(offset, offset + 20), total: 45, offset });
  };
  const { page, seen, context, asked } = await openRuns(page45);
  assert.equal(await mainRows(page).count(), 20);
  assert.equal(await page.locator('.runs .pager-n').innerText(), 'Runs 1 to 20 of 45');
  assert.equal(await mainRows(page).first().locator('td').nth(5).innerText(), '44');
  const newer = page.getByRole('button', { name: 'Newer runs' });
  const older = page.getByRole('button', { name: 'Older runs' });
  assert.equal(await newer.isDisabled(), true);
  await older.click();
  await page.waitForFunction(() => document.querySelector('.runs .pager-n')?.textContent === 'Runs 21 to 40 of 45');
  await older.click();
  await page.waitForFunction(() => document.querySelector('.runs .pager-n')?.textContent === 'Runs 41 to 45 of 45');
  assert.equal(await mainRows(page).count(), 5);
  assert.equal(await older.isDisabled(), true);
  assert.equal(await mainRows(page).last().locator('td').nth(5).innerText(), 'none', 'a run that checked no records says none');
  await newer.click();
  await page.waitForFunction(() => document.querySelector('.runs .pager-n')?.textContent === 'Runs 21 to 40 of 45');
  assert.deepEqual(asked.offsets, ['0', '20', '40', '20']);
  assert.deepEqual(await texts(page.locator('[data-rail="runs"] small')), ['45'], 'the Runs button keeps the count from the newest runs while you page');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Runs tab says what could not load and still lists what it has', async () => {
  const { page, seen, context } = await openRuns(history({ runs: [SCHEDULED, OLD], job: { ...JOB, error: 'GET /api/2.2/jobs/runs/list answered HTTP 403: no access' },
    errors: { table: 'the result table has no change_source', summary: 'PERMISSION_DENIED: no SELECT' } }));
  assert.deepEqual(await saidAll(page.locator('.runs .tile-err')), [
    "The job's runs could not load, so the list shows only the runs this use case recorded: no access",
    'The runs written to the results table could not load: the result table has no change_source',
    'The details of each run could not load, so the list shows what the job recorded: no SELECT, so ask its owner or a workspace admin to give you access.']);
  assert.equal(await mainRows(page).count(), 2);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('before the first run the Runs tab says so, and a page with no job and no results table says why it has no runs', async () => {
  let opened = await openRuns(history({ runs: [], total: 0 }));
  assert.equal(await opened.page.locator('.runs .more').innerText(), 'The job has not run yet.');
  assert.deepEqual(await texts(opened.page.locator('[data-rail="runs"] small')), ['0']);
  assert.deepEqual(opened.seen.errors, []);
  await opened.context.close();
  opened = await openRuns(history({ runs: [], total: 0, job: null }), appInfo());
  assert.equal(await opened.page.locator('[data-rail="runs"]').getAttribute('aria-current'), 'page');
  assert.equal(await opened.page.locator('.runs .more').innerText(), 'This use case has no job and keeps no results table, so it has no runs to show.');
  assert.deepEqual(opened.seen.errors, []);
  await opened.context.close();
});

test('Refresh now shows the new run in the Runs tab when it starts and again when it ends, even when it fails', async () => {
  const queued = { run_id: '9000', state: 'queued', result: 'queued', started: '2026-10-27T09:30:00Z', by: ME, url: `${JOB_URL}/runs/9000` };
  const { state, routes } = jobRoutes(IDLE, (s, json) => {
    s.fresh = { ...IDLE, active: queued, can_refresh: false, reason: 'busy', typical_s: 240 };
    return json(200, { run_id: '9000', state: 'queued' });
  });
  const live = { runs: [SCHEDULED] };
  const { page, seen, context, asked } = await openRuns(() => history({ runs: live.runs, total: live.runs.length }), appInfo({}, 1, TABLE), { clock: NOW, routes });
  assert.deepEqual(asked.offsets, ['0']);
  live.runs = [run({ job_run_id: '9000', status: 'queued', trigger: 'refresh', by: ME, started: queued.started }), SCHEDULED];
  await page.getByRole('button', { name: 'Refresh now' }).click();
  await page.locator('.ph .fresh-d [data-progress]').waitFor();
  assert.equal(await page.locator('.ph .fresh-d [data-progress]').innerText(), 'waiting in the queue for under a minute, usually about 4 min');
  await until(() => asked.offsets.length === 2);
  await page.waitForFunction(() => document.querySelectorAll('.runs-tbl > tbody > tr').length === 2);
  assert.match(await mainRows(page).first().innerText(), /waiting for under a minute\s+Waiting to start\s+Refresh now/);
  assert.deepEqual(await texts(page.locator('[data-rail="runs"] small')), ['2']);
  const loads = seen.pages.length;
  const ended = { ...queued, state: 'terminated', result: 'failed', message: 'Cluster did not start', ended: '2026-10-27T09:31:00Z' };
  live.runs = [run({ job_run_id: '9000', status: 'failed', trigger: 'refresh', by: ME, started: queued.started, duration_s: 60, error: ended.message, error_code: 'no_compute' }), SCHEDULED];
  state.fresh = { ...IDLE, last_run: ended };
  await page.clock.fastForward(10000);
  await until(() => asked.offsets.length === 3);
  await page.waitForFunction(() => /Failed/.test(document.querySelector('.runs-tbl > tbody > tr')?.textContent || ''));
  await mainRows(page).first().locator('.runs-tog').click();
  assert.match(await page.locator('.run-err').innerText(), /^The computer that runs the job could not start\s+Details: Cluster did not start$/);
  await idle(page);
  assert.equal(seen.pages.length, loads, 'a failed refresh changed no data, so only the runs reload');
  assert.deepEqual(asked.offsets, ['0', '0', '0']);
  assert.deepEqual(real(seen.errors), []);
  await context.close();
});

test('the section is part of the link: the Runs rail item writes it, Dashboard clears it, and an old ?v=runs link opens Runs', async () => {
  const { page, seen, context } = await openRuns(history());
  await page.waitForFunction(() => location.hash === '#/n01_u05/runs');
  await page.locator('[data-rail="dashboard"]').click();
  await page.waitForFunction(() => location.hash === '#/n01_u05/dashboard');
  await page.locator('.kpi-v').first().waitFor();
  await page.evaluate(() => { location.hash = '#/n01_u05?v=runs'; });
  await page.waitForFunction(() => location.hash === '#/n01_u05/runs' && document.querySelector('[data-rail="runs"]')?.getAttribute('aria-current') === 'page');
  await page.locator('.runs .runs-tbl').waitFor();
  assert.deepEqual(seen.errors, []);
  await context.close();
  const plain = await openRuns(history({ job: null }), appInfo());
  await plain.page.waitForFunction(() => location.hash === '#/n01_u05/runs');
  await plain.page.evaluate(() => { location.hash = '#/n01_u05?v=trend'; });
  await plain.page.locator('.toast.is-on').waitFor();
  assert.equal(await plain.page.locator('.toast').innerText(), 'Some filters in this link no longer apply');
  await plain.page.waitForFunction(() => location.hash === '#/n01_u05/dashboard' && document.querySelector('[data-rail="runs"]')?.getAttribute('aria-current') !== 'page');
  assert.deepEqual(plain.seen.errors, []);
  await plain.context.close();
});

test('on a phone the Runs tab scrolls its own table, never the page', async () => {
  const { page, seen, context } = await openRuns(history(), appInfo({}, 1, TABLE), { width: 375, height: 800 });
  await mainRows(page).nth(1).locator('.runs-tog').click();
  await page.locator('.runs-d').waitFor();
  const fit = await page.evaluate(() => ({ scroll: document.documentElement.scrollWidth - window.innerWidth,
    wrap: document.querySelector('.runs .tbl-wrap').scrollWidth > document.querySelector('.runs .tbl-wrap').clientWidth }));
  assert.equal(fit.scroll, 0);
  assert.equal(fit.wrap, true, 'the wide table scrolls inside its card');
  const views = await steadyBox(page, page.getByRole('button', { name: 'Views', exact: true }));
  assert.ok(views.x >= 0 && views.x + views.width <= 376);
  assert.deepEqual(seen.errors, []);
  await context.close();
});
