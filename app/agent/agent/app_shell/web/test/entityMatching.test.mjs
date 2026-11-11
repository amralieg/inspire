import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DECIDE, appInfo, goRail, idle, openApp, serveDist } from './harness.mjs';
import { LAYOUT_B_CASES, kindRoutes } from './exampleRoutes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ENTITY_FILE = 'entity_matching.json';
const PAGE = JSON.parse(readFileSync(join(HERE, '..', '..', 'examples', ENTITY_FILE), 'utf8'));
const CASE = LAYOUT_B_CASES.network_explorer;

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

const batchId = (n) => String(n).padStart(32, '0');

function listing(state, { failAfterAct = false } = {}) {
  const acts = [];
  let broken = false;
  const records = ({ route, json, seen }) => {
    const body = route.request().postDataJSON();
    seen.records.push(body);
    if (broken) return json(502, { error: 'INSUFFICIENT_PERMISSIONS: the changes view is not granted' });
    const rows = state.rows.slice(body.offset || 0, (body.offset || 0) + (body.limit || 25));
    return json(200, { rows, total: state.rows.length, offset: body.offset || 0, limit: body.limit || 25, actions: true, changes: false,
      as_of_us: '1', summary: { open: state.rows.length, done: state.rows.filter((r) => r._inspire_status === 'Done').length, resolved: 0,
        left: state.rows.length, owners: [] }, errors: {} });
  };
  const act = ({ route, json }) => {
    const body = route.request().postDataJSON();
    acts.push(body);
    const hit = state.rows.filter((r) => body.record_keys.includes(String(r.record_key)));
    hit.forEach((r) => Object.assign(r, { _inspire_status: body.values.action_status, _inspire_version: String(Number(r._inspire_version) + 1),
      _inspire_closed_note: body.values.note || body.values.dismiss_reason || '', _inspire_closed_batch: batchId(acts.length), _inspire_closed_can_undo: true }));
    if (failAfterAct) broken = true;
    return json(200, { written: body.record_keys, conflicts: [], batch_id: `b${acts.length}` });
  };
  const undos = [];
  const undo = ({ route, json }) => {
    const body = route.request().postDataJSON();
    undos.push(body);
    const restored = state.rows.filter((r) => r._inspire_closed_batch === body.batch_id);
    restored.forEach((r) => { delete r._inspire_status; delete r._inspire_closed_note; delete r._inspire_closed_batch; r._inspire_closed_can_undo = false; });
    return json(200, { restored: restored.map((r) => String(r.record_key)), skipped: [], left_out: 0 });
  };
  return { acts, undos, records, act, undo, setBroken: (v) => { broken = v; } };
}

function freshRows() {
  return CASE.rows.map((r) => ({ ...r }));
}

async function open(routes) {
  const info = appInfo(DECIDE, 1, {}, `examples/${ENTITY_FILE}`);
  const opened = await openApp(browser, served.base, info, { routes });
  await opened.page.locator('[data-choice-row]').first().waitFor();
  await idle(opened.page);
  return opened;
}

const rowCount = (page) => page.locator('[data-choice-row]').count();

