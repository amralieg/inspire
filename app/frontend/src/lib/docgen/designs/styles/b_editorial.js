// Option B "Editorial": an executive magazine page. Paper, ink, one lava-red accent, hairline rules, a headline that states the number,
// a tonal treemap where only the leading domain carries colour, a thin-ring donut, a hollow-dot quadrant, numbered list instead of boxes.
import { wrap, nLines, SPILL, textW, t, T, rect, line, circle, icon, svgDoc, runW, money, VERB_ICON, DISCLAIMER, bestInk, contrast, has, verbColors, iconName } from '../core.js';
import { ucPage, factCols, NOT_YET } from '../ucPage.js';
import { donut, quadrant, treemapChart, meter } from '../charts.js';

const DISPLAY = "'Playfair Display', Didot, 'Bodoni 72', Georgia, serif";
const SERIF = "'Source Serif 4', 'Iowan Old Style', Georgia, serif";
const BODY = "'Source Sans 3', 'Helvetica Neue', Arial, sans-serif";

const light = { mode: 'light', paper: '#F7F4EE', ink: '#161616', body: '#2E2E2E', grey: '#595652', rule: '#1A1A1A', hair: '#CFC9BE', accent: '#B3261E', accentText: '#A32019',
  tones: ['#B3261E', '#2B2A28', '#4A4743', '#6B6760', '#8F8A81', '#B5AFA4', '#CFC9BE', '#DCD6CB', '#E6E1D7'], dotHollow: '#161616', quad: '#EDE6DA' };
const dark = { mode: 'dark', paper: '#151413', ink: '#EFEAE2', body: '#D9D3CA', grey: '#ADA79D', rule: '#EFEAE2', hair: '#3E3B37', accent: '#FF6A55', accentText: '#FF7B68',
  tones: ['#FF6A55', '#E6E0D6', '#BDB6AB', '#948E84', '#6F6A62', '#56524C', '#46423D', '#3A3733', '#302E2B'], dotHollow: '#EFEAE2', quad: '#23211F' };
const VERB_TONE = (th) => ({ 'AVOID RISK': th.accent, 'GROW REVENUE': th.ink, 'CUT COST': th.tones[4], 'SAVE TIME': th.tones[6] });
const inkOn = (th) => (c) => (contrast(c, th.mode === 'dark' ? '#151413' : '#161616') >= contrast(c, '#F7F4EE') ? (th.mode === 'dark' ? '#151413' : '#161616') : '#F7F4EE');
const cap = (s) => s.toLowerCase().replace(/^\w/, (c) => c.toUpperCase());

function masthead(W, P, y, th, left, right, fs = 12) {
  return rect(P, y, W - 2 * P, 3, th.rule) + t(P, y + 10 + fs, left, { size: fs, weight: 700, fill: th.ink, bg: th.paper, caps: true, ls: 2.2, font: BODY, ctx: 'mast' })
    + t(W - P, y + 10 + fs, right, { size: fs, fill: th.ink, bg: th.paper, caps: true, ls: 2.2, anchor: 'end', font: BODY, ctx: 'mast' }) + rect(P, y + 20 + fs, W - 2 * P, 1, th.rule);
}
const kicker = (x, y, s, th, o = {}) => t(x, y, s, { size: 12, weight: 700, fill: th.accentText, bg: th.paper, caps: true, ls: 1.8, font: BODY, ctx: 'kicker', ...o });

