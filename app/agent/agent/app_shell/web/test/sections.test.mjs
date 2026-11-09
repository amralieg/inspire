import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { DECIDE, FILTERS, HISTORY, LABEL, OWN_STATUSES, PERSON, TABLE, appInfo, openApp, prefsFirst, serveDist, toastSays, tracked, until } from './harness.mjs';
import { canonicalHash, fixThis, parseHash, restoreFilters, sectionHash, staleSection, tabCount } from '../src/links.js';
import { FIX_TIERS, isToFix, shownTiers, switcherMatches } from '../src/hub.js';
import { MY_KEY } from '../src/prefs.js';
import { evaluated } from './exampleRoutes.mjs';
import { reviewRoutes, versionRoutes } from './planRoutes.mjs';
import { hasWork, pageMode } from '../src/modes.js';

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
const COUNTS = { statuses: { New: 7, 'In progress': 3, Done: 4, Dismissed: 1, 'Could not fix': 0 },
  choices: { new: 7, 'in-progress': 3, done: 4, 'not-an-issue': 1, 'could-not-fix': 0 }, open: 10, mine: 2, all: 15 };

function trackedRoutes(extra = {}, counts = COUNTS) {
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
        ...(body.status_counts ? { status_counts: counts } : {}) });
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
  assert.equal(canon('#/a/work?tab=xyz'), '#/a/work?tab=open', 'a tab the use case does not have is rewritten to the Open tab');
  assert.equal(canon('#/a/work?tab=xyz&rec=R1'), '#/a/work?tab=open&rec=R1');
  const own = [{ id: 'a', queue: true, statuses: [{ id: 'keep', label: 'Keep', status: 'Done' }] }];
  assert.equal(canon('#/a/work?tab=keep', { pages: own }), null, 'a tab of the use case\u2019s own statuses stays');
  assert.equal(canon('#/a/work?tab=done', { pages: own }), '#/a/work?tab=open', 'a default tab the use case replaced with its own statuses is rewritten to the Open tab');
  assert.equal(canon('#/a/work?tab=mine', { pages: own }), null);
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
  const plain = fixThis(page, list, state, { owner: 'all', show: 'act' }, { tiers: FIX_TIERS });
  assert.equal(plain.tab, 'open');
  assert.deepEqual(plain.state.range, state.range, 'the page filters stay');
  assert.ok(JSON.stringify(plain.state.columns).includes('Act now'), 'the tier filter is set to the tiers the tiles count');
  assert.ok(!JSON.stringify(plain.state.columns).includes('Monitor'), 'a tier the tiles do not count stays out');
  assert.equal(plain.sort, null);
  const money = fixThis(page, list, state, { owner: 'me', show: 'act' }, { tiers: FIX_TIERS, money: true, reason: { name: 'ai_cat_driver', value: 'Price below cost' } });
  assert.equal(money.tab, 'mine');
  assert.deepEqual(money.sort, { key: 'value_at_stake', dir: 'desc' });
  assert.deepEqual(money.state.ai, { ai_cat_driver: ['Price below cost'] });
  const untiered = fixThis({ records: {} }, list, state, {}, { money: true });
  assert.deepEqual(untiered.state, state, 'a list with no tier column keeps the filters as they were');
  assert.equal(untiered.sort, null, 'no money column means no money sort');
  const unlisted = fixThis(page, [{ column: 'priority_tier', type: 'text' }], state, {}, { tiers: FIX_TIERS });
  assert.deepEqual(unlisted.state, state, 'a tier column without a pick list is not filtered');
  for (const [what, filter] of [['loads its choices on search', { options: [], searchable: true, lazy: true }],
    ['shows only its first choices', { options: ['Monitor'], searchable: true }]]) {
    const out = fixThis(page, [{ column: 'priority_tier', type: 'multi_select', ...filter }], state, { show: 'fix' }, { tiers: FIX_TIERS });
    assert.deepEqual(out.state.columns?.list?.priority_tier, ['Act now'], `a tier list that ${what} still narrows to Act now`);
  }
  const absent = fixThis(page, [{ column: 'priority_tier', type: 'multi_select', options: ['Review', 'Monitor'] }], state, { show: 'fix' }, {});
  assert.equal(absent.state.columns?.list?.priority_tier, undefined, 'a full tier list without Act now is not narrowed to it');
});

