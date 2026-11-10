import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DECIDE, appInfo, goRail, idle, openApp, serveDist } from './harness.mjs';
import { LAYOUT_B_CASES, kindRoutes } from './exampleRoutes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const PAGE = JSON.parse(readFileSync(join(HERE, '..', '..', 'examples', 'network_explorer.json'), 'utf8'));
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
      _inspire_closed_note: body.values.note || body.values.dismiss_reason || '' }));
    if (failAfterAct) broken = true;
    return json(200, { written: body.record_keys, conflicts: [], batch_id: `b${acts.length}` });
  };
  return { acts, records, act, setBroken: (v) => { broken = v; } };
}

function freshRows() {
  return CASE.rows.map((r) => ({ ...r }));
}

async function open(routes) {
  const info = appInfo(DECIDE, 1, {}, 'examples/network_explorer.json');
  const opened = await openApp(browser, served.base, info, { routes });
  await opened.page.locator('[data-choice-row]').first().waitFor();
  await idle(opened.page);
  return opened;
}

const rowCount = (page) => page.locator('[data-choice-row]').count();

test('entity matching: deciding a pair keeps every row and its actions in the list', async () => {
  const state = { rows: freshRows() };
  const h = listing(state);
  const base = kindRoutes(CASE.data(), state.rows, [], PAGE);
  const { page, context, seen } = await open({ ...base, records: h.records, 'records/act': h.act });
  const before = await rowCount(page);
  assert.ok(before >= 5, `list shows ${before} rows`);
  await page.locator('[data-choice-row="K1"] [data-choice="block"]').click();
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
  await page.locator('[data-choice-row="K3"] [data-choice="investigate"]').click();
  await idle(page);
  await page.waitForTimeout(300);
  assert.equal(h.acts.length, 1);
  assert.equal(await rowCount(page), before, 'rows survive the failed refresh');
  assert.ok(await page.locator('[data-choice-row="K4"] [data-choice]').count() > 0, 'row actions survive the failed refresh');
  await context.close();
});

test('entity matching: "not a ring" (dismissal) needs a reason before it is written', async () => {
  const state = { rows: freshRows() };
  const h = listing(state);
  const base = kindRoutes(CASE.data(), state.rows, [], PAGE);
  const { page, context } = await open({ ...base, records: h.records, 'records/act': h.act });
  await page.locator('[data-choice-row="K2"] [data-choice="not_ring"]').click();
  const reasons = page.locator('[role="group"][aria-label^="Why"] .chip');
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
