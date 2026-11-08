import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { TABLE, appInfo, openApp, serveDist, steadyBox, until } from './harness.mjs';

let served;
let base;
let browser;

before(async () => {
  served = await serveDist();
  base = served.base;
  browser = await chromium.launch();
});

after(async () => {
  await browser?.close();
  served?.close();
});

const MODIFY = { options: { modify: true, replace_edits: false, decisions: false } };
const F = (name, kind, role = 'business', type = 'STRING') => ({ name, kind, role, type, editable: role === 'business' && kind != null });
const FIELDS = [F('entity_id', 'text', 'id'), F('entity_label', 'text'), F('priority_tier', 'text'), F('rank', 'integer', 'business', 'INT'),
  F('value', 'decimal', 'business', 'DECIMAL'), F('due', 'date', 'business', 'DATE'), F('flagged', 'boolean', 'business', 'BOOLEAN'),
  F('top_reasons', 'lines', 'business', 'ARRAY'), F('recommended_action', 'text'), F('as_of_date', 'date', 'run', 'DATE'),
  F('run_id', 'integer', 'run', 'LONG'), F('record_key', 'text', 'history'), F('valid_from', 'timestamp', 'history', 'TIMESTAMP'),
  F('valid_to', 'timestamp', 'history', 'TIMESTAMP'), F('is_current', 'boolean', 'history', 'BOOLEAN'), F('change_source', 'text', 'history'),
  F('changed_by', 'text', 'history')];
const BASE = { entity_id: 'R001', entity_label: 'Item number 1 with a long descriptive name', priority_tier: 'Act now', rank: 1, value: 50000, due: null,
  flagged: false, top_reasons: ['high discount depth', 'falling margin'], recommended_action: 'Cut the standing discount to 10%', as_of_date: '2026-10-15',
  run_id: 77, record_key: 'R001' };
const V1 = { ...BASE, valid_from: '2026-10-15T06:00:00.000Z', valid_to: '2026-10-20T09:00:00.000Z', is_current: false, change_source: 'run', changed_by: 'run 77', valid_from_us: '101' };
const V2 = { ...BASE, recommended_action: 'Hold the price for a month', valid_from: '2026-10-20T09:00:00.000Z', valid_to: null, is_current: true,
  change_source: 'edit', changed_by: 'sam.roe', valid_from_us: '102' };
const history = (versions = [V1, V2]) => ({ record_key: 'R001', fields: FIELDS, versions, current: versions.at(-1), deleted: versions.at(-1).change_source === 'delete', truncated: false });

function recorder(overrides = {}) {
  const calls = { history: [], writes: [], runs: 0 };
  const routes = {
    'records/history': ({ json, url }) => { calls.history.push(Object.fromEntries(url.searchParams)); return json(200, history()); },
    'records/fields': ({ json }) => json(200, { fields: FIELDS, key_field: 'entity_id' }),
    ...Object.fromEntries(['edit', 'add', 'delete'].map((kind) => [`records/${kind}`, ({ route, json }) => {
      calls.writes.push({ kind, body: route.request().postDataJSON() });
      return json(200, history(kind === 'delete' ? [V1, V2, { ...V2, change_source: 'delete', valid_from_us: '103' }] : [V1, V2]));
    }])),
    ...overrides,
  };
  return { calls, routes };
}

const open = (info, routes, options = {}) => openApp(browser, base, info, { hash: '#/n01_u05/work', ...options, routes });