test('Fix this narrows Work to exactly the tiers its card counted, also when the tier choices load only on search', () => {
  const page = { records: { tier: 'priority_tier', columns: [] } };
  const state = { range: {}, sel: {} };
  const lazyList = [{ column: 'priority_tier', type: 'multi_select', options: [], searchable: true, lazy: true }];
  const tierOf = (next) => next.state.columns?.list?.priority_tier;
  assert.deepEqual(tierOf(fixThis(page, lazyList, state, { owner: 'all', show: 'fix' }, { tiers: FIX_TIERS })), ['Act now'],
    'a lazy tier filter has no choices yet, so the counted tiers are set as they are');
  assert.deepEqual(tierOf(fixThis(page, lazyList, state, { owner: 'all', show: 'all' }, { tiers: FIX_TIERS })), ['Act now'],
    'the To fix tile counts Act now only, so Show: worth a look does not widen its Fix this');
  assert.deepEqual(tierOf(fixThis(page, lazyList, state, { owner: 'all', show: 'all' }, { tiers: shownTiers('all') })), ['Act now', 'Review'],
    'a reason bar counts the shown tiers, so its Fix this keeps them');
  const known = [{ column: 'priority_tier', type: 'multi_select', options: ['Review', 'Monitor'] }];
  assert.equal(tierOf(fixThis(page, known, state, {}, { tiers: FIX_TIERS })), undefined, 'a loaded pick list without the tier sets no filter');
  assert.equal(tierOf(fixThis(page, lazyList, state, {}, { focus: 'overdue' })), undefined, 'a card that counted every open record sets no tier');
  const none = fixThis(page, lazyList, state, { owner: 'none', show: 'fix' }, { tiers: FIX_TIERS });
  assert.deepEqual([none.tab, none.focus], ['all', 'unassigned'], 'the tile counted records with no owner, so Work shows the open ones with no owner');
  assert.ok(FIX_TIERS.every((t) => isToFix({ tier: t })) && !isToFix({ tier: 'Review' }), 'the tile and Fix this read one tier list');
  const restored = restoreFilters({ c: { l: { priority_tier: ['Act now'] } } }, [], { list: lazyList });
  assert.equal(restored.dropped, false, 'a Fix this address with a lazy tier filter opens with the filter kept');
  assert.deepEqual(restored.state.columns.list.priority_tier, ['Act now']);
});

for (const width of [1280, 1440]) {
  test(`at ${width} px each Fix this on a reason bar sits at least 8 px inside its card`, async () => {
    const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { width, routes: trackedRoutes(), ready: '[data-fix-reason]' });
    const gaps = await page.locator('[data-fix-reason]').evaluateAll((links) => links.map((a) => {
      const card = a.closest('.card, .hcard, section').getBoundingClientRect();
      return Math.round(card.right - a.getBoundingClientRect().right);
    }));
    assert.ok(gaps.length > 0);
    assert.ok(gaps.every((g) => g >= 8), `gaps to the card edge: ${gaps.join(', ')}`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  });
}

test('at 1280 px with a record docked open every Work tab shows, none cut off', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, OWN_STATUSES),
    { width: 1280, height: 800, hash: '#/n01_u05/work', routes: { ...trackedRoutes(), ...tracked().routes, records: trackedRoutes().records }, ready: '.cell-t' });
  await page.locator('.cell-t').first().click();
  await page.locator('[data-dock="record"] dialog.drawer').waitFor();
  assert.ok(await page.locator('[data-tab]').count() >= 7);
  const cut = await page.locator('[data-tab]').evaluateAll((tabs) => {
    const strip = tabs[0].parentElement.getBoundingClientRect();
    return tabs.filter((t) => { const r = t.getBoundingClientRect(); return r.right > strip.right + 0.5 || r.left < strip.left - 0.5 || r.right > window.innerWidth; })
      .map((t) => t.dataset.tab);
  });
  assert.deepEqual(cut, []);
  assert.ok(await page.locator('[data-tab="all"]').isVisible());
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('What to do now counts the records in your window, so closed records outside it are not in the total', async () => {
  const records = ({ route, json, seen }) => {
    const body = route.request().postDataJSON();
    seen.records.push(body);
    const summary = body.window ? { open: 16, done: 8, resolved: 0, left: 0, owners: [] } : { open: 16, done: 32, resolved: 0, left: 0, owners: [] };
    return json(200, { rows: [], total: 16, offset: 0, limit: body.limit || 25, actions: true, changes: false, summary, errors: {}, ...(body.window ? { window: { window: body.window.window } } : {}) });
  };
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: { ...trackedRoutes(), records }, ready: '[data-todo-count]' });
  assert.equal(await page.locator('[data-todo-count]').innerText(), '16 of 24 waiting for you');
  assert.ok(seen.records.filter((r) => !r.changed).every((r) => r.window), 'every list the Dashboard asks for carries your window, except the changed-since-visit list the Inbox asks for');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('What to do now falls back to the whole list when the window is refused, so its count still shows', async () => {
  const base = trackedRoutes();
  const records = (ctx) => {
    const body = ctx.route.request().postDataJSON();
    ctx.seen.records.push(body);
    if (body.window) return ctx.json(409, { error: 'this decision list keeps no actions, so it has no window of actions to show', code: 'no_window' });
    return ctx.json(200, { rows: [], total: 4, offset: 0, limit: body.limit || 5, actions: false, changes: false, summary: null, errors: {} });
  };
  const { page, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: { ...base, records }, ready: '[data-section]' });
  await page.waitForSelector('[data-todo-count]', { timeout: 5000 });
  assert.match(await page.locator('[data-todo-count]').innerText(), /waiting for you/);
  await context.close();
});

