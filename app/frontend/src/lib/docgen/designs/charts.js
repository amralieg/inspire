// REQ-526 design study: chart primitives as SVG strings. Every style composes these with its own tokens and shapes.
// Each chart has a pptxgenjs twin noted in index.html (BAR, DOUGHNUT, SCATTER/BUBBLE native; treemap, waterfall, funnel drawn as shapes).
import { t, T, rect, line, circle, arc, treemap, icon, money, bestInk, wrap, nLines } from './core.js';

// Horizontal bars: rows [{label, value, text, icon?}], box {x, y, w}, o = {rowH, barH, labelW, valueW, track, fill(i,row), ink, muted, bg, rx, size, iconC, iconBg, font}
export function hbars(rows, b, o) {
  const max = Math.max(...rows.map((r) => r.value), 1);
  const rowH = o.rowH || 26; const barH = o.barH || 10; const size = o.size || 12;
  const iw = o.icon ? 22 : 0;
  const labelW = o.labelW || 120; const valueW = o.valueW || 56;
  const bx = b.x + iw + labelW; const bw = b.w - iw - labelW - valueW;
  let s = '';
  // C26 (REQ-563): a label too long for its column wraps (text is never cut) and its row grows, so it never runs into the next row.
  const lh = Math.round(size * 1.2);
  const heights = rows.map((r) => Math.max(rowH, nLines(r.label, labelW - 8, size) * lh + (rowH - lh)));
  let top = b.y;
  rows.forEach((r, i) => {
    const y = top; const cy = y + heights[i] / 2; top += heights[i];
    const n = nLines(r.label, labelW - 8, size);
    if (o.icon) { if (o.iconBg) s += circle(b.x + 9, cy, 10, o.iconBg); s += icon(r.icon, b.x + 9 - 6.5, cy - 6.5, 13, o.iconC, 2); }
    s += t(b.x + iw + (o.icon ? 4 : 0), cy + size * 0.36 - ((n - 1) * lh) / 2, r.label, { size, fill: o.ink, bg: o.bg, maxW: labelW - 8, lh, font: o.font, ctx: 'bar label' });
    if (o.track) s += rect(bx, cy - barH / 2, bw, barH, o.track, { rx: o.rx ?? barH / 2 });
    s += rect(bx, cy - barH / 2, Math.max(3, (r.value / max) * bw), barH, o.fill(i, r), { rx: o.rx ?? barH / 2 });
    s += t(b.x + b.w, cy + size * 0.36, r.text, { size, weight: 700, fill: o.valueC || o.ink, bg: o.bg, anchor: 'end', font: o.font, ctx: 'bar value' });
  });
  return { svg: s, h: top - b.y };
}

// Donut: parts [{name, value, color}], centre (cx, cy), r0..r1; o = {gap, bg, centerTop, centerBottom, ink, muted, font, displayFont, centerSize}
export function donut(parts, cx, cy, r0, r1, o = {}) {
  const total = parts.reduce((s, p) => s + p.value, 0) || 1;
  let a = 0; let s = '';
  const gap = o.gap ?? 0.025;
  parts.forEach((p) => {
    const da = (p.value / total) * Math.PI * 2;
    s += `<path d="${arc(cx, cy, r0, r1, a + gap / 2, a + da - gap / 2)}" fill="${p.color}"/>`;
    a += da;
  });
  if (o.centerTop) s += t(cx, cy + (o.centerSize || 20) * 0.2, o.centerTop, { size: o.centerSize || 20, weight: 700, fill: o.ink, bg: o.bg, anchor: 'middle', font: o.displayFont, ctx: 'donut centre' });
  if (o.centerBottom) s += t(cx, cy + (o.centerSize || 20) * 0.2 + 16, o.centerBottom, { size: 12, fill: o.muted, bg: o.bg, anchor: 'middle', font: o.font, ctx: 'donut centre label' });
  return s;
}

// Legend rows: items [{name, color, text}], at (x, y); o = {rowH, size, ink, muted, bg, w, swatch:'dot'|'square'}
export function legend(items, x, y, o) {
  let s = ''; const rowH = o.rowH || 20; const size = o.size || 12;
  items.forEach((it, i) => {
    const yy = y + i * rowH;
    s += o.swatch === 'square' ? rect(x, yy - 9, 10, 10, it.color, { rx: 2 }) : circle(x + 5, yy - 4, 5, it.color);
    s += t(x + 16, yy, it.name, { size, fill: o.ink, bg: o.bg, font: o.font, ctx: 'legend' });
    if (it.text) s += t(x + o.w, yy, it.text, { size, weight: 700, fill: o.ink, bg: o.bg, anchor: 'end', font: o.font, ctx: 'legend value' });
  });
  return s;
}

