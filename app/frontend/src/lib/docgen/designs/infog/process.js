// REQ-574 / REQ-571: process diagrams for the infographic library. Each builder returns { svg, nodes } where nodes are the
// anchor points a concept uses to place its own labels. Every diagram root carries data-process="<kind>".
import { P, f1, chevron, arrow, curve, arcPath, head, hex, isoBlock } from './shapes.js';
import { iconDisc, icon } from './icons.js';
import { textBlock, keepShown, shows, slot, hasText } from './text.js';

// Linear N-step chevrons with an icon on each band; labels go under each chevron.
export function chevronSteps(x, y, w, h, steps0, colors, o = {}) {
  // A step whose label does not show under its chevron goes, chevron and icon too; the rest share the row. A step with no label is no step
  // (never a chevron and an icon with nothing under them); with no step left the row is empty.
  const tw = (n) => (w - 6 * (n - 1)) / n - 12; const lo = { size: o.size || 20, maxLines: o.maxLines || 4 };
  const steps = keepShown(steps0, (s, n) => !!s.label && shows(tw(n), s.label, lo));
  const n = steps.length; const gap = 6; const cw = (w - gap * (n - 1)) / Math.max(1, n); let svg = ''; const nodes = [];
  steps.forEach((s, i) => {
    const cx = x + i * (cw + gap); const isz = h * 0.5;
    const mark = chevron(cx, y, cw + (i < n - 1 ? h * 0.28 : 0), h, colors[i % colors.length], i === 0) + icon(s.icon, cx + cw / 2 - isz / 2 + (i ? h * 0.1 : 0), y + h / 2 - isz / 2, isz, '#fff', 2.1);
    nodes.push({ x: cx, cx: cx + cw / 2, y: y + h, w: cw });
    svg += slot(mark, textBlock(cx + 4, y + h + 16, cw - 12, s.label, { size: o.size || 20, color: o.ink || P.body, maxLines: o.maxLines || 4 }).svg);
  });
  return { svg: n ? `<g data-process="chevrons">${svg}</g>` : '', nodes };
}

// A cycle: n nodes on a ring joined by curved arrows; returns node centres and outward directions. o.text(i, node) gives each node's label
// (drawn where the concept wants it); a node goes with its label, so its icon never shows alone.
export function cycle(cx, cy, r, steps, colors, o = {}) {
  const n = steps.length; let svg = ''; const nodes = []; const nr = o.nodeR || 46; const a0 = o.start ?? -Math.PI / 2;
  const ang = (i) => a0 + (Math.PI * 2 * i) / n;
  for (let i = 0; i < n; i++) {
    const s = ang(i) + (nr + 14) / r; const e = ang(i + 1) - (nr + 20) / r; const col = colors[i % colors.length];
    svg += `<path d="${arcPath(cx, cy, r, s, e)}" fill="none" stroke="${col}" stroke-width="${o.w || 10}" stroke-linecap="round"/>`;
    const ex = cx + r * Math.cos(e); const ey = cy + r * Math.sin(e); svg += head(ex + Math.cos(e + Math.PI / 2) * 8, ey + Math.sin(e + Math.PI / 2) * 8, e + Math.PI / 2, 24, col);
  }
  steps.forEach((st, i) => { const a = ang(i); const x = cx + r * Math.cos(a); const y = cy + r * Math.sin(a); const col = colors[i % colors.length];
    const nd = { x, y, a, dx: Math.cos(a), dy: Math.sin(a), color: col }; nodes.push(nd);
    svg += slot(`<circle cx="${f1(x)}" cy="${f1(y)}" r="${nr + 8}" fill="#fff"/>` + iconDisc(st.icon, x, y, nr, col), o.text ? o.text(i, nd) : ''); });
  return { svg: `<g data-process="cycle">${svg}</g>`, nodes };
}

// Swimlanes: one row per role; steps sit in their lane and arrows relay between them.
export function swimlanes(x, y, w, laneH, lanes, steps, colors, o = {}) {
  let svg = ''; const lw = o.laneLabelW || 230; const nodes = [];
  lanes.forEach((ln, i) => { const ly = y + i * laneH; const col = colors[i % colors.length];
    svg += `<rect x="${x}" y="${ly}" width="${w}" height="${laneH - 8}" rx="18" fill="${col}" opacity="0.10"/><rect x="${x}" y="${ly}" width="10" height="${laneH - 8}" rx="5" fill="${col}"/>`;
    svg += icon(ln.icon, x + 24, ly + (laneH - 8) / 2 - 18, 36, col, 2) + textBlock(x + 70, ly + (laneH - 8) / 2 - 24, lw - 80, ln.name, { size: 21, weight: 700, color: P.ink, maxLines: 2 }).svg; });
  const sx = x + lw; const step = (w - lw - 40) / Math.max(1, steps.length - 1 || 1);
  steps.forEach((s, i) => { const nx = steps.length === 1 ? sx + (w - lw) / 2 : sx + 40 + i * step * ((w - lw - 120) / (w - lw - 40)); const ny = y + s.lane * laneH + (laneH - 8) / 2; nodes.push({ x: nx, y: ny, lane: s.lane }); });
  nodes.forEach((n, i) => { if (i) { const p = nodes[i - 1]; svg += curve([p.x + 40, p.y], [(p.x + n.x) / 2, p.y], [(p.x + n.x) / 2, n.y], [n.x - 42, n.y], P.grey, 4, { head: 16 }); } });
  steps.forEach((s, i) => { svg += iconDisc(s.icon, nodes[i].x, nodes[i].y, 34, colors[s.lane % colors.length]); });
  return { svg: `<g data-process="swimlanes">${svg}</g>`, nodes };
}