test('the Open tab keeps your window: an overdue record ranked last shows first with the Overdue line, and All lists without a window', async () => {
  const records = ({ route, json, seen }) => {
    const body = route.request().postDataJSON();
    seen.records.push(body);
    const rows = [1, 2, 3].map((i) => ({ entity_id: `R00${i}`, record_key: `R00${i}`, _inspire_key: `R00${i}`, _inspire_version: String(100 + i),
      entity_label: `Item number ${i}`, priority_tier: 'Act now', rank: i, _inspire_status: 'New',
      ...(body.window ? { _inspire_due: i === 3 ? '2020-01-02' : '2999-01-01' } : {}) }));
    return json(200, { rows, total: 3, offset: 0, limit: body.limit || 25, actions: true, changes: false, summary: null, errors: {},
      ...(body.status_counts ? { status_counts: COUNTS } : {}) });
  };
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE),
    { hash: '#/n01_u05/work?tab=open', routes: { ...trackedRoutes(), records }, ready: '[data-overdue]' });
  assert.equal(seen.records.at(-1).window, 'all');
  assert.match(await page.locator('[data-overdue]').innerText(), /Overdue: 1 record on this page, shown first/);
  assert.match(await page.locator('.cell-t').first().innerText(), /Item number 3/);
  await page.locator('[data-tab="all"]').click();
  await until(() => seen.records.at(-1)?.window === undefined && !seen.records.at(-1)?.choice && seen.records.at(-1)?.mine === false);
  await page.locator('[data-tab="done"]').click();
  await until(() => seen.records.at(-1)?.choice === 'done');
  assert.equal(seen.records.at(-1).window, undefined, 'a closed status tab lists without a window');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

for (const [what, tier] of [['loads its choices on search', { options: [], searchable: true, lazy: true }],
  ['shows only its first choices', { options: ['Monitor'], searchable: true }]]) {
  test(`Fix this on a tier list that ${what} asks Work for Act now only`, async () => {
    const filters = { ...FILTERS, columns: { list: [{ column: 'priority_tier', label: 'Priority', type: 'multi_select', ...tier }] } };
    const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE),
      { routes: { ...trackedRoutes(), filters: ({ json }) => json(200, filters) }, ready: '[data-fix]' });
    await page.locator('[data-fix="fix"]').click();
    await page.waitForFunction(() => window.location.hash.startsWith('#/n01_u05/work'));
    await until(() => seen.records.some((r) => r.column_filters?.priority_tier));
    assert.deepEqual(seen.records.at(-1).column_filters.priority_tier, ['Act now']);
    assert.deepEqual(seen.errors, []);
    await context.close();
  });
}

