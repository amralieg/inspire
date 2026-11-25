// REQ-526 (ported from the design study): shared helpers every style uses (escape, text with a contrast log, money format, icons, chart geometry).
// Pure ES module, no dependency. Ports to app/frontend/src/lib/docgen/docSvg.js as is (icons come from lucide-react's __iconNode).
import { ICONS } from './icons.js';

export { ICONS };

export const DISCLAIMER = 'Estimated or calculated value, not a promised value. Databricks does not promise or guarantee this number. Specialist business value teams in your organization must validate every number before it is shared or used in a decision.';

export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// ---------- money, same rule as the App (targetKpi.stakeShort + valueLedger 20M+ cap) ----------
const SYMBOLS = { USD: '$', EUR: '€', GBP: '£', AED: 'AED ', SAR: 'SAR ' };
function compactNumber(n) {
  const a = Math.abs(n); const sign = n < 0 ? '-' : '';
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(2).replace(/\.?0+$/, '')}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(2).replace(/\.?0+$/, '')}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(1).replace(/\.0$/, '')}K`;
  return `${sign}${a % 1 ? a.toFixed(2) : String(a)}`;
}
export const money = (n, cur = 'USD') => (n >= 2e7 ? `${SYMBOLS[cur] || ''}20M+` : `${SYMBOLS[cur] || ''}${compactNumber(n)}`);
export const moneyYear = (n, cur) => `${money(n, cur)} a year`;

// ---------- colour + contrast ----------
const lin = (c) => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
export function lum(hex) { const h = hex.replace('#', ''); const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16)); return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b); }
export function contrast(a, b) { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); }
export const bestInk = (bg, dark = '#111111', light = '#FFFFFF') => (contrast(bg, dark) >= contrast(bg, light) ? dark : light);
export function mix(a, b, t) {
  const p = (h) => [0, 2, 4].map((i) => parseInt(h.replace('#', '').slice(i, i + 2), 16));
  const [x, y] = [p(a), p(b)];
  return `#${x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
}

// Every text drawn through T() logs (fill, background, size) so the build can prove contrast >= 4.5:1 and size >= 12px (9pt at A4 print size).
export const LOG = [];
export function resetLog() { LOG.length = 0; }

// Width estimate per character (em) for wrapping; conservative so text never overflows its box.
const EM = { sans: 0.56, serif: 0.54, cond: 0.5 };
export const textW = (s, size, kind = 'sans', weight = 400) => String(s).length * size * (EM[kind] || 0.56) * (weight >= 700 ? 1.06 : 1);
// Tighter estimate for placing a run right after another one (not for wrapping).
export const runW = (s, size, weight = 400, ls = 0, caps = false) => String(s).length * (size * (caps ? 0.62 : 0.5) * (weight >= 700 ? 1.05 : 1) + ls);

export function wrap(text, maxW, size, kind = 'sans', weight = 400, maxLines = 99) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    const next = cur ? `${cur} ${w}` : w;
    if (cur && textW(next, size, kind, weight) > maxW) { lines.push(cur); cur = w; } else cur = next;
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) {
    lines.length = maxLines;
    let last = lines[maxLines - 1];
    while (last.length > 1 && textW(`${last}…`, size, kind, weight) > maxW) last = last.slice(0, -1);
    lines[maxLines - 1] = `${last.replace(/[\s,.;:]+$/, '')}…`;
  }
  return lines;
}

