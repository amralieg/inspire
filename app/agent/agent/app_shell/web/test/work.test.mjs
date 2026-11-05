import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { actBody, CURRENT, DECIDE, HISTORY, LABEL, OTHER, ROWS, SUMMARY, TABLE, appInfo, lister, openApp, serveDist, tracked, until } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const CLOCK = new Date('2026-10-27T09:30:00Z');
const TOMORROW = '2026-10-28';
const toastText = (page) => page.evaluate(() => document.querySelector('.toast .toast-t')?.textContent || '');
const toastButtons = (page) => page.locator('.toast .toast-a button').allInnerTexts();
const label = (n) => `Item number ${n} with a long descriptive name`;
const AS_OF = String((CLOCK.getTime() - 5000) * 1000);

function routesFor(reply, more = {}) {
  return tracked({
    records: lister(ROWS, { actions: true, changes: true, summary: SUMMARY, as_of_us: AS_OF }),
    'records/act': ({ route, json, seen }) => {
      const body = actBody(route);
      (seen.acts ||= []).push(body);
      return json(200, reply.act ? reply.act(body) : { written: body.record_keys || [], conflicts: [], batch_id: `b-${seen.acts.length}` });
    },
    'records/undo': ({ route, json, seen }) => {
      const body = route.request().postDataJSON();
      (seen.undos ||= []).push(body);
      return json(200, reply.undo || { restored: 1, skipped: 0, skipped_sample: [], batch_id: 'u-1', undoes: body.batch_id });
    },
    'records/history': ({ json, url }) => {
      const key = url.searchParams.get('record_key');
      const i = ROWS.findIndex((r) => r.record_key === key);
      const current = { ...CURRENT, ...ROWS[i], valid_from_us: String(200 + i), action_owner: null, action_status: 'New' };
      return json(200, { ...HISTORY, record_key: key, versions: [current], current });
    },
    ...more,
  });
}

async function openList(routes, info = appInfo(DECIDE, 1, TABLE)) {
  const opened = await openApp(browser, served.base, info, { routes, clock: CLOCK, timezone: 'Asia/Dubai' });
  await opened.page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length > 0 && document.querySelector('.list-tools'));
  return opened;
}