test('the switcher finds a use case by any of its words, and tab counts read the server totals', () => {
  const pages = [{ id: 'p1', title: 'Price loss', use_case_id: 'N01-U05', domain: 'Pricing' }, { id: 'p2', title: 'Duplicate invoices', domain: 'Finance' }];
  assert.deepEqual(switcherMatches(pages, '').map((p) => p.id), ['p1', 'p2']);
  assert.deepEqual(switcherMatches(pages, 'n01').map((p) => p.id), ['p1']);
  assert.deepEqual(switcherMatches(pages, 'finance invoices').map((p) => p.id), ['p2']);
  assert.deepEqual(switcherMatches(pages, 'price finance'), [], 'every word must match');
  assert.equal(tabCount(null, 'new'), null);
  assert.equal(tabCount(COUNTS, 'open'), 10);
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
  await page.locator('[data-rail="runs"][aria-current="page"]').waitFor();
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
  await page.waitForFunction(() => { const h = document.querySelector('.ph h1')?.textContent; return !!h && h === document.querySelector('[data-switcher] .switch-t b')?.textContent; });
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
  await page.waitForFunction(() => document.querySelector('[data-tab="open"] [data-count]')?.textContent === '10');
  assert.deepEqual(await page.locator('[data-tab]').evaluateAll((tabs) => tabs.map((t) => [t.dataset.tab, t.querySelector('[data-count]')?.textContent || '',
    t.getAttribute('aria-selected')])), [['open', '10', 'true'], ['new', '7', 'false'], ['in-progress', '3', 'false'], ['done', '4', 'false'],
    ['not-an-issue', '1', 'false'], ['could-not-fix', '0', 'false'], ['mine', '2', 'false'], ['all', '15', 'false']]);
  const last = () => seen.records.at(-1);
  assert.deepEqual(last().column_filters, { action_status: ['New', 'In progress'] });
  assert.equal(last().choice, undefined);
  assert.equal(last().status_counts, true);
  assert.equal(last().mine, false);
  await page.locator('[data-tab="done"]').click();
  await page.waitForFunction(() => window.location.hash.includes('tab=done'));
  await until(() => last().choice === 'done' && !last().column_filters?.action_status);
  await page.locator('[data-tab="mine"]').click();
  await until(() => last().mine === true && !last().column_filters?.action_status && !last().choice);
  await page.locator('[data-tab="all"]').click();
  await until(() => last().mine === false && !last().column_filters?.action_status && !last().choice);
  assert.equal(await page.locator('[data-tab="all"]').getAttribute('aria-selected'), 'true');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a page with its own statuses gets one Work tab per choice with its count, and each tab asks for its choice', async () => {
  const counts = { statuses: { New: 2, 'In progress': 1, Done: 5, Dismissed: 1, 'Could not fix': 0 },
    choices: { reprice: 1, keep: 3, drop: 2, wrong: 1 }, open: 3, mine: 1, all: 9 };
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, OWN_STATUSES),
    { hash: '#/n01_u05/work', routes: trackedRoutes({}, counts), ready: '[data-tab]' });
  await page.waitForFunction(() => document.querySelector('[data-tab="open"] [data-count]')?.textContent === '3');
  assert.deepEqual(await page.locator('[data-tab]').evaluateAll((tabs) => tabs.map((t) => [t.dataset.tab, t.querySelector('[data-count]')?.textContent || ''])),
    [['open', '3'], ['reprice', '1'], ['keep', '3'], ['drop', '2'], ['wrong', '1'], ['mine', '1'], ['all', '9']]);
  assert.match(await page.locator('[data-tab="keep"]').innerText(), /Keep the price/);
  const last = () => seen.records.at(-1);
  assert.deepEqual(last().column_filters, { action_status: ['New', 'In progress'] });
  await page.locator('[data-tab="keep"]').click();
  await page.waitForFunction(() => window.location.hash.includes('tab=keep'));
  await until(() => last().choice === 'keep' && !last().column_filters?.action_status);
  await page.locator('[data-tab="wrong"]').click();
  await until(() => last().choice === 'wrong');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Fix this on the To fix tile and on a reason bar opens Work on the Open tab with the tiers and the reason picked', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes: trackedRoutes(), ready: '[data-fix]' });
  await page.locator('[data-fix="fix"]').click();
  await page.waitForFunction(() => window.location.hash.startsWith('#/n01_u05/work') && window.location.hash.includes('tab=open'));
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

