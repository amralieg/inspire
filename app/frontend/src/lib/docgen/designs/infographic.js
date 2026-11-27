// C28 (REQ-571): per use case infographics. A library of designed SVG layouts (6 scenarios, landscape 16:9 and portrait A4) in one style:
// big bold title, rounded pastel panels, numbered steps, flowing coloured ribbons from the steps to the outcomes, one huge KPI number.
// infographicFor(useCase, {orientation, scenario, content, theme, logo, rtl}) -> svg. The content comes from the picker (infographicPick.js).
// Every text sits in a measured box (shrunk to fit, then cut with an ellipsis), and every box is logged, so nothing overflows or overlaps.
import { SCENARIOS, SCENARIO_IDS } from '../../../../../backend/lib/infographicPick.mjs';
import { LB } from '../docLabels.js';
import { esc, textW, rect, circle, mix, bestInk, svgDoc, rtlSvg } from './core.js';
import { fallbackPick } from './infographicPick.js';

export { SCENARIO_IDS };
export const DIMS = { landscape: { W: 1600, H: 900 }, portrait: { W: 1240, H: 1754 } };
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
// The largest size (down to `min`) at which the text fits the box; at the minimum a longer text is cut with an ellipsis.
function plan(text, w, h, { size = 18, min = 13, weight = 400, lh = 1.22, maxLines = 99 } = {}) {
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

// ---------- pieces ----------
// A title (bold) over a text (regular), centred vertically in the box.
function label(c, x, y, w, h, title, text, { fill, tsize = 24, xsize = 18, gap = 6, anchor = 'start' } = {}) {
  const tmax = text ? Math.max(tsize * 1.25, h * 0.46) : h;
  const tp = plan(title, w, tmax, { size: tsize, min: 14, weight: 700, lh: 1.18, maxLines: 3 });
  const xp = text ? plan(text, w, Math.max(0, h - tp.h - gap), { size: xsize, min: 12, lh: 1.22 }) : { lines: [], h: 0 };
  const total = tp.h + (xp.lines.length ? gap + xp.h : 0); const y0 = y + Math.max(0, (h - total) / 2);
  put(c, x, y0, w, tp.h, tp, { fill, anchor });
  if (xp.lines.length) put(c, x, y0 + tp.h + gap, w, xp.h, xp, { fill, anchor });
}
const ribbon = (c, x1, y1, x2, y2, t, color, vertical = false, op = 0.8) => {
  const d = vertical ? `M${x1} ${y1}C${x1} ${(y1 + y2) / 2} ${x2} ${(y1 + y2) / 2} ${x2} ${y2}` : `M${x1} ${y1}C${(x1 + x2) / 2} ${y1} ${(x1 + x2) / 2} ${y2} ${x2} ${y2}`;
  c.under(`<path d="${d}" fill="none" stroke="${color}" stroke-width="${t}" stroke-opacity="${op}" stroke-linecap="round"/>`);
};
// A rounded panel on a pastel fill (solid accent when `solid`), with an optional numbered disc and a title and text.
function card(c, x, y, w, h, { i = 0, num = null, title = '', text = '', solid = false, fill = null, tsize = 24, xsize = 18 } = {}) {
  const P = c.P; const ac = P.acc[i % 3];
  const bg = fill || (solid ? ac : P.tint(i)); const ink = solid ? bestInk(ac) : P.ink;
  c.add(rect(x, y, w, h, bg, { rx: 24 }));
  const pad = Math.min(24, Math.max(12, h * 0.16)); let tx = x + pad; let tw = w - 2 * pad;
  if (num != null) {
    const r = Math.max(15, Math.min(28, h / 2 - 10)); const dc = solid ? ink : ac;
    c.add(circle(x + pad + r, y + h / 2, r, dc));
    fit(c, String(num), x + pad, y + h / 2 - r, 2 * r, 2 * r, { size: Math.round(r * 1.1), min: 12, weight: 700, fill: bestInk(dc), anchor: 'middle', valign: 'middle', maxLines: 1 });
    tx = x + pad + 2 * r + 16; tw = w - (tx - x) - pad;
  }
  label(c, tx, y + pad * 0.6, tw, h - pad * 1.2, title, text, { fill: ink, tsize, xsize });
}
// The huge number and what it measures, on a solid accent panel.
function kpiPanel(c, x, y, w, h, kpi, i = 0) {
  const ac = c.P.acc[i % 3]; const ink = bestInk(ac);
  c.add(rect(x, y, w, h, ac, { rx: 28 }));
  const pad = 22; const vh = kpi.label ? h * 0.58 : h - 2 * pad;
  fit(c, kpi.value, x + pad, y + pad, w - 2 * pad, vh - pad, { size: 150, min: 30, weight: 800, lh: 1.05, fill: ink, anchor: 'middle', valign: 'middle', maxLines: 1 });
  if (kpi.label) fit(c, kpi.label, x + pad, y + vh + 4, w - 2 * pad, h - vh - pad - 4, { size: 26, min: 13, weight: 600, fill: ink, anchor: 'middle', valign: 'top' });
}
const heading = (c, x, y, w, text, i = 0) => { fit(c, text, x, y, w, 34, { size: 26, min: 15, weight: 700, fill: c.P.ink, maxLines: 1 }); c.add(rect(x, y + 36, 56, 5, c.P.acc[i % 3], { rx: 2 })); };
// Cards stacked in a column or row, as tall (or wide) as the room allows.
function stack(c, x, y, w, h, list, { gap = 14, horizontal = false, numbered = false, start = 0, solidFirst = false, fillOf = null, tsize = 24, xsize = 18 } = {}) {
  const n = list.length; if (!n) return [];
  const s = horizontal ? (w - gap * (n - 1)) / n : (h - gap * (n - 1)) / n; const out = [];
  list.forEach((it, k) => {
    const [cx, cy, cw, ch] = horizontal ? [x + k * (s + gap), y, s, h] : [x, y + k * (s + gap), w, s];
    card(c, cx, cy, cw, ch, { i: start + k, num: numbered ? k + 1 : null, title: it.title, text: it.text, solid: solidFirst && k === 0, fill: fillOf ? fillOf(k) : null, tsize, xsize });
    out.push({ x: cx, y: cy, w: cw, h: ch });
  });
  return out;
}

// ---------- scenarios ----------
// Each draws into the body area b = {x, y, w, h}. L is true for landscape.
const SC = {
  process_flow(c, b, d, L) {
    const { steps, outcomes, kpi } = d; const lab = d.labels;
    if (L) {
      const lw = 700; const rw = 620; const rx = b.x + b.w - rw; const top = b.y + 52;
      heading(c, b.x, b.y, lw, lab.steps, 0); heading(c, rx, b.y, rw, lab.outcomes, 2);
      const left = stack(c, b.x, top, lw, b.h - 52, steps, { numbered: true });
      const k = outcomes.length + (kpi ? 1.35 : 0); const gap = 14; const unit = (b.h - 52 - gap * (outcomes.length + (kpi ? 1 : 0) - 1)) / k;
      let y = top; const right = [];
      outcomes.forEach((o, j) => { card(c, rx, y, rw, unit, { i: j + 1, title: o.title, text: o.text, solid: j === 0 }); right.push({ y, h: unit }); y += unit + gap; });
      if (kpi) kpiPanel(c, rx, y, rw, unit * 1.35, kpi, 0);
      left.forEach((s, j) => { const t = right[Math.min(right.length - 1, Math.floor((j * right.length) / left.length))]; ribbon(c, s.x + s.w, s.y + s.h / 2, rx, t.y + t.h / 2, 16, c.P.acc[j % 3]); });
    } else {
      const sh = b.h * 0.52; heading(c, b.x, b.y, b.w, lab.steps, 0);
      stack(c, b.x, b.y + 52, b.w, sh - 52, steps, { numbered: true });
      const oy = b.y + sh + 90; heading(c, b.x, oy - 52, b.w, lab.outcomes, 2);
      for (let j = 0; j < 3; j += 1) ribbon(c, b.x + 120 + j * 360, b.y + sh, b.x + 120 + j * 360 + 60, oy - 58, 16, c.P.acc[j], true);
      const k = outcomes.length + (kpi ? 1.4 : 0); const gap = 14; const unit = (b.y + b.h - oy - gap * (outcomes.length + (kpi ? 1 : 0) - 1)) / k; let y = oy;
      outcomes.forEach((o, j) => { card(c, b.x, y, b.w, unit, { i: j + 1, title: o.title, text: o.text, solid: j === 0 }); y += unit + gap; });
      if (kpi) kpiPanel(c, b.x, y, b.w, unit * 1.4, kpi, 0);
    }
  },
  before_after(c, b, d, L) {
    const { steps, outcomes, kpi } = d; const before = d.before || steps; const lab = d.labels;
    const band = kpi ? (L ? 150 : 230) : 0; const ph = b.h - (band ? band + 20 : 0); const mid = L ? 120 : 110;
    const pw = L ? (b.w - mid) / 2 : b.w; const phh = L ? ph : (ph - mid) / 2;
    const panels = [[b.x, b.y, 'Before', before, 3], L ? [b.x + pw + mid, b.y, 'After', outcomes, 0] : [b.x, b.y + phh + mid, 'After', outcomes, 0]];
    panels.forEach(([x, y, def, list, i], pi) => {
      const ac = pi ? c.P.acc[0] : c.P.mutedAcc; c.add(rect(x, y, pw, phh, pi ? c.P.tint(0) : mix(c.P.muted, c.P.bg, 0.86), { rx: 32 }));
      fit(c, pi ? (lab.after) : (lab.before), x + 28, y + 20, pw - 56, 40, { size: 30, min: 16, weight: 800, fill: c.P.ink, maxLines: 1 });
      stack(c, x + 24, y + 76, pw - 48, phh - 100, list, { gap: 12, start: pi ? 0 : 1, fillOf: () => c.P.bg, tsize: 22, xsize: 17 });
    });
    const [ax, ay] = L ? [b.x + pw, b.y + phh / 2] : [b.x + b.w / 2, b.y + phh];
    c.add(L ? `<path d="M${ax + 20} ${ay - 34}H${ax + mid - 50}V${ay - 62}L${ax + mid - 14} ${ay}L${ax + mid - 50} ${ay + 62}V${ay + 34}H${ax + 20}Z" fill="${c.P.acc[1]}"/>`
      : `<path d="M${ax - 34} ${ay + 16}V${ay + mid - 46}H${ax - 62}L${ax} ${ay + mid - 12}L${ax + 62} ${ay + mid - 46}H${ax + 34}V${ay + 16}Z" fill="${c.P.acc[1]}"/>`);
    if (kpi) kpiBand(c, b.x, b.y + b.h - band, b.w, band, kpi, 1);
  },
  funnel(c, b, d, L) {
    const { steps, outcomes, kpi } = d; const n = steps.length; const lab = d.labels;
    const fw = L ? 860 : b.w; const fh = L ? b.h : b.h * 0.5; const cx = b.x + fw / 2; const gap = 8; const sh = (fh - gap * (n - 1)) / n;
    const widthAt = (k) => fw * (1 - 0.34 * (k / n));
    steps.forEach((s, k) => {
      const ac = c.P.acc[k % 3]; const y = b.y + k * (sh + gap); const w0 = widthAt(k); const w1 = widthAt(k + 1);
      c.add(`<path d="M${cx - w0 / 2} ${y}H${cx + w0 / 2}L${cx + w1 / 2} ${y + sh}H${cx - w1 / 2}Z" fill="${ac}"/>`);
      const inset = (w0 - w1) / 2 + 22;
      label(c, cx - w1 / 2 + 22, y + 6, w1 - 44, sh - 12, `${k + 1}. ${s.title}`, s.text, { fill: bestInk(ac), tsize: 24, xsize: 17, anchor: 'middle' });
      void inset;
    });
    const [ox, oy, ow, oh] = L ? [b.x + fw + 70, b.y, b.w - fw - 70, b.h] : [b.x, b.y + fh + 50, b.w, b.h - fh - 50];
    heading(c, ox, oy, ow, lab.outcomes, 2);
    const k = outcomes.length + (kpi ? 1.4 : 0); const g = 14; const unit = (oh - 52 - g * (outcomes.length + (kpi ? 1 : 0) - 1)) / k; let y = oy + 52;
    outcomes.forEach((o, j) => { card(c, ox, y, ow, unit, { i: j + 1, title: o.title, text: o.text, solid: j === 0 }); y += unit + g; });
    if (kpi) kpiPanel(c, ox, y, ow, unit * 1.4, kpi, 0);
    if (L) ribbon(c, cx + widthAt(n) / 2, b.y + b.h - 60, ox, oy + 120, 18, c.P.acc[0]);
  },
  hub_spokes(c, b, d, L) {
    const nodes = [...d.steps.slice(0, 3), ...d.outcomes.slice(0, 3)]; const kpi = d.kpi; const n = nodes.length;
    const r = L ? 175 : 235; const hx = b.x + b.w / 2; const hy = L ? b.y + b.h / 2 : b.y + r + 10;
    const pos = [];
    if (L) {
      const half = Math.ceil(n / 2); const cw = 520; const gap = 16; const lefts = nodes.slice(0, half); const rights = nodes.slice(half);
      [[lefts, b.x, 0], [rights, b.x + b.w - cw, 1]].forEach(([list, x, side]) => {
        const hh = (b.h - gap * (half - 1)) / half; const y0 = b.y + (b.h - (list.length * hh + (list.length - 1) * gap)) / 2;
        list.forEach((nd, k) => pos.push({ nd, x, y: y0 + k * (hh + gap), w: cw, h: hh, side }));
      });
    } else {
      const cols = 2; const gap = 16; const cw = (b.w - gap) / cols; const rows = Math.ceil(n / cols); const top = hy + r + 90; const hh = (b.y + b.h - top - gap * (rows - 1)) / rows;
      nodes.forEach((nd, k) => pos.push({ nd, x: b.x + (k % cols) * (cw + gap), y: top + Math.floor(k / cols) * (hh + gap), w: cw, h: hh, side: 2 }));
    }
    pos.forEach((p, k) => {
      const ax = c.P.acc[k % 3];
      if (p.side === 0) ribbon(c, p.x + p.w, p.y + p.h / 2, hx - r + 20, hy + (p.y + p.h / 2 - hy) * 0.3, 14, ax);
      else if (p.side === 1) ribbon(c, p.x, p.y + p.h / 2, hx + r - 20, hy + (p.y + p.h / 2 - hy) * 0.3, 14, ax);
      else ribbon(c, p.x + p.w / 2, p.y, hx + (p.x + p.w / 2 - hx) * 0.35, hy + r - 20, 14, ax, true);
    });
    pos.forEach((p, k) => card(c, p.x, p.y, p.w, p.h, { i: k, title: p.nd.title, text: p.nd.text, num: k + 1 }));
    c.add(circle(hx, hy, r + 12, c.P.tint(0)));
    c.add(circle(hx, hy, r, c.P.acc[0]));
    const ink = bestInk(c.P.acc[0]);
    if (kpi) { fit(c, kpi.value, hx - r * 0.78, hy - r * 0.62, r * 1.56, r * 0.8, { size: 120, min: 28, weight: 800, lh: 1.05, fill: ink, anchor: 'middle', valign: 'middle', maxLines: 1 }); fit(c, kpi.label, hx - r * 0.7, hy + r * 0.24, r * 1.4, r * 0.55, { size: 24, min: 13, weight: 600, fill: ink, anchor: 'middle' }); }
    else fit(c, d.title, hx - r * 0.7, hy - r * 0.6, r * 1.4, r * 1.2, { size: 34, min: 14, weight: 800, fill: ink, anchor: 'middle', valign: 'middle' });
  },
  timeline(c, b, d, L) {
    const { steps, outcomes, kpi } = d; const n = steps.length; const lab = d.labels;
    const strip = L ? 170 : 400; const tl = b.h - strip - 30;
    if (L) {
      const sp = b.w / n; const ch = (tl - 64) / 2; const ly = b.y + ch + 32;
      c.under(`<rect x="${b.x}" y="${ly - 6}" width="${b.w}" height="12" rx="6" fill="${c.P.acc[0]}" fill-opacity="0.35"/>`);
      steps.forEach((s, k) => {
        const mx = b.x + sp * (k + 0.5); const up = k % 2 === 0; const cw = Math.min(sp * 1.8, 520); const x = Math.max(b.x, Math.min(b.x + b.w - cw, mx - cw / 2));
        const y = up ? b.y : ly + 32; c.under(`<rect x="${mx - 3}" y="${up ? y + ch : ly}" width="6" height="${32 + (up ? 0 : 0) - (up ? 0 : 0)}" fill="${c.P.acc[k % 3]}"/>`);
        card(c, x, y, cw, ch, { i: k, title: s.title, text: s.text });
        c.add(circle(mx, ly, 22, c.P.acc[k % 3])); fit(c, String(k + 1), mx - 20, ly - 20, 40, 40, { size: 22, min: 12, weight: 800, fill: bestInk(c.P.acc[k % 3]), anchor: 'middle', valign: 'middle', maxLines: 1 });
      });
    } else {
      const gap = 14; const ch = (tl - gap * (n - 1)) / n; const lx = b.x + 30;
      c.under(`<rect x="${lx - 6}" y="${b.y + ch / 2}" width="12" height="${tl - ch}" rx="6" fill="${c.P.acc[0]}" fill-opacity="0.35"/>`);
      steps.forEach((s, k) => {
        const y = b.y + k * (ch + gap); card(c, b.x + 84, y, b.w - 84, ch, { i: k, title: s.title, text: s.text });
        c.add(circle(lx, y + ch / 2, 24, c.P.acc[k % 3])); fit(c, String(k + 1), lx - 22, y + ch / 2 - 22, 44, 44, { size: 24, min: 12, weight: 800, fill: bestInk(c.P.acc[k % 3]), anchor: 'middle', valign: 'middle', maxLines: 1 });
      });
    }
    const sy = b.y + b.h - strip; heading(c, b.x, sy - 4, b.w, lab.outcomes, 2);
    if (L) {
      const k = outcomes.length + (kpi ? 1.1 : 0); const g = 14; const w = (b.w - g * (outcomes.length + (kpi ? 1 : 0) - 1)) / k; let x = b.x;
      outcomes.forEach((o, j) => { card(c, x, sy + 50, w, strip - 50, { i: j + 1, title: o.title, text: o.text, solid: j === 0, tsize: 22, xsize: 16 }); x += w + g; });
      if (kpi) kpiPanel(c, x, sy + 50, w * 1.1, strip - 50, kpi, 0);
    } else {
      const g = 14; const half = (b.w - g) / 2; const ph = strip - 56;
      if (kpi) kpiPanel(c, b.x, sy + 50, half, ph, kpi, 0);
      stack(c, kpi ? b.x + half + g : b.x, sy + 50, kpi ? half : b.w, ph, outcomes.slice(0, 3), { gap: 10, start: 1, solidFirst: true, tsize: 21, xsize: 16 });
    }
  },
  kpi_hero(c, b, d, L) {
    const { steps, outcomes, kpi } = d; const lab = d.labels;
    const strip = L ? 170 : 250; const upper = b.h - strip - 24;
    const hw = L ? 600 : b.w; const hh = L ? upper : 520;
    kpiPanel(c, b.x, b.y, hw, hh, kpi, 0);
    const [dx, dy, dw, dh] = L ? [b.x + hw + 130, b.y, b.w - hw - 130, upper] : [b.x, b.y + hh + 30, b.w, upper - hh - 30];
    heading(c, dx, dy, dw, lab.steps, 1);
    const cards = stack(c, dx, dy + 52, dw, dh - 52, steps, { numbered: true, start: 1 });
    cards.forEach((s, j) => { if (L) ribbon(c, b.x + hw, b.y + hh / 2, s.x, s.y + s.h / 2, 14, c.P.acc[(j + 1) % 3]); });
    const sy = b.y + b.h - strip; heading(c, b.x, sy, b.w, lab.outcomes, 2);
    stack(c, b.x, sy + 50, b.w, strip - 50, outcomes.slice(0, 3), { horizontal: true, gap: 14, start: 2, solidFirst: true, tsize: 22, xsize: 16 });
  },
};
function kpiBand(c, x, y, w, h, kpi, i = 0) {
  const ac = c.P.acc[i % 3]; const ink = bestInk(ac); const vw = w * 0.4;
  c.add(rect(x, y, w, h, ac, { rx: 28 }));
  fit(c, kpi.value, x + 24, y + 12, vw - 24, h - 24, { size: 130, min: 30, weight: 800, lh: 1.05, fill: ink, anchor: 'middle', valign: 'middle', maxLines: 1 });
  fit(c, kpi.label, x + vw + 24, y + 16, w - vw - 56, h - 32, { size: 30, min: 14, weight: 600, fill: ink, valign: 'middle' });
}

// ---------- page ----------
function palette(theme) {
  const acc = theme && theme.accents && theme.accents.length >= 3 && theme.id !== 'warm' ? theme.accents.slice(0, 3) : WARM;
  const bg = (theme && theme.bg) || '#FFFFFF'; const ink = (theme && theme.ink) || '#1F2A33'; const muted = (theme && theme.muted) || '#5F6B76';
  return { acc, bg, ink, muted, tint: (i) => mix(acc[i % 3], bg, 0.85), font: (theme && theme.font) || "Inter, 'Helvetica Neue', Arial, sans-serif" };
}
const asItems = (list, max) => (list || []).slice(0, max).map((x) => (typeof x === 'string' ? { title: x, text: '' } : { title: x.title, text: x.text || '' }));

// The infographic and the log of every text box (for the layout checks). `content` is a pick (see infographicPick.js); null takes the fallback pick.
export function renderInfographic(useCase, { orientation = 'landscape', scenario = '', content = null, theme = null, logo = '', rtl = false } = {}) {
  const L = orientation !== 'portrait'; const { W, H } = DIMS[L ? 'landscape' : 'portrait'];
  const pick = content || fallbackPick(useCase);
  let id = SCENARIO_IDS.includes(scenario) ? scenario : SCENARIO_IDS.includes(pick.scenario) ? pick.scenario : 'process_flow';
  const kpi = pick.kpi && pick.kpi.value ? { value: pick.kpi.value, label: pick.kpi.label || '' } : null;
  if (id === 'kpi_hero' && !kpi) id = 'process_flow';
  const d = {
    title: pick.title || (useCase && useCase.Name) || 'Use case', subtitle: pick.subtitle || '',
    steps: asItems(pick.steps, id === 'hub_spokes' || id === 'timeline' && L ? 5 : 5).slice(0, L && id === 'process_flow' ? 4 : id === 'hub_spokes' ? 3 : id === 'funnel' || id === 'kpi_hero' ? 4 : 5),
    outcomes: asItems(pick.outcomes, id === 'process_flow' || id === 'funnel' ? (kpi ? 2 : 3) : 3), kpi, before: pick.before ? asItems(pick.before, 4) : null,
    labels: { steps: 'How it works', outcomes: 'What it delivers', before: 'Before', after: 'After', ...(pick.labels || {}) },
  };
  const P = palette(theme); const parts = []; const unders = [];
  const c = { P, blocks: [], add: (s) => parts.push(s), under: (s) => unders.push(s) };
  const ink = P.ink;
  // Header: a big bold title, the sub-title, the logo.
  const logoW = logo ? 180 : 0; const tw = W - 2 * M - (logoW ? logoW + 24 : 0);
  const tp = plan(d.title, tw, L ? 112 : 160, { size: L ? 46 : 56, min: 24, weight: 800, lh: 1.12, maxLines: L ? 2 : 3 });
  put(c, M, 34, tw, tp.h, tp, { fill: ink });
  const sub = d.subtitle || (useCase && useCase['Business Domain']) || '';
  if (sub) fit(c, sub, M, 34 + tp.h + 10, tw, L ? 34 : 62, { size: L ? 22 : 26, min: 14, weight: 500, fill: P.muted, maxLines: L ? 1 : 2 });
  if (logo) parts.push(`<image href="${esc(logo)}" x="${W - M - logoW}" y="30" width="${logoW}" height="72" preserveAspectRatio="xMaxYMid meet"/>`);
  const by = L ? 212 : 288; const body = { x: M, y: by, w: W - 2 * M, h: H - by - 72 };
  SC[id](c, body, d, L);
  const foot = [useCase && useCase.No, useCase && useCase.Name].filter(Boolean).join(' · ');
  if (foot) fit(c, foot, M, H - 50, W - 2 * M, 24, { size: 15, min: 12, fill: P.muted, maxLines: 1 });
  const deco = `<circle cx="${W - 40}" cy="${L ? 80 : 120}" r="${L ? 150 : 190}" fill="${P.acc[0]}" fill-opacity="0.07"/><circle cx="30" cy="${H - 30}" r="${L ? 160 : 210}" fill="${P.acc[2]}" fill-opacity="0.07"/>`;
  const inner = `<rect width="${W}" height="${H}" fill="${P.bg}"/>${deco}<g data-scenario="${id}">${unders.join('')}${parts.join('')}</g>`;
  let svg = svgDoc(W, H, inner, P.font);
  if (rtl) svg = rtlSvg(svg);
  return { svg, blocks: c.blocks, width: W, height: H, scenario: id };
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
