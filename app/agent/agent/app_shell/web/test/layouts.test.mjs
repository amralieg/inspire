import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';
import { actBody, DECIDE, ROWS, SRC, TABLE, appInfo, bundleEntry, openApp, openBundle, scrollsAsked, serveDist, steadyBox, tracked, watchScrolls } from './harness.mjs';
import { dashboardRoutes, evaluated, explainerRoutes, fanRows, forecastRoutes, monitorRoutes, plannerRoutes, scenarioRoutes } from './exampleRoutes.mjs';

const HERE = dirname(fileURLToPath(import.meta.url));
const ASSETS = join(HERE, '..', 'dist', 'assets');
const KINDS = JSON.parse(readFileSync(join(HERE, '..', '..', 'kinds.json'), 'utf8'));
const MAIN_BUDGET = 1_300_000;
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

const itemsIn = (page, section) => page.locator(`[data-section="${section}"]`).evaluateAll((nodes) => nodes.reduce((sum, n) => {
  const rows = n.querySelectorAll('[data-plan-row], tbody > tr:not(.plan-form)').length;
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
  const { page, seen, context } = await openApp(browser, base, info, { routes: forecastRoutes(decided, { keep: true }) });
  const first = page.locator('[data-plan-row="K1"]');
  await first.waitFor();
  const waits = (text) => page.waitForFunction((t) => document.querySelector('[data-todo-count]')?.textContent === t, text);
  await page.locator('[data-todo-count]').waitFor();
  const [open0, all0] = (await page.locator('[data-todo-count]').innerText()).match(/(\d+) of (\d+) waiting/).slice(1).map(Number);
  assert.ok(open0 >= 2, 'lines are waiting');
  assert.match(await first.innerText(), /Oat bar\s+100\s+★ 120\s+\+20/);
  await first.getByRole('button', { name: 'Accept' }).click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'Accepted the suggested line');
  assert.equal(await page.locator('[data-said="K1"]').innerText(), 'Accepted the suggested line');
  await waits(`${open0 - 1} of ${all0} waiting for you`);
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
  assert.equal(await page.locator('[data-said="K2"]').innerText(), 'Saved your override and its reason');
  await waits(`${open0 - 2} of ${all0} waiting for you`);
  assert.deepEqual(decided[1], { page: info.pages[0].id, record_key: 'K2', seen: '501', decision: 'override', reason: 'Supplier is short', recommended: 130, value: 95 });
  assert.deepEqual(seen.errors, []);
  await context.close();
});

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

