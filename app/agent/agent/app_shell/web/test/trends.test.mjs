import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, FILTERS, NO_RUNS, TABLE, appInfo, openApp, serveDist, until } from './harness.mjs';
import { FOCUSES, buildHash, canonicalHash, fixThis, parseHash } from '../src/links.js';
import { ageBars, alarmBars, backlogChart, flowChart, hoursText, rateText, stakeBars, trendTiles } from '../src/trends.js';
import { timelineChart } from '../src/trends.js';
import { NOT_MEASURED } from '../src/hub.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const RUNS = { updated: '2026-10-20T06:00:00Z', as_of: '2026-10-20', cadence_days: 7, next: '2026-10-27', stale: false, count: 6, failed: false };
const TRACKED = {
  visible: true, tracked: true, money: true, categories: ['ai_cat_driver'], served: 'delta', total: 1, truncated: false, runs: RUNS, weeks: [],
  items: [{ key: 'R001', label: 'Item number 1', tier: 'Act now', money: 900, why: null, owner: null, status: null, reason: 'Discount too deep', due: null }],
  done: { fixed: 0, fixed_q: 0, dismissed: 0, dismissed_q: 0, saved_n: 0, saved: 0, saved_q_n: 0, saved_q: 0, first_fixed: null, first_saved: null },
};
const HUB = { today: '2026-10-24', quarter: '2026-10-01', since: '2026-08-03', errors: {}, pages: { n01_u05: TRACKED } };
const SUMMARY = { run: { summary: null, nothing_to_act: null, decision_basis: 'measured', currency: 'USD', as_of_date: '2026-10-20' },
  categories: { ai_cat_driver: { meaning: 'why the item is on the list', values: ['Discount too deep', 'Price below cost'] } }, note: '' };
const WEEKS = Array.from({ length: 12 }, (_, i) => ({ week: new Date(Date.UTC(2026, 7, 3 + 7 * i)).toISOString().slice(0, 10), new: i % 3, cleared: i % 2 }));
const TRENDS = {
  visible: true, tracked: true, actions: true, money: true, reason: 'ai_cat_driver', holds: false, served: 'delta', since: '2026-08-03', weeks: WEEKS,
  backlog: [{ run_id: 'r1', at: '2026-10-13T06:00:00Z', open: 9, new: 9, cleared: null }, { run_id: 'r2', at: '2026-10-20T06:00:00Z', open: 7, new: 2, cleared: 4 }],
  open: { n: 7, overdue: 2, unassigned: 3, ages: { '0-7': 2, '8-30': 4, over_30: 1 }, money: 4200 },
  stake: [{ reason: 'Discount too deep', n: 4, money: 3000 }, { reason: 'Not explained yet', n: 3, money: null }],
  false_alarms: { closed: 10, dismissed: 4, rate: 0.4, reasons: [{ reason: 'Discount too deep', closed: 8, dismissed: 4, rate: 0.5 }] },
  first_action: { n: 5, median_hours: 30.5, waiting: 2 },
};
const COUNTS = { statuses: { New: 2, 'In progress': 0, Done: 0, Dismissed: 0, 'Could not fix': 0 }, mine: 0, all: 2 };
const TIER_FILTERS = { ...FILTERS, columns: { list: [{ column: 'priority_tier', label: 'Priority', type: 'multi_select', options: ['Act now', 'Review', 'Monitor'] }] } };
const RUN_ROWS = [
  { run_id: 'r2', status: 'done', started: '2026-10-20T06:00:00Z', records: 40, to_fix: 7, trigger: 'schedule' },
  { run_id: 'r1', status: 'done', started: '2026-10-13T06:00:00Z', records: 38, to_fix: 9, trigger: 'schedule' },
  { run_id: '', job_run_id: 77, status: 'failed', started: '2026-10-06T06:00:00Z', records: null, to_fix: null, trigger: 'schedule' },
];

