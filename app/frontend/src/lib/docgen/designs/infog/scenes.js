// REQ-574 / REQ-571: small drawn scenes made of generic shapes (no text): a dashboard screen, a data stack, people and a team,
// a document, a calendar, a map pin field and a network constellation. Industry-agnostic by design.
import { P, f1, blob, isoBlock, isoTile, tint } from './shapes.js';
import { shade } from './process.js';

// A monitor with a dashboard: header, KPI tiles, bars, a line and a donut.
export function dashboardScreen(x, y, w, h, colors = [P.blue, P.green, P.amber, P.pink], o = {}) {
  const b = 14; const sx = x + b; const sy = y + b; const sw = w - 2 * b; const sh = h - 2 * b - 10; let s = '';
  s += `<rect x="${x}" y="${y}" width="${w}" height="${h - 10}" rx="18" fill="${P.ink}"/><rect x="${sx}" y="${sy}" width="${sw}" height="${sh}" rx="8" fill="#fff"/>`;
  if (o.stand !== false) s += `<path d="M${f1(x + w / 2 - 26)},${y + h - 10} L${f1(x + w / 2 + 26)},${y + h - 10} L${f1(x + w / 2 + 40)},${y + h + 26} L${f1(x + w / 2 - 40)},${y + h + 26}Z" fill="${shade(P.ink, 0.25)}"/><rect x="${f1(x + w / 2 - 80)}" y="${y + h + 22}" width="160" height="10" rx="5" fill="${P.ink}"/>`;
  s += `<rect x="${sx}" y="${sy}" width="${sw}" height="${f1(sh * 0.12)}" rx="8" fill="${P.panel2}"/>`;
  [0, 1, 2].forEach((i) => { s += `<circle cx="${f1(sx + 16 + i * 16)}" cy="${f1(sy + sh * 0.06)}" r="4.5" fill="${colors[i]}"/>`; });
  const ty = sy + sh * 0.18; const tw = (sw - 40) / 3;
  [0, 1, 2].forEach((i) => { const tx = sx + 10 + i * (tw + 10); s += `<rect x="${f1(tx)}" y="${f1(ty)}" width="${f1(tw)}" height="${f1(sh * 0.18)}" rx="6" fill="${tint(colors[i])}"/><rect x="${f1(tx + 10)}" y="${f1(ty + sh * 0.05)}" width="${f1(tw * 0.5)}" height="${f1(sh * 0.07)}" rx="3" fill="${colors[i]}"/>`; });
  const cy = sy + sh * 0.44; const ch = sh * 0.5; const bw = sw * 0.5;
  const hs = o.bars || [0.4, 0.62, 0.5, 0.8, 0.7, 0.95];
  hs.forEach((v, i) => { const bx = sx + 14 + i * (bw / hs.length); s += `<rect x="${f1(bx)}" y="${f1(cy + ch * (1 - v))}" width="${f1(bw / hs.length - 8)}" height="${f1(ch * v - 6)}" rx="3" fill="${colors[i % 2 ? 1 : 0]}"/>`; });
  const dx = sx + sw * 0.78; const dy = cy + ch * 0.48; const dr = Math.min(sw * 0.15, ch * 0.4);
  s += `<circle cx="${f1(dx)}" cy="${f1(dy)}" r="${f1(dr)}" fill="none" stroke="${P.panel2}" stroke-width="${f1(dr * 0.45)}"/><circle cx="${f1(dx)}" cy="${f1(dy)}" r="${f1(dr)}" fill="none" stroke="${colors[2]}" stroke-width="${f1(dr * 0.45)}" stroke-dasharray="${f1(dr * 4)} ${f1(dr * 7)}" transform="rotate(-90 ${f1(dx)} ${f1(dy)})"/>`;
  s += `<path d="M${f1(sx + 14)},${f1(cy + ch * 0.3)} C${f1(sx + bw * 0.4)},${f1(cy)} ${f1(sx + bw * 0.6)},${f1(cy + ch * 0.4)} ${f1(sx + bw)},${f1(cy + 4)}" stroke="${colors[3]}" stroke-width="4" fill="none" stroke-linecap="round"/>`;
  return `<g data-scene="dashboard">${s}</g>`;
}

// A data stack: three isometric slabs (sources becoming one governed store).
export function dataStack(cx, cy, w, colors = [P.cyan, P.blue, P.purple]) {
  let s = isoTile(cx, cy + 92, w * 1.35, P.panel2);
  colors.forEach((c, i) => { s += isoBlock(cx, cy + 40 - i * 44, w, 28, shade(c, 0.15), shade(c, -0.12), shade(c, -0.3)); });
  s += `<circle cx="${cx - w * 0.3}" cy="${cy - 48}" r="5" fill="#fff" opacity="0.8"/><circle cx="${cx}" cy="${cy - 48 + 10}" r="5" fill="#fff" opacity="0.8"/><circle cx="${cx + w * 0.3}" cy="${cy - 48}" r="5" fill="#fff" opacity="0.8"/>`;
  return `<g data-scene="data-stack">${s}</g>`;
}

