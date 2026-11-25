// Option C "Bold": a data-visual poster. Navy hero, one vivid colour per domain carried through every chart, heavy geometric sans,
// rounded cards on a cool grey canvas, icons in filled circles, bubble scatter (bubble = value), big donut, colourful treemap.
import { t, T, rect, line, circle, icon, svgDoc, money, VERB_ICON, DISCLAIMER, bestInk, runW, arc, has, verbColors, iconName } from '../core.js';
import { ucPage, factCols, NOT_YET } from '../ucPage.js';
import { donut, quadrant, treemapChart } from '../charts.js';

const BODY = "'Avenir Next', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const CATS = ['#FF3621', '#2272B4', '#00A972', '#FFAB00', '#7B52C9', '#00B5C9', '#E8488B', '#98C93C', '#6B7F8A', '#F2803A'];
const light = { mode: 'light', canvas: '#EEF1F4', card: '#FFFFFF', hero: '#1B3139', heroInk: '#FFFFFF', heroMuted: '#B9C7CD', heroAccent: '#FFAB00',
  ink: '#0B1A20', muted: '#4A5A63', grid: '#C9D2D8', track: '#E3E8EC', accentText: '#C42A12', quad: '#FFF1EE' };
const dark = { mode: 'dark', canvas: '#0E1A20', card: '#1B3139', hero: '#14262D', heroInk: '#FFFFFF', heroMuted: '#B9C7CD', heroAccent: '#FFAB00',
  ink: '#F2F5F7', muted: '#AFBEC6', grid: '#3C5560', track: '#2B4550', accentText: '#FF8A75', quad: '#2A2F35' };
const VERB_C0 = { 'AVOID RISK': '#FF3621', 'GROW REVENUE': '#00A972', 'CUT COST': '#2272B4', 'SAVE TIME': '#FFAB00' };
const ink = (c) => bestInk(c, '#0B1A20', '#FFFFFF');
const cap = (s) => s.toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const colorMap = (m) => Object.fromEntries(m.domains.map((d, i) => [d.name, CATS[i % CATS.length]]));
const card = (x, y, w, h, th) => rect(x, y, w, h, th.card, { rx: 16 });
const chip = (cx, cy, r, c, name, s) => circle(cx, cy, r, c) + icon(name, cx - s / 2, cy - s / 2, s, ink(c), 2.2);
const H2 = (x, y, s, th, bg, size = 16) => t(x, y, s, { size, weight: 800, fill: th.ink, bg, font: BODY, ctx: 'h2' });
const SUB = (x, y, s, th, bg, o = {}) => t(x, y, s, { size: 12, fill: th.muted, bg, font: BODY, ctx: 'sub', ...o });

function segMeter(x, y, score, max, c, track, n = 10, w = 7, gap = 2, h = 8) {
  let s = ''; const f = Math.round((score / max) * n);
  for (let i = 0; i < n; i += 1) s += rect(x + i * (w + gap), y, w, h, i < f ? c : track, { rx: 2 });
  return s;
}