function routes(extra = {}) {
  const calls = { trends: 0, refresh: [] };
  return {
    calls,
    routes: {
      overview: ({ json }) => json(200, HUB),
      summary: ({ json }) => json(200, SUMMARY),
      filters: ({ json }) => json(200, TIER_FILTERS),
      trends: ({ json }) => { calls.trends += 1; return json(200, TRENDS); },
      records: ({ route, json, seen }) => {
        const body = route.request().postDataJSON();
        seen.records.push(body);
        const rows = [1, 2].map((i) => ({ entity_id: `R00${i}`, record_key: `R00${i}`, _inspire_key: `R00${i}`, _inspire_version: String(100 + i),
          entity_label: `Item number ${i}`, priority_tier: 'Act now', rank: i, category: 'Books' }));
        return json(200, { rows, total: rows.length, offset: 0, limit: body.limit || 25, actions: true, changes: false, summary: null, errors: {},
          ...(body.status_counts ? { status_counts: COUNTS } : {}) });
      },
      refresh: ({ route, json }) => { calls.refresh.push(route.request().postDataJSON()); return json(200, { run_id: 'r3', state: 'pending' }); },
      ...extra,
    },
  };
}

test('the trend tiles read the counts, say what is not measured, and offer Fix this only when there is something to fix', () => {
  const fixes = [];
  const tiles = trendTiles(TRENDS, { onFix: (o) => fixes.push(o), onRuns: () => fixes.push('runs'), onFeedback: () => fixes.push('feedback'),
    latest: { status: 'failed', started: '2026-10-20T06:00:00Z', error: { kind: 'timed_out' } } });
  const by = Object.fromEntries(tiles.map((t) => [t.id, t]));
  assert.deepEqual(tiles.map((t) => t.id), ['overdue', 'unassigned', 'first_action', 'false_alarms', 'holdout', 'run_health']);
  assert.equal(by.overdue.value, '2');
  assert.equal(by.unassigned.sub, '43% of the open records have no owner');
  assert.equal(by.first_action.value, '30.5 h');
  assert.equal(by.false_alarms.value, '40%');
  assert.equal(by.false_alarms.tone, 'amber', 'four in ten closed as Not an issue says the logic needs tuning');
  assert.equal(by.holdout.value, NOT_MEASURED);
  assert.equal(by.run_health.value, 'Failed');
  assert.equal(by.run_health.tone, 'red');
  by.overdue.action.run();
  by.unassigned.action.run();
  by.false_alarms.action.run();
  assert.deepEqual(fixes, [{ focus: 'overdue' }, { focus: 'unassigned' }, 'feedback']);
  const calm = trendTiles({ ...TRENDS, open: { ...TRENDS.open, overdue: 0, unassigned: 0 }, false_alarms: { closed: 0, dismissed: 0, rate: null, reasons: [] } }, { onFix: () => {} });
  const quiet = Object.fromEntries(calm.map((t) => [t.id, t]));
  assert.equal(quiet.overdue.action, null, 'no Fix this when nothing is overdue');
  assert.equal(quiet.unassigned.action, null);
  assert.equal(quiet.false_alarms.value, NOT_MEASURED);
  assert.equal(quiet.false_alarms.action, null);
});

test('the holdout tile reuses the Impact holdout and says why there is none', () => {
  const lift = trendTiles(TRENDS, { impact: { tracked: true, holdout: { shown: { n: 20, hits: 12 }, held: { n: 10, hits: 3 } } } }).find((t) => t.id === 'holdout');
  assert.equal(lift.value, '+30 pts');
  assert.equal(lift.tone, 'green');
  const off = trendTiles(TRENDS, { impact: { tracked: true, holdout: null, holds: false } }).find((t) => t.id === 'holdout');
  assert.match(off.sub, /Holdout is off/);
});

test('the trend charts and bars carry every week, run, age and reason, with nulls kept as not measured', () => {
  assert.deepEqual(backlogChart(TRENDS).result.rows.map((r) => r.y0), [9, 7]);
  const flow = flowChart(TRENDS);
  assert.equal(flow.result.rows.length, 12);
  assert.deepEqual(flow.chart.y.map((y) => y.label), ['New', 'Cleared']);
  assert.deepEqual(ageBars(TRENDS, 'blue').map((b) => [b.key, b.value]), [['0-7', 2], ['8-30', 4], ['over_30', 1]]);
  assert.deepEqual(stakeBars(TRENDS, 'blue', 'USD', 'money').map((b) => b.text), ['$3,000 on 4 records', '3 records, not measured yet']);
  assert.deepEqual(alarmBars(TRENDS, 'amber').map((b) => [b.key, b.value, b.text]), [['Discount too deep', 50, '50% of 8']]);
  assert.equal(hoursText(null), NOT_MEASURED);
  assert.equal(hoursText(0.2), '12 min');
  assert.equal(hoursText(100), '4.2 days');
  assert.equal(rateText(0), '0%');
});