// One person standing (feet at fy), height ph.
export function person(cx, fy, ph, color, o = {}) {
  const hr = ph * 0.13; const bw = ph * 0.36; const top = fy - ph; let s = '';
  s += `<circle cx="${f1(cx)}" cy="${f1(top + hr)}" r="${f1(hr)}" fill="${o.skin || '#F2C9A5'}"/>`;
  s += `<path d="M${f1(cx - hr * 1.05)},${f1(top + hr * 0.7)} A${f1(hr * 1.05)},${f1(hr * 1.05)} 0 0 1 ${f1(cx + hr * 1.05)},${f1(top + hr * 0.7)} Z" fill="${o.hair || P.ink}"/>`;
  s += `<path d="M${f1(cx - bw / 2)},${f1(fy - ph * 0.36)} Q${f1(cx - bw / 2)},${f1(top + hr * 2.3)} ${f1(cx)},${f1(top + hr * 2.3)} Q${f1(cx + bw / 2)},${f1(top + hr * 2.3)} ${f1(cx + bw / 2)},${f1(fy - ph * 0.36)} Z" fill="${color}"/>`;
  s += `<rect x="${f1(cx - bw * 0.4)}" y="${f1(fy - ph * 0.38)}" width="${f1(bw * 0.34)}" height="${f1(ph * 0.38)}" rx="${f1(bw * 0.1)}" fill="${o.legs || P.ink}"/><rect x="${f1(cx + bw * 0.06)}" y="${f1(fy - ph * 0.38)}" width="${f1(bw * 0.34)}" height="${f1(ph * 0.38)}" rx="${f1(bw * 0.1)}" fill="${o.legs || P.ink}"/>`;
  if (o.laptop) s += `<rect x="${f1(cx - bw * 0.55)}" y="${f1(fy - ph * 0.5)}" width="${f1(bw * 1.1)}" height="${f1(ph * 0.08)}" rx="3" fill="${P.grey}"/>`;
  return `<g data-scene="person">${s}</g>`;
}

// A team: n people side by side, the middle one taller.
export function team(cx, fy, ph, colors, n = 3) {
  let s = ''; const gap = ph * 0.42; const skins = ['#F2C9A5', '#C98E63', '#8D5B3E', '#E8B48C'];
  for (let i = 0; i < n; i++) { const off = i - (n - 1) / 2; const mid = Math.abs(off) < 0.6; s += person(cx + off * gap, fy, mid ? ph : ph * 0.88, colors[i % colors.length], { skin: skins[i % skins.length], hair: i % 2 ? '#3B2A20' : P.ink }); }
  return `<g data-scene="team">${s}</g>`;
}

// A document with a folded corner, text lines and a little chart.
export function documentSheet(x, y, w, h, color = P.blue) {
  const fold = w * 0.22; let s = `<path d="M${x},${y} L${x + w - fold},${y} L${x + w},${y + fold} L${x + w},${y + h} L${x},${y + h}Z" fill="#fff" stroke="${P.panel2}" stroke-width="3"/><path d="M${x + w - fold},${y} L${x + w - fold},${y + fold} L${x + w},${y + fold}Z" fill="${tint(color)}"/>`;
  s += `<rect x="${f1(x + w * 0.12)}" y="${f1(y + h * 0.12)}" width="${f1(w * 0.5)}" height="${f1(h * 0.06)}" rx="3" fill="${color}"/>`;
  [0.26, 0.34, 0.42].forEach((k, i) => { s += `<rect x="${f1(x + w * 0.12)}" y="${f1(y + h * k)}" width="${f1(w * (i === 2 ? 0.5 : 0.76))}" height="${f1(h * 0.035)}" rx="2" fill="${P.panel2}"/>`; });
  [0.35, 0.6, 0.45, 0.8].forEach((v, i) => { s += `<rect x="${f1(x + w * (0.14 + i * 0.18))}" y="${f1(y + h * (0.9 - 0.34 * v))}" width="${f1(w * 0.12)}" height="${f1(h * 0.34 * v)}" rx="2" fill="${i === 3 ? color : tint(color)}"/>`; });
  return `<g data-scene="document">${s}</g>`;
}

// A calendar page; `marks` are cell indexes (0..27) filled in color.
export function calendarSheet(x, y, w, h, color = P.amber, marks = []) {
  let s = `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="14" fill="#fff" stroke="${P.panel2}" stroke-width="3"/><path d="M${x},${y + 14} Q${x},${y} ${x + 14},${y} L${x + w - 14},${y} Q${x + w},${y} ${x + w},${y + 14} L${x + w},${y + h * 0.2} L${x},${y + h * 0.2}Z" fill="${color}"/>`;
  s += `<rect x="${f1(x + w * 0.25)}" y="${y - 10}" width="8" height="24" rx="4" fill="${P.ink}"/><rect x="${f1(x + w * 0.75 - 8)}" y="${y - 10}" width="8" height="24" rx="4" fill="${P.ink}"/>`;
  const cw = (w - 24) / 7; const chh = (h * 0.8 - 20) / 4;
  for (let i = 0; i < 28; i++) { const c = i % 7; const r = Math.floor(i / 7); s += `<rect x="${f1(x + 12 + c * cw + 3)}" y="${f1(y + h * 0.2 + 10 + r * chh + 3)}" width="${f1(cw - 6)}" height="${f1(chh - 6)}" rx="4" fill="${marks.includes(i) ? color : P.panel}"/>`; }
  return `<g data-scene="calendar">${s}</g>`;
}

