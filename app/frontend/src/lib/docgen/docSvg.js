// FX-113 (REQ-503): the SVG infographic and brief pages. Every text is XML-escaped; every content block is wrapped in <g data-block="id">.
import { moneyText } from '../valueWizard.js';
import { designOf, toDesignModel } from './designs/model.js';
import { scoreInfographic } from './designs/scoreInfographic.js';
import { resetLog, rtlSvg, SPILL, wrap as designWrap, T, rect, svgDoc } from './designs/core.js';
import { paletteOf } from './designs/palette.js';
import { withPanelTiles, splitInfographic } from './designs/panelTiles.js';
import { LB, withLabels } from './docLabels.js';
import { extraParts, partLines } from './docModel.js';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const has = (m, id) => m.blocks.includes(id);
const NOT_YET = 'not calculated yet';
const NO_PROJECTION = 'Calculate value to add the projection';

// Text is never cut: a longer text wraps onto more lines and the caller grows the block.
function wrap(text, max) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  return lines;
}

// Text at (x, y); RTL languages anchor at the right edge of the box [x, x + w].
function txt(m, t, x, y, { size = 14, weight = 400, fill, w = 0, anchor, max, lines = 1, lh } = {}) {
  const ax = anchor || (m.rtl ? 'end' : 'start');
  const px = m.rtl && !anchor ? x + w : x;
  const tt = LB(String(t ?? ''));
  const parts = max ? wrap(tt, max) : [tt];
  const step = lh || size * 1.35;
  const spans = parts.map((p, i) => `<tspan x="${px}" dy="${i ? step : 0}">${esc(p)}</tspan>`).join('');
  return `<text x="${px}" y="${y}" font-size="${size}" font-weight="${weight}" fill="${fill}" text-anchor="${ax}">${spans}</text>`;
}

// One bar in the style's own shape.
function mark(theme, x, y, w, h, fill, i) {
  switch (theme.shape) {
    case 'round': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${Math.min(h / 2, 14)}" fill="${fill}"/>`;
    case 'arch': return `<path d="M${x} ${y + h}V${y + h / 2}Q${x} ${y} ${x + h / 2} ${y}H${x + w - h / 2}Q${x + w} ${y} ${x + w} ${y + h / 2}V${y + h}Z" fill="${fill}"/>`;
    case 'glow': return `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="3" fill="${fill}" filter="url(#glow)"/>`;
    case 'line': return `<rect x="${x}" y="${y + h / 2 - 2}" width="${w}" height="4" fill="${fill}"/><circle cx="${x + w}" cy="${y + h / 2}" r="${6 + (i % 2)}" fill="${fill}"/>`;
    default: return `<rect x="${x}" y="${y}" width="${w}" height="${h}" fill="${fill}"/>`;
  }
}

function defs(theme, id) {
  const g = theme.deco === 'grid' ? `<pattern id="grid${id}" width="24" height="24" patternUnits="userSpaceOnUse"><path d="M24 0H0V24" fill="none" stroke="${theme.accents[1]}" stroke-opacity="0.18"/></pattern>` : '';
  const glow = theme.shape === 'glow' ? '<filter id="glow" x="-30%" y="-30%" width="160%" height="160%"><feGaussianBlur stdDeviation="4" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>' : '';
  return `<defs>${g}${glow}</defs>`;
}

// The page background and the style's decoration.
function backdrop(theme, W, H, id) {
  const a = theme.accents;
  let s = `<rect width="${W}" height="${H}" fill="${theme.bg}"/>`;
  if (theme.deco === 'grid') s += `<rect width="${W}" height="${H}" fill="url(#grid${id})"/>`;
  if (theme.deco === 'blobs') s += `<circle cx="${W - 60}" cy="90" r="150" fill="${a[0]}" fill-opacity="0.16"/><circle cx="40" cy="${Math.min(H - 120, 520)}" r="110" fill="${a[2]}" fill-opacity="0.14"/><circle cx="${W - 120}" cy="${H - 160}" r="130" fill="${a[1]}" fill-opacity="0.14"/>`;
  if (theme.deco === 'band') s += `<rect width="${W}" height="14" fill="${a[0]}"/><rect y="14" width="${W}" height="6" fill="${a[1]}"/>`;
  if (theme.deco === 'rule') s += `<rect x="48" y="40" width="${W - 96}" height="${theme.id === 'gold' ? 3 : 2}" fill="${a[0]}"/>`;
  return s;
}

