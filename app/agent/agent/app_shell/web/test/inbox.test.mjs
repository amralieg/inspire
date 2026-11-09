import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, FILTERS, PERSON, TABLE, appInfo, lister, openApp, prefsFirst, serveDist, tracked, until } from './harness.mjs';
import { MY_KEY } from '../src/prefs.js';
import { DUE_DAYS, failedRuns, inboxAsks, inboxGroups, inboxOn } from '../src/inbox.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const VISIT = Date.UTC(2026, 9, 20, 9);
const TODAY = '2026-10-24';
const at = (ms) => String(ms * 1000);
const row = (key, over = {}) => ({ record_key: key, _inspire_key: key, entity_id: key, entity_label: `Item ${key}`, _inspire_version: at(VISIT - 3600000), ...over });
const META = { label: 'entity_label' };
const MINE = [
  row('R003', { _inspire_due: '2026-10-20', _inspire_status: 'In progress' }),
  row('R004', { _inspire_due: '2026-10-26', _inspire_version: at(VISIT + 120000) }),
  row('R005', { _inspire_due: '2026-11-10' }),
  row('R006', { _inspire_due: '2026-10-21', _inspire_status: 'Done', _inspire_version: at(VISIT + 120000) }),
  { entity_label: 'No key', _inspire_version: at(VISIT + 120000), _inspire_due: '2026-10-22' },
];
const UNOWNED = [
  row('R007', { _inspire_due: '2026-10-25' }),
  row('R008', { _inspire_due: '2026-10-23', _inspire_owner: ' ' }),
  row('R009', { _inspire_due: '2026-10-25', _inspire_owner: PERSON }),
  row('R003', { _inspire_due: '2026-10-20' }),
  row('R010', { _inspire_due: '2026-10-26', _inspire_status: 'Done' }),
];
const run = (id, status, started, over = {}) => ({ run_id: id, job_run_id: Number(id.slice(1)), status, started, ended: started, duration_s: 300, trigger: 'schedule',
  records: 10, to_fix: 2, segments: [], tables: [], stages: [], error: status === 'failed' ? 'Table main.sales.orders was not found' : '', error_code: status === 'failed' ? 'missing_table' : '', ...over });
const RUN_LIST = [
  run('j9', 'running', '2026-10-24T08:00:00Z'),
  run('j8', 'failed', '2026-10-23T06:00:00Z'),
  run('j7', 'canceled', '2026-10-22T06:00:00Z'),
  run('j6', 'failed', '2026-10-21T06:00:00Z'),
  run('j5', 'done', '2026-10-20T06:00:00Z'),
  run('j4', 'failed', '2026-10-19T06:00:00Z'),
];
const RUNS = { runs: RUN_LIST, total: RUN_LIST.length, offset: 0, limit: 20, job: null, errors: {}, can_run: true };
const report = (id, status, text, over = {}) => ({ feedback_id: id, section: 'work', record_key: '', text, reported_by: 'sam.roe', reported_at: '2026-10-23T09:00:00Z', status, ...over });
const REPORTS = { items: [report('f1', 'new', 'The due day on Item R003 is wrong'), report('f2', 'vibe', 'Add a column for the store'), report('f3', 'closed', 'Old complaint'),
  report('f4', 'new', 'طلب تغيير عمود المتجر')], everyone: true, missing: false, limit: 2000 };