// A map: a pale land panel with soft regions, roads and a river; pins at fractional positions [fx, fy, color, size].
export function mapField(x, y, w, h, pins = [], o = {}) {
  let s = `<clipPath id="${o.id || 'mapclip'}"><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="28"/></clipPath><g clip-path="url(#${o.id || 'mapclip'})"><rect x="${x}" y="${y}" width="${w}" height="${h}" fill="#EAF4EE"/>`;
  s += blob(x + w * 0.25, y + h * 0.3, w * 0.28, h * 0.22, '#DCEFE3', 3) + blob(x + w * 0.75, y + h * 0.7, w * 0.3, h * 0.26, '#DCEFE3', 7) + blob(x + w * 0.8, y + h * 0.18, w * 0.16, h * 0.12, '#D3E9F7', 5);
  s += `<path d="M${x - 10},${f1(y + h * 0.62)} C${f1(x + w * 0.3)},${f1(y + h * 0.5)} ${f1(x + w * 0.45)},${f1(y + h * 0.9)} ${x + w + 10},${f1(y + h * 0.78)}" stroke="#BFE0F2" stroke-width="26" fill="none"/>`;
  [[0.1, 0, 0.3, 1], [0.62, 0, 0.5, 1], [0, 0.35, 1, 0.28], [0, 0.88, 1, 0.95]].forEach(([a, b, c, d]) => { s += `<path d="M${f1(x + w * a)},${f1(y + h * b)} L${f1(x + w * c)},${f1(y + h * d)}" stroke="#fff" stroke-width="10" stroke-linecap="round"/>`; });
  s += '</g>';
  const pos = pins.map(([fx, fy, col, sz = 1]) => { const px = x + w * fx; const py = y + h * fy; const r = 18 * sz;
    s += `<ellipse cx="${f1(px)}" cy="${f1(py + 4)}" rx="${f1(r * 0.8)}" ry="${f1(r * 0.28)}" fill="#14263A" opacity="0.18"/><path d="M${f1(px)},${f1(py)} C${f1(px - r * 0.9)},${f1(py - r * 1.3)} ${f1(px - r * 1.1)},${f1(py - r * 2.6)} ${f1(px)},${f1(py - r * 2.7)} C${f1(px + r * 1.1)},${f1(py - r * 2.6)} ${f1(px + r * 0.9)},${f1(py - r * 1.3)} ${f1(px)},${f1(py)}Z" fill="${col}"/><circle cx="${f1(px)}" cy="${f1(py - r * 1.8)}" r="${f1(r * 0.38)}" fill="#fff"/>`;
    return { x: px, y: py, top: py - r * 2.7 }; });
  return { svg: `<g data-scene="map">${s}</g>`, pins: pos };
}

// A network constellation: clusters of nodes with links; `clusters` = [{ cx, cy, r, n, color, hot }].
export function constellation(clusters, o = {}) {
  let links = ''; let dots = ''; const all = [];
  clusters.forEach((c, k) => { const pts = Array.from({ length: c.n }, (_, i) => { const a = (Math.PI * 2 * i) / c.n + k; const rr = c.r * (0.45 + 0.55 * Math.abs(Math.sin(i * 2.3 + k))); return [c.cx + Math.cos(a) * rr, c.cy + Math.sin(a) * rr]; });
    pts.forEach((p, i) => { pts.forEach((q, j) => { if (j > i && (j - i <= 2 || c.hot)) links += `<path d="M${f1(p[0])},${f1(p[1])} L${f1(q[0])},${f1(q[1])}" stroke="${c.color}" stroke-width="${c.hot ? 2.5 : 2}" opacity="${c.hot ? 0.7 : 0.35}"/>`; }); });
    if (c.hot) links += `<circle cx="${f1(c.cx)}" cy="${f1(c.cy)}" r="${f1(c.r * 1.25)}" fill="${c.color}" opacity="0.10"/><circle cx="${f1(c.cx)}" cy="${f1(c.cy)}" r="${f1(c.r * 1.25)}" fill="none" stroke="${c.color}" stroke-width="2.5" stroke-dasharray="8 7"/>`;
    pts.forEach((p) => { dots += `<circle cx="${f1(p[0])}" cy="${f1(p[1])}" r="${c.hot ? 11 : 8}" fill="${c.hot ? c.color : '#fff'}" stroke="${c.color}" stroke-width="3"/>`; });
    all.push(pts); });
  if (o.bridges) o.bridges.forEach(([a, b]) => { const p = all[a][0]; const q = all[b][1]; links += `<path d="M${f1(p[0])},${f1(p[1])} L${f1(q[0])},${f1(q[1])}" stroke="${P.grey}" stroke-width="2" stroke-dasharray="4 6" opacity="0.6"/>`; });
  return `<g data-scene="network">${links}${dots}</g>`;
}
