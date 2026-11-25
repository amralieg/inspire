// Option A "Original": the agent's own document system (teal + sand + gold, Fraunces display over Inter body, coral eyebrows, gold rule,
// rings art on a teal gradient cover), rendered as a graphic-led infographic. Fixes: coral and gold text darkened or lightened to 4.5:1,
// no 8.6pt micro text, real charts (bars, donut, quadrant) instead of chips only, value and score on every card.
import { t, T, rect, line, circle, icon, svgDoc, textW, runW, money, VERB_ICON, DISCLAIMER, wrap, has, verbColors, iconName } from '../core.js';
import { ucPage, factCols, NOT_YET } from '../ucPage.js';
import { hbars, donut, legend, quadrant, meter } from '../charts.js';

const DISPLAY = "Fraunces, 'Iowan Old Style', Georgia, serif";
const BODY = "Inter, 'Helvetica Neue', Arial, sans-serif";

const light = {
  mode: 'light', page: '#FFFFFF', card: '#FFFFFF', sand: '#F6F0E4', sand2: '#EFE7D6', line: '#E4DCCB', ink: '#1F2A33', body: '#3A454E', muted: '#5F6B76',
  teal: '#0F5E5A', tealDark: '#0B4642', tealMid: '#13746E', mint: '#DCEFEC', mint2: '#BFE3DF', coral: '#E2725B', coralText: '#A8452F', gold: '#C9A24B',
  goldText: '#E9CF8C', goldInk: '#3A2B06', green: '#1F9D55', heroInk: '#FFFFFF', heroMuted: '#DCEFEC', quadFill: '#DCEFEC', quadInk: '#0B4642', barTrack: '#EFE7D6', onTeal: '#FFFFFF',
};
const dark = {
  ...light, mode: 'dark', page: '#0E2322', card: '#15302F', sand: '#173634', sand2: '#21403E', line: '#2A4C4A', ink: '#F2EEE6', body: '#D5DFDC', muted: '#A9BCB8',
  teal: '#3FA597', tealMid: '#5DBFB2', coral: '#E8836D', coralText: '#F09A86', gold: '#D9B65E', quadFill: '#1D4A47', quadInk: '#BFEDE5', barTrack: '#21403E', onTeal: '#0E2322',
};
const VERB_COLOR = (th) => ({ 'GROW REVENUE': th.teal, 'CUT COST': th.gold, 'AVOID RISK': th.coral, 'SAVE TIME': th.green });

const defs = (th) => `<linearGradient id="aHero" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${th.tealDark}"/><stop offset="1" stop-color="#0F5E5A"/></linearGradient>`
  + `<linearGradient id="aBar" x1="0" x2="1"><stop offset="0" stop-color="${th.teal}"/><stop offset="1" stop-color="${th.tealMid}"/></linearGradient>`
  + `<linearGradient id="aBand" x1="0" x2="1"><stop offset="0" stop-color="${th.teal}"/><stop offset=".62" stop-color="${th.tealMid}"/><stop offset="1" stop-color="${th.gold}"/></linearGradient>`;

// The agent's rings art (from _doc_art_svg) scaled into a box.
function rings(x, y, s, gold) {
  const c = [[470, 110, 150, 0.18], [470, 110, 110, 0.14], [470, 110, 70, 0.12], [350, 40, 120, 0.1], [560, 260, 140, 0.1], [300, 220, 60, 0.1], [520, 10, 50, 0.14]];
  return `<g transform="translate(${x} ${y}) scale(${s})">${c.map(([cx, cy, r, op]) => `<circle cx="${cx}" cy="${cy}" r="${r}" fill="none" stroke="#FFFFFF" stroke-opacity="${op}" stroke-width="1.4"/>`).join('')}<circle cx="505" cy="62" r="24" fill="${gold}" fill-opacity=".9"/></g>`;
}
function wordmark(x, y, size, on, th, light = true) {
  const a = 'Databricks '; const w = runW(a, size);
  return circle(x + 4, y - size * 0.32, size * 0.32, th.gold) + t(x + 13, y, a, { size, fill: light ? th.heroMuted : th.muted, bg: on, font: BODY, ctx: 'wordmark' })
    + t(x + 13 + w, y, 'Inspire AI', { size, weight: 700, fill: light ? th.heroInk : th.teal, bg: on, font: BODY, ctx: 'wordmark' });
}
const eyebrow = (x, y, s, th, bg, o = {}) => t(x, y, s, { size: 12, weight: 700, fill: o.fill || th.coralText, bg, caps: true, ls: 1.6, font: BODY, ctx: 'eyebrow', ...o });
const head = (x, y, s, th, bg, size = 17) => t(x, y, s, { size, weight: 700, fill: th.ink, bg, font: DISPLAY, kind: 'serif', ctx: 'heading' });

