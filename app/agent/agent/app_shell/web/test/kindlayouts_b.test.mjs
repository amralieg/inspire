import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DECIDE, SRC, appInfo, bundleEntry, openApp, openBundle, serveDist } from './harness.mjs';
import { dropCopies, fillWithCopies, wheelScrolls } from '../../../../../frontend/test/ui/wheelScroll.mjs';
import { LAYOUT_B_CASES as CASES, MOVES, STEPS, kindRoutes, unlinkedRecords } from './exampleRoutes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', 'dist', 'assets');
const KINDS = JSON.parse(readFileSync(join(HERE, '..', '..', 'kinds.json'), 'utf8'));
const WORLD = JSON.parse(readFileSync(join(SRC, 'maps', 'world.json'), 'utf8'));
const MAIN_BUDGET = 1_295_000;
const P = { ink: '#111', muted: '#666', line: '#ddd', card: '#fff', well: '#eee', font: 'Inter', series: ['#1', '#2', '#3', '#4', '#5', '#6'], tier: { 'Act now': '#c00' } };

let served;
let base;
let browser;
let parts;

before(async () => {
  served = await serveDist();
  base = served.base;
  browser = await chromium.launch();
  parts = await bundleEntry(`import * as kc from ${JSON.stringify(join(SRC, 'kindCharts.js'))};\n`
    + `import * as kl from ${JSON.stringify(join(SRC, 'KindLayouts.jsx'))};\nwindow.kc = kc;\nwindow.kl = kl;`);
});

after(async () => {
  await browser?.close();
  served?.close();
});

async function inBundle(run, arg) {
  const { page, context, errors } = await openBundle(browser, parts, {});
  const out = await page.evaluate(run, arg);
  await context.close();
  assert.deepEqual(errors, []);
  return out;
}

const layoutOf = (id) => KINDS.layouts.find((l) => l.id === id);

const exampleOf = (id) => JSON.parse(readFileSync(join(HERE, '..', '..', 'examples', `${id}.json`), 'utf8'));
const chartRows = (id, section) => {
  const page = exampleOf(id);
  const data = CASES[id].data();
  return (page.charts || []).filter((c) => c.section === section).reduce((n, c) => n + (data.charts[c.id]?.rows.length || 0), 0);
};

const itemsIn = (page, section) => page.locator(`[data-section="${section}"]`).evaluateAll((nodes) => nodes.reduce((sum, n) => {
  const rows = n.querySelectorAll('[data-choice-row]').length;
  const asks = n.querySelectorAll('[data-question]').length;
  return sum + (rows || asks || (n.querySelector('canvas, table, .kpi') ? 1 : 0));
}, 0));
const sectionsOf = (page) => page.evaluate(() => [...document.querySelectorAll('[data-section]')].map((n) => n.dataset.section));

async function open(id, acts = [], extra = {}) {
  const info = appInfo(DECIDE, 1, {}, `examples/${id}.json`);
  const opened = await openApp(browser, base, info, { routes: kindRoutes(CASES[id].data(), CASES[id].rows, acts, exampleOf(id), extra) });
  await opened.page.locator(CASES[id].ready).first().waitFor();
  return { ...opened, info };
}

for (const id of Object.keys(CASES)) {
  test(`the ${id} layout is served, opens with What to do now and draws every section in order with its minimum items`, async () => {
    const layout = layoutOf(id);
    assert.equal(layout.enabled, true);
    const { page, seen, context, info } = await open(id);
    assert.deepEqual(info.pages[0].layout.sections, layout.sections);
    await page.waitForFunction((n) => document.querySelectorAll('[data-section] canvas').length >= n, CASES[id].canvases);
    const order = await sectionsOf(page);
    assert.equal(order[0], 'todo', 'every page opens with What to do now');
    assert.deepEqual([...new Set(order)], layout.sections);
    for (const [section, low] of Object.entries(layout.min_items)) {
      const unit = CASES[id].lists[section] != null || section === 'suggested_questions' ? await itemsIn(page, section) : chartRows(id, section);
      assert.ok(unit >= low, `${section} holds ${unit}, needs ${low}`);
      if (CASES[id].lists[section] == null && section !== 'suggested_questions') {
        assert.ok(await page.locator(`[data-section="${section}"] canvas`).count() >= 1, `${section} draws its chart`);
      }
    }
    assert.deepEqual(seen.errors, []);
    await context.close();
  });
}