// RC6-B-12: a long business name wraps to at most two lines and the sub-title sits below the last line, so the two never overlap. Returns the svg and its height.
function header(m, theme, W, y0, sub) {
  const lines = wrap(m.businessName || 'Inspire', Math.floor((W - 96) / (36 * 0.56)), 2);
  const title = lines.map((l, i) => txt(m, l, 48, y0 + 44 + i * 44, { size: 36, weight: 700, fill: theme.ink, w: W - 96 })).join('');
  const dy = (lines.length - 1) * 44;
  return { svg: `${title}${txt(m, sub, 48, y0 + 72 + dy, { size: 15, fill: theme.muted, w: W - 96 })}`, extra: dy };
}

function kpi(m, theme, x, y, w, label, value, i) {
  const c = theme.accents[i % theme.accents.length];
  const edge = theme.shape === 'round' || theme.shape === 'arch' ? 18 : 4;
  return `<g><rect x="${x}" y="${y}" width="${w}" height="92" rx="${edge}" fill="${theme.surface}" stroke="${c}" stroke-opacity="0.5"/>`
    + `<rect x="${x}" y="${y}" width="6" height="92" fill="${c}"/>${txt(m, value, x + 20, y + 50, { size: 32, weight: 700, fill: c, w: w - 40 })}${txt(m, label, x + 20, y + 76, { size: 13, fill: theme.muted, w: w - 40 })}</g>`;
}

// Three-year projection: stacked low / likely / high bars summed over every use case that has a yearly table.
function projection(m, theme, x, y, w, h) {
  const years = [1, 2, 3];
  const sum = (k) => years.map((yr) => m.useCases.reduce((t, u) => t + Number((u.value?.yearly || []).find((r) => Number(r.year) === yr)?.[k] || 0), 0));
  const low = sum('low'); const likely = sum('likely'); const high = sum('high');
  const max = Math.max(...high, ...likely, 1);
  const cur = m.total.currency;
  // RC6-B-12: with no yearly value there is no empty block, only one plain line.
  if (!Math.max(...likely)) return { h: 40, svg: `<g data-block="value_projection">${txt(m, NO_PROJECTION, x, y + 22, { size: 14, fill: theme.muted, w })}</g>` };
  let s = `<g data-block="value_projection">${txt(m, 'Three-year projection', x, y + 22, { size: 18, weight: 700, fill: theme.ink, w })}`;
  const base = y + h - 30; const ch = h - 90; const colW = (w - 40) / 3;
  years.forEach((yr, i) => {
    const bx = x + 20 + i * colW; const bw = colW - 40;
    [['high', high[i], 2], ['likely', likely[i], 0], ['low', low[i], 1]].forEach(([k, v, ci], j) => {
      const bh = Math.max(2, (v / max) * ch); const wd = bw - j * 22;
      s += mark(theme, bx + j * 11, base - bh, wd, bh, theme.accents[ci % theme.accents.length], i + j);
    });
    s += txt(m, `Year ${yr}`, bx, base + 20, { size: 13, fill: theme.muted, w: bw });
    s += txt(m, moneyText(cur, likely[i]), bx, base - (likely[i] / max) * ch - 8, { size: 13, weight: 700, fill: theme.ink, w: bw });
  });
  return { h: h + 20, svg: `${s}</g>` };
}

const barRowH = (u) => Math.max(40, wrap(LB(u.name), 26).length * 18 + 8);
function valueBars(m, theme, x, y, w) {
  const max = Math.max(...m.useCases.map((u) => u.value?.amount || 0), 1);
  let s = txt(m, 'Value per use case', x, y + 22, { size: 18, weight: 700, fill: theme.ink, w });
  let drop = 0;
  m.useCases.forEach((u, i) => {
    const ry = y + 44 + drop; drop += barRowH(u); const bw = u.value ? Math.max(8, (u.value.amount / max) * (w - 330)) : 0;
    s += txt(m, u.name, x, ry + 16, { size: 13, fill: theme.ink, w: 200, max: 26, lh: 18 });
    if (u.value) {
      s += mark(theme, x + 210, ry, bw, 22, theme.accents[i % theme.accents.length], i);
      s += txt(m, u.value.text, x + 218 + bw, ry + 16, { size: 13, weight: 700, fill: theme.ink, w: 100 });
    } else s += txt(m, NOT_YET, x + 210, ry + 16, { size: 13, fill: theme.muted, w: 200 });
  });
  return s;
}