function ucCard(u, i, x, y, w, h, th, m) {
  const elite = i === 0;
  let s = rect(x, y, w, h, th.card, { rx: 12, stroke: th.line });
  s += rect(x + 12, y + 12, 30, 30, elite ? th.gold : th.teal, { rx: 8 });
  s += t(x + 27, y + 32, String(i + 1), { size: 15, weight: 700, fill: elite ? th.goldInk : th.onTeal, bg: elite ? th.gold : th.teal, anchor: 'middle', font: DISPLAY, ctx: 'badge' });
  s += icon(VERB_ICON[u.verb], x + w - 30, y + 14, 16, th.coralText, 2);
  s += t(x + 52, y + 23, u.domain, { size: 12, weight: 700, fill: th.coralText, bg: th.card, caps: true, ls: 1, maxW: w - 90, lines: 1, font: BODY, ctx: 'card kicker' });
  s += t(x + 52, y + 39, u.verb, { size: 12, fill: th.muted, bg: th.card, caps: true, ls: 0.6, font: BODY, ctx: 'card verb' });
  s += t(x + 12, y + 62, u.short, { size: 14, weight: 700, fill: th.ink, bg: th.card, maxW: w - 24, lines: 2, lh: 17, font: DISPLAY, kind: 'serif', ctx: 'card title' });
  s += line(x + 12, y + h - 30, x + w - 12, y + h - 30, th.line, 1);
  s += t(x + 12, y + h - 11, u.value.yearText, { size: 14, weight: 700, fill: th.mode === 'dark' ? th.tealMid : th.teal, bg: th.card, font: BODY, ctx: 'card value' });
  if (has(m, 'inspire_score')) s += t(x + w - 12, y + h - 11, `Score ${u.score.toFixed(1)}`, { size: 12, weight: 700, fill: th.body, bg: th.card, anchor: 'end', font: BODY, ctx: 'card score' });
  return s;
}

