import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { DECIDE, FILTERS, PERSON, TABLE, appInfo, openApp, prefsFirst, serveDist, toastSays, until } from './harness.mjs';
import { canonicalHash, fixThis, parseHash, sectionHash, staleSection, tabCount } from '../src/links.js';
import { switcherMatches } from '../src/hub.js';
import { MY_KEY } from '../src/prefs.js';
import { evaluated } from './exampleRoutes.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const HERE = new URL('.', import.meta.url).pathname;
const PAGES = [{ id: 'a', queue: true }, { id: 'b', queue: false }];
const QUEUE_RAIL = ['dashboard', 'work', 'performance', 'runs', 'alerts', 'settings'];
const LAID_RAIL = ['dashboard', 'performance', 'runs', 'settings'];
const railFor = (p) => (p.queue ? QUEUE_RAIL : LAID_RAIL);
const withoutPerformance = (p) => railFor(p).filter((s) => s !== 'performance');
const canon = (hash, extra = {}) => canonicalHash(hash, { pages: PAGES, last: '', sectionsOf: railFor, ...extra });
const hashOf = (page) => page.evaluate(() => window.location.hash);
const railOf = (page) => page.locator('[data-rail]').evaluateAll((items) => items.map((i) => [i.dataset.rail, i.getAttribute('aria-current') || '']));
const RUNS = { updated: '2026-10-20T06:00:00Z', as_of: '2026-10-20', cadence_days: 7, next: '2026-10-27', stale: false, count: 6, failed: false };
const TRACKED = {
  visible: true, tracked: true, money: true, categories: ['ai_cat_driver'], served: 'delta', total: 2, truncated: false, runs: RUNS, weeks: [],
  items: [{ key: 'R001', label: 'Item number 1', tier: 'Act now', money: 900, why: null, owner: null, status: null, reason: 'Discount too deep', due: null },
    { key: 'R002', label: 'Item number 2', tier: 'Review', money: 400, why: null, owner: null, status: null, reason: 'Price below cost', due: null }],
  done: { fixed: 0, fixed_q: 0, dismissed: 0, dismissed_q: 0, saved_n: 0, saved: 0, saved_q_n: 0, saved_q: 0, first_fixed: null, first_saved: null },
};
const CATEGORIES = { ai_cat_driver: { meaning: 'why the item is on the list', values: ['Discount too deep', 'Price below cost'] } };
const HUB = { today: '2026-10-24', quarter: '2026-10-01', since: '2026-08-03', errors: {}, pages: { n01_u05: TRACKED } };
const SUMMARY = { run: { summary: null, nothing_to_act: null, decision_basis: 'measured', currency: 'USD', as_of_date: '2026-10-20' }, categories: CATEGORIES, note: '' };
const TIER_FILTERS = { ...FILTERS, columns: { list: [{ column: 'priority_tier', label: 'Priority', type: 'multi_select', options: ['Act now', 'Review', 'Monitor'] }] } };
const COUNTS = { statuses: { New: 7, 'In progress': 3, Done: 4, Dismissed: 1, 'Could not fix': 0 }, mine: 2, all: 15 };

function trackedRoutes(extra = {}) {
  return {
    overview: ({ json }) => json(200, HUB),
    summary: ({ json }) => json(200, SUMMARY),
    filters: ({ json }) => json(200, TIER_FILTERS),
    records: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      seen.records.push(body);
      const rows = [1, 2, 3].map((i) => ({ entity_id: `R00${i}`, record_key: `R00${i}`, _inspire_key: `R00${i}`, _inspire_version: String(100 + i),
        entity_label: `Item number ${i}`, priority_tier: 'Act now', rank: i, category: 'Books', recommended_action: 'Cut the standing discount to 10%' }));
      return json(200, { rows, total: rows.length, offset: 0, limit: body.limit || 25, actions: true, changes: false, summary: null, errors: {},
        ...(body.status_counts ? { status_counts: COUNTS } : {}) });
    },
    ...extra,
  };
}

