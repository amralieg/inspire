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

// A phrase cut to what fits, never mid-thought and never with an ellipsis: the longest run of whole words that fits, ended at the last clause
// boundary (comma, semicolon, colon, dash, full stop or a closed bracket) when that keeps most of it, never on a connecting word or an open bracket.
const DANGLE = /^(and|or|the|a|an|of|to|for|with|in|on|at|by|from|that|which|is|are|was|were|than|as|per|into|its|their|this|these|but|so|if|when|while|between|across|over|under|against|about|before|after|until|each|every|then|who|whose|not|worth|up|down|around|among|within|without|through|toward|towards|near|unless|since|using|because|where|while|how|what|why|whether|above|below|beyond|against|about|via|instead)$/i;
export const tidy = (x) => { let w = x.trim().replace(/[\s,;:–—-]+$/, ''); const o = w.lastIndexOf('('); if (o > w.lastIndexOf(')')) w = w.slice(0, o).trim();
  const ws = w.split(' '); while (ws.length > 1 && DANGLE.test(ws[ws.length - 1].replace(/[^\w]/g, ''))) ws.pop(); return ws.join(' ').replace(/[\s,;:–—-]+$/, ''); };
export function clip(s, fits) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim();
  if (!t || fits(t)) return t;
  const ws = t.split(' '); let k = ws.length - 1; while (k > 1 && !fits(ws.slice(0, k).join(' '))) k -= 1;
  const byWord = tidy(ws.slice(0, k).join(' ')); let best = '';
  for (const m of t.matchAll(/[,;:.!?]\s|\s[–—-]\s|\)\s|\s\(|\s(?=(?:who|which|that|when|where|while|because|and|but|or|so|then|for|to|with|by|from|in|on|at|per|of|across|before|after|until|unless|since|using|than|around|among|within|without|through|into|over|under|between|toward|towards|near|instead|how|what|why|whether|above|below|beyond|against|about|via|weighted|based|ranked|sorted|measured|grouped|scored)\s)/g)) { const c = tidy(t.slice(0, m.index + (m[0][0] === ')' || m[0][0] === ',' || /[;:.!?]/.test(m[0][0]) ? 1 : 0))); if (c && fits(c) && c.length > best.length) best = c; }
  for (const m of t.matchAll(/(?:\d[\d,]*(?:\.\d+)?\s?[%MKB]?|\b(?:a|per|each|every|this|next|last)\s(?:year|week|month|day|quarter|hour|cycle|run))(?=\s)/g)) { const c = tidy(t.slice(0, m.index + m[0].length)); if (c && fits(c) && c.length > best.length) best = c; }
  return best && best.length >= 0.3 * byWord.length ? best : (clip.lastByWord = true, byWord);
}
// A character cap is a guide, not a cut point: a clause with no boundary that is a few characters over keeps its last words (the slot wraps it).
export const phrase = (s, max) => { clip.lastByWord = false; const r = clip(s, (x) => x.length <= max); const t = String(s ?? '').replace(/\s+/g, ' ').trim(); return clip.lastByWord && t.length <= max * 1.2 ? t : r; };

// A wrapped block. Returns { svg, h, lines, w }. y is the top of the block; anchor start|middle|end.
export function textBlock(x, y, width, s, o = {}) {
  const size = Math.max(MIN_PX, o.size || MIN_PX); const weight = o.weight || 400; const lh = o.lh || 1.22;
  let lines = wrap(s, width, size, weight);
  if (o.maxLines && lines.length > o.maxLines) { const kept = clip(s, (x) => wrap(x, width, size, weight).length <= o.maxLines); if (globalThis.__INFOG_CLIPS) globalThis.__INFOG_CLIPS.push({ s, kept, width, size, maxLines: o.maxLines }); lines = wrap(kept, width, size, weight).slice(0, o.maxLines); }
  const anchor = o.anchor || 'start'; const fill = o.color || '#14263A';
  const tsp = lines.map((l, i) => `<tspan x="${x}" y="${(y + size * 0.92 + i * size * lh).toFixed(1)}">${esc(l)}</tspan>`).join('');
  const ls = o.spacing ? ` letter-spacing="${o.spacing}"` : '';
  const svg = lines.length ? `<text x="${x}" font-family="${FONT}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls}>${tsp}</text>` : '';
  const w = Math.max(0, ...lines.map((l) => measure(l, size, weight)));
  return { svg, h: lines.length ? size + (lines.length - 1) * size * lh : 0, lines, w };
}

// One line of text at a baseline.
export function label(x, y, s, o = {}) {
  const size = Math.max(MIN_PX, o.size || MIN_PX);
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${o.weight || 400}" fill="${o.color || '#14263A'}" text-anchor="${o.anchor || 'start'}"${o.spacing ? ` letter-spacing="${o.spacing}"` : ''}>${esc(s)}</text>`;
}
