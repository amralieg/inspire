import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { chromium } from 'playwright';
import { SRC, bundleEntry, openBundle } from './harness.mjs';
import { cutLabels, rendererEntry, renderedTexts } from './axisLabels.mjs';

const P = { ink: '#111', muted: '#666', line: '#ddd', card: '#fff', well: '#eee', font: 'Inter', series: ['#1', '#2', '#3', '#4', '#5', '#6'], tier: { 'Act now': '#c00' } };
const RULES = ['Rate above contract', 'Duplicate invoice', 'Weight above shipped', 'Fuel surcharge above cap'];
const UNITS = ['North region, Outerwear and coats', 'South region, Camping and tents', 'East region, Bags and luggage'];
const MANY = Array.from({ length: 30 }, (_, i) => `Category number ${i + 1} with a long name`);
const BUNDLE_ELLIPSIS = /\u00e2\u20ac\u00a6$/;
const money = (label) => ({ label, format: 'currency', currency: 'USD' });

let browser;
let bundle;

before(async () => {
  browser = await chromium.launch();
  bundle = await bundleEntry(rendererEntry(SRC));
});

after(async () => {
  await browser?.close();
});

async function inBundle(run, arg) {
  const { page, context, errors } = await openBundle(browser, bundle, {});
  const out = await page.evaluate(run, arg);
  await context.close();
  assert.deepEqual(errors, []);
  return out;
}

const draw = (chart, rows, width, height) => inBundle(({ chart, rows, P, width, height }) => window.drawChart(chart, rows, P, width, height), { chart, rows, P, width, height });

const BOTTOM_AXIS = {
  pareto: [{ type: 'pareto', x: { kind: 'category' }, y: [{ label: 'Open exceptions', format: 'integer' }] }, (names) => names.map((x, i) => ({ x, y0: 20 - i }))],
  bar: [{ type: 'bar', x: { kind: 'category' }, y: [money('Exposure')] }, (names) => names.map((x, i) => ({ x, y0: 1000 * (i + 1) }))],
  bridge: [{ type: 'bridge', x: { kind: 'category' }, y: [money('Change')] }, (names) => names.map((x, i) => ({ x, y0: i ? -100 : 1000 }))],
  box: [{ type: 'box', x: { kind: 'category' }, y: ['Low', 'Q1', 'Median', 'Q3', 'High'].map((label) => ({ label, format: 'number' })) },
    (names) => names.map((x, i) => ({ x, y0: 1, y1: 2, y2: 3 + i, y3: 4 + i, y4: 9 }))],
  heatmap: [{ type: 'heatmap', x: { kind: 'category' }, y: [{ label: 'Cases', format: 'integer' }] }, (names) => names.map((x, i) => ({ x, s: 'All', y0: i }))],
};

const SIDE_AXIS = {
  horizontal_bar: [{ type: 'horizontal_bar', x: { kind: 'category' }, y: [money('Change')] }, (names) => names.map((x, i) => ({ x, y0: 100 * (i + 1) }))],
  tornado: [{ type: 'tornado', x: { kind: 'category' }, y: [money('Down'), money('Up')] }, (names) => names.map((x, i) => ({ x, y0: -100 * (i + 1), y1: 50 }))],
  bullet: [{ type: 'bullet', x: { kind: 'category' }, y: [{ label: 'Used', format: 'number' }, { label: 'Limit', format: 'number' }] }, (names) => names.map((x, i) => ({ x, y0: 5 + i, y1: 10 }))],
  gantt: [{ type: 'gantt', x: { kind: 'category' }, y: [{ label: 'Start', format: 'number' }, { label: 'End', format: 'number' }] }, (names) => names.map((x, i) => ({ x, y0: i, y1: i + 3 }))],
};

test('a long category on a wide bottom axis shows its full name on every chart that draws one', async () => {
  for (const [type, [chart, rows]] of Object.entries(BOTTOM_AXIS)) {
    const drawn = await draw(chart, rows(RULES), 1100);
    assert.deepEqual(cutLabels(drawn.svg, RULES), [], `${type} shows each rule in full`);
    assert.equal(drawn.x[0].formatted, false, `${type} cuts no label to a fixed count`);
    assert.equal(drawn.x[0].label.rotate, 0, `${type} does not tilt labels that fit`);
  }
});

test('a long category on a wide side axis shows its full name, and the side grows to fit it', async () => {
  for (const [type, [chart, rows]] of Object.entries(SIDE_AXIS)) {
    const drawn = await draw(chart, rows(UNITS), 1100);
    assert.deepEqual(cutLabels(drawn.svg, UNITS), [], `${type} shows each unit in full`);
    assert.ok(drawn.grid.left > 120, `${type} widens its side for the names: ${drawn.grid.left}`);
  }
});

test('a crowded axis still cuts its labels, tilts them, hides the ones that would overlap, and keeps every full name for the tooltip', async () => {
  for (const type of ['pareto', 'bar']) {
    const [chart, rows] = BOTTOM_AXIS[type];
    const drawn = await draw(chart, rows(MANY), 520, 420);
    const texts = renderedTexts(drawn.svg).filter((t) => t.startsWith('Category')).map((t) => t.replace(BUNDLE_ELLIPSIS, '…'));
    assert.equal(drawn.x[0].label.rotate, 35, type);
    assert.equal(drawn.x[0].label.hideOverlap, true, type);
    assert.equal(drawn.x[0].label.overflow, 'truncate', type);
    assert.ok(texts.length > 0 && texts.length < MANY.length, `${type} hides the labels that would overlap: ${texts.length} of ${MANY.length}`);
    assert.ok(texts.every((t) => t.endsWith('…')), `${type} still cuts each long label: ${texts.slice(0, 3)}`);
    assert.deepEqual(drawn.x[0].data, MANY, `${type} keeps each full name as the category the tooltip shows`);
    assert.equal(drawn.tooltip, 'axis', type);
  }
});

test('the label check fails the old cut of every category to 12 characters, though each bar had room for the full name', async () => {
  const svg = await inBundle(({ names }) => window.drawOption({
    grid: { left: 58, right: 44, top: 28, bottom: 64 },
    xAxis: { type: 'category', data: names, axisLabel: { formatter: (v) => (v.length > 12 ? `${v.slice(0, 11)}…` : v) } },
    yAxis: { type: 'value' },
    series: [{ type: 'bar', data: names.map((_, i) => 20 - i) }],
  }, 1100), { names: RULES });
  assert.deepEqual(cutLabels(svg, RULES), RULES);
  assert.ok(renderedTexts(svg).includes('Rate above …'));
});
