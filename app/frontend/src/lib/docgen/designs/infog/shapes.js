// REQ-574 / REQ-571: shapes for the infographic library: arrows, chevrons, curved connectors and ribbons, badges,
// callout bubbles, hexes, rings, isometric blocks and soft blobs. Each returns an SVG string.
import { FONT, esc, measure } from './text.js';

// The deck palette (template deck_helpers.py), reused by role, with pale tints.
export const P = {
  ink: '#14263A', body: '#2B3542', grey: '#6B7480', blue: '#2E6FE6', green: '#16A571', amber: '#E8900C', pink: '#E6117C',
  purple: '#7C3AED', cyan: '#0AA6C2', red: '#E0452C', lava: '#FF3621', white: '#FFFFFF', panel: '#F4F5F7', panel2: '#ECEFF3',
};
export const TINT = { [P.blue]: '#EAF0FE', [P.green]: '#E7F6EF', [P.amber]: '#FDF1DE', [P.pink]: '#FCE7F2', [P.purple]: '#F1EBFD', [P.cyan]: '#E6F6F9', [P.lava]: '#FFE7E3', [P.red]: '#FCE9E5', [P.grey]: '#EEF0F2', [P.ink]: '#E9ECF1' };
export const tint = (c) => TINT[c] || '#F4F5F7';
export const f1 = (n) => Number(n).toFixed(1);

// A linear gradient definition; use fill="url(#id)".
export const grad = (id, a, b, o = {}) => `<linearGradient id="${id}" x1="${o.x1 ?? 0}" y1="${o.y1 ?? 0}" x2="${o.x2 ?? 1}" y2="${o.y2 ?? 0}"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>`;
export const radial = (id, a, b) => `<radialGradient id="${id}" cx="0.5" cy="0.5" r="0.5"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></radialGradient>`;
export const shadow = (id = 'sh') => `<filter id="${id}" x="-20%" y="-20%" width="140%" height="150%"><feDropShadow dx="0" dy="6" stdDeviation="8" flood-color="#14263A" flood-opacity="0.16"/></filter>`;

// An arrowhead at (x, y) pointing along angle a (radians).
export function head(x, y, a, size, color) {
  const p = (d, r) => `${f1(x + Math.cos(a + d) * r)},${f1(y + Math.sin(a + d) * r)}`;
  return `<path d="M${f1(x)},${f1(y)} L${p(Math.PI * 0.84, size)} L${p(Math.PI, size * 0.55)} L${p(-Math.PI * 0.84, size)}Z" fill="${color}"/>`;
}

// A straight arrow.
export function arrow(x1, y1, x2, y2, color, w = 4, hs = 16) {
  const a = Math.atan2(y2 - y1, x2 - x1); const ex = x2 - Math.cos(a) * hs * 0.6; const ey = y2 - Math.sin(a) * hs * 0.6;
  return `<g data-shape="arrow"><path d="M${f1(x1)},${f1(y1)} L${f1(ex)},${f1(ey)}" stroke="${color}" stroke-width="${w}" stroke-linecap="round" fill="none"/>${head(x2, y2, a, hs, color)}</g>`;
}

// A cubic curved connector from p0 to p3 with controls c1, c2, ending in an arrowhead.
export function curve(p0, c1, c2, p3, color, w = 4, o = {}) {
  const a = Math.atan2(p3[1] - c2[1], p3[0] - c2[0]); const hs = o.head ?? 16;
  const d = `M${p0.map(f1)} C${c1.map(f1)} ${c2.map(f1)} ${p3.map(f1)}`;
  return `<g data-shape="curve"><path d="${d}" stroke="${color}" stroke-width="${w}" fill="none" stroke-linecap="round"${o.dash ? ` stroke-dasharray="${o.dash}"` : ''}/>${hs ? head(p3[0] + Math.cos(a) * 2, p3[1] + Math.sin(a) * 2, a, hs, color) : ''}</g>`;
}

// A thick flowing ribbon along a path d (the "road" or "river" that ties a story together).
export function ribbon(d, width, paint, o = {}) {
  return `<g data-shape="ribbon">${o.edge ? `<path d="${d}" stroke="${o.edge}" stroke-width="${width + 10}" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` : ''}<path d="${d}" stroke="${paint}" stroke-width="${width}" fill="none" stroke-linecap="round" stroke-linejoin="round" opacity="${o.opacity ?? 1}"/>${o.dash ? `<path d="${d}" stroke="${o.dashColor || '#fff'}" stroke-width="4" fill="none" stroke-dasharray="${o.dash}" stroke-linecap="round"/>` : ''}</g>`;
}

// A chevron (arrow-shaped band); first has a flat left edge.
export function chevron(x, y, w, h, fill, first = false, notch = 0.28) {
  const n = h * notch;
  const pts = first ? [[x, y], [x + w - n, y], [x + w, y + h / 2], [x + w - n, y + h], [x, y + h]] : [[x, y], [x + w - n, y], [x + w, y + h / 2], [x + w - n, y + h], [x, y + h], [x + n, y + h / 2]];
  return `<polygon data-shape="chevron" points="${pts.map((p) => p.map(f1).join(',')).join(' ')}" fill="${fill}"/>`;
}

// A numbered badge.
export function badge(cx, cy, r, text, fill, ink = '#fff') {
  return `<g data-shape="badge"><circle cx="${cx}" cy="${cy}" r="${r}" fill="${fill}" stroke="#fff" stroke-width="3"/><text x="${cx}" y="${f1(cy + r * 0.36)}" font-family="${FONT}" font-size="${Math.max(20, Math.round(r))}" font-weight="700" fill="${ink}" text-anchor="middle">${esc(text)}</text></g>`;
}