function infographic(m, th, { W, H }) {
  const P = 36; const CW = W - 2 * P; const small = H < 1100;
  const h0 = small ? 238 : 262;
  let s = rect(0, 0, W, H, th.page);
  // hero band
  s += rect(0, 0, W, h0, 'url(#aHero)') + rings(W - 330, -40, 0.62, th.gold);
  s += wordmark(P, 42, 12, '#0B4642', th);
  s += t(W - P, 42, 'Use case portfolio', { size: 12, weight: 700, fill: th.heroMuted, bg: '#0F5E5A', caps: true, ls: 1.6, anchor: 'end', font: BODY, ctx: 'hero tag' });
  s += eyebrow(P, 86, 'Value at a glance', th, '#0B4642', { fill: th.heroMuted });
  s += t(P, 124, m.businessName, { size: 36, weight: 700, fill: '#FFFFFF', bg: '#0B4642', font: DISPLAY, kind: 'serif', maxW: CW - 120, lines: 1, ctx: 'hero title' });
  s += t(P, 150, `${m.total.n} use cases across ${m.total.nDomains} domains, ranked by yearly value`, { size: 14, fill: th.heroMuted, bg: '#0F5E5A', font: BODY, ctx: 'hero sub' });
  const kpis = [['Total yearly value', m.total.text, 'wallet', true], ['Use cases', String(m.total.n), 'layers'], ['Domains', String(m.total.nDomains), 'compass'], ['Top Inspire score', Math.max(...m.useCases.map((u) => u.score)).toFixed(1), 'star']].filter((k) => k[0] !== 'Top Inspire score' || has(m, 'inspire_score'));
  const kw = (CW - (kpis.length - 1) * 12) / kpis.length; const ky = small ? 166 : 176; const kh = small ? 60 : 66;
  kpis.forEach(([l, v, ic, gold], i) => {
    const x = P + i * (kw + 12);
    s += rect(x, ky, kw, kh, '#FFFFFF', { rx: 14, op: 0.1, stroke: '#FFFFFF', sw: 1 }).replace('stroke="#FFFFFF"', 'stroke="#FFFFFF" stroke-opacity=".26"');
    s += t(x + 14, ky + (small ? 30 : 36), v, { size: small ? 22 : 28, weight: 700, fill: gold ? th.goldText : '#FFFFFF', bg: '#0F5E5A', font: DISPLAY, kind: 'serif', ctx: 'kpi value' });
    s += t(x + 14, ky + kh - 10, l, { size: 12, fill: th.heroMuted, bg: '#0F5E5A', font: BODY, ctx: 'kpi label' });
    s += icon(ic, x + kw - 30, ky + 12, 16, th.heroMuted, 1.8);
  });
  // section 1: value by domain + donut by verb
  let y = h0 + 20;
  const hasV = m.verbs.length > 0; const lw = hasV ? 456 : CW; const rh = 20; const nd = Math.min(m.domains.length, 9);
  const h1 = Math.max(50 + nd * rh + 10, hasV ? 58 + 92 + 26 + m.verbs.length * 18 : 0);
  s += rect(P, y, lw, h1, th.card, { rx: 14, stroke: th.line });
  s += eyebrow(P + 16, y + 22, 'Where the value sits', th, th.card) + head(P + 16, y + 42, 'Yearly value by domain', th, th.card, 16);
  const bars = hbars(m.domains.slice(0, nd).map((d) => ({ label: d.name, value: d.value, text: d.text, icon: d.icon })), { x: P + 16, y: y + 50, w: lw - 32 },
    { rowH: rh, barH: 9, labelW: 118, valueW: 60, track: th.barTrack, fill: () => 'url(#aBar)', ink: th.ink, bg: th.card, icon: true, iconC: th.mode === 'dark' ? th.tealMid : th.teal, font: BODY });
  s += bars.svg;
  const rx = P + lw + 14; const rw = CW - lw - 14;
  const vc = verbColors(VERB_COLOR(th), m.verbs, [th.teal, th.gold, th.coral, th.green, th.tealMid]);
  if (hasV) {
  s += rect(rx, y, rw, h1, th.sand, { rx: 14 });
  s += eyebrow(rx + 16, y + 22, 'Value verb', th, th.sand) + head(rx + 16, y + 42, 'What the value does', th, th.sand, 16);
  const parts = m.verbs.map((v) => ({ name: v.name, value: v.value, color: vc[v.name] }));
  const r1 = 46; const cy = y + 58 + r1;
  s += donut(parts, rx + 16 + r1, cy, r1 - 14, r1, { gap: 0.03 });
  const top = m.verbs[0];
  s += t(rx + 32 + 2 * r1, cy - 8, `${Math.round((top.value / m.total.amount) * 100)}%`, { size: 26, weight: 700, fill: th.ink, bg: th.sand, font: DISPLAY, kind: 'serif', ctx: 'donut big' });
  s += T(rx + 32 + 2 * r1, cy + 12, `of the value is to ${top.name.toLowerCase()}`, { size: 12, fill: th.body, bg: th.sand, maxW: rw - 48 - 2 * r1, lines: 2, lh: 15, font: BODY, ctx: 'donut note' }).svg;
  s += legend(m.verbs.map((v) => ({ name: v.name.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), color: vc[v.name], text: `${v.n} · ${money(v.value)}` })), rx + 16, cy + r1 + 26, { rowH: 18, ink: th.ink, bg: th.sand, w: rw - 32, font: BODY });
  }
  y += h1 + 16;
  // section 2: quadrant
  const h2 = small ? 166 : 186;
  s += rect(P, y, CW, h2, th.card, { rx: 14, stroke: th.line });
  s += eyebrow(P + 16, y + 22, 'Where to start', th, th.card) + head(P + 16, y + 42, 'Inspire score against yearly value', th, th.card, 16);
  s += t(W - P - 16, y + 22, 'Dot colour = value verb', { size: 12, fill: th.muted, bg: th.card, anchor: 'end', font: BODY, ctx: 'quad key' });
  s += quadrant(m.useCases, { x: P + 16, y: y + 52, w: CW - 32, h: h2 - 70 }, { colorOf: (u) => vc[u.verb], axis: th.line, grid: th.muted, ink: th.ink, muted: th.muted, bg: th.card,
    quadFill: th.quadFill, quadBg: th.quadFill, quadInk: th.quadInk, mx: m.median.score, my: m.median.value, labelTop: 3, font: BODY, quadRx: 8, r: (u) => 4 + Math.sqrt(u.value.amount / 1e5) * 1.6 });
  y += h2 + 18;
  // section 3: top use cases
  s += eyebrow(P, y + 4, 'Top use cases', th, th.page) + t(P + runW('Top use cases', 12, 700, 1.6, true) + 12, y + 4, 'numbered as on the chart above, by yearly value', { size: 12, fill: th.muted, bg: th.page, font: BODY, ctx: 'sec note' });
  s += rect(P, y + 12, 54, 3, th.gold, { rx: 2 });
  y += 26;
  const footer = 92; const ch = 112; const gap = 12;
  const rows = Math.max(1, Math.floor((H - y - footer + gap) / (ch + gap)));
  const cw = (CW - 2 * gap) / 3;
  m.ranked.slice(0, rows * 3).forEach((u, i) => { s += ucCard(u, i, P + (i % 3) * (cw + gap), y + Math.floor(i / 3) * (ch + gap), cw, ch, th, m); });
  y += rows * (ch + gap) + 2;
  // how to read + disclaimer
  s += rect(P, y, CW, 1, th.line);
  s += t(P, y + 20, 'How to read', { size: 12, weight: 700, fill: th.ink, bg: th.page, font: BODY, ctx: 'legend head' });
  s += t(P + 84, y + 20, 'Bar = yearly value per domain. Dot size = yearly value. Dashed lines = median score and value. Score = Inspire score out of 10.', { size: 12, fill: th.body, bg: th.page, maxW: CW - 84, lines: 2, lh: 15, font: BODY, ctx: 'legend' });
  if (has(m, 'disclaimer')) s += T(P, y + 52, DISCLAIMER, { size: 12, fill: th.muted, bg: th.page, maxW: CW, lines: 3, lh: 15, italic: true, font: BODY, ctx: 'disclaimer' }).svg;
  return svgDoc(W, H, s, BODY, defs(th));
}

