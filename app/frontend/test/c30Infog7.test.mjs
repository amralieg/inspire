// C30 phase 7 (REQ-574, REQ-571): the last three infographic leftovers of c29_infog6, as invariants over the c29Infog6 fixtures
// (every fixture use case x 12 concepts x 2 orientations), holdout A (every distinct use case of the three recorded sessions) and rows
// whose labels are forced to drop:
// (a) never an icon without a non-empty label: every icon is drawn inside a slot (data-slot) that holds a label (a text that is not only
//     a number badge or an upper-case heading); when every label of a concept drops, the page falls back to another concept or to text,
//     never to bare icons;
// (b) the landscape footer has no empty middle: the gap between footer items stays under 25% of the width;
// (c) every before/after panel is at least half filled (its text and icons cover half its height or more).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { ROWS } from './c27x_fixture.mjs';
import { flatText } from './tools/infogCheck.mjs';
import { SCENARIO_IDS } from '../../backend/lib/infographicPick.mjs';
import { infographicFor } from '../src/lib/docgen/designs/infographic.js';
import { fallbackPick } from '../src/lib/docgen/designs/infographicPick.js';

const load = (name) => { const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(`../../backend/showcase/${name}.json.gz`, import.meta.url)))); const k = Object.keys(d.inspire).find((x) => x.includes('/api/inspire/results?'));
  return d.inspire[k].body.results.domains.flatMap((dm) => dm.use_cases); };
const A = []; for (const f of ['kinds-retail', 'nyctaxi', 'tpcds-retail']) { const seen = new Set(); for (const r of load(f)) { const id = String(r.No); if (!seen.has(id)) { seen.add(id); A.push({ ...r, __src: `${f}:${id}` }); } } }
const ORIENTS = ['landscape', 'portrait'];

// Labels forced to drop: a text of 70 words with no clause boundary has no whole phrase that fits any slot, so every slot it feeds drops.
const long = (w) => Array.from({ length: 70 }, (_, i) => `${w}${i % 7}`).join(' ');
const STEPS_DROP = { Solution: `Technique: ${long('alpha')}. ${long('beta')}. ${long('gamma')}.`, method_summary: `Technique: ${long('alpha')}. ${long('beta')}. ${long('gamma')}.`, serving_summary: `${long('screen')}: ${long('detail')}` };
const ALL_DROP = { ...STEPS_DROP, Statement: `${long('stmt')}. ${long('more')}.`, 'Business Value': `${long('value')}. At stake: $2.4M a year.`, Beneficiary: long('who'), 'Decision Cadence': long('cadence'), Sponsor: long('sponsor') };
const FORCED = [];
for (const r of ROWS) for (const [k, patch] of [['steps', STEPS_DROP], ['all', ALL_DROP]]) FORCED.push({ row: { ...r, ...patch }, tag: `${r.No}+${k}` });

const RUNS = [];
for (const r of ROWS) for (const id of SCENARIO_IDS) for (const o of ORIENTS) RUNS.push({ row: r, tag: `${r.No}/${id}/${o}`, id, o });
for (const r of A) { const id = fallbackPick(r).scenario; for (const o of ORIENTS) RUNS.push({ row: r, tag: `${r.__src}/${id}/${o}`, id, o }); }
const FRUNS = [];
for (const f of FORCED) for (const id of SCENARIO_IDS) for (const o of ORIENTS) FRUNS.push({ row: f.row, tag: `${f.tag}/${id}/${o}`, id, o });
for (const x of [...RUNS, ...FRUNS]) x.svg = infographicFor(x.row, { orientation: x.o, scenario: x.id });