function infographic(m, th, { W, H }) {
  const P = 44; const CW = W - 2 * P; const small = H < 1100;
  let s = rect(0, 0, W, H, th.paper);
  s += masthead(W, P, 30, th, 'Databricks Inspire AI · Value review', `${m.businessName} · Nov 2026`);
  const d3 = m.domains.slice(0, 3); const share = Math.round((d3.reduce((a, d) => a + d.value, 0) / m.total.amount) * 100);
  // headline: the number is the story
  s += t(P, 118, m.total.yearText, { size: small ? 50 : 58, weight: 700, fill: th.accentText, bg: th.paper, font: DISPLAY, kind: 'serif', ctx: 'headline num' });
  s += t(P, small ? 158 : 166, `sits in ${m.total.n} use cases across ${m.total.nDomains} domains.`, { size: small ? 26 : 30, weight: 400, fill: th.ink, bg: th.paper, font: DISPLAY, kind: 'serif', ctx: 'headline' });
  s += T(P, small ? 190 : 202, `${d3.map((d) => d.name).join(', ')} hold ${share}% of it. The numbered use cases are the place to start.`, { size: 16, italic: true, fill: th.body, bg: th.paper, font: SERIF, kind: 'serif', maxW: CW, lines: 2, lh: 21, ctx: 'standfirst' }).svg;
  // KPI band: four columns separated by hairlines
  let y = small ? 222 : 240;
  s += rect(P, y, CW, 1, th.hair);
  const k = [[m.total.text, 'estimated a year'], [String(m.total.n), 'use cases'], [String(m.total.nDomains), 'domains'], [Math.max(...m.useCases.map((u) => u.score)).toFixed(1), 'best Inspire score']].filter((k) => k[1] !== 'best Inspire score' || has(m, 'inspire_score'));
  const kw = CW / k.length;
  k.forEach(([v, l], i) => {
    const x = P + i * kw;
    if (i) s += line(x, y + 12, x, y + 72, th.hair, 1);
    s += t(x + (i ? 16 : 0), y + 48, v, { size: 34, weight: 700, fill: th.ink, bg: th.paper, font: DISPLAY, kind: 'serif', ctx: 'kpi' });
    s += t(x + (i ? 16 : 0), y + 68, l, { size: 12, fill: th.grey, bg: th.paper, caps: true, ls: 1.2, font: BODY, ctx: 'kpi l' });
  });
  y += 86; s += rect(P, y, CW, 1, th.hair);
  // Figure 1: treemap
  y += 26;
  s += kicker(P, y, 'Figure 1', th) + t(P + 74, y, 'Where the yearly value sits, by domain', { size: 15, weight: 700, fill: th.ink, bg: th.paper, font: SERIF, kind: 'serif', ctx: 'fig title' });
  const th1 = small ? 170 : 200;
  const items = m.domains.map((d, i) => ({ name: d.name, value: d.value, text: d.text, icon: d.icon, color: th.tones[Math.min(i, th.tones.length - 1)] }));
  s += treemapChart(items, { x: P, y: y + 12, w: CW, h: th1 }, { gap: 3, inkOn: inkOn(th), font: BODY, displayFont: DISPLAY, icons: true }).svg;
  y += th1 + 34;
  // Figure 2 (quadrant) and Figure 3 (verb ring)
  const hasV = m.verbs.length > 0; const lw = hasV ? CW * 0.62 : CW; const rx = P + lw + 24; const rw = CW - lw - 24; const fh = small ? 176 : 196;
  s += kicker(P, y, 'Figure 2', th) + t(P + 74, y, 'Score against value', { size: 15, weight: 700, fill: th.ink, bg: th.paper, font: SERIF, kind: 'serif', ctx: 'fig title' });
  if (hasV) s += kicker(rx, y, 'Figure 3', th) + t(rx + 74, y, 'What it does', { size: 15, weight: 700, fill: th.ink, bg: th.paper, font: SERIF, kind: 'serif', ctx: 'fig title' });
  const vt = verbColors(VERB_TONE(th), m.verbs, [th.tones[3], th.tones[4], th.tones[2], th.tones[5]]);
  const doFirst = (u) => u.score >= m.median.score && u.value.amount >= m.median.value;
  s += quadrant(m.useCases, { x: P - 4, y: y + 10, w: lw, h: fh - 10 }, { colorOf: (u) => (doFirst(u) ? th.accent : th.paper), dotStroke: th.dotHollow, dotOp: 1, axis: th.rule, grid: th.grey,
    ink: th.ink, muted: th.grey, bg: th.paper, quadFill: th.quad, quadBg: th.quad, quadInk: th.accentText, mx: m.median.score, my: m.median.value, labelTop: 3, font: BODY, r: () => 4.5 });
  const r1 = small ? 44 : 56; const cx = rx + r1 + 4; const cy = y + 22 + r1;
  if (hasV) s += donut(m.verbs.map((v) => ({ name: v.name, value: v.value, color: vt[v.name] })), cx, cy, r1 - 7, r1, { gap: 0.04, centerTop: `${Math.round((m.verbs[0].value / m.total.amount) * 100)}%`, centerBottom: cap(m.verbs[0].name), ink: th.ink, muted: th.grey, bg: th.paper, font: BODY, displayFont: DISPLAY, centerSize: 24 });
  let ly = hasV ? cy + r1 + 22 : y;
  m.verbs.forEach((v) => {
    s += rect(rx, ly - 9, 10, 10, vt[v.name], { stroke: th.ink, sw: 0.6 });
    s += t(rx + 16, ly, cap(v.name), { size: 12, fill: th.ink, bg: th.paper, font: BODY, ctx: 'legend' }) + t(rx + rw, ly, money(v.value), { size: 12, weight: 700, fill: th.ink, bg: th.paper, anchor: 'end', font: BODY, ctx: 'legend v' });
    ly += small ? 16 : 17;
  });
  y = Math.max(y + fh + 20, ly + 4);
  // The list
  s += rect(P, y, CW, 3, th.rule);
  s += t(P, y + 26, 'The top use cases', { size: 20, weight: 700, fill: th.ink, bg: th.paper, font: DISPLAY, kind: 'serif', ctx: 'list head' });
  s += t(W - P, y + 26, 'Numbers match Figure 2', { size: 12, fill: th.grey, bg: th.paper, anchor: 'end', font: BODY, ctx: 'list note' });
  y += 40;
  const footer = 92; const rowH = 62; const colW = (CW - 28) / 2;
  const rows = Math.max(1, Math.floor((H - y - footer) / rowH));
  m.ranked.slice(0, rows * 2).forEach((u, i) => {
    const col = i % 2; const row = Math.floor(i / 2); const x = P + col * (colW + 28); const yy = y + row * rowH;
    s += t(x, yy + 36, String(i + 1), { size: 34, weight: 700, fill: th.accentText, bg: th.paper, font: DISPLAY, kind: 'serif', ctx: 'list num' });
    s += t(x + 34, yy + 18, u.short, { size: 14, weight: 700, fill: th.ink, bg: th.paper, font: SERIF, kind: 'serif', maxW: colW - 110, lines: 2, lh: 17, ctx: 'list title' });
    s += icon(u.domain && m.domains.find((d) => d.name === u.domain).icon, x + 34, yy + 40, 13, th.grey, 1.6);
    s += t(x + 52, yy + 51, [u.domain, cap(u.verb)].filter(Boolean).join(' · '), { size: 12, fill: th.grey, bg: th.paper, font: BODY, ctx: 'list meta' });
    s += t(x + colW, yy + 22, u.value.text, { size: 18, weight: 700, fill: th.ink, bg: th.paper, anchor: 'end', font: DISPLAY, kind: 'serif', ctx: 'list value' });
    s += t(x + colW, yy + 38, 'a year', { size: 12, fill: th.grey, bg: th.paper, anchor: 'end', font: BODY, ctx: 'list unit' });
    if (has(m, 'inspire_score')) s += t(x + colW, yy + 53, `score ${u.score.toFixed(1)}`, { size: 12, weight: 700, fill: th.body, bg: th.paper, anchor: 'end', font: BODY, ctx: 'list score' });
    s += line(x, yy + rowH - 4, x + colW, yy + rowH - 4, th.hair, 1);
  });
  y += rows * rowH + 6;
  s += t(P, y + 14, 'How to read.', { size: 12, weight: 700, fill: th.ink, bg: th.paper, font: BODY, ctx: 'how' });
  s += T(P + 82, y + 14, 'Tile area = yearly value. Filled red dots sit above the median score and the median value (dashed lines). Score = Inspire score out of 10.', { size: 12, fill: th.body, bg: th.paper, maxW: CW - 82, lines: 2, lh: 15, font: BODY, ctx: 'how' }).svg;
  if (has(m, 'disclaimer')) s += T(P, y + 48, DISCLAIMER, { size: 12, fill: th.grey, bg: th.paper, italic: true, maxW: CW, lines: 3, lh: 15, font: SERIF, kind: 'serif', ctx: 'disc' }).svg;
  return svgDoc(W, H, s, BODY);
}

