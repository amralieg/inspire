// C27 (REQ-563): infographic and Word fixes. Domain bar labels wrap without overlap (never cut), an unknown verb gets its own colour,
// cards title by the use case Name (not the subtitle), and every document counts domains the same way.
import test from 'node:test';
import assert from 'node:assert/strict';
import { hbars } from '../src/lib/docgen/designs/charts.js';
import { verbColors } from '../src/lib/docgen/designs/core.js';
import { toDesignModel } from '../src/lib/docgen/designs/model.js';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';

const LONG = 'Customers and credit for premium segments';
const OPTS = { rowH: 20, barH: 9, labelW: 118, valueW: 60, track: '#eee', fill: () => '#0a0', ink: '#111', bg: '#fff', font: 'sans-serif' };

test('(1) a domain label too long for its column wraps, the row grows, and the text is never cut', () => {
  const rows = [{ label: LONG, value: 5, text: '$5M' }, { label: 'Stores', value: 3, text: '$3M' }];
  const { svg, h } = hbars(rows, { x: 0, y: 0, w: 400 }, OPTS);
  assert.ok(h > rows.length * OPTS.rowH, `rows did not grow for a wrapped label (h=${h})`);
  assert.ok(!/…|\.\.\./.test(svg), 'the label was cut');
  const words = LONG.split(' ');
  for (const w of words) assert.ok(svg.includes(w), `word "${w}" missing`);
  // The second row's label baseline sits below the last line of the first label.
  const ys = [...svg.matchAll(/<text x="0" y="([\d.]+)"[^>]*>(.*?)<\/text>/g)].filter((m) => /Stores/.test(m[2]) || /Customers/.test(m[2])).map((m) => Number(m[1]));
  const lines = (svg.match(/<tspan/g) || []).length;
  assert.ok(lines > 2 + 2, 'the long label did not wrap');
  assert.ok(ys[1] - ys[0] >= 2 * 14, `rows overlap (label baselines ${ys.join(', ')})`);
});

test('(2) an unknown verb never takes the colour of a known verb', () => {
  const known = { 'GROW REVENUE': '#aaa', 'CUT COST': '#bbb' };
  const pool = ['#aaa', '#bbb', '#ccc', '#ddd'];
  const c = verbColors(known, [{ name: 'GROW REVENUE' }, { name: 'CUT COST' }, { name: 'REDUCE RISK' }, { name: 'OTHER ONE' }], pool);
  assert.ok(!['#aaa', '#bbb'].includes(c['REDUCE RISK']), 'REDUCE RISK shares a known verb colour');
  assert.notEqual(c['REDUCE RISK'], c['OTHER ONE']);
});

const uc = (i, o = {}) => ({ No: `N0${i}-U01`, Name: `Name of case ${i}`, usecase: `Subtitle ${i}`, 'Business Domain': `Domain ${i}`, Subdomain: 'S', Statement: 'A statement.', Quality: 'High', 'Quality Score': 4, 'Inspire Score': 8, ...o });
const val = { amount: 1e6, currency: 'USD', status: 'calculated', verb: 'CUT COST', story: 's', yearly: [] };

test('(3) a design card titles by the use case Name, not the subtitle', () => {
  const doc = buildDocModel({ businessName: 'Acme', useCases: [uc(1), uc(2)], values: { 'N01-U01': val, 'N02-U01': val }, options: defaultDocOptions('English') });
  const m = toDesignModel(doc);
  assert.ok(m.useCases.length > 0);
  for (const u of m.useCases) assert.ok(/^Name of case/.test(u.short), `short is "${u.short}"`);
});

test('(5) the infographic counts the same domains as Word: every domain of the document, valued or not', () => {
  const ucs = [1, 2, 3, 4].map((i) => uc(i));
  const doc = buildDocModel({ businessName: 'Acme', useCases: ucs, values: { 'N01-U01': val, 'N02-U01': val }, options: defaultDocOptions('English') });
  const distinct = new Set(doc.useCases.map((u) => u.domain).filter(Boolean)).size;
  assert.equal(distinct, 4);
  assert.equal(toDesignModel(doc).total.nDomains, distinct);
});