test('the To fix tile and the Work list its Fix this opens show the same number of records when the tier filter loads its choices lazily', async () => {
  const tiers = ['Act now', 'Review', 'Monitor'];
  const all = Array.from({ length: 24 }, (_, i) => ({ key: `R${String(i + 1).padStart(3, '0')}`, tier: tiers[i % 3] }));
  const hub = { ...HUB, pages: { n01_u05: { ...TRACKED, total: all.length,
    items: all.map((r) => ({ key: r.key, label: `Item ${r.key}`, tier: r.tier, money: 100, why: null, owner: null, status: null, reason: 'Discount too deep', due: null })) } } };
  const lazy = { ...FILTERS, columns: { list: [{ column: 'priority_tier', label: 'Priority', type: 'multi_select', options: [], searchable: true, lazy: true }] } };
  const routes = trackedRoutes({
    overview: ({ json }) => json(200, hub),
    filters: ({ json }) => json(200, lazy),
    records: ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      seen.records.push(body);
      const picked = body.column_filters?.priority_tier;
      const rows = all.filter((r) => !picked || picked.includes(r.tier)).map((r, i) => ({ entity_id: r.key, record_key: r.key, _inspire_key: r.key,
        _inspire_version: String(100 + i), entity_label: `Item ${r.key}`, priority_tier: r.tier, rank: i + 1, category: 'Books', recommended_action: 'Cut the discount' }));
      return json(200, { rows, total: rows.length, offset: 0, limit: body.limit || 25, actions: true, changes: false, summary: null, errors: {},
        ...(body.status_counts ? { status_counts: { ...COUNTS, open: rows.length } } : {}) });
    },
  });
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes, ready: '[data-fix="fix"]' });
  const tile = Number(await page.locator('[data-tile="fix"] .kpi-v').innerText());
  assert.equal(tile, 8);
  await page.locator('[data-fix="fix"]').click();
  await page.waitForFunction(() => window.location.hash.startsWith('#/n01_u05/work'));
  await page.locator('.cell-t').first().waitFor();
  await page.waitForFunction((n) => document.querySelectorAll('.cell-t').length === n, tile);
  assert.deepEqual(await page.locator('.cell-t').evaluateAll((cells) => [...new Set(cells.map((c) => c.closest('tr')?.innerText.includes('Act now')))]), [true],
    'every row Work lists is one the tile counted');
  await page.reload();
  await page.locator('.cell-t').first().waitFor();
  await page.waitForFunction((n) => document.querySelectorAll('.cell-t').length === n, tile);
  assert.equal(await page.locator('.toast').filter({ hasText: 'no longer apply' }).count(), 0, 'the reloaded address keeps its tier filter');
  assert.deepEqual(seen.errors, []);
  await context.close();
  const inbox = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes, hash: '#/n01_u05/inbox', ready: '[data-inbox-item="fix"]' });
  assert.equal(await inbox.page.locator('[data-inbox-item="fix"]').innerText().then((t) => t.startsWith(`${tile} records to fix`)), true, 'the Inbox counts what the tile counts');
  await inbox.page.locator('[data-inbox-item="fix"]').click();
  await inbox.page.waitForFunction(() => window.location.hash.startsWith('#/n01_u05/work'));
  await inbox.page.locator('.cell-t').first().waitFor();
  await inbox.page.waitForFunction((n) => document.querySelectorAll('.cell-t').length === n, tile);
  assert.deepEqual(inbox.seen.errors, []);
  await inbox.context.close();
});

const BIG_COUNTS = { statuses: { New: 1234, 'In progress': 345, Done: 4567, Dismissed: 120, 'Could not fix': 33 },
  choices: { new: 1234, 'in-progress': 345, done: 4567, 'not-an-issue': 120, 'could-not-fix': 33, reprice: 12, keep: 340, drop: 22, wrong: 9 }, open: 1579, mine: 20, all: 6299 };