const icon = (theme, x, y, i) => `<g transform="translate(${x} ${y})"><circle cx="16" cy="16" r="16" fill="${theme.accents[i % theme.accents.length]}"/><path d="M9 17l5 5 9-11" fill="none" stroke="${theme.bg}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"/></g>`;

function card(m, theme, u, i, x, y, w) {
  const edge = theme.shape === 'round' || theme.shape === 'arch' ? 18 : theme.shape === 'line' ? 0 : 6;
  const c = theme.accents[i % theme.accents.length];
  let ty = y + 66; let s = `<g data-uc="${esc(u.id)}"><rect x="${x}" y="${y}" width="${w}" height="CARD_H" rx="${edge}" fill="${theme.surface}" stroke="${c}" stroke-opacity="0.45"/>${icon(theme, m.rtl ? x + w - 52 : x + 16, y + 14, i)}`;
  s += txt(m, u.name, x + 62, y + 36, { size: 17, weight: 700, fill: theme.ink, w: w - 124, max: Math.floor((w - 124) / 9) });
  ty += Math.max(0, wrap(LB(u.name), Math.floor((w - 124) / 9)).length - 2) * 23;
  const tail = [];
  if (has(m, 'inspire_score') && u.score != null) tail.push(`Score ${u.score.toFixed(1)}`);
  if (u.value) tail.push(u.value.text); else tail.push(NOT_YET);
  s += txt(m, tail.map((t) => LB(t)).join('  |  '), x + 20, ty + 4, { size: 14, weight: 700, fill: c, w: w - 40 });
  ty += 26;
  const block = (id, label, text, lines = 3) => {
    if (!has(m, id) || !text) return '';
    const out = `<g data-block="${id}">${txt(m, label, x + 20, ty, { size: 12, weight: 700, fill: theme.muted, w: w - 40 })}${txt(m, text, x + 20, ty + 18, { size: 13, fill: theme.ink, w: w - 40, max: Math.floor((w - 40) / 7.2), lines, lh: 18 })}</g>`;
    ty += 24 + 18 * wrap(text, Math.floor((w - 40) / 7.2)).length;
    return out;
  };
  s += block('use_case_story', 'USE CASE', u.statement || u.solution);
  s += block('value_story', 'VALUE STORY', u.value ? u.value.story : '');
  return `${s}</g>`.replace('CARD_H', String(ty - y + 10)) + `<!--h:${ty - y + 10}-->`;
}

// REQ-526: a design theme draws through its design (A4 infographic, brief page 1). With no use case that has a value and a score there is
// nothing for the value charts: the infographic then draws the design's own score infographic (RC7-B-08), the brief takes the plain renderer below.
// Old styles never come here.
function designed(m, theme, { empty = false } = {}) {
  const design = theme.design && theme.tokens ? designOf(theme.design) : null;
  if (!design) return null;
  const dm = toDesignModel(m);
  if (dm.useCases.length) return { design, dm };
  return empty && dm.pageUseCases.length ? { design, dm, noValue: true } : null;
}
const rtlRoot = (m, svg) => (m.rtl ? svg.replace(/^<svg /, '<svg direction="rtl" ') : svg);

// A design infographic or page 1: mirrored as a whole when right to left (use case pages mirror themselves in ucPage).
const designRtl = (m, svg) => (m.rtl ? rtlSvg(svg) : svg);