// T(x, y, text, opts): opts = { size, weight, fill, bg (the colour behind the text, required for the contrast log), font, kind, anchor,
// maxW, lines, lh, ls (letter-spacing), caps, italic, ctx (label for the log) }.
export function T(x, y, text, o = {}) {
  const size = o.size || 14; const weight = o.weight || 400; const kind = o.kind || 'sans';
  let s = String(text ?? ''); if (o.caps) s = s.toUpperCase();
  const parts = o.maxW ? wrap(s, o.maxW, size * (o.caps ? 1.08 : 1), kind, weight, o.lines || 99) : [s];
  const lh = o.lh || size * 1.3;
  if (o.bg) LOG.push({ fill: o.fill, bg: o.bg, size, weight, text: s.slice(0, 40), ctx: o.ctx || '' });
  const spans = parts.map((p, i) => `<tspan x="${x}" dy="${i ? lh : 0}">${esc(p)}</tspan>`).join('');
  const attrs = [`x="${x}"`, `y="${y}"`, `font-size="${size}"`, `font-weight="${weight}"`, `fill="${o.fill}"`];
  if (o.font) attrs.push(`font-family="${esc(o.font)}"`);
  if (o.anchor) attrs.push(`text-anchor="${o.anchor}"`);
  if (o.ls) attrs.push(`letter-spacing="${o.ls}"`);
  if (o.italic) attrs.push('font-style="italic"');
  if (o.opacity) attrs.push(`fill-opacity="${o.opacity}"`);
  if (o.halo) attrs.push(`stroke="${o.halo}" stroke-width="4" stroke-linejoin="round" paint-order="stroke"`);
  return { svg: `<text ${attrs.join(' ')}>${spans}</text>`, lines: parts.length, h: parts.length * lh };
}
export const t = (...a) => T(...a).svg;

// ---------- icons: industry-agnostic rule from the domain or use-case name ----------
const ICON_RULES = [
  [/sales|revenue|commercial|growth|upsell|monetiz/i, 'trending-up'],
  [/pric|discount|margin|promo/i, 'tag'],
  [/customer|client|member|patient|guest|cohort|audience|subscriber|people|user/i, 'users'],
  [/product|menu|catalog|item|assortment|offer/i, 'package'],
  [/franchise|store|branch|site|location|outlet|retail/i, 'store'],
  [/partner|alliance|vendor|supplier/i, 'handshake'],
  [/complaint|issue|ticket|incident|support|claim/i, 'message-square-warning'],
  [/sentiment|review|feedback|experience|satisf/i, 'smile'],
  [/advocacy|loyal|referral|retention|churn/i, 'heart'],
  [/trend|forecast|demand|insight|analytic|signal/i, 'chart-line'],
  [/moderation|compliance|policy|governance|regulat|audit/i, 'shield-check'],
  [/risk|fraud|security|threat|safety/i, 'shield-alert'],
  [/fleet|logistic|transport|delivery|shipping|route|trip/i, 'truck'],
  [/inventory|stock|warehouse|supply/i, 'boxes'],
  [/quality|accuracy|defect/i, 'badge-check'],
  [/financ|cost|budget|billing|payment|spend/i, 'wallet'],
  [/return|refund|reverse/i, 'undo-2'],
  [/marketing|campaign|brand|media/i, 'megaphone'],
  [/operation|production|process|efficien|maintenance/i, 'cog'],
  [/hr|talent|workforce|staff|employee/i, 'user-cog'],
  [/energy|esg|sustain|carbon/i, 'leaf'],
  [/innovat|new|launch/i, 'rocket'],
];
const ICON_FALLBACK = ['layers', 'compass', 'target', 'sparkles', 'workflow', 'gauge'];
export function iconName(name) {
  for (const [re, n] of ICON_RULES) if (re.test(name || '')) return n;
  let h = 0; for (const c of String(name || '')) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return ICON_FALLBACK[h % ICON_FALLBACK.length];
}
// A 24x24 lucide icon drawn at (x, y) with size s, stroke colour c.
export function icon(name, x, y, s, c, sw = 2) {
  const nodes = ICONS[name] || ICONS.layers;
  const body = nodes.map(([tag, a]) => `<${tag} ${Object.entries(a).filter(([k]) => k !== 'key').map(([k, v]) => `${k}="${esc(v)}"`).join(' ')}/>`).join('');
  return `<g transform="translate(${x} ${y}) scale(${s / 24})" fill="none" stroke="${c}" stroke-width="${sw}" stroke-linecap="round" stroke-linejoin="round">${body}</g>`;
}
// The App's ten business priorities (LaunchPage BUSINESS_PRIORITIES) and their icons.
export const VERB_ICON = { 'Increase Revenue': 'trending-up', 'Reduce Cost': 'dollar-sign', 'Optimize Operations': 'cog', 'Mitigate Risk': 'shield',
  'Empower Talent': 'users', 'Enhance Experience': 'star', 'Drive Innovation': 'rocket', 'Achieve ESG': 'leaf', 'Protect Revenue': 'lock', 'Execute Strategy': 'crosshair',
  'GROW REVENUE': 'trending-up', 'CUT COST': 'dollar-sign', 'AVOID RISK': 'shield', 'SAVE TIME': 'gauge' };