test('Select all matching acts on every matching record with the load time and the list view, never a key list, and its Undo sends the batch id', async () => {
  const reply = {
    act: () => ({ written: 28, conflicts_count: 2, conflicts: [{ record_key: 'R004' }, { record_key: 'R009' }], batch_id: 'b-41' }),
    undo: { restored: 28, skipped: 1, skipped_sample: [{ record_key: 'R011', error: 'Someone changed this record' }], batch_id: 'u-41', undoes: 'b-41' },
  };
  const { routes } = routesFor(reply);
  const { page, seen, context } = await openList(routes);
  await page.getByRole('checkbox', { name: 'Select every record on this page' }).check();
  assert.equal(await page.locator('.bulk b').innerText(), '25 selected:');
  await page.getByRole('button', { name: 'Select all 30 matching' }).click();
  assert.equal(await page.locator('.bulk b').innerText(), 'All 30 matching records selected');
  assert.equal(await page.locator('.bulk-asof').innerText(), 'As of Oct 27, 2026, 09:29 AM UTC. A record that changes after that is left as it is.');
  const loaded = seen.records.at(-1);
  await page.getByRole('button', { name: 'Mark all done…' }).click();
  assert.equal(await page.locator('textarea[name="bulk_note"]').getAttribute('maxlength'), '500');
  await page.locator('textarea[name="bulk_note"]').fill('Closed the promo for all of them');
  await page.getByRole('button', { name: 'Mark 30 records done' }).click();
  await until(() => seen.acts?.length === 1);
  const act = seen.acts[0];
  assert.deepEqual(Object.keys(act).sort(), ['match', 'page', 'values'], 'a select-all act names no record_keys and no seen versions');
  assert.equal('record_keys' in act || 'seen' in act, false);
  assert.deepEqual(act.values, { action_status: 'Done', note: 'Closed the promo for all of them' });
  assert.deepEqual(act.match.filters, loaded.filters);
  assert.deepEqual(act.match.view, { ai: {}, search: '', mine: false, changed: false, window: 'all', time_zone: 'Asia/Dubai' }, 'the match carries the All open window the list read');
  assert.equal(act.match.as_of_us, AS_OF, 'the match is as of the moment the server read the list, never the browser clock');
  await page.waitForFunction(() => document.querySelector('.toast.is-on .toast-t'));
  assert.equal(await toastText(page), '28 records marked done. 2 records changed since you loaded them and were left as they are.');
  assert.deepEqual(await toastButtons(page), ['Undo']);
  assert.equal(await page.locator('.conflicts').innerText(),
    `2 records changed since you loaded them and were left as they are: ${label(4)}, ${label(9)}.`);
  await page.locator('.toast-a').getByRole('button', { name: 'Undo' }).click();
  await until(() => seen.undos?.length === 1);
  assert.deepEqual(seen.undos[0], { page: 'n01_u05', batch_id: 'b-41' });
  await page.waitForFunction(() => /^Undone/.test(document.querySelector('.toast .toast-t')?.textContent || ''));
  assert.equal(await toastText(page), `Undone: 28 records are back as they were. 1 record changed since and was left as it is: ${label(11)}.`);
  await page.locator('.conflicts').getByRole('button', { name: 'Close this notice' }).click();
  await page.locator('.conflicts').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.conflicts').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('every status takes a note, a dismissal still needs its reason, and Snooze sends a date from tomorrow on', async () => {
  const { routes } = routesFor({});
  const { page, seen, context } = await openList(routes);
  const pick = async () => {
    await page.getByRole('checkbox', { name: `Select ${label(1)}` }).check();
    await page.getByRole('checkbox', { name: `Select ${label(2)}` }).check();
  };
  await pick();
  await page.getByRole('button', { name: 'Set status…' }).click();
  await page.locator('select[name="bulk_status"]').selectOption('In progress');
  await page.locator('textarea[name="bulk_note"]').fill('Called both stores');
  await page.getByRole('button', { name: 'Set status of 2 records' }).click();
  await until(() => seen.acts?.length === 1);
  assert.deepEqual(seen.acts[0], { page: 'n01_u05', record_keys: ['R001', 'R002'], seen: { R001: '100', R002: '101' },
    values: { action_status: 'In progress', note: 'Called both stores' } });
  await page.waitForFunction(() => !document.querySelector('.bulk'));
  await pick();
  await page.getByRole('button', { name: 'Set status…' }).click();
  await page.locator('select[name="bulk_status"]').selectOption('Dismissed');
  assert.equal(await page.getByRole('button', { name: 'Set status of 2 records' }).isDisabled(), true, 'a dismissal still needs its reason');
  await page.keyboard.press('Escape');
  await page.getByRole('button', { name: 'Snooze…' }).click();
  const until_ = page.locator('input[name="bulk_snooze"]');
  assert.deepEqual([await until_.inputValue(), await until_.getAttribute('min')], [TOMORROW, TOMORROW]);
  await until_.fill('2026-10-27');
  assert.equal(await page.getByRole('button', { name: 'Snooze 2 records' }).isDisabled(), true, 'a snooze ends tomorrow at the earliest');
  await until_.fill('2026-11-03');
  await page.getByRole('button', { name: 'Snooze 2 records' }).click();
  await until(() => seen.acts?.length === 2);
  assert.deepEqual(seen.acts[1].values, { snooze_until: '2026-11-03' }, 'an empty note is not sent');
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === '2 records snoozed until Nov 3, 2026.');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Apply to similar shows the count and five of the records the server found, writes nothing before Apply, and Apply sends the similar match', async () => {
  const sample = Array.from({ length: 7 }, (_, i) => ({ record_key: `S${i}`, label: `Similar record ${i + 1}`, valid_from_us: String(300 + i) }));
  const matchOf = (key) => ({ filters: { category: ['Books'], region: ['South'] }, view: { window: 'all', exclude: [key] }, as_of_us: '5555555555555555' });
  const asked = [];
  const { routes } = routesFor({}, {
    'records/similar': ({ json, url }) => {
      asked.push(Object.fromEntries(url.searchParams));
      return json(200, { by: [{ filter: 'category', label: 'Category', value: 'Books' }, { filter: 'region', label: 'Region', value: 'South' }], count: 12, sample,
        match: matchOf(url.searchParams.get('record_key')) });
    },
  });
  const { page, seen, context } = await openList(routes, appInfo(DECIDE, 1, { ...TABLE, similar_by: ['category', 'region'] }));
  const drawer = page.locator('dialog.drawer');
  await page.locator('.cell-t').first().click();
  await drawer.locator('.dr-act').waitFor();
  await drawer.getByRole('button', { name: 'Mark done' }).click();
  await until(() => seen.acts?.length === 1);
  await page.waitForFunction(() => document.querySelectorAll('.toast.is-on .toast-a button').length === 2);
  assert.deepEqual(asked, [{ page: 'n01_u05', record_key: 'R001', by: 'category,region' }], 'by is one value of the filter ids the page names, comma separated');
  assert.deepEqual(await toastButtons(page), ['Undo', 'Apply to 12 similar']);
  assert.equal(await page.locator('dialog.drawer .toast').count(), 1, 'the toast sits inside the open record so its buttons can be pressed');
  await page.locator('.toast-a').getByRole('button', { name: 'Apply to 12 similar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply to similar records' });
  await dialog.waitFor();
  assert.equal(await dialog.locator('h2').innerText(), `Apply to 12 records like ${LABEL}?`);
  assert.match(await dialog.locator('header p').innerText(), /^These 12 open records share Category Books, Region South\. Nothing changes until you apply\.$/);
  assert.deepEqual(await dialog.locator('.sim li').allInnerTexts(), sample.slice(0, 5).map((s) => s.label));
  assert.equal(await dialog.locator('.sim b').innerText(), '5 of the 12');
  assert.equal(await dialog.locator('select[name="similar_status"]').inputValue(), 'Done', 'the dialog starts from what was just applied');
  await page.waitForTimeout(300);
  assert.equal(seen.acts.length, 1, 'opening the preview writes nothing');
  await dialog.getByRole('button', { name: 'Cancel' }).click();
  await dialog.waitFor({ state: 'hidden' });
  await page.waitForTimeout(300);
  assert.equal(seen.acts.length, 1, 'Cancel writes nothing');
  await page.keyboard.press('Escape');
  await page.locator('.cell-t').nth(1).click();
  await drawer.locator('.dr-act').waitFor();
  await drawer.getByRole('button', { name: 'Could not fix' }).click();
  await until(() => seen.acts?.length === 2);
  await page.waitForFunction(() => [...document.querySelectorAll('.toast.is-on .toast-a button')].some((b) => b.textContent === 'Apply to 12 similar'));
  await page.locator('.toast-a').getByRole('button', { name: 'Apply to 12 similar' }).click();
  await dialog.waitFor();
  assert.equal(await dialog.locator('select[name="similar_status"]').inputValue(), 'Could not fix');
  await dialog.locator('textarea[name="similar_note"]').fill('Same store, same supplier');
  await dialog.getByRole('button', { name: 'Apply to 12 records' }).click();
  await until(() => seen.acts?.length === 3);
  const applied = seen.acts[2];
  assert.equal('record_keys' in applied, false);
  assert.deepEqual(applied.values, { action_status: 'Could not fix', note: 'Same store, same supplier' });
  assert.deepEqual(applied.match, matchOf('R002'), 'Apply sends back the match the server gave with its count');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Recent changes lists each change newest first, and Undo on one says what it put back and what it left', async () => {
  const batches = [
    { batch_id: 'b-4', editor: OTHER, at: '2026-10-27T09:30:00Z', count: 3, values: { action_status: 'Done' }, undoes: null, note: '', undone: false, can_undo: false },
    { batch_id: 'b-3', editor: 'dana', at: '2026-10-27T09:20:00Z', count: 1, values: { action_status: 'New' }, undoes: 'b-0', note: '', undone: false, can_undo: true },
    { batch_id: 'b-2', editor: ['pat.lee', 'example.com'].join('@'), at: '2026-10-27T09:10:00Z', count: 30, values: { action_status: 'Done' }, undoes: null, note: 'Closed the promo', undone: false,
      can_undo: true },
    { batch_id: 'b-1', editor: OTHER, at: '2026-10-26T16:00:00Z', count: 2, values: { action_owner: OTHER }, undoes: null, note: '', undone: true, can_undo: true },
  ];
  const { routes } = routesFor({ undo: { restored: 29, skipped: 1, skipped_sample: [{ record_key: 'R003', error: 'changed' }], batch_id: 'u-2', undoes: 'b-2' } },
    { 'records/batches': ({ json }) => json(200, { batches, limit: 20 }) });
  const { page, seen, context } = await openList(routes);
  await page.getByRole('button', { name: 'Recent changes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Recent changes' });
  await dialog.locator('.batches li').first().waitFor();
  assert.deepEqual(await dialog.locator('.batches li > span').allInnerTexts(), [
    `Oct 27, 2026, 09:30 AM UTC, ${OTHER}: 3 records marked done`,
    'Oct 27, 2026, 09:20 AM UTC, dana: undid an earlier change on 1 record',
    `Oct 27, 2026, 09:10 AM UTC, ${batches[2].editor}: 30 records marked done. Note: Closed the promo`,
    `Oct 26, 2026, 04:00 PM UTC, ${OTHER}: 2 records given to ${OTHER}`]);
  assert.equal(await dialog.locator('[data-batch="b-1"] button').count(), 0, 'an undone change offers no second Undo');
  assert.equal(await dialog.locator('[data-batch="b-3"] button').count(), 0, 'an undo is not undone from here');
  assert.equal(await dialog.locator('[data-batch="b-1"] small').innerText(), 'Undone');
  assert.equal(await dialog.locator('[data-batch="b-4"] button').count(), 0, 'someone else made it and the person owns no part of this use case');
  assert.equal(await dialog.locator('[data-batch="b-4"] [data-undo-theirs]').innerText(),
    'Only the person who made this change or an owner of this use case can undo it.');
  await dialog.locator('[data-batch="b-2"]').getByRole('button', { name: 'Undo' }).click();
  await until(() => seen.undos?.length === 1);
  assert.deepEqual(seen.undos[0], { page: 'n01_u05', batch_id: 'b-2' });
  await dialog.locator('[data-batch="b-2"] small[role="status"]').filter({ hasText: 'Undone:' }).waitFor();
  assert.equal(await dialog.locator('[data-batch="b-2"] small').innerText(), `Undone: 29 records are back as they were. 1 record changed since and was left as it is: ${label(3)}.`);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Start working shows one record at a time with k of N, Done and next and Snooze and next write, Skip does not, and the end says All caught up', async () => {
  const rows = ROWS.slice(0, 3);
  const { routes } = routesFor({}, { records: lister(rows, { actions: true, changes: true, summary: SUMMARY }) });
  const { page, seen, context } = await openList(routes);
  await page.getByRole('button', { name: 'Start working' }).click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('.work-f').waitFor();
  const at = async (n) => {
    await page.waitForFunction((t) => document.querySelector('dialog.drawer[open] h2')?.textContent === t, label(n));
    return drawer.locator('[data-work-k]').innerText();
  };
  assert.equal(await at(1), '1 of 3 on this list');
  await drawer.getByRole('button', { name: 'Done and next' }).click();
  assert.equal(await at(2), '2 of 3 on this list');
  assert.deepEqual(seen.acts[0], { page: 'n01_u05', record_keys: ['R001'], seen: { R001: '200' }, values: { action_status: 'Done' } });
  await drawer.getByRole('button', { name: 'Skip' }).click();
  assert.equal(await at(3), '3 of 3 on this list');
  assert.equal(seen.acts.length, 1, 'Skip writes nothing');
  assert.equal(await drawer.locator('input[name="work_snooze"]').inputValue(), TOMORROW);
  await drawer.getByRole('button', { name: 'Snooze and next' }).click();
  const done = page.getByRole('dialog', { name: 'All caught up' });
  await done.waitFor();
  assert.deepEqual(seen.acts[1], { page: 'n01_u05', record_keys: ['R003'], seen: { R003: '202' }, values: { snooze_until: TOMORROW } });
  assert.equal(await done.locator('p').innerText(), 'You went through 3 records: 1 marked done, 1 snoozed and 1 skipped.');
  assert.equal(await page.locator('dialog.drawer[open]').count(), 0, 'the record panel closed at the end');
  assert.equal(await page.evaluate(() => document.querySelector('.toast.is-on .toast-t')?.textContent), '1 record snoozed until Oct 28, 2026.',
    'the Undo toast outlives the record panel it was shown in');
  assert.ok(await page.locator('.toast.is-on').isVisible());
  await done.getByRole('button', { name: 'Done' }).click();
  await done.waitFor({ state: 'hidden' });
  assert.equal(await page.locator('dialog.drawer[open]').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Undo toast in the record panel never covers the work buttons, the record title, its links or the count, on a phone, a laptop or a wide screen', async () => {
  const { routes } = routesFor({});
  for (const width of [390, 1024, 1440]) {
    const opened = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE), { routes, clock: CLOCK, timezone: 'Asia/Dubai', width });
    const { page, seen, context } = opened;
    await page.waitForFunction(() => document.querySelector('[data-start-work]'));
    await page.locator('[data-start-work]').click();
    await page.locator('dialog.drawer .work-f').waitFor();
    await page.locator('dialog.drawer').getByRole('button', { name: 'Done and next' }).click();
    await page.waitForFunction(() => document.querySelector('.toast.is-on .toast-a button'));
    await page.waitForTimeout(400);
    const hit = await page.evaluate(() => {
      const t = document.querySelector('.toast.is-on').getBoundingClientRect();
      return [...document.querySelectorAll('dialog.drawer .work-f button, dialog.drawer .work-f input, dialog.drawer .panel-h h2, dialog.drawer .panel-h button, dialog.drawer [data-work-k]')].filter((b) => {
        const r = b.getBoundingClientRect();
        return r.left < t.right && t.left < r.right && r.top < t.bottom && t.top < r.bottom;
      }).map((b) => b.textContent || b.name || b.getAttribute('aria-label'));
    });
    assert.deepEqual(hit, [], `at ${width}px the toast covers ${hit.join(', ')}`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('the keyboard moves through the list, opens, marks done, snoozes, selects and undoes, and does nothing while you type', async () => {
  const { routes } = routesFor({});
  const { page, seen, context } = await openList(routes);
  const cursor = () => page.evaluate(() => document.querySelector('.card--table tr.is-cursor .cell-t b')?.textContent || '');
  await page.locator('.card-h h2').first().click();
  await page.keyboard.press('j');
  assert.equal(await cursor(), label(1));
  await page.keyboard.press('j');
  await page.keyboard.press('j');
  await page.keyboard.press('k');
  assert.equal(await cursor(), label(2));
  await page.keyboard.press('ArrowDown');
  assert.equal(await cursor(), label(3));
  await page.keyboard.press('ArrowUp');
  await page.keyboard.press('x');
  assert.equal(await page.locator('.bulk b').innerText(), '1 selected:');
  await page.keyboard.press('x');
  await page.locator('.bulk').waitFor({ state: 'detached' });
  assert.equal(await page.locator('.bulk').count(), 0);
  await page.keyboard.press('d');
  await until(() => seen.acts?.length === 1);
  assert.deepEqual(seen.acts[0], { page: 'n01_u05', record_keys: ['R002'], seen: { R002: '101' }, values: { action_status: 'Done' } });
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === '1 record marked done.');
  await page.keyboard.press('u');
  await until(() => seen.undos?.length === 1);
  assert.deepEqual(seen.undos[0], { page: 'n01_u05', batch_id: 'b-1' });
  await page.keyboard.press('s');
  await until(() => seen.acts?.length === 2);
  assert.deepEqual(seen.acts[1].values, { snooze_until: TOMORROW });
  await page.keyboard.press('Enter');
  await page.waitForFunction((t) => document.querySelector('dialog.drawer[open] h2')?.textContent === t, label(2));
  await page.locator('dialog.drawer .dr-act').waitFor();
  await page.keyboard.press('j');
  await page.waitForFunction((t) => document.querySelector('dialog.drawer[open] h2')?.textContent === t, label(3));
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.drawer[open]'));
  await page.keyboard.press('a');
  await page.waitForFunction(() => document.activeElement?.name === 'action_owner');
  await page.keyboard.press('Escape');
  await page.waitForFunction(() => !document.querySelector('dialog.drawer[open]'));
  await page.keyboard.press('/');
  assert.equal(await page.evaluate(() => document.activeElement?.getAttribute('aria-label')), 'Search the list');
  const acts = seen.acts.length;
  const undos = seen.undos.length;
  for (const key of ['d', 's', 'x', 'u', 'j', 'a', '?']) await page.keyboard.press(key);
  await page.waitForTimeout(400);
  assert.equal(await page.getByLabel('Search the list').inputValue(), 'dsxuja?', 'every key went into the box');
  assert.deepEqual([seen.acts.length, seen.undos.length], [acts, undos], 'no shortcut fired while typing');
  assert.equal(await page.locator('.bulk').count(), 0);
  assert.equal(await page.getByRole('dialog', { name: 'Keyboard shortcuts' }).count(), 0);
  await page.getByLabel('Search the list').fill('');
  await page.locator('.card-h h2').first().click();
  await page.keyboard.press('?');
  const help = page.getByRole('dialog', { name: 'Keyboard shortcuts' });
  await help.waitFor();
  assert.equal(await help.locator('.keys > div').count(), 11);
  assert.match(await help.innerText(), /never while you type in a box/);
  await page.keyboard.press('Escape');
  await help.waitFor({ state: 'hidden' });
  assert.deepEqual(seen.errors, []);
  await context.close();
});
