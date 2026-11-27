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

// A phrase cut to what fits, never mid-thought and never with an ellipsis: the longest lead of the text that ends at a clause boundary and fits.
// A boundary is punctuation (comma, semicolon, colon, full stop, an opening bracket, a spaced dash; a closing bracket is not, the clause goes on after it), or the start of a clause (who, which, that, when,
// where, while, because, so, then, but, and, or, unless, since) or of a prepositional phrase (to, for, with, by, from, in, on, at, ...).
// When no lead ends at a boundary and fits, the result is '' (clip.none is set): the caller shows the whole text another way or leaves it out.
const DANGLE = /^(and|or|the|a|an|of|to|for|with|in|on|at|by|from|that|which|is|are|was|were|than|as|per|into|its|their|this|these|but|so|if|when|while|between|across|over|under|against|about|before|after|until|each|every|then|who|whose|not|worth|up|down|around|among|within|without|through|toward|towards|near|unless|since|using|because|where|while|how|what|why|whether|above|below|beyond|against|about|via|instead)$/i;
export const tidy = (x) => { let w = x.trim().replace(/[\s,;:\u2013\u2014-]+$/, ''); const o = w.lastIndexOf('('); if (o > w.lastIndexOf(')')) w = w.slice(0, o).trim();
  const ws = w.split(' '); while (ws.length > 1 && DANGLE.test(ws[ws.length - 1].replace(/[^\w]/g, ''))) ws.pop(); return ws.join(' ').replace(/[\s,;:\u2013\u2014-]+$/, ''); };
