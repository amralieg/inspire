import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { DECIDE, PERSON, TABLE, appInfo, lister, openApp, prefsFirst, serveDist, tracked, until } from './harness.mjs';
import { MY_KEY } from '../src/prefs.js';
import { DUE_DAYS, badgeText, inboxAsks, inboxCount, inboxGroups, inboxOn } from '../src/inbox.js';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const VISIT = Date.UTC(2026, 9, 20, 9);
const TODAY = '2026-10-24';
const at = (ms) => String(ms * 1000);
const row = (key, over = {}) => ({ record_key: key, _inspire_key: key, entity_id: key, entity_label: `Item ${key}`, _inspire_version: at(VISIT - 3600000), ...over });
const META = { label: 'entity_label' };
const CHANGED = [row('R001', { _inspire_version: at(VISIT + 60000) }), row('R002')];
const MINE = [
  row('R003', { _inspire_due: '2026-10-20', _inspire_status: 'In progress' }),
  row('R004', { _inspire_due: '2026-10-26', _inspire_version: at(VISIT + 120000) }),
  row('R005', { _inspire_due: '2026-11-10' }),
  row('R006', { _inspire_due: '2026-10-21', _inspire_status: 'Done', _inspire_version: at(VISIT + 120000) }),
  { entity_label: 'No key', _inspire_version: at(VISIT + 120000), _inspire_due: '2026-10-22' },
];

test('the inbox asks the existing list for the changed records and for your open records with their due days', () => {
  const asks = { changed: { page: 'p1', filters: {}, changed: true, limit: 50 }, mine: { page: 'p1', filters: {}, mine: true, window: 'all', limit: 50 } };
  assert.deepEqual(inboxAsks({ id: 'p1' }), asks, 'someone who does not own the use case never asks for the records nobody owns (must-exclude)');
  assert.deepEqual(inboxAsks({ id: 'p1', is_owner: false }), asks);
  assert.deepEqual(inboxAsks({ id: 'p1', is_owner: true }), { ...asks, unowned: { page: 'p1', filters: {}, unowned: true, window: 'all', due_within: DUE_DAYS, limit: 50 } });
  const app = { options: { decisions: true }, user: { email: PERSON } };
  assert.equal(inboxOn(app, { history: true, records: {} }), true);
  assert.equal(inboxOn({ ...app, user: {} }, { history: true, records: {} }), false, 'nobody signed in owns nothing');
  assert.equal(inboxOn({ ...app, options: { decisions: false } }, { history: true, records: {} }), false, 'a list that keeps no decisions has no inbox');
  assert.equal(inboxOn(app, { history: false, records: {} }), false);
});

test('the three groups: changed since your last visit, open items you own, and the ones due in 3 days or overdue', () => {
  const { groups, fresh, keys } = inboxGroups({ changed: CHANGED, mine: MINE, meta: META, lastVisit: VISIT, today: TODAY });
  assert.deepEqual(groups.changed.map((i) => i.key), ['R001'], 'a record changed before your last visit is not news (must-exclude)');
  assert.deepEqual(groups.assigned.map((i) => [i.key, i.fresh]), [['R003', false], ['R004', true], ['R005', false]], 'a closed record and a row with no key are left out');
  assert.deepEqual(groups.due.map((i) => [i.key, i.late, i.fresh]), [['R003', true, false], ['R004', false, true]],
    `due after ${DUE_DAYS} days or already closed is left out; one that entered the window after the visit is new`);
  assert.equal(groups.assigned[0].status, 'In progress');
  assert.equal(groups.assigned[1].status, 'New', 'the status reads through the shared helper');
  assert.equal(groups.changed[0].label, 'Item R001');
  assert.deepEqual([fresh, keys.sort()], [2, ['R001', 'R004']], 'a record new in two groups counts once');
  assert.equal(inboxCount({ keys }, new Set(['R004'])), 1, 'what you saw in the panel stops counting');
});

const UNOWNED = [
  row('R007', { _inspire_due: '2026-10-25' }),
  row('R008', { _inspire_due: '2026-10-23', _inspire_owner: ' ' }),
  row('R009', { _inspire_due: '2026-10-25', _inspire_owner: PERSON }),
  row('R003', { _inspire_due: '2026-10-20' }),
  row('R010', { _inspire_due: '2026-10-26', _inspire_status: 'Done' }),
];

test('an owner of the use case also sees the open records nobody owns that are due in 3 days or overdue, once each', () => {
  const { groups, keys } = inboxGroups({ changed: CHANGED, mine: MINE, unowned: UNOWNED, meta: META, lastVisit: VISIT, today: TODAY });
  assert.deepEqual(groups.due.map((i) => [i.key, i.unowned, i.fresh]), [['R003', false, false], ['R008', true, false], ['R007', true, true], ['R004', false, true]],
    'a record with an owner, a closed one and one already listed as yours are left out (must-exclude)');
  assert.deepEqual(groups.assigned.map((i) => i.key), ['R003', 'R004', 'R005'], 'records nobody owns are never assigned to you');
  assert.deepEqual(keys.sort(), ['R001', 'R004', 'R007']);
  const theirs = inboxGroups({ changed: CHANGED, mine: MINE, meta: META, lastVisit: VISIT, today: TODAY });
  assert.deepEqual(theirs.groups.due.map((i) => i.key), ['R003', 'R004'], 'without the owner ask the due group keeps only your items');
});