test('the process map stars the action, expedites a case and accepts a delay only with its reason', async () => {
  const acts = [];
  const { page, seen, context } = await open('process_flow', acts);
  const stars = await page.locator('[data-choice-row] .btn--pri').evaluateAll((b) => b.slice(0, 3).map((n) => n.dataset.choice));
  assert.deepEqual(stars, ['expedite', 'reassign', 'accept']);
  assert.match(await page.locator('[data-choice-row="K1"]').innerText(), /Breach risk\s*90\.0%/);
  await page.locator('[data-choice-row="K1"] [data-choice="expedite"]').click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent?.startsWith('Expedite'));
  assert.deepEqual(acts[0].values, { action_status: 'In progress', note: 'Expedite' });
  const third = page.locator('[data-choice-row="K3"]');
  await third.locator('[data-choice="accept"]').click();
  assert.equal(acts.length, 1, 'accepting a delay waits for its reason');
  await third.getByRole('button', { name: 'The customer agreed to the new date' }).click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent?.startsWith('Accept delay'));
  assert.deepEqual(acts[1].values, { action_status: 'Dismissed', dismiss_reason: 'Accept delay: The customer agreed to the new date' });
  assert.deepEqual(acts[1].record_keys, ['K3']);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the location view shortlists a site and rejects another with its reason', async () => {
  const acts = [];
  const { page, seen, context } = await open('location_view', acts);
  const stars = await page.locator('[data-choice-row] .btn--pri').evaluateAll((b) => b.map((n) => n.dataset.choice));
  assert.deepEqual(stars, ['shortlist', 'shortlist', 'reject', 'reject']);
  await page.locator('[data-choice-row="K1"] [data-choice="shortlist"]').click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent?.startsWith('Shortlist'));
  assert.deepEqual(acts[0].values, { action_status: 'In progress', note: 'Shortlist' });
  const doha = page.locator('[data-choice-row="K3"]');
  await doha.locator('[data-choice="reject"]').click();
  await doha.getByRole('button', { name: 'Already served nearby' }).click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent?.startsWith('Reject'));
  assert.deepEqual(acts[1].values, { action_status: 'Dismissed', dismiss_reason: 'Reject: Already served nearby' });
  assert.equal(await page.locator('[data-section="linked_list"] table tbody tr').count(), 4, 'the linked list shows every site on the map');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the network explorer blocks an account, investigates one and marks another not a ring with its reason', async () => {
  const acts = [];
  const { page, seen, context } = await open('network_explorer', acts);
  assert.equal(await page.locator('[data-section="centrality_list"] [data-choice-row]').count(), 12);
  const stars = await page.locator('[data-choice-row] .btn--pri').evaluateAll((b) => b.slice(0, 3).map((n) => n.dataset.choice));
  assert.deepEqual(stars, ['block', 'investigate', 'not_ring']);
  await page.locator('[data-choice-row="K1"] [data-choice="block"]').click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent?.startsWith('Block'));
  assert.deepEqual(acts[0].values, { action_status: 'Done', note: 'Block' });
  const third = page.locator('[data-choice-row="K3"]');
  await third.locator('[data-choice="not_ring"]').click();
  await third.getByRole('button', { name: 'Family or household link' }).click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent?.startsWith('Not a ring'));
  assert.deepEqual(acts[1].values, { action_status: 'Dismissed', dismiss_reason: 'Not a ring: Family or household link' });
  assert.equal(await page.locator('[data-section="neighbors"] table tbody tr').count(), 3);
  assert.equal(await page.locator('[data-section="match_pairs"] table tbody tr').count(), 5);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the agent chat asks a suggested question, cites the SQL and the tables it read, and sends a rating to Genie without any record action', async () => {
  const acts = [];
  const rated = [];
  const { page, seen, context } = await open('agent_chat', acts, {
    'genie/feedback': ({ route, json }) => { rated.push(route.request().postDataJSON()); return json(200, { rating: rated.at(-1).rating }); },
  });
  assert.equal(await page.locator('[data-question]').count(), 5);
  assert.equal(await page.locator('[data-choice-row], [data-choice], [data-take-all]').count(), 0, 'Genie answers only: no record actions on a chat page');
  await page.locator('[data-question]').first().click();
  await page.locator('[data-chat="done"]').waitFor();
  assert.equal(seen.asks[0].question || seen.asks[0].text, 'What was the margin by region last quarter?');
  await page.locator('[data-cited]').waitFor();
  assert.match(await page.locator('[data-cited]').innerText(), /What was the margin by region last quarter\?[\s\S]*Tables it read: t[\s\S]*SELECT category, SUM\(loss\) FROM t GROUP BY 1/);
  await page.locator('[data-rate] [data-rating="POSITIVE"]').click();
  await page.waitForFunction(() => document.querySelector('[data-rate] [data-rating="POSITIVE"]')?.getAttribute('aria-pressed') === 'true');
  assert.deepEqual(rated, [{ page: 'n09_u01', conversation_id: 'c1', message_id: 'm1', rating: 'POSITIVE' }]);
  assert.deepEqual(acts, []);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the mouse wheel scrolls the chat conversation to its last message at 1280x800 and 1024x700', async () => {
  const { page, seen, context } = await open('agent_chat', [], {});
  await page.locator('[data-question]').first().click();
  await page.locator('[data-chat="done"]').waitFor();
  const log = page.locator('.chat-log');
  await wheelScrolls(page, log, () => log.locator('[data-wheel-copy]').last(), { name: 'chat conversation',
    fill: () => fillWithCopies(log, ':scope > .msg', 14), unfill: () => dropCopies(log) });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a refused rating shows its error and leaves the answer unrated', async () => {
  const { page, seen, context } = await open('agent_chat', [], {
    'genie/feedback': ({ json }) => json(403, { error: 'Only the Genie space users can rate answers' }),
  });
  await page.locator('[data-question]').nth(1).click();
  await page.locator('[data-rate] [data-rating="NEGATIVE"]').click();
  await page.locator('[data-part="feedback"] [role="alert"]').filter({ hasText: 'Only the Genie space users can rate answers' }).waitFor();
  assert.equal(await page.locator('[data-rate] [data-rating="NEGATIVE"]').getAttribute('aria-pressed'), 'false');
  assert.deepEqual(seen.errors.filter((e) => !/403/.test(e)), []);
  await context.close();
});

