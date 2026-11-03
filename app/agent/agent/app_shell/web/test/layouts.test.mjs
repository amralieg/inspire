import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { DECIDE, SRC, appInfo, bundleEntry, openApp, openBundle, serveDist } from './harness.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', 'dist', 'assets');
const KINDS = JSON.parse(readFileSync(join(HERE, '..', '..', 'kinds.json'), 'utf8'));
const MAIN_BUDGET = 1_260_000;
const P = { ink: '#111', muted: '#666', line: '#ddd', card: '#fff', well: '#eee', font: 'Inter', series: ['#1', '#2', '#3', '#4', '#5', '#6'], tier: { 'Act now': '#c00' } };

let served;
let base;
let browser;
let charts;

before(async () => {
  served = await serveDist();
  base = served.base;
  browser = await chromium.launch();
  charts = await bundleEntry(`import * as all from ${JSON.stringify(join(SRC, 'charts.js'))};\nwindow.charts = all;`);
});

async function inCharts(run, arg) {
  const { page, context, errors } = await openBundle(browser, charts, {});
  const out = await page.evaluate(run, arg);
  await context.close();
  assert.deepEqual(errors, []);
  return out;
}

after(async () => {
  await browser?.close();
  served?.close();
});

const WEEKS = Array.from({ length: 20 }, (_, i) => new Date(Date.UTC(2026, 6, 6 + i * 7)).toISOString().slice(0, 10));
const fanRows = WEEKS.map((x, i) => (i < 12 ? { x, y0: 900 + i * 10, y1: null, y2: null, y3: null }
  : { x, y0: null, y1: 1000 + i * 5, y2: 900 + i * 4, y3: 1100 + i * 6 }));

function forecastData() {
  return {
    kpis: { next_forecast: { now: 8400 }, last_actual: { now: 11500 }, at_risk_n: { now: 3 }, orders_open: { now: 7 } },
    charts: {
      fan: { columns: [], rows: fanRows, truncated: false },
      vs_capacity: { columns: [], rows: WEEKS.slice(12).map((x, i) => ({ x, y0: 1000 + i * 5, y1: 1100 + i * 6, y2: 1120 })), truncated: false },
      accuracy: { columns: [], rows: ['Oat bar', 'Rye loaf', 'Tea tin'].map((x, i) => ({ x, y0: 1.4 - i * 0.4 })), truncated: false },
    },
    tables: { at_risk: { columns: [], rows: [{ series_label: 'Oat bar', category: 'Snacks', backtest_mase: 1.4, next_forecast: 900, upside: 220 }], truncated: false } },
    errors: {},
  };
}

const ROWS = ['Oat bar', 'Rye loaf', 'Tea tin', 'Fig jam', 'Soy milk', 'Rice cake'].map((label, i) => ({
  record_key: `K${i + 1}`, _inspire_key: `K${i + 1}`, _inspire_version: String(500 + i), entity_id: `I${i + 1}`, entity_label: label, category: 'Snacks',
  priority_tier: 'Act now', rank: i + 1, value: 9000 - i * 1000, current_order: 100 + i * 10, recommended_order: 120 + i * 10,
  recommended_action: 'Raise the order', top_reasons: ['demand rising'], as_of_date: '2026-10-15',
}));

function forecastRoutes(decided) {
  return {
    page: ({ json }) => json(200, forecastData()),
    records: ({ route, json }) => {
      const body = route.request().postDataJSON();
      return json(200, { rows: ROWS.slice(0, body.limit || 25), total: ROWS.length, offset: 0, limit: body.limit || 25, actions: true, changes: false,
        summary: { open: 7, done: 3, resolved: 0, left: 7, owners: [] }, errors: {} });
    },
    'plan/decide': ({ route, json }) => {
      const body = route.request().postDataJSON();
      decided.push(body);
      return json(200, { written: [body.record_key], conflicts: [], conflicts_count: 0, left_out: 0, batch_id: 'b1', decision: body.decision, edited: false });
    },
  };
}

const itemsIn = (page, section) => page.locator(`[data-section="${section}"]`).evaluateAll((nodes) => nodes.reduce((sum, n) => {
  const rows = n.querySelectorAll('[data-plan-row], .rec').length;
  const cards = n.querySelectorAll('[data-card]').length;
  return sum + (rows || cards || (n.querySelector('canvas, table, .kpi, .card') ? 1 : 0));
}, 0));
const sectionsOf = (page) => page.evaluate(() => [...document.querySelectorAll('[data-section]')].map((n) => n.dataset.section));