function infographic(m, th, { W, H }) {
  const P = 28; const CW = W - 2 * P; const small = H < 1100; const cm = colorMap(m);
  let s = rect(0, 0, W, H, th.canvas);
  // hero
  const hh = small ? 214 : 232;
  s += rect(0, 0, W, hh, th.hero);
  s += `<g clip-path="url(#cHero)">${circle(W - 40, 30, 120, CATS[0], { op: 0.16 }) + circle(W - 120, hh - 10, 60, CATS[3], { op: 0.14 }) + circle(W - 10, hh - 60, 34, CATS[1], { op: 0.25 })}</g>`;
  s += t(P + 4, 38, 'DATABRICKS INSPIRE AI', { size: 12, weight: 800, fill: th.heroAccent, bg: th.hero, ls: 2, font: BODY, ctx: 'brand' });
  s += t(W - P, 38, m.businessName.toUpperCase(), { size: 12, weight: 600, fill: th.heroMuted, bg: th.hero, ls: 1.5, anchor: 'end', font: BODY, ctx: 'brand r' });
  s += t(P + 4, 84, 'Where the value is', { size: 34, weight: 800, fill: th.heroInk, bg: th.hero, font: BODY, ctx: 'title' });
  s += t(P + 4, 108, `${m.total.n} use cases, sized and scored, so you can pick where to start.`, { size: 14, weight: 500, fill: th.heroMuted, bg: th.hero, font: BODY, ctx: 'title sub' });
  const kp = [[m.total.text, 'estimated a year', 'wallet', CATS[3]], [String(m.total.n), 'use cases', 'layers', CATS[0]], [String(m.total.nDomains), 'domains', 'compass', CATS[2]],
    [Math.max(...m.useCases.map((u) => u.score)).toFixed(1), 'top score', 'star', CATS[5]]].filter((k) => k[1] !== 'top score' || has(m, 'inspire_score'));
  const kw = (CW - (kp.length - 1) * 10) / kp.length; const ky = small ? 128 : 136; const kh = small ? 70 : 78;
  kp.forEach(([v, l, ic, c], i) => {
    const x = P + i * (kw + 10);
    s += rect(x, ky, kw, kh, '#FFFFFF', { rx: 14, op: 0.08 });
    s += chip(x + 26, ky + kh / 2, 17, c, ic, 18);
    s += t(x + 52, ky + kh / 2 + 4, v, { size: i === 0 ? 28 : 30, weight: 800, fill: th.heroInk, bg: th.hero, font: BODY, ctx: 'kpi' });
    s += t(x + 52, ky + kh / 2 + 22, l, { size: 12, weight: 600, fill: th.heroMuted, bg: th.hero, font: BODY, ctx: 'kpi l' });
  });
  // treemap card
  let y = hh + 14; const tmh = small ? 196 : 232;
  s += card(P, y, CW, tmh + 46, th);
  s += H2(P + 18, y + 28, 'Yearly value by domain', th, th.card) + SUB(P + CW - 18, y + 28, 'Tile area = value', th, th.card, { anchor: 'end' });
  const items = m.domains.map((d) => ({ name: d.name, value: d.value, text: d.text, icon: d.icon, color: cm[d.name] }));
  s += treemapChart(items, { x: P + 12, y: y + 38, w: CW - 24, h: tmh }, { gap: 4, rx: 10, inkOn: ink, font: BODY, displayFont: BODY, icons: true }).svg;
  y += tmh + 46 + 12;
  // scatter + donut
  const hasV = m.verbs.length > 0; const VERB_C = verbColors(VERB_C0, m.verbs, [CATS[1], CATS[2], CATS[3], CATS[4]]); const lw = hasV ? Math.round(CW * 0.6) : CW; const rw = CW - lw - 12; const ch = small ? 222 : 252;
  s += card(P, y, lw, ch, th) + (hasV ? card(P + lw + 12, y, rw, ch, th) : '');
  s += H2(P + 18, y + 28, 'Score vs value', th, th.card) + SUB(P + lw - 18, y + 28, 'Bubble = value', th, th.card, { anchor: 'end' });
  const vmax = Math.max(...m.useCases.map((u) => u.value.amount));
  s += quadrant(m.useCases, { x: P + 6, y: y + 38, w: lw - 16, h: ch - 58 }, { colorOf: (u) => cm[u.domain], dotStroke: th.card, dotOp: 0.88, axis: th.muted, grid: th.grid,
    ink: th.ink, muted: th.muted, bg: th.card, quadFill: th.quad, quadBg: th.quad, quadInk: th.accentText, mx: m.median.score, my: m.median.value, labelTop: 3, font: BODY, quadRx: 8,
    r: (u) => 3.5 + 11 * Math.sqrt(u.value.amount / vmax) });
  const rx = P + lw + 12;
  if (hasV) {
  s += H2(rx + 18, y + 28, 'What it does', th, th.card);
  const r1 = small ? 48 : 60; const cx = rx + rw / 2; const cy = y + 44 + r1;
  const top = m.verbs[0] || { value: 0, name: '' };
  if (hasV) s += donut(m.verbs.map((v) => ({ name: v.name, value: v.value, color: VERB_C[v.name] })), cx, cy, r1 - (small ? 13 : 18), r1, { gap: 0.05, centerTop: `${Math.round((top.value / m.total.amount) * 100)}%`, centerBottom: cap(top.name), ink: th.ink, muted: th.muted, bg: th.card, font: BODY, displayFont: BODY, centerSize: small ? 19 : 22 });
  let ly = cy + r1 + (small ? 18 : 22);
  m.verbs.forEach((v) => {
    s += chip(rx + 26, ly - 4, 8, VERB_C[v.name], VERB_ICON[v.name], 10);
    s += t(rx + 40, ly, cap(v.name), { size: 12, weight: 600, fill: th.ink, bg: th.card, font: BODY, ctx: 'legend' });
    s += t(rx + rw - 16, ly, money(v.value), { size: 12, weight: 800, fill: th.ink, bg: th.card, anchor: 'end', font: BODY, ctx: 'legend v' });
    ly += small ? 16 : 19;
  });
  }
  y += ch + 12;
  // top use cases
  s += H2(P + 4, y + 18, 'Top use cases by value', th, th.canvas, 17) + SUB(W - P, y + 18, 'Numbers match the chart', th, th.canvas, { anchor: 'end' });
  y += 30;
  const footer = 84; const rowH = 74; const colW = (CW - 12) / 2;
  const rows = Math.max(1, Math.floor((H - y - footer) / (rowH + 10)));
  m.ranked.slice(0, rows * 2).forEach((u, i) => {
    const x = P + (i % 2) * (colW + 12); const yy = y + Math.floor(i / 2) * (rowH + 10); const c = cm[u.domain];
    s += card(x, yy, colW, rowH, th) + rect(x, yy + 12, 5, rowH - 24, c, { rx: 2.5 });
    const d = m.domains.find((q) => q.name === u.domain);
    s += chip(x + 34, yy + 30, 17, c, d.icon, 18);
    s += t(x + 34, yy + 62, `#${i + 1}`, { size: 12, weight: 800, fill: th.ink, bg: th.card, anchor: 'middle', font: BODY, ctx: 'rank' });
    s += T(x + 62, yy + 26, u.short, { size: 13, weight: 700, fill: th.ink, bg: th.card, font: BODY, maxW: colW - 160, lines: 2, lh: 16, ctx: 'uc title' }).svg;
    s += t(x + 62, yy + 62, [u.domain, cap(u.verb)].filter(Boolean).join(' · '), { size: 12, fill: th.muted, bg: th.card, font: BODY, ctx: 'uc meta' });
    s += t(x + colW - 14, yy + 32, u.value.text, { size: 22, weight: 800, fill: th.ink, bg: th.card, anchor: 'end', font: BODY, ctx: 'uc value' });
    if (has(m, 'inspire_score')) s += segMeter(x + colW - 14 - 88, yy + 44, u.score, 10, c, th.track);
    if (has(m, 'inspire_score')) s += t(x + colW - 14, yy + 66, `score ${u.score.toFixed(1)}`, { size: 12, weight: 700, fill: th.muted, bg: th.card, anchor: 'end', font: BODY, ctx: 'uc score' });
  });
  y += rows * (rowH + 10) + 2;
  s += t(P + 4, y + 14, 'How to read', { size: 12, weight: 800, fill: th.ink, bg: th.canvas, font: BODY, ctx: 'how' });
  s += T(P + 88, y + 14, 'One colour per domain in every chart. Tile area and bubble size = yearly value. The shaded corner sits above the median score and value. Score is out of 10.', { size: 12, fill: th.ink, bg: th.canvas, maxW: CW - 92, lines: 2, lh: 15, font: BODY, ctx: 'how' }).svg;
  if (has(m, 'disclaimer')) s += T(P + 4, y + 50, DISCLAIMER, { size: 12, fill: th.muted, bg: th.canvas, maxW: CW - 8, lines: 3, lh: 15, font: BODY, ctx: 'disc' }).svg;
  return svgDoc(W, H, s, BODY, `<clipPath id="cHero"><rect x="0" y="0" width="${W}" height="${hh}"/></clipPath>`);
}