test('the inbox first reads one row with no window to learn whether the list keeps actions, then asks for your open records, and for the ones nobody owns when you own the use case', () => {
  const mine = { page: 'p1', filters: {}, mine: true, window: 'all', limit: 50 };
  const probe = { page: 'p1', filters: {}, changed: true, limit: 1 };
  assert.deepEqual(inboxAsks({ id: 'p1' }), { probe, mine }, 'someone who does not own the use case never asks for the records nobody owns (must-exclude)');
  assert.deepEqual(inboxAsks({ id: 'p1', is_owner: true }), { probe, mine, unowned: { page: 'p1', filters: {}, unowned: true, window: 'all', due_within: DUE_DAYS, limit: 50 } });
  const app = { options: { decisions: true }, user: { email: PERSON } };
  assert.equal(inboxOn(app, { history: true, records: {} }), true);
  assert.equal(inboxOn({ ...app, options: { decisions: false } }, { history: true, records: {}, is_owner: true }), true, 'an owner has failed runs and reports to see');
  assert.equal(inboxOn({ ...app, user: {} }, { history: true, records: {}, is_owner: true }), false, 'nobody signed in has no inbox (must-exclude)');
  assert.equal(inboxOn({ ...app, options: { decisions: false } }, { history: true, records: {} }), false, 'a viewer of a list that keeps no decisions has nothing to act on (must-exclude)');
  assert.equal(inboxOn(app, { history: false, records: {} }), false);
});

test('records: your open items and the ones due in 3 days or overdue, with closed and keyless rows left out', () => {
  const { groups, count, fresh } = inboxGroups({ mine: MINE, unowned: UNOWNED, meta: META, lastVisit: VISIT, today: TODAY });
  assert.deepEqual(groups.assigned.map((i) => [i.key, i.fresh]), [['R003', false], ['R004', true], ['R005', false]], 'a closed record and a row with no key are left out (must-exclude)');
  assert.deepEqual(groups.due.map((i) => [i.key, i.unowned]), [['R003', false], ['R008', true], ['R007', true], ['R004', false]],
    'a record somebody owns, a closed one and one already listed as yours are left out (must-exclude)');
  assert.equal(groups.assigned[0].status, 'In progress');
  assert.equal(groups.assigned[1].status, 'New', 'the status reads through the shared helper');
  assert.equal(count, 5, 'a record both assigned and due counts once: R003, R004, R005, R007, R008');
  assert.equal(fresh, 2);
  assert.ok(!Object.hasOwn(groups, 'changed'), 'a record someone else changed needs no action from you, so it is not in the inbox (must-exclude)');
});

test('Fix this, failed runs and reported issues join the inbox only when they wait for you', () => {
  assert.deepEqual(failedRuns(RUN_LIST).map((r) => r.run_id), ['j8', 'j6'], 'a run still going and a stopped one are not failures; a failure before the last finished run is over (must-exclude)');
  const base = { meta: META, lastVisit: VISIT, today: TODAY, records: false };
  const all = inboxGroups({ ...base, fix: 8, runs: RUNS, reports: REPORTS });
  assert.deepEqual(all.groups.fix.map((i) => i.label), ['8 records to fix']);
  assert.deepEqual(all.groups.runs.map((i) => i.run), ['j8', 'j6']);
  assert.match(all.groups.runs[0].label, /^The run of Oct 23, .* failed$/);
  assert.equal(all.groups.runs[0].sub, 'A table this use case reads is missing');
  assert.deepEqual(all.groups.reports.map((i) => i.key), ['report:f1', 'report:f4'], 'a report already turned into a vibe or closed waits for nobody (must-exclude)');
  assert.equal(all.count, 5);
  assert.deepEqual(all.on, { fix: true, runs: true, reports: true, assigned: false, due: false });
  const none = inboxGroups({ ...base, fix: 0, runs: { ...RUNS, can_run: false }, reports: { ...REPORTS, everyone: false } });
  assert.deepEqual([none.groups.fix, none.groups.runs, none.groups.reports, none.count], [[], [], [], 0],
    'nothing to fix, runs you cannot start again and your own reports need no action from you (must-exclude)');
  assert.deepEqual(none.on, { fix: true, runs: false, reports: false, assigned: false, due: false });
  const long = inboxGroups({ ...base, reports: { ...REPORTS, items: [report('f9', 'new', 'x'.repeat(300))] } });
  assert.equal([...long.groups.reports[0].label].length, 120);
});