// Score vs value quadrant. useCases with score and value.amount; box {x, y, w, h}; o = {colorOf(u), axis, grid, ink, muted, bg, quad: [tl, tr, bl, br] labels,
// quadFill (fill for the "do first" quadrant), labelTop (n labels), r(u), font, xLabel, yLabel, mx, my (split values)}
export function quadrant(ucs, b, o) {
  const xs = ucs.map((u) => u.score); const vs = ucs.map((u) => u.value.amount);
  const x0 = Math.floor(Math.min(...xs) * 2) / 2 - 0.25; const x1 = Math.ceil(Math.max(...xs) * 2) / 2 + 0.25;
  const vmax = Math.max(...vs) * 1.08;
  const pad = { l: 34, b: 22, t: 30, r: 8 };
  const px = (s) => b.x + pad.l + ((s - x0) / (x1 - x0)) * (b.w - pad.l - pad.r);
  const py = (v) => b.y + b.h - pad.b - Math.sqrt(v / vmax) * (b.h - pad.b - pad.t);
  const mx = px(o.mx); const my = py(o.my);
  let s = '';
  if (o.quadFill) s += rect(mx, b.y + 2, b.x + b.w - pad.r - mx, my - b.y - 2, o.quadFill, { rx: o.quadRx || 0 });
  s += line(b.x + pad.l, b.y + b.h - pad.b, b.x + b.w - pad.r, b.y + b.h - pad.b, o.axis, 1);
  s += line(b.x + pad.l, b.y + pad.t, b.x + pad.l, b.y + b.h - pad.b, o.axis, 1);
  s += line(mx, b.y + pad.t, mx, b.y + b.h - pad.b, o.grid, 1, { dash: '4 4' });
  s += line(b.x + pad.l, my, b.x + b.w - pad.r, my, o.grid, 1, { dash: '4 4' });
  // axis ticks
  for (let v = Math.ceil(x0); v <= x1; v += 1) s += t(px(v), b.y + b.h - 6, String(v), { size: 12, fill: o.muted, bg: o.bg, anchor: 'middle', font: o.font, ctx: 'tick' });
  [vmax / 1.08, vmax / 4].forEach((v) => { const r = Math.round(v / 50000) * 50000; s += t(b.x + pad.l - 4, py(r) + 4, money(r), { size: 12, fill: o.muted, bg: o.bg, anchor: 'end', font: o.font, ctx: 'tick' }); });
  const sorted = [...ucs].sort((a, c) => a.value.amount - c.value.amount);
  sorted.forEach((u) => { s += circle(px(u.score), py(u.value.amount), o.r ? o.r(u) : 5, o.colorOf(u), { op: o.dotOp ?? 0.92, stroke: o.dotStroke, sw: 1.5 }); });
  const q = o.quad || ['High value, lower score', 'Do first', 'Park', 'Quick wins'];
  const qb = o.quadBg || o.bg;
  s += t(b.x + pad.l + 6, b.y + 16, q[0], { size: 12, fill: o.muted, bg: o.bg, font: o.font, ctx: 'quad', halo: o.bg });
  s += t(b.x + b.w - pad.r - 6, b.y + 16, q[1], { size: 12, weight: 700, fill: o.quadInk || o.ink, bg: qb, anchor: 'end', font: o.font, ctx: 'quad do first', halo: qb });
  s += t(b.x + pad.l + 6, b.y + b.h - pad.b - 6, q[2], { size: 12, fill: o.muted, bg: o.bg, font: o.font, ctx: 'quad', halo: o.bg });
  s += t(b.x + b.w - pad.r - 6, b.y + b.h - pad.b - 6, q[3], { size: 12, fill: o.muted, bg: o.bg, anchor: 'end', font: o.font, ctx: 'quad', halo: o.bg });
  // label the top-N by value
  const top = [...ucs].sort((a, c) => c.value.amount - a.value.amount).slice(0, o.labelTop ?? 2);
  top.forEach((u, i) => {
    const x = px(u.score); const y = py(u.value.amount);
    const left = x > b.x + b.w * 0.6;
    const label = `${i + 1}`;
    const dx = left ? -16 : 16; const r = o.r ? o.r(u) : 5;
    s += line(x + (left ? -r : r) * 0.7, y - r * 0.7, x + dx, y - 12, o.ink, 1);
    s += circle(x + dx, y - 12, 9, o.ink); s += t(x + dx, y - 8, label, { size: 12, weight: 700, fill: o.bg, bg: o.ink, anchor: 'middle', font: o.font, ctx: 'quad num' });
  });
  s += t(b.x + b.w - pad.r, b.y + b.h + 12, o.xLabel || 'Inspire score', { size: 12, fill: o.muted, bg: o.bg, anchor: 'end', font: o.font, ctx: 'axis' });
  return s;
}

