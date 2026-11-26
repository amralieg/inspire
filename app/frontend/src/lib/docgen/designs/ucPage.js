// REQ-526 part C: the brief use case page, one A4 page (794 x 1123) per use case, laid out once for all four designs.
// The engine owns the flow (what is shown, how long text is cut so the page never overflows, the projection chart, the data chips, the fact row);
// each style passes a skin that draws its own frame, head, value tile, labels, boxes, chips and chart marks in its own visual language.
import { extraParts, partLines } from '../docModel.js';
import { T, t, rect, line, circle, svgDoc, has, wrap, textW, money, rtlMirror } from './core.js';

export const PW = 794;
export const PH = 1123;
export const NOT_YET = 'not calculated yet';

const BODY = 13; const LH = 18;
const g = (block, svg) => `<g data-block="${block}">${svg}</g>`;
// A word with no break that is wider than the box is cut, so one long table path cannot run off the page.
const softBreak = (s, n = 60) => String(s ?? '').replace(new RegExp(`\\S{${n},}`, 'g'), (w) => w.match(new RegExp(`.{1,${n - 10}}`, 'g')).join(' '));
// A table name wider than the box is split into pieces that each fit, never cut.
const pieces = (s, maxW, size) => { const n = Math.max(8, Math.floor(maxW / textW('x', size))); return String(s).match(new RegExp(`.{1,${n}}`, 'g')) || ['']; };

// The yearly rows that carry a number, years 1 to 3 (never filled in when missing).
export function projectionYears(u) {
  return [1, 2, 3].map((year) => {
    const r = (u.value?.yearly || []).find((x) => Number(x.year) === year);
    return r ? { year, low: Number(r.low) || 0, likely: Number(r.likely) || 0, high: Number(r.high) || 0 } : null;
  }).filter((r) => r && (r.low || r.likely || r.high));
}

// S (skin): P, footH, bg, boxBg, font, kind, ink, body, muted, labelH, gap, pad, factsH, chipH, chipPad,
//   frame(pageNo), head(), tile(y), label(text, x, y, w), box(x, y, w, h), chipSvg(text, x, y, w), chart { colors, bar, ink, muted, grid, radius, bg }, chartH, defs.
// C23: returns the pages of one use case (an array of svg strings). Every text is printed in full; what does not fit under the footer
// moves to a continuation page (the head repeats, the value tile does not), so nothing is cut with "...".
export function ucPage(m, u, idx, S) {
  const P = S.P; const CW = PW - 2 * P; const bottom = PH - S.footH;
  const pad = S.box ? S.pad : 0; const tw = CW - 2 * pad; const textBg = S.box ? S.boxBg : S.bg;
  const kind = S.kind || 'sans';

  // What is shown: nothing without data, nothing for a block that is off.
  const story = [];
  if (has(m, 'use_case_story')) {
    [['The use case', u.statement], ['The solution', u.solution], ['Business value', u.businessValue]].forEach(([label, text]) => text && story.push({ id: 'use_case_story', label, text: softBreak(text) }));
  }
  if (has(m, 'value_story') && u.value?.story) story.push({ id: 'value_story', label: 'Value story', text: softBreak(u.value.story) });
  // The extra detail fields come after the chart, data and facts (below), so a page that was complete before still is.
  const extra = has(m, 'use_case_story') ? extraParts(u).map(([label, items]) => ({ id: 'use_case_story', label, text: softBreak(partLines(items).join('  ')) })) : [];
  const years = has(m, 'value_projection') ? projectionYears(u) : [];
  const tables = has(m, 'data_used') ? (u.tables || []) : [];
  const facts = [['Sponsor', u.sponsor], ['Beneficiary', u.beneficiary], ['Technique', u.technique]].filter((f) => f[1]);

  // Data chips in rows; every table is shown, the box grows with the rows.
  const chipRows = [];
  if (tables.length) {
    const chips = tables.flatMap((name) => pieces(name, tw - 2 * S.chipPad, 12)).map((label) => ({ label, w: S.chipW(label) }));
    const rows = [[]]; let rx = 0;
    for (const c of chips) {
      if (rx && rx + c.w > tw) { rows.push([]); rx = 0; }
      rows[rows.length - 1].push({ ...c, x: rx }); rx += c.w + 8;
    }
    chipRows.push(...rows);
  }
  const boxH = (inner) => inner + 2 * pad;
  const textH = (s) => boxH(S.labelH + wrap(s.text, tw, BODY, kind, 400, 99).length * LH + 4);
  // The things to place, in order. A text section is as tall as all its lines.
  const items = [
    ...story.map((s) => ({ type: 'text', s, h: textH(s) })),
    ...(years.length ? [{ type: 'chart', h: boxH(S.labelH + S.chartH) }] : []),
    ...(chipRows.length ? [{ type: 'chips', h: boxH(S.labelH + chipRows.length * (S.chipH + 8)) }] : []),
    ...(facts.length ? [{ type: 'facts', h: S.factsH }] : []),
    ...extra.map((s) => ({ type: 'text', s, h: textH(s) })),
  ];

  const draw = (first) => {
    let body = S.frame(idx + 2);
    const head = S.head(); body += head.svg;
    let y = head.h + S.gap;
    if (first) { const tile = S.tile(y); body += tile.svg; y += tile.h + S.gap; }
    return { body, y };
  };
  const pages = []; let rest = [...items]; let first = true;
  while (first || rest.length) {
    let { body, y } = draw(first);
    let placed = 0;
    for (const it of rest) {
      // An item that fits goes here; one taller than a whole page is placed alone and cut by the page edge rule (never happens for a real use case).
      if (y + it.h > bottom && placed > 0) break;
      if (it.type === 'text') {
        const s = it.s; const lines = wrap(s.text, tw, BODY, kind, 400, 99).length; let inner = '';
        if (S.box) inner += S.box(P, y, CW, it.h);
        inner += S.label(s.label, P + pad, y + pad, tw);
        inner += T(P + pad, y + pad + S.labelH + 12, s.text, { size: BODY, fill: S.body, bg: textBg, font: S.bodyFont || S.font, kind, maxW: tw, lines, lh: LH, ctx: `uc ${s.id}` }).svg;
        body += g(s.id, inner);
      } else if (it.type === 'chart') {
        let inner = (S.box ? S.box(P, y, CW, it.h) : '') + S.label('Three-year projection', P + pad, y + pad, tw);
        inner += chart(u, years, P + pad, y + pad + S.labelH, tw, S.chartH, S);
        body += g('value_projection', inner);
      } else if (it.type === 'chips') {
        let inner = (S.box ? S.box(P, y, CW, it.h) : '') + S.label('Data used', P + pad, y + pad, tw);
        chipRows.forEach((row, r) => row.forEach((c) => { inner += S.chipSvg(c.label, P + pad + c.x, y + pad + S.labelH + r * (S.chipH + 8), c.w); }));
        body += g('data_used', inner);
      } else body += S.facts(facts, P, y, CW);
      y += it.h + S.gap; placed += 1;
    }
    rest = rest.slice(placed); first = false;
    // Right to left: the page is mirrored as a whole, and each text is flipped back about its own anchor so the words read normally (core.js rtlMirror).
    if (m.rtl) body = rtlMirror(body, PW);
    pages.push(svgDoc(PW, PH, `<g data-design="${S.id}" data-page="usecase">${body}</g>`, S.font, typeof S.defs === 'function' ? S.defs() : S.defs || ''));
    if (pages.length >= 12) break;
  }
  return pages;
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
