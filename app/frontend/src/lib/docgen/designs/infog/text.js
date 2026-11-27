// REQ-574 / REQ-571: text for the infographic library. Every size is clamped to 20 px (the floor at a 1240 px canvas).
export const FONT = "'Helvetica Neue', Helvetica, Arial, sans-serif";
export const MIN_PX = 20;
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

// Width of a string in px, a conservative estimate for Helvetica (wide glyphs counted wider).
export function measure(s, size, weight = 400) {
  let u = 0;
  for (const ch of String(s)) u += /[MW@%]/.test(ch) ? 0.86 : /[A-Z0-9$]/.test(ch) ? 0.66 : /[mw]/.test(ch) ? 0.84 : /[ilj.,:;'|!]/.test(ch) ? 0.27 : ch === ' ' ? 0.28 : /[ftr()-]/.test(ch) ? 0.36 : 0.56;
  return u * size * (weight >= 600 ? 1.06 : 1);
}

export function wrap(s, width, size, weight = 400) {
  // A word wider than the line (a long name with no spaces) is cut into pieces that fit, so it never runs off the page.
  const cut = (w) => { if (measure(w, size, weight) <= width) return [w]; const out = []; let piece = '';
    for (const ch of w) { if (piece && measure(piece + ch, size, weight) > width) { out.push(piece); piece = ch; } else piece += ch; } if (piece) out.push(piece); return out; };
  const words = String(s ?? '').split(/\s+/).filter(Boolean).flatMap(cut); const lines = []; let cur = '';
  for (const w of words) { const t = cur ? `${cur} ${w}` : w; if (cur && measure(t, size, weight) > width) { lines.push(cur); cur = w; } else cur = t; }
  if (cur) lines.push(cur);
  return lines;
}

// A wrapped block. Returns { svg, h, lines, w }. y is the top of the block; anchor start|middle|end.
export function textBlock(x, y, width, s, o = {}) {
  const size = Math.max(MIN_PX, o.size || MIN_PX); const weight = o.weight || 400; const lh = o.lh || 1.22;
  let lines = wrap(s, width, size, weight);
  if (o.maxLines && lines.length > o.maxLines) { lines = lines.slice(0, o.maxLines); lines[lines.length - 1] = lines[lines.length - 1].replace(/[,.;:]?\s*\S*$/, '') + '…'; }
  const anchor = o.anchor || 'start'; const fill = o.color || '#14263A';
  const tsp = lines.map((l, i) => `<tspan x="${x}" y="${(y + size * 0.92 + i * size * lh).toFixed(1)}">${esc(l)}</tspan>`).join('');
  const ls = o.spacing ? ` letter-spacing="${o.spacing}"` : '';
  const svg = lines.length ? `<text font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls}>${tsp}</text>` : '';
  const w = Math.max(0, ...lines.map((l) => measure(l, size, weight)));
  return { svg, h: lines.length ? size + (lines.length - 1) * size * lh : 0, lines, w };
}

// One line of text at a baseline.
export function label(x, y, s, o = {}) {
  const size = Math.max(MIN_PX, o.size || MIN_PX);
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${o.weight || 400}" fill="${o.color || '#14263A'}" text-anchor="${o.anchor || 'start'}"${o.spacing ? ` letter-spacing="${o.spacing}"` : ''}>${esc(s)}</text>`;
}