test('the process layout finds rework loops, lays steps out left to right and colours the slowest moves', async () => {
  const got = await inBundle(({ P, moves }) => {
    const { flowLayout, KIND_CHARTS } = window.kc;
    const rows = moves.map(([x, s, y0, y1]) => ({ x, s, y0, y1 }));
    const flow = flowLayout(rows);
    const chart = { type: 'flow', x: { kind: 'category' }, series: { column: 's' }, y: [{ label: 'Cases', format: 'integer' }, { label: 'Hours', format: 'number' }] };
    const option = KIND_CHARTS.flow({ chart, rows, P, valueFmt: () => (v) => String(v), axisFmt: () => (v) => String(v) });
    const links = option.series[0].links;
    return {
      layers: Object.fromEntries(flow.nodes.map((n) => [n.name, n.layer])),
      rework: flow.edges.filter((e) => e.rework).map((e) => `${e.from}>${e.to}`),
      dashed: links.filter((l) => l.lineStyle.type === 'dashed').map((l) => `${l.source}>${l.target}`),
      late: links.filter((l) => l.lineStyle.color === '#c00').map((l) => `${l.source}>${l.target}`),
      picks: option.series[0].data.map((d) => d.pick),
      at: option.series[0].data.map((d) => d.value.join(',')),
      frame: [option.series[0].coordinateSystem, option.xAxis.min, option.xAxis.max, option.yAxis.min < 0, option.yAxis.max > 0],
      red: option.series[0].data.filter((d) => d.itemStyle.color === '#c00').map((d) => d.name),
      bent: links.filter((l) => l.lineStyle.curveness > 0).map((l) => `${l.source}>${l.target}`),
      loop: flowLayout([{ x: 'A', s: 'B', y0: 1 }, { x: 'B', s: 'A', y0: 1 }]).edges.filter((e) => e.rework).length,
      empty: flowLayout([{ x: null, s: 'B', y0: 1 }]).nodes.length,
    };
  }, { P, moves: MOVES });
  assert.deepEqual(got.layers, { Received: 0, Triage: 1, Assess: 2, Review: 3, Paid: 4 });
  assert.deepEqual(got.rework, ['Review>Assess']);
  assert.deepEqual(got.dashed, ['Review>Assess']);
  assert.deepEqual(got.late, ['Assess>Review']);
  assert.deepEqual(got.picks, STEPS);
  assert.deepEqual(got.at, ['0,0', '1,0', '2,0', '3,0', '4,0'], 'one row of steps keeps its place instead of stretching to fill the card');
  assert.deepEqual(got.frame, ['cartesian2d', -0.5, 4.5, true, true]);
  assert.deepEqual(got.red, ['Review'], 'the step with the longest wait before it is the bottleneck');
  assert.deepEqual(got.bent, ['Review>Assess', 'Triage>Paid'], 'a rework loop and a move that skips steps curve around the boxes');
  assert.equal(got.loop, 1, 'a two-step loop marks exactly one edge as rework');
  assert.equal(got.empty, 0, 'a move without its from step is left out');
});