// ---------- deck (1333 x 750 = 13.33 x 7.5 in at 100 px per inch, pptxgenjs LAYOUT_WIDE) ----------
const SW = 1333; const SH = 750;
function deckCover(m, th) {
  let s = rect(0, 0, SW, SH, 'url(#aHero)');
  [[890, 25, 420, 0.08], [1030, 45, 270, 0.1], [820, 360, 230, 0.07], [1070, 460, 250, 0.08]].forEach(([x, y, d, op]) => { s += circle(x + d / 2, y + d / 2, d / 2, '#FFFFFF', { op }); });
  s += circle(1136, 156, 31, th.gold, { op: 0.9 });
  s += wordmark(75, 70, 20, '#0B4642', th);
  s += t(75, 132, 'Use case catalog · November 2026', { size: 17, weight: 700, fill: th.heroMuted, bg: '#0B4642', caps: true, ls: 2, font: BODY, ctx: 'cover kick' });
  s += T(75, 210, 'Data and AI use cases, ranked by value', { size: 56, weight: 700, fill: '#FFFFFF', bg: '#0B4642', maxW: 780, lines: 2, lh: 64, font: DISPLAY, kind: 'serif', ctx: 'cover title' }).svg;
  s += t(75, 362, 'Prepared for', { size: 20, fill: th.heroMuted, bg: '#0F5E5A', font: BODY, ctx: 'cover for' });
  s += t(75, 410, m.businessName, { size: 44, weight: 700, fill: th.goldText, bg: '#0F5E5A', font: DISPLAY, kind: 'serif', ctx: 'cover biz' });
  [[m.total.text, 'estimated value a year'], [String(m.total.n), 'use cases'], [String(m.total.nDomains), 'domains']].forEach(([v, l], i) => {
    const x = 75 + i * 285;
    s += rect(x, 500, 265, 130, '#FFFFFF', { rx: 14, op: 0.12 });
    s += t(x + 22, 566, v, { size: 46, weight: 700, fill: i ? '#FFFFFF' : th.goldText, bg: '#0F5E5A', font: DISPLAY, kind: 'serif', ctx: 'cover kpi' });
    s += t(x + 22, 606, l, { size: 17, weight: 700, fill: th.heroMuted, bg: '#0F5E5A', font: BODY, ctx: 'cover kpi l' });
  });
  s += t(75, 700, 'Generated by Databricks Inspire AI from your data and strategy', { size: 16, fill: th.heroMuted, bg: '#0F5E5A', font: BODY, ctx: 'cover foot' });
  return svgDoc(SW, SH, s, BODY, defs(th));
}

