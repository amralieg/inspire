// RC7-B-08: the infographic of a design when no use case has a calculated value yet (the four value charts have nothing to draw).
// It still carries the design's own fonts, colours and layout, and real graphics built from the use case data: the Inspire score bars,
// a donut of use cases by domain, a score meter and a domain icon on every card. Long text wraps to as many lines as it needs, never "...".
// The page grows in height with the text. Pure SVG strings, same helpers as the four styles.
import { t, T, rect, line, circle, icon, svgDoc, iconName, arc, has } from './core.js';
import { paletteOf } from './palette.js';
import { NOT_YET } from './ucPage.js';
import { LB } from '../docLabels.js';

const PAD = 40;
const MAX_ROWS = 12; const MAX_SLICES = 6;
const FOOT = 'Estimates are AI-generated from your data and strategy. Treat them as a starting point.';

// The value tile shrinks (never below 14px) so a long text such as "not calculated yet" stays inside the tile.
const fitSize = (str, w, max) => Math.max(14, Math.min(max, Math.floor(w / (String(str).length * 0.6))));

export function scoreInfographic(m, th, { W = 794 } = {}, { id, fonts }) {
  const P = paletteOf(id, th);
  const body = fonts.body; const display = fonts.display || fonts.body; const text = fonts.serif || fonts.body;
  const kindText = fonts.serif ? 'serif' : 'sans'; const kindHead = /serif|Georgia|Didot|Fraunces/i.test(display) && !/sans/i.test(display) ? 'serif' : 'sans';
  const CW = W - 2 * PAD;
  const showScore = has(m, 'inspire_score');
  const ucs = m.pageUseCases;
  const scored = ucs.filter((u) => Number.isFinite(u.score)).sort((a, b) => b.score - a.score);
  const heroed = !!(P.rings || P.chips);
  const headBg = heroed ? P.coverBg : P.page;
  const round = !P.masthead && !P.edge;
  const tileBg = P.masthead ? P.page : P.card;
  let s = ''; let y = 0;

  // ---- header: the design's own opening (hero band, masthead, or board-pack top line) ----
  const subtitle = LB(`${m.total.n} use cases | ${m.total.nWithValue} with a calculated value`);
  const tSize = P.masthead ? 36 : P.edge ? 28 : 32; const tLh = P.masthead ? 42 : P.edge ? 34 : 38;
  const title = T(PAD, 0, m.businessName || 'Inspire', { size: tSize, weight: 700, fill: P.coverInk, bg: headBg, font: display, kind: kindHead, maxW: CW - (P.rings ? 150 : 0), lh: tLh, ctx: 'title' });
  const drawTitle = (y0) => T(PAD, y0, m.businessName || 'Inspire', { size: tSize, weight: 700, fill: P.coverInk, bg: headBg, font: display, kind: kindHead, maxW: CW - (P.rings ? 150 : 0), lh: tLh, ctx: 'title' }).svg;
  let hh;
  if (heroed) {
    hh = 82 + title.h + 40;
    s += rect(0, 0, W, hh, P.coverBg);
    if (P.rings) { [[W - 70, 50, 110], [W - 70, 50, 75], [W - 120, hh - 20, 50]].forEach(([cx, cy, r]) => { s += circle(cx, cy, r, 'none', { stroke: '#FFFFFF', sw: 1.4, sop: 0.18 }); }); s += circle(W - 40, 36, 16, P.warm, { op: 0.9 }); }
    if (P.chips) s += circle(W - 40, 40, 90, P.cats[0], { op: 0.16 }) + circle(W - 110, hh - 12, 44, P.cats[3], { op: 0.14 }) + circle(W - 14, hh - 50, 26, P.cats[1], { op: 0.25 });
    s += t(PAD, 40, 'DATABRICKS INSPIRE AI', { size: 12, weight: 700, fill: P.coverAccent, bg: P.coverBg, ls: 2, font: body, ctx: 'brand' });
    s += drawTitle(86) + t(PAD, 86 + title.h + 4, subtitle, { size: 14, fill: P.coverMuted, bg: P.coverBg, font: body, ctx: 'subtitle' });
  } else if (P.masthead) {
    hh = 112 + title.h + 40;
    s += rect(PAD, 30, CW, 3, P.rule) + t(PAD, 54, 'DATABRICKS INSPIRE AI', { size: 12, weight: 700, fill: P.ink, bg: P.page, ls: 2.2, font: body, ctx: 'mast' })
      + t(W - PAD, 54, LB('Use case portfolio'), { size: 12, fill: P.ink, bg: P.page, anchor: 'end', caps: true, ls: 2.2, font: body, ctx: 'mast r' }) + rect(PAD, 64, CW, 1, P.rule);
    s += drawTitle(112) + t(PAD, 112 + title.h + 4, subtitle, { size: 14, italic: true, fill: P.muted, bg: P.page, font: text, kind: 'serif', ctx: 'subtitle' });
  } else {
    hh = 82 + title.h + 36;
    s += rect(0, 0, W, 6, P.edge) + t(PAD, 34, 'DATABRICKS INSPIRE AI', { size: 12, weight: 700, fill: P.kicker, bg: P.page, ls: 1, font: body, ctx: 'top' })
      + t(W - PAD, 34, LB('Use case portfolio'), { size: 12, fill: P.muted, bg: P.page, anchor: 'end', font: body, ctx: 'top r' }) + line(PAD, 44, W - PAD, 44, P.rule, 1);
    s += drawTitle(82) + t(PAD, 82 + title.h + 4, subtitle, { size: 14, fill: P.muted, bg: P.page, font: body, ctx: 'subtitle' });
  }
  y = hh + (heroed ? 20 : 0);

  // ---- KPI tiles, each with its icon ----
  const domains = new Map();
  for (const u of ucs) domains.set(u.domain, (domains.get(u.domain) || 0) + 1);
  const kpis = [[String(m.total.n), 'Use cases', 'layers'], [String(domains.size), 'Domains', 'compass']];
  if (showScore && scored.length) kpis.push([scored[0].score.toFixed(1), 'Top Inspire score', 'star']);
  kpis.push([m.total.nWithValue ? m.total.text : NOT_YET, 'Total value', 'wallet']);
  const gap = 12; const kw = (CW - (kpis.length - 1) * gap) / kpis.length; const kh = 88;
  kpis.forEach(([v, l, ic]) => {
    const x = PAD + kpis.findIndex((k) => k[1] === l) * (kw + gap);
    if (P.masthead) s += line(x, y, x + kw, y, P.rule, 2);
    else if (P.edge) s += rect(x, y, kw, kh, P.card) + rect(x, y, 5, kh, P.edge);
    else s += rect(x, y, kw, kh, P.card, { rx: 14 });
    const ix = x + (P.edge ? 18 : 14);
    s += icon(ic, ix, y + 14, 20, P.masthead ? P.accentText : P.accent, 2);
    s += t(ix, y + 58, v, { size: fitSize(LB(v), kw - 28, 26), weight: 700, fill: P.ink, bg: tileBg, font: display, kind: kindHead, ctx: 'kpi' });
    s += t(ix, y + 78, l, { size: 12, fill: P.muted, bg: tileBg, font: body, ctx: 'kpi label' });
  });
  y += kh + 28;

  // ---- section heading in the design's own manner ----
  let exhibit = 0;
  const section = (x, yy, w, label, bg) => {
    exhibit += 1;
    if (P.masthead) return t(x, yy, label, { size: 12, weight: 700, fill: P.accentText, bg, caps: true, ls: 1.8, font: body, ctx: 'kicker' }) + line(x, yy + 8, x + w, yy + 8, P.rule, 1);
    if (P.edge) return t(x, yy, `EXHIBIT ${exhibit}`, { size: 12, weight: 700, fill: P.kicker, bg, ls: 0.6, font: body, ctx: 'exh' }) + t(x + 76, yy, label, { size: 14, weight: 700, fill: P.ink, bg, font: body, ctx: 'exh title' });
    return circle(x + 5, yy - 5, 5, P.cats[0]) + t(x + 18, yy, label, { size: 16, weight: 700, fill: P.ink, bg, font: display, kind: kindHead, ctx: 'heading' });
  };
  const panel = (x, yy, w, h) => (P.masthead ? '' : rect(x, yy, w, h, P.card, round ? { rx: 14 } : {}));
  const panelBg = tileBg;

  // ---- chart 1: Inspire score per use case (bar width = score out of 10) ----
  if (showScore && scored.length) {
    const rows = scored.slice(0, MAX_ROWS); const labelW = 250; const valW = 40;
    const bx = PAD + 18 + labelW + 10; const bw = CW - 36 - labelW - 10 - valW; let ry = y + 50; let inner = '';
    rows.forEach((u, i) => {
      const lab = T(PAD + 18, ry + 14, u.name, { size: 12, fill: P.ink, bg: panelBg, font: body, maxW: labelW, lh: 15, ctx: 'bar label' });
      const rh = Math.max(28, lab.h + 10); const cy = ry + rh / 2 - 2;
      inner += lab.svg + rect(bx, cy - 5, bw, 10, P.track, { rx: round ? 5 : 0 }) + rect(bx, cy - 5, Math.max(3, (u.score / 10) * bw), 10, P.cats[i % P.cats.length], { rx: round ? 5 : 0, extra: ` data-bar="${u.score.toFixed(2)}"` });
      inner += t(PAD + CW - 18, cy + 4, u.score.toFixed(1), { size: 12, weight: 700, fill: P.ink, bg: panelBg, anchor: 'end', font: body, ctx: 'bar value' });
      ry += rh;
    });
    const ph = ry - y + 8;
    s += panel(PAD, y, CW, ph) + section(PAD + 18, y + 30, CW - 36, 'Inspire score by use case', panelBg) + inner;
    y += ph + 20;
  }

  // ---- chart 2: use cases by domain (donut with legend) ----
  {
    const parts = [...domains.entries()].map(([name, n]) => ({ name, n })).sort((a, b) => b.n - a.n);
    const slices = parts.slice(0, MAX_SLICES);
    const rest = parts.slice(MAX_SLICES).reduce((a, p) => a + p.n, 0);
    if (rest) slices.push({ name: LB('Other'), n: rest });
    const total = slices.reduce((a, p) => a + p.n, 0) || 1;
    const r1 = 66; const r0 = P.masthead ? 56 : 46; const cx = PAD + 18 + r1 + 6; const cy0 = y + 48 + r1;
    const legX = cx + r1 + 36; const legW = PAD + CW - 18 - legX;
    let ly = y + 58; let leg = '';
    slices.forEach((p, i) => {
      const lab = T(legX + 18, ly, p.name, { size: 13, fill: P.ink, bg: panelBg, font: body, maxW: legW - 60, lh: 16, ctx: 'legend' });
      leg += circle(legX + 5, ly - 4, 5, P.cats[i % P.cats.length]) + lab.svg + t(legX + legW, ly, String(p.n), { size: 13, weight: 700, fill: P.ink, bg: panelBg, anchor: 'end', font: body, ctx: 'legend value' });
      ly += Math.max(24, lab.h + 8);
    });
    const ph = Math.max(48 + 2 * r1 + 22, ly - y + 6);
    // One domain is drawn as two halves, so the ring keeps its hole (an arc that ends where it starts draws nothing).
    const arcs = slices.length === 1 ? [{ ...slices[0], n: total / 2 }, { ...slices[0], n: total / 2 }] : slices;
    let ring = ''; let a = 0;
    arcs.forEach((p, i) => { const da = (p.n / total) * Math.PI * 2; ring += `<path d="${arc(cx, cy0, r0, r1, a + 0.015, a + da - 0.015)}" fill="${P.cats[(slices.length === 1 ? 0 : i) % P.cats.length]}"/>`; a += da; });
    ring += t(cx, cy0 + 8, String(m.total.n), { size: 24, weight: 700, fill: P.ink, bg: panelBg, anchor: 'middle', font: display, kind: kindHead, ctx: 'donut centre' });
    ring += t(cx, cy0 + 26, 'use cases', { size: 12, fill: P.muted, bg: panelBg, anchor: 'middle', font: body, ctx: 'donut label' });
    s += panel(PAD, y, CW, ph) + section(PAD + 18, y + 30, CW - 36, 'Domains', panelBg) + ring + leg;
    y += ph + 20;
  }

  // ---- use case cards: a domain icon, a score meter and the full description ----
  const colN = round ? 2 : 1; const cgap = 16; const cw = (CW - (colN - 1) * cgap) / colN; const IN = 16;
  const card = (u, i, x, yy) => {
    const c = P.cats[i % P.cats.length]; const tx = x + IN + 38; const inW = cw - 2 * IN;
    let cy = yy + 30; let out = '';
    out += icon(iconName(u.domain || u.name), x + IN, yy + 14, 24, P.masthead ? P.accentText : P.accent, 2);
    const ttl = T(tx, cy, u.name, { size: 15, weight: 700, fill: P.ink, bg: panelBg, font: display, kind: kindHead, maxW: inW - 38, lh: 19, ctx: 'card title' });
    out += ttl.svg; cy += ttl.h + 2;
    const meta = [u.domain, showScore && Number.isFinite(u.score) ? LB(`Score ${u.score.toFixed(1)}`) : '', u.value ? u.value.text : LB(NOT_YET)].filter(Boolean).join('  |  ');
    const mt = T(tx, cy, meta, { size: 12, weight: 700, fill: P.masthead ? P.accentText : P.kicker, bg: panelBg, font: body, maxW: inW - 38, lh: 15, ctx: 'card meta' });
    out += mt.svg; cy += mt.h + 6;
    if (showScore && Number.isFinite(u.score)) {
      const n = 10; const sw = Math.min(16, (inW - 38 - (n - 1) * 3) / n); const full = Math.round(u.score);
      for (let k = 0; k < n; k += 1) out += rect(tx + k * (sw + 3), cy, sw, 7, k < full ? c : P.track, { rx: round ? 2 : 0 });
      cy += 26;
    }
    const block = (label, str) => {
      if (!str) return;
      out += t(x + IN, cy, label, { size: 12, weight: 700, fill: P.muted, bg: panelBg, caps: true, ls: 1, font: body, ctx: 'card label' });
      const tb = T(x + IN, cy + 18, str, { size: 13, fill: P.body, bg: panelBg, font: text, kind: kindText, maxW: inW, lh: 18, ctx: 'card text' });
      out += tb.svg; cy += 18 + tb.h + 8;
    };
    if (has(m, 'use_case_story')) block('The use case', u.statement || u.solution);
    if (has(m, 'data_used') && u.tables?.length) block('Data used', u.tables.join(', '));
    const h = cy - yy + 6;
    return { svg: out, h, box: (hh2) => (P.masthead ? line(x, yy, x + cw, yy, P.rule, 1) : rect(x, yy, cw, hh2, P.card, round ? { rx: 12, stroke: P.rule } : {})) };
  };
  const order = [...scored, ...ucs.filter((u) => !Number.isFinite(u.score))];
  for (let i = 0; i < order.length; i += colN) {
    const row = order.slice(i, i + colN).map((u, j) => card(u, i + j, PAD + j * (cw + cgap), y));
    const rh = Math.max(...row.map((r) => r.h));
    s += row.map((r) => r.box(rh) + r.svg).join('');
    y += rh + 14;
  }

  if (has(m, 'disclaimer')) {
    const d = T(PAD, y + 14, LB(FOOT), { size: 12, fill: P.muted, bg: P.page, font: body, maxW: CW, lh: 16, ctx: 'disclaimer' });
    s += `<g data-block="disclaimer">${d.svg}</g>`; y += d.h + 20;
  }
  const H = Math.ceil(y + 24);
  return svgDoc(W, H, rect(0, 0, W, H, P.page) + s, body);
}