// ---------- (a) a small SVG walker: each icon's nearest slot, and the slot's label ----------
const dec = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
// A label is a text with a lower-case letter, or one with no Latin letter at all (a number, a right-to-left script); an upper-case heading
// ("ON SCREEN") or a number badge alone is not a label.
const isLabel = (t) => { const s = t.trim(); return !!s && (/[a-z]/.test(s) || !/[A-Za-z]/.test(s)); };
export function bareIcons(svg) {
  const stack = []; const slots = []; const icons = []; let inText = null;
  for (const m of String(svg).matchAll(/<(\/?)([a-zA-Z]+)([^>]*?)(\/?)>|([^<]+)/g)) {
    if (m[5] !== undefined) { if (inText && !inText.badge && isLabel(dec(m[5]))) for (const s of stack) if (s.slot) s.slot.label = true; continue; }
    const [, close, tag, attrs, self] = m;
    if (close) { const top = stack.pop(); if (tag === 'text') inText = null; if (top && top.tag !== tag) return [`malformed svg: </${tag}> closes <${top.tag}>`]; continue; }
    const node = { tag, slot: /\sdata-slot=/.test(attrs) ? { label: false } : null, defs: tag === 'defs' || stack.some((s) => s.defs), badge: /data-shape="badge"/.test(attrs) || stack.some((s) => s.badge) };
    if (node.slot) slots.push(node.slot);
    if (/\sdata-icon="/.test(attrs) && !node.defs) { const near = [...stack].reverse().find((s) => s.slot); icons.push({ name: /data-icon="([^"]+)"/.exec(attrs)[1], slot: near ? near.slot : null }); }
    if (tag === 'text') inText = { badge: node.badge };
    if (!self) stack.push(node);
  }
  return icons.filter((i) => !i.slot || !i.slot.label).map((i) => `icon ${i.name} ${i.slot ? 'in a slot with no label' : 'outside any slot'}`);
}

test('(a) the walker flags an icon outside a slot, an icon whose slot has only a heading or a badge, and passes a labelled slot', () => {
  const ic = '<g data-icon="link"><path d="M0 0h2"/></g>';
  assert.equal(bareIcons(`<svg>${ic}</svg>`).length, 1);
  assert.equal(bareIcons(`<svg><g data-slot="1">${ic}<text>ON SCREEN</text></g></svg>`).length, 1);
  assert.equal(bareIcons(`<svg><g data-slot="1">${ic}<g data-shape="badge"><text>1</text></g></g></svg>`).length, 1);
  assert.equal(bareIcons(`<svg><g data-slot="1">${ic}<text>ON SCREEN</text><text><tspan>A ranked list</tspan></text></g></svg>`).length, 0);
  assert.equal(bareIcons(`<svg><defs>${ic}</defs></svg>`).length, 0);
});

test('(a) the forced rows really drop their labels (the check is not vacuous)', () => {
  const shown = FRUNS.filter((r) => /alpha\d alpha\d|beta\d beta\d|gamma\d gamma\d|screen\d screen\d/.test(flatText(r.svg))).map((r) => r.tag);
  assert.deepEqual(shown.slice(0, 5), [], `${shown.length} drawings show a forced text`);
});