const LIST = { visible: true, tracked: true, money: true, categories: [], served: 'delta', total: 2, truncated: false, runs: null, weeks: [],
  items: [{ key: 'R101', label: 'Item 101', tier: 'Act now', money: 900, why: null, owner: null, status: null, reason: 'Discount too deep', due: null },
    { key: 'R102', label: 'Item 102', tier: 'Act now', money: 400, why: null, owner: null, status: null, reason: 'Discount too deep', due: null }],
  done: { fixed: 0, fixed_q: 0, dismissed: 0, dismissed_q: 0, saved_n: 0, saved: 0, saved_q_n: 0, saved_q: 0, first_fixed: null, first_saved: null } };
const HUB = { today: TODAY, quarter: '2026-10-01', since: '2026-08-03', errors: {}, pages: { n01_u05: LIST } };
const TIER_FILTERS = { ...FILTERS, columns: { list: [{ column: 'priority_tier', label: 'Priority', type: 'multi_select', options: ['Act now', 'Review', 'Monitor'] }] } };

function inboxRoutes(seen, { runs = RUNS, reports = REPORTS } = {}) {
  const { routes } = tracked({
    records: lister((body) => {
      seen.push(body);
      if (body.mine) return MINE;
      if (body.unowned) return UNOWNED;
      return [];
    }, { actions: true, changes: true, window: { window: 'all', limit: null, today: TODAY } }),
  });
  return { ...routes, overview: ({ json }) => json(200, HUB), filters: ({ json }) => json(200, TIER_FILTERS), runs: ({ json }) => json(200, runs),
    feedback: ({ json }) => { seen.push({ feedback: true }); return json(200, reports); } };
}

async function openAt({ owner = true, hash = '#/n01_u05/inbox', width = 1440, scheme = 'light', runs, reports } = {}) {
  const asks = [];
  const info = appInfo(DECIDE, 1, TABLE);
  info.pages[0].is_owner = owner;
  const opened = await openApp(browser, served.base, info, { hash, width, scheme, routes: inboxRoutes(asks, { runs, reports }), ready: '[data-rail="inbox"]',
    watch: prefsFirst(MY_KEY, PERSON, { seen: { n01_u05: VISIT } }) });
  return { ...opened, asks };
}

const groupsOf = (page) => page.locator('[data-inbox-panel] [data-inbox-group]').evaluateAll((gs) => gs.map((g) => [g.dataset.inboxGroup,
  [...g.querySelectorAll('[data-inbox-item]')].map((i) => i.dataset.inboxItem)]));