const SW = 1333; const SH = 750;
function deckCover(m, th) {
  let s = rect(0, 0, SW, SH, th.paper) + masthead(SW, 70, 46, th, 'Databricks Inspire AI', 'Use case review · November 2026', 16);
  s += t(70, 200, 'Prepared for', { size: 18, fill: th.grey, bg: th.paper, caps: true, ls: 2, font: BODY, ctx: 'for' });
  s += T(70, 270, m.businessName, { size: 64, weight: 700, fill: th.ink, bg: th.paper, font: DISPLAY, kind: 'serif', maxW: 560, lines: 2, lh: 70, ctx: 'title' }).svg;
  s += t(70, 420, m.total.yearText, { size: 44, weight: 700, fill: th.accentText, bg: th.paper, font: DISPLAY, kind: 'serif', ctx: 'num' });
  s += T(70, 462, `of estimated value in ${m.total.n} use cases across ${m.total.nDomains} domains, ranked so you know where to start.`, { size: 22, italic: true, fill: th.body, bg: th.paper, font: SERIF, kind: 'serif', maxW: 520, lines: 3, lh: 30, ctx: 'stand' }).svg;
  // the data is the art: the domain treemap fills the right half
  const items = m.domains.map((d, i) => ({ name: d.name, value: d.value, text: d.text, icon: d.icon, color: th.tones[Math.min(i, th.tones.length - 1)] }));
  s += treemapChart(items, { x: 690, y: 120, w: 573, h: 540 }, { gap: 4, inkOn: inkOn(th), font: BODY, displayFont: DISPLAY, icons: true, scale: 1.3 }).svg;
  s += t(690, 690, 'Figure: yearly value by domain (tile area)', { size: 16, italic: true, fill: th.grey, bg: th.paper, font: SERIF, kind: 'serif', ctx: 'cap' });
  return svgDoc(SW, SH, s, BODY);
}

