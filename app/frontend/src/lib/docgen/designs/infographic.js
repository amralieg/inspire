// C28 (REQ-571): per use case infographics. A library of designed SVG layouts (6 scenarios, landscape 16:9 and portrait A4) in one style:
// big bold title, rounded pastel cards with an icon each, numbered steps, wide gradient ribbons from the steps to the outcomes, one huge gradient KPI number,
// and an icon cluster as the illustration. Text scales with the page (portrait is read printed on A4).
// infographicFor(useCase, {orientation, scenario, content, theme, logo, rtl}) -> svg. The content comes from the picker (infographicPick.js).
// Every text sits in a measured box (shrunk to fit, then cut with an ellipsis), and every box is logged, so nothing overflows or overlaps.
import { SCENARIOS, SCENARIO_IDS } from '../../../../../backend/lib/infographicPick.mjs';
import { LB } from '../docLabels.js';
import { esc, textW, rect, circle, line, mix, bestInk, svgDoc, rtlSvg } from './core.js';
import { iconFor, glyph } from './infographicIcons.js';
import { fallbackPick } from './infographicPick.js';

export { SCENARIO_IDS };
export const DIMS = { landscape: { W: 1600, H: 900 }, portrait: { W: 1240, H: 1754 } };
let K = 1; let FLOOR = 16; const S = (n) => Math.round(n * K); // page scale and the smallest text size of the page
const M = 56; const WARM = ['#E8743B', '#1B8A8F', '#7B4F9E'];

// ---------- measured text ----------
function wrapHard(text, w, size, weight) {
  const fits = (s) => textW(s, size, 'sans', weight) <= w;
  const out = []; let cur = '';
  for (let word of String(text).split(/\s+/).filter(Boolean)) {
    while (!fits(word) && word.length > 1) { // a word wider than the box is broken, never left to spill
      let k = word.length; while (k > 1 && !fits(word.slice(0, k))) k -= 1;
      if (cur) { out.push(cur); cur = ''; }
      out.push(word.slice(0, k)); word = word.slice(k);
    }
    const next = cur ? `${cur} ${word}` : word;
    if (cur && !fits(next)) { out.push(cur); cur = word; } else cur = next;
  }
  if (cur) out.push(cur);
  return out;
}
// The largest size (down to the page floor) at which the text fits the box; at the floor a longer text is cut with an ellipsis.
function plan(text, w, h, { size = 18, min = 13, weight = 400, lh = 1.22, maxLines = 99 } = {}) {
  min = Math.max(min, FLOOR); size = Math.max(size, min);
  const s0 = LB(String(text ?? '')).replace(/\s+/g, ' ').trim();
  if (!s0) return { lines: [], size, lh, h: 0, text: s0, weight };
  for (let s = size; s >= min; s -= 1) {
    const lines = wrapHard(s0, w, s, weight);
    if (lines.length <= maxLines && lines.length * s * lh <= h + 0.01) return { lines, size: s, lh, h: lines.length * s * lh, text: s0, weight };
  }
  const cap = Math.max(1, Math.min(maxLines, Math.floor(h / (min * lh))));
  let lines = wrapHard(s0, w, min, weight);
  if (lines.length > cap) {
    lines = lines.slice(0, cap); let last = lines[cap - 1];
    while (last.length > 1 && textW(`${last}…`, min, 'sans', weight) > w) last = last.slice(0, -1).trimEnd();
    lines[cap - 1] = `${last}…`;
  }
  return { lines, size: min, lh, h: lines.length * min * lh, text: s0, weight };
}
// Draws a planned text at the top-left of its box (or centred / right-aligned) and logs the box.
function put(c, x, y, w, boxH, p, { fill, anchor = 'start', valign = 'top', ls = 0 } = {}) {
  if (!p.lines.length) return 0;
  const oy = valign === 'middle' ? y + (boxH - p.h) / 2 : valign === 'bottom' ? y + boxH - p.h : y;
  const px = anchor === 'middle' ? x + w / 2 : anchor === 'end' ? x + w : x;
  const spans = p.lines.map((l, i) => `<tspan x="${px}" dy="${i ? p.size * p.lh : 0}">${esc(l)}</tspan>`).join('');
  c.add(`<text x="${px}" y="${(oy + p.size * 0.92).toFixed(1)}" font-size="${p.size}" font-weight="${p.weight}" fill="${fill}"${anchor !== 'start' ? ` text-anchor="${anchor}"` : ''}${ls ? ` letter-spacing="${ls}"` : ''}>${spans}</text>`);
  c.blocks.push({ x, y: oy, w, h: p.h, boxH, text: p.text.slice(0, 40), size: p.size, maxW: Math.max(...p.lines.map((l) => textW(l, p.size, 'sans', p.weight))) });
  return p.h;
}
const fit = (c, text, x, y, w, h, o = {}) => put(c, x, y, w, h, plan(text, w, h, o), o);