const SW = 1333; const SH = 750;
function deckCover(m, th) {
  const cm = colorMap(m);
  let s = rect(0, 0, SW, SH, th.hero);
  s += t(70, 80, 'DATABRICKS INSPIRE AI', { size: 18, weight: 800, fill: th.heroAccent, bg: th.hero, ls: 3, font: BODY, ctx: 'brand' });
  s += t(70, 190, 'Use case', { size: 72, weight: 800, fill: th.heroInk, bg: th.hero, font: BODY, ctx: 'title' });
  s += t(70, 270, 'portfolio', { size: 72, weight: 800, fill: th.heroInk, bg: th.hero, font: BODY, ctx: 'title' });
  s += t(70, 330, `Prepared for ${m.businessName}`, { size: 26, weight: 600, fill: th.heroMuted, bg: th.hero, font: BODY, ctx: 'for' });
  [[m.total.text, 'estimated a year', 'wallet', CATS[3]], [String(m.total.n), 'use cases', 'layers', CATS[0]], [String(m.total.nDomains), 'domains', 'compass', CATS[2]]].forEach(([v, l, ic, c], i) => {
    const x = 70 + [0, 280, 440][i];
    s += chip(x + 26, 440, 26, c, ic, 26);
    s += t(x, 510, v, { size: 44, weight: 800, fill: th.heroInk, bg: th.hero, font: BODY, ctx: 'kpi' });
    s += t(x, 538, l, { size: 17, weight: 600, fill: th.heroMuted, bg: th.hero, font: BODY, ctx: 'kpi l' });
  });
  s += t(70, 690, 'Estimated value, not a promised value. Your business value team must validate it.', { size: 16, fill: th.heroMuted, bg: th.hero, font: BODY, ctx: 'disc' });
  // art: a big domain ring with an icon chip per domain
  const cx = 1010; const cy = 380; const r1 = 240; const r0 = 150;
  let a = 0; const tot = m.total.amount;
  m.domains.forEach((d) => {
    const da = (d.value / tot) * Math.PI * 2;
    s += `<path d="${arc(cx, cy, r0, r1, a + 0.012, a + da - 0.012)}" fill="${cm[d.name]}"/>`;
    if (da > 0.32) { const mid = a + da / 2; const rr = (r0 + r1) / 2; s += icon(d.icon, cx + rr * Math.sin(mid) - 14, cy - rr * Math.cos(mid) - 14, 28, ink(cm[d.name]), 2.2); }
    a += da;
  });
  s += t(cx, cy + 6, m.total.text, { size: 52, weight: 800, fill: th.heroInk, bg: th.hero, anchor: 'middle', font: BODY, ctx: 'ring' });
  s += t(cx, cy + 40, 'a year, by domain', { size: 18, weight: 600, fill: th.heroMuted, bg: th.hero, anchor: 'middle', font: BODY, ctx: 'ring l' });
  return svgDoc(SW, SH, s, BODY);
}