// Treemap of domains. items [{name, value, text, icon, color}], box; o = {gap, rx, inkOn(color), font, displayFont, minLabel}
export function treemapChart(items, b, o) {
  const cells = treemap(items, b);
  const g = o.gap ?? 3;
  let s = '';
  cells.forEach((c) => {
    const x = c.x + g / 2; const y = c.y + g / 2; const w = c.w - g; const h = c.h - g;
    s += rect(x, y, w, h, c.color, { rx: o.rx || 0 });
    const ink = o.inkOn ? o.inkOn(c.color) : bestInk(c.color);
    const room = w > 64 && h > 40;
    if (room) {
      const big = w > 120 && h > 70;
      if (o.icons && h > 62 && w > 56) s += icon(c.icon, x + 10, y + 10, big ? 20 : 16, ink, 2);
      const ty = o.icons && h > 62 && w > 56 ? y + (big ? 48 : 40) : y + 20;
      const k = o.scale || 1;
      s += t(x + 10, ty + (k > 1 ? 4 : 0), c.name, { size: (big ? 14 : 12) * k, weight: 700, fill: ink, bg: c.color, maxW: w - 30, lines: 1, font: o.font, ctx: 'treemap name' });
      if (h > (o.icons ? 80 : 46)) s += t(x + 10, ty + (big ? 22 : 16) * k + (k > 1 ? 6 : 0), c.text, { size: (big ? 18 : 12) * k, weight: big ? 700 : 400, fill: ink, bg: c.color, font: o.displayFont || o.font, ctx: 'treemap value' });
    }
  });
  return { svg: s, cells };
}

// Waterfall of domain values building to the total: items [{name, value, text}], box; o = {fill, totalFill, ink, muted, bg, grid, font, displayFont}
export function waterfall(items, b, o) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const n = items.length + 1; const slot = b.w / n; const bw = Math.min(46, slot * 0.66);
  const top = b.y + 18; const base = b.y + b.h - 40; const H = base - top;
  const fs = o.size || 12;
  let acc = 0; let s = line(b.x, base, b.x + b.w, base, o.grid, 1);
  items.forEach((it, i) => {
    const x = b.x + i * slot + (slot - bw) / 2;
    const y1 = base - ((acc + it.value) / total) * H; const y0 = base - (acc / total) * H;
    s += rect(x, y1, bw, y0 - y1, o.fill(i, it));
    if (i < items.length - 1) s += line(x + bw, y1, x + slot, y1, o.grid, 1, { dash: '3 3' });
    s += t(x + bw / 2, y1 - 5, it.text, { size: fs, weight: 700, fill: o.ink, bg: o.bg, anchor: 'middle', font: o.font, ctx: 'wf value' });
    const lab = wrap(it.name, slot - 2, fs, 'sans', 400);
    lab.forEach((l, j) => { s += t(x + bw / 2, base + fs + 4 + j * (fs + 2), l, { size: fs, fill: o.muted, bg: o.bg, anchor: 'middle', font: o.font, ctx: 'wf label' }); });
    acc += it.value;
  });
  const x = b.x + items.length * slot + (slot - bw) / 2;
  s += rect(x, top, bw, H, o.totalFill);
  s += t(x + bw / 2, top - 5, money(total), { size: fs, weight: 700, fill: o.ink, bg: o.bg, anchor: 'middle', font: o.font, ctx: 'wf total' });
  s += t(x + bw / 2, base + fs + 4, 'Total', { size: fs, weight: 700, fill: o.ink, bg: o.bg, anchor: 'middle', font: o.font, ctx: 'wf total label' });
  return s;
}

// Funnel (stages narrowing): stages [{name, n, text}], box; o = {colors[], inkOn, font, bg, muted}
export function funnel(stages, b, o) {
  const max = Math.max(...stages.map((s) => s.n), 1); const h = b.h / stages.length;
  let s = '';
  stages.forEach((st, i) => {
    const w0 = b.w * (0.34 + 0.66 * (st.n / max)); const w1 = i + 1 < stages.length ? b.w * (0.34 + 0.66 * (stages[i + 1].n / max)) : w0 * 0.9;
    const cx = b.x + b.w / 2; const y = b.y + i * h;
    const c = o.colors[i % o.colors.length];
    s += `<path d="M${cx - w0 / 2} ${y}H${cx + w0 / 2}L${cx + w1 / 2} ${y + h - 3}H${cx - w1 / 2}Z" fill="${c}"/>`;
    const ink = o.inkOn ? o.inkOn(c) : bestInk(c);
    s += t(cx, y + h / 2 + 4, `${st.name}  ${st.text}`, { size: 12, weight: 700, fill: ink, bg: c, anchor: 'middle', font: o.font, ctx: 'funnel' });
  });
  return s;
}

// Score meter (0-10) as a thin bar; returns svg.
export const meter = (x, y, w, h, score, fill, track, rx = h / 2) => rect(x, y, w, h, track, { rx }) + rect(x, y, (Math.max(0, Math.min(10, score)) / 10) * w, h, fill, { rx });

// Harvey ball for a 0-10 score.
export function harvey(cx, cy, r, score, fill, track) {
  const f = Math.max(0, Math.min(1, score / 10));
  let s = circle(cx, cy, r, track);
  if (f >= 0.999) s += circle(cx, cy, r, fill);
  else if (f > 0) { const a = f * Math.PI * 2; const big = a > Math.PI ? 1 : 0; s += `<path d="M${cx} ${cy}L${cx} ${cy - r}A${r} ${r} 0 ${big} 1 ${cx + r * Math.sin(a)} ${cy - r * Math.cos(a)}Z" fill="${fill}"/>`; }
  return s + circle(cx, cy, r, 'none', { stroke: fill, sw: 1.2 });
}

export { T };