// ---------- paint: gradients, shadow, ribbons, icons ----------
const SHADOW = '<filter id="igs" x="-6%" y="-6%" width="112%" height="125%"><feDropShadow dx="0" dy="4" stdDeviation="7" flood-color="#000000" flood-opacity="0.13"/></filter>';
const SH = ' filter="url(#igs)"';
// A two colour gradient (left to right, or top to bottom), defined once per colour pair.
function grad(c, a, b, dir = 'h') {
  const id = `ig${dir}${String(a).replace(/\W/g, '')}${String(b).replace(/\W/g, '')}`;
  if (!c.defs.has(id)) c.defs.set(id, `<linearGradient id="${id}" x1="0" y1="0" x2="${dir === 'h' ? 1 : 0}" y2="${dir === 'h' ? 0 : 1}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`);
  return id;
}
// A wide flowing ribbon (a filled bezier band with a gradient), drawn behind the cards; both ends sit inside the boxes they join.
function ribbon(c, x1, y1, x2, y2, t, ia = 0, ib = 1, vertical = false) {
  const h = t / 2; const n = (v) => Number(v).toFixed(1); let d;
  if (!vertical) { const m = (x1 + x2) / 2; d = `M${n(x1)} ${n(y1 - h)}C${n(m)} ${n(y1 - h)} ${n(m)} ${n(y2 - h)} ${n(x2)} ${n(y2 - h)}L${n(x2)} ${n(y2 + h)}C${n(m)} ${n(y2 + h)} ${n(m)} ${n(y1 + h)} ${n(x1)} ${n(y1 + h)}Z`; }
  else { const m = (y1 + y2) / 2; d = `M${n(x1 - h)} ${n(y1)}C${n(x1 - h)} ${n(m)} ${n(x2 - h)} ${n(m)} ${n(x2 - h)} ${n(y2)}L${n(x2 + h)} ${n(y2)}C${n(x2 + h)} ${n(m)} ${n(x1 + h)} ${n(m)} ${n(x1 + h)} ${n(y1)}Z`; }
  const id = grad(c, c.P.acc[ia % 3], c.P.acc[ib % 3], vertical ? 'v' : 'h');
  c.under(`<path data-role="ribbon" d="${d}" fill="url(#${id})" fill-opacity="0.88"/>`);
  c.ribbons.push({ x1, y1, x2, y2, t });
}
const RT = () => S(20);
// Draws an icon and logs its box.
function ic(c, name, cx, cy, s, col, sw = 2) { c.icons.push({ x: cx - s / 2, y: cy - s / 2, w: s, h: s }); c.add(glyph(name, cx, cy, s, col, sw)); }
// A round badge with an icon in it.
function badge(c, name, cx, cy, d, accent, solid = false) {
  c.add(circle(cx, cy, d / 2, solid ? mix('#FFFFFF', accent, 0.22) : accent, { op: solid ? 1 : 0.18 }));
  ic(c, name, cx, cy, d * 0.52, solid ? bestInk(accent) : accent);
}
// The illustration: a ring of small icons around a centre, drawn from the icons of the story.
function cluster(c, cx, cy, R) {
  if (R < 30) return; const P = c.P; const rr = R * 0.74; const sr = R * 0.25;
  c.add(circle(cx, cy, rr, 'none', { stroke: P.acc[0], sw: 2, sop: 0.3 }));
  for (let k = 0; k < 6; k += 1) {
    const a = -Math.PI / 2 + k * Math.PI / 3; const px = cx + rr * Math.cos(a); const py = cy + rr * Math.sin(a); const col = P.acc[k % 3];
    c.add(line(cx, cy, px, py, col, 2, { op: 0.35 }));
    c.add(circle(px, py, sr, col)); ic(c, c.pool[k % c.pool.length], px, py, sr * 1.1, bestInk(col));
  }
  c.add(circle(cx, cy, R * 0.3, P.acc[0])); ic(c, 'sparkles', cx, cy, R * 0.34, bestInk(P.acc[0]));
}

