// C29 phase 6 (REQ-574, REQ-571): the last infographic defects of the coordinator's visual review, as invariants over every fixture use case
// x 12 concepts x 2 orientations plus holdout A (every distinct use case of the three recorded sessions):
// (a) no icon, card or bullet is drawn without its label (a slot whose text drops goes, icon and all, and the rest re-flow);
// (b) a text inside a circle (a hub, a ring) stays inside that circle;
// (c) the whole-phrase check also runs on the rewritten sources the renderer reads (steps without their subject, the screen line), and a cut
//     is whole only where the phrase closes: never before "and"/"or"/a preposition when what is left is an open clause ("... outside what the
//     contract") or a verb without its complement ("... or charged");
// (d) every funnel tier label reads as a whole phrase alone (never "Of that value").
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { chromium } from 'playwright';
import { ROWS, rowByNo } from './c27x_fixture.mjs';
import { texts, sourcesOf } from './tools/infogCheck.mjs';
import { SCENARIO_IDS } from '../../backend/lib/infographicPick.mjs';
import { infographicFor } from '../src/lib/docgen/designs/infographic.js';
import { fallbackPick } from '../src/lib/docgen/designs/infographicPick.js';
import { contentFor } from '../src/lib/docgen/designs/infog/content.js';
import { stepsOf, storyOf } from '../src/lib/docgen/designs/infog/story.js';

const load = (name) => { const d = JSON.parse(zlib.brotliDecompressSync(fs.readFileSync(new URL(`../../backend/showcase/${name}.json.br`, import.meta.url)))); const k = Object.keys(d.inspire).find((x) => x.includes('/api/inspire/results?'));
  return d.inspire[k].body.results.domains.flatMap((dm) => dm.use_cases); };
const A = []; for (const f of ['kinds-retail', 'nyctaxi', 'tpcds-retail']) { const seen = new Set(); for (const r of load(f)) { const id = String(r.No); if (!seen.has(id)) { seen.add(id); A.push({ ...r, __src: `${f}:${id}` }); } } }

const ORIENTS = ['landscape', 'portrait'];
const RUNS = [];
for (const r of ROWS) for (const id of SCENARIO_IDS) for (const o of ORIENTS) RUNS.push({ row: r, tag: `${r.No}/${id}/${o}`, id, o });
for (const r of A) { const id = fallbackPick(r).scenario; for (const o of ORIENTS) RUNS.push({ row: r, tag: `${r.__src}/${id}/${o}`, id, o }); }
for (const x of RUNS) x.svg = infographicFor(x.row, { orientation: x.o, scenario: x.id });

