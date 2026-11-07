import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from 'playwright';
import { SRC, bundleEntry, openBundle } from './harness.mjs';

const P = { ink: '#111', muted: '#666', line: '#ddd', card: '#fff', well: '#eee', font: 'Inter', series: ['#1', '#2', '#3', '#4', '#5', '#6'], tier: { 'Act now': '#c00' } };
const BARS = ['bar', 'horizontal_bar', 'stacked_bar', 'pareto', 'tornado', 'bullet', 'bridge', 'gantt', 'box'];
const TYPES = [...BARS, 'donut', 'scatter', 'map_points', 'line', 'area', 'stacked_area', 'band', 'control', 'heatmap', 'treemap', 'map_regions', 'graph', 'flow', 'sankey', 'radar'];

let browser;
let parts;
before(async () => {
  browser = await chromium.launch();
  parts = await bundleEntry(`import * as charts from ${JSON.stringify(join(SRC, 'charts.js'))};\nwindow.charts = charts;`);
});
after(async () => { await browser?.close(); });

async function inBundle(run, arg) {
  const { page, context, errors } = await openBundle(browser, parts, {});
  const out = await page.evaluate(run, arg);
  await context.close();
  assert.deepEqual(errors, []);
  return out;
}

test('the click hint names the part a person can click on each chart, never a bar or slice on a line, a map or a heatmap', async () => {
  const words = await inBundle(({ TYPES }) => Object.fromEntries(TYPES.map((type) => [type, window.charts.clickHint({ type, click_filter: 'f1' })])), { TYPES });
  for (const type of BARS) assert.equal(words[type], ' Click a bar to filter the page.', type);
  assert.equal(words.donut, ' Click a slice to filter the page.');
  assert.equal(words.line, ' Click a point to filter the page.');
  assert.equal(words.scatter, ' Click a dot to filter the page.');
  assert.equal(words.heatmap, ' Click a cell to filter the page.');
  assert.equal(words.treemap, ' Click a block to filter the page.');
  assert.equal(words.map_regions, ' Click a region to filter the page.');
  for (const [type, text] of Object.entries(words)) assert.doesNotMatch(text, /bar or slice/, type);
});

test('no click hint when the chart filters nothing, is folded, or is a radar whose clicks name a series, not a value of the filter (must-exclude)', async () => {
  const got = await inBundle(() => {
    const { clickHint, clickPart } = window.charts;
    return [clickHint({ type: 'bar' }), clickHint({ type: 'bar', click_filter: 'f1' }, true), clickHint({ type: 'radar', click_filter: 'f1' }), clickPart('radar')];
  });
  assert.deepEqual(got, ['', '', '', '']);
});

test('a click picks the value the filter knows: the heatmap column, the gantt row and the sankey step without its side, never an empty name', async () => {
  const got = await inBundle(({ P }) => {
    const { chartOption, clickPick } = window.charts;
    const heat = chartOption({ type: 'heatmap', x: { kind: 'category' }, series: { column: 's' }, y: [{ label: 'Orders', format: 'integer' }] },
      [{ x: 'North', s: 'Mon', y0: 4 }, { x: 'South', s: 'Tue', y0: 2 }], P);
    const gantt = chartOption({ type: 'gantt', x: { kind: 'category' }, y: [{ label: 'Start', format: 'number' }, { label: 'End', format: 'number' }] },
      [{ x: 'Phase A', y0: 1, y1: 4 }], P);
    const sankey = chartOption({ type: 'sankey', x: { kind: 'category' }, series: { column: 's', top: 8 }, y: [{ label: 'Customers', format: 'integer' }] },
      [{ x: 'Loyal', s: 'Lapsing', y0: 40 }], P);
    return {
      heat: heat.series[0].data.map((d) => clickPick('heatmap', { data: d, name: '' })),
      heatTip: heat.tooltip.formatter({ value: heat.series[0].data[0].value }),
      gantt: clickPick('gantt', { data: gantt.series[0].data[0], name: '' }),
      sankey: sankey.series[0].data.map((d) => clickPick('sankey', { data: d, name: d.name })).sort(),
      plain: [clickPick('bar', { name: '' }), clickPick('bar', { name: 'Other' }), clickPick('bar', { name: 'East' }), clickPick('scatter', { data: [1, 2, 'Store 4'] })],
    };
  }, { P });
  assert.deepEqual(got.heat, ['North', 'South']);
  assert.match(got.heatTip, /^Mon .+ North<br><b>4<\/b>$/);
  assert.equal(got.gantt, 'Phase A');
  assert.deepEqual(got.sankey, ['Lapsing', 'Loyal']);
  assert.deepEqual(got.plain, [null, null, 'East', 'Store 4']);
});

test('the chart card takes its click words and picks from the one place that names them', () => {
  const card = readFileSync(join(SRC, 'ChartCard.jsx'), 'utf8');
  assert.doesNotMatch(card, /bar or slice/);
  assert.match(card, /clickHint\(chart, fold\.folded\)/);
  assert.match(card, /clickPick\(chart\.type, e\)/);
});
