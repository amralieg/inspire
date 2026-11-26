import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { actBody, appInfo, DECIDE, HISTORY, lister, openApp, PERSON, prefsFirst, ROWS, serveDist, SUMMARY, TABLE, tracked } from './harness.mjs';

// REQ-542 (W-4): the One-by-One wizard. Click only, 1280x800, every /api route mocked. The focus spec comes from focus_defaults.json,
// re-bound to the fixture columns (server/public_page drops focus_spec, so the test puts it on the page the way the AI will write it).
const DEFAULTS = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'focus_defaults.json'), 'utf8')).defaults;
const COLUMNS = { label: 'entity_label', group: 'category', value: 'value', before: 'before', after: 'after', threshold: 'threshold', when: 'as_of_date' };
const rebind = (kind) => {
  const spec = structuredClone(DEFAULTS[kind]);
  spec.queue.order.column = COLUMNS[spec.queue.order.column];
  spec.queue.cohort_column = COLUMNS[spec.queue.cohort_column];
  spec.queue.filter = "status = 'open'";
  for (const step of spec.steps) for (const [role, column] of Object.entries(step.visual.bind)) step.visual.bind[role] = COLUMNS[column];
  return spec;
};
const ALLOCATION = rebind('allocation');
const ANOMALY = rebind('anomaly');
const MY = 'inspire-app-my';
const PREFS = { workMode: 'auto', help: 'expert', motion: 'calm' };
const STILL = (p) => p.emulateMedia({ reducedMotion: 'reduce' });

// Three open records, neutral names, every column the two specs bind.
const THREE = ROWS.slice(0, 3).map((r, i) => ({ ...r, value: 300 - i * 50, before: 120 + i * 10, after: 90 + i * 10, threshold: 200, category: ['Books', 'Books', 'Music'][i],
  _inspire_status: null, _inspire_owner: null }));
const label = (i) => THREE[i].entity_label;

let served;
let browser;
before(async () => { served = await serveDist(); browser = await chromium.launch(); });
after(async () => { await browser?.close(); served?.close(); });

const compareReply = (mode, n) => ({ mode, measure: 'value', direction: 'higher', this: { key: 'R001', x: 300 },
  points: Array.from({ length: n }, (_, i) => ({ key: `P${i}`, name: `Peer ${i + 1}`, x: 100 + i * 30, ...(mode === 'history' ? { t: `2026-0${i + 1}-01` } : {}) })),
  band: [150, 260], n, note: `Compared with ${n} others.` });

async function openFocus({ spec = ALLOCATION, routes = {}, reduced = false, noSpec = false, info = appInfo(DECIDE, 1, TABLE) } = {}) {
  if (!noSpec) info.pages[0].focus_spec = spec;
  const wired = tracked({ records: lister(THREE, { actions: true, changes: true, summary: SUMMARY }), 'records/history': ({ json, url }) => json(200, { ...HISTORY, record_key: url.searchParams.get('record_key') }),
    'records/compare': ({ json, url, seen }) => { (seen.compares ||= []).push(Object.fromEntries(url.searchParams)); return json(200, compareReply(url.searchParams.get('mode'), 4)); },
    'genie/ask': ({ route, json, seen }) => { seen.asks.push(route.request().postDataJSON()); return json(200, { conversation_id: 'c1', message_id: 'm1' }); },
    'genie/message': ({ json }) => json(200, { state: 'done', text: 'Reprice the first one before the others.', sql: 'SELECT 1', truncated: false,
      columns: [{ name: 'entity_label', type: 'STRING' }, { name: 'value', type: 'DOUBLE' }], rows: [{ entity_label: label(0), value: 300 }, { entity_label: label(1), value: 250 }] }),
    ...routes });
  const opened = await openApp(browser, served.base, info, { routes: wired.routes, hash: '#/n01_u05/work', width: 1280, height: 800, timezone: 'Asia/Dubai',
    watch: async (page) => { await prefsFirst(MY, PERSON, PREFS)(page); if (reduced) await STILL(page); } });
  return { ...opened, calls: wired.calls };
}
const wizard = (page) => page.locator('[data-focus]');
const stepBox = (page) => page.locator('[data-focus-step]');
const button = (page, name) => page.getByRole('button', { name, exact: true });
const at = (page, text) => page.waitForFunction((t) => document.querySelector('[data-focus-count]')?.textContent.trim() === t, text);
const stepId = (page) => stepBox(page).getAttribute('data-step-id');