test('old links and unknown sections settle on one canonical section address', () => {
  assert.equal(canon(''), '#/a/dashboard', 'no hash opens the dashboard of the first use case');
  assert.equal(canon('#/'), '#/a/dashboard');
  assert.equal(canon('#/home'), '#/a/dashboard');
  assert.equal(canon('#/overview'), '#/a/dashboard');
  assert.equal(canon('', { last: 'b' }), '#/b/dashboard', 'the last used use case wins');
  assert.equal(canon('', { last: 'gone' }), '#/a/dashboard', 'a last used use case that left the App falls back to the first');
  assert.equal(canon('#/a'), '#/a/dashboard');
  assert.equal(canon('#/a?rec=R1'), '#/a/work?rec=R1', 'a record link on a queue opens Work');
  assert.equal(canon('#/b?rec=R1'), '#/b/dashboard?rec=R1', 'a record link on a laid-out page stays on its dashboard');
  assert.equal(canon('#/a?changed=1'), '#/a/work?changed=1');
  assert.equal(canon('#/a?v=runs'), '#/a/runs', 'a legacy view parameter becomes its section');
  assert.equal(canon('#/a?v=overview&f=x'), '#/a/dashboard?f=x');
  assert.equal(canon('#/a/nope'), '#/a/dashboard');
  assert.equal(canon('#/b/work'), '#/b/dashboard', 'only a queue has Work');
  assert.equal(canon('#/a/dashboard?tab=done'), '#/a/dashboard', 'a tab only belongs to Work');
  assert.equal(canon('#/a/performance', { sectionsOf: withoutPerformance }), '#/a/dashboard');
  assert.equal(canon('#/b/alerts'), '#/b/dashboard', 'a section the use case does not have opens its dashboard');
  assert.equal(canon('#/b?v=alerts'), '#/b/dashboard');
  assert.equal(canon('#/mywork'), '#/a/performance');
  assert.equal(canon('#/impact'), '#/a/performance');
  assert.equal(canon('#/mywork', { sectionsOf: withoutPerformance }), '#/a/work?tab=mine');
  assert.equal(canon('#/impact', { sectionsOf: withoutPerformance }), '#/a/dashboard');
  assert.equal(canon('#/mywork', { last: 'b', sectionsOf: withoutPerformance }), '#/b/dashboard', 'My work on a laid-out page with no Work opens the dashboard');
  assert.equal(canon('#/nope'), '#/a/dashboard', 'an unknown use case opens the dashboard of the first');
  for (const kept of ['#/a/dashboard', '#/a/work?tab=done', '#/a/runs', '#/a/settings', '#/b/dashboard', '#/admin']) {
    assert.equal(canon(kept), null, `${kept} is already canonical`);
  }
  assert.equal(canonicalHash('#/x', { pages: [] }), null, 'an App with no use case keeps its address');
  const parsed = parseHash('#/a/work?tab=mine&rec=R9');
  assert.deepEqual([parsed.route, parsed.section, parsed.tab, parsed.rec], ['a', 'work', 'mine', 'R9']);
  assert.equal(sectionHash('a b', 'runs'), '#/a%20b/runs');
  assert.equal(staleSection('#/a?v=trend', '#/a/dashboard'), true, 'a removed view says the link no longer applies');
  assert.equal(staleSection('#/b/alerts', '#/b/dashboard'), true);
  assert.equal(staleSection('#/a?v=overview', '#/a/dashboard'), false, 'the old Overview view maps to the dashboard without a notice');
  assert.equal(staleSection('#/a?v=runs', '#/a/runs'), false);
  assert.equal(staleSection('#/a?rec=R1', '#/a/work?rec=R1'), false, 'no section asked, so nothing is stale');
  assert.equal(staleSection('#/mywork', '#/a/performance'), false, 'an App-wide address is not a section');
});

