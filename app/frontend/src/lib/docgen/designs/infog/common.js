// REQ-574 / REQ-571: the frame and the recurring parts every infographic concept uses (title, hero number, who uses it).
import { P, grad, shadow, pill, f1 } from './shapes.js';
import { textBlock, label, esc, FONT, measure } from './text.js';
import { icon } from './icons.js';
import { team } from './scenes.js';

export const LAND = { w: 1240, h: 800 };
export const PORT = { w: 1240, h: 1680 };

export function frame(pattern, orient, w, h, defs, body, o = {}) {
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}" data-infog="${pattern}" data-orientation="${orient}"${o.concept ? ` data-concept="${o.concept}"` : ''}${o.uc ? ` data-uc="${esc(o.uc)}"` : ''}><defs>${shadow('sh')}${grad('gHot', P.lava, P.amber)}${grad('gCool', P.cyan, P.blue)}${grad('gViolet', P.purple, P.pink)}${grad('gGreen', P.green, P.cyan)}${defs || ''}</defs><rect width="${w}" height="${h}" fill="${o.bg || '#FBF9F6'}"/>${body}</svg>`;
}

// The kind pill and the title. Returns { svg, bottom }.
export function titleBlock(s, x, y, w, o = {}) {
  const p = pill(x, y, s.technique || s.kind, o.pill || P.ink, '#fff', 20);
  const t = textBlock(x, y + p.h + 14, w, s.title, { size: o.size || 46, weight: 800, color: o.ink || P.ink, lh: 1.08, maxLines: 2 });
  return { svg: p.svg + t.svg, bottom: y + p.h + 14 + t.h };
}

// A big number with a gradient fill.
export function hero(x, y, text, size, paint = 'url(#gHot)', anchor = 'start') {
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="800" fill="${paint}" text-anchor="${anchor}" letter-spacing="-2">${esc(text)}</text>`;
}
export const heroWidth = (text, size) => (measure(text, size, 800) - String(text).length * 2) * 0.88;

// Split a stake like "$2.4M a year" into the number and the rest.
export function splitStake(stake) { const m = /^(.*?)(\$?\d[\d,.]*\s?[MKB]?|\d[\d,.]*)(.*)$/.exec(stake || ''); return m ? { lead: m[1].trim(), num: m[2].trim(), rest: m[3].trim() } : { lead: '', num: stake || '', rest: '' }; }

// "Who uses it": a small team, a people icon on the heading, the role in bold and the cadence with a calendar icon.
export function whoBlock(x, y, s, colors = [P.blue, P.lava, P.green], o = {}) {
  const ph = o.ph || 110; let svg = team(x + ph * 0.45, y + ph, ph, colors, 3);
  const tx = x + ph * 1.1 + 18; const tw = o.w || 300;
  svg += icon('users', tx, y + 3, 24, o.accent || P.lava, 2) + label(tx + 32, y + 24, 'WHO USES IT', { size: 20, weight: 700, color: P.grey, spacing: 1.5 });
  const t = textBlock(tx, y + 36, tw, s.who, { size: o.size || 26, weight: 800, color: o.ink || P.ink, maxLines: 2 });
  svg += t.svg + icon('calendar', tx, y + 46 + t.h, 26, o.accent || P.lava, 2) + textBlock(tx + 36, y + 68 + t.h - 22 * 0.92, tw - 36, s.cadence, { size: 22, weight: 600, color: o.muted || P.body, maxLines: 1 }).svg;
  return { svg: `<g data-part="who">${svg}</g>`, h: Math.max(ph, 80 + t.h) };
}

// A small heading with an icon (section label inside the drawing).
export function tagline(x, y, ic, text, color, o = {}) {
  return `${icon(ic, x, y - 22, 28, color, 2.2)}${label(x + 38, y, text, { size: o.size || 22, weight: 800, color, spacing: o.spacing ?? 1 })}`;
}

// A leader line with a dot, to annotate the drawing.
export const leader = (x1, y1, x2, y2, color = P.grey) => `<path d="M${f1(x1)},${f1(y1)} L${f1(x2)},${f1(y2)}" stroke="${color}" stroke-width="2" stroke-dasharray="3 5"/><circle cx="${f1(x2)}" cy="${f1(y2)}" r="5" fill="${color}"/>`;

// Catmull-Rom spline through points, as a path d.
export function spline(pts) {
  let d = `M${f1(pts[0][0])},${f1(pts[0][1])}`;
  for (let i = 0; i < pts.length - 1; i++) { const p0 = pts[i - 1] || pts[i]; const p1 = pts[i]; const p2 = pts[i + 1]; const p3 = pts[i + 2] || p2;
    d += ` C${f1(p1[0] + (p2[0] - p0[0]) / 6)},${f1(p1[1] + (p2[1] - p0[1]) / 6)} ${f1(p2[0] - (p3[0] - p1[0]) / 6)},${f1(p2[1] - (p3[1] - p1[1]) / 6)} ${f1(p2[0])},${f1(p2[1])}`; }
  return d;
}