test('the run timeline joins the runs with the trend counts, oldest first, and names the failed runs', () => {
  const { chart, result, failed } = timelineChart(RUN_ROWS, TRENDS);
  assert.equal(failed, 1);
  assert.match(chart.hint, /1 of 3 runs failed/);
  assert.deepEqual(result.rows.map((r) => [r.y0, r.y1, r.y2]), [[null, null, null], [38, 9, null], [40, 2, 4]]);
  assert.match(result.rows[0].x, /\(failed\)$/);
  assert.deepEqual(timelineChart([], null).result.rows, []);
});

test('a focus pre-filter lands on the All tab, rides in the Work address and is dropped outside Work', () => {
  const page = { records: { tier: 'priority_tier', columns: [] } };
  const next = fixThis(page, [], { range: {}, sel: {} }, { owner: 'me', show: 'act' }, { focus: 'overdue' });
  assert.equal(next.tab, 'all', 'the card counted every open record, so the list must not narrow to one status');
  assert.equal(next.focus, 'overdue');
  assert.equal(fixThis(page, [], null, {}, { focus: 'late' }).focus, '', 'an unknown focus is dropped');
  const hash = buildHash('n01_u05', 'work', null, [], null, null, 'all', 'unassigned');
  assert.equal(parseHash(hash).focus, 'unassigned');
  assert.equal(parseHash('#/n01_u05/work?focus=nope').focus, '');
  assert.ok(!buildHash('n01_u05', 'dashboard', null, [], null, null, '', 'overdue').includes('focus'));
  assert.equal(canonicalHash('#/n01_u05/runs?focus=overdue', { pages: [{ id: 'n01_u05' }], performance: true }), '#/n01_u05/runs');
  assert.deepEqual(Object.keys(FOCUSES), ['overdue', 'unassigned', 'older']);
});

test('the dashboard shows the trend cards, and Fix this on Overdue opens Work on All with only the overdue records', async () => {
  const { routes: r, calls } = routes();
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: r, ready: '[data-trends] [data-tile="overdue"] .kpi-v' });
  assert.equal(await page.locator('[data-trends] [data-tile="overdue"] .kpi-v').innerText(), '2');
  assert.equal(await page.locator('[data-trends] [data-tile="false_alarms"] .kpi-v').innerText(), '40%');
  await page.locator('[data-card="trend_flow"] canvas').waitFor();
  await page.locator('[data-card="trend_backlog"] canvas').waitFor();
  assert.equal(await page.locator('[data-bars="trend_ages"] .hb').count(), 3);
  await page.locator('[data-bars="trend_stake"] [data-fix-reason]').first().waitFor();
  assert.equal(await page.locator('[data-bars="trend_stake"] [data-fix-reason]').count(), 2);
  assert.deepEqual(await page.locator('[data-bars="trend_ages"] [data-fix-reason]').evaluateAll((els) => els.map((e) => e.dataset.fixReason)), ['over_30'],
    'only the over 30 days bar has a matching filter');
  assert.equal(calls.trends, 1, 'the cards cost one request');
  await page.locator('[data-trends] [data-fix="overdue"]').click();
  await page.waitForFunction(() => window.location.hash.startsWith('#/n01_u05/work') && window.location.hash.includes('focus=overdue'));
  assert.match(await page.evaluate(() => window.location.hash), /tab=all/);
  await until(() => seen.records.at(-1)?.focus === 'overdue');
  const asked = seen.records.at(-1);
  assert.equal(asked.status_counts, true);
  assert.equal(asked.column_filters?.action_status, undefined, 'All asks for no status');
  await page.locator('[data-focus="overdue"]').waitFor();
  assert.match(await page.locator('[data-focus]').innerText(), /past their due date/);
  await page.locator('[data-focus] button').click();
  await page.waitForFunction(() => !window.location.hash.includes('focus='));
  await until(() => seen.records.at(-1)?.focus === undefined);
  assert.equal(await page.locator('[data-focus]').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Fix this on the over 30 days bar and on a stake reason pre-filter Work', async () => {
  const { routes: r } = routes();
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: r, ready: '[data-bars="trend_ages"] [data-fix-reason="over_30"]' });
  await page.locator('[data-bars="trend_ages"] [data-fix-reason="over_30"]').click();
  await until(() => seen.records.at(-1)?.focus === 'older');
  await page.evaluate(() => { window.location.hash = '#/n01_u05/dashboard'; });
  await page.locator('[data-bars="trend_stake"] [data-fix-reason="Discount too deep"]').click();
  await until(() => (seen.records.at(-1)?.ai?.ai_cat_driver || [])[0] === 'Discount too deep');
  assert.equal(seen.records.at(-1).focus, undefined);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a use case without actions shows no trend cards and no error', async () => {
  const { routes: r } = routes({ trends: ({ json }) => json(200, { visible: true, tracked: true, actions: false, note: 'no actions' }) });
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: r, ready: '[data-fix]' });
  await page.waitForTimeout(300);
  assert.equal(await page.locator('[data-trends]').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the trend cards say so when they cannot load', async () => {
  const { routes: r } = routes({ trends: ({ json }) => json(500, { error: 'the warehouse is asleep' }) });
  const { page, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: r, ready: '[data-trends-error]' });
  assert.match(await page.locator('[data-trends-error]').innerText(), /the warehouse is asleep/);
  await context.close();
});