function deckDomain(m, th, d, idx) {
  const cm = colorMap(m); const c = cm[d.name]; const on = ink(c);
  const ucs = m.ranked.filter((u) => u.domain === d.name);
  let s = rect(0, 0, SW, SH, th.canvas) + rect(0, 0, 500, SH, c);
  s += `<g clip-path="url(#cPanel)">${circle(430, 110, 160, on, { op: 0.08 })}</g>`;
  s += t(60, 80, `DOMAIN ${idx + 1} OF ${m.total.nDomains}`, { size: 17, weight: 800, fill: on, bg: c, ls: 2, font: BODY, ctx: 'eyebrow' });
  s += icon(d.icon, 60, 130, 96, on, 2);
  s += t(60, 330, d.name, { size: 60, weight: 800, fill: on, bg: c, font: BODY, ctx: 'name' });
  s += t(60, 420, d.text, { size: 64, weight: 800, fill: on, bg: c, font: BODY, ctx: 'value' });
  s += t(60, 456, `a year · ${Math.round((d.value / m.total.amount) * 100)}% of all value · ${d.n} use cases`, { size: 18, weight: 600, fill: on, bg: c, font: BODY, ctx: 'value l' });
  s += T(60, 520, d.summary, { size: 17, fill: on, bg: c, font: BODY, maxW: 390, lines: 6, lh: 24, ctx: 'summary' }).svg;
  s += card(540, 50, 733, 650, th);
  s += H2(570, 100, 'Use cases in this domain', th, th.card, 24) + SUB(1243, 100, 'value a year · score', th, th.card, { anchor: 'end', size: 16 });
  const max = Math.max(...ucs.map((u) => u.value.amount));
  ucs.slice(0, 7).forEach((u, i) => {
    const y = 150 + i * 76;
    s += T(570, y + 6, u.short, { size: 17, weight: 700, fill: th.ink, bg: th.card, font: BODY, maxW: 660, lines: 1, ctx: 'row' }).svg;
    s += rect(570, y + 20, 520, 18, th.track, { rx: 9 }) + rect(570, y + 20, Math.max(18, (u.value.amount / max) * 520), 18, c, { rx: 9 });
    s += t(1180, y + 36, u.value.text, { size: 18, weight: 800, fill: th.ink, bg: th.card, anchor: 'end', font: BODY, ctx: 'row v' });
    s += rect(1192, y + 18, 54, 24, th.track, { rx: 12 }) + t(1219, y + 36, u.score.toFixed(1), { size: 16, weight: 800, fill: th.ink, bg: th.track, anchor: 'middle', font: BODY, ctx: 'row s' });
  });
  return svgDoc(SW, SH, s, BODY, '<clipPath id="cPanel"><rect x="0" y="0" width="500" height="750"/></clipPath>');
}