test('with no last visit nothing counts as new, and a visit after every change leaves the count at zero', () => {
  assert.equal(inboxGroups({ changed: CHANGED, mine: MINE, meta: META, lastVisit: 0, today: TODAY }).fresh, 0);
  const later = inboxGroups({ changed: CHANGED, mine: MINE, meta: META, lastVisit: Date.UTC(2026, 9, 24, 12), today: TODAY });
  assert.equal(later.fresh, 0);
  assert.equal(later.groups.assigned.length, 3, 'the groups still list your items; only the count is about news');
  assert.deepEqual(inboxGroups({ meta: META, lastVisit: VISIT, today: TODAY }).groups, { changed: [], assigned: [], due: [] }, 'no rows at all');
  assert.deepEqual([badgeText(3), badgeText(120)], ['3', '99+']);
});

function inboxRoutes(seen) {
  const { routes } = tracked({
    records: lister((body) => {
      seen.push(body);
      if (body.changed) return CHANGED;
      if (body.mine) return MINE;
      if (body.unowned) return UNOWNED;
      return [];
    }, { actions: true, changes: true, window: { window: 'all', limit: null, today: TODAY } }),
  });
  return routes;
}

async function openAt(visit, hash = '#/n01_u05/dashboard', owner = false) {
  const asks = [];
  const info = appInfo(DECIDE, 1, TABLE);
  info.pages[0].is_owner = owner;
  const opened = await openApp(browser, served.base, info, {
    hash, routes: inboxRoutes(asks), ready: '[data-inbox]', watch: visit ? prefsFirst(MY_KEY, PERSON, { seen: { n01_u05: visit } }) : undefined,
  });
  return { ...opened, asks };
}

test('the bell shows a count only when something is new since the last visit, and none for a first visit', async () => {
  const fresh = await openAt(VISIT);
  await fresh.page.locator('[data-inbox-count="2"]').waitFor();
  assert.equal(await fresh.page.locator('[data-inbox]').getAttribute('aria-label'), 'Inbox, 2 new');
  assert.ok(fresh.asks.some((b) => b.changed === true) && fresh.asks.some((b) => b.mine === true && b.window === 'all'));
  assert.ok(!fresh.asks.some((b) => b.unowned), 'someone who does not own the use case never asks for the records nobody owns');
  assert.deepEqual(fresh.seen.errors, []);
  await fresh.context.close();
  for (const visit of [Date.UTC(2026, 9, 24, 12), 0]) {
    const quiet = await openAt(visit);
    await until(() => quiet.asks.length >= 2);
    await quiet.page.waitForTimeout(400);
    assert.equal(await quiet.page.locator('[data-inbox-count]').count(), 0, `no count for ${visit ? 'a visit after every change' : 'a first visit'} (must-exclude)`);
    assert.equal(await quiet.page.locator('[data-inbox]').getAttribute('aria-label'), 'Inbox');
    await quiet.context.close();
  }
});

test('the panel lists the three groups, opening it clears the count, and each item opens Work with the record docked', async () => {
  const { page, seen, context } = await openAt(VISIT);
  await page.locator('[data-inbox-count="2"]').waitFor();
  await page.locator('[data-inbox]').click();
  const panel = page.locator('[data-inbox-panel]');
  await panel.waitFor();
  assert.deepEqual(await panel.locator('[data-inbox-group]').evaluateAll((gs) => gs.map((g) => [g.dataset.inboxGroup, [...g.querySelectorAll('[data-inbox-item]')].map((i) => i.dataset.inboxItem)])),
    [['changed', ['R001']], ['assigned', ['R003', 'R004', 'R005']], ['due', ['R003', 'R004']]]);
  await page.waitForFunction(() => !document.querySelector('[data-inbox-count]'));
  await panel.locator('[data-inbox-group="due"] [data-inbox-item="R003"]').click();
  await page.waitForFunction(() => window.location.hash.startsWith('#/n01_u05/work') && window.location.hash.includes('rec=R003'));
  await page.locator('[data-dock="record"] dialog.drawer').waitFor();
  await page.locator('[data-inbox]').click();
  await page.locator('[data-inbox-panel] [data-inbox-group="changed"] [data-inbox-item="R001"]').click();
  await page.waitForFunction(() => window.location.hash.startsWith('#/n01_u05/work') && window.location.hash.includes('rec=R001'));
  await page.locator('[data-dock="record"] dialog.drawer').waitFor();
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('an owner sees the records nobody owns that are due soon in the due group, named as nobody owns it yet', async () => {
  const { page, seen, context, asks } = await openAt(VISIT, '#/n01_u05/dashboard', true);
  await page.locator('[data-inbox-count="3"]').waitFor();
  assert.ok(asks.some((b) => b.unowned === true && b.due_within === DUE_DAYS && b.window === 'all'));
  await page.locator('[data-inbox]').click();
  const due = page.locator('[data-inbox-panel] [data-inbox-group="due"]');
  await due.waitFor();
  assert.deepEqual(await due.locator('[data-inbox-item]').evaluateAll((all) => all.map((i) => i.dataset.inboxItem)), ['R003', 'R008', 'R007', 'R004']);
  assert.match(await due.locator('[data-inbox-item="R007"]').innerText(), /Nobody owns it yet/);
  assert.doesNotMatch(await due.locator('[data-inbox-item="R004"]').innerText(), /Nobody owns it yet/, 'your own item is not named unowned (must-exclude)');
  assert.deepEqual(seen.errors, []);
  await context.close();
});
