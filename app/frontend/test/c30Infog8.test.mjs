// C30 phase 8 (REQ-574, REQ-571): two infographic leftovers of c30_infog7, as geometry invariants over every fixture use case x 12 concepts
// x 2 orientations, holdout A (every distinct use case of the three recorded sessions, its local pick, both orientations) and a right-to-left row:
// (a) a row of steps (disc, label, arrow) shares its row evenly: the gaps between consecutive step boxes are within 1.5x of each other;
// (b) every funnel band carries a text inside it (its value or its short label), never an icon alone;
// (c) a funnel side label never repeats the subtitle (the problem line under the title) word for word.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { ROWS } from './c27x_fixture.mjs';
import { SCENARIO_IDS } from '../../backend/lib/infographicPick.mjs';
import { infographicFor } from '../src/lib/docgen/designs/infographic.js';
import { fallbackPick } from '../src/lib/docgen/designs/infographicPick.js';
import { contentFor } from '../src/lib/docgen/designs/infog/content.js';

const load = (name) => { const d = JSON.parse(zlib.gunzipSync(fs.readFileSync(new URL(`../../backend/showcase/${name}.json.gz`, import.meta.url)))); const k = Object.keys(d.inspire).find((x) => x.includes('/api/inspire/results?'));
  return d.inspire[k].body.results.domains.flatMap((dm) => dm.use_cases); };
const A = []; for (const f of ['kinds-retail', 'nyctaxi', 'tpcds-retail']) { const seen = new Set(); for (const r of load(f)) { const id = String(r.No); if (!seen.has(id)) { seen.add(id); A.push({ ...r, __src: `${f}:${id}` }); } } }
const ORIENTS = ['landscape', 'portrait'];

// A right-to-left row whose statement is one line with two numbers: the funnel takes its stages from it, and the subtitle is that same line.
const base = ROWS[0];
const RTL = { ...base, Name: 'توقع الطلب الأسبوعي للمنتجات', Statement: 'يتأخر الطلب 14.6 ساعة في خطوة واحدة. تتأثر 2,400 طلبية كل أسبوع.', Beneficiary: 'فريق التخطيط', 'Decision Cadence': 'أسبوعيا', 'Business Value': 'قيمة محفوظة. At stake: $1.2M a year.' };

const RUNS = [];
for (const r of ROWS) for (const id of SCENARIO_IDS) for (const o of ORIENTS) RUNS.push({ row: r, tag: `${r.No}/${id}/${o}`, id, o });
for (const r of A) { const id = fallbackPick(r).scenario; for (const o of ORIENTS) RUNS.push({ row: r, tag: `${r.__src}/${id}/${o}`, id, o }); }
for (const r of [...ROWS, RTL]) for (const o of ORIENTS) RUNS.push({ row: r, tag: `${r.No}/funnel/${o}/rtl`, id: 'funnel', o, rtl: true });
for (const x of RUNS) { x.svg = infographicFor(x.row, { orientation: x.o, scenario: x.id, rtl: !!x.rtl }); x.concept = (/data-concept="([^"]+)"/.exec(x.svg) || [])[1] || x.id; }

const GEO = () => {
  const svg = document.querySelector('#host svg'); const cv = svg.getBoundingClientRect();
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - cv.left, y: r.top - cv.top, w: r.width, h: r.height }; };
  const flows = [...svg.querySelectorAll('g[data-process="flow"]')].map((g) => {
    const boxes = [...g.children].filter((c) => c.matches('g[data-slot]')).map(R).sort((a, b) => a.x - b.x);
    return boxes.slice(1).map((b, i) => Math.round(b.x - (boxes[i].x + boxes[i].w)));
  });
  const texts = [...svg.querySelectorAll('text')].map((t) => ({ s: [...t.querySelectorAll('tspan')].map((x) => x.textContent).join(' ') || t.textContent, b: R(t) }));
  const bands = [...svg.querySelectorAll('g[data-process="funnel"] > path')].map((p) => { const b = R(p);
    return texts.some((t) => { const cx = t.b.x + t.b.w / 2; const cy = t.b.y + t.b.h / 2; return t.s.trim() && cx > b.x && cx < b.x + b.w && cy > b.y && cy < b.y + b.h; }); });
  return { flows, bands, texts: texts.map((t) => t.s) };
};
async function geo(page, svg) {
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg) || [];
  await page.setViewportSize({ width: Number(w) + 40, height: Number(h) + 40 });
  await page.setContent(`<html><body style="margin:0"><div id="host" style="position:absolute;left:0;top:0">${svg}</div></body></html>`);
  return page.evaluate(GEO);
}
let G = null;
async function all() {
  if (G) return G; const browser = await chromium.launch({ headless: true }); const page = await browser.newPage();
  try { for (const x of RUNS) x.geo = await geo(page, x.svg); } finally { await browser.close(); }
  G = RUNS; return G;
}
const norm = (s) => String(s || '').toLowerCase().replace(/\s+/g, ' ').replace(/[\s.,;:!?،؛۔]+$/, '').trim();

test('(a) a row of steps shares its row evenly: gaps between consecutive step boxes within 1.5x of each other', async () => {
  const runs = await all(); const bad = []; let rows = 0;
  for (const x of runs) for (const gaps of x.geo.flows) { if (gaps.length < 2) continue; rows += 1; const lo = Math.min(...gaps); const hi = Math.max(...gaps);
    if (hi > 1.5 * Math.max(lo, 1)) bad.push(`${x.tag}: gaps ${gaps.join(',')}`); }
  assert.ok(rows > 10, `only ${rows} step rows with 3+ steps: the check is vacuous`);
  assert.deepEqual(bad.slice(0, 15), [], `${bad.length} of ${rows} step rows with uneven gaps`);
});

test('(b) every funnel band has a text inside it (never an icon alone)', async () => {
  const runs = await all(); const bad = []; let bands = 0;
  for (const x of runs) { bands += x.geo.bands.length; const empty = x.geo.bands.map((ok, i) => (ok ? -1 : i + 1)).filter((i) => i > 0); if (empty.length) bad.push(`${x.tag}: band ${empty.join(',')} of ${x.geo.bands.length} has no text`); }
  assert.ok(bands > 50, `only ${bands} funnel bands drawn: the check is vacuous`);
  assert.deepEqual(bad.slice(0, 15), [], `${bad.length} funnels with a band that shows no text`);
});

test('(c) no funnel side label repeats the subtitle word for word', async () => {
  const runs = await all(); const bad = []; let n = 0;
  for (const x of runs.filter((r) => r.concept === 'funnel')) { const sub = norm(contentFor(x.row, 'funnel', null).problem); if (!sub) continue; n += 1;
    const same = x.geo.texts.filter((t) => norm(t) === sub).length; if (same > 1) bad.push(`${x.tag}: the subtitle shows ${same} times`); }
  assert.ok(n > 10, `only ${n} funnels with a subtitle`);
  assert.deepEqual(bad.slice(0, 15), [], `${bad.length} of ${n} funnels repeat the subtitle as a side label`);
});