test('a plan with no decisions shows its suggestions with no accept, no override and no per-row read only', async () => {
  for (const [settings, said] of [[{}, 'This App does not record decisions, so this list shows its suggestions only.'],
    [DECIDE, 'This list is not linked to the records of the use case, so the App cannot save a decision on it yet.']]) {
    const info = appInfo(settings, 1, {}, 'examples/planner.json');
    const { page, seen, context } = await openApp(browser, base, info, { routes: plannerRoutes([], [], { actions: false }) });
    const row = page.locator('[data-plan-row="K1"]');
    await row.waitFor();
    const plan = page.locator('[data-section="plan_table"]');
    assert.equal(await plan.getByRole('button', { name: 'Accept' }).count(), 0);
    assert.equal(await plan.getByRole('button', { name: 'Override' }).count(), 0);
    assert.equal(await plan.locator('[data-take-all]').count(), 0);
    assert.equal(await plan.locator('[data-no-decisions]').innerText(), said);
    assert.doesNotMatch(await plan.innerText(), /read only|Accept a line|override it with a reason/i, 'no invitation to decide and no per-row read only');
    assert.equal(await row.locator('td').count(), 5, 'the row keeps its values, status and Ask Genie with no empty decide cell');
    assert.equal(await page.locator('[data-step="plan"]').count(), 0);
    assert.match(await page.locator('[data-step="plan_read"]').innerText(), /Read each line of the plan next to its ★ suggested value/);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('Show me on What to do now jumps to the list for a person who asked for less motion, and glides there otherwise', async () => {
  for (const [motion, behavior] of [['reduce', 'auto'], ['no-preference', 'smooth']]) {
    const info = appInfo(DECIDE, 1, {}, 'examples/planner.json');
    const { page, seen, context } = await openApp(browser, base, info, { routes: plannerRoutes([], [], { keep: true }), watch: watchScrolls(motion) });
    await page.locator('[data-plan-row="K1"]').waitFor();
    await scrollsAsked(page);
    await page.locator('[data-step="first"]').getByRole('button', { name: 'Show me' }).click();
    assert.deepEqual(await scrollsAsked(page), [behavior], `${motion}: the jump to the list`);
    assert.deepEqual(seen.errors, []);
    await context.close();
  }
});

test('every plan line can be accepted, overridden with a reason or taken all at once, and a reload keeps each decision', async () => {
  const info = appInfo(DECIDE, 1, {}, 'examples/planner.json');
  const decided = [];
  const { page, seen, context } = await openApp(browser, base, info, { routes: plannerRoutes(decided, [], { keep: true }) });
  const line = (key) => page.locator(`[data-plan-row="${key}"]`);
  await line('K1').waitFor();
  const plan = page.locator('[data-section="plan_table"]');
  assert.equal(await plan.locator('[data-no-decisions]').count(), 0);
  assert.match(await plan.innerText(), /Accept a line, or override it with a reason/);
  assert.match(await page.locator('[data-step="plan"]').innerText(), /Take the ★ suggested line in the plan, or override it with a reason/);
  assert.equal(await plan.locator('[data-take-all]').innerText(), 'Take all 6 ★ suggestions');
  const counter = page.locator('[data-todo-count]');
  const waits = (text) => page.waitForFunction((t) => document.querySelector('[data-todo-count]')?.textContent === t, text);
  assert.equal(await counter.innerText(), '6 of 6 waiting for you');
  await line('K1').getByRole('button', { name: 'Accept' }).click();
  await line('K1').locator('[data-decided]').waitFor();
  assert.equal(await line('K1').locator('[data-decided]').innerText(), 'Accepted the recommended 90');
  assert.equal(await page.locator('[data-said="K1"]').innerText(), 'Accepted the suggested line', 'the success message shows next to the line, not only in a toast');
  const below = await steadyBox(page, page.locator('[data-said="K1"]'));
  const row = await steadyBox(page, line('K1'));
  assert.ok(below.y >= row.y + row.height - 1 && below.y - (row.y + row.height) < 40, 'the message sits right under its line');
  await waits('5 of 6 waiting for you');
  assert.equal(await line('K1').getByRole('button', { name: 'Accept' }).count(), 0, 'a decided line offers no second accept');
  await line('K2').getByRole('button', { name: 'Override' }).click();
  await page.getByLabel('Your value').fill('95');
  await page.getByLabel('Why you override it').fill('Supplier is short');
  await page.getByRole('button', { name: 'Save override' }).click();
  await line('K2').locator('[data-decided]').waitFor();
  assert.equal(await line('K2').locator('[data-decided]').innerText(), 'Override to 95 instead of 110: Supplier is short');
  assert.equal(await page.locator('[data-said="K2"]').innerText(), 'Saved your override and its reason');
  await waits('4 of 6 waiting for you');
  assert.deepEqual(decided.map((d) => [d.record_key, d.decision]), [['K1', 'accept'], ['K2', 'override']]);
  await page.reload();
  await line('K2').locator('[data-decided]').waitFor();
  assert.equal(await line('K1').locator('[data-decided]').innerText(), 'Accepted the recommended 90');
  assert.equal(await line('K2').locator('[data-decided]').innerText(), 'Override to 95 instead of 110: Supplier is short');
  assert.match(await line('K1').innerText(), /Done/);
  await waits('4 of 6 waiting for you');
  assert.equal(await page.locator('[data-said]').count(), 0, 'a reload shows the decisions in the lines, not the old messages');
  assert.equal(await plan.locator('[data-take-all]').innerText(), 'Take all 4 ★ suggestions');
  await plan.locator('[data-take-all]').click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent === 'Accepted 4 suggested lines');
  await page.waitForFunction(() => document.querySelectorAll('[data-plan-row] [data-decided]').length === 6);
  assert.equal(await plan.locator('[data-said="all"]').innerText(), 'Accepted 4 suggested lines');
  await waits('0 of 6 waiting for you');
  assert.deepEqual(decided.slice(2).map((d) => [d.record_key, d.decision, d.seen]), [['K3', 'accept', '502'], ['K4', 'accept', '503'], ['K5', 'accept', '504'], ['K6', 'accept', '505']]);
  assert.equal(await plan.locator('[data-take-all]').count(), 0);
  assert.equal(await plan.getByRole('button', { name: 'Accept' }).count(), 0);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

const SCHEDULE = [['Oat bar', '2026-11-02', '2026-11-09'], ['Rye loaf', '2026-11-04', '2026-11-20'], ['Seed roll', '2026-11-10', '2026-11-12']]
  .map(([x, y0, y1]) => ({ x, y0, y1 }));
const FLOWS = [['North plant', 'Store', 400], ['North plant', 'Web', 150], ['South plant', 'Store', 220], ['Store', 'North plant', 30]]
  .map(([x, s, y0]) => ({ x, s, y0 }));

function plannerWithFlows() {
  const example = JSON.parse(readFileSync(join(HERE, '..', '..', 'examples', 'planner.json'), 'utf8'));
  const datasets = [...example.datasets,
    { name: 'schedule', sql: 'SELECT p.entity, p.start_date, p.end_date FROM main.supply.production_out__plan AS p' },
    { name: 'flows', sql: 'SELECT p.entity, p.decision, p.recommended_value FROM main.supply.production_out__plan AS p' }];
  const charts = [...example.charts,
    { id: 'when', section: 'gantt', title: 'When each line runs', hint: 'Each bar runs from the first to the last day of a line.', type: 'gantt', dataset: 'schedule', x: { column: 'entity', kind: 'category', label: 'Line' },
      y: [{ label: 'Start', expression: 'MIN(start_date)', format: 'date' }, { label: 'End', expression: 'MAX(end_date)', format: 'date' }] },
    { id: 'moves', section: 'allocation_flow', title: 'Where the plan sends the volume', hint: 'Each band is the volume the plan sends from a source to a target.', type: 'sankey', dataset: 'flows',
      x: { column: 'entity', kind: 'category', label: 'From' }, series: { column: 'decision', top: 8 },
      y: [{ label: 'Volume', expression: 'SUM(recommended_value)', format: 'number' }] }];
  return { datasets, charts };
}

test('the gantt and the sankey drawing are left out of the main bundle and load only on a page that draws one', async () => {
  const lazy = [];
  const watch = async (page) => page.on('request', (r) => { if (/\/echartsKinds[^/]*\.js$/.test(r.url())) lazy.push(r.url()); });
  const plain = await openApp(browser, base, appInfo(DECIDE, 1, {}, 'examples/planner.json'), { routes: plannerRoutes([], []), watch });
  await plain.page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 3);
  assert.equal(lazy.length, 0, 'a planner without a gantt or a sankey loads no extra chart code');
  assert.deepEqual(plain.seen.errors, []);
  await plain.context.close();
  const info = appInfo(DECIDE, 1, plannerWithFlows(), 'examples/planner.json');
  const routes = plannerRoutes([], []);
  const page0 = routes.page;
  routes.page = (arg) => page0({ ...arg, json: (status, data) => arg.json(status, { ...data,
    charts: { ...data.charts, when: { columns: [], rows: SCHEDULE, truncated: false }, moves: { columns: [], rows: FLOWS, truncated: false } } }) });
  const { page, seen, context } = await openApp(browser, base, info, { routes, watch });
  await page.locator('[data-section="gantt"] canvas').waitFor();
  await page.locator('[data-section="allocation_flow"] canvas').waitFor();
  assert.deepEqual([...new Set(await sectionsOf(page))], ['todo', 'kpis', 'objective_kpi', 'plan_table', 'constraint_bars', 'sensitivity_tornado', 'gantt',
    'allocation_flow', 'resolve']);
  assert.equal(new Set(lazy).size, 1, 'both drawings come from one lazy chunk');
  assert.equal(await page.locator('[data-card="when"]').getAttribute('data-rows'), '3');
  assert.equal(await page.locator('[data-card="moves"]').getAttribute('data-rows'), '4');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the gantt spans each line from start to end and the sankey keeps sources apart from targets', async () => {
  const out = await inCharts(([P, schedule, flows]) => {
    const { chartOption } = window.charts;
    const y = (format) => [{ label: 'Start', format }, { label: 'End', format }];
    const dated = chartOption({ type: 'gantt', x: { kind: 'category' }, y: y('date') }, [...schedule, { x: 'No end', y0: '2026-11-01', y1: null }], P);
    const counted = chartOption({ type: 'gantt', x: { kind: 'category' }, y: y('number') }, [{ x: 'Week plan', y0: 3, y1: 7 }], P);
    const flow = chartOption({ type: 'sankey', x: { kind: 'category' }, y: [{ label: 'Volume', format: 'number' }] }, [...flows, { x: 'Web', s: 'Store', y0: 0 }], P);
    const s = flow.series[0];
    return {
      axis: [dated.xAxis.type, counted.xAxis.type], names: dated.yAxis.data, first: dated.series[0].data[0], counted: counted.series[0].data,
      nodes: s.data.map((n) => n.name), links: s.links.length, label: s.label.formatter({ name: 'before|North plant' }),
      tip: flow.tooltip.formatter({ dataType: 'edge', data: { source: 'before|Store', target: 'now|North plant', value: 30 } }),
    };
  }, [P, SCHEDULE, FLOWS]);
  assert.deepEqual(out.axis, ['time', 'value']);
  assert.deepEqual(out.names, ['Oat bar', 'Rye loaf', 'Seed roll'], 'a line with no end is left off');
  assert.deepEqual(out.first, { value: [0, Date.parse('2026-11-02'), Date.parse('2026-11-09')], pick: 'Oat bar' });
  assert.deepEqual(out.counted, [{ value: [0, 3, 7], pick: 'Week plan' }]);
  assert.deepEqual(out.nodes, ['before|North plant', 'now|Store', 'now|Web', 'before|South plant', 'before|Store', 'now|North plant']);
  assert.equal(out.links, 4, 'a flow of zero is left out, and a flow back to a source does not loop');
  assert.equal(out.label, 'North plant');
  assert.match(out.tip, /^Store \S+ North plant<br><b>30<\/b>$/);
});

test('the scenario lab opens with What to do now, moves the outcome with each lever, and saves a scenario as a record', async () => {
  const info = appInfo({ options: { modify: true, replace_edits: false, decisions: false } }, 1, {}, 'examples/scenario_lab.json');
  const layout = KINDS.layouts.find((l) => l.id === 'scenario_lab');
  assert.equal(layout.enabled, true);
  assert.deepEqual(info.pages[0].layout.sections, layout.sections);
  assert.equal(info.pages[0].layout.decides, true, 'the scenario lab ranks the records the scenario puts at risk, so people act on them');
  const asked = [];
  const saved = [];
  const { page, seen, context } = await openApp(browser, base, info, { routes: scenarioRoutes(asked, saved) });
  await page.locator('[data-lever="price"]').waitFor();
  await page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 4);
  assert.deepEqual([...new Set(await sectionsOf(page))], ['todo', 'kpis', 'lever_sliders', 'outcome_distribution', 'exposures', 'scenario_table', 'target_gauge', 'tornado']);
  assert.equal(await page.locator('[data-lever]').count(), 3);
  assert.ok(await page.locator('[data-section="scenario_table"] tbody tr').count() >= layout.min_items.scenario_table);
  assert.ok(await page.locator('[data-lever]').count() >= layout.min_items.lever_sliders);
  assert.match(await page.locator('[data-section="kpis"]').innerText(), /Chance of the target\s+31(\.0)?%/);
  assert.match(await page.locator('[data-section="scenario_table"]').innerText(), /31(\.0)?%/);
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

test('the monitor opens with What to do now, draws the signal with its range, the triage queue and the exceptions by rule and by age', async () => {
  const info = appInfo(DECIDE, 1, {}, 'examples/monitor_triage.json');
  const layout = KINDS.layouts.find((l) => l.id === 'monitor_triage');
  assert.equal(layout.enabled, true);
  assert.deepEqual(info.pages[0].layout.sections, layout.sections);
  const { page, seen, context } = await openApp(browser, base, info, { routes: monitorRoutes() });
  await page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 3);
  await page.locator('[data-section="triage_queue"] tbody tr').first().waitFor();
  assert.deepEqual([...new Set(await sectionsOf(page))], ['todo', 'kpis', 'signal_band', 'triage_queue', 'exceptions_by_rule', 'aging_buckets']);
  for (const [section, low] of Object.entries(layout.min_items)) {
    const n = await itemsIn(page, section);
    assert.ok(n >= low, `${section} holds ${n}, needs ${low}`);
  }
  assert.equal(await page.locator('[data-todo-count]').innerText(), '24 of 24 waiting for you');
  assert.match(await page.locator('[data-step="first"]').innerText(), /Start with Account 1/);
  assert.match(await page.locator('[data-section="signal_band"] [data-so-what]').innerText(), /outside the range are the exceptions/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the explainer opens with What to do now, draws the variance list, the bridge from plan to actual, the peers and the drivers', async () => {
  const info = appInfo(DECIDE, 1, {}, 'examples/performance_explainer.json');
  const layout = KINDS.layouts.find((l) => l.id === 'performance_explainer');
  assert.equal(layout.enabled, true);
  assert.deepEqual(info.pages[0].layout.sections, layout.sections);
  const { page, seen, context } = await openApp(browser, base, info, { routes: explainerRoutes() });
  await page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 3);
  await page.locator('[data-section="variance_table"] tbody tr').first().waitFor();
  await page.locator('[data-section="quote_cards"] tbody tr').first().waitFor();
  assert.deepEqual([...new Set(await sectionsOf(page))], ['todo', 'kpis', 'variance_table', 'bridge', 'peer_table', 'peer_scatter', 'driver_tornado', 'quote_cards']);
  for (const [section, low] of Object.entries(layout.min_items)) {
    const n = section === 'bridge' ? Number(await page.locator('[data-section="bridge"] [data-card]').getAttribute('data-rows')) : await itemsIn(page, section);
    assert.ok(n >= low, `${section} holds ${n}, needs ${low}`);
  }
  assert.match(await page.locator('[data-section="variance_table"]').innerText(), /Unit 1/);
  assert.match(await page.locator('[data-section="quote_cards"]').innerText(), /shipped two weeks late/);
  assert.match(await page.locator('[data-section="bridge"] [data-so-what]').innerText(), /biggest step/);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the dashboard is read only: What to do now, a So what line and Ask Genie on every chart and table, and no decision list', async () => {
  const info = appInfo(DECIDE, 1, {}, 'examples/dashboard.json');
  const layout = KINDS.layouts.find((l) => l.id === 'dashboard');
  assert.equal(layout.enabled, true);
  assert.deepEqual(info.pages[0].layout.sections, layout.sections);
  assert.equal(info.pages[0].layout.decides, false);
  const asked = [];
  const { page, seen, context } = await openApp(browser, base, info, { routes: dashboardRoutes(asked) });
  await page.waitForFunction(() => document.querySelectorAll('[data-section] canvas').length >= 3);
  await page.locator('[data-section="tables"] tbody tr').first().waitFor();
  assert.deepEqual([...new Set(await sectionsOf(page))], ['todo', 'kpis', 'charts', 'tables']);
  for (const [section, low] of Object.entries(layout.min_items)) {
    const n = await itemsIn(page, section);
    assert.ok(n >= low, `${section} holds ${n}, needs ${low}`);
  }
  assert.match(await page.locator('[data-section="kpis"]').innerText(), /Growth\s+7\.7%/);
  const widgets = info.pages[0].charts.length + info.pages[0].tables.length;
  assert.equal(await page.locator('[data-section="charts"] [data-so-what], [data-section="tables"] [data-so-what]').count(), widgets);
  assert.equal(await page.locator('[data-section="charts"] [data-ask], [data-section="tables"] [data-ask="table"]').count(), widgets);
  assert.deepEqual(await page.locator('[data-section="todo"] [data-step]').evaluateAll((n) => n.map((s) => s.dataset.step)), ['read', 'so_what', 'filters', 'genie']);
  assert.equal(await page.locator('[data-todo-count]').count(), 0);
  assert.equal(await page.getByRole('button', { name: 'Accept' }).count(), 0);
  assert.equal(info.pages[0].layout.informational, true);
  const acts = [];
  await page.route('**/api/records/act', (route) => { acts.push(route.request().postDataJSON()); return route.fulfill({ status: 500, body: '{}' }); });
  await page.locator('[data-section="tables"] tbody tr').first().click();
  const detail = page.locator('[data-row-detail]');
  await detail.waitFor();
  assert.match(await detail.innerText(), /Oat bar/);
  const ACTIONS = /^(Mark done|Mark done…|Mark all done…|Not an issue|Not an issue…|Snooze…|Snooze all…|Ask Genie to fix|Could not fix)$/;
  assert.equal(await page.getByRole('button', { name: ACTIONS }).count(), 0, 'an informational page offers no record action anywhere');
  assert.equal(await page.locator('[data-act], [data-bulk], [data-act-all], .bulk, [data-start-work]').count(), 0);
  assert.equal(await page.getByRole('checkbox').count(), 0, 'an informational page selects no rows to act on');
  await detail.getByRole('button', { name: 'Close' }).click();
  await page.waitForFunction(() => !document.querySelector('[data-row-detail]'));
  assert.deepEqual(asked, [], 'a dashboard never asks for a decision list');
  assert.deepEqual(acts, [], 'a dashboard never records a decision');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('the use case switcher names each layout by its tab label, and the decision queue by its use case id with no layout label', async () => {
  for (const [example, label] of [['examples/scenario_lab.json', 'Scenarios'], ['examples/monitor_triage.json', 'Triage'], ['examples/performance_explainer.json', 'Explain'],
    ['examples/dashboard.json', 'Overview'], ['example_page.json', null]]) {
    const info = appInfo(DECIDE, 2, {}, example);
    const { page, context } = await openApp(browser, base, info, { ready: '[data-switcher]' });
    await page.locator('[data-switcher]').click();
    const note = await page.locator(`[data-case="${info.pages[0].id}"] small`).innerText();
    assert.equal(note.split(' · ')[0], label || info.pages[0].use_case_id, example);
    await context.close();
  }
});

test('the decision queue page opens with What to do now', async () => {
  const info = appInfo();
  assert.equal(info.pages[0].layout.id, 'decision_queue');
  const { page, seen, context } = await openApp(browser, base, info);
  await page.locator('[data-section="todo"] [data-step="first"]').waitFor();
  assert.match(await page.locator('[data-step="first"]').innerText(), /Start with Item number 1/);
  assert.equal(await page.locator('[data-step="accept"]').count(), 0, 'an App that keeps no decisions offers no accept');
  assert.equal(await page.locator('[data-accept]').count(), 0);
  assert.equal(seen.records.length, 1, 'What to do now reads the list the records card loaded, with no second request');
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('accepting a suggested action takes one click on a row, or one click for the selected rows, through records/act', async () => {
  const info = appInfo(DECIDE, 1, TABLE);
  const { calls, routes } = tracked();
  const { page, seen, context } = await openApp(browser, base, info, { routes });
  await page.locator('[data-step="accept"]').waitFor();
  assert.match(await page.locator('[data-step="accept"]').innerText(), /Accept the suggested action where you agree/);
  await page.locator('[data-rail="work"]').click();
  await page.locator('[data-accept="R001"]').waitFor();
  assert.equal(await page.locator('[data-accept="R002"]').count(), 0, 'a record already in progress has nothing left to accept');
  await page.locator('[data-accept="R001"]').click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent?.startsWith('Accepted the suggested action on 1 record.'));
  assert.deepEqual(calls.acts.at(-1), { page: info.pages[0].id, record_keys: ['R001'], seen: { R001: '100' }, values: { action_status: 'In progress', note: 'Accepted the suggested action' } });
  for (const name of ['Item number 2 with a long descriptive name', 'Item number 3 with a long descriptive name', 'Item number 5 with a long descriptive name']) {
    await page.getByLabel(`Select ${name}`).check();
  }
  await page.locator('[data-accept-picked]').click();
  await page.waitForFunction(() => document.querySelector('.toast .toast-t')?.textContent?.startsWith('Accepted the suggested action on 2 records. Left 1 record as they are'));
  assert.deepEqual(calls.acts.at(-1), { page: info.pages[0].id, record_keys: ['R003', 'R005'], seen: { R003: '102', R005: '104' },
    values: { action_status: 'In progress', note: 'Accepted the suggested action' } });
  assert.equal(calls.acts.length, 2);
  assert.deepEqual(seen.errors, []);
  await context.close();
});

test('a records-list row action says its result in the row, a bulk action and Undo say it over the list, and the open · done line follows each decision', async () => {
  const info = appInfo(DECIDE, 1, TABLE);
  const done = new Map();
  const { calls, routes } = tracked({
    'records/act': ({ route, json }) => {
      const body = actBody(route);
      calls.acts.push(body);
      for (const k of body.record_keys || []) done.set(k, `b${calls.acts.length}`);
      return json(200, { written: body.record_keys, conflicts: [], batch_id: `b${calls.acts.length}` });
    },
    'records/undo': ({ route, json }) => {
      const body = route.request().postDataJSON();
      calls.undos.push(body);
      const back = [...done].filter(([, b]) => b === body.batch_id).map(([k]) => k);
      for (const k of back) done.delete(k);
      return json(200, { restored: back.length, skipped: 0, conflicts: [] });
    },
  });
  const n = ROWS.length;
  const summary = () => ({ open: n - done.size, done: done.size, resolved: 0, left: 0, owners: [] });
  routes.records = (ctx) => {
    const body = ctx.route.request().postDataJSON();
    ctx.seen.records.push(body);
    const rows = ROWS.slice(body.offset, body.offset + body.limit);
    return ctx.json(200, { rows, total: ROWS.length, offset: body.offset, limit: body.limit, actions: true, changes: true, summary: summary(), errors: {} });
  };
  const { page, seen, context } = await openApp(browser, base, info, { routes, hash: `#/${info.pages[0].id}/work` });
  const impact = (text) => page.waitForFunction((t) => document.querySelector('.impact')?.textContent === t, text, { timeout: 10000 })
    .catch(async () => assert.fail(`impact is "${await page.locator('.impact').innerText().catch(() => 'none')}", not "${text}"`));
  await impact(`Actions: ${n} open · 0 done`);
  await page.locator('[data-accept="R001"]').click();
  const note = page.locator('[data-said="R001"]');
  await note.waitFor();
  assert.match(await note.innerText(), /^Accepted the suggested action on 1 record\./);
  assert.equal(await page.locator('tr', { has: note }).locator('[data-accept="R001"], .cell-t').count() > 0, true, 'the message sits in the row it is about');
  await impact(`Actions: ${n - 1} open · 1 done · 0 resolved by a later run (0/1)`);
  for (const name of ['Item number 3 with a long descriptive name', 'Item number 5 with a long descriptive name']) await page.getByLabel(`Select ${name}`).check();
  await page.locator('[data-accept-picked]').click();
  await page.locator('[data-said="all"]').filter({ hasText: /^Accepted the suggested action on 2 records/ }).waitFor();
  assert.equal(await page.locator('[data-said="R001"]').count(), 0, 'one message at a time: the newest replaces the row note');
  await impact(`Actions: ${n - 3} open · 3 done · 0 resolved by a later run (0/3)`);
  await page.locator('.toast').getByRole('button', { name: 'Undo' }).last().click();
  await page.locator('[data-said="all"]').filter({ hasText: 'Undone: 2 records are back as they were.' }).waitFor();
  await impact(`Actions: ${n - 1} open · 1 done · 0 resolved by a later run (0/1)`);
  assert.equal(calls.undos.length, 1);
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
