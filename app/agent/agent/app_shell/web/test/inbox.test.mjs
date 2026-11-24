import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, FILTERS, PERSON, TABLE, appInfo, lister, openApp, prefsFirst, serveDist, tracked, until } from './harness.mjs';
import { MY_KEY } from '../src/prefs.js';
import { DUE_DAYS, failedRuns, inboxAsks, inboxGroups, inboxOn } from '../src/inbox.js';

// REQ-506: no side rail; a section opens by its hash.
const goSection = (page, section) => page.evaluate((s) => { location.hash = `#/${location.hash.split('/')[1]}/${s}`; }, section);
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
const CHANGED = [
  row('R006', { _inspire_due: '2026-10-21', _inspire_status: 'Done', _inspire_version: at(VISIT + 120000) }),
  row('R004', { _inspire_due: '2026-10-26', _inspire_version: at(VISIT + 120000) }),
  row('R011', { _inspire_status: 'In progress', _inspire_owner: 'sam.roe', _inspire_version: at(VISIT + 60000) }),
  row('R012', { _inspire_version: at(VISIT - 60000) }),
  { entity_label: 'No key either', _inspire_version: at(VISIT + 120000) },
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

test('the inbox first asks with no window for what changed, which also says whether the list keeps actions, then for your open records, and for the ones nobody owns when you own the use case', () => {
  const mine = { page: 'p1', filters: {}, mine: true, window: 'all', limit: 50 };
  const changed = { page: 'p1', filters: {}, changed: true, limit: 50 };
  assert.deepEqual(inboxAsks({ id: 'p1' }), { changed, mine }, 'someone who does not own the use case never asks for the records nobody owns (must-exclude)');
  assert.deepEqual(inboxAsks({ id: 'p1', is_owner: true }), { changed, mine, unowned: { page: 'p1', filters: {}, unowned: true, window: 'all', due_within: DUE_DAYS, limit: 50 } });
  const app = { options: { decisions: true }, user: { email: PERSON } };
  assert.equal(inboxOn(app, { history: true, records: {} }), true);
  assert.equal(inboxOn({ ...app, options: { decisions: false } }, { history: true, records: {}, is_owner: true }), true, 'an owner has failed runs and reports to see');
  assert.equal(inboxOn({ ...app, user: {} }, { history: true, records: {}, is_owner: true }), false, 'nobody signed in has no inbox (must-exclude)');
  assert.equal(inboxOn({ ...app, options: { decisions: false } }, { history: true, records: {} }), false, 'a viewer of a list that keeps no decisions has nothing to act on (must-exclude)');
  assert.equal(inboxOn(app, { history: false, records: {} }), false);
});

test('records: your open items and the ones due in 3 days or overdue, with closed and keyless rows left out', () => {
  const { groups, count, fresh } = inboxGroups({ changed: CHANGED, mine: MINE, unowned: UNOWNED, meta: META, lastVisit: VISIT, today: TODAY });
  assert.deepEqual(groups.assigned.map((i) => [i.key, i.fresh]), [['R003', false], ['R004', true], ['R005', false]], 'a closed record and a row with no key are left out (must-exclude)');
  assert.deepEqual(groups.due.map((i) => [i.key, i.unowned]), [['R003', false], ['R008', true], ['R007', true], ['R004', false]],
    'a record somebody owns, a closed one and one already listed as yours are left out (must-exclude)');
  assert.equal(groups.assigned[0].status, 'In progress');
  assert.equal(groups.assigned[1].status, 'New', 'the status reads through the shared helper');
  assert.equal(count, 5, 'a record both assigned and due counts once: R003, R004, R005, R007, R008');
  assert.equal(fresh, 2);
  assert.deepEqual(groups.changed.map((i) => [i.key, i.info]), [['R006', true], ['R011', true]],
    'what changed since your visit is listed for your information; one changed before it, one already in your groups and one with no key are left out (must-exclude)');
  assert.equal(count, 5, 'a changed record needs nothing from you, so the count leaves it out (must-exclude)');
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
  assert.deepEqual(all.on, { fix: true, runs: true, reports: true, assigned: false, due: false, changed: false });
  const none = inboxGroups({ ...base, fix: 0, runs: { ...RUNS, can_run: false }, reports: { ...REPORTS, everyone: false } });
  assert.deepEqual([none.groups.fix, none.groups.runs, none.groups.reports, none.count], [[], [], [], 0],
    'nothing to fix, runs you cannot start again and your own reports need no action from you (must-exclude)');
  assert.deepEqual(none.on, { fix: true, runs: false, reports: false, assigned: false, due: false, changed: false });
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
      if (body.changed) return CHANGED;
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

