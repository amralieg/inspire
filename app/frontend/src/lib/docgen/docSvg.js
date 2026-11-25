// FX-113 (REQ-503): the SVG infographic and brief pages. Every text is XML-escaped; every content block is wrapped in <g data-block="id">.
import { moneyText } from '../valueWizard.js';
import { designOf, toDesignModel } from './designs/model.js';
import { resetLog } from './designs/core.js';

const NS = 'xmlns="http://www.w3.org/2000/svg"';
export const esc = (s) => String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
const has = (m, id) => m.blocks.includes(id);
const NOT_YET = 'not calculated yet';

function wrap(text, max, maxLines = 99) {
  const words = String(text ?? '').split(/\s+/).filter(Boolean);
  const lines = []; let cur = '';
  for (const w of words) {
    if ((cur + ' ' + w).trim().length > max && cur) { lines.push(cur); cur = w; } else cur = (cur + ' ' + w).trim();
  }
  if (cur) lines.push(cur);
  if (lines.length > maxLines) { lines.length = maxLines; lines[maxLines - 1] = `${lines[maxLines - 1].slice(0, Math.max(0, max - 1))}…`; }
  return lines;
}

// Text at (x, y); RTL languages anchor at the right edge of the box [x, x + w].
function txt(m, t, x, y, { size = 14, weight = 400, fill, w = 0, anchor, max, lines = 1, lh } = {}) {
  const ax = anchor || (m.rtl ? 'end' : 'start');
  const px = m.rtl && !anchor ? x + w : x;
  const parts = max ? wrap(t, max, lines) : [String(t ?? '')];
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

const header = (m, theme, W, y0, sub) => `${txt(m, m.businessName || 'Inspire', 48, y0 + 44, { size: 36, weight: 700, fill: theme.ink, w: W - 96 })}${txt(m, sub, 48, y0 + 72, { size: 15, fill: theme.muted, w: W - 96 })}`;

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
  let s = `<g data-block="value_projection">${txt(m, 'Three-year projection', x, y + 22, { size: 18, weight: 700, fill: theme.ink, w })}`;
  if (!Math.max(...likely)) return `${s}${txt(m, `Projection ${NOT_YET}`, x, y + 60, { size: 14, fill: theme.muted, w })}</g>`;
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
  return `${s}</g>`;
}