function deckDomain(m, th, d, idx) {
  const ucs = m.ranked.filter((u) => u.domain === d.name);
  let s = rect(0, 0, SW, SH, th.paper) + masthead(SW, 70, 46, th, `Domain ${String(idx + 1).padStart(2, '0')} of ${m.total.nDomains}`, m.businessName, 16);
  s += t(70, 230, String(idx + 1).padStart(2, '0'), { size: 140, weight: 700, fill: th.accentText, bg: th.paper, font: DISPLAY, kind: 'serif', ctx: 'num' });
  s += icon(d.icon, 290, 130, 56, th.ink, 1.4);
  s += t(70, 300, d.name, { size: 54, weight: 700, fill: th.ink, bg: th.paper, font: DISPLAY, kind: 'serif', ctx: 'name' });
  const share = Math.round((d.value / m.total.amount) * 100);
  s += T(70, 346, `${d.text} a year, ${share}% of all value, from ${d.n} use cases.`, { size: 22, italic: true, fill: th.body, bg: th.paper, font: SERIF, kind: 'serif', maxW: 500, lines: 2, lh: 30, ctx: 'stand' }).svg;
  s += T(70, 430, d.summary, { size: 17, fill: th.body, bg: th.paper, font: BODY, maxW: 500, lines: 9, lh: 25, ctx: 'body' }).svg;
  // right: lollipop chart of each use case's value with its score
  const x0 = 660; const w = 603; const max = Math.max(...ucs.map((u) => u.value.amount));
  s += t(x0, 150, 'Each use case, by yearly value', { size: 20, weight: 700, fill: th.ink, bg: th.paper, font: SERIF, kind: 'serif', ctx: 'fig' });
  s += rect(x0, 166, w, 1, th.rule);
  let drop = 0;
  ucs.slice(0, 7).forEach((u, i) => {
    const ex = (nLines(u.short, w - 10, 17, 'serif') - 1) * 21; const y = 214 + i * 66 + drop + ex; drop += ex; const bw = (u.value.amount / max) * (w - 150);
    s += t(x0, y - 8 - ex, u.short, { size: 17, fill: th.ink, bg: th.paper, font: SERIF, kind: 'serif', maxW: w - 10, lh: 21, ctx: 'row' });
    s += line(x0, y + 12, x0 + bw, y + 12, th.ink, 2) + circle(x0 + bw, y + 12, 7, i === 0 ? th.accent : th.ink);
    s += t(x0 + bw + 16, y + 18, `${u.value.text} · score ${u.score.toFixed(1)}`, { size: 16, weight: 700, fill: th.ink, bg: th.paper, font: BODY, ctx: 'row v' });
  });
  s += t(70, 712, 'Estimated value, not a promised value. Your business value team must validate it.', { size: 16, italic: true, fill: th.grey, bg: th.paper, font: SERIF, kind: 'serif', ctx: 'disc' });
  return svgDoc(SW, SH, s, BODY);
}