// A speech / callout bubble with a tail pointing to (tx, ty).
export function callout(x, y, w, h, tx, ty, fill, o = {}) {
  const r = o.r ?? 18; const bx = Math.max(x + r + 10, Math.min(x + w - r - 40, tx - 18));
  const below = ty > y + h; const above = ty < y;
  let d = `M${x + r},${y}`;
  if (above) d += ` L${bx},${y} L${tx},${ty} L${bx + 36},${y}`;
  d += ` L${x + w - r},${y} Q${x + w},${y} ${x + w},${y + r} L${x + w},${y + h - r} Q${x + w},${y + h} ${x + w - r},${y + h}`;
  if (below) d += ` L${bx + 36},${y + h} L${tx},${ty} L${bx},${y + h}`;
  d += ` L${x + r},${y + h} Q${x},${y + h} ${x},${y + h - r} L${x},${y + r} Q${x},${y} ${x + r},${y}Z`;
  return `<path data-shape="callout" d="${d}" fill="${fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="2"` : ''}${o.filter ? ` filter="url(#${o.filter})"` : ''}/>`;
}

export function hexPoints(cx, cy, r) { return Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 3 * i + Math.PI / 6; return `${f1(cx + r * Math.cos(a))},${f1(cy + r * Math.sin(a))}`; }).join(' '); }
export const hex = (cx, cy, r, fill, o = {}) => `<polygon data-shape="hex" points="${hexPoints(cx, cy, r)}" fill="${fill}"${o.stroke ? ` stroke="${o.stroke}" stroke-width="${o.sw || 3}"` : ''}/>`;

// An arc from angle a0 to a1 (radians, 0 = 3 o'clock, clockwise).
export function arcPath(cx, cy, r, a0, a1) {
  const p = (a) => `${f1(cx + r * Math.cos(a))},${f1(cy + r * Math.sin(a))}`; const large = Math.abs(a1 - a0) > Math.PI ? 1 : 0;
  return `M${p(a0)} A${r},${r} 0 ${large} 1 ${p(a1)}`;
}
// A progress ring: frac of the circle in color over a pale track.
export function ring(cx, cy, r, w, frac, color, track = '#ECEFF3') {
  const a0 = -Math.PI / 2; const a1 = a0 + Math.PI * 2 * Math.min(0.9999, Math.max(0.001, frac));
  return `<g data-shape="ring"><circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="${track}" stroke-width="${w}"/><path d="${arcPath(cx, cy, r, a0, a1)}" fill="none" stroke="${color}" stroke-width="${w}" stroke-linecap="round"/></g>`;
}

// An isometric block centred at (cx, cy) on its top face; w = half-width, h = height.
export function isoBlock(cx, cy, w, h, top, left, right) {
  const d = w * 0.58;
  return `<g data-shape="iso"><path d="M${cx},${cy - d} L${cx + w},${cy} L${cx},${cy + d} L${cx - w},${cy}Z" fill="${top}"/><path d="M${cx - w},${cy} L${cx},${cy + d} L${cx},${cy + d + h} L${cx - w},${cy + h}Z" fill="${left}"/><path d="M${cx + w},${cy} L${cx},${cy + d} L${cx},${cy + d + h} L${cx + w},${cy + h}Z" fill="${right}"/></g>`;
}
// An isometric flat tile (the floor of a scene).
export const isoTile = (cx, cy, w, fill) => `<path data-shape="iso-tile" d="M${cx},${cy - w * 0.58} L${cx + w},${cy} L${cx},${cy + w * 0.58} L${cx - w},${cy}Z" fill="${fill}"/>`;

// A soft organic blob for backgrounds (deterministic from seed).
export function blob(cx, cy, rx, ry, fill, seed = 1, o = {}) {
  const n = 8; const pts = Array.from({ length: n }, (_, i) => { const a = (Math.PI * 2 * i) / n; const k = 0.86 + 0.22 * Math.abs(Math.sin(seed * 12.9898 + i * 78.233)); return [cx + Math.cos(a) * rx * k, cy + Math.sin(a) * ry * k]; });
  let d = ''; for (let i = 0; i < n; i++) { const p0 = pts[(i - 1 + n) % n], p1 = pts[i], p2 = pts[(i + 1) % n], p3 = pts[(i + 2) % n];
    if (!i) d += `M${f1(p1[0])},${f1(p1[1])}`;
    d += ` C${f1(p1[0] + (p2[0] - p0[0]) / 6)},${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)},${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])},${f1(p2[1])}`; }
  return `<path data-shape="blob" d="${d}Z" fill="${fill}" opacity="${o.opacity ?? 1}"/>`;
}

// A rounded pill with text, for tags like the kind of analysis.
export function pill(x, y, text, fill, ink = '#fff', size = 20) {
  const w = Math.round(measure(text, size, 700) + size * 1.4);
  return { svg: `<g data-shape="pill"><rect x="${x}" y="${y}" width="${w}" height="${size * 1.7}" rx="${size * 0.85}" fill="${fill}"/><text x="${x + w / 2}" y="${f1(y + size * 1.17)}" font-family="${FONT}" font-size="${size}" font-weight="700" fill="${ink}" text-anchor="middle">${esc(text)}</text></g>`, w, h: size * 1.7 };
}