for (const [kind, spec, block] of [['allocation', ALLOCATION, 'before_after'], ['anomaly', ANOMALY, 'strip']]) {
  test(`(a) ${kind}: the page opens One by one at "Item 1 of 3" and step 1 draws an svg with marks, never "No data to draw"`, async () => {
    const { page, context } = await openFocus({ spec });
    await wizard(page).waitFor();
    await at(page, 'Item 1 of 3');
    assert.equal(await button(page, 'One by one').getAttribute('aria-pressed'), 'true');
    assert.equal(await stepBox(page).locator('[data-focus-question]').innerText(), spec.steps[0].question);
    const viz = stepBox(page).locator(`[data-viz="${block}"]`);
    await viz.waitFor();
    assert.ok(await viz.locator('svg').count() >= 1, 'the block is an svg');
    assert.ok(await viz.locator('svg .vz-mark').count() > 0, 'the svg has marks');
    assert.equal(await page.getByText('No data to draw').count(), 0);
    assert.equal(await page.locator('[data-focus-dots] [data-dot]').count(), 3, 'one dot per step');
    await context.close();
  });
}

test('(b) Next and Back move between steps, and Skip item goes to item 2', async () => {
  const { page, context } = await openFocus();
  await at(page, 'Item 1 of 3');
  assert.equal(await stepId(page), 's1');
  await button(page, 'Next').click();
  assert.equal(await stepId(page), 's2');
  await button(page, 'Back').click();
  assert.equal(await stepId(page), 's1');
  for (const name of ['Back', 'Skip item', 'Switch to All records']) assert.equal(await button(page, name).isVisible(), true, `${name} is always visible`);
  await button(page, 'Skip item').click();
  await at(page, 'Item 2 of 3');
  assert.equal(await stepId(page), 's1', 'a new item starts at step 1');
  await context.close();
});

test('(c) a decide choice calls the action route once with the right action and record, then item 2 slides in', async () => {
  const { page, calls, context } = await openFocus();
  await at(page, 'Item 1 of 3');
  await button(page, 'Next').click();
  await button(page, 'Next').click();
  assert.equal(await stepId(page), 's3');
  await button(page, 'Mark done').click();
  await at(page, 'Item 2 of 3');
  assert.equal(calls.acts.length, 1, 'one write');
  assert.deepEqual(calls.acts[0].record_keys, [THREE[0].record_key]);
  assert.equal(calls.acts[0].values.action_status, 'Done');
  assert.equal(await page.locator('[data-focus-item]').getAttribute('data-key'), THREE[1].record_key);
  await context.close();
});

test('(d) a 409 from the action route shows its plain message, stays on the item and does not advance', async () => {
  const { page, context } = await openFocus({ routes: { 'records/act': ({ route, json }) => { actBody(route); return json(409, { message: 'Someone else changed this record. Reload to see it.', code: 'stale' }); } } });
  await at(page, 'Item 1 of 3');
  await button(page, 'Next').click();
  await button(page, 'Next').click();
  await button(page, 'Mark done').click();
  await page.getByText('Someone else changed this record. Reload to see it.').waitFor();
  assert.equal((await page.locator('[data-focus-count]').innerText()).trim(), 'Item 1 of 3');
  assert.equal(await stepId(page), 's3');
  await context.close();
});

test('(e) the compare toggle draws the mocked points for population then cohort, and a 404 hides the toggle', async () => {
  const { page, seen, context } = await openFocus();
  await at(page, 'Item 1 of 3');
  await button(page, 'Next').click();
  assert.equal(await stepId(page), 's2');
  const chart = page.locator('[data-focus-compare-chart]');
  await button(page, 'Population').click();
  await chart.locator('svg').waitFor();
  assert.equal(await chart.locator('svg circle.vz-mark').count(), 4 + 1, 'four points plus this record');
  await button(page, 'Cohort').click();
  await page.waitForFunction(() => document.querySelector('[data-focus-compare-chart]')?.getAttribute('data-mode') === 'cohort');
  assert.equal(await chart.locator('svg circle.vz-mark').count(), 4 + 1);
  const modes = seen.compares.map((q) => q.mode);
  assert.ok(modes.includes('population') && modes.includes('cohort'), `asked ${modes}`);
  const cohort = seen.compares.find((q) => q.mode === 'cohort');
  assert.equal(cohort.page, 'n01_u05');
  assert.equal(cohort.record_key, THREE[0].record_key);
  assert.equal(cohort.measure, 'value');
  assert.equal(cohort.cohort_column, 'category');
  await context.close();

  const gone = await openFocus({ routes: { 'records/compare': ({ json }) => json(404, { message: 'not found' }) } });
  await at(gone.page, 'Item 1 of 3');
  await button(gone.page, 'Next').click();
  await gone.page.locator('[data-focus-step][data-step-id="s2"]').waitFor();
  await gone.page.waitForFunction(() => !document.querySelector('[data-focus-compare]'));
  assert.equal(await gone.page.locator('[data-focus-compare]').count(), 0, 'the toggle is hidden');
  await gone.context.close();
});