test('the forecast cockpit opens with What to do now and draws every section of its layout in order with its minimum items', async () => {
  const info = appInfo(DECIDE, 1, {}, 'examples/forecast_cockpit.json');
  const layout = KINDS.layouts.find((l) => l.id === 'forecast_cockpit');
  assert.equal(layout.enabled, true);
  assert.deepEqual(info.pages[0].layout.sections, layout.sections);
  const decided = [];
  const { page, seen, context } = await openApp(browser, base, info, { routes: forecastRoutes(decided) });
  await page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 3);
  const order = await sectionsOf(page);
  assert.equal(order[0], 'todo', 'every page opens with What to do now');
  assert.deepEqual([...new Set(order)], ['todo', 'kpis', 'fan_chart', 'forecast_vs_capacity', 'accuracy_by_series', 'at_risk_series']);
  for (const [section, low] of Object.entries(layout.min_items)) {
    const n = await itemsIn(page, section);
    assert.ok(n >= low, `${section} holds ${n}, needs ${low}`);
  }
  assert.equal(await page.locator('.view.is-on span').innerText(), 'Forecast', 'the first tab takes the layout tab label');
  assert.equal(await page.locator('[data-todo-count]').innerText(), '7 of 10 waiting for you');
  assert.match(await page.locator('[data-so-what]').first().innerText(), /So what: Order to the forecast line/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the horizon selector trims the forecast to the weeks ahead and the band draws the range under the forecast', async () => {
  const chart = { type: 'band', x: { kind: 'time' }, y: ['Actual', 'Forecast', 'Low', 'High'].map((label) => ({ label, format: 'integer' })) };
  const got = await inCharts(({ chart, rows, P }) => {
    const { chartOption, withinHorizon } = window.charts;
    const option = chartOption(chart, rows, P);
    return { four: withinHorizon(rows, 4).length, all: withinHorizon(rows, 0).length, names: option.series.map((s) => s.name),
      width: option.series[1].data[12], dash: option.series[3].lineStyle.type, cut: chartOption({ ...chart, horizon: 4 }, rows, P).xAxis.data.length };
  }, { chart, rows: fanRows, P });
  assert.deepEqual(got, { four: 16, all: 20, names: ['Low to High low', 'Low to High', 'Actual', 'Forecast'], width: fanRows[12].y3 - fanRows[12].y2,
    dash: 'dashed', cut: 16 });
  const info = appInfo(DECIDE, 1, {}, 'examples/forecast_cockpit.json');
  const { page, seen, context } = await openApp(browser, base, info, { routes: forecastRoutes([]) });
  const picker = page.locator('[data-horizon]');
  await picker.getByRole('button', { name: '4 ahead' }).click();
  assert.equal(await picker.getByRole('button', { name: '4 ahead' }).getAttribute('aria-pressed'), 'true');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('accepting and overriding a plan line go through plan/decide, and an override needs a value and a reason', async () => {
  const info = appInfo(DECIDE, 1, {}, 'examples/forecast_cockpit.json');
  const decided = [];
  const { page, seen, context } = await openApp(browser, base, info, { routes: forecastRoutes(decided) });
  const first = page.locator('[data-plan-row="K1"]');
  await first.waitFor();
  assert.match(await first.innerText(), /Oat bar\s+100\s+★ 120\s+\+20/);
  await first.getByRole('button', { name: 'Accept' }).click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'Accepted the suggested line');
  assert.deepEqual(decided[0], { page: info.pages[0].id, record_key: 'K1', seen: '500', decision: 'accept', reason: '', recommended: 120 });
  const second = page.locator('[data-plan-row="K2"]');
  await second.getByRole('button', { name: 'Override' }).click();
  const save = page.getByRole('button', { name: 'Save override' });
  assert.equal(await save.isDisabled(), true, 'an override waits for a value and a reason');
  await page.getByLabel('Your value').fill('95');
  assert.equal(await save.isDisabled(), true);
  await page.getByLabel('Why you override it').fill('Supplier is short');
  await save.click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'Saved your override and its reason');
  assert.deepEqual(decided[1], { page: info.pages[0].id, record_key: 'K2', seen: '501', decision: 'override', reason: 'Supplier is short', recommended: 130, value: 95 });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const LIMITS = [{ x: 'Oven hours', y0: 99, y1: 100 }, { x: 'Flour', y0: 40, y1: 100 }, { x: 'Staff', y0: 70, y1: 90 }];
const PLAN_ROWS = ROWS.map((r, i) => ({ ...r, current_value: 100 + i * 10, recommended_value: 90 + i * 20, delta: i * 20 - 10, objective_contribution: 4000 - i * 500 }));

function plannerRoutes(decided, solved) {
  return {
    page: ({ json }) => json(200, {
      kpis: { objective: { now: 11000 }, changed: { now: 3 }, binding: { now: 1 } },
      charts: {
        limits_used: { columns: [], rows: LIMITS, truncated: false },
        swing: { columns: [], rows: LIMITS.map((r, i) => ({ x: r.x, y0: -100 * (i + 1), y1: 100 * (i + 1) })), truncated: false },
        worth: { columns: [], rows: LIMITS.map((r, i) => ({ x: r.x, y0: 12 - i * 4 })), truncated: false },
      },
      tables: {}, errors: {},
    }),
    records: ({ route, json }) => {
      const body = route.request().postDataJSON();
      return json(200, { rows: PLAN_ROWS.slice(0, body.limit || 25), total: PLAN_ROWS.length, offset: 0, limit: body.limit || 25, actions: true, changes: false,
        summary: { open: 2, done: 1, resolved: 0, left: 2, owners: [] }, errors: {} });
    },
    'plan/decide': ({ route, json }) => {
      const body = route.request().postDataJSON();
      decided.push(body);
      return json(200, { written: [body.record_key], conflicts: [], conflicts_count: 0, left_out: 0, batch_id: 'b1', decision: body.decision, edited: false });
    },
    'settings/run': ({ route, json }) => {
      solved.push(route.request().postDataJSON());
      return json(200, { run_id: 77, started: true });
    },
  };
}

test('the planner opens with What to do now, draws the plan, its limits and what moves the result, and re-solves through settings/run', async () => {
  const info = appInfo(DECIDE, 1, {}, 'examples/planner.json');
  const layout = KINDS.layouts.find((l) => l.id === 'planner');
  assert.equal(layout.enabled, true);
  assert.deepEqual(info.pages[0].layout.sections, layout.sections);
  const decided = [];
  const solved = [];
  const { page, seen, context } = await openApp(browser, base, info, { routes: plannerRoutes(decided, solved) });
  await page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 3);
  await page.locator('[data-plan-row="K1"]').waitFor();
  assert.deepEqual([...new Set(await sectionsOf(page))], ['todo', 'kpis', 'objective_kpi', 'plan_table', 'constraint_bars', 'sensitivity_tornado', 'resolve']);
  for (const [section, low] of Object.entries(layout.min_items)) {
    const n = await itemsIn(page, section);
    assert.ok(n >= low, `${section} holds ${n}, needs ${low}`);
  }
  assert.equal(await page.locator('.view.is-on span').innerText(), 'Plan');
  assert.equal(await itemsIn(page, 'constraint_bars'), 1);
  assert.equal(await itemsIn(page, 'sensitivity_tornado'), 2);
  assert.match(await page.locator('[data-section="objective_kpi"]').innerText(), /Plan margin/);
  assert.doesNotMatch(await page.locator('[data-section="kpis"]').innerText(), /Plan margin/);
  assert.match(await page.locator('[data-plan-row="K1"]').innerText(), /Oat bar\s+100\s+★ 90\s+[−-]10/);
  await page.locator('[data-plan-row="K2"]').getByRole('button', { name: 'Accept' }).click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'Accepted the suggested line');
  assert.deepEqual(decided[0], { page: info.pages[0].id, record_key: 'K2', seen: '501', decision: 'accept', reason: '', recommended: 110 });
  await page.locator('[data-resolve]').click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent?.startsWith('Started a new solve'));
  assert.deepEqual(solved, [{ page: info.pages[0].id }]);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a plan with no decisions and no editable override column stays read only', async () => {
  const info = appInfo({}, 1, {}, 'examples/planner.json');
  const routes = plannerRoutes([], []);
  const records = routes.records;
  routes.records = (arg) => {
    const fulfill = arg.json;
    return records({ ...arg, json: (status, data) => fulfill(status, { ...data, actions: false }) });
  };
  const { page, seen, context } = await openApp(browser, base, info, { routes });
  const row = page.locator('[data-plan-row="K1"]');
  await row.waitFor();
  assert.equal(await row.getByRole('button', { name: 'Accept' }).count(), 0);
  assert.match(await page.locator('[data-section="plan_table"]').innerText(), /read only/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const SCENARIOS = [['base', 5000000, 4600000, 5400000, 0.31], ['upside', 5600000, 5100000, 6000000, 0.7], ['downside', 4400000, 4000000, 4800000, 0.05]]
  .map(([scenario_id, p50, p10, p90, prob_target]) => ({ scenario_id, p10, p50, p90, prob_target }));

function evaluated(values) {
  const levers = [['price', 12, 0.4e6], ['volume', 400000, 9], ['unit_cost', 7, -0.4e6]].map(([lever, base, k]) => ({ lever, base, low: base * 0.9, high: base * 1.1, value: values[lever] ?? base, k }));
  const p50 = 5000000 + levers.reduce((s, l) => s + l.k * (l.value - l.base), 0);
  return { levers: levers.map(({ k, ...l }) => l), clamped: [], contributions: levers.map((l) => ({ lever: l.lever, delta: l.k * (l.value - l.base) })),
    distribution: Array.from({ length: 41 }, (_, i) => [p50 - 400000 + i * 20000, Math.exp(-0.5 * ((i - 20) / 6) ** 2)]),
    outcome: { p10: p50 - 400000, p50, p90: p50 + 400000, prob_target: p50 >= 5200000 ? 0.6 : 0.3, target: 5200000 } };
}

function scenarioRoutes(asked, saved) {
  return {
    page: ({ json }) => json(200, {
      kpis: { base_p50: { now: 5000000 }, base_chance: { now: 0.31 }, last_margin: { now: 4800000, before: 4700000 } },
      charts: { swing: { columns: [], rows: [{ x: 'price', y0: -480000, y1: 480000 }, { x: 'volume', y0: -360000, y1: 360000 }, { x: 'unit_cost', y0: -280000, y1: 280000 }], truncated: false } },
      tables: { scenarios: { columns: [], rows: SCENARIOS, truncated: false } }, errors: {},
    }),
    'scenario/evaluate': ({ route, json }) => {
      const body = route.request().postDataJSON();
      asked.push(body);
      return json(200, evaluated(body.values || {}));
    },
    'records/add': ({ route, json }) => {
      saved.push(route.request().postDataJSON());
      return json(200, { record_key: 'S1', versions: [], fields: [] });
    },
  };
}

test('the scenario lab opens with What to do now, moves the outcome with each lever, and saves a scenario as a record', async () => {
  const info = appInfo({ options: { modify: true, replace_edits: false, decisions: false } }, 1, {}, 'examples/scenario_lab.json');
  const layout = KINDS.layouts.find((l) => l.id === 'scenario_lab');
  assert.equal(layout.enabled, true);
  assert.deepEqual(info.pages[0].layout.sections, layout.sections);
  assert.equal(info.pages[0].layout.decides, false);
  const asked = [];
  const saved = [];
  const { page, seen, context } = await openApp(browser, base, info, { routes: scenarioRoutes(asked, saved) });
  await page.locator('[data-lever="price"]').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 4);
  assert.deepEqual([...new Set(await sectionsOf(page))], ['todo', 'kpis', 'lever_sliders', 'outcome_distribution', 'scenario_table', 'target_gauge', 'tornado']);
  assert.equal(await page.locator('[data-lever]').count(), 3);
  assert.ok(await page.locator('[data-section="scenario_table"] tbody tr').count() >= layout.min_items.scenario_table);
  assert.ok(await page.locator('[data-lever]').count() >= layout.min_items.lever_sliders);
  assert.equal(await page.locator('.view.is-on span').innerText(), 'Scenarios');
  assert.match(await page.locator('[data-step="levers"]').innerText(), /Move the levers and watch the quarter margin/);
  assert.match(await page.locator('[data-quantiles]').innerText(), /P10 \$4\.6M · P50 \$5M · P90 \$5\.4M/);
  const price = page.getByLabel('Average price');
  await price.evaluate((el) => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(el, '13.2');
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.waitForFunction(() => /P50 \$5\.(48|5)M/.test(document.querySelector('[data-quantiles]')?.textContent || ''), null, { timeout: 5000 });
  assert.deepEqual(asked.at(-1), { page: info.pages[0].id, values: { price: 13.2 } });
  const save = page.getByRole('button', { name: 'Save the scenario' });
  assert.equal(await save.isDisabled(), true, 'a scenario needs a name before it is saved');
  await page.getByLabel('Name this scenario').fill('Price up 10%');
  await save.click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'Saved the scenario Price up 10%');
  assert.deepEqual(saved, [{ page: info.pages[0].id, values: { scenario_name: 'Price up 10%', lever_values: JSON.stringify({ price: 13.2, volume: 400000, unit_cost: 7 }), expected_outcome: asked.length && evaluated({ price: 13.2 }).outcome.p50 } }]);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the scenario lab hides Save when the App does not let people change its data', async () => {
  const info = appInfo({}, 1, {}, 'examples/scenario_lab.json');
  const { page, seen, context } = await openApp(browser, base, info, { routes: scenarioRoutes([], []) });
  await page.locator('[data-lever="price"]').waitFor();
  assert.equal(await page.getByRole('button', { name: 'Save the scenario' }).count(), 0);
  assert.equal(await page.locator('[data-step="save"]').count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the decision queue page keeps its layout: no What to do now block and its own tab label', async () => {
  const info = appInfo();
  assert.equal(info.pages[0].layout.id, 'decision_queue');
  const { page, seen, context } = await openApp(browser, base, info);
  assert.equal(await page.locator('[data-section="todo"]').count(), 0);
  assert.equal(await page.locator('.view.is-on span').innerText(), 'Things to fix');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the layout chart types draw their shapes', async () => {
  const got = await inCharts((P) => {
    const { chartOption } = window.charts;
    const tornado = chartOption({ type: 'tornado', x: { kind: 'category' }, y: [{ label: 'Low' }, { label: 'High' }] },
    [{ x: 'Price', y0: -2, y1: 3 }, { x: 'Promo', y0: -8, y1: 9 }], P);
    const bridge = chartOption({ type: 'bridge', x: { kind: 'category' }, y: [{ label: 'Change' }] },
    [{ x: 'Plan', y0: 100 }, { x: 'Volume', y0: 20 }, { x: 'Price', y0: -30 }, { x: 'Actual', y0: 90 }], P);
    const bullet = chartOption({ type: 'bullet', x: { kind: 'category' }, y: [{ label: 'Used' }, { label: 'Limit' }] },
    [{ x: 'Ovens', y0: 99, y1: 100 }, { x: 'Trucks', y0: 40, y1: 100 }], P);
    const control = chartOption({ type: 'control', x: { kind: 'time' }, y: ['Value', 'Expected', 'Low', 'High'].map((label) => ({ label })) },
    [{ x: '2026-01-01', y0: 5, y1: 5, y2: 4, y3: 6 }, { x: '2026-01-02', y0: 9, y1: 5, y2: 4, y3: 6 }], P);
    return { tornado: tornado.yAxis.data, base: bridge.series[0].data, steps: bridge.series[1].data.map((d) => d.value),
      bullet: bullet.series[1].data.map((d) => d.itemStyle.color), marked: control.series.at(-1).data };
  }, P);
  assert.deepEqual(got.tornado, ['Promo', 'Price'], 'the widest swing comes first');
  assert.deepEqual(got.base, [0, 100, 90, 0], 'each step floats from the running total');
  assert.deepEqual(got.steps, [100, 20, 30, 90]);
  assert.deepEqual(got.bullet, ['#c00', '#1'], 'a binding limit turns red');
  assert.deepEqual(got.marked, [null, 9], 'only the point outside the limits is marked');
});

test('the scenario chart modules load in their own chunk and the main bundle stays within its budget', () => {
  const main = readFileSync(join(ASSETS, 'app.js'), 'utf8');
  const lazy = readFileSync(join(ASSETS, 'echartsKinds.js'), 'utf8');
  assert.ok(statSync(join(ASSETS, 'app.js')).size < MAIN_BUDGET, `app.js is ${statSync(join(ASSETS, 'app.js')).size} bytes`);
  assert.ok(!main.includes('series.gauge') && !main.includes('type="markLine"'), 'the gauge and mark lines stay out of the main bundle');
  assert.ok(lazy.includes('series.gauge') && lazy.includes('type="markLine"'), 'the layout chart chunk registers them');
});