function deckUseCase(m, th, u, idx) {
  let s = rect(0, 0, SW, SH, th.paper) + masthead(SW, 70, 46, th, `${u.domain} · ${u.subdomain}`, `${u.id} · No. ${idx + 1}`, 16);
  s += kicker(70, 140, cap(u.verb), th, { size: 17 });
  s += T(70, 196, u.short, { size: 48, weight: 700, fill: th.ink, bg: th.paper, font: DISPLAY, kind: 'serif', maxW: 820, lines: 2, lh: 56, ctx: 'title' }).svg;
  s += T(70, 300, u.statement, { size: 21, italic: true, fill: th.body, bg: th.paper, font: SERIF, kind: 'serif', maxW: 820, lines: 3, lh: 29, ctx: 'stand' }).svg;
  s += rect(70, 400, 820, 1, th.hair);
  [['The solution', u.solution], ['The value', u.businessValue]].forEach(([l, v], i) => {
    const x = 70 + i * 420;
    s += t(x, 436, l, { size: 17, weight: 700, fill: th.ink, bg: th.paper, caps: true, ls: 1.4, font: BODY, ctx: 'col h' });
    s += T(x, 466, v, { size: 17, fill: th.body, bg: th.paper, font: BODY, maxW: 390, lines: 8, lh: 25, ctx: 'col' }).svg;
  });
  // sidebar: by the numbers
  s += rect(950, 120, 1, 590, th.rule);
  s += t(980, 150, 'By the numbers', { size: 17, weight: 700, fill: th.ink, bg: th.paper, caps: true, ls: 1.4, font: BODY, ctx: 'side h' });
  [[u.value.text, 'estimated a year'], [u.score.toFixed(1), 'Inspire score of 10'], [u.quality, 'quality'], [u.sponsor, 'sponsor']].forEach(([v, l], i) => {
    const y = 220 + i * 120;
    const vt2 = T(980, y, v, { size: i < 2 ? 52 : 26, weight: 700, fill: i === 0 ? th.accentText : th.ink, bg: th.paper, font: DISPLAY, kind: 'serif', maxW: 290, lines: 2, lh: 30, ctx: 'side v' });
    s += vt2.svg;
    s += t(980, y + (i < 2 ? 32 : 30 * (vt2.lines - 1) + 28), l, { size: 16, fill: th.grey, bg: th.paper, caps: true, ls: 1.2, font: BODY, ctx: 'side l' });
    if (i < 3) s += rect(980, y + 62, 283, 1, th.hair);
  });
  s += t(70, 712, 'Estimated value, not a promised value. Your business value team must validate it.', { size: 16, italic: true, fill: th.grey, bg: th.paper, font: SERIF, kind: 'serif', ctx: 'disc' });
  return svgDoc(SW, SH, s, BODY);
}