test('Fix this narrows Work to the shown tiers and the reason, sorts by money when asked, and opens Mine for my view', () => {
  const page = { records: { tier: 'priority_tier', columns: [{ column: 'value_at_stake' }] } };
  const list = [{ column: 'priority_tier', type: 'multi_select', options: ['Act now', 'Review', 'Monitor'] }];
  const state = { range: { run_date: '12m' }, sel: {} };
  const plain = fixThis(page, list, state, { owner: 'all', show: 'act' }, {});
  assert.equal(plain.tab, 'new');
  assert.deepEqual(plain.state.range, state.range, 'the page filters stay');
  assert.ok(JSON.stringify(plain.state.columns).includes('Act now'), 'the tier filter is set to the tiers the tiles count');
  assert.ok(!JSON.stringify(plain.state.columns).includes('Monitor'), 'a tier the tiles do not count stays out');
  assert.equal(plain.sort, null);
  const money = fixThis(page, list, state, { owner: 'me', show: 'act' }, { money: true, reason: { name: 'ai_cat_driver', value: 'Price below cost' } });
  assert.equal(money.tab, 'mine');
  assert.deepEqual(money.sort, { key: 'value_at_stake', dir: 'desc' });
  assert.deepEqual(money.state.ai, { ai_cat_driver: ['Price below cost'] });
  const untiered = fixThis({ records: {} }, list, state, {}, { money: true });
  assert.deepEqual(untiered.state, state, 'a list with no tier column keeps the filters as they were');
  assert.equal(untiered.sort, null, 'no money column means no money sort');
  const unlisted = fixThis(page, [{ column: 'priority_tier', type: 'text' }], state, {}, {});
  assert.deepEqual(unlisted.state, state, 'a tier column without a pick list is not filtered');
});

test('the switcher finds a use case by any of its words, and tab counts read the server totals', () => {
  const pages = [{ id: 'p1', title: 'Price loss', use_case_id: 'N01-U05', domain: 'Pricing' }, { id: 'p2', title: 'Duplicate invoices', domain: 'Finance' }];
  assert.deepEqual(switcherMatches(pages, '').map((p) => p.id), ['p1', 'p2']);
  assert.deepEqual(switcherMatches(pages, 'n01').map((p) => p.id), ['p1']);
  assert.deepEqual(switcherMatches(pages, 'finance invoices').map((p) => p.id), ['p2']);
  assert.deepEqual(switcherMatches(pages, 'price finance'), [], 'every word must match');
  assert.equal(tabCount(null, 'new'), null);
  assert.equal(tabCount(COUNTS, 'new'), 7);
  assert.equal(tabCount(COUNTS, 'not-an-issue'), 1);
  assert.equal(tabCount(COUNTS, 'could-not-fix'), 0);
  assert.equal(tabCount(COUNTS, 'mine'), 2);
  assert.equal(tabCount(COUNTS, 'all'), 15);
});

