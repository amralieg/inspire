import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { actBody, CONTRACT as C, CURRENT, DECIDE, HISTORY, NO_RUNS, PERSON, ROWS, SILENT, SUMMARY, TABLE, appInfo, lister, openApp, prefsFirst, scrollsAsked, serveDist, until, watchScrolls } from './harness.mjs';

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const CLOCK = new Date('2026-10-27T09:30:00Z');
const MY = 'inspire-app-my';
const PAGE = C.act_keys.request.body.page;
const label = (n) => `Item number ${n} with a long descriptive name`;
const keyed = (n) => Array.from({ length: n }, (_, i) => ({ ...ROWS[i % ROWS.length], entity_id: `k${i + 1}`, record_key: `k${i + 1}`, _inspire_key: `k${i + 1}`,
  _inspire_version: String(1001 + i), entity_label: label(i + 1), _inspire_owner: null, _inspire_status: null }));
const toastText = (page) => page.evaluate(() => document.querySelector('.toast.is-on .toast-t')?.textContent || '');
const toastButtons = (page) => page.locator('.toast.is-on .toast-a button').allInnerTexts();
const toastSaid = (page, text) => page.waitForFunction((t) => document.querySelector('.toast.is-on .toast-t')?.textContent === t, text);
const notFetchErrors = (errors) => errors.filter((e) => !/the server responded with a status of 4\d\d/.test(e));

function contractRoutes(rows, { listed = {}, acts = [], undo = C.undo.response, more = {} } = {}) {
  const asked = { acts: [], undos: [], similar: [], batches: 0 };
  const replies = [...acts];
  const routes = {
    records: lister(rows, { actions: true, changes: true, summary: SUMMARY, ...listed }),
    'records/act': ({ route, json }) => {
      asked.acts.push(actBody(route));
      const [status, body] = replies.shift() || [200, C.act_keys.response];
      return json(status, body);
    },
    'records/undo': ({ route, json }) => { asked.undos.push(route.request().postDataJSON()); return json(200, undo); },
    'records/history': ({ json, url }) => {
      const key = url.searchParams.get('record_key');
      const row = rows.find((r) => r.record_key === key);
      const current = { ...CURRENT, ...row, valid_from_us: row._inspire_version, action_owner: null, action_status: 'New' };
      return json(200, { ...HISTORY, record_key: key, versions: [current], current });
    },
    'records/similar': ({ json, url }) => { asked.similar.push(Object.fromEntries(url.searchParams)); return json(200, C.similar.response); },
    'records/batches': ({ json }) => { asked.batches += 1; return json(200, C.batches.response); },
    ...more,
  };
  return { asked, routes };
}

async function openWith(info, routes, { prefs, hash = `#/${PAGE}/work` } = {}) {
  return openApp(browser, served.base, info, { routes, clock: CLOCK, timezone: 'Asia/Dubai', hash, watch: prefs && prefsFirst(MY, PERSON, prefs) });
}

const waitList = (page) => page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length > 0 && document.querySelector('.list-tools'));