test('entity matching: the page offers Merge, Needs review and Keep separate, never the fraud words', async () => {
  const state = { rows: freshRows() };
  const base = kindRoutes(CASE.data(), state.rows, [], PAGE);
  const { page, context, seen } = await open(base);
  const words = await page.locator('[data-choice-row="K1"] [data-choice]').allInnerTexts();
  assert.deepEqual(words.map((w) => w.replace('★ ', '').trim()), ['Merge', 'Needs review', 'Keep separate'], 'the pair offers matching words');
  const fraud = (await page.locator('[data-choice]').allInnerTexts()).filter((w) => /Block|Investigate|Not a ring/.test(w));
  assert.deepEqual(fraud, [], 'no fraud words on a duplicate-accounts page');
  await context.close();
  assert.deepEqual(seen.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});

test('entity matching: a merged pair offers Unmerge, which asks first and puts the pair back with its decision buttons', async () => {
  const state = { rows: freshRows() };
  const h = listing(state);
  const base = kindRoutes(CASE.data(), state.rows, [], PAGE);
  const { page, context, seen } = await open({ ...base, records: h.records, 'records/act': h.act, 'records/undo': h.undo });
  const before = await rowCount(page);
  await page.locator('[data-choice-row="K1"] [data-choice="merge"]').click();
  await page.locator('[data-choice-row="K1"] [data-decided]').waitFor();
  await idle(page);
  assert.equal(await page.locator('[data-choice-row="K1"] [data-decided]').count(), 1, 'the merged pair shows its outcome');
  assert.equal(await page.locator('[data-choice-row="K1"] [data-unmerge]').count(), 1, 'the merged pair offers Unmerge');
  assert.equal((await page.locator('[data-choice-row="K1"] [data-unmerge]').innerText()).trim(), 'Unmerge', 'the entity page names the undo Unmerge');
  await page.locator('[data-choice-row="K1"] [data-unmerge]').click();
  const ask = page.locator('[role="group"][aria-label="Undo this decision"]');
  await ask.waitFor();
  assert.equal(h.undos.length, 0, 'nothing is undone before the person confirms');
  await ask.getByRole('button', { name: 'Undo it' }).click();
  await idle(page);
  await page.waitForTimeout(300);
  assert.deepEqual(h.undos.map((u) => u.batch_id), [batchId(1)], 'the merge batch is undone once');
  assert.equal(await rowCount(page), before, 'no row disappears after unmerge');
  assert.equal(await page.locator('[data-choice-row="K1"] [data-decided]').count(), 0, 'the pair is open again');
  assert.equal(await page.locator('[data-choice-row="K1"] [data-choice]').count(), 3, 'the pair shows its three decision buttons again');
  assert.ok(await page.locator('[data-choice-row="K2"] [data-choice]').count() > 0, 'an untouched pair keeps its actions');
  await context.close();
  assert.deepEqual(seen.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});

test('entity matching: deciding a pair keeps every row and its actions in the list', async () => {
  const state = { rows: freshRows() };
  const h = listing(state);
  const base = kindRoutes(CASE.data(), state.rows, [], PAGE);
  const { page, context, seen } = await open({ ...base, records: h.records, 'records/act': h.act });
  const before = await rowCount(page);
  assert.ok(before >= 5, `list shows ${before} rows`);
  await page.locator('[data-choice-row="K1"] [data-choice="merge"]').click();
  await idle(page);
  assert.equal(h.acts.length, 1);
  assert.deepEqual(h.acts[0].record_keys, ['K1']);
  assert.ok(h.acts[0].values.action_status, 'the act writes a status');
  assert.equal(await rowCount(page), before, 'no row disappears after an act');
  assert.equal(await page.locator('[data-choice-row="K1"] [data-decided]').count(), 1, 'the decided pair shows its outcome');
  assert.ok(await page.locator('[data-choice-row="K2"] [data-choice]').count() > 0, 'an undecided pair keeps its actions');
  await context.close();
  assert.equal(seen.errors.length, 0, seen.errors.join('\n'));
});

test('entity matching: a refresh that fails after an act keeps every row and its actions', async () => {
  const state = { rows: freshRows() };
  const h = listing(state, { failAfterAct: true });
  const base = kindRoutes(CASE.data(), state.rows, [], PAGE);
  const { page, context } = await open({ ...base, records: h.records, 'records/act': h.act });
  const before = await rowCount(page);
  await page.locator('[data-choice-row="K3"] [data-choice="review"]').click();
  await idle(page);
  await page.waitForTimeout(300);
  assert.equal(h.acts.length, 1);
  assert.equal(await rowCount(page), before, 'rows survive the failed refresh');
  assert.ok(await page.locator('[data-choice-row="K4"] [data-choice]').count() > 0, 'row actions survive the failed refresh');
  await context.close();
});

test('entity matching: "keep separate" (dismissal) needs a reason before it is written', async () => {
  const state = { rows: freshRows() };
  const h = listing(state);
  const base = kindRoutes(CASE.data(), state.rows, [], PAGE);
  const { page, context } = await open({ ...base, records: h.records, 'records/act': h.act });
  await page.locator('[data-choice-row="K2"] [data-choice="separate"]').click();
  const reasons = page.locator('[role="group"][aria-label="Why keep separate"] .chip');
  await reasons.first().waitFor();
  assert.equal(h.acts.length, 0, 'nothing is written before a reason is picked');
  await context.close();
});

const MANY = Array.from({ length: 60 }, (_, i) => {
  const key = `N${String(i + 1).padStart(2, '0')}`;
  return { ...CASE.rows[i % CASE.rows.length], record_key: key, _inspire_key: key, entity_id: key, entity_label: `Account ${i + 1}`, _inspire_version: String(900 + i) };
});

test('entity matching: a long list pages in order and searches by account name', async () => {
  const state = { rows: MANY.map((r) => ({ ...r })) };
  const base = kindRoutes(CASE.data(), state.rows, [], PAGE);
  const records = (ctx) => {
    const body = ctx.route.request().postDataJSON();
    ctx.seen.records.push(body);
    const words = String(body.search || '').toLowerCase();
    const found = state.rows.filter((r) => !words || String(r.entity_label).toLowerCase().includes(words));
    const offset = body.offset || 0;
    const limit = body.limit || 25;
    return ctx.json(200, { rows: found.slice(offset, offset + limit), total: found.length, offset, limit, actions: true, changes: false,
      summary: { open: found.length, done: 0, resolved: 0, left: found.length, owners: [] }, errors: {} });
  };
  const { page, context, seen } = await open({ ...base, records });
  await goRail(page, 'work');
  await idle(page);
  const labels = () => page.locator('table tbody tr').evaluateAll((n) => n.map((x) => x.textContent || ''));
  await page.locator('table tbody tr').first().waitFor();
  const first = await labels();
  assert.ok(first.length > 0 && first.length < 60, `first page shows ${first.length} of 60 rows`);
  assert.ok(first[0].includes('Account 1'), 'the first page starts at the first account');
  await page.locator('[aria-label="Next page"]').first().click();
  await page.waitForFunction((was) => document.querySelector('table tbody tr')?.textContent !== was, first[0]);
  await idle(page);
  const second = await labels();
  assert.ok(second[0].includes(`Account ${first.length + 1}`), `the next page starts after the first page: ${second[0].slice(0, 40)}`);
  await page.locator('.search input').first().fill('Account 7');
  await page.waitForFunction(() => document.querySelectorAll('table tbody tr').length < 25);
  await idle(page);
  const hits = await labels();
  assert.ok(hits.length > 0 && hits.length < 60, 'search narrows the list');
  assert.ok(hits.every((t) => t.includes('Account 7')), 'every hit matches the search: ' + JSON.stringify(hits.map((t) => t.slice(0, 40))));
  await context.close();
  assert.deepEqual(seen.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});

const DUP_NAMES = ['Northwind Trading', 'Northwind Trading Ltd', 'N. Wind Trading', 'Blue Harbor Foods', 'Blue Harbour Foods', 'Aster Logistics',
  'Aster Logistics LLC', 'Cobalt Labs', 'Cobalt Labs Inc', 'Evergreen Supply', 'Evergreen Supply Co', 'Fjord Pharma'];
const DUP_ROWS = DUP_NAMES.map((name, i) => ({ record_key: `D${String(i + 1).padStart(2, '0')}`, _inspire_key: `D${String(i + 1).padStart(2, '0')}`,
  _inspire_version: String(300 + i), entity_id: `D${String(i + 1).padStart(2, '0')}`, entity_label: name, community: `Cluster ${Math.floor(i / 2) + 1}`,
  centrality: 0.95 - i * 0.02, metric: 12000 - i * 500, node: name, recommended_action: i % 3 === 2 ? 'Needs review by a steward' : 'Merge into the lead record',
  top_reasons: ['same tax number'], priority_tier: 'Act now', rank: i + 1, as_of_date: '2026-10-15' }));

function dupListing(state, { failAfterAct = false } = {}) {
  const h = listing(state, { failAfterAct });
  return h;
}

const DUP_PAGE = 'entity_matching.json';

test('entity matching group: Take all suggestions merges every suggested pair, keeps every row and its decision buttons', async () => {
  const state = { rows: DUP_ROWS.map((r) => ({ ...r })) };
  const h = dupListing(state);
  const info = appInfo(DECIDE, 1, {}, `examples/${DUP_PAGE}`);
  const base = kindRoutes(CASE.data(), state.rows, [], JSON.parse(readFileSync(join(HERE, '..', '..', 'examples', DUP_PAGE), 'utf8')));
  const { page, context, seen } = await openApp(browser, served.base, info, { routes: { ...base, records: h.records, 'records/act': h.act } });
  await page.locator('[data-choice-row]').first().waitFor();
  await idle(page);
  const before = await rowCount(page);
  assert.equal(before, DUP_ROWS.length, 'every duplicate pair is listed');
  const takeAll = page.locator('[data-take-all]');
  assert.equal(await takeAll.count(), 1, 'the group action is offered');
  await takeAll.click();
  await idle(page);
  await page.waitForTimeout(300);
  const statusOf = Object.fromEntries(h.acts.flatMap((a) => a.record_keys.map((k) => [k, a.values.action_status])));
  const merged = DUP_ROWS.filter((r) => r.recommended_action.startsWith('Merge')).map((r) => r.record_key);
  const review = DUP_ROWS.filter((r) => !r.recommended_action.startsWith('Merge')).map((r) => r.record_key);
  assert.deepEqual(Object.keys(statusOf).sort(), DUP_ROWS.map((r) => r.record_key).sort(), 'every suggested pair was written once');
  assert.ok(merged.every((k) => statusOf[k] === 'Done'), 'merge suggestions write Done');
  assert.ok(review.every((k) => statusOf[k] === 'In progress'), 'steward-review suggestions write In progress');
  assert.equal(await rowCount(page), before, 'no row disappears after the group action');
  assert.equal(await page.locator('[data-choice-row] [data-decided]').count(), merged.length, 'every merged pair shows its outcome');
  assert.ok(await page.locator(`[data-choice-row="${review[0]}"] [data-choice]`).count() > 0, 'a pair left for review keeps its buttons');
  await context.close();
  assert.deepEqual(seen.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});

test('entity matching group: a group action whose refresh fails keeps every row and its decision buttons', async () => {
  const state = { rows: DUP_ROWS.map((r) => ({ ...r })) };
  const h = dupListing(state, { failAfterAct: true });
  const info = appInfo(DECIDE, 1, {}, `examples/${DUP_PAGE}`);
  const base = kindRoutes(CASE.data(), state.rows, [], JSON.parse(readFileSync(join(HERE, '..', '..', 'examples', DUP_PAGE), 'utf8')));
  const { page, context } = await openApp(browser, served.base, info, { routes: { ...base, records: h.records, 'records/act': h.act } });
  await page.locator('[data-choice-row]').first().waitFor();
  await idle(page);
  await page.locator('[data-take-all]').click();
  await idle(page);
  await page.waitForTimeout(300);
  assert.ok(h.acts.length >= 1, 'the group action was written');
  assert.equal(await rowCount(page), DUP_ROWS.length, 'rows survive the failed refresh');
  assert.ok(await page.locator('[data-choice-row] [data-choice]').count() > 0, 'decision buttons survive the failed refresh');
  await context.close();
});

test('a decision list whose kind names no undo word says Undo, not Unmerge', async () => {
  const state = { rows: freshRows() };
  const h = listing(state);
  const info = appInfo(DECIDE, 1, {}, 'examples/network_explorer.json');
  const spec = JSON.parse(readFileSync(join(HERE, '..', '..', 'examples', 'network_explorer.json'), 'utf8'));
  const base = kindRoutes(CASE.data(), state.rows, [], spec);
  const { page, context, seen } = await openApp(browser, served.base, info, { routes: { ...base, records: h.records, 'records/act': h.act, 'records/undo': h.undo } });
  await page.locator('[data-choice-row]').first().waitFor();
  await idle(page);
  await page.locator('[data-choice-row="K1"] [data-choice="block"]').click();
  await idle(page);
  assert.equal((await page.locator('[data-choice-row="K1"] [data-unmerge]').innerText()).trim(), 'Undo', 'the generic word');
  await context.close();
  assert.deepEqual(seen.errors.filter((e) => !/Failed to load resource/.test(e)), []);
});