// REQ-561: with the agent card views the infographic grows a tile per use case that carries every business section of the side panel.
// C26: infographicPagesSvg cuts it into pages of at most three A4 pages (every tile kept); infographicSvg is the same as one tall svg.
const panelPalette = (theme) => (theme.design ? paletteOf(theme.design, theme.tokens) : { page: theme.bg, card: theme.surface, ink: theme.ink, body: theme.ink, muted: theme.muted, accent: theme.accents[0] });
export const infographicSvg = (m, theme, views = null) => withLabels(m.labels, () => {
  const svg = infographicSvgOf(m, theme);
  return views ? withPanelTiles(svg, views, panelPalette(theme), { rtl: m.rtl }) : svg.replace(/<!--cut:\d+-->/g, '');
});
export const infographicPagesSvg = (m, theme, views = null) => splitInfographic(infographicSvg(m, theme, views));
function infographicSvgOf(m, theme) {
  const d = designed(m, theme, { empty: true });
  if (d?.noValue) { resetLog(); return designRtl(m, scoreInfographic(d.dm, theme.tokens, { W: 794 }, { id: theme.design, fonts: d.design.fonts })); }
  if (d) { resetLog(); return designRtl(m, d.design.infographic(d.dm, theme.tokens, { W: 794, H: 1123 })); }
  const W = 1200; const gap = 24; const cw = (W - 96 - gap) / 2;
  let y = 150; let body = '';
  const hd = header(m, theme, W, 50, `${m.total.n} use cases | ${m.total.nWithValue} with a calculated value`);
  body += hd.svg; y += hd.extra;
  const k = [['Use cases', String(m.total.n)], ['Total value', m.total.nWithValue ? m.total.text : NOT_YET], ['Calculated', `${m.total.nWithValue} of ${m.total.n}`]];
  const kw = (W - 96 - 2 * gap) / 3;
  k.forEach(([l, v], i) => { body += kpi(m, theme, 48 + i * (kw + gap), y, kw, l, v, i); });
  y += 92 + 36;
  if (has(m, 'value_projection')) { const pj = projection(m, theme, 48, y, W - 96, 280); body += pj.svg; y += pj.h; }
  body += valueBars(m, theme, 48, y, W - 96); y += 44 + m.useCases.reduce((a, u) => a + barRowH(u), 0) + 24;
  body += `<!--cut:${Math.round(y - 8)}-->`; // C26: where the infographic may be cut into pages
  // Cards in two columns; each row is as tall as its taller card.
  for (let i = 0; i < m.useCases.length; i += 2) {
    const pair = m.useCases.slice(i, i + 2).map((u, j) => card(m, theme, u, i + j, 48 + j * (cw + gap), y, cw));
    const hs = pair.map((c) => Number(/<!--h:(\d+)-->/.exec(c)[1]));
    const rowH = Math.max(...hs);
    body += pair.map((c) => c.replace(/<!--h:\d+-->/, '').replace(/height="\d+"(?= rx)/, `height="${rowH}"`)).join('');
    y += rowH + gap;
    body += `<!--cut:${Math.round(y - gap / 2)}-->`;
  }
  if (has(m, 'disclaimer')) { body += `<g data-block="disclaimer">${txt(m, 'Estimates are AI-generated from your data and strategy. Treat them as a starting point.', 48, y + 14, { size: 12, fill: theme.muted, w: W - 96 })}</g>`; y += 40; }
  const H = y + 20;
  return `<svg ${NS} viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(theme.font)}"${m.rtl ? ' direction="rtl"' : ''}>${defs(theme, 'I')}${backdrop(theme, W, H, 'I')}${body}</svg>`;
}

// The part of the executive summary that did not fit page 1 (kept in SPILL by the design) continues in full on one or more pages in the design's own palette.
function summaryPages(d, theme) {
  const text = SPILL.join(' '); if (!text) return [];
  const P = 48; const W = 794; const H = 1123; const size = 14; const lh = 21; const per = Math.floor((H - 2 * 110) / lh);
  const th = paletteOf(theme.design, theme.tokens); const body = d.design.fonts.body;
  const lines = designWrap(LB(text), W - 2 * P, size, 'sans', 400); const out = [];
  for (let i = 0; i < lines.length; i += per) {
    const head = T(P, 80, LB('Executive summary (continued)'), { size: 20, weight: 700, fill: th.ink, bg: th.page, font: body, ctx: 'summary head' }).svg;
    out.push(svgDoc(W, H, rect(0, 0, W, H, th.page) + head + T(P, 130, lines.slice(i, i + per).join(' '), { size, fill: th.body, bg: th.page, font: body, maxW: W - 2 * P, lh, ctx: 'summary cont' }).svg, body));
  }
  return out;
}