function deckUseCase(m, th, u, idx) {
  const cm = colorMap(m); const c = cm[u.domain]; const d = m.domains.find((q) => q.name === u.domain);
  let s = rect(0, 0, SW, SH, th.canvas) + rect(0, 0, SW, 12, c);
  s += chip(100, 100, 40, c, d.icon, 40);
  s += t(160, 88, `#${idx + 1} · ${u.domain.toUpperCase()} · ${u.subdomain.toUpperCase()}`, { size: 16, weight: 800, fill: th.muted, bg: th.canvas, ls: 1.5, font: BODY, ctx: 'eyebrow' });
  s += T(160, 128, u.short, { size: 38, weight: 800, fill: th.ink, bg: th.canvas, font: BODY, maxW: 1100, lines: 1, ctx: 'title' }).svg;
  // stat tiles
  const tiles = [[u.value.text, 'estimated a year', 'wallet', CATS[3]], [u.score.toFixed(1), 'Inspire score of 10', 'star', CATS[5]], [cap(u.verb), 'what it does', VERB_ICON[u.verb], VERB_C[u.verb]], [u.quality, 'quality', 'badge-check', CATS[2]]];
  tiles.forEach(([v, l, ic, col], i) => {
    const x = 60 + i * 308;
    s += card(x, 170, 290, 110, th) + chip(x + 42, 225, 24, col, ic, 24);
    s += t(x + 80, 228, v, { size: i < 2 ? 36 : 26, weight: 800, fill: th.ink, bg: th.card, font: BODY, ctx: 'tile v' });
    s += t(x + 80, 256, l, { size: 16, weight: 600, fill: th.muted, bg: th.card, font: BODY, ctx: 'tile l' });
  });
  s += card(60, 300, 800, 400, th);
  [['The problem', u.statement, 330], ['The solution', u.solution, 470], ['The value', u.businessValue, 590]].forEach(([l, v, y]) => {
    s += t(90, y + 14, l, { size: 16, weight: 800, fill: th.accentText, bg: th.card, font: BODY, ctx: 'lbl' });
    s += T(90, y + 40, v, { size: 17, fill: th.ink, bg: th.card, font: BODY, maxW: 740, lines: 3, lh: 24, ctx: 'txt' }).svg;
  });
  s += card(880, 300, 393, 400, th);
  s += H2(910, 344, 'Score breakdown', th, th.card, 20);
  [['Priority', u.priorityScore, 10], ['Feasibility', u.feasibility, 5], ['Value', u.valueScore, 5]].forEach(([l, v, max], i) => {
    const y = 380 + i * 70;
    s += t(910, y + 16, l, { size: 17, weight: 700, fill: th.ink, bg: th.card, font: BODY, ctx: 'm' }) + t(1243, y + 16, `${v.toFixed(1)} / ${max}`, { size: 17, weight: 800, fill: th.ink, bg: th.card, anchor: 'end', font: BODY, ctx: 'm v' });
    s += rect(910, y + 28, 333, 14, th.track, { rx: 7 }) + rect(910, y + 28, (v / max) * 333, 14, c, { rx: 7 });
  });
  s += t(910, 610, 'Sponsor', { size: 16, weight: 800, fill: th.muted, bg: th.card, font: BODY, ctx: 'sp' }) + t(910, 640, u.sponsor, { size: 18, weight: 700, fill: th.ink, bg: th.card, font: BODY, ctx: 'sp v' });
  s += t(910, 676, 'Estimated value, not a promise.', { size: 16, fill: th.muted, bg: th.card, font: BODY, ctx: 'disc' });
  return svgDoc(SW, SH, s, BODY);
}