// ---------- pieces ----------
// A title (bold) over a text (regular), centred vertically in the box.
function label(c, x, y, w, h, title, text, { fill, tsize = S(24), xsize = S(18), gap = 6, anchor = 'start', top = false } = {}) {
  const tmax = text ? Math.max(tsize * 1.25, h * 0.46) : h;
  const tp = plan(title, w, tmax, { size: tsize, min: 14, weight: 700, lh: 1.18, maxLines: 3 });
  const xp = text ? plan(text, w, Math.max(0, h - tp.h - gap), { size: xsize, min: 12, lh: 1.22 }) : { lines: [], h: 0 };
  const total = tp.h + (xp.lines.length ? gap + xp.h : 0); const y0 = top ? y : y + Math.max(0, (h - total) / 2);
  put(c, x, y0, w, tp.h, tp, { fill, anchor });
  if (xp.lines.length) put(c, x, y0 + tp.h + gap, w, xp.h, xp, { fill, anchor });
}
// A rounded pastel card (solid accent when `solid`) with a soft shadow, a numbered disc, an icon badge, a title and a text.
// A tall card (as high as it is wide) puts the badge on top; a wide one on the right.
function card(c, x, y, w, h, { i = 0, num = null, title = '', text = '', solid = false, fill = null, tsize = S(24), xsize = S(18), icon = null } = {}) {
  const P = c.P; const ac = P.acc[i % 3];
  const bg = fill || (solid ? ac : P.tint(i)); const ink = solid ? bestInk(ac) : P.ink;
  c.add(rect(x, y, w, h, bg, { rx: S(24), extra: SH })); c.nodes.push({ kind: 'card', x, y, w, h });
  const name = icon || iconFor(title, c.iconSeq, c.used, text); c.iconSeq += 1;
  const tall = h >= w * 0.85 && h >= S(170);
  if (tall) {
    const pad = S(22); const dd = Math.min(w * 0.32, S(104));
    badge(c, name, x + pad + dd / 2, y + pad + dd / 2, dd, ac, solid);
    if (num != null) {
      const r = S(22); const dc = solid ? ink : ac; const nx = x + w - pad - r; const ny = y + pad + r;
      c.add(circle(nx, ny, r, dc)); fit(c, String(num), nx - r, ny - r, 2 * r, 2 * r, { size: Math.round(r * 1.1), min: 12, weight: 700, fill: bestInk(dc), anchor: 'middle', valign: 'middle', maxLines: 1 });
    }
    const ty = y + pad + dd + S(12);
    label(c, x + pad, ty, w - 2 * pad, y + h - pad - ty, title, text, { fill: ink, tsize: Math.round(tsize * 1.12), xsize: Math.round(xsize * 1.15), top: true });
    return;
  }
  const pad = Math.min(S(24), Math.max(12, h * 0.15)); let tx = x + pad; let tw = w - 2 * pad;
  if (num != null) {
    const r = Math.max(15, Math.min(S(26), h / 2 - 10)); const dc = solid ? ink : ac;
    c.add(circle(x + pad + r, y + h / 2, r, dc));
    fit(c, String(num), x + pad, y + h / 2 - r, 2 * r, 2 * r, { size: Math.round(r * 1.1), min: 12, weight: 700, fill: bestInk(dc), anchor: 'middle', valign: 'middle', maxLines: 1 });
    tx = x + pad + 2 * r + 14; tw = w - (tx - x) - pad;
  }
  const dd = Math.max(34, Math.min(h - 2 * pad, S(88), w * 0.2));
  badge(c, name, x + w - pad - dd / 2, y + h / 2, dd, ac, solid); tw -= dd + 14;
  label(c, tx, y + pad * 0.6, tw, h - pad * 1.2, title, text, { fill: ink, tsize, xsize });
}
// The huge gradient number and what it measures, on a pastel panel. A wide panel has the icon cluster on the right, a tall one below the number.
function kpiPanel(c, x, y, w, h, kpi, i = 0) {
  const P = c.P; const ac = P.acc[i % 3]; const gid = grad(c, ac, P.acc[(i + 2) % 3], 'h'); const gf = `url(#${gid})`;
  c.add(rect(x, y, w, h, mix(ac, P.bg, 0.82), { rx: S(28), extra: SH })); c.nodes.push({ kind: 'kpi', x, y, w, h });
  const pad = S(22); const wide = w >= h * 1.5; const tall = !wide && h >= w * 0.9;
  if (wide) {
    const lw = w * 0.6 - pad; const vh = kpi.label ? h * 0.62 : h - 2 * pad;
    fit(c, kpi.value, x + pad, y + pad * 0.5, lw, vh - pad * 0.5, { size: S(150), min: 30, weight: 800, lh: 1.05, fill: gf, anchor: 'middle', valign: 'middle', maxLines: 1 });
    if (kpi.label) fit(c, kpi.label, x + pad, y + vh + 2, lw, h - vh - pad, { size: S(26), min: 13, weight: 600, fill: P.ink, anchor: 'middle', valign: 'top' });
    const R = Math.min(h / 2 - 6, w * 0.19); cluster(c, x + w - pad - R, y + h / 2, R);
  } else if (tall) {
    const vh = h * 0.28; const lh = kpi.label ? h * 0.15 : 0;
    fit(c, kpi.value, x + pad, y + pad, w - 2 * pad, vh, { size: S(150), min: 30, weight: 800, lh: 1.05, fill: gf, anchor: 'middle', valign: 'middle', maxLines: 1 });
    if (kpi.label) fit(c, kpi.label, x + pad, y + pad + vh + 4, w - 2 * pad, lh, { size: S(26), min: 13, weight: 600, fill: P.ink, anchor: 'middle', valign: 'top' });
    const top = y + pad + vh + lh + 12; const R = Math.min((w - 2 * pad) / 2, (y + h - pad - top) / 2); cluster(c, x + w / 2, top + (y + h - pad - top) / 2, R);
  } else {
    const vh = kpi.label ? h * 0.6 : h - 2 * pad;
    fit(c, kpi.value, x + pad, y + pad, w - 2 * pad, vh - pad, { size: S(150), min: 30, weight: 800, lh: 1.05, fill: gf, anchor: 'middle', valign: 'middle', maxLines: 1 });
    if (kpi.label) fit(c, kpi.label, x + pad, y + vh + 4, w - 2 * pad, h - vh - pad - 4, { size: S(26), min: 13, weight: 600, fill: P.ink, anchor: 'middle', valign: 'top' });
  }
}
const HH = () => S(52);
const stepsHead = (d) => (d.labels.steps === 'How it works' ? `${d.labels.steps}: ${d.steps.length} ${d.steps.length === 1 ? 'step' : 'steps'}` : d.labels.steps);
const heading = (c, x, y, w, text, i = 0) => { fit(c, text, x, y, w, S(34), { size: S(26), min: 15, weight: 700, fill: c.P.ink, maxLines: 1 }); c.add(rect(x, y + S(36), 56, 5, c.P.acc[i % 3], { rx: 2 })); };
// A section label on a pill, sitting on the ribbons between two parts of a portrait page.
function pill(c, cx, cy, text, i = 0) {
  const p = plan(text, S(560), S(34), { size: S(26), min: 15, weight: 700, maxLines: 1 }); const mw = Math.max(...p.lines.map((l) => textW(l, p.size, 'sans', 700))); const pad = S(24); const h = S(48);
  c.add(rect(cx - mw / 2 - pad, cy - h / 2, mw + 2 * pad, h, c.P.bg, { rx: h / 2, stroke: c.P.acc[i % 3], sw: 3, extra: SH }));
  put(c, cx - mw / 2, cy - p.h / 2, mw + 1, p.h, p, { fill: c.P.ink });
}
// Cards stacked in a column or row, as tall (or wide) as the room allows.
function stack(c, x, y, w, h, list, { gap = S(14), horizontal = false, numbered = false, start = 0, solidFirst = false, fillOf = null, tsize = S(24), xsize = S(18) } = {}) {
  const n = list.length; if (!n) return [];
  const s = horizontal ? (w - gap * (n - 1)) / n : (h - gap * (n - 1)) / n; const out = [];
  list.forEach((it, k) => {
    const [cx, cy, cw, ch] = horizontal ? [x + k * (s + gap), y, s, h] : [x, y + k * (s + gap), w, s];
    card(c, cx, cy, cw, ch, { i: start + k, num: numbered ? k + 1 : null, title: it.title, text: it.text, solid: solidFirst && k === 0, fill: fillOf ? fillOf(k) : null, tsize, xsize });
    out.push({ x: cx, y: cy, w: cw, h: ch });
  });
  return out;
}
// A row of tiles (outcome cards, and the KPI as the last one), all as high as the room.
function tiles(c, x, y, w, h, items, kpi, start = 1) {
  const list = [...items.map((o) => ({ o })), ...(kpi ? [{ kpi }] : [])]; const n = list.length; const g = S(18); const tw = (w - g * (n - 1)) / n; const out = [];
  list.forEach((t, k) => {
    const tx = x + k * (tw + g);
    if (t.kpi) kpiPanel(c, tx, y, tw, h, t.kpi, 0); else card(c, tx, y, tw, h, { i: start + k, title: t.o.title, text: t.o.text, solid: false });
    out.push({ x: tx, y, w: tw, h });
  });
  return out;
}
// Ribbons from the bottom of one block to the tops of a row of tiles, fanned out so they flow.
function fanDown(c, from, row, pivotX, ia = 0) {
  row.forEach((t, k) => { const tcx = t.x + t.w / 2; const sx = pivotX + (tcx - pivotX) * 0.5; ribbon(c, sx, from.y + from.h - 12, tcx, t.y + 12, RT(), ia + k, k + 1, true); });
}
// Ribbons from a column of cards on the left to a column on the right (several to one target share its edge).
function fanAcross(c, left, right, ia = 0) {
  const g = left.map((_, j) => Math.min(right.length - 1, Math.floor((j * right.length) / left.length))); const cnt = {}; const seen = {};
  g.forEach((v) => { cnt[v] = (cnt[v] || 0) + 1; });
  left.forEach((s, j) => { const v = g[j]; const t = right[v]; seen[v] = (seen[v] || 0) + 1; const off = (seen[v] - 1 - (cnt[v] - 1) / 2) * RT() * 0.55; ribbon(c, s.x + s.w - 12, s.y + s.h / 2, t.x + 12, t.y + t.h / 2 + off, RT(), ia + j, v + 1); });
}