test('an owner sees one inbox in the rail with its count: Fix this, failed runs, new reports and records, and nothing that needs no action', async () => {
  const { page, seen, context, asks } = await openAt();
  const rail = page.locator('[data-rail="inbox"]');
  await rail.locator('[data-count="10"]').waitFor();
  assert.equal(await rail.getAttribute('aria-label'), 'Inbox (10)');
  assert.equal(await rail.getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('[data-inbox]').count(), 0, 'the top bar keeps no second inbox');
  await page.locator('[data-inbox-panel][aria-busy="false"]').waitFor();
  assert.deepEqual(await groupsOf(page), [['fix', ['fix']], ['runs', ['run:j8', 'run:j6']], ['reports', ['report:f1', 'report:f4']],
    ['assigned', ['R003', 'R004', 'R005']], ['due', ['R003', 'R008', 'R007', 'R004']]]);
  const text = await page.locator('[data-inbox-panel]').innerText();
  for (const gone of ['R006', 'Add a column for the store', 'Old complaint', 'Oct 19', 'Oct 22', 'R010', 'R009']) {
    assert.ok(!text.includes(gone), `${gone} needs no action, so it is not in the inbox (must-exclude)`);
  }
  assert.ok(asks.some((b) => b.unowned === true && b.due_within === DUE_DAYS) && asks.some((b) => b.feedback));
  assert.ok(!asks.some((b) => b.changed && b.limit !== 1), 'the inbox reads one changed row only to learn whether the list keeps actions, never the records other people changed');
  assert.equal(await page.locator('[data-inbox-item="report:f4"] bdi[dir="auto"]').first().innerText(), 'طلب تغيير عمود المتجر');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('each inbox item opens the page where it gets dealt with', async () => {
  const { page, seen, context } = await openAt();
  await page.locator('[data-inbox-panel][aria-busy="false"]').waitFor();
  await page.locator('[data-inbox-item="fix"]').click();
  await page.waitForFunction(() => window.location.hash.startsWith('#/n01_u05/work') && window.location.hash.includes('tab=open'));
  await until(() => JSON.stringify(seen.records.at(-1)?.column_filters || {}).includes('Act now'));
  await page.locator('[data-rail="inbox"]').click();
  await page.locator('[data-inbox-item="run:j6"]').click();
  await page.waitForFunction(() => window.location.hash.startsWith('#/n01_u05/runs'));
  const toggle = page.locator('button.runs-tog[aria-expanded="true"]');
  await toggle.waitFor();
  assert.equal(await toggle.count(), 1, 'only the failed run picked in the inbox is open');
  assert.match(await toggle.getAttribute('aria-label'), /Oct 21/);
  await page.locator('.run-err').getByText('A table this use case reads is missing').waitFor();
  await page.locator('[data-rail="inbox"]').click();
  await page.locator('[data-inbox-item="report:f1"]').click();
  await page.waitForFunction(() => window.location.hash.startsWith('#/n01_u05/settings'));
  await page.locator('[data-feedback-item="f1"]').waitFor();
  await page.locator('[data-rail="inbox"]').click();
  await page.locator('[data-inbox-group="due"] [data-inbox-item="R003"]').click();
  await page.waitForFunction(() => window.location.hash.startsWith('#/n01_u05/work') && window.location.hash.includes('rec=R003'));
  await page.locator('[data-dock="record"] dialog.drawer').waitFor();
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('someone who does not own the use case sees no failed run and no report of other people, even when the App holds them (must-exclude)', async () => {
  const { page, seen, context, asks } = await openAt({ owner: false, runs: { ...RUNS, can_run: false }, reports: { ...REPORTS, everyone: false } });
  await page.locator('[data-rail="inbox"] [data-count="4"]').waitFor();
  await page.locator('[data-inbox-panel][aria-busy="false"]').waitFor();
  assert.deepEqual(await groupsOf(page), [['fix', ['fix']], ['assigned', ['R003', 'R004', 'R005']], ['due', ['R003', 'R004']]]);
  assert.ok(!asks.some((b) => b.feedback || b.unowned), 'nor does it ask for them');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the inbox fits 1280 and 1440 with no sideways scroll, in light, dark and right to left, and its items show a focus ring', async () => {
  for (const [width, scheme, rtl] of [[1280, 'light', false], [1440, 'dark', false], [1280, 'dark', true]]) {
    const { page, seen, context } = await openAt({ width, scheme });
    await page.locator('[data-inbox-panel][aria-busy="false"]').waitFor();
    if (rtl) await page.evaluate(() => document.documentElement.setAttribute('dir', 'rtl'));
    const wide = await page.evaluate(() => [...document.querySelectorAll('.main, [data-inbox-panel], html')].map((el) => el.scrollWidth - el.clientWidth));
    assert.ok(wide.every((d) => d <= 1), `${width} ${scheme}${rtl ? ' rtl' : ''}: no sideways scroll (${wide})`);
    const names = await page.locator('[data-inbox-item]').evaluateAll((all) => all.map((b) => b.innerText.trim()));
    assert.ok(names.every(Boolean), 'every item has a name');
    await page.locator('[data-inbox-item]').first().focus();
    await page.keyboard.press('Tab');
    const ring = await page.evaluate(() => { const s = getComputedStyle(document.activeElement); return [document.activeElement.dataset.inboxItem, s.outlineStyle, s.outlineWidth]; });
    assert.ok(ring[0], 'Tab moves to the next inbox item');
    assert.notEqual(ring[1], 'none');
    assert.notEqual(ring[2], '0px');
    const contrast = await page.locator('[data-inbox-item="R003"] small').first().evaluate((el) => getComputedStyle(el).color !== getComputedStyle(el.closest('.card')).backgroundColor);
    assert.ok(contrast);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});