// A funnel of stacked trapezoids, wide to narrow, each with an icon at its left.
export function funnel(x, y, w, stageH, stages, colors, o = {}) {
  let svg = ''; const nodes = []; const n = stages.length; const minW = o.minW || w * 0.34; const gap = 10;
  stages.forEach((s, i) => { const top = w - ((w - minW) * i) / n; const bot = w - ((w - minW) * (i + 1)) / n; const yy = y + i * (stageH + gap); const cx = x + w / 2;
    svg += `<path d="M${f1(cx - top / 2)},${yy} L${f1(cx + top / 2)},${yy} L${f1(cx + bot / 2)},${yy + stageH} L${f1(cx - bot / 2)},${yy + stageH}Z" fill="${colors[i % colors.length]}"/>`;
    nodes.push({ cx, y: yy, h: stageH, top, bot, left: cx - bot / 2, right: cx + top / 2 }); });
  return { svg: `<g data-process="funnel">${svg}</g>`, nodes };
}

// A hub with spokes: a big centre disc, satellites on a ring joined by tapered spokes. o.centre is the centre's label and o.text(i, node) each
// satellite's (drawn where the concept wants it): a disc goes with its label, never alone.
export function hubSpokes(cx, cy, R, centreIcon, spokes, colors, o = {}) {
  const n = spokes.length; let svg = ''; const nodes = []; const a0 = o.start ?? -Math.PI / 2; const sr = o.spokeR || 40; const hr = o.hubR || 86; const span = o.span ?? Math.PI * 2;
  spokes.forEach((s, i) => { const a = span >= Math.PI * 2 - 0.01 ? a0 + (span * i) / n : a0 + (n === 1 ? span / 2 : (span * i) / (n - 1)); const x = cx + R * Math.cos(a); const y = cy + R * Math.sin(a); const col = colors[i % colors.length];
    svg += `<path d="M${f1(cx + Math.cos(a + Math.PI / 2) * 14)},${f1(cy + Math.sin(a + Math.PI / 2) * 14)} L${f1(x)},${f1(y)} L${f1(cx + Math.cos(a - Math.PI / 2) * 14)},${f1(cy + Math.sin(a - Math.PI / 2) * 14)}Z" fill="${col}" opacity="0.35"/>`;
    nodes.push({ x, y, a, color: col, icon: s.icon }); });
  svg += slot(`<circle cx="${cx}" cy="${cy}" r="${hr + 18}" fill="#fff" opacity="0.9"/>` + iconDisc(centreIcon, cx, cy, hr, o.hubColor || P.ink), o.centre || '');
  nodes.forEach((nd, i) => { svg += slot(`<circle cx="${f1(nd.x)}" cy="${f1(nd.y)}" r="${sr + 7}" fill="#fff"/>` + iconDisc(nd.icon, nd.x, nd.y, sr, nd.color), o.text ? o.text(i, nd) : ''); });
  return { svg: `<g data-process="hub">${svg}</g>`, nodes };
}

// A decision split: one input node forks into k outcome branches (curved), each ending on a hex with an icon. text(i, node) is each outcome's
// label: an outcome goes with its label, and the input (whose label is the outcomes it forks into) goes when no outcome is left.
export function decisionSplit(x, y, w, h, input, outs, colors, text = () => '') {
  let svg = ''; const nodes = []; const ix = x + 60; const iy = y + h / 2; const ox = x + w - 60;
  outs.forEach((o, i) => { const oy = y + (outs.length === 1 ? h / 2 : (h * (i + 0.5)) / outs.length); const col = colors[i % colors.length]; const nd = { x: ox, y: oy, color: col }; nodes.push(nd);
    svg += slot(curve([ix + 60, iy], [ix + (ox - ix) * 0.5, iy], [ix + (ox - ix) * 0.45, oy], [ox - 62, oy], col, 8, { head: 24 }) + hex(ox, oy, 54, col) + icon(o.icon, ox - 24, oy - 24, 48, '#fff', 2.2), text(i, nd)); });
  svg = hasText(svg) ? `<g data-slot="1">${svg}${hex(ix, iy, 62, P.ink)}${icon(input.icon, ix - 28, iy - 28, 56, '#fff', 2.2)}</g>` : '';
  return { svg: svg && `<g data-process="split">${svg}</g>`, nodes: [{ x: ix, y: iy }, ...nodes] };
}

// A vertical pipe of isometric blocks (data to decision), bottom to top, joined by arrows.
export function isoStack(cx, cy, steps, colors, o = {}) {
  let svg = ''; const nodes = []; const gap = o.gap || 150; const w = o.w || 92;
  steps.forEach((s, i) => { const y = cy - i * gap; const c = colors[i % colors.length];
    if (i) svg += arrow(cx, y + gap - 30, cx, y + 80, P.grey, 5, 18);
    svg += isoBlock(cx, y, w, 46, c, shade(c, -0.18), shade(c, -0.34)) + icon(s.icon, cx - 24, y - 24, 48, '#fff', 2.2); nodes.push({ x: cx, y }); });
  return { svg: `<g data-process="iso-stack">${svg}</g>`, nodes };
}

// Darken (k < 0) or lighten (k > 0) a hex colour.
export function shade(hexc, k) {
  const n = parseInt(hexc.slice(1), 16); const ch = [n >> 16, (n >> 8) & 255, n & 255].map((v) => Math.round(k < 0 ? v * (1 + k) : v + (255 - v) * k));
  return `#${ch.map((v) => v.toString(16).padStart(2, '0')).join('')}`;
}