test('the box plot sorts by median, the map keeps only real coordinates, a region without a shape is named, and no shape at all falls back to ranked bars', async () => {
  const got = await inBundle(({ P, world }) => {
    const { KIND_CHARTS, setShapes, shapeOf } = window.kc;
    const f = () => (v) => String(v);
    const loaded = setShapes(world.features);
    const box = KIND_CHARTS.box({ chart: { y: [1, 2, 3, 4, 5].map((i) => ({ label: `q${i}` })) }, rows: [{ x: 'Home', y0: 1, y1: 2, y2: 3, y3: 4, y4: 5 },
      { x: 'Motor', y0: 1, y1: 5, y2: 9, y3: 12, y4: 20 }], P, valueFmt: f, axisFmt: f });
    const points = KIND_CHARTS.map_points({ chart: { y: [{ label: 'Demand' }] }, rows: [{ x: 'A', y0: 5, y1: 25.1, y2: 55.2 }, { x: 'B', y0: 2, y1: null, y2: 4 },
      { x: 'C', y0: 1, y1: 120, y2: 10 }], P, valueFmt: f });
    const regions = KIND_CHARTS.map_regions({ chart: { y: [{ label: 'Demand' }] }, rows: [{ x: 'ae', y0: 9 }, { x: 'ARE', y0: 1 }, { x: 'ZZ', y0: 3 }], P, valueFmt: f, axisFmt: f });
    const none = KIND_CHARTS.map_regions({ chart: { y: [{ label: 'Demand' }] }, rows: [{ x: 'North', y0: 3 }, { x: 'South', y0: 9 }], P, valueFmt: f, axisFmt: f });
    return {
      loaded: loaded > 500, uae: shapeOf(' ae ')?.name, iso3: shapeOf('ARE')?.name, numeric: shapeOf('784')?.name, missing: shapeOf('ZZ'),
      boxOrder: box.xAxis.data, kept: points.series[0].data.map((p) => p.name), pointNote: points.title.text, framed: !!points.geo.boundingCoords,
      regions: regions.series[0].data.map((d) => [d.pick, d.value]), regionNote: regions.title.text,
      fallback: [none.series[0].type, none.yAxis.data, none.title.text.startsWith('No region code matches')],
    };
  }, { P, world: WORLD });
  assert.deepEqual(got, {
    loaded: true, uae: 'United Arab Emirates', iso3: 'United Arab Emirates', numeric: 'United Arab Emirates', missing: null,
    boxOrder: ['Motor', 'Home'], kept: ['A'], pointNote: '2 of 3 rows have no latitude and longitude, so the map leaves them out', framed: true,
    regions: [['ae', 9], ['ARE', 1]], regionNote: '1 region has no bundled shape: ZZ',
    fallback: ['bar', ['South', 'North'], true],
  });
});

