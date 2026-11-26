// RC6-B-11 / RC6-B-12: shared helpers for the document tests. Page-space boxes of every text and icon in a rendered SVG page
// (group transforms of the form translate(x y) scale(sx sy) are followed; width estimate 0.5 em per character), and the Arabic stand-in
// translator used in place of the model (each label becomes an Arabic marker, so any English label left in a page is a renderer that
// printed its own English).
import fs from 'node:fs';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { modelFor, textsToTranslate } from '../src/lib/generateDocs.js';

const FIXTURE = new URL('../../agent/demos/bakehouse/docs/Samples bakehouse-dbx_inspire.json', import.meta.url);
const raw = JSON.parse(fs.readFileSync(FIXTURE, 'utf8'));
export const UCS = raw.domains.flatMap((d) => d.use_cases.map((u) => ({ ...u, domain: d.domain_name })));
export const ALL_BLOCKS = ['use_case_story', 'value_story', 'value_projection', 'inspire_score', 'data_used', 'disclaimer'];
export const DESIGN_IDS = ['original', 'editorial_ink', 'bold', 'consulting'];
export const MODES = ['light', 'dark'];
const VERBS = ['GROW REVENUE', 'AVOID RISK', 'CUT COST'];
export const mkValues = (ucs) => Object.fromEntries(ucs.map((u, i) => [u.No, { amount: 40000 + i * 12500, currency: 'USD', status: i % 2 ? 'calculated' : 'estimated', verb: VERBS[i % 3],
  story: 'It pays back within the first year.', yearly: [1, 2, 3].map((year) => ({ year, low: 20000 + i * 5000 * year, likely: 40000 + i * 12500 * year, high: 70000 + i * 20000 * year })), factors: [] }]));

// The Arabic stand-in: every text becomes Arabic letters (its position in the request), keeping {0} holes, so no English can come from a translation.
const AR = (i) => `ع${String.fromCharCode(0x0621 + (i % 26))}${i}`;
export function fakeTranslated(ucs, values, summary = []) {
  const texts = textsToTranslate(ucs, values, summary); const out = {};
  Object.keys(texts).forEach((k, i) => { out[k] = k.startsWith('label|') ? `${AR(i)}${(texts[k].match(/\{\d+\}/g) || []).map((h) => ` ${h}`).join('')}` : `نص ${i}`; });
  return out;
}
export function arabicModel({ ucs = UCS.slice(0, 6), values = mkValues(ucs), blocks = ALL_BLOCKS, businessName = 'Acme Bakes' } = {}) {
  const ids = ucs.map((u) => String(u.No));
  return modelFor({ businessName, useCases: ucs, values, options: { ...defaultDocOptions('Arabic'), blocks }, language: 'Arabic', ids, translated: fakeTranslated(ucs, values) });
}
export const noValueModel = ({ ucs = UCS.slice(0, 2), blocks = ALL_BLOCKS, businessName = 'Acme Bakes', language = 'English' } = {}) =>
  buildDocModel({ businessName, useCases: ucs, values: {}, options: { ...defaultDocOptions(language), blocks } });

const un = (s) => s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
const compose = (p, sx, sy, tx, ty) => ({ sx: p.sx * sx, sy: p.sy * sy, tx: p.sx * tx + p.tx, ty: p.sy * ty + p.ty });
function xf(tag) {
  const tr = /transform="([^"]*)"/.exec(tag)?.[1] || '';
  const t = /translate\(([-\d.]+)[ ,]+([-\d.]+)\)/.exec(tr); const sc = /scale\(([-\d.]+)(?:[ ,]+([-\d.]+))?\)/.exec(tr);
  const sx = sc ? Number(sc[1]) : 1; const sy = sc ? Number(sc[2] ?? sc[1]) : 1;
  return { sx, sy, tx: t ? Number(t[1]) : 0, ty: t ? Number(t[2]) : 0 };
}
// { texts: [{ x0, x1, y0, y1, text, size }], icons: [{ x0, x1, y0, y1 }] } in page coordinates.
export function layout(svg) {
  const texts = []; const icons = []; const stack = [{ sx: 1, sy: 1, tx: 0, ty: 0 }];
  for (const m of svg.matchAll(/<g\b[^>]*>|<\/g>|<text\b[^>]*>.*?<\/text>/gs)) {
    const s = m[0];
    if (s.startsWith('</g')) { stack.pop(); continue; }
    const top = stack[stack.length - 1];
    if (s.startsWith('<g')) {
      const x = xf(s); const next = compose(top, x.sx, x.sy, x.tx, x.ty);
      if (/ fill="none" stroke=/.test(s) && /scale\(/.test(s) && /translate\(/.test(s)) { // a design icon: a 24-unit box
        const k = Math.abs(x.sx); const xs = [next.tx, next.tx + 24 * x.sx * top.sx].sort((a, b) => a - b); const ys = [next.ty, next.ty + 24 * x.sy * top.sy].sort((a, b) => a - b);
        icons.push({ x0: xs[0], x1: xs[1], y0: ys[0], y1: ys[1], k });
      }
      if (!s.endsWith('/>')) stack.push(next);
      continue;
    }
    const open = /^<text\b([^>]*)>/.exec(s)[1];
    const a = Object.fromEntries([...open.matchAll(/([\w-]+)="([^"]*)"/g)].map((q) => [q[1], q[2]]));
    const t = compose(top, xf(open).sx, 1, xf(open).tx, 0); const size = Number(a['font-size']); const anchor = a['text-anchor'] || 'start';
    let y = Number(a.y); const lines = [];
    for (const ts of s.matchAll(/<tspan x="([-\d.]+)"(?: dy="([-\d.]+)")?>(.*?)<\/tspan>/gs)) {
      y += Number(ts[2] || 0); const text = un(ts[3]); const w = text.length * size * 0.5; const x = Number(ts[1]);
      const a0 = anchor === 'end' ? x - w : anchor === 'middle' ? x - w / 2 : x; const px = [t.sx * a0 + t.tx, t.sx * (a0 + w) + t.tx].sort((p, q) => p - q);
      lines.push({ x0: px[0], x1: px[1], y0: top.sy * (y - size) + top.ty, y1: top.sy * (y + size * 0.25) + top.ty, text, size });
    }
    texts.push(...lines);
  }
  return { texts, icons };
}
export const overlap = (a, b) => a.x0 < b.x1 && b.x0 < a.x1 && a.y0 < b.y1 && b.y0 < a.y1;

// An English label shows when a text, with its numbers taken out, is exactly one of these (brand names are not labels).
export const ENGLISH_LABELS = ['score', 'inspire score', 'inspire score of', 'use case', 'the use case', 'the solution', 'business value', 'value story', 'data used', 'three-year projection',
  'sponsor', 'beneficiary', 'technique', 'what it does', 'low', 'likely', 'high', 'year', 'page', 'a year', 'estimated a year', 'calculated a year', 'of', 'where to start', 'prepared for',
  'use case brief', 'use cases', 'domains', 'executive summary', 'start with these three', 'value by domain', 'not calculated yet', 'statement', 'solution', 'quality', 'value verb',
  'estimated yearly value', 'yearly value', 'total', 'summary', 'portfolio', 'value roll-up', 'domain', 'value', 'start here', 'how to read'];
export const stripNumbers = (t) => t.replace(/[$€£]?\d[\d.,]*[KMB]?%?/g, '').replace(/\s+/g, ' ').replace(/[·|/:()-]+/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
export const englishLeft = (strings) => strings.filter((t) => ENGLISH_LABELS.includes(stripNumbers(t)));