export const briefPagesSvg = (m, theme) => withLabels(m.labels, () => briefPagesSvgOf(m, theme));
function briefPagesSvgOf(m, theme) {
  const d = designed(m, theme);
  if (d) {
    resetLog();
    // Page 1 and every use case page are the design's own (use case pages carry data-design); a use case with no value says "not calculated yet".
    const pages = d.dm.pageUseCases.flatMap((u, i) => d.design.briefUseCasePage(d.dm, theme.tokens, u, i));
    const page1 = designRtl(m, d.design.briefPage1(d.dm, theme.tokens));
    return [page1, ...summaryPages(d, theme).map((p) => rtlRoot(m, p)), ...pages.map((p) => rtlRoot(m, p))];
  }
  const W = 794; const H = 1123;
  const wrapPage = (id, body) => `<svg ${NS} viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(theme.font)}"${m.rtl ? ' direction="rtl"' : ''}>${defs(theme, id)}${backdrop(theme, W, H, id)}${body}</svg>`;
  const cover = txt(m, m.businessName || 'Inspire', 60, 420, { size: 44, weight: 700, fill: theme.ink, w: W - 120, max: 24, lines: 3, lh: 54 })
    + txt(m, 'Use case brief', 60, 520, { size: 22, fill: theme.accents[0], w: W - 120 })
    + txt(m, `${LB(`${m.total.n} use cases`)} | ${m.total.nWithValue ? m.total.text : LB(NOT_YET)}`, 60, 560, { size: 16, fill: theme.muted, w: W - 120 })
    + mark(theme, 60, 600, 260, 22, theme.accents[0], 0) + mark(theme, 60, 634, 180, 22, theme.accents[1], 1) + mark(theme, 60, 668, 110, 22, theme.accents[2], 2);
  const pages = [wrapPage('C', cover)];
  pages.push(...briefUseCasePages(m, theme));
  return pages;
}

// C23: one page per use case with every field in full (the infographic card above is the short summary). The page grows in height with the text.
function briefUseCasePages(m, theme) {
  const W = 794; const X = 40; const IW = W - 2 * X; const MAX = Math.floor(IW / 7.2); const LH = 18;
  return m.useCases.map((u, i) => {
    const sub = { ...m, useCases: [u], total: { ...m.total, n: 1 } };
    let y = 70; let body = txt(m, m.businessName, X, y, { size: 14, fill: theme.muted, w: IW });
    const c = theme.accents[i % theme.accents.length];
    y += 40;
    const title = wrap(LB(u.name), Math.floor(IW / 9.5));
    body += txt(m, u.name, X, y, { size: 22, weight: 700, fill: theme.ink, w: IW, max: Math.floor(IW / 9.5), lines: 99, lh: 28 });
    y += 28 * title.length + 4;
    const tail = [];
    if (has(m, 'inspire_score') && u.score != null) tail.push(`Score ${u.score.toFixed(1)}`);
    tail.push(u.value ? u.value.text : NOT_YET);
    body += txt(m, tail.map((t) => LB(t)).join('  |  '), X, y, { size: 15, weight: 700, fill: c, w: IW });
    y += 30;
    const part = (id, label, lines) => {
      const rows = lines.flatMap((l) => wrap(LB(l), MAX));
      if (!has(m, id) || !rows.length) return;
      const tx = m.rtl ? X + IW : X;
      const spans = rows.map((r, k) => `<tspan x="${tx}" dy="${k ? LH : 0}">${esc(r)}</tspan>`).join('');
      body += `<g data-block="${id}">${txt(m, label, X, y, { size: 12, weight: 700, fill: theme.muted, w: IW })}<text x="${tx}" y="${y + 20}" font-size="13" fill="${theme.ink}" text-anchor="${m.rtl ? 'end' : 'start'}">${spans}</text></g>`;
      y += 20 + LH * rows.length + 14;
    };
    part('use_case_story', 'The use case', [u.statement]);
    part('use_case_story', 'The solution', [u.solution]);
    part('use_case_story', 'Business value', [u.businessValue]);
    [['Sponsor', u.sponsor], ['Beneficiary', u.beneficiary], ['Technique', u.technique]].forEach(([l, v]) => part('use_case_story', l, v ? [v] : []));
    extraParts(u).forEach(([l, items]) => part('use_case_story', l, partLines(items)));
    part('value_story', 'Value story', u.value?.story ? [u.value.story] : []);
    if (has(m, 'value_projection') && u.value && u.value.yearly.length) {
      body += projection({ ...sub, total: { ...m.total, currency: u.value.currency } }, theme, X, y, IW, 260).svg; y += 280;
    }
    const H = Math.max(1123, y + 30);
    return `<svg ${NS} viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(theme.font)}"${m.rtl ? ' direction="rtl"' : ''}>${defs(theme, `P${i}`)}${backdrop(theme, W, H, `P${i}`)}${body}</svg>`;
  });
}