function briefPage1(m, th) {
  const W = 794; const H = 1123; const P = 40; const CW = W - 2 * P; const cm = colorMap(m);
  let s = rect(0, 0, W, H, th.canvas) + rect(0, 0, W, 170, th.hero);
  s += `<g clip-path="url(#cHero)">${circle(W - 30, 20, 110, CATS[0], { op: 0.16 }) + circle(W - 140, 160, 50, CATS[3], { op: 0.16 })}</g>`;
  s += t(P, 46, 'DATABRICKS INSPIRE AI · USE CASE BRIEF', { size: 12, weight: 800, fill: th.heroAccent, bg: th.hero, ls: 2, font: BODY, ctx: 'brand' });
  s += t(P, 98, m.businessName, { size: 36, weight: 800, fill: th.heroInk, bg: th.hero, font: BODY, ctx: 'title' });
  s += t(P, 132, `${m.total.yearText} estimated · ${m.total.n} use cases · ${m.total.nDomains} domains`, { size: 16, weight: 600, fill: th.heroMuted, bg: th.hero, font: BODY, ctx: 'sub' });
  // The App has no executive summary field: with no text the card is left out and the rest moves up.
  const sum = m.executiveSummary ? 0 : 266;
  if (m.executiveSummary) {
    s += card(P, 194, CW, 250, th);
    s += H2(P + 20, 226, 'Summary', th, th.card, 18);
    s += T(P + 20, 254, m.executiveSummary, { size: 13, fill: th.ink, bg: th.card, font: BODY, maxW: CW - 40, lines: 10, lh: 18.5, ctx: 'summary' }).svg;
  }
  s += `<g transform="translate(0 ${-sum})">`;
  s += card(P, 460, CW, 300, th);
  s += H2(P + 20, 492, 'Value by domain', th, th.card, 18);
  const items = m.domains.map((d) => ({ name: d.name, value: d.value, text: d.text, icon: d.icon, color: cm[d.name] }));
  s += treemapChart(items, { x: P + 14, y: 504, w: CW - 28, h: 242 }, { gap: 4, rx: 10, inkOn: ink, font: BODY, displayFont: BODY, icons: true }).svg;
  s += H2(P, 796, 'Start here', th, th.canvas, 18);
  m.ranked.slice(0, 3).forEach((u, i) => {
    const w = (CW - 24) / 3; const x = P + i * (w + 12); const c = cm[u.domain]; const d = m.domains.find((q) => q.name === u.domain);
    s += card(x, 812, w, 158, th) + chip(x + 34, 848, 18, c, d.icon, 18);
    s += t(x + w - 16, 856, u.value.text, { size: 22, weight: 800, fill: th.ink, bg: th.card, anchor: 'end', font: BODY, ctx: 'v' });
    s += T(x + 16, 896, u.short, { size: 13, weight: 700, fill: th.ink, bg: th.card, font: BODY, maxW: w - 30, lines: 2, lh: 17, ctx: 't' }).svg;
    if (has(m, 'inspire_score')) s += segMeter(x + 16, 938, u.score, 10, c, th.track);
    if (has(m, 'inspire_score')) s += t(x + w - 16, 946, u.score.toFixed(1), { size: 12, weight: 800, fill: th.muted, bg: th.card, anchor: 'end', font: BODY, ctx: 's' });
  });
  s += '</g>';
  if (has(m, 'disclaimer')) s += T(P, 1010, DISCLAIMER, { size: 12, fill: th.muted, bg: th.canvas, font: BODY, maxW: CW, lines: 3, lh: 16, ctx: 'disc' }).svg;
  s += t(W - P, 1090, 'Page 1', { size: 12, fill: th.muted, bg: th.canvas, anchor: 'end', font: BODY, ctx: 'foot' });
  return svgDoc(W, H, s, BODY, '<clipPath id="cHero"><rect x="0" y="0" width="794" height="170"/></clipPath>');
}