test('the top bar holds only the logo, the switcher, Ask Genie and the avatar, and the rail lists the sections of the use case', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo({}, 3), {});
  assert.equal(await hashOf(page), '#/n01_u05/dashboard');
  assert.deepEqual(await page.locator('header.top > *').evaluateAll((els) => els.map((e) => e.className.split(' ')[0]).filter((c) => c !== 'avatar')),
    ['ibtn', 'mark', 'switch', 'sp', 'genie-btn'], 'no other tool sits in the top bar');
  assert.deepEqual(await railOf(page), [['dashboard', 'page'], ['work', ''], ['performance', ''], ['runs', ''], ['settings', '']]);
  await page.locator('[data-rail="runs"]').click();
  await page.waitForFunction(() => window.location.hash === '#/n01_u05/runs');
  assert.equal(await page.locator('[data-rail="runs"]').getAttribute('aria-current'), 'page');
  assert.equal(await page.locator('.ph-sec').innerText(), 'RUNS');
  await page.locator('[data-switcher]').click();
  const find = page.getByRole('combobox', { name: 'Find a use case' });
  await find.waitFor();
  assert.equal(await page.locator('[data-case]').count(), 3);
  await find.fill('zzz');
  await page.getByText('No use case matches').waitFor();
  await find.fill('');
  await find.press('ArrowDown');
  await find.press('Enter');
  await page.waitForFunction(() => window.location.hash === '#/n02_u01/dashboard');
  assert.equal(await page.locator('[data-switcher] .switch-t b').innerText(), await page.locator('.ph h1').innerText());
  await page.waitForFunction((key) => Object.values(JSON.parse(localStorage.getItem(key) || '{}'))[0]?.last === 'n02_u01', MY_KEY);
  await page.goto(`${served.base}#/`);
  await page.waitForFunction(() => window.location.hash === '#/n02_u01/dashboard');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a one use case App has a switcher that does not open, and an unknown use case says so and opens the dashboard', async () => {
  const one = await openApp(browser, served.base, appInfo(), { hash: '#/nope' });
  await toastSays(one.page, 'This link points to a use case that is not in this App');
  assert.equal(await hashOf(one.page), '#/n01_u05/dashboard');
  assert.ok(await one.page.locator('[data-switcher]').isDisabled());
  assert.deepEqual(one.seen.errors, []);
  await one.context.close();
});