// ---------- scenarios ----------
// Each draws into the body area b = {x, y, w, h}. L is true for landscape.
const SC = {
  process_flow(c, b, d, L) {
    const { steps, outcomes, kpi } = d; const lab = d.labels;
    if (L) {
      const lw = 660; const rw = 640; const rx = b.x + b.w - rw; const top = b.y + HH();
      heading(c, b.x, b.y, lw, stepsHead(d), 0); heading(c, rx, b.y, rw, lab.outcomes, 2);
      const left = stack(c, b.x, top, lw, b.h - HH(), steps, { numbered: true });
      const k = outcomes.length + (kpi ? 1.35 : 0); const gap = S(14); const unit = (b.h - HH() - gap * (outcomes.length + (kpi ? 1 : 0) - 1)) / k;
      let y = top; const right = [];
      outcomes.forEach((o, j) => { card(c, rx, y, rw, unit, { i: j + 1, title: o.title, text: o.text, solid: j === 0 }); right.push({ x: rx, y, w: rw, h: unit }); y += unit + gap; });
      if (kpi) { kpiPanel(c, rx, y, rw, unit * 1.35, kpi, 0); right.push({ x: rx, y, w: rw, h: unit * 1.35 }); }
      fanAcross(c, left, right);
    } else {
      const sh = Math.round(b.h * 0.55); const rz = S(96);
      heading(c, b.x, b.y, b.w, stepsHead(d), 0);
      const left = stack(c, b.x, b.y + HH(), b.w, sh - HH(), steps, { numbered: true });
      const ty = b.y + sh + rz; const row = tiles(c, b.x, ty, b.w, b.y + b.h - ty, outcomes, kpi);
      fanDown(c, left[left.length - 1], row, b.x + b.w / 2); pill(c, b.x + b.w / 2, b.y + sh + rz / 2, lab.outcomes, 2);
    }
  },
  before_after(c, b, d, L) {
    const { steps, outcomes, kpi } = d; const before = d.before || steps; const lab = d.labels;
    const band = kpi ? (L ? 170 : 260) : 0; const ph = b.h - (band ? band + 20 : 0); const mid = L ? 130 : S(100);
    const pw = L ? (b.w - mid) / 2 : b.w; const phh = L ? ph : (ph - mid) / 2; const lists = [];
    const panels = [[b.x, b.y, before, 3], L ? [b.x + pw + mid, b.y, outcomes, 0] : [b.x, b.y + phh + mid, outcomes, 0]];
    panels.forEach(([x, y, list, i], pi) => {
      c.add(rect(x, y, pw, phh, pi ? c.P.tint(0) : mix(c.P.muted, c.P.bg, 0.86), { rx: S(32), extra: SH }));
      fit(c, pi ? lab.after : lab.before, x + 28, y + S(20), pw - 56, S(40), { size: S(30), min: 16, weight: 800, fill: c.P.ink, maxLines: 1 });
      lists.push(stack(c, x + 24, y + S(76), pw - 48, phh - S(76) - 24, list, { gap: S(12), start: pi ? 0 : 1, fillOf: () => c.P.bg, tsize: S(22), xsize: S(17) }));
    });
    const [bl, al] = lists;
    if (L) fanAcross(c, bl, al, 1);
    else [[0.2, 0.34], [0.5, 0.5], [0.8, 0.66]].forEach(([f, g], k) => { const lastB = bl[bl.length - 1]; const firstA = al[0]; ribbon(c, b.x + b.w * f, lastB.y + lastB.h - 12, b.x + b.w * g, firstA.y + 12, RT(), k + 1, k, true); });
    if (kpi) kpiPanel(c, b.x, b.y + b.h - band, b.w, band, kpi, 1);
  },
  funnel(c, b, d, L) {
    const { steps, outcomes, kpi } = d; const n = steps.length; const lab = d.labels;
    const fw = L ? 780 : b.w; const fh = L ? b.h : b.h * 0.5; const cx = b.x + fw / 2; const gap = S(8); const sh = (fh - gap * (n - 1)) / n;
    const widthAt = (k) => fw * (1 - 0.34 * (k / n)); const stages = [];
    steps.forEach((s, k) => {
      const ac = c.P.acc[k % 3]; const y = b.y + k * (sh + gap); const w0 = widthAt(k); const w1 = widthAt(k + 1);
      c.add(`<path d="M${cx - w0 / 2} ${y}H${cx + w0 / 2}L${cx + w1 / 2} ${y + sh}H${cx - w1 / 2}Z" fill="${ac}"${SH}/>`);
      const node = { kind: 'stage', x: cx - w0 / 2, y, w: w0, h: sh }; c.nodes.push(node); stages.push({ ...node, w1 });
      const dd = Math.min(sh * 0.7, S(72)); const lx = cx - w1 / 2 + S(20);
      badge(c, iconFor(s.title, c.iconSeq, c.used, s.text), lx + dd / 2, y + sh / 2, dd, ac, true); c.iconSeq += 1;
      const tx = lx + dd + S(14); const tw = cx + w1 / 2 - S(24) - tx;
      label(c, tx, y + 6, tw, sh - 12, `${k + 1}. ${s.title}`, s.text, { fill: bestInk(ac), tsize: S(24), xsize: S(17), anchor: 'middle' });
    });
    if (L) {
      const ox = b.x + fw + 150; const ow = b.w - fw - 150; heading(c, ox, b.y, ow, lab.outcomes, 2);
      const k = outcomes.length + (kpi ? 1.4 : 0); const g = S(14); const unit = (b.h - HH() - g * (outcomes.length + (kpi ? 1 : 0) - 1)) / k; let y = b.y + HH(); const right = [];
      outcomes.forEach((o, j) => { card(c, ox, y, ow, unit, { i: j + 1, title: o.title, text: o.text, solid: j === 0 }); right.push({ x: ox, y, w: ow, h: unit }); y += unit + g; });
      if (kpi) { kpiPanel(c, ox, y, ow, unit * 1.4, kpi, 0); right.push({ x: ox, y, w: ow, h: unit * 1.4 }); }
      const rs = stages.map((s) => ({ x: s.x + s.w - 12 - (s.w - s.w1) / 2 - 14, y: s.y, w: 0, h: s.h })); // the stage's right edge, inside the slant
      rs.forEach((s, j) => { const gi = Math.min(right.length - 1, Math.floor((j * right.length) / rs.length)); const t = right[gi]; ribbon(c, s.x, s.y + s.h / 2, t.x + 12, t.y + t.h / 2, RT(), j, gi + 1); });
    } else {
      const rz = S(96); const ty = b.y + fh + rz; const row = tiles(c, b.x, ty, b.w, b.y + b.h - ty, outcomes, kpi);
      const last = stages[stages.length - 1];
      row.forEach((t, k) => { const tcx = t.x + t.w / 2; ribbon(c, cx + (tcx - cx) * 0.4, last.y + last.h - 12, tcx, t.y + 12, RT(), k, k + 1, true); });
      pill(c, b.x + b.w / 2, b.y + fh + rz / 2, lab.outcomes, 2);
    }
  },
  hub_spokes(c, b, d, L) {
    const lefts = d.steps.slice(0, 3); const rights = d.outcomes.slice(0, 3); const kpi = d.kpi; const lab = d.labels;
    let hx; let hy; let r; const sides = [];
    const hub = () => {
      const P = c.P; c.add(circle(hx, hy, r + 10, P.tint(0)));
      c.add(circle(hx, hy, r, mix(P.acc[0], P.bg, 0.82), { stroke: P.acc[0], sw: S(10) })); c.nodes.push({ kind: 'hub', x: hx - r, y: hy - r, w: 2 * r, h: 2 * r });
      if (kpi) {
        fit(c, kpi.value, hx - r * 0.78, hy - r * 0.6, r * 1.56, r * 0.78, { size: S(120), min: 28, weight: 800, lh: 1.05, fill: `url(#${grad(c, P.acc[0], P.acc[2], 'h')})`, anchor: 'middle', valign: 'middle', maxLines: 1 });
        fit(c, kpi.label, hx - r * 0.7, hy + r * 0.22, r * 1.4, r * 0.55, { size: S(24), min: 13, weight: 600, fill: P.ink, anchor: 'middle' });
      } else fit(c, d.title, hx - r * 0.7, hy - r * 0.6, r * 1.4, r * 1.2, { size: S(34), min: 14, weight: 800, fill: P.ink, anchor: 'middle', valign: 'middle' });
    };
    if (L) {
      const cw = 440; const gap = S(16); hx = b.x + b.w / 2; r = 160;
      heading(c, b.x, b.y, cw, stepsHead(d), 0); heading(c, b.x + b.w - cw, b.y, cw, lab.outcomes, 2);
      const top = b.y + HH(); const room = b.h - HH(); hy = top + room / 2;
      [[lefts, b.x, 0], [rights, b.x + b.w - cw, 1]].forEach(([list, x, side]) => {
        const hh = (room - gap * (list.length - 1)) / Math.max(1, list.length); const boxes = [];
        list.forEach((nd, k) => { const y = top + k * (hh + gap); boxes.push({ x, y, w: cw, h: hh }); });
        sides.push([list, boxes, side]);
      });
      sides.forEach(([list, boxes, side]) => boxes.forEach((p, k) => {
        const dy = Math.max(-r * 0.6, Math.min(r * 0.6, (p.y + p.h / 2 - hy) * 0.4)); const ex = side === 0 ? hx - Math.sqrt(r * r - dy * dy) + 18 : hx + Math.sqrt(r * r - dy * dy) - 18;
        if (side === 0) ribbon(c, p.x + p.w - 12, p.y + p.h / 2, ex, hy + dy, RT(), k, k + 1); else ribbon(c, ex, hy + dy, p.x + 12, p.y + p.h / 2, RT(), k + 1, k);
      }));
      sides.forEach(([list, boxes, side]) => list.forEach((nd, k) => card(c, boxes[k].x, boxes[k].y, boxes[k].w, boxes[k].h, { i: k + side, title: nd.title, text: nd.text, num: side === 0 ? k + 1 : null })));
      hub();
    } else {
      r = S(130); const rz = S(92); const g = S(18); hx = b.x + b.w / 2; const top = b.y + HH();
      const ch = (b.h - HH() - 2 * r - 2 * rz) / 2; hy = top + ch + rz + r;
      heading(c, b.x, b.y, b.w, stepsHead(d), 0);
      const row = (list, y, side) => { const n = list.length; const cw = (b.w - 2 * g) / 3; const x0 = b.x + (b.w - (n * cw + (n - 1) * g)) / 2; return list.map((nd, k) => ({ nd, x: x0 + k * (cw + g), y, w: cw, h: ch, side, k })); };
      const up = row(lefts, top, 0); const down = row(rights, hy + r + rz, 1);
      up.forEach((p) => { const dx = Math.max(-r * 0.7, Math.min(r * 0.7, (p.x + p.w / 2 - hx) * 0.45)); ribbon(c, p.x + p.w / 2, p.y + p.h - 12, hx + dx, hy - Math.sqrt(r * r - dx * dx) + 16, RT(), p.k, p.k + 1, true); });
      down.forEach((p) => { const dx = Math.max(-r * 0.7, Math.min(r * 0.7, (p.x + p.w / 2 - hx) * 0.45)); ribbon(c, hx + dx, hy + Math.sqrt(r * r - dx * dx) - 16, p.x + p.w / 2, p.y + 12, RT(), p.k + 1, p.k, true); });
      [[-1, -S(70), S(36), 0], [-1, S(70), S(28), 1], [1, -S(70), S(36), 2], [1, S(70), S(28), 3]].forEach(([sd, dy, rad, k]) => badge(c, c.pool[k % c.pool.length], hx + sd * (r + (sd < 0 ? (hx - b.x - r) * 0.55 : (b.x + b.w - hx - r) * 0.55)), hy + dy + (k % 2 ? 0 : 0), rad * 2, c.P.acc[k % 3]));
      up.concat(down).forEach((p) => card(c, p.x, p.y, p.w, p.h, { i: p.k + p.side, title: p.nd.title, text: p.nd.text, num: p.side === 0 ? p.k + 1 : null }));
      heading(c, b.x, hy + r - S(6), S(380), lab.outcomes, 2);
      hub();
    }
  },
  timeline(c, b, d, L) {
    const { steps, outcomes, kpi } = d; const n = steps.length; const lab = d.labels;
    const strip = L ? 190 : 440; const rz = L ? 40 : S(80); const tl = b.h - strip - rz;
    const sy = b.y + b.h - strip; let lastMarker = null;
    if (L) {
      const sp = b.w / n; const ch = (tl - 64) / 2; const ly = b.y + ch + 32; const mxs = steps.map((_, k) => b.x + sp * (k + 0.5));
      ribbon(c, mxs[0], ly, mxs[n - 1], ly, S(18), 0, 2);
      steps.forEach((s, k) => {
        const mx = mxs[k]; const up = (n - 1 - k) % 2 === 0; const cw = Math.min(sp * 1.8, 520); const x = Math.max(b.x, Math.min(b.x + b.w - cw, mx - cw / 2));
        const y = up ? b.y : ly + 32; c.under(`<rect x="${mx - 3}" y="${up ? y + ch : ly}" width="6" height="32" fill="${c.P.acc[k % 3]}"/>`);
        card(c, x, y, cw, ch, { i: k, title: s.title, text: s.text });
        c.add(circle(mx, ly, 22, c.P.acc[k % 3])); c.nodes.push({ kind: 'marker', x: mx - 22, y: ly - 22, w: 44, h: 44 });
        fit(c, String(k + 1), mx - 20, ly - 20, 40, 40, { size: 22, min: 12, weight: 800, fill: bestInk(c.P.acc[k % 3]), anchor: 'middle', valign: 'middle', maxLines: 1 });
        lastMarker = { x: mx, y: ly };
      });
    } else {
      const gap = S(14); const ch = (tl - gap * (n - 1)) / n; const lx = b.x + S(30); const r = S(24);
      ribbon(c, lx, b.y + ch / 2, lx, b.y + tl - ch / 2, S(18), 0, 2, true);
      steps.forEach((s, k) => {
        const y = b.y + k * (ch + gap); card(c, b.x + S(84), y, b.w - S(84), ch, { i: k, title: s.title, text: s.text });
        c.add(circle(lx, y + ch / 2, r, c.P.acc[k % 3])); c.nodes.push({ kind: 'marker', x: lx - r, y: y + ch / 2 - r, w: 2 * r, h: 2 * r });
        fit(c, String(k + 1), lx - r + 2, y + ch / 2 - r + 2, 2 * r - 4, 2 * r - 4, { size: S(24), min: 12, weight: 800, fill: bestInk(c.P.acc[k % 3]), anchor: 'middle', valign: 'middle', maxLines: 1 });
        lastMarker = { x: lx, y: y + ch / 2 };
      });
    }
    const oy = L ? sy + HH() : sy;
    if (L) heading(c, b.x, sy - 4, b.w, lab.outcomes, 2); else pill(c, b.x + b.w / 2, b.y + tl + rz / 2, lab.outcomes, 2);
    let row;
    if (L) {
      const k = outcomes.length + (kpi ? 1.1 : 0); const g = S(14); const w = (b.w - g * (outcomes.length + (kpi ? 1 : 0) - 1)) / k; let x = b.x; row = [];
      outcomes.forEach((o, j) => { card(c, x, oy, w, strip - HH(), { i: j + 1, title: o.title, text: o.text, solid: j === 0, tsize: S(22), xsize: S(16) }); row.push({ x, y: oy, w, h: strip - HH() }); x += w + g; });
      if (kpi) { kpiPanel(c, x, oy, w * 1.1, strip - HH(), kpi, 0); row.push({ x, y: oy, w: w * 1.1, h: strip - HH() }); }
    } else {
      const g = S(14); const half = (b.w - g) / 2; const ph = strip; row = [];
      if (kpi) { kpiPanel(c, b.x, oy, half, ph, kpi, 0); row.push({ x: b.x, y: oy, w: half, h: ph }); }
      row.push(...stack(c, kpi ? b.x + half + g : b.x, oy, kpi ? half : b.w, ph, outcomes.slice(0, 3), { gap: S(10), start: 1, solidFirst: true, tsize: S(21), xsize: S(16) }));
    }
    const target = L ? row[row.length - 1] : row[0];
    if (lastMarker && target) { const tx = L ? Math.min(lastMarker.x, target.x + target.w - 30) : target.x + target.w * 0.18; ribbon(c, lastMarker.x, lastMarker.y + (L ? 20 : 0), tx, target.y + 12, S(18), 2, 0, true); }
  },
  kpi_hero(c, b, d, L) {
    const { steps, outcomes, kpi } = d; const lab = d.labels;
    if (L) {
      const strip = 200; const upper = b.h - strip - 24; const hw = 600; const hh = upper;
      kpiPanel(c, b.x, b.y, hw, hh, kpi, 0);
      const dx = b.x + hw + 170; const dw = b.w - hw - 170;
      heading(c, dx, b.y, dw, stepsHead(d), 1);
      const cards = stack(c, dx, b.y + HH(), dw, upper - HH(), steps, { numbered: true, start: 1 });
      cards.forEach((s, j) => ribbon(c, b.x + hw - 12, b.y + hh / 2 + (j - (cards.length - 1) / 2) * 10, s.x + 12, s.y + s.h / 2, RT(), 0, j + 1));
      const sy = b.y + b.h - strip; heading(c, b.x, sy, b.w, lab.outcomes, 2);
      stack(c, b.x, sy + HH(), b.w, strip - HH(), outcomes.slice(0, 3), { horizontal: true, gap: S(14), start: 2, solidFirst: true, tsize: S(22), xsize: S(16) });
    } else {
      const hh = 340; const rz1 = S(86); const rz2 = S(90); const oh = 300; const sth = b.h - hh - rz1 - rz2 - oh;
      kpiPanel(c, b.x, b.y, b.w, hh, kpi, 0);
      const cards = stack(c, b.x, b.y + hh + rz1, b.w, sth, steps, { numbered: true, start: 1 });
      [0.3, 0.5, 0.7].forEach((f, k) => ribbon(c, b.x + b.w * f, b.y + hh - 12, b.x + b.w * (0.5 + (f - 0.5) * 1.2), cards[0].y + 12, RT(), k, k + 1, true));
      pill(c, b.x + b.w / 2, b.y + hh + rz1 / 2, stepsHead(d), 1);
      const oy = b.y + b.h - oh; const row = stack(c, b.x, oy, b.w, oh, outcomes.slice(0, 3), { horizontal: true, gap: S(14), start: 2, solidFirst: true, tsize: S(22), xsize: S(16) });
      fanDown(c, cards[cards.length - 1], row, b.x + b.w / 2); pill(c, b.x + b.w / 2, b.y + b.h - oh - rz2 / 2, lab.outcomes, 2);
    }
  },
};