export const BOUNDARY = /[,;:.!?]\s|\s[\u2013\u2014-]\s|\s\(|\s(?=(?:who|which|that|when|where|while|because|so|then|but|and|or|unless|since|to|for|with|by|from|in|on|at|across|before|after|until|using|through|into|over|under|between|within|without|via|toward|towards|around|among|near|instead|above|below|beyond|against|about)\s)/gi;
// A lead cut before "and"/"or"/a preposition must be a closed phrase: it does not end on a bare verb in -ed that wants what follows ("... or
// charged"; "is not matched" is closed), and a clause opened by its last subordinating word with a subject of its own ("what the contract")
// has reached its verb.
const LINKW = /^\s(and|or|to|for|with|by|from|in|on|at|across|into|over|under|between|within|without|toward|towards|around|among|near|above|below|beyond|against|about)\s/i;
const SUBORD = new Set(['what', 'when', 'where', 'whether', 'if', 'than', 'which', 'that', 'who', 'whose', 'because', 'unless', 'while', 'until']);
const DET = new Set(['the', 'a', 'an', 'their', 'its', 'his', 'her', 'our', 'your', 'this', 'these', 'those', 'each', 'every']);
const AUX = new Set(['is', 'are', 'was', 'were', 'be', 'been', 'being', 'not', 'never', 'get', 'gets', 'got', 'has', 'have', 'had']);
const VERBISH = /^(is|are|was|were|be|been|has|have|had|do|does|did|can|could|will|would|may|might|must|should|come|go|run|make|take|give|show|get|need|allow|[a-z'-]+(s|ed))$/;
export function closed(prefix) {
  const w = String(prefix).toLowerCase().replace(/[^\w\s'-]/g, ' ').split(/\s+/).filter(Boolean); const n = w.length;
  if (/[a-z]ed$/.test(w[n - 1] || '') && !AUX.has(w[n - 2] || '')) return false;
  let k = -1; w.forEach((x, i) => { if (SUBORD.has(x)) k = i; });
  return k < 0 || !DET.has(w[k + 1] || '') || w.slice(k + 2).some((x) => VERBISH.test(x));
}
export function clip(s, fits) {
  const t = String(s ?? '').replace(/\s+/g, ' ').trim(); clip.none = false;
  if (!t || fits(t)) return t;
  let best = '';
  for (const m of t.matchAll(BOUNDARY)) { const c = t.slice(0, m.index + (/[,;:.!?)]/.test(m[0][0]) ? 1 : 0)).replace(/[\s,;:\u2013\u2014-]+$/, '').trim(); if (c && c.length > best.length && fits(c) && c === tidy(c) && (!LINKW.test(t.slice(m.index, m.index + 14)) || closed(c))) best = c; }
  if (!best) clip.none = true;
  return best;
}
// A character cap is a guide, not a cut point: a text is kept whole unless a lead of it that ends at a clause boundary fits the cap.
// A text with no such lead stays whole; the drawing wraps it (textBlock), and the pick validator refuses it for a slot it does not fit.
export const phrase = (s, max) => { const r = clip(s, (x) => x.length <= max); return clip.none ? String(s ?? '').replace(/\s+/g, ' ').trim() : r; };

// A wrapped block. Returns { svg, h, lines, w }. y is the top of the block; anchor start|middle|end.
export function textBlock(x, y, width, s, o = {}) {
  const size = Math.max(MIN_PX, o.size || MIN_PX); const weight = o.weight || 400; const lh = o.lh || 1.22;
  let lines = wrap(s, width, size, weight); let sz = size;
  if (o.maxLines && lines.length > o.maxLines) {
    // A text that does not fit first takes a smaller size (down to the 20 px floor) and the extra lines that fit the same height; only then
    // is it cut, at a clause boundary, and when no boundary fits it is left out (never a cut phrase).
    const room = size + (o.maxLines - 1) * size * lh; const tries = [];
    const sizes = []; for (let z = size; z > MIN_PX; z -= 2) sizes.push(z); sizes.push(MIN_PX);
    for (const z of sizes) tries.push([z, Math.max(1, Math.floor((room - z) / (z * lh) + 1e-6) + 1)]);
    const whole = tries.find(([z, ml]) => wrap(s, width, z, weight).length <= ml);
    if (whole) { sz = whole[0]; lines = wrap(s, width, sz, weight); } else {
      let kept = ''; for (const [z, ml] of tries) { const k = clip(s, (x) => wrap(x, width, z, weight).length <= ml); if (k.length > kept.length) { kept = k; sz = z; } }
      if (globalThis.__INFOG_CLIPS) globalThis.__INFOG_CLIPS.push({ s, kept, width, size, maxLines: o.maxLines });
      if (!kept) textBlock.dropped += 1; lines = kept ? wrap(kept, width, sz, weight) : [];
    }
  }
  const anchor = o.anchor || 'start'; const fill = o.color || '#14263A';
  const tsp = lines.map((l, i) => `<tspan x="${x}" y="${(y + sz * 0.92 + i * sz * lh).toFixed(1)}">${esc(l)}</tspan>`).join('');
  const ls = o.spacing ? ` letter-spacing="${o.spacing}"` : '';
  const svg = lines.length ? `<text x="${x}" font-family="${FONT}" font-size="${sz}" font-weight="${weight}" fill="${fill}" text-anchor="${anchor}"${ls}>${tsp}</text>` : '';
  const w = Math.max(0, ...lines.map((l) => measure(l, sz, weight)));
  return { svg, h: lines.length ? sz + (lines.length - 1) * sz * lh : 0, lines, w, size: sz };
}

// How many texts were left out because no whole phrase of them fits their slot (the picker reads it to prefer a concept that fits).
textBlock.dropped = 0;

// Whether textBlock would draw any of a text at this width (no side effect on the drop count).
export function shows(width, s, o = {}) { const d = textBlock.dropped; const ok = !!textBlock(0, 0, width, s, o).svg; textBlock.dropped = d; return ok; }
// The items of a row of slots whose text shows, so a slot whose text drops goes with its icon and the rest re-flow into its room.
// ok(item, n, k) answers for a row of the n kept items k; with fewer slots each has more room, so the filter runs until it is stable.
// Each item left out is counted as a dropped text (the picker reads it).
export function keepShown(items, ok) {
  let k = items || [];
  while (k.length) { const nx = k.filter((it) => ok(it, k.length, k)); if (nx.length === k.length) break; k = nx; }
  textBlock.dropped += (items || []).length - k.length; return k;
}

// One line of text at a baseline.
export function label(x, y, s, o = {}) {
  const size = Math.max(MIN_PX, o.size || MIN_PX);
  return `<text x="${x}" y="${y}" font-family="${FONT}" font-size="${size}" font-weight="${o.weight || 400}" fill="${o.color || '#14263A'}" text-anchor="${o.anchor || 'start'}"${o.spacing ? ` letter-spacing="${o.spacing}"` : ''}>${esc(s)}</text>`;
}