test('old record, My work and Impact links open their new sections in the browser', async () => {
  const rec = await openApp(browser, served.base, appInfo(), { hash: '#/n01_u05?rec=R001', ready: '[data-work]' });
  assert.match(await hashOf(rec.page), /^#\/n01_u05\/work\?.*rec=R001/);
  await rec.page.locator('[data-dock="record"] dialog.drawer').waitFor();
  assert.match(await rec.page.locator('[data-dock="record"] dialog.drawer').innerText(), /Item number 1/);
  assert.deepEqual(rec.seen.errors, []);
  await rec.context.close();
  for (const old of ['#/mywork', '#/impact', '#/results']) {
    const hub = await openApp(browser, served.base, appInfo({}, 2), { hash: old, ready: '[data-performance]' });
    assert.equal(await hashOf(hub.page), '#/n01_u05/performance', `${old} opens Performance`);
    assert.equal(await hub.page.locator('[data-rail="performance"]').getAttribute('aria-current'), 'page');
    assert.deepEqual(hub.seen.errors, []);
    await hub.context.close();
  }
  const admin = await openApp(browser, served.base, appInfo({ admin: PERSON }), { hash: '#/admin', ready: '.main' });
  assert.equal(await hashOf(admin.page), '#/admin', 'Admin keeps its own address');
  await admin.context.close();
});

test('Work shows status tabs with their counts, each tab asks for its status, and Mine and All ask for no status', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { hash: '#/n01_u05/work', routes: trackedRoutes(), ready: '[data-tab]' });
  await page.waitForFunction(() => document.querySelector('[data-tab="new"] [data-count]')?.textContent === '7');
  assert.deepEqual(await page.locator('[data-tab]').evaluateAll((tabs) => tabs.map((t) => [t.dataset.tab, t.querySelector('[data-count]')?.textContent || '',
    t.getAttribute('aria-selected')])), [['new', '7', 'true'], ['in-progress', '3', 'false'], ['done', '4', 'false'], ['not-an-issue', '1', 'false'],
    ['could-not-fix', '0', 'false'], ['mine', '2', 'false'], ['all', '15', 'false']]);
  const last = () => seen.records.at(-1);
  assert.deepEqual(last().column_filters, { action_status: ['New'] });
  assert.equal(last().status_counts, true);
  assert.equal(last().mine, false);
  await page.locator('[data-tab="done"]').click();
  await page.waitForFunction(() => window.location.hash.includes('tab=done'));
  await until(() => last().column_filters?.action_status?.[0] === 'Done');
  await page.locator('[data-tab="mine"]').click();
  await until(() => last().mine === true && !last().column_filters?.action_status);
  await page.locator('[data-tab="all"]').click();
  await until(() => last().mine === false && !last().column_filters?.action_status);
  assert.equal(await page.locator('[data-tab="all"]').getAttribute('aria-selected'), 'true');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Fix this on the To fix tile and on a reason bar opens Work on the New tab with the tiers and the reason picked', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: trackedRoutes(), ready: '[data-fix]' });
  await page.locator('[data-fix="fix"]').click();
  await page.waitForFunction(() => window.location.hash.startsWith('#/n01_u05/work') && window.location.hash.includes('tab=new'));
  await until(() => JSON.stringify(seen.records.at(-1)?.column_filters || {}).includes('Act now'));
  assert.equal(seen.records.at(-1).column_filters.action_status[0], 'New');
  await page.locator('[data-rail="dashboard"]').click();
  await page.locator('[data-fix-reason]').first().waitFor();
  const reason = await page.locator('[data-fix-reason]').first().getAttribute('data-fix-reason');
  await page.locator('[data-fix-reason]').first().click();
  await page.waitForFunction(() => window.location.hash.startsWith('#/n01_u05/work'));
  await until(() => (seen.records.at(-1)?.ai?.ai_cat_driver || [])[0] === reason);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Work dock switches between the record and Genie, and remembers the choice', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo(), { hash: '#/n01_u05/work', ready: '.cell-t' });
  assert.equal(await page.locator('[data-dock]').count(), 0, 'the dock starts closed');
  await page.locator('.cell-t').first().click();
  const drawer = page.locator('[data-dock="record"] dialog.drawer');
  await drawer.waitFor();
  assert.equal(await page.locator('dialog.drawer:modal').count(), 0, 'a docked record does not cover the list');
  await page.locator('[data-dock-tab="genie"]').click();
  await page.locator('aside.genie [data-dock-tab="genie"][aria-selected="true"]').waitFor();
  assert.equal(await page.locator('[data-dock="record"]').count(), 0);
  const stored = () => page.evaluate((key) => Object.values(JSON.parse(localStorage.getItem(key) || '{}'))[0]?.dock, MY_KEY);
  assert.equal(await stored(), 'genie');
  await page.locator('[data-dock-tab="record"]').click();
  await drawer.waitFor();
  assert.equal(await stored(), 'record');
  await page.reload();
  await page.locator('[data-dock="record"] [data-dock-empty]').waitFor();
  await page.locator('[data-dock="record"] [data-dock-empty] .lnk').click();
  await page.waitForFunction(() => !document.querySelector('[data-dock]'));
  assert.equal(await stored(), '');
  await page.locator('[data-rail="dashboard"]').click();
  await page.locator('.genie-btn').click();
  await page.locator('aside.genie').waitFor();
  assert.equal(await page.locator('[data-dock-tab]').count(), 0, 'outside Work Genie opens on its own, with no dock tabs');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('every example layout renders its dashboard, rail and settings with no error', async () => {
  const examples = readdirSync(join(HERE, '..', '..', 'examples')).filter((f) => f.endsWith('.json')).sort();
  assert.equal(examples.length, 13);
  for (const file of examples) {
    const info = appInfo(DECIDE, 1, {}, `examples/${file}`);
    const { page, seen, context } = await openApp(browser, served.base, info, { ready: '.ph h1', watch: prefsFirst(MY_KEY, PERSON, {}),
      routes: { 'scenario/evaluate': ({ route, json }) => json(200, evaluated(route.request().postDataJSON().values || {})) } });
    const rail = (await railOf(page)).map(([id]) => id);
    assert.equal(rail[0], 'dashboard', `${file}: the rail starts with Dashboard`);
    assert.equal(rail.at(-1), 'settings', `${file}: Settings sits at the bottom`);
    assert.ok(!rail.includes('work'), `${file}: a laid-out page keeps its list on the dashboard, so it has no Work`);
    await page.locator('[data-rail="settings"]').click();
    await page.locator('[data-group="look"]').waitFor();
    assert.deepEqual(seen.errors, [], `${file}: no error`);
    await context.close();
  }
});