function deckDomain(m, th, d, idx) {
  const ucs = m.ranked.filter((u) => u.domain === d.name);
  let s = rect(0, 0, SW, SH, th.page) + rect(0, 0, SW, 260, '#0F5E5A') + circle(1205, 130, 115, '#FFFFFF', { op: 0.08 });
  s += t(60, 120, String(idx + 1).padStart(2, '0'), { size: 84, weight: 700, fill: th.mint2, bg: '#0F5E5A', font: DISPLAY, kind: 'serif', ctx: 'numeral' });
  s += icon(d.icon, 200, 64, 48, th.mint2, 1.6);
  s += t(60, 168, `Domain ${String(idx + 1).padStart(2, '0')}`, { size: 17, weight: 700, fill: '#F3C9BD', bg: '#0F5E5A', caps: true, ls: 2, font: BODY, ctx: 'kick' });
  s += t(60, 218, d.name, { size: 40, weight: 700, fill: '#FFFFFF', bg: '#0F5E5A', font: DISPLAY, kind: 'serif', ctx: 'title' });
  const share = Math.round((d.value / m.total.amount) * 100);
  [[d.text, 'yearly value'], [String(d.n), 'use cases'], [`${share}%`, 'of all value'], [d.best.toFixed(1), 'best Inspire score']].forEach(([v, l], i) => {
    const x = 760 + (i % 2) * 260; const y = 50 + Math.floor(i / 2) * 104;
    s += rect(x, y, 250, 94, '#FFFFFF', { rx: 12 });
    s += t(x + 125, y + 50, v, { size: 32, weight: 700, fill: '#0F5E5A', bg: '#FFFFFF', anchor: 'middle', font: DISPLAY, kind: 'serif', ctx: 'tile' });
    s += t(x + 125, y + 78, l, { size: 16, fill: '#5F6B76', bg: '#FFFFFF', anchor: 'middle', font: BODY, ctx: 'tile l' });
  });
  s += t(60, 310, 'Domain overview', { size: 20, weight: 700, fill: th.teal, bg: th.page, font: DISPLAY, kind: 'serif', ctx: 'h' });
  s += T(60, 342, d.summary, { size: 16, fill: th.body, bg: th.page, maxW: 600, lines: 8, lh: 23, font: BODY, ctx: 'overview' }).svg;
  s += rect(700, 285, 573, 420, th.sand, { rx: 14 });
  s += t(724, 322, 'Value per use case', { size: 20, weight: 700, fill: th.ink, bg: th.sand, font: DISPLAY, kind: 'serif', ctx: 'h' });
  const bars = hbars(ucs.slice(0, 7).map((u) => ({ label: u.short, value: u.value.amount, text: u.value.text, icon: VERB_ICON[u.verb] })), { x: 724, y: 340, w: 525 },
    { rowH: 50, barH: 14, labelW: 290, valueW: 70, track: th.sand2, fill: () => 'url(#aBar)', ink: th.ink, bg: th.sand, size: 16, icon: true, iconC: th.coralText, font: BODY });
  s += bars.svg;
  s += t(724, 690, 'Icon = value verb. Values are estimates; see the disclaimer slide.', { size: 16, fill: th.muted, bg: th.sand, font: BODY, ctx: 'note' });
  s += t(60, 700, `${m.businessName} · Databricks Inspire AI`, { size: 16, fill: th.muted, bg: th.page, font: BODY, ctx: 'foot' });
  return svgDoc(SW, SH, s, BODY, defs(th));
}