test('at 1280 and 1440 the open record dock and every Work tab fit the screen with no sideways scroll', async () => {
  for (const [changes, label] of [[TABLE, 'default statuses'], [OWN_STATUSES, 'own statuses']]) {
    for (const [width, height] of [[1280, 800], [1440, 900]]) {
      const routes = trackedRoutes({}, BIG_COUNTS);
      const rows = routes.records;
      routes.records = (args) => {
        const fulfill = args.json;
        return rows({ ...args, json: (status, data) => fulfill(status, { ...data, rows: data.rows.map((r, i) => (i ? r : { ...r, entity_label: LABEL })) }) });
      };
      routes['records/history'] = ({ json }) => json(200, { ...HISTORY, current: { ...HISTORY.current, entity_label: LABEL } });
      const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, changes), { width, height, hash: '#/n01_u05/work', routes, ready: '[data-tab] [data-count]' });
      await page.locator('.cell-t').first().click();
      await page.locator('[data-dock="record"] dialog.drawer h2').waitFor();
      const at = `${label} at ${width}`;
      const fit = await page.evaluate(() => {
        const box = (el) => el.getBoundingClientRect();
        const strip = box(document.querySelector('.work-tabs'));
        const drawer = document.querySelector('[data-dock="record"] dialog.drawer');
        const title = drawer.querySelector('h2');
        return {
          inner: window.innerWidth, scroll: document.scrollingElement.scrollWidth,
          dock: box(document.querySelector('[data-dock="record"]')).right, drawer: box(drawer).right,
          fills: Math.abs(box(drawer).width - box(drawer.parentElement).width) <= 1,
          buttons: [...drawer.querySelectorAll('button')].filter((b) => b.offsetParent).map((b) => box(b).right),
          title: title.scrollWidth <= title.clientWidth + 1,
          cut: [...document.querySelectorAll('[data-tab]')].filter((t) => { const b = box(t); return b.right > strip.right + 0.5 || b.left < strip.left - 0.5; }).map((t) => t.dataset.tab),
        };
      });
      assert.equal(fit.scroll, fit.inner, `${at}: no sideways scroll`);
      assert.ok(fit.dock <= fit.inner && fit.drawer <= fit.inner, `${at}: the dock ends at ${fit.dock} and the drawer at ${fit.drawer}, inside ${fit.inner}`);
      assert.ok(fit.fills, `${at}: the docked record fills its dock instead of keeping its floating width`);
      assert.ok(fit.buttons.length && fit.buttons.every((r) => r <= fit.inner), `${at}: every drawer button is on screen`);
      assert.ok(fit.title, `${at}: the record title is not cut`);
      assert.deepEqual(fit.cut, [], `${at}: every Work tab is in view`);
      assert.deepEqual(seen.errors, []);
      await context.close();
    }
  }
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
  assert.equal(examples.length, 14);
  const worked = [];
  for (const file of examples) {
    const info = appInfo(DECIDE, 1, {}, `examples/${file}`);
    const { page, seen, context } = await openApp(browser, served.base, info, { ready: '.ph h1', watch: prefsFirst(MY_KEY, PERSON, {}),
      routes: { 'scenario/evaluate': ({ route, json }) => json(200, evaluated(route.request().postDataJSON().values || {})) } });
    const rail = (await railOf(page)).map(([id]) => id);
    assert.equal(rail[0], 'dashboard', `${file}: the rail starts with Dashboard`);
    assert.equal(rail.at(-1), 'settings', `${file}: Settings sits at the bottom`);
    const mode = pageMode(info.pages[0]);
    if (mode.queue) assert.equal(rail.includes('work'), info.pages[0].layout.work === 'queue', `${file}: a queue's Work follows the work the registry gives the layout`);
    assert.equal(rail.includes('work'), hasWork(info.pages[0]), `${file}: the ${mode.id} mode and the registry decide whether there is a work section`);
    if (rail.includes('work')) worked.push(`${file}:${mode.id}`);
    await page.locator('[data-rail="settings"]').click();
    await page.locator('[data-group="look"]').waitFor();
    assert.deepEqual(seen.errors, [], `${file}: no error`);
    await context.close();
  }
  assert.deepEqual(worked, ['agent_chat.json:ask', 'dashboard.json:explore', 'entity_matching.json:queue', 'forecast_cockpit.json:forecast', 'lift_readout.json:queue', 'location_view.json:queue',
    'monitor_triage.json:queue', 'network_explorer.json:queue', 'performance_explainer.json:queue', 'planner.json:plan', 'process_flow.json:queue',
    'recommendation_desk.json:queue', 'scenario_lab.json:scenarios', 'segment_explorer.json:queue'], 'every mode with work of its own and every queue the registry gives work has a work section');
});

const REGISTRY = JSON.parse(readFileSync(join(HERE, '..', '..', 'kinds.json'), 'utf8'));
const QUEUE_CONTRACTS = ['decision_queue', 'monitor', 'recommendations', 'process', 'network', 'location', 'explainer', 'impact', 'segments'];
const INFORMATIONAL = new Set(REGISTRY.layouts.filter((l) => l.informational).map((l) => l.id));
const queueKind = (kind) => QUEUE_CONTRACTS.includes(kind.contract) && !INFORMATIONAL.has(kind.layout);
const exampleOf = (layout) => (layout === 'decision_queue' ? 'example_page.json' : `examples/${layout}.json`);