// ---------- geometry ----------
export const rect = (x, y, w, h, fill, o = {}) => `<rect x="${x}" y="${y}" width="${Math.max(0, w)}" height="${Math.max(0, h)}"${o.rx ? ` rx="${o.rx}"` : ''} fill="${fill}"${o.op != null ? ` fill-opacity="${o.op}"` : ''}${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw || 1}"` : ''}${o.extra || ''}/>`;
export const line = (x1, y1, x2, y2, c, w = 1, o = {}) => `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="${c}" stroke-width="${w}"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}${o.op != null ? ` stroke-opacity="${o.op}"` : ''}/>`;
export const circle = (cx, cy, r, fill, o = {}) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}"${o.op != null ? ` fill-opacity="${o.op}"` : ''}${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw || 1}"${o.sop != null ? ` stroke-opacity="${o.sop}"` : ''}` : ''}/>`;

// Donut arc path from angle a0 to a1 (radians, 0 = 12 o'clock, clockwise).
export function arc(cx, cy, r0, r1, a0, a1) {
  const p = (r, a) => [cx + r * Math.sin(a), cy - r * Math.cos(a)];
  const big = a1 - a0 > Math.PI ? 1 : 0;
  const [x0, y0] = p(r1, a0); const [x1, y1] = p(r1, a1); const [x2, y2] = p(r0, a1); const [x3, y3] = p(r0, a0);
  return `M${x0.toFixed(2)} ${y0.toFixed(2)}A${r1} ${r1} 0 ${big} 1 ${x1.toFixed(2)} ${y1.toFixed(2)}L${x2.toFixed(2)} ${y2.toFixed(2)}A${r0} ${r0} 0 ${big} 0 ${x3.toFixed(2)} ${y3.toFixed(2)}Z`;
}

// Squarified treemap: items [{value, ...}] into box {x, y, w, h}; returns items with x, y, w, h.
export function treemap(items, box) {
  const total = items.reduce((s, i) => s + i.value, 0) || 1;
  const scale = (box.w * box.h) / total;
  const nodes = [...items].sort((a, b) => b.value - a.value).map((i) => ({ ...i, area: i.value * scale }));
  const out = []; let { x, y, w, h } = box; let row = [];
  const worst = (r, side) => { const s = r.reduce((a, n) => a + n.area, 0); const mx = Math.max(...r.map((n) => n.area)); const mn = Math.min(...r.map((n) => n.area)); return Math.max((side * side * mx) / (s * s), (s * s) / (side * side * mn)); };
  const layout = (r) => {
    const s = r.reduce((a, n) => a + n.area, 0);
    if (w >= h) { const cw = s / h; let cy = y; r.forEach((n) => { const nh = n.area / cw; out.push({ ...n, x, y: cy, w: cw, h: nh }); cy += nh; }); x += cw; w -= cw; }
    else { const rh = s / w; let cx = x; r.forEach((n) => { const nw = n.area / rh; out.push({ ...n, x: cx, y, w: nw, h: rh }); cx += nw; }); y += rh; h -= rh; }
  };
  for (const n of nodes) {
    const side = Math.min(w, h);
    if (!row.length || worst([...row, n], side) <= worst(row, side)) row.push(n); else { layout(row); row = [n]; }
  }
  if (row.length) layout(row);
  return out;
}

export const svgDoc = (W, H, body, font, extraDefs = '') => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(font)}"><defs>${extraDefs}</defs>${body}</svg>`;