// REQ-526 part C: the brief use case page in this design (navy hero, one colour per domain, white rounded cards, segmented score meter).
function ucSkin(m, th, u, showScore) {
  const W = 794; const P = 40; const CW = W - 2 * P;
  const di = Math.max(0, m.domains.findIndex((d) => d.name === u.domain)); const c = CATS[di % CATS.length];
  const sub = [u.domain, u.subdomain].filter(Boolean).join(' · ');
  let heroH = 0;
  return {
    id: 'c_bold', P, footH: 64, gap: 12, pad: 10, labelH: 24, chipH: 24, chipPad: 12, chartH: 130, factsH: 68,
    bg: th.canvas, boxBg: th.card, font: BODY, kind: 'sans', body: th.ink,
    defs: () => `<clipPath id="cHero"><rect x="0" y="0" width="${W}" height="${heroH}"/></clipPath>`,
    frame: (n) => rect(0, 0, W, 1123, th.canvas) + t(P, 1092, `${m.businessName} · Databricks Inspire AI`, { size: 12, fill: th.muted, bg: th.canvas, font: BODY, maxW: 560, lines: 1, ctx: 'foot' })
      + t(W - P, 1092, `Page ${n}`, { size: 12, weight: 800, fill: th.muted, bg: th.canvas, anchor: 'end', font: BODY, ctx: 'foot' }),
    head: () => {
      const nm = T(P, 108, u.name, { size: 28, weight: 800, fill: th.heroInk, bg: th.hero, font: BODY, maxW: CW - 70, lines: 3, lh: 34, ctx: 'uc name' });
      heroH = 108 + (nm.lines - 1) * 34 + 30;
      return { h: heroH, svg: rect(0, 0, W, heroH, th.hero) + `<g clip-path="url(#cHero)">${circle(W - 30, 20, 110, c, { op: 0.2 }) + circle(W - 150, heroH - 6, 46, CATS[3], { op: 0.16 })}</g>`
        + t(P, 40, 'DATABRICKS INSPIRE AI · USE CASE BRIEF', { size: 12, weight: 800, fill: th.heroAccent, bg: th.hero, ls: 2, font: BODY, ctx: 'brand' })
        + t(P, 72, [u.id, sub].filter(Boolean).join(' · '), { size: 14, weight: 600, fill: th.heroMuted, bg: th.hero, font: BODY, maxW: CW - 70, lines: 1, ctx: 'uc kicker' }) + nm.svg
        + chip(W - P - 24, 52, 24, c, iconName(u.domain), 24) };
    },
    tile: (y) => {
      const cards = [0, showScore && u.score != null ? 1 : 0, u.verb ? 1 : 0].filter((v, i) => i === 0 || v).length; const w = (CW - 12 * (cards - 1)) / cards; let x = P; let s = '';
      s += rect(x, y, w, 96, th.hero, { rx: 16 }) + rect(x, y, 8, 96, c);
      if (u.value) s += t(x + 24, y + 52, u.value.text, { size: 32, weight: 800, fill: th.heroInk, bg: th.hero, font: BODY, ctx: 'uc value' }) + t(x + 24, y + 76, `${u.value.status || 'estimated'} a year`, { size: 12, fill: th.heroMuted, bg: th.hero, font: BODY, ctx: 'uc value l' });
      else s += t(x + 24, y + 56, NOT_YET, { size: 18, weight: 800, fill: th.heroMuted, bg: th.hero, font: BODY, ctx: 'uc nv' });
      x += w + 12;
      if (showScore && u.score != null) {
        s += card(x, y, w, 96, th) + t(x + 16, y + 28, 'Inspire score', { size: 12, weight: 800, fill: th.muted, bg: th.card, font: BODY, ctx: 'uc score l' }) + segMeter(x + 16, y + 44, u.score, 10, c, th.track, 10, Math.min(14, (w - 32 - 27) / 10), 3, 10);
        s += t(x + 16, y + 82, u.score.toFixed(1), { size: 20, weight: 800, fill: th.ink, bg: th.card, font: BODY, ctx: 'uc score' }) + t(x + 16 + runW(u.score.toFixed(1), 20, 800) + 6, y + 82, 'of 10', { size: 12, fill: th.muted, bg: th.card, font: BODY, ctx: 'uc score of' });
        x += w + 12;
      }
      if (u.verb) s += card(x, y, w, 96, th) + chip(x + 38, y + 48, 22, c, VERB_ICON[u.verb] || 'target', 22) + t(x + 70, y + 42, 'What it does', { size: 12, fill: th.muted, bg: th.card, font: BODY, ctx: 'uc verb l' }) + T(x + 70, y + 62, u.verb, { size: 14, weight: 800, fill: th.ink, bg: th.card, font: BODY, maxW: w - 84, lines: 2, lh: 17, ctx: 'uc verb' }).svg;
      return { h: 96, svg: s };
    },
    label: (text, x, y) => circle(x + 5, y + 9, 5, c) + t(x + 18, y + 14, text, { size: 14, weight: 800, fill: th.ink, bg: th.card, font: BODY, ctx: 'uc label' }),
    box: (x, y, w, h) => card(x, y, w, h, th),
    chipW: (l) => Math.ceil(l.length * 12 * 0.56 + 36),
    chipSvg: (l, x, y, w) => rect(x, y, w, 24, th.track, { rx: 12 }) + circle(x + 12, y + 12, 4, c) + t(x + 24, y + 16, l, { size: 12, fill: th.ink, bg: th.track, font: BODY, ctx: 'chip' }),
    chart: { colors: [CATS[8], c, CATS.filter((k) => k !== c && k !== CATS[8])[3]], bar: 'bars', radius: 6, ink: th.ink, muted: th.muted, grid: th.grid, bg: th.card },
    facts: (facts, x, y, w) => { const cw = (w - 12 * (facts.length - 1)) / facts.length; return facts.map((f, i) => card(x + i * (cw + 12), y, cw, 76, th) + factCols([f], x + i * (cw + 12) + 14, y + 2, cw - 28, { font: BODY }, { bg: th.card, labelFill: th.muted, valueFill: th.ink })).join(''); },
  };
}
const briefUseCasePage = (m, th, u, idx) => ucPage(m, u, idx, ucSkin(m, th, u, has(m, 'inspire_score')));

export default { id: 'c_bold', name: 'C. Bold (Data Poster)', themes: { light, dark }, fonts: { display: BODY, body: BODY }, infographic, deckCover, deckDomain, deckUseCase, briefPage1, briefUseCasePage };
void line;