// ---------- (c) the strict whole-phrase check ----------
const norm = (s) => String(s).toLowerCase().replace(/\s+/g, ' ').trim();
// The sources a drawn text may come from: the row's own fields, and the texts the renderer rewrites from them (story.js).
const rewritesOf = (row) => { const s = storyOf(row); return [...stepsOf(row, 5).map((x) => x.label), s.problem, s.insight, s.statement, s.screen, s.screenDetail, s.valueWhat, s.stake, s.who, s.cadence, s.title].filter(Boolean).map(norm); };
const sourcesWithRewrites = (rows) => [...sourcesOf(rows), ...rows.flatMap(rewritesOf)];
const PUNCT = /^\s?[.,;:!?)|(]/; const DASH = /^\s*[-–—]\s/;
const CLAUSE = /^\s(who|which|that|when|where|while|because|so|then|but|unless|since|using|through|before|after|until|via|instead)\s/;
const LINK = /^\s(and|or|to|for|with|by|from|in|on|at|across|into|over|under|between|within|without|toward|towards|around|among|near|above|below|beyond|against|about)\s/;
const SUBORD = new Set(['what', 'when', 'where', 'whether', 'if', 'than', 'which', 'that', 'who', 'whose', 'because', 'unless', 'while', 'until']);
const VERBISH = /^(is|are|was|were|be|been|has|have|had|do|does|did|can|could|will|would|may|might|must|should|come|go|run|make|take|give|show|get|need|allow|[a-z'-]+(s|ed))$/;
// A cut before "and"/"or"/a preposition leaves a closed phrase: it does not end on a verb in -ed (that wants what follows) and the clause its last
// subordinating word opens has reached a verb.
function closedAt(prefix) {
  const w = prefix.replace(/[^\w\s'-]/g, ' ').split(/\s+/).filter(Boolean);
  if (/[a-z]ed$/.test(w[w.length - 1] || '')) return false;
  let k = -1; w.forEach((x, i) => { if (SUBORD.has(x)) k = i; });
  return k < 0 || w.slice(k + 1).some((x) => VERBISH.test(x));
}
function strictCuts(svg, sources) {
  const bad = [];
  for (const raw of texts(svg)) {
    const t = norm(raw).replace(/[.,;:!?]+$/, ''); if (t.split(' ').length < 4) continue;
    const spots = []; for (const src of sources) { let i = src.indexOf(t); while (i >= 0) { spots.push([src, i]); i = src.indexOf(t, i + 1); } }
    const starts = spots.filter(([src, i]) => i === 0 || /[.;:!?|(,]\s$/.test(src.slice(Math.max(0, i - 2), i)) || /\b(and|then)\s$/.test(src.slice(Math.max(0, i - 5), i)));
    if (!starts.length) continue;
    const whole = starts.some(([src, i]) => { const rest = src.slice(i + t.length);
      return rest === '' || PUNCT.test(rest) || DASH.test(rest) || CLAUSE.test(rest) || (LINK.test(rest) && closedAt(t)); });
    if (!whole) bad.push(`"${raw}"`);
  }
  return bad;
}

test('(c) the strict whole-phrase check catches the two cuts of the review, on the rewritten sources too', () => {
  const row = rowByNo('N02-U02'); const src = sourcesWithRewrites([row]);
  const fake = (t) => `<svg><text>${t}</text></svg>`;
  assert.equal(strictCuts(fake('A line is flagged when the amount falls outside what the contract'), src).length, 1, 'an open clause before "and" is a cut');
  assert.equal(strictCuts(fake('Freight invoices billed above the contract rate, duplicated, or charged'), src).length, 1, 'a verb without its complement is a cut');
  assert.equal(strictCuts(fake('Freight invoices billed above the contract rate'), src).length, 0, 'a lead that ends at a comma is whole');
  const n1 = rowByNo('N01-U01');
  assert.ok(sourcesWithRewrites([n1]).some((s) => s.startsWith('scores every active buyer')), 'a step rewritten without its lead word is a source');
});

test('(c) no drawing shows a phrase cut mid-thought (strict check, raw and rewritten sources)', () => {
  const bad = RUNS.flatMap((r) => strictCuts(r.svg, sourcesWithRewrites([r.row])).map((p) => `${r.tag}: ${p}`));
  assert.deepEqual(bad.slice(0, 15), [], `${bad.length} cut phrases in ${RUNS.length} drawings`);
});

// ---------- (d) funnel tiers ----------
const FRAGMENT = /^(of|to|for|with|by|from|in|on|at|into|over|under|between|within|without|than|per|about|across|and|or|but|that|which|who)\b/i;
test('(d) every funnel tier label reads as a whole phrase alone', () => {
  const bad = [];
  for (const r of [...ROWS, ...A]) for (const st of contentFor(r, 'funnel').stages || []) { const l = String(st.label || '').trim(); if (l && FRAGMENT.test(l)) bad.push(`${r.__src || r.No}: "${l}"`); }
  assert.deepEqual(bad.slice(0, 12), [], `${bad.length} fragment tier labels`);
});

// ---------- (a), (b) in the browser ----------
const GEO = () => {
  const svg = document.querySelector('#host svg'); const cv = svg.getBoundingClientRect(); const bg = svg.querySelector(':scope > rect');
  const R = (el) => { const r = el.getBoundingClientRect(); return { x: r.left - cv.left, y: r.top - cv.top, w: r.width, h: r.height }; };
  const T = []; svg.querySelectorAll('text').forEach((el) => { const fs = parseFloat(getComputedStyle(el).fontSize) || 0; const sp = [...el.querySelectorAll('tspan')];
    (sp.length ? sp : [el]).forEach((s) => { const t = s.textContent.trim(); if (!t) return; const r = R(s); const h = Math.min(r.h, fs * 0.95); T.push({ t, x: r.x, y: r.y + (r.h - h) / 2, w: r.w, h, badge: !!s.closest('[data-shape="badge"]') }); }); });
  const inBox = (p, b, m = 0) => p.x >= b.x - m && p.y >= b.y - m && p.x + p.w <= b.x + b.w + m && p.y + p.h <= b.y + b.h + m;
  const ctr = (p) => ({ x: p.x + p.w / 2, y: p.y + p.h / 2 }); const bad = [];
  const icons = [...svg.querySelectorAll('[data-icon]')].filter((g) => !g.closest('defs')).map((g) => ({ g, ...R(g) }));
  // (a) a card (a rounded rectangle smaller than the page) that holds an icon holds a label.
  svg.querySelectorAll('rect[rx]').forEach((el) => { if (el === bg || el.closest('defs') || el.closest('[data-icon]') || el.closest('[data-scene]')) return; const b = R(el); if (b.w < 60 || b.h < 40 || b.w > 0.98 * cv.width) return;
    const ic = icons.filter((i) => inBox(i, b, 2)); if (!ic.length) return;
    if (!T.some((t) => !t.badge && inBox(t, b, 2))) bad.push(`(a) empty card at ${Math.round(b.x)},${Math.round(b.y)} (${ic.map((i) => i.g.getAttribute('data-icon')).join(',')})`); });
  // (a) a list bullet (an icon outside the diagrams) has its label beside it, under it, or (right to left) before it.
  const tiers = [...svg.querySelectorAll('[data-process="funnel"] path')].map(R);
  for (const i of icons) {
    if (i.g.closest('[data-process="cycle"],[data-process="hub"],[data-process="funnel"],[data-process="links"],[data-process="iso-stack"],[data-process="iso-flow"],[data-process="road"],[data-process="route"],[data-process="chevrons"],[data-process="split"],[data-process="bridge"],[data-scene],[data-chart]')) continue;
    const c = ctr(i); if (tiers.some((b) => c.x >= b.x && c.x <= b.x + b.w && c.y >= b.y && c.y <= b.y + b.h)) continue;
    const near = T.some((t) => { const tc = ctr(t);
      const beside = t.x >= i.x + i.w - 4 && t.x - (i.x + i.w) <= 140 && t.y < i.y + i.h + 30 && t.y + t.h > i.y - 30;
      const under = t.y >= i.y + i.h - 4 && t.y - (i.y + i.h) <= 90 && Math.abs(tc.x - c.x) <= Math.max(t.w, i.w) / 2 + 40;
      const before = t.x + t.w <= i.x + 4 && i.x - (t.x + t.w) <= 60 && t.y < i.y + i.h && t.y + t.h > i.y;
      return beside || under || before; });
    if (!near) bad.push(`(a) icon ${i.g.getAttribute('data-icon')} at ${Math.round(i.x)},${Math.round(i.y)} has no label`);
  }
  // (b) a text whose centre is inside a circle (r >= 40) stays inside it; a stroked ring counts its inner edge.
  const circles = [...svg.querySelectorAll('circle')].filter((el) => !el.closest('defs') && !el.closest('[data-icon]')).map((el) => { const b = R(el); const k = b.w / (2 * (parseFloat(el.getAttribute('r')) || 1));
    const none = (el.getAttribute('fill') || '') === 'none'; const sw = parseFloat(el.getAttribute('stroke-width') || '0') * k; return { cx: b.x + b.w / 2, cy: b.y + b.h / 2, r: b.w / 2 - (none ? sw / 2 : 0) }; }).filter((q) => q.r >= 40);
  for (const t of T) { if (t.badge) continue; const c = ctr(t);
    for (const q of circles) { if (Math.hypot(c.x - q.cx, c.y - q.cy) > q.r) continue;
      const far = Math.max(...[[t.x, t.y], [t.x + t.w, t.y], [t.x, t.y + t.h], [t.x + t.w, t.y + t.h]].map(([x, y]) => Math.hypot(x - q.cx, y - q.cy)));
      if (far > q.r + 2) { bad.push(`(b) "${t.t.slice(0, 40)}" leaves its circle by ${Math.round(far - q.r)} px`); break; } } }
  return bad;
};

test('(a)(b) no icon, card or bullet without its label, and no text outside its circle', async () => {
  const browser = await chromium.launch({ headless: true }); const bad = [];
  try {
    const page = await browser.newPage();
    for (const r of RUNS) {
      const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(r.svg) || [];
      await page.setViewportSize({ width: Number(w) + 40, height: Number(h) + 40 });
      await page.setContent(`<html><body style="margin:0"><div id="host" style="position:absolute;left:0;top:0">${r.svg}</div></body></html>`);
      for (const p of await page.evaluate(GEO)) bad.push(`${r.tag}: ${p}`);
    }
    assert.deepEqual(bad.slice(0, 20), [], `${bad.length} problems in ${RUNS.length} drawings`);
  } finally { await browser.close(); }
});

// A synthetic card check: the GEO probe sees an empty card (so (a) is not vacuous).
test('(a) the probe flags an icon card with no label', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage(); await page.setViewportSize({ width: 700, height: 400 });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="600" height="300"><rect width="600" height="300" fill="#fff"/><rect x="20" y="20" width="300" height="80" rx="16" fill="#22364C"/><g data-icon="link" transform="translate(40 40) scale(1)"><path d="M0 0h20"/><circle cx="10" cy="10" r="5"/></g><circle cx="300" cy="200" r="60" fill="#fff"/><text x="300" y="205" font-size="20" text-anchor="middle">A long sentence that runs out of the circle</text></svg>';
    await page.setContent(`<html><body style="margin:0"><div id="host" style="position:absolute;left:0;top:0">${svg}</div></body></html>`);
    const got = await page.evaluate(GEO);
    assert.ok(got.some((x) => x.startsWith('(a) empty card')), JSON.stringify(got));
    assert.ok(got.some((x) => x.startsWith('(b)')), JSON.stringify(got));
  } finally { await browser.close(); }
});