test('Runs shows the timeline and Run now for an owner, and Run now starts one refresh', async () => {
  const { routes: r, calls } = routes({ runs: ({ json }) => json(200, { ...NO_RUNS, runs: RUN_ROWS, total: 3, can_run: true }) });
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { hash: '#/n01_u05/runs', routes: r, ready: '[data-runs-now]' });
  await page.locator('[data-card="run_timeline"] canvas').waitFor();
  assert.match(await page.locator('[data-card="run_timeline"]').innerText(), /1 of 3 runs failed/);
  await page.getByRole('button', { name: 'Run now' }).click();
  await until(() => calls.refresh.length === 1);
  assert.deepEqual(calls.refresh[0], { page: 'n01_u05' });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Runs hides Run now from someone who may not run the use case', async () => {
  const { routes: r } = routes({ runs: ({ json }) => json(200, { ...NO_RUNS, runs: RUN_ROWS, total: 3, can_run: false }) });
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { hash: '#/n01_u05/runs', routes: r, ready: '[data-card="run_timeline"]' });
  assert.equal(await page.locator('[data-runs-now]').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('with alerting on, the Alerts list sits under Runs and the rail has no separate Alerts item', async () => {
  const ON = { options: { modify: false, replace_edits: false, decisions: true, alerts: true }, alert_folder: '/Workspace/Shared/acme/alerts' };
  const listing = { on: true, reason: '', built: '', unread: 0, admin: false, caps: { app: 20, person: 10, used: 0, mine: 0 }, schedules: [],
    operators: ['>='], baseline_operators: ['>='], measures: [], alerts: [] };
  const { routes: r } = routes({ alerts: ({ json }) => json(200, listing), runs: ({ json }) => json(200, { ...NO_RUNS, runs: RUN_ROWS, total: 3 }) });
  const { page, seen, context } = await openApp(browser, served.base, appInfo(ON, 1, TABLE), { hash: '#/n01_u05/runs', routes: r, ready: 'section.alerts' });
  assert.equal(await page.locator('[data-rail="alerts"]').count(), 0);
  assert.equal(await page.locator('[data-rail="runs"]').getAttribute('aria-current'), 'page');
  const order = await page.evaluate(() => {
    const runs = document.querySelector('section.runs');
    const alerts = document.querySelector('section.alerts');
    return runs.compareDocumentPosition(alerts) & Node.DOCUMENT_POSITION_FOLLOWING;
  });
  assert.ok(order, 'the alerts come after the runs');
  await page.goto(`${served.base}#/n01_u05/alerts`);
  await page.locator('section.alerts').waitFor();
  assert.equal(await page.locator('[data-rail="runs"]').getAttribute('aria-current'), 'page', 'an alerts link still lights up Runs');
  assert.deepEqual(seen.errors, []);
  await context.close();
});