// ---------- page ----------
function palette(theme) {
  const acc = theme && theme.accents && theme.accents.length >= 3 && theme.id !== 'warm' ? theme.accents.slice(0, 3) : WARM;
  const bg = (theme && theme.bg) || '#FFFFFF'; const ink = (theme && theme.ink) || '#1F2A33'; const muted = (theme && theme.muted) || '#5F6B76';
  return { acc, bg, ink, muted, tint: (i) => mix(acc[i % 3], bg, 0.85), font: (theme && theme.font) || "Inter, 'Helvetica Neue', Arial, sans-serif" };
}
const asItems = (list, max) => (list || []).slice(0, max).map((x) => (typeof x === 'string' ? { title: x, text: '' } : { title: x.title, text: x.text || '' }));

// The infographic and the log of every text box, card, icon and ribbon (for the layout checks). `content` is a pick (see infographicPick.js); null takes the fallback pick.
export function renderInfographic(useCase, { orientation = 'landscape', scenario = '', content = null, theme = null, logo = '', rtl = false } = {}) {
  const L = orientation !== 'portrait'; const { W, H } = DIMS[L ? 'landscape' : 'portrait'];
  K = L ? 1 : 1.3; FLOOR = L ? 16 : 22;
  const pick = content || fallbackPick(useCase);
  let id = SCENARIO_IDS.includes(scenario) ? scenario : SCENARIO_IDS.includes(pick.scenario) ? pick.scenario : 'process_flow';
  const kpi = pick.kpi && pick.kpi.value ? { value: pick.kpi.value, label: pick.kpi.label || '' } : null;
  if (id === 'kpi_hero' && !kpi) id = 'process_flow';
  const d = {
    title: pick.title || (useCase && useCase.Name) || 'Use case', subtitle: pick.subtitle || '',
    steps: asItems(pick.steps, 5).slice(0, L && id === 'process_flow' ? 4 : id === 'hub_spokes' ? 3 : id === 'funnel' || id === 'kpi_hero' ? 4 : 5),
    outcomes: asItems(pick.outcomes, id === 'process_flow' || id === 'funnel' ? (kpi ? 2 : 3) : 3), kpi, before: pick.before ? asItems(pick.before, 4) : null,
    labels: { steps: 'How it works', outcomes: 'What it delivers', before: 'Before', after: 'After', ...(pick.labels || {}) },
  };
  const P = palette(theme); const parts = []; const unders = [];
  const used = new Set(); const pool = [];
  for (const it of [...d.steps, ...d.outcomes]) { const n = iconFor(it.title, pool.length, null, it.text); if (!pool.includes(n)) pool.push(n); }
  for (const n of ['sparkles', 'chart-column', 'database', 'users', 'rocket', 'gauge']) if (pool.length < 6 && !pool.includes(n)) pool.push(n);
  const c = { P, blocks: [], nodes: [], icons: [], ribbons: [], defs: new Map([['igs', SHADOW]]), pool, used, iconSeq: 0, add: (s) => parts.push(s), under: (s) => unders.push(s) };
  const ink = P.ink;
  // Header: a big bold title across the page, the sub-title, the logo.
  const logoW = logo ? 180 : 0; const tw = W - 2 * M - (logoW ? logoW + 24 : 0);
  const tp = plan(d.title, tw, L ? 126 : 210, { size: L ? 60 : 78, min: 28, weight: 800, lh: 1.1, maxLines: L ? 2 : 3 });
  put(c, M, 30, tw, tp.h, tp, { fill: ink });
  const sub = d.subtitle || (useCase && useCase['Business Domain']) || '';
  if (sub) fit(c, sub, M, 30 + tp.h + 8, tw, L ? 36 : 70, { size: L ? 26 : 30, min: 14, weight: 500, fill: P.muted, maxLines: L ? 1 : 2 });
  if (logo) parts.push(`<image href="${esc(logo)}" x="${W - M - logoW}" y="30" width="${logoW}" height="72" preserveAspectRatio="xMaxYMid meet"/>`);
  const by = L ? 236 : 330; const body = { x: M, y: by, w: W - 2 * M, h: H - by - 72 };
  SC[id](c, body, d, L);
  const foot = [useCase && useCase.No, useCase && useCase.Name].filter(Boolean).join(' · ');
  if (foot) fit(c, foot, M, H - 50, W - 2 * M, S(26), { size: 15, min: 12, fill: P.muted, maxLines: 1 });
  const deco = `<circle cx="${W - 40}" cy="${L ? 80 : 120}" r="${L ? 150 : 190}" fill="${P.acc[0]}" fill-opacity="0.07"/><circle cx="30" cy="${H - 30}" r="${L ? 160 : 210}" fill="${P.acc[2]}" fill-opacity="0.07"/>`;
  const inner = `<rect width="${W}" height="${H}" fill="${P.bg}"/>${deco}<g data-scenario="${id}">${unders.join('')}${parts.join('')}</g>`;
  let svg = svgDoc(W, H, inner, P.font, [...c.defs.values()].join(''));
  if (rtl) svg = rtlSvg(svg);
  return { svg, blocks: c.blocks, nodes: c.nodes, icons: c.icons, ribbons: c.ribbons, width: W, height: H, scenario: id };
}
export const infographicFor = (useCase, o = {}) => renderInfographic(useCase, o).svg;

// ---------- styles list (the examples the dialog shows) ----------
const SAMPLE = {
  title: 'From signals to action', subtitle: 'A sample of this layout',
  steps: [{ title: 'Collect', text: 'Bring the data together' }, { title: 'Analyse', text: 'Find the pattern' }, { title: 'Decide', text: 'Pick the best move' }],
  outcomes: [{ title: 'Faster decisions', text: 'Less waiting' }, { title: 'Lower cost', text: 'Less waste' }], kpi: { value: '42%', label: 'faster' },
};
export function infographicStyles(theme = null) {
  const thumb = (id, orientation) => renderInfographic({ No: '', Name: '' }, { orientation, scenario: id, content: { ...SAMPLE, scenario: id }, theme }).svg
    .replace(/width="\d+" height="\d+"/, orientation === 'portrait' ? 'width="120" height="170"' : 'width="240" height="135"');
  return SCENARIOS.map((s) => ({ id: s.id, name: s.name, description: s.when, orientations: ['landscape', 'portrait'], thumbnails: { landscape: thumb(s.id, 'landscape'), portrait: thumb(s.id, 'portrait') } }));
}
