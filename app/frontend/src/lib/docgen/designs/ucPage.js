// REQ-526 part C: the brief use case page, one A4 page (794 x 1123) per use case, laid out once for all four designs.
// The engine owns the flow (what is shown, how long text is cut so the page never overflows, the projection chart, the data chips, the fact row);
// each style passes a skin that draws its own frame, head, value tile, labels, boxes, chips and chart marks in its own visual language.
import { T, t, rect, line, circle, svgDoc, has, wrap, textW, money } from './core.js';

export const PW = 794;
export const PH = 1123;
export const NOT_YET = 'not calculated yet';

const BODY = 13; const LH = 18;
const g = (block, svg) => `<g data-block="${block}">${svg}</g>`;
// A word with no break that is wider than the box is cut, so one long table path cannot run off the page.
const softBreak = (s, n = 60) => String(s ?? '').replace(new RegExp(`\\S{${n},}`, 'g'), (w) => w.match(new RegExp(`.{1,${n - 10}}`, 'g')).join(' '));
const clip = (s, maxW, size) => { let x = String(s); while (x.length > 1 && textW(x, size) > maxW) x = `${x.slice(0, -2)}…`.replace(/……$/, '…'); return x; };

// The yearly rows that carry a number, years 1 to 3 (never filled in when missing).
export function projectionYears(u) {
  return [1, 2, 3].map((year) => {
    const r = (u.value?.yearly || []).find((x) => Number(x.year) === year);
    return r ? { year, low: Number(r.low) || 0, likely: Number(r.likely) || 0, high: Number(r.high) || 0 } : null;
  }).filter((r) => r && (r.low || r.likely || r.high));
}

// S (skin): P, footH, bg, boxBg, font, kind, ink, body, muted, labelH, gap, pad, factsH, chipH, chipPad,
//   frame(pageNo), head(), tile(y), label(text, x, y, w), box(x, y, w, h), chipSvg(text, x, y, w), chart { colors, bar, ink, muted, grid, radius, bg }, chartH, defs.
export function ucPage(m, u, idx, S) {
  const P = S.P; const CW = PW - 2 * P; const bottom = PH - S.footH;
  const pad = S.box ? S.pad : 0; const tw = CW - 2 * pad; const textBg = S.box ? S.boxBg : S.bg;
  const kind = S.kind || 'sans';
  let body = S.frame(idx + 2);
  const head = S.head(); body += head.svg;
  let y = head.h + S.gap;
  const tile = S.tile(y); body += tile.svg; y += tile.h + S.gap;

  // What is shown: nothing without data, nothing for a block that is off.
  const secs = [];
  if (has(m, 'use_case_story')) [['The use case', u.statement], ['The solution', u.solution], ['Business value', u.businessValue]].forEach(([label, text]) => text && secs.push({ id: 'use_case_story', label, text: softBreak(text), cap: 6 }));
  if (has(m, 'value_story') && u.value?.story) secs.push({ id: 'value_story', label: 'Value story', text: softBreak(u.value.story), cap: 5 });
  const years = has(m, 'value_projection') ? projectionYears(u) : [];
  const tables = has(m, 'data_used') ? (u.tables || []) : [];
  const facts = [['Sponsor', u.sponsor], ['Beneficiary', u.beneficiary], ['Technique', u.technique]].filter((f) => f[1]);

  // Data chips in rows (at most 3); chips that do not fit are replaced by one "+N more" chip at the end of the last row.
  const chipRows = [];
  if (tables.length) {
    const chips = tables.map((name) => { const label = clip(name, tw - 2 * S.chipPad, 12); return { label, w: S.chipW(label) }; });
    let rows = [[]]; let rx = 0; let shown = 0;
    for (const c of chips) {
      if (rx && rx + c.w > tw) { if (rows.length === 3) break; rows.push([]); rx = 0; }
      rows[rows.length - 1].push({ ...c, x: rx }); rx += c.w + 8; shown += 1;
    }
    if (shown < chips.length) {
      const last = rows[rows.length - 1]; let n = chips.length - shown; const place = () => { const l = `+${n} more`; return { label: l, w: S.chipW(l) }; };
      let more = place();
      while (last.length > 1 && last[last.length - 1].x + last[last.length - 1].w + 8 + more.w > tw) { last.pop(); n += 1; more = place(); }
      const prev = last[last.length - 1]; last.push({ ...more, x: prev.x + prev.w + 8 });
    }
    chipRows.push(...rows);
  }
  const boxH = (inner) => inner + 2 * pad;
  const dataH = chipRows.length ? boxH(S.labelH + chipRows.length * (S.chipH + 8)) + S.gap : 0;
  const chartTotal = years.length ? boxH(S.labelH + S.chartH) + S.gap : 0;
  const factsTotal = facts.length ? S.factsH + S.gap : 0;

  // Fit: shorten the longest text a line at a time until everything above the footer fits.
  const textH = (s, cap) => boxH(S.labelH + Math.min(cap, wrap(s.text, tw, BODY, kind, 400, 99).length) * LH + 4) + S.gap;
  const avail = bottom - y - dataH - chartTotal - factsTotal;
  const total = () => secs.reduce((a, s) => a + textH(s, s.cap), 0);
  while (total() > avail && secs.some((s) => s.cap > 1)) { const top = secs.reduce((a, s) => (s.cap > a.cap ? s : a), secs[0]); top.cap -= 1; }

  secs.forEach((s) => {
    const lines = Math.min(s.cap, wrap(s.text, tw, BODY, kind, 400, 99).length); const h = textH(s, s.cap) - S.gap; let inner = '';
    if (S.box) inner += S.box(P, y, CW, h);
    inner += S.label(s.label, P + pad, y + pad, tw);
    inner += T(P + pad, y + pad + S.labelH + 12, s.text, { size: BODY, fill: S.body, bg: textBg, font: S.bodyFont || S.font, kind, maxW: tw, lines, lh: LH, ctx: `uc ${s.id}` }).svg;
    body += g(s.id, inner); y += h + S.gap;
  });

  if (years.length) {
    const h = boxH(S.labelH + S.chartH); let inner = (S.box ? S.box(P, y, CW, h) : '') + S.label('Three-year projection', P + pad, y + pad, tw);
    inner += chart(u, years, P + pad, y + pad + S.labelH, tw, S.chartH, S);
    body += g('value_projection', inner); y += h + S.gap;
  }
  if (chipRows.length) {
    const h = boxH(S.labelH + chipRows.length * (S.chipH + 8)); let inner = (S.box ? S.box(P, y, CW, h) : '') + S.label('Data used', P + pad, y + pad, tw);
    chipRows.forEach((row, r) => row.forEach((c) => { inner += S.chipSvg(c.label, P + pad + c.x, y + pad + S.labelH + r * (S.chipH + 8), c.w); }));
    body += g('data_used', inner); y += h + S.gap;
  }
  if (facts.length) body += S.facts(facts, P, y, CW);
  // Right to left: the page is mirrored as a whole, and each text is flipped back about its own anchor so the words read normally.
  if (m.rtl) body = `<g transform="translate(${PW} 0) scale(-1 1)">${body.replace(/<text ([^>]*?)x="([\d.-]+)"/g, (_, a, x) => `<text transform="translate(${2 * Number(x)} 0) scale(-1 1)" ${a}x="${x}"`)
    // Icons (core.js icon(): a 24-unit group at x with scale k) are flipped back inside their own box, so arrows keep their direction.
    .replace(/<g transform="translate\(([-\d.]+) ([-\d.]+)\) scale\(([-\d.]+)\)" fill="none"/g, (_, x, y, k) => `<g transform="translate(${Number(x) + 24 * Number(k)} ${y}) scale(${-Number(k)} ${k})" fill="none"`)}</g>`;
  return svgDoc(PW, PH, `<g data-design="${S.id}" data-page="usecase">${body}</g>`, S.font, typeof S.defs === 'function' ? S.defs() : S.defs || '');
}