test('(a) no icon without its label in any drawing (fixtures x 12 concepts x 2 orientations, holdout A, rows whose labels drop)', () => {
  const bad = [...RUNS, ...FRUNS].flatMap((r) => [...new Set(bareIcons(r.svg))].map((p) => `${r.tag}: ${p}`));
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} bare icons in ${RUNS.length + FRUNS.length} drawings`);
});

test('(a) a row whose labels all drop still draws a page with its title, and no icon without a label', () => {
  for (const f of FORCED.filter((x) => x.tag.endsWith('+all'))) for (const o of ORIENTS) {
    const svg = infographicFor(f.row, { orientation: o, scenario: fallbackPick(f.row).scenario });
    assert.ok(flatText(svg).length > 0, `${f.tag}/${o}: empty page`);
    assert.deepEqual(bareIcons(svg), [], `${f.tag}/${o}`);
  }
});

// ---------- (b) and (c) in the browser ----------
const FOOT = () => {
  const svg = document.querySelector('#host svg'); const cv = svg.getBoundingClientRect(); const W = cv.width; const top = 566;
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - cv.left, y: r.top - cv.top, w: r.width, h: r.height }; };
  const boxes = [];
  svg.querySelectorAll('tspan, text, image, [data-icon], [data-scene], rect').forEach((el) => {
    if (el.closest('defs') || (el.tagName === 'text' && el.querySelector('tspan'))) return; if (el.closest('[data-icon]') && !el.matches('[data-icon]')) return;
    const b = R(el); if (b.w < 1 || b.h < 1 || b.y < top || b.w > 0.9 * W) return; boxes.push([b.x, b.x + b.w]); });
  boxes.sort((a, b) => a[0] - b[0]); const merged = [];
  for (const [a, z] of boxes) { const l = merged[merged.length - 1]; if (l && a <= l[1]) l[1] = Math.max(l[1], z); else merged.push([a, z]); }
  let gap = 0; let at = 0; for (let i = 1; i < merged.length; i += 1) { const g = merged[i][0] - merged[i - 1][1]; if (g > gap) { gap = g; at = merged[i - 1][1]; } }
  return { gap, at, W, items: merged.length };
};
const PANELS = () => {
  const svg = document.querySelector('#host svg'); const cv = svg.getBoundingClientRect(); const bg = svg.querySelector(':scope > rect');
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - cv.left, y: r.top - cv.top, w: r.width, h: r.height }; };
  const out = [];
  for (const pn of svg.querySelectorAll('rect[rx]')) { if (pn === bg || pn.closest('defs')) continue; const p = R(pn); if (p.w <= 300 || p.h <= 80) continue;
    const spans = [];
    svg.querySelectorAll('tspan, text, [data-icon], circle').forEach((el) => { if (el.tagName === 'text' && el.querySelector('tspan')) return; if (el.closest('[data-icon]') && !el.matches('[data-icon]')) return;
      const b = R(el); if (b.w < 1 || b.h < 1 || b.x < p.x - 2 || b.y < p.y - 2 || b.x + b.w > p.x + p.w + 2 || b.y + b.h > p.y + p.h + 2) return; spans.push([b.y, b.y + b.h]); });
    spans.sort((a, b) => a[0] - b[0]); let cov = 0; let edge = -Infinity; for (const [a, z] of spans) { if (z > edge) { cov += z - Math.max(a, edge); edge = z; } }
    out.push({ y: Math.round(p.y), h: Math.round(p.h), fill: cov / p.h });
  }
  return out;
};
async function measure(page, svg, fn) {
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg) || [];
  await page.setViewportSize({ width: Number(w) + 40, height: Number(h) + 40 });
  await page.setContent(`<html><body style="margin:0"><div id="host" style="position:absolute;left:0;top:0">${svg}</div></body></html>`);
  return page.evaluate(fn);
}

test('(b) the landscape footer has no empty middle: the gap between footer items is under 25% of the width', async () => {
  const browser = await chromium.launch({ headless: true }); const bad = [];
  try {
    const page = await browser.newPage();
    const land = RUNS.filter((r) => r.o === 'landscape');
    assert.ok(land.some((r) => r.tag === 'N01-U04/pictogram/landscape'), 'the pictogram landscape of the gallery is checked');
    for (const r of land) { const f = await measure(page, r.svg, FOOT); if (f.gap >= 0.25 * f.W) bad.push(`${r.tag}: ${Math.round((100 * f.gap) / f.W)}% empty from x=${Math.round(f.at)}`); }
    assert.deepEqual(bad.slice(0, 20), [], `${bad.length} footers with an empty middle in ${land.length} drawings`);
  } finally { await browser.close(); }
});

test('(c) every before/after panel is at least half filled (holdouts N02-U02 and N04-U02 of tpcds-retail, and every fixture)', async () => {
  const tp = A.filter((r) => ['tpcds-retail:N02-U02', 'tpcds-retail:N04-U02'].includes(r.__src));
  assert.equal(tp.length, 2);
  const runs = [...tp.flatMap((r) => ORIENTS.map((o) => ({ tag: `${r.__src}/${o}`, svg: infographicFor(r, { orientation: o, scenario: 'beforeafter' }) }))),
    ...RUNS.filter((r) => r.id === 'beforeafter')];
  const browser = await chromium.launch({ headless: true }); const bad = [];
  try {
    const page = await browser.newPage();
    for (const r of runs) for (const p of await measure(page, r.svg, PANELS)) if (p.fill < 0.5) bad.push(`${r.tag}: panel at y=${p.y} (h ${p.h}) ${Math.round(100 * p.fill)}% filled`);
    assert.deepEqual(bad.slice(0, 20), [], `${bad.length} half-empty panels in ${runs.length} drawings`);
  } finally { await browser.close(); }
});