test('the graph colours nodes by community, keeps the heaviest edges, and the chat lists the tables its SQL read', async () => {
  const got = await inBundle(({ P }) => {
    const { KIND_CHARTS, GRAPH_EDGES } = window.kc;
    const { tablesRead, lazyModules } = window.kl;
    const chart = { y: [{ label: 'Links' }, { label: 'Group' }, { label: 'Other group' }] };
    const rows = Array.from({ length: GRAPH_EDGES + 50 }, (_, i) => ({ x: `N${i}`, s: `N${i + 1}`, y0: i, y1: i % 2 ? 'Ring 1' : 'Ring 2', y2: 'Ring 1' }));
    rows.push({ x: 'Self', s: 'Self', y0: 9999, y1: 'Ring 1', y2: 'Ring 1' });
    const g = KIND_CHARTS.graph({ chart, rows, P, valueFmt: () => (v) => String(v) }).series[0];
    return {
      edges: g.links.length, heaviest: g.links[0].value, self: g.links.some((l) => l.source === 'Self'), categories: g.categories.map((c) => c.name),
      labels: g.label.show,
      tables: tablesRead('SELECT a.x FROM main.sales.orders AS a JOIN `main`.`sales`.`stores` s ON a.id = s.id LEFT JOIN (SELECT 1 FROM t2) q'),
      none: tablesRead(''),
      lazy: [lazyModules({ charts: [{ type: 'flow' }, { type: 'box' }] }), lazyModules({ charts: [{ type: 'map_points' }, { type: 'graph' }] }), lazyModules({ charts: [{ type: 'bar' }] })],
    };
  }, { P });
  assert.deepEqual(got, {
    edges: 400, heaviest: 449, self: false, categories: ['Ring 1', 'Ring 2'], labels: false,
    tables: ['main.sales.orders', 'main.sales.stores', 't2'], none: [],
    lazy: [['flow'], ['flow', 'geo'], []],
  });
});

test('the process, map and graph modules load in their own chunks and the main bundle stays within its budget', () => {
  const main = readFileSync(join(ASSETS, 'app.js'), 'utf8');
  const flow = readFileSync(join(ASSETS, 'echartsFlow.js'), 'utf8');
  const geo = readFileSync(join(ASSETS, 'echartsGeo.js'), 'utf8');
  assert.ok(statSync(join(ASSETS, 'app.js')).size < MAIN_BUDGET, `app.js is ${statSync(join(ASSETS, 'app.js')).size} bytes`);
  for (const [name, text] of [['series.graph', 'graph'], ['series.boxplot', 'boxplot'], ['series.map', 'map'], ['United Arab Emirates', 'world shapes']]) {
    assert.ok(!main.includes(name), `${text} stays out of the main bundle`);
  }
  assert.ok(flow.includes('series.graph') && flow.includes('series.boxplot'), 'the process chunk registers the graph and the box plot');
  assert.ok(geo.includes('series.map') && geo.includes('United Arab Emirates'), 'the map chunk registers the map and carries the bundled shapes');
  assert.ok(!readdirSync(ASSETS).some((f) => /\.(geo)?json$/i.test(f)), 'the shapes ship inside the chunk, not as a file fetched at run time');
  assert.ok(!/https?:\/\/[^"'\s]*(geojson|topojson|tile)/i.test(geo), 'the map never fetches shapes or tiles from the internet');
});

const UNLINKED = 'This list is not linked to the records of the use case, so the App cannot save a decision on it yet.';

for (const id of ['process_flow', 'location_view', 'network_explorer']) {
  test(`the ${id} layout shows a list the App cannot save a decision on with its suggestions only, no choice and no per-row read only`, async () => {
    const info = appInfo(DECIDE, 1, {}, `examples/${id}.json`);
    const routes = unlinkedRecords(kindRoutes(CASES[id].data(), CASES[id].rows.map((r) => ({ ...r })), [], exampleOf(id)));
    const { page, seen, context } = await openApp(browser, base, info, { routes });
    await page.locator(CASES[id].ready).first().waitFor();
    await page.locator('[data-no-decisions]').first().waitFor();
    assert.deepEqual([...new Set(await page.locator('[data-no-decisions]').allInnerTexts())], [UNLINKED]);
    assert.equal(await page.locator('[data-choice], [data-treatment], [data-take-all]').count(), 0, 'nothing offers a decision the App cannot save');
    assert.doesNotMatch(await page.locator('main').innerText(), /read only/i);
    assert.ok(await page.locator('[data-suggested]').count() > 0, 'each row still shows its ★ suggestion');
    assert.deepEqual(seen.errors, []);
    await context.close();
  });
}