async function openKind(kind, hash) {
  const example = JSON.parse(readFileSync(join(HERE, '..', '..', exampleOf(kind.layout)), 'utf8'));
  const info = appInfo(DECIDE, 1, { layout: kind.layout, result_table: example.result_table || TABLE.result_table }, exampleOf(kind.layout));
  const id = info.pages[0].id;
  const routes = trackedRoutes({ overview: ({ json }) => json(200, { ...HUB, pages: { [id]: TRACKED } }),
    'scenario/evaluate': ({ route, json }) => json(200, evaluated(route.request().postDataJSON().values || {})),
    'scenario/saved': ({ json }) => json(200, { scenarios: [], decisions: [], mine: 0, note: '' }),
    ...versionRoutes(kind.contract).routes, ...reviewRoutes(null, []) });
  return { id, ...(await openApp(browser, served.base, info, { hash: hash(id), routes, ready: '[data-rail]', watch: prefsFirst(MY_KEY, PERSON, {}) })) };
}

test('every one of the 25 queue kinds has Work in its rail and Work shows the status tabs', { timeout: 300000 }, async () => {
  const queues = REGISTRY.kinds.filter(queueKind);
  assert.equal(queues.length, 25);
  for (const kind of queues) {
    const { id, page, seen, context } = await openKind(kind, (pid) => `#/${pid}/work`);
    await page.locator('[data-tab="open"]').waitFor();
    assert.ok((await railOf(page)).some(([s, on]) => s === 'work' && on === 'page'), `${kind.id}: Work is in the rail and open`);
    assert.equal(await hashOf(page).then((h) => h.startsWith(`#/${id}/work`)), true, `${kind.id}: the Work address is kept`);
    assert.deepEqual((await page.locator('[data-tab]').evaluateAll((tabs) => tabs.map((t) => t.dataset.tab))).filter((t) => ['open', 'mine', 'all'].includes(t)),
      ['open', 'mine', 'all'], `${kind.id}: Work shows its status tabs`);
    await page.locator('[data-work] tbody tr').first().waitFor();
    assert.deepEqual(seen.errors, [], `${kind.id}: no error`);
    await context.close();
  }
});

test('the 15 plan, forecast, scenario, explore and ask kinds never show the queue Work: each opens the work of its own mode under that mode\'s name', { timeout: 300000 }, async () => {
  const others = REGISTRY.kinds.filter((k) => !queueKind(k));
  assert.equal(others.length, 15);
  const own = [];
  for (const kind of others) {
    const { id, page, seen, context } = await openKind(kind, (pid) => `#/${pid}/work`);
    await page.waitForFunction((pid) => [`#/${pid}/work`, `#/${pid}/dashboard`].includes(window.location.hash), id);
    const atWork = (await hashOf(page)) === `#/${id}/work`;
    assert.equal((await railOf(page)).some(([s]) => s === 'work'), atWork, `${kind.id}: the rail has a work section only when the address keeps it`);
    if (atWork) {
      const title = await page.locator('[data-section-title]').innerText();
      assert.notEqual(title, 'Work', `${kind.id}: the work section carries the mode's own name`);
      own.push(title);
    }
    assert.equal(await page.locator('[data-work]').count(), 0, `${kind.id}: no queue Work`);
    assert.deepEqual(seen.errors, [], `${kind.id}: no error`);
    await context.close();
  }
  assert.deepEqual([...new Set(own)].sort(), ['ASK', 'EXPLORE', 'PLAN', 'REVIEW', 'SCENARIOS'], 'each of the five modes names its own work section');
  assert.equal(own.length, others.length, 'every one of these kinds has work of its own');
});

test('a Work address with a tab this page does not have is rewritten to the Open tab, so the address matches what the page shows', async () => {
  const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { hash: '#/n01_u05/work?tab=xyz', routes: trackedRoutes(), ready: '[data-tab]' });
  await page.waitForFunction(() => document.querySelector('[data-tab="open"]')?.getAttribute('aria-selected') === 'true');
  assert.equal(await hashOf(page), '#/n01_u05/work?tab=open', 'the unknown tab is replaced by the Open tab in the address');
  assert.deepEqual(seen.errors, []);
  await context.close();
});