function deckUseCase(m, th, u, idx) {
  let s = rect(0, 0, SW, SH, th.page);
  s += rect(60, 50, 82, 82, th.gold, { rx: 14 }) + t(101, 105, String(idx + 1), { size: 36, weight: 700, fill: th.goldInk, bg: th.gold, anchor: 'middle', font: DISPLAY, ctx: 'badge' });
  s += t(160, 72, `${u.id} · ${u.domain} · ${u.subdomain}`, { size: 17, weight: 700, fill: th.coralText, bg: th.page, caps: true, ls: 1.4, font: BODY, ctx: 'kick' });
  s += t(160, 118, u.short, { size: 34, weight: 700, fill: th.ink, bg: th.page, font: DISPLAY, kind: 'serif', maxW: 1110, lines: 1, ctx: 'title' });
  s += rect(60, 160, 1213, 5, 'url(#aBand)', { rx: 3 });
  const tiles = [[u.value.yearText, 'Estimated yearly value'], [`${u.score.toFixed(1)} / 10`, 'Inspire score'], [u.quality, 'Quality'], [u.verb.toLowerCase().replace(/^\w/, (c) => c.toUpperCase()), 'Value verb']];
  const tw = (1213 - 30) / 4;
  tiles.forEach(([v, l], i) => {
    const x = 60 + i * (tw + 10);
    s += rect(x, 184, tw, 104, th.sand, { rx: 12 });
    s += t(x + tw / 2, 236, v, { size: 28, weight: 700, fill: th.teal, bg: th.sand, anchor: 'middle', font: DISPLAY, kind: 'serif', ctx: 'tile' });
    s += t(x + tw / 2, 268, l, { size: 16, fill: th.muted, bg: th.sand, anchor: 'middle', font: BODY, ctx: 'tile l' });
    if (i === 1) s += meter(x + 40, 278, tw - 80, 5, u.score, th.teal, th.sand2);
  });
  let y = 330;
  [['Statement', u.statement], ['Solution', u.solution.replace(/`/g, '')], ['Business value', u.businessValue.replace(/`/g, '')]].forEach(([l, v]) => {
    s += t(60, y, l, { size: 16, weight: 700, fill: th.teal, bg: th.page, caps: true, ls: 1, font: BODY, ctx: 'nar l' });
    const r = T(60, y + 26, v, { size: 16, fill: th.body, bg: th.page, maxW: 720, lines: 3, lh: 22, font: BODY, ctx: 'nar' });
    s += r.svg; y += 40 + r.h;
  });
  s += rect(815, 310, 458, 395, th.sand, { rx: 14 });
  let fy = 346;
  [['Sponsor', u.sponsor], ['Beneficiary', u.beneficiary], ['Technique', u.technique], ['Data used', u.tables.join(', ')]].forEach(([l, v]) => {
    s += t(840, fy, l, { size: 16, weight: 700, fill: th.teal, bg: th.sand, font: BODY, ctx: 'fact l' });
    const r = T(840, fy + 24, v, { size: 16, fill: th.ink, bg: th.sand, maxW: 410, lines: 2, lh: 21, font: BODY, ctx: 'fact' });
    s += r.svg; fy += 40 + r.h;
  });
  s += rect(840, 640, 408, 42, '#102A2A', { rx: 10 }) + t(1044, 667, 'Open the notebook ↗', { size: 16, weight: 700, fill: th.mint, bg: '#102A2A', anchor: 'middle', font: BODY, ctx: 'btn' });
  s += T(60, 712, 'Estimated value, not a promised value. Your business value team must validate it.', { size: 16, fill: th.muted, bg: th.page, italic: true, font: BODY, ctx: 'disc' }).svg;
  return svgDoc(SW, SH, s, BODY, defs(th));
}