test('(f) Ask Genie in place shows the mocked answer inside the step container, scoped to the item', async () => {
  const { page, seen, context } = await openFocus();
  await at(page, 'Item 1 of 3');
  await button(page, ALLOCATION.steps[0].ask[0]).click();
  const answer = stepBox(page).locator('[data-focus-answer]');
  await answer.getByText('Reprice the first one before the others.').waitFor();
  assert.ok(await answer.locator('.gd-bars').count() > 0, 'the guided-answer step renderer drew the ranking');
  assert.equal(seen.asks.length, 1);
  assert.ok(seen.asks[0].question.startsWith(label(0)), `the question names the item: ${seen.asks[0].question}`);
  assert.ok(seen.asks[0].question.includes(ALLOCATION.steps[0].ask[0]));
  assert.equal(seen.asks[0].record_key, THREE[0].record_key);
  await context.close();
});

test('(g) Switch to All records keeps the item open in the drawer with the same steps stacked, and switching back returns to the same item and step', async () => {
  const { page, context } = await openFocus();
  await at(page, 'Item 1 of 3');
  await button(page, 'Skip item').click();
  await at(page, 'Item 2 of 3');
  await button(page, 'Next').click();
  assert.equal(await stepId(page), 's2');
  await button(page, 'Switch to All records').click();
  const stack = page.locator('[data-focus-stack]');
  await stack.waitFor();
  assert.equal(await button(page, 'All records').getAttribute('aria-pressed'), 'true');
  assert.ok((await page.locator('[role="dialog"]').innerText()).includes(label(1)), 'the drawer is the second item');
  for (const step of ALLOCATION.steps) assert.equal(await stack.getByText(step.question, { exact: true }).count(), 1, step.question);
  assert.equal(await stack.locator('[data-focus-step]').count(), 3);
  await button(page, 'One by one').click();
  await at(page, 'Item 2 of 3');
  assert.equal(await stepId(page), 's2');
  await context.close();
});

test('(h) the finish summary counts what was done and skipped after the last item', async () => {
  const { page, context } = await openFocus({ routes: { records: lister(THREE.slice(0, 2), { actions: true, changes: true, summary: SUMMARY }) } });
  await at(page, 'Item 1 of 2');
  await button(page, 'Next').click();
  await button(page, 'Next').click();
  await button(page, 'Mark done').click();
  await at(page, 'Item 2 of 2');
  await button(page, 'Skip item').click();
  const summary = page.locator('[data-focus-summary]');
  await summary.waitFor();
  assert.equal(await summary.locator('[data-sum="done"] b').innerText(), '1');
  assert.equal(await summary.locator('[data-sum="skipped"] b').innerText(), '1');
  await context.close();
});

test('(i) a page without a focus spec has no One by one toggle and shows the list', async () => {
  const { page, context } = await openFocus({ noSpec: true });
  await page.waitForFunction(() => document.querySelectorAll('.card--table tbody tr').length > 0);
  assert.equal(await page.getByRole('button', { name: 'One by one', exact: true }).count(), 0);
  assert.equal(await wizard(page).count(), 0);
  await context.close();
});

test('(j) with reduced motion nothing in the step has a transition or animation duration above 0', async () => {
  const { page, context } = await openFocus({ reduced: true });
  await at(page, 'Item 1 of 3');
  await stepBox(page).locator('[data-viz]').waitFor();
  const longest = await page.evaluate(() => {
    const secs = (v) => v.split(',').map((x) => parseFloat(x) * (x.trim().endsWith('ms') ? 0.001 : 1)).reduce((a, b) => Math.max(a, b), 0);
    return [...document.querySelectorAll('[data-focus-step], [data-focus-step] *')].map((el) => {
      const s = getComputedStyle(el);
      return Math.max(secs(s.transitionDuration), secs(s.animationName === 'none' ? '0s' : s.animationDuration));
    }).reduce((a, b) => Math.max(a, b), 0);
  });
  assert.equal(longest, 0);
  assert.equal(await stepBox(page).locator('[data-viz]').first().getAttribute('data-motion-state'), 'static');
  await context.close();
});