test('without the modify option the list shows no edit control, and the drawer still shows the history', async () => {
  const { calls, routes } = recorder();
  const { page, seen, context } = await open(appInfo({}, 1, TABLE), routes);
  assert.equal(await page.getByRole('button', { name: 'Add record' }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /^Edit / }).count(), 0);
  assert.equal(await page.getByRole('button', { name: /^Delete / }).count(), 0);
  assert.equal(await page.locator('.card--table .note').count(), 0);
  assert.equal(await page.locator('[data-rail="runs"]').count(), 1);
  await page.locator('.cell-t').first().click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('.hist-i').first().waitFor();
  assert.deepEqual(calls.history[0], { page: 'n01_u05', key: 'R001' });
  assert.deepEqual(await drawer.locator('.hist-h b').allInnerTexts(), ['v2 · Edited · current', 'v1 · Written by the job']);
  assert.match(await drawer.locator('.hist-i').first().innerText(), /Recommended action: Cut the standing discount to 10% → Hold the price for a month/);
  assert.equal(await drawer.locator('.hist-i').first().locator('s').innerText(), 'Cut the standing discount to 10%');
  assert.equal(await drawer.locator('.hist .chg').first().innerText(), 'Hold the price for a month');
  assert.match(await drawer.locator('.hist-i').nth(1).innerText(), /the job, run 77 · Oct 15, 2026.*First version, from the run of Oct 15, 2026\./s);
  assert.deepEqual(await drawer.locator('.dr-f button').allInnerTexts(), ['Close']);
  assert.equal(await drawer.locator('.unexplained .explain-btn').count(), 1, 'a record without AI text offers Explain where its reason would be');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a page without a result table offers Things to fix and Runs, but no history', async () => {
  const { calls, routes } = recorder();
  const { page, seen, context } = await open(appInfo(), routes);
  assert.equal(await page.locator('[role="tab"]').count(), 0);
  assert.equal(await page.locator('[data-rail="work"]').getAttribute('aria-current'), 'page');
  await page.locator('.cell-t').first().click();
  await page.locator('dialog.drawer').waitFor({ state: 'visible' });
  assert.equal(await page.locator('.dr-hist').count(), 0);
  assert.equal(calls.history.length, 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('an edit sends only the changed values with the version it read, then refreshes the page', async () => {
  const { calls, routes } = recorder();
  const { page, seen, context } = await open(appInfo(MODIFY, 1, TABLE), routes);
  assert.match(await page.locator('.card--table .note').innerText(), /New runs keep your edits/);
  await page.getByRole('button', { name: 'Edit Item number 1 with a long descriptive name' }).click();
  const dialog = page.locator('dialog.dialog');
  await dialog.locator('.fgrid').waitFor();
  assert.match(await dialog.locator('.dlg-meta').innerText(), /Last change by sam\.roe on Oct 20, 2026/);
  assert.equal(await dialog.locator('input[name="rank"]').getAttribute('type'), 'number');
  assert.equal(await dialog.locator('input[name="value"]').getAttribute('step'), 'any');
  assert.equal(await dialog.locator('input[name="due"]').getAttribute('type'), 'date');
  assert.equal(await dialog.locator('select[name="flagged"]').inputValue(), 'false');
  assert.equal(await dialog.locator('textarea[name="top_reasons"]').inputValue(), 'high discount depth\nfalling margin');
  assert.equal(await dialog.locator('textarea[name="recommended_action"]').inputValue(), 'Hold the price for a month');
  for (const locked of ['entity_id', 'as_of_date', 'run_id', 'record_key', 'valid_from', 'change_source', 'changed_by']) {
    assert.equal(await dialog.locator(`[name="${locked}"]`).count(), 0, locked);
  }
  const pagesBefore = seen.pages.length;
  await dialog.locator('input[name="value"]').fill('45000');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await until(() => calls.writes.length === 1);
  assert.deepEqual(calls.writes[0], { kind: 'edit', body: { page: 'n01_u05', record_key: 'R001', valid_from_us: '102', values: { value: '45000' } } });
  await page.locator('.toast.is-on').waitFor();
  assert.match(await page.locator('.toast').innerText(), /Saved as a new version/);
  await dialog.waitFor({ state: 'detached' });
  await until(() => seen.pages.length > pagesBefore);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the list says whether a new run keeps or replaces the edits', async () => {
  const { routes } = recorder();
  const kept = await open(appInfo(MODIFY, 1, TABLE), routes);
  assert.equal(await kept.page.locator('.card--table .note').innerText(),
    'Edit, add or delete records; each change is kept as a version. New runs keep your edits: a record you changed keeps your values when the job runs again, and stays on the list tagged Not in the latest run when a run no longer lists it.');
  await kept.context.close();
  const replaced = await open(appInfo({ options: { modify: true, replace_edits: true, decisions: false } }, 1, TABLE), routes);
  assert.equal(await replaced.page.locator('.card--table .note').innerText(),
    'Edit, add or delete records; each change is kept as a version. The next run replaces edited records with its own values, and your edits stay in each record\u2019s history.');
  assert.deepEqual([...kept.seen.errors, ...replaced.seen.errors], []);
  await replaced.context.close();
});

test('editing from the drawer opens the form over it and reloads the history after the save', async () => {
  const { calls, routes } = recorder();
  const { page, seen, context } = await open(appInfo(MODIFY, 1, TABLE), routes);
  await page.locator('.cell-t').first().click();
  const drawer = page.locator('dialog.drawer');
  await drawer.locator('.hist-i').first().waitFor();
  const loads = calls.history.length;
  await drawer.getByRole('button', { name: 'Edit', exact: true }).click();
  const form = page.locator('dialog.dialog');
  await form.locator('.fgrid').waitFor();
  await form.locator('input[name="rank"]').fill('2');
  await form.getByRole('button', { name: 'Save' }).click();
  await until(() => calls.writes.length === 1);
  assert.deepEqual(calls.writes[0].body.values, { rank: '2' });
  await form.waitFor({ state: 'detached' });
  await until(() => calls.history.length >= loads + 2);
  assert.equal(await drawer.isVisible(), true);
  assert.deepEqual(calls.history.at(-1), { page: 'n01_u05', record_key: 'R001' });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a stale edit shows who changed the record and reloads it on request', async () => {
  const message = 'sam.roe changed this record on Oct 27, 2026 at 3:01 UTC, after you opened it. Reload it to see that change, then make yours again';
  let reply = { error: message, code: 'stale_record' };
  const { calls, routes } = recorder({ 'records/edit': ({ route, json }) => { calls.writes.push(route.request().postDataJSON()); return json(409, reply); } });
  const { page, seen, context } = await open(appInfo(MODIFY, 1, TABLE), routes);
  await page.getByRole('button', { name: 'Edit Item number 1 with a long descriptive name' }).click();
  const dialog = page.locator('dialog.dialog');
  await dialog.locator('.fgrid').waitFor();
  await dialog.locator('input[name="entity_label"]').fill('Renamed');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await dialog.locator('.hint--box').waitFor();
  assert.equal(await dialog.locator('.hint--box span').innerText(), message);
  const loads = calls.history.length;
  await dialog.getByRole('button', { name: 'Reload the record' }).click();
  await until(() => calls.history.length === loads + 1);
  await dialog.locator('.fgrid').waitFor();
  assert.equal(await dialog.locator('input[name="entity_label"]').inputValue(), BASE.entity_label);
  assert.equal(await dialog.locator('.hint--box').count(), 0);
  reply = { error: 'this page names no result table, so its records keep no history' };
  await dialog.locator('input[name="entity_label"]').fill('Renamed again');
  await dialog.getByRole('button', { name: 'Save' }).click();
  await dialog.locator('.hint--box').waitFor();
  assert.equal(await dialog.locator('.hint--box span').innerText(), reply.error);
  assert.equal(await dialog.getByRole('button', { name: 'Reload the record' }).count(), 0, 'a refusal that is not a newer version offers no reload');
  assert.deepEqual(seen.errors.filter((e) => !/409/.test(e)), []);
  await context.close();
});

test('delete asks first, then sends the version it read', async () => {
  const { calls, routes } = recorder();
  const { page, seen, context } = await open(appInfo(MODIFY, 1, TABLE), routes);
  await page.getByRole('button', { name: 'Delete Item number 1 with a long descriptive name' }).click();
  const dialog = page.locator('dialog.dialog');
  await dialog.locator('.dlg-meta').waitFor();
  assert.match(await dialog.locator('h2').innerText(), /^Delete Item number 1 with a long descriptive name\?$/);
  assert.equal(calls.writes.length, 0);
  await dialog.getByRole('button', { name: 'Delete' }).click();
  await until(() => calls.writes.length === 1);
  assert.deepEqual(calls.writes[0], { kind: 'delete', body: { page: 'n01_u05', record_key: 'R001', valid_from_us: '102' } });
  await page.locator('.toast.is-on').waitFor();
  assert.match(await page.locator('.toast').innerText(), /Record deleted/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('add needs the id, then sends the filled values', async () => {
  const { calls, routes } = recorder();
  const { page, seen, context } = await open(appInfo(MODIFY, 1, TABLE), routes);
  await page.getByRole('button', { name: 'Add record' }).click();
  const dialog = page.locator('dialog.dialog');
  await dialog.locator('.fgrid').waitFor();
  assert.equal(await dialog.locator('.in').first().locator('span').innerText(), 'Id *');
  await dialog.getByRole('button', { name: 'Add record' }).click();
  assert.equal(await dialog.locator('.in-err').innerText(), 'A new record needs this id');
  assert.equal(calls.writes.length, 0);
  await dialog.locator('input[name="entity_id"]').fill('R099');
  await dialog.locator('input[name="entity_label"]').fill('Walk-in item');
  assert.ok(await dialog.locator('datalist#dl-priority_tier option').count() >= 3);
  await dialog.locator('input[name="rank"]').fill('4');
  await dialog.getByRole('button', { name: 'Add record' }).click();
  await until(() => calls.writes.length === 1);
  assert.deepEqual(calls.writes[0], { kind: 'add', body: { page: 'n01_u05', values: { entity_id: 'R099', entity_label: 'Walk-in item', rank: '4' } } });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the Runs button opens from the keyboard and hides the filters', async () => {
  const run = (run_id, started) => ({ run_id, job_run_id: null, url: '', started, ended: null, duration_s: 60, status: 'done', trigger: 'schedule', by: '',
    segments: [], tables: null, records: 50, to_fix: 20, could_save: null, currency: '', summary: '', nothing_to_act: '', error: '' });
  const runs = [run('81', '2026-10-17T06:00:00Z'), run('80', '2026-09-26T06:00:00Z'), run('79', '2026-09-15T06:00:00Z'), run('78', '2026-09-08T06:00:00Z')];
  const { calls, routes } = recorder({ runs: ({ json }) => { calls.runs += 1; return json(200, { runs, total: 4, offset: 0, limit: 20, job: null, errors: {} }); } });
  const { page, seen, context } = await open(appInfo({}, 1, TABLE), routes);
  await page.locator('[data-rail="runs"]').focus();
  await page.keyboard.press('Enter');
  await page.waitForFunction(() => document.querySelector('[data-rail="runs"]')?.getAttribute('aria-current') === 'page');
  assert.equal(await page.evaluate(() => document.activeElement?.dataset.rail), 'runs');
  await page.locator('.runs tbody tr').first().waitFor();
  assert.equal(calls.runs, 1);
  assert.equal(await page.locator('.fbar').count(), 0);
  assert.equal(await page.locator('.runs tbody tr').count(), 4);
  assert.deepEqual(await page.locator('.runs tbody .run-st').allInnerTexts(), ['Done', 'Done', 'Done', 'Done']);
  assert.match(await page.locator('.runs tbody tr').first().innerText(), /^\s*Oct 17, 06:00 AM UTC\s+1 min\s+Done\s+Scheduled\s+All data\s+50\s+20\s+none\s+Ask Genie\s*$/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('on a phone the views and the edit form fit without sideways scroll', async () => {
  const { routes } = recorder();
  const { page, seen, context } = await open(appInfo(MODIFY, 1, TABLE), routes, { width: 390, height: 844 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1));
  const views = await steadyBox(page, page.getByRole('button', { name: 'Views', exact: true }));
  assert.ok(views.x >= 0 && views.x + views.width <= 391);
  await page.getByRole('button', { name: 'Add record' }).click();
  const dialog = page.locator('dialog.dialog');
  await dialog.locator('.fgrid').waitFor();
  const columns = await dialog.locator('.fgrid').evaluate((el) => getComputedStyle(el).gridTemplateColumns.split(' ').length);
  assert.equal(columns, 1);
  const box = await steadyBox(page, dialog.locator('.dlg'));
  assert.ok(box.x >= 0 && box.x + box.width <= 391, JSON.stringify(box));
  assert.deepEqual(seen.errors, []);
  await context.close();
});