function briefPage1(m, th) {
  const W = 794; const H = 1123; const P = 48;
  let s = rect(0, 0, W, H, th.page) + rect(0, 0, W, 430, 'url(#aHero)') + rings(W - 340, -30, 0.65, th.gold);
  s += wordmark(P, 56, 12, '#0B4642', th);
  s += eyebrow(P, 140, 'Use case brief', th, '#0B4642', { fill: th.heroMuted });
  s += T(P, 186, 'Where data and AI pay back first', { size: 34, weight: 700, fill: '#FFFFFF', bg: '#0B4642', maxW: 520, lines: 2, lh: 40, font: DISPLAY, kind: 'serif', ctx: 'brief title' }).svg;
  s += t(P, 270, 'Prepared for', { size: 14, fill: th.heroMuted, bg: '#0F5E5A', font: BODY, ctx: 'for' });
  s += t(P, 302, m.businessName, { size: 28, weight: 700, fill: th.goldText, bg: '#0F5E5A', font: DISPLAY, kind: 'serif', ctx: 'biz' });
  [[m.total.text, 'a year, estimated'], [String(m.total.n), 'use cases'], [String(m.total.nDomains), 'domains']].forEach(([v, l], i) => {
    const x = P + i * 190;
    s += rect(x, 330, 178, 74, '#FFFFFF', { rx: 12, op: 0.12 });
    s += t(x + 14, 368, v, { size: 26, weight: 700, fill: i ? '#FFFFFF' : th.goldText, bg: '#0F5E5A', font: DISPLAY, kind: 'serif', ctx: 'kpi' });
    s += t(x + 14, 392, l, { size: 12, fill: th.heroMuted, bg: '#0F5E5A', font: BODY, ctx: 'kpi l' });
  });
  // The App has no executive summary field: the part is left out when the text is empty, and the domain panel takes the width.
  if (m.executiveSummary) {
    s += eyebrow(P, 470, 'Executive summary', th, th.page) + rect(P, 480, 54, 3, th.gold, { rx: 2 });
    s += T(P, 506, m.executiveSummary, { size: 13, fill: th.body, bg: th.page, maxW: 420, lines: 16, lh: 19, font: BODY, ctx: 'exec' }).svg;
  }
  const rx = m.executiveSummary ? 500 : P; const rw = W - P - rx;
  s += rect(rx, 456, rw, 300, th.sand, { rx: 14 });
  s += head(rx + 14, 484, 'Value by domain', th, th.sand, 15);
  s += hbars(m.domains.slice(0, 9).map((d) => ({ label: d.name, value: d.value, text: d.text })), { x: rx + 14, y: 494, w: rw - 28 },
    { rowH: 27, barH: 8, labelW: 84, valueW: 50, track: th.sand2, fill: () => 'url(#aBar)', ink: th.ink, bg: th.sand, font: BODY }).svg;
  let y = 800;
  s += eyebrow(P, y, 'Start with these three', th, th.page) + rect(P, y + 10, 54, 3, th.gold, { rx: 2 });
  const cw = (W - 2 * P - 24) / 3;
  m.ranked.slice(0, 3).forEach((u, i) => { s += ucCard(u, i, P + i * (cw + 12), y + 26, cw, 120, th, m); });
  if (has(m, 'disclaimer')) s += T(P, 1010, DISCLAIMER, { size: 12, fill: th.muted, bg: th.page, maxW: W - 2 * P, lines: 3, lh: 15, italic: true, font: BODY, ctx: 'disc' }).svg;
  s += line(P, 1062, W - P, 1062, th.line) + t(P, 1084, `${m.businessName} · Databricks Inspire AI`, { size: 12, fill: th.muted, bg: th.page, font: BODY, ctx: 'foot' }) + t(W - P, 1084, '1 / 6', { size: 12, weight: 700, fill: th.muted, bg: th.page, anchor: 'end', font: BODY, ctx: 'foot' });
  return svgDoc(W, H, s, BODY, defs(th));
}