// The three-year projection: low, likely and high per year, drawn as the style's own marks (bars or lollipops).
function chart(u, years, x, y, w, h, S) {
  const C = S.chart; const cur = u.value.currency; const gw = w / years.length;
  const labelTop = 16; const base = y + h - 24; const top = y + 22 + labelTop; const span = base - top;
  const max = Math.max(...years.flatMap((r) => [r.low, r.likely, r.high]), 1);
  let s = `<g data-chart="projection">`;
  // legend
  [['Low', 0], ['Likely', 1], ['High', 2]].forEach(([name, i]) => {
    const lx = x + w - (3 - i) * 74;
    s += rect(lx, y + 4, 10, 10, C.colors[i], { rx: C.radius ? 2 : 0 }) + t(lx + 14, y + 13, name, { size: 12, fill: C.muted, bg: C.bg, font: S.font, ctx: 'legend' });
  });
  [0.5, 1].forEach((f) => { s += line(x, base - span * f, x + w, base - span * f, C.grid, 1, { dash: f === 1 ? undefined : '3 4' }); });
  s += line(x, base, x + w, base, C.ink, 1);
  years.forEach((r, i) => {
    const cx = x + gw * i + gw / 2; const bw = Math.min(56, (gw - 24) / 3 - 4);
    [r.low, r.likely, r.high].forEach((v, k) => {
      const bx = cx + (k - 1) * (bw + 6) - bw / 2; const bh = Math.max(2, (v / max) * span); const by = base - bh;
      if (C.bar === 'lollipop') s += line(bx + bw / 2, by, bx + bw / 2, base, C.colors[k], 2) + circle(bx + bw / 2, by, 6, C.colors[k]);
      else s += rect(bx, by, bw, bh, C.colors[k], { rx: C.radius });
      s += t(bx + bw / 2, by - (C.bar === 'lollipop' ? 11 : 6), money(v, cur), { size: 12, weight: k === 1 ? 700 : 400, fill: C.ink, bg: C.bg, anchor: 'middle', font: S.font, ctx: 'proj v' });
    });
    s += t(cx, base + 17, `Year ${r.year}`, { size: 12, weight: 700, fill: C.muted, bg: C.bg, anchor: 'middle', font: S.font, ctx: 'proj yr' });
  });
  return `${s}</g>`;
}

// One fact row (sponsor, beneficiary, technique): up to three columns, each a small label over the value (two lines at most).
export function factCols(facts, x, y, w, S, { bg, gap = 16, valueFont, kind = 'sans', labelFill, valueFill, rule }) {
  const cw = (w - gap * (facts.length - 1)) / facts.length; let s = '';
  facts.forEach(([label, v], i) => {
    const cx = x + i * (cw + gap);
    if (rule) s += line(cx, y, cx + cw, y, rule, 1);
    s += t(cx, y + 20, label, { size: 12, weight: 700, fill: labelFill, bg, caps: true, ls: 1, font: S.font, ctx: 'fact l' });
    s += T(cx, y + 40, softBreak(v, 30), { size: BODY, fill: valueFill, bg, font: valueFont || S.bodyFont || S.font, kind, maxW: cw, lines: 2, lh: LH, ctx: 'fact v' }).svg;
  });
  return s;
}