test('a running refresh shows the step, rows, percent and time left the contract freshness sends, and no time left when it sends none', async () => {
  for (const [active, text, percent] of [
    [C.freshness.response.active, 'Step 4 of 5: Explaining the records · 0 of 900 rows · about 6 min left', '81'],
    [C.freshness.inside_active, 'Step 2 of 5: Running the use case · running for 30 min, usually about 25 min', '20'],
  ]) {
    const routes = { freshness: ({ json }) => json(200, { ...C.freshness.response, active }) };
    const { page, seen, context } = await openApp(browser, served.base, appInfo(), { routes, clock: CLOCK });
    await page.locator('.ph .fresh-d [data-progress]').waitFor();
    assert.equal(await page.locator('.ph .fresh-d [data-progress]').innerText(), text);
    const bar = await page.locator('.ph .fresh [role="progressbar"]').first().evaluate((el) => [el.getAttribute('aria-valuenow'), el.querySelector('i').style.width]);
    assert.deepEqual(bar, [percent, `${percent}%`]);
    if (active.eta_s == null) assert.doesNotMatch(`${await page.locator('.ph .fresh').innerText()} ${await page.locator('.ph .fresh-d').innerText()}`, /left/, 'no time left that the server did not send');
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('an opened run lists how long each step took from the contract run fields, and a run with no steps shows none', async () => {
  const base = { run_id: null, job_run_id: null, url: '', ended: null, status: 'done', trigger: 'schedule', by: '', segments: [], tables: [], records: 40,
    to_fix: 5, could_save: null, currency: '', summary: '', nothing_to_act: '', error: '' };
  const runs = [{ ...base, run_id: 'u2', started: '2026-10-27T06:00:00Z', duration_s: 300, ...C.runs.run_fields },
    { ...base, run_id: 'u1', started: '2026-10-20T06:00:00Z', duration_s: 280 }];
  const routes = { runs: ({ json }) => json(200, { ...NO_RUNS, runs, total: 2 }) };
  const { page, seen, context } = await openApp(browser, served.base, appInfo({}, 1, TABLE), { routes, clock: CLOCK });
  await page.locator('[data-rail="runs"]').click();
  const rows = page.locator('.runs-tbl > tbody > tr:not(.runs-d)');
  await rows.first().waitFor();
  await rows.nth(0).locator('.runs-tog').click();
  await page.locator('.runs-steps li').first().waitFor();
  assert.equal(await page.locator('.runs-steps h3').textContent(), 'How long each step took');
  assert.deepEqual(await page.locator('.runs-steps li').allInnerTexts(), ['Checking the settings: 1 min', 'Writing the results: 4 min for 600 rows']);
  await rows.nth(0).locator('.runs-tog').click();
  await rows.nth(1).locator('.runs-tog').click();
  await page.locator('.runs-d .runs-g').waitFor();
  assert.equal(await page.locator('.runs-steps').count(), 0, 'a run that recorded no steps shows no step list');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a link to what changed jumps to the list for a person who asked for less motion, and glides there otherwise', async () => {
  for (const [motion, behavior] of [['reduce', 'auto'], ['no-preference', 'smooth']]) {
    const { routes } = contractRoutes(keyed(3));
    const { page, seen, context } = await openApp(browser, served.base, appInfo(DECIDE, 1, TABLE),
      { routes, clock: CLOCK, timezone: 'Asia/Dubai', hash: `#/${PAGE}?changed=1`, watch: watchScrolls(motion) });
    await waitList(page);
    await page.waitForFunction(() => window.__scrolls.length > 0);
    assert.deepEqual([...new Set(await scrollsAsked(page))], [behavior], `${motion}: the jump to what changed`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('a window and a limit in My view send exactly the contract records request, and the reply that shows all of them says nothing is held back', async () => {
  const { routes } = contractRoutes(keyed(3), { listed: C.records_window.response_fields });
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes, { prefs: { window: 'today', limit: 25 } });
  await waitList(page);
  const asked = seen.records.find((b) => b.window === 'today');
  assert.ok(asked, 'the list asked for the window');
  for (const [key, value] of Object.entries(C.records_window.request.body)) assert.deepEqual([key, asked[key]], [key, value]);
  assert.equal('sort' in asked, false, 'the contract request names no sort, so the server ranks the window by stake');
  assert.equal(await page.locator('.card--table tbody tr').count(), C.records_window.response_fields.window.shown);
  assert.equal(await page.locator('[data-limit]').count(), 0, 'more is 0, so no line says records are held back');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Select all matching under a limit acts on what the limit shows: the match carries the window, the limit and the as_of_us the list gave', async () => {
  const rows = keyed(60);
  const window = { window: 'all', limit: 50, shown: 50, more: 10, today: '2026-10-27' };
  const { asked, routes } = contractRoutes(rows, {
    listed: { sort: C.records_window.response_fields.sort, window, as_of_us: C.records_window.response_fields.as_of_us },
    acts: [[200, C.act_match.response], [C.act_match.over_cap.status, C.act_match.over_cap.body], [C.errors.stale_list.status, C.errors.stale_list.body],
      [C.errors.unknown_copy.status, C.errors.unknown_copy.body]],
  });
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes, { prefs: { window: 'all', limit: 50 } });
  await waitList(page);
  const markAll = async () => {
    if (await page.locator('textarea[name="bulk_note"]').count()) {
      assert.equal(await page.locator('.bulk b').innerText(), 'All 50 matching records selected', 'a refused act keeps the selection');
      assert.equal(await page.locator('textarea[name="bulk_note"]').inputValue(), C.act_match.request.body.values.note, 'a refused act keeps the note');
    } else {
      await page.getByRole('checkbox', { name: 'Select every record on this page' }).check();
      await page.getByRole('button', { name: 'Select all 50 matching' }).click();
      assert.equal(await page.locator('.bulk b').innerText(), 'All 50 matching records selected', 'the count is what the limit shows, not the 60 that match');
      await page.getByRole('button', { name: 'Mark all done…' }).click();
      await page.locator('textarea[name="bulk_note"]').fill(C.act_match.request.body.values.note);
    }
    await page.getByRole('button', { name: 'Mark 50 records done' }).click();
  };
  await markAll();
  await until(() => asked.acts.length === 1);
  const act = asked.acts[0];
  assert.deepEqual(Object.keys(act).sort(), Object.keys(C.act_match.request.body).sort());
  assert.deepEqual(Object.keys(act.match).sort(), Object.keys(C.act_match.request.body.match).sort());
  assert.deepEqual(act.values, C.act_match.request.body.values);
  assert.equal(act.match.as_of_us, C.records_window.response_fields.as_of_us, 'the match is as of the moment the list was read on the server');
  assert.deepEqual([act.match.view.window, act.match.view.window_limit, act.match.view.time_zone], ['all', 50, 'Asia/Dubai']);
  assert.deepEqual(act.match.filters, seen.records.at(-1).filters);
  await toastSaid(page, '2 of 3 matching records marked done. 1 record changed since you loaded it and was left as it is.');
  assert.deepEqual(await toastButtons(page), ['Undo']);
  assert.equal(await page.locator('.conflicts').innerText(), `1 record changed since you loaded it and was left as it is: ${label(3)}.`);
  await markAll();
  await until(() => asked.acts.length === 2);
  await toastSaid(page, 'These filters match 100,001 records. You can change up to 100,000 at once, so narrow the filters and try again.');
  const read = seen.records.length;
  await markAll();
  await until(() => asked.acts.length === 3);
  await toastSaid(page, 'The list changed since you loaded it. Reload and try again.');
  await until(() => seen.records.length > read);
  await page.waitForFunction(() => !document.querySelector('.toast.is-on'));
  await markAll();
  await until(() => asked.acts.length === 4);
  await toastSaid(page, 'The list changed since you loaded it. Reload and try again.');
  assert.deepEqual(notFetchErrors(seen.errors), []);
  await context.close();
});

test('acting on picked records sends the contract act and snooze bodies, and Undo sends the contract undo and says what it put back and what it left', async () => {
  const { asked, routes } = contractRoutes(keyed(30));
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes);
  await waitList(page);
  await page.getByRole('checkbox', { name: `Select ${label(1)}` }).check();
  await page.getByRole('button', { name: 'Set status…' }).click();
  await page.locator('select[name="bulk_choice"]').selectOption(C.act_keys.request.body.values.action_status);
  await page.locator('textarea[name="bulk_note"]').fill(C.act_keys.request.body.values.note);
  await page.getByRole('button', { name: 'Set status of 1 record' }).click();
  await until(() => asked.acts.length === 1);
  assert.deepEqual(asked.acts[0], C.act_keys.request.body);
  await page.waitForFunction(() => [...document.querySelectorAll('.toast.is-on .toast-a button')].some((b) => b.textContent === 'Undo'));
  await page.locator('.toast-a').getByRole('button', { name: 'Undo' }).click();
  await until(() => asked.undos.length === 1);
  assert.deepEqual(asked.undos[0], C.undo.request.body);
  await toastSaid(page, `Undone: 1 record is back as it was. 1 record changed since and was left as it is: ${label(2)}.`);
  await page.getByRole('checkbox', { name: `Select ${label(1)}` }).check();
  await page.getByRole('button', { name: 'Snooze…' }).click();
  await page.locator('input[name="bulk_snooze"]').fill(C.snooze.request.body.values.snooze_until);
  await page.getByRole('button', { name: 'Snooze 1 record' }).click();
  await until(() => asked.acts.length === 2);
  assert.deepEqual(asked.acts[1], C.snooze.request.body);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Apply to similar asks by the ids the page names in one by value, shows the contract count and sample, and applies the match it gave', async () => {
  const info = appInfo(DECIDE, 1, { ...TABLE, similar_by: ['category'] });
  assert.deepEqual(info.pages[0].similar_by, [{ filter: 'category', label: 'Category' }], 'the App info names similar_by on the page, with labels');
  const { asked, routes } = contractRoutes(keyed(30));
  const { page, seen, context } = await openWith(info, routes);
  await waitList(page);
  await page.locator('.cell-t').first().click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('.dr-act').waitFor();
  await drawer.getByRole('button', { name: 'Mark done' }).click();
  await until(() => asked.acts.length === 1 && asked.similar.length === 1);
  assert.deepEqual([asked.acts[0].record_keys, asked.acts[0].seen], [C.act_keys.request.body.record_keys, C.act_keys.request.body.seen]);
  assert.deepEqual(asked.similar[0], C.similar.request.query);
  await page.waitForFunction(() => document.querySelectorAll('.toast.is-on .toast-a button').length === 2);
  assert.deepEqual(await toastButtons(page), ['Undo', 'Apply to 1 similar']);
  await page.locator('.toast-a').getByRole('button', { name: 'Apply to 1 similar' }).click();
  const dialog = page.getByRole('dialog', { name: 'Apply to similar records' });
  await dialog.waitFor();
  assert.equal(await dialog.locator('h2').innerText(), `Apply to 1 record like ${label(1)}?`);
  assert.equal(await dialog.locator('header p').innerText(), 'This open record shares Category Books. Nothing changes until you apply.');
  assert.deepEqual(await dialog.locator('.sim li').allInnerTexts(), C.similar.response.sample.map((s) => s.label));
  assert.equal(asked.acts.length, 1, 'the preview writes nothing');
  await dialog.getByRole('button', { name: 'Apply to 1 record' }).click();
  await until(() => asked.acts.length === 2);
  assert.equal('record_keys' in asked.acts[1], false);
  assert.deepEqual(asked.acts[1].match, C.similar.response.match);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('Recent changes reads the contract batches, and Undo on one sends the contract undo and says what it put back', async () => {
  const { asked, routes } = contractRoutes(keyed(30));
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes);
  await waitList(page);
  await page.getByRole('button', { name: 'Recent changes' }).click();
  const dialog = page.getByRole('dialog', { name: 'Recent changes' });
  await dialog.locator('.batches li').first().waitFor();
  assert.deepEqual(await dialog.locator('.batches li > span').allInnerTexts(), ['Oct 27, 2026, 09:10 AM UTC, dana: 2 records marked done. Note: Repriced the shelf']);
  await dialog.locator(`[data-batch="${C.batches.response.batches[0].batch_id}"]`).getByRole('button', { name: 'Undo' }).click();
  await until(() => asked.undos.length === 1);
  assert.deepEqual(asked.undos[0], C.undo.request.body);
  await dialog.locator('small[role="status"]').filter({ hasText: 'Undone:' }).waitFor();
  assert.equal(await dialog.locator('small[role="status"]').innerText(), `Undone: 1 record is back as it was. 1 record changed since and was left as it is: ${label(2)}.`);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const DONE = { fixed: 0, fixed_q: 0, dismissed: 0, dismissed_q: 0, saved_n: 0, saved: 0, saved_q_n: 0, saved_q: 0, first_fixed: null, first_saved: null };
const entry = (actions, note) => ({
  visible: true, tracked: true, money: actions, actions, categories: [], served: 'delta', items: [], total: 0, truncated: false, done: DONE, weeks: [],
  runs: { updated: '2026-10-27T06:00:00Z', as_of: '2026-10-27', cadence_days: 7, next: '2026-11-03', stale: false, count: 3, failed: false },
  window_note: note,
});

test('My work asks for the contract window and names the use case it does not apply to, and names none when every use case keeps actions', async () => {
  const NOTE = 'this use case keeps no actions, so the window does not apply to it';
  for (const [second, said] of [
    [entry(false, NOTE), 'Your window does not apply to Second desk 1, because it keeps no actions.'],
    [entry(true, C.overview_window.page_fields.window_note), null],
  ]) {
    const hub = [];
    const overview = ({ route, json }) => {
      hub.push(route.request().postDataJSON());
      return json(200, { today: '2026-10-27', quarter: '2026-10-01', since: '2026-08-03', errors: {}, window: C.overview_window.response_fields.window,
        pages: { [PAGE]: entry(true, C.overview_window.page_fields.window_note), n02_u01: second } });
    };
    const { page, seen, context } = await openWith(appInfo(DECIDE, 2, TABLE), { overview }, { prefs: { window: 'week', limit: 10 }, hash: `#/${PAGE}/performance` });
    await page.getByRole('region', { name: 'Your work' }).waitFor();
    await page.waitForFunction(() => !/Loading your work/.test(document.querySelector('[aria-label="Your work"]')?.textContent || ''));
    assert.ok(hub.length > 0, 'My work asked for the work');
    assert.deepEqual(hub, hub.map(() => C.overview_window.request.body), 'every work request carries the window, the first load included');
    if (said) assert.equal(await page.locator('[data-window-note]').innerText(), said);
    else assert.equal(await page.locator('[data-window-note]').count(), 0, 'no use case to name, so no line');
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('Select all refuses with a plain reload note when the list did not say when the server read it, and never uses the browser clock', async () => {
  for (const sent of [{}, { as_of_us: '0' }]) {
    const { asked, routes } = contractRoutes(keyed(30), { listed: sent });
    const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes);
    await waitList(page);
    await page.getByRole('checkbox', { name: 'Select every record on this page' }).check();
    await page.getByRole('button', { name: 'Select all 30 matching' }).click();
    await toastSaid(page, 'The App cannot tell when this list was read, so it cannot act on every matching record. Reload the list and try again.');
    assert.equal(await page.locator('.bulk b').innerText(), '25 selected:', 'the selection stays on the records picked');
    assert.equal(await page.locator('.bulk-asof').count(), 0);
    const read = seen.records.length;
    await page.locator('.toast-a').getByRole('button', { name: 'Reload the list' }).click();
    await until(() => seen.records.length > read);
    assert.equal(asked.acts.length, 0, 'nothing is written');
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('the list sends a sort only when the person picks a column, and marks only the column the person picked', async () => {
  const { routes } = contractRoutes(keyed(3), { listed: { sort: C.records_window.response_fields.sort } });
  const { page, seen, context } = await openWith(appInfo(DECIDE, 1, TABLE), routes, { prefs: { window: 'week' } });
  await waitList(page);
  assert.ok(seen.records.length > 0 && seen.records.every((b) => !('sort' in b)), 'no sort until the person picks one');
  assert.equal(await page.locator('.card--table thead th[aria-sort]').count(), 0, 'the server ranked by stake, which is no column, so no column is marked');
  const read = seen.records.length;
  await page.locator('.card--table thead').getByRole('button', { name: /^Rank/ }).click();
  await until(() => seen.records.length > read && 'sort' in seen.records.at(-1));
  assert.equal(seen.records.at(-1).sort.key, 'rank');
  assert.equal(await page.locator('.card--table thead th[aria-sort]').count(), 1);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a run the server says has gone quiet shows the server note, with no bar, no percent, no time left and no running for', async () => {
  if (C.freshness.silent_active) assert.deepEqual(SILENT, C.freshness.silent_active, 'the quiet run here is the row the server contract names');
  const confirmed = { ...C.freshness.response.active, percent: null, eta_s: null, silent_since: SILENT.silent_since, message: SILENT.message };
  for (const active of [SILENT, confirmed]) {
    const routes = { freshness: ({ json }) => json(200, { ...C.freshness.response, active }) };
    const { page, seen, context } = await openApp(browser, served.base, appInfo(), { routes, clock: CLOCK });
    await page.locator('.ph .fresh-d [data-progress]').waitFor();
    assert.equal(await page.locator('.ph .fresh-d [data-progress]').innerText(), SILENT.message);
    assert.equal(await page.locator('.ph .fresh [role="progressbar"]').count(), 0, 'no bar, moving or not');
    assert.equal(await page.locator('.ph .fresh .fresh-dots').count(), 0, 'no moving dots');
    assert.doesNotMatch(`${await page.locator('.ph .fresh').innerText()} ${await page.locator('.ph .fresh-d').innerText()}`, /running for|left|%/);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});