// REQ-526 part C: the brief use case page in this design (teal band head, sand cards, gold rules, coral eyebrows, gradient meter).
function ucSkin(m, th, u, showScore) {
  const W = 794; const P = 48; const CW = W - 2 * P; const dk = th.mode === 'dark';
  const sub = [u.domain, u.subdomain].filter(Boolean).join(' · ');
  const valueInk = dk ? th.tealMid : th.teal;
  return {
    id: 'a_original', P, footH: 70, gap: 10, pad: 10, labelH: 24, chipH: 24, chipPad: 12, chartH: 130, factsH: 68,
    bg: th.page, boxBg: th.sand, font: BODY, kind: 'sans', body: th.body,
    defs: () => defs(th),
    frame: (n) => rect(0, 0, W, 1123, th.page) + line(P, 1062, W - P, 1062, th.line)
      + t(P, 1084, `${m.businessName} · Databricks Inspire AI`, { size: 12, fill: th.muted, bg: th.page, font: BODY, maxW: 560, lines: 1, ctx: 'foot' })
      + t(W - P, 1084, `Page ${n}`, { size: 12, weight: 700, fill: th.muted, bg: th.page, anchor: 'end', font: BODY, ctx: 'foot' }),
    head: () => {
      const nm = T(P, 118, u.name, { size: 26, weight: 700, fill: '#FFFFFF', bg: '#0F5E5A', font: DISPLAY, kind: 'serif', maxW: CW - 70, lines: 3, lh: 32, ctx: 'uc name' });
      const h = 118 + (nm.lines - 1) * 32 + 30;
      return { h, svg: rect(0, 0, W, h, 'url(#aHero)') + rings(W - 340, -50, 0.6, th.gold) + wordmark(P, 44, 12, '#0B4642', th)
        + eyebrow(P, 82, [u.id, sub].filter(Boolean).join(' · '), th, '#0F5E5A', { fill: th.heroMuted, maxW: CW - 70, lines: 1 }) + nm.svg
        + circle(W - P - 20, 92, 22, th.gold) + icon(iconName(u.domain), W - P - 31, 81, 22, th.goldInk, 2) };
    },
    tile: (y) => {
      let s = rect(P, y, CW, 92, th.card, { rx: 14, stroke: th.line });
      if (u.value) {
        s += t(P + 20, y + 48, u.value.text, { size: 32, weight: 700, fill: valueInk, bg: th.card, font: DISPLAY, kind: 'serif', ctx: 'uc value' });
        s += t(P + 20, y + 72, `${u.value.status || 'estimated'} a year`, { size: 12, fill: th.muted, bg: th.card, font: BODY, ctx: 'uc value l' });
      } else s += t(P + 20, y + 52, NOT_YET, { size: 18, weight: 700, fill: th.muted, bg: th.card, font: DISPLAY, kind: 'serif', ctx: 'uc nv' });
      if (showScore && u.score != null) {
        s += line(P + 250, y + 16, P + 250, y + 76, th.line, 1) + t(P + 270, y + 32, 'Inspire score', { size: 12, weight: 700, fill: th.muted, bg: th.card, caps: true, ls: 1, font: BODY, ctx: 'uc score l' });
        s += rect(P + 270, y + 44, 150, 10, th.barTrack, { rx: 5 }) + rect(P + 270, y + 44, (u.score / 10) * 150, 10, 'url(#aBar)', { rx: 5 });
        s += t(P + 270, y + 78, u.score.toFixed(1), { size: 20, weight: 700, fill: th.ink, bg: th.card, font: DISPLAY, kind: 'serif', ctx: 'uc score' }) + t(P + 270 + runW(u.score.toFixed(1), 20, 700) + 6, y + 78, 'of 10', { size: 12, fill: th.muted, bg: th.card, font: BODY, ctx: 'uc score of' });
      }
      if (u.verb) {
        s += line(P + 450, y + 16, P + 450, y + 76, th.line, 1) + circle(P + 484, y + 46, 18, th.sand2) + icon(VERB_ICON[u.verb] || 'target', P + 473, y + 35, 22, th.coralText, 2);
        s += t(P + 512, y + 44, 'What it does', { size: 12, fill: th.muted, bg: th.card, font: BODY, ctx: 'uc verb l' }) + t(P + 512, y + 64, u.verb, { size: 14, weight: 700, fill: th.ink, bg: th.card, font: BODY, maxW: 170, lines: 1, ctx: 'uc verb' });
      }
      return { h: 92, svg: s };
    },
    label: (text, x, y) => eyebrow(x, y + 12, text, th, th.sand) + rect(x, y + 18, 36, 3, th.gold, { rx: 2 }),
    box: (x, y, w, h) => rect(x, y, w, h, th.sand, { rx: 14 }),
    chipW: (l) => Math.ceil(l.length * 12 * 0.56 + 24),
    chipSvg: (l, x, y, w) => { const f = dk ? th.sand2 : th.mint; return rect(x, y, w, 24, f, { rx: 12 }) + t(x + 12, y + 16, l, { size: 12, fill: dk ? th.ink : th.tealDark, bg: f, font: BODY, ctx: 'chip' }); },
    chart: { colors: [th.mint2, th.teal, th.gold], bar: 'bars', radius: 4, ink: th.ink, muted: th.muted, grid: th.line, bg: th.sand },
    facts: (facts, x, y, w) => rect(x, y, w, 78, th.sand, { rx: 14 }) + factCols(facts, x + 14, y + 4, w - 28, { font: BODY }, { bg: th.sand, labelFill: th.coralText, valueFill: th.body }),
  };
}
const briefUseCasePage = (m, th, u, idx) => ucPage(m, u, idx, ucSkin(m, th, u, has(m, 'inspire_score')));

export default {
  id: 'a_original', name: 'A. Original (Teal and Sand)', themes: { light, dark }, fonts: { display: DISPLAY, body: BODY },
  infographic, deckCover, deckDomain, deckUseCase, briefPage1, briefUseCasePage,
};
void wrap;