function briefPage1(m, th) {
  const W = 794; const H = 1123; const P = 48; const CW = W - 2 * P;
  let s = rect(0, 0, W, H, th.paper);
  s += t(W / 2, 74, 'The Use Case Brief', { size: 40, weight: 700, fill: th.ink, bg: th.paper, anchor: 'middle', font: DISPLAY, kind: 'serif', ctx: 'flag' });
  s += masthead(W, P, 92, th, `${m.businessName}`, 'Databricks Inspire AI · Nov 2026');
  s += t(P, 186, `${m.total.yearText} in ${m.total.n} use cases`, { size: 34, weight: 700, fill: th.ink, bg: th.paper, font: DISPLAY, kind: 'serif', maxW: CW, lines: 1, ctx: 'head' });
  s += T(P, 218, `${m.domains[0].name} leads with ${m.domains[0].text}. ${m.useCases.filter((u) => u.score >= m.median.score && u.value.amount >= m.median.value).length} use cases sit above the median score and the median value; they are the place to start.`, { size: 16, italic: true, fill: th.body, bg: th.paper, font: SERIF, kind: 'serif', maxW: CW, lines: 2, lh: 21, ctx: 'stand' }).svg;
  s += rect(P, 254, CW, 1, th.hair);
  // REQ-526 part E: the executive summary in three newspaper columns with a drop cap; the room a short summary leaves (or all of it with no summary)
  // goes to "Where to start", the top use cases by value.
  const cw = (CW - 40) / 3; const TOP = 282; const BOTTOM = 590; const text = m.summary.join(' ');
  let perCol = 0; let LH = 18; let FS = 13;
  if (text) {
    // The largest type (13 to 16) whose three columns fit the block, so a short summary reads big and a long one stays small.
    const lay = (size) => {
      const lh = Math.round(size * 1.38);
      const first = wrap(text.slice(1), cw - 46, size, 'serif', 400).slice(0, 3); const used = first.join(' ').split(' ').length;
      const all = [...first.map((l) => ({ l, x: 46 })), ...wrap(text.slice(1).split(' ').slice(used).join(' '), cw, size, 'serif', 400).map((l) => ({ l, x: 0 }))];
      return { size, lh, all, per: Math.max(4, Math.ceil(all.length / 3)) };
    };
    const pick = [16, 15, 14, 13].map(lay).find((r) => r.per * r.lh <= 270) || lay(13);
    const { all } = pick; FS = pick.size; LH = pick.lh;
    const maxLines = 3 * Math.floor(284 / LH);
    if (all.length > maxLines) { SPILL.push(all.slice(maxLines).map((r) => r.l).join(' ')); all.length = maxLines; }
    perCol = Math.max(4, Math.ceil(all.length / 3));
    for (let c = 0; c < 3; c += 1) {
      const x = P + c * (cw + 20);
      if (c === 0) s += t(x, TOP + 2 * LH + 6, text[0], { size: 58, weight: 700, fill: th.accentText, bg: th.paper, font: DISPLAY, kind: 'serif', ctx: 'dropcap' });
      all.slice(c * perCol, (c + 1) * perCol).forEach((r, j) => { s += t(x + r.x, TOP + j * LH, r.l, { size: FS, fill: th.body, bg: th.paper, font: SERIF, kind: 'serif', ctx: 'col' }); });
      if (c) s += line(x - 10, 270, x - 10, TOP + perCol * LH - 6, th.hair, 1);
    }
  }
  const ly = text ? TOP + perCol * LH + 14 : 270; const rows = Math.min(9, m.ranked.length, Math.floor((BOTTOM - ly - 34) / 30));
  if (rows >= 2) {
    s += kicker(P, ly + 14, 'Where to start', th) + line(P, ly + 22, P + CW, ly + 22, th.rule, 1);
    let sink = 0;
    m.ranked.slice(0, rows).forEach((u, i) => {
      const ex = (nLines(u.name, 400, 14, 'serif', 700) - 1) * 17; const ry = ly + 34 + i * 30 + sink; sink += ex;
      s += t(P, ry + 18, u.name, { size: 14, weight: 700, fill: th.ink, bg: th.paper, font: SERIF, kind: 'serif', maxW: 400, lh: 17, ctx: 'start name' });
      s += t(P + 420, ry + 18, u.domain, { size: 12, fill: th.grey, bg: th.paper, caps: true, ls: 1.2, font: BODY, maxW: 130, lines: 1, ctx: 'start domain' });
      s += t(P + CW - (has(m, 'inspire_score') ? 50 : 0), ry + 18, u.value.text, { size: 14, weight: 700, fill: th.accentText, bg: th.paper, anchor: 'end', font: SERIF, kind: 'serif', ctx: 'start value' });
      if (has(m, 'inspire_score')) s += t(P + CW, ry + 18, u.score.toFixed(1), { size: 14, fill: th.ink, bg: th.paper, anchor: 'end', font: SERIF, kind: 'serif', ctx: 'start score' });
      s += line(P, ry + 26 + ex, P + CW, ry + 26 + ex, th.hair, 1);
    });
  }
  // figure
  s += rect(P, 612, CW, 3, th.rule);
  s += kicker(P, 640, 'Figure 1', th) + t(P + 74, 640, 'Yearly value by domain', { size: 15, weight: 700, fill: th.ink, bg: th.paper, font: SERIF, kind: 'serif', ctx: 'fig' });
  const items = m.domains.map((d, i) => ({ name: d.name, value: d.value, text: d.text, icon: d.icon, color: th.tones[Math.min(i, th.tones.length - 1)] }));
  s += treemapChart(items, { x: P, y: 654, w: CW, h: 250 }, { gap: 3, inkOn: inkOn(th), font: BODY, displayFont: DISPLAY, icons: true }).svg;
  s += t(P, 926, 'Tile area = estimated yearly value. Red = the leading domain.', { size: 12, italic: true, fill: th.grey, bg: th.paper, font: SERIF, kind: 'serif', ctx: 'cap' });
  s += rect(P, 950, CW, 1, th.hair);
  if (has(m, 'disclaimer')) s += T(P, 976, DISCLAIMER, { size: 12, italic: true, fill: th.grey, bg: th.paper, font: SERIF, kind: 'serif', maxW: CW, lines: 3, lh: 16, ctx: 'disc' }).svg;
  s += rect(P, 1060, CW, 1, th.rule) + t(P, 1082, 'Page 1', { size: 12, fill: th.grey, bg: th.paper, font: BODY, ctx: 'foot' });
  return svgDoc(W, H, s, BODY);
}