function valueBars(m, theme, x, y, w) {
  const max = Math.max(...m.useCases.map((u) => u.value?.amount || 0), 1);
  let s = txt(m, 'Value per use case', x, y + 22, { size: 18, weight: 700, fill: theme.ink, w });
  m.useCases.forEach((u, i) => {
    const ry = y + 44 + i * 40; const bw = u.value ? Math.max(8, (u.value.amount / max) * (w - 330)) : 0;
    s += txt(m, u.name, x, ry + 16, { size: 13, fill: theme.ink, w: 200, max: 30, lines: 1 });
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
  s += txt(m, u.name, x + 62, y + 36, { size: 17, weight: 700, fill: theme.ink, w: w - 124, max: Math.floor((w - 124) / 9), lines: 2 });
  const tail = [];
  if (has(m, 'inspire_score') && u.score != null) tail.push(`Score ${u.score.toFixed(1)}`);
  if (u.value) tail.push(u.value.text); else tail.push(NOT_YET);
  s += txt(m, tail.join('  |  '), x + 20, ty + 4, { size: 14, weight: 700, fill: c, w: w - 40 });
  ty += 26;
  const block = (id, label, text, lines = 3) => {
    if (!has(m, id) || !text) return '';
    const out = `<g data-block="${id}">${txt(m, label, x + 20, ty, { size: 12, weight: 700, fill: theme.muted, w: w - 40 })}${txt(m, text, x + 20, ty + 18, { size: 13, fill: theme.ink, w: w - 40, max: Math.floor((w - 40) / 7.2), lines, lh: 18 })}</g>`;
    ty += 24 + 18 * Math.min(lines, wrap(text, Math.floor((w - 40) / 7.2)).length);
    return out;
  };
  s += block('use_case_story', 'USE CASE', u.statement || u.solution);
  s += block('value_story', 'VALUE STORY', u.value ? u.value.story : '');
  s += block('data_used', 'DATA USED', u.tables.join(', '), 2);
  return `${s}</g>`.replace('CARD_H', String(ty - y + 10)) + `<!--h:${ty - y + 10}-->`;
}

// REQ-526: a design theme draws through its design (A4 infographic, brief page 1). With no use case that has a value and a score there is
// nothing for the charts, so the plain renderer below takes over. Old styles never come here.
function designed(m, theme) {
  const design = theme.design && theme.tokens ? designOf(theme.design) : null;
  if (!design) return null;
  const dm = toDesignModel(m);
  return dm.useCases.length ? { design, dm } : null;
}
const rtlRoot = (m, svg) => (m.rtl ? svg.replace(/^<svg /, '<svg direction="rtl" ') : svg);

export function infographicSvg(m, theme) {
  const d = designed(m, theme);
  if (d) { resetLog(); return rtlRoot(m, d.design.infographic(d.dm, theme.tokens, { W: 794, H: 1123 })); }
  const W = 1200; const gap = 24; const cw = (W - 96 - gap) / 2;
  let y = 120; let body = '';
  body += header(m, theme, W, 50, `${m.total.n} use cases | ${m.total.nWithValue} with a calculated value`);
  const k = [['Use cases', String(m.total.n)], ['Total value', m.total.nWithValue ? m.total.text : NOT_YET], ['Calculated', `${m.total.nWithValue} of ${m.total.n}`]];
  const kw = (W - 96 - 2 * gap) / 3;
  k.forEach(([l, v], i) => { body += kpi(m, theme, 48 + i * (kw + gap), y, kw, l, v, i); });
  y += 92 + 36;
  if (has(m, 'value_projection')) { body += projection(m, theme, 48, y, W - 96, 280); y += 300; }
  body += valueBars(m, theme, 48, y, W - 96); y += 44 + m.useCases.length * 40 + 24;
  // Cards in two columns; each row is as tall as its taller card.
  for (let i = 0; i < m.useCases.length; i += 2) {
    const pair = m.useCases.slice(i, i + 2).map((u, j) => card(m, theme, u, i + j, 48 + j * (cw + gap), y, cw));
    const hs = pair.map((c) => Number(/<!--h:(\d+)-->/.exec(c)[1]));
    const rowH = Math.max(...hs);
    body += pair.map((c) => c.replace(/<!--h:\d+-->/, '').replace(/height="\d+"(?= rx)/, `height="${rowH}"`)).join('');
    y += rowH + gap;
  }
  if (has(m, 'disclaimer')) { body += `<g data-block="disclaimer">${txt(m, 'Estimates are AI-generated from your data and strategy. Treat them as a starting point.', 48, y + 14, { size: 12, fill: theme.muted, w: W - 96 })}</g>`; y += 40; }
  const H = y + 20;
  return `<svg ${NS} viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(theme.font)}"${m.rtl ? ' direction="rtl"' : ''}>${defs(theme, 'I')}${backdrop(theme, W, H, 'I')}${body}</svg>`;
}

export function briefPagesSvg(m, theme) {
  const d = designed(m, theme);
  if (d) {
    resetLog();
    // Page 1 is the design's own; the use case pages use the same colours and font through the plain card (blocks honoured there).
    const plain = { ...theme, deco: 'none', shape: 'bar', font: theme.fonts.body };
    const rest = briefUseCasePages(m, plain);
    return [rtlRoot(m, d.design.briefPage1(d.dm, theme.tokens)), ...rest];
  }
  const W = 794; const H = 1123;
  const wrapPage = (id, body) => `<svg ${NS} viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(theme.font)}"${m.rtl ? ' direction="rtl"' : ''}>${defs(theme, id)}${backdrop(theme, W, H, id)}${body}</svg>`;
  const cover = txt(m, m.businessName || 'Inspire', 60, 420, { size: 44, weight: 700, fill: theme.ink, w: W - 120, max: 24, lines: 3, lh: 54 })
    + txt(m, 'Use case brief', 60, 520, { size: 22, fill: theme.accents[0], w: W - 120 })
    + txt(m, `${m.total.n} use cases | ${m.total.nWithValue ? m.total.text : NOT_YET}`, 60, 560, { size: 16, fill: theme.muted, w: W - 120 })
    + mark(theme, 60, 600, 260, 22, theme.accents[0], 0) + mark(theme, 60, 634, 180, 22, theme.accents[1], 1) + mark(theme, 60, 668, 110, 22, theme.accents[2], 2);
  const pages = [wrapPage('C', cover)];
  pages.push(...briefUseCasePages(m, theme));
  return pages;
}

function briefUseCasePages(m, theme) {
  const W = 794; const H = 1123; const pages = [];
  const wrapPage = (id, body) => `<svg ${NS} viewBox="0 0 ${W} ${H}" width="${W}" height="${H}" font-family="${esc(theme.font)}"${m.rtl ? ' direction="rtl"' : ''}>${defs(theme, id)}${backdrop(theme, W, H, id)}${body}</svg>`;
  m.useCases.forEach((u, i) => {
    const sub = { ...m, useCases: [u], total: { ...m.total, n: 1 } };
    const c = card(sub, theme, u, i, 40, 90, W - 80).replace(/<!--h:\d+-->/, '');
    const body = txt(m, m.businessName, 40, 70, { size: 14, fill: theme.muted, w: W - 80 }) + c;
    const proj = has(m, 'value_projection') && u.value && u.value.yearly.length ? projection({ ...sub, total: { ...m.total, currency: u.value.currency } }, theme, 40, 700, W - 80, 260) : '';
    pages.push(wrapPage(`P${i}`, body + proj));
  });
  return pages;
}