// REQ-526 part C: the brief use case page in this design (masthead, serif headline, hairline rules, lollipop projection, no boxes).
function ucSkin(m, th, u, showScore) {
  const W = 794; const P = 48; const CW = W - 2 * P;
  const sub = [u.domain, u.subdomain].filter(Boolean).join(' · ');
  return {
    id: 'b_editorial', P, footH: 70, gap: 16, pad: 0, labelH: 28, chipH: 24, chipPad: 4, chartH: 190, factsH: 76,
    bg: th.paper, boxBg: th.paper, font: BODY, bodyFont: SERIF, kind: 'serif', body: th.body,
    frame: (n) => rect(0, 0, W, 1123, th.paper) + masthead(W, P, 26, th, m.businessName, `Databricks Inspire AI · No. ${n - 1}`)
      + rect(P, 1060, CW, 1, th.rule) + t(P, 1082, `Page ${n}`, { size: 12, fill: th.grey, bg: th.paper, font: BODY, ctx: 'foot' }),
    head: () => {
      const nm = T(P, 150, u.name, { size: 32, weight: 700, fill: th.ink, bg: th.paper, font: DISPLAY, kind: 'serif', maxW: CW, lines: 3, lh: 38, ctx: 'uc name' });
      return { h: 150 + (nm.lines - 1) * 38 + 18, svg: kicker(P, 112, [u.id, sub].filter(Boolean).join(' · '), th, { maxW: CW, lines: 1 }) + nm.svg };
    },
    tile: (y) => {
      let s = rect(P, y, CW, 3, th.rule) + rect(P, y + 84, CW, 1, th.hair);
      if (u.value) {
        s += t(P, y + 46, u.value.text, { size: 38, weight: 700, fill: th.accentText, bg: th.paper, font: DISPLAY, kind: 'serif', ctx: 'uc value' });
        s += t(P, y + 68, `${u.value.status || 'estimated'} a year`, { size: 12, fill: th.grey, bg: th.paper, caps: true, ls: 1.2, font: BODY, ctx: 'uc value l' });
      } else s += t(P, y + 50, NOT_YET, { size: 20, weight: 700, fill: th.grey, bg: th.paper, font: DISPLAY, kind: 'serif', ctx: 'uc nv' });
      if (showScore && u.score != null) {
        s += line(P + 236, y + 14, P + 236, y + 74, th.hair, 1) + t(P + 256, y + 46, u.score.toFixed(1), { size: 38, weight: 700, fill: th.ink, bg: th.paper, font: DISPLAY, kind: 'serif', ctx: 'uc score' });
        s += meter(P + 256, y + 56, 120, 3, u.score, th.accent, th.hair, 0) + t(P + 256, y + 74, 'Inspire score of 10', { size: 12, fill: th.grey, bg: th.paper, caps: true, ls: 1.2, font: BODY, ctx: 'uc score l' });
      }
      if (u.verb) {
        s += line(P + 470, y + 14, P + 470, y + 74, th.hair, 1) + icon(VERB_ICON[u.verb] || 'target', P + 490, y + 24, 26, th.ink, 1.6);
        s += t(P + 490, y + 68, u.verb, { size: 12, weight: 700, fill: th.ink, bg: th.paper, caps: true, ls: 1.2, font: BODY, maxW: 190, lines: 1, ctx: 'uc verb' });
      }
      return { h: 88, svg: s };
    },
    label: (text, x, y, w) => kicker(x, y + 12, text, th) + line(x, y + 20, x + w, y + 20, th.hair, 1),
    chipW: (l) => Math.ceil(l.length * 12 * 0.56 + 8),
    chipSvg: (l, x, y, w) => t(x, y + 15, l, { size: 12, fill: th.ink, bg: th.paper, font: BODY, ctx: 'chip' }) + line(x, y + 22, x + w, y + 22, th.rule, 1),
    chart: { colors: [th.tones[4], th.ink, th.accent], bar: 'lollipop', radius: 0, ink: th.ink, muted: th.grey, grid: th.hair, bg: th.paper },
    facts: (facts, x, y, w) => factCols(facts, x, y, w, { font: BODY }, { bg: th.paper, labelFill: th.accentText, valueFill: th.body, rule: th.rule, kind: 'serif', valueFont: SERIF }),
  };
}
const briefUseCasePage = (m, th, u, idx) => ucPage(m, u, idx, ucSkin(m, th, u, has(m, 'inspire_score')));

export default { id: 'b_editorial', name: 'B. Editorial (Paper and Ink)', themes: { light, dark }, fonts: { display: DISPLAY, serif: SERIF, body: BODY }, infographic, deckCover, deckDomain, deckUseCase, briefPage1, briefUseCasePage };
void runW; void VERB_ICON; void bestInk;
