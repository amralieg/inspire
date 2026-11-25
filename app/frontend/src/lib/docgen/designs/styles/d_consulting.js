// Option D "Consulting": a board-pack exhibit page. White, navy and one blue, action titles that state the conclusion, numbered exhibits,
// a waterfall that builds the total, a labelled 2x2, a prioritisation funnel, a ranked table with spark bars and Harvey balls, a source line.
import { t, T, rect, line, icon, svgDoc, money, DISCLAIMER, bestInk, wrap, has, iconName, VERB_ICON } from '../core.js';
import { ucPage, factCols, NOT_YET } from '../ucPage.js';
import { quadrant, waterfall, funnel, harvey, hbars } from '../charts.js';

const BODY = "Arial, 'Helvetica Neue', Helvetica, sans-serif";
const light = { mode: 'light', page: '#FFFFFF', panel: '#F1F3F5', ink: '#14212E', navy: '#0A2F5C', blue: '#2E6BD9', blueText: '#1F56B8', slate: '#5B6B7B', rule: '#C9D1DA',
  green: '#1B7F4C', pale: '#E8F0FC', bar: '#0A2F5C', barAlt: '#8FA3B8', funnel: ['#0A2F5C', '#1F4E8C', '#2E6BD9', '#6E9BE8'] };
const dark = { mode: 'dark', page: '#0D1B2A', panel: '#15263A', ink: '#E8EEF5', navy: '#6FA3FF', blue: '#6FA3FF', blueText: '#8DB6FF', slate: '#A9B6C4', rule: '#2C4058',
  green: '#4CC38A', pale: '#1A3150', bar: '#6FA3FF', barAlt: '#4A5F78', funnel: ['#9CC0FF', '#6FA3FF', '#3F7FE0', '#2A5BAA'] };
const cap = (s) => s.toLowerCase().replace(/^\w/, (c) => c.toUpperCase());
const doFirst = (m) => (u) => u.score >= m.median.score && u.value.amount >= m.median.value;

function topline(W, P, th, right) {
  return rect(0, 0, W, 6, th.navy) + t(P, 30, 'DATABRICKS INSPIRE AI', { size: 12, weight: 700, fill: th.navy === '#6FA3FF' ? th.ink : th.navy, bg: th.page, ls: 1, font: BODY, ctx: 'top' })
    + t(W - P, 30, right, { size: 12, fill: th.slate, bg: th.page, anchor: 'end', font: BODY, ctx: 'top r' }) + line(P, 40, W - P, 40, th.rule, 1);
}
const exhibit = (x, y, n, title, th, w, bg = th.page, size = 13) => {
  const r = T(x + 74, y, title, { size, weight: 700, fill: th.ink, bg, font: BODY, maxW: w - 74, lines: 2, lh: size + 3, ctx: 'exhibit' });
  return { svg: t(x, y, `EXHIBIT ${n}`, { size: 12, weight: 700, fill: th.blueText, bg, ls: 0.6, font: BODY, ctx: 'exh n' }) + r.svg, h: r.h };
};

function infographic(m, th, { W, H }) {
  const P = 36; const CW = W - 2 * P; const small = H < 1100; const df = m.useCases.filter(doFirst(m)); const dfv = df.reduce((a, u) => a + u.value.amount, 0);
  let s = rect(0, 0, W, H, th.page) + topline(W, P, th, `Use case portfolio review · ${m.businessName}`);
  const at = T(P, 74, `${df.length} use cases above the median score and value hold ${money(dfv)} of the ${m.total.text} yearly estimate. Start there.`, { size: small ? 21 : 23, weight: 700, fill: th.ink, bg: th.page, font: BODY, maxW: CW, lines: 2, lh: small ? 26 : 29, ctx: 'action title' });
  s += at.svg;
  let y = 74 + at.h + 4;
  // KPI strip
  const k = [[m.total.text, 'estimated value a year'], [String(m.total.n), 'use cases scored'], [String(m.total.nDomains), 'business domains'], [String(df.length), `do first (${money(dfv)})`]];
  const kw = (CW - 30) / 4;
  k.forEach(([v, l], i) => {
    const x = P + i * (kw + 10);
    s += rect(x, y, kw, 60, th.panel) + rect(x, y, 4, 60, i === 3 ? th.green : th.blue);
    s += t(x + 16, y + 32, v, { size: 24, weight: 700, fill: th.ink, bg: th.panel, font: BODY, ctx: 'kpi' });
    s += t(x + 16, y + 50, l, { size: 12, fill: th.slate, bg: th.panel, font: BODY, ctx: 'kpi l' });
  });
  y += 82;
  // Exhibit 1: waterfall
  const d3 = m.domains.slice(0, 3); const share = Math.round((d3.reduce((a, d) => a + d.value, 0) / m.total.amount) * 100);
  const e1 = exhibit(P, y, 1, `${d3.map((d) => d.name).join(', ')} make up ${share}% of the yearly value`, th, CW);
  s += e1.svg; y += e1.h + 4;
  const wh = small ? 178 : 204;
  s += waterfall(m.domains.map((d) => ({ name: d.name, value: d.value, text: money(d.value) })), { x: P, y, w: CW, h: wh }, { fill: (i) => (i < 3 ? th.bar : th.barAlt), totalFill: th.green, ink: th.ink, muted: th.slate, bg: th.page, grid: th.rule, font: BODY });
  y += wh + 16;
  // Exhibit 2: 2x2, Exhibit 3: funnel
  const lw = Math.round(CW * 0.56); const rx = P + lw + 24; const rw = CW - lw - 24; const qh = small ? 196 : 222;
  s += line(P, y - 6, W - P, y - 6, th.rule, 1);
  s += exhibit(P, y + 10, 2, 'Most value sits right of the median score', th, lw).svg;
  s += exhibit(rx, y + 10, 3, `${df.length} of ${m.total.n} clear both bars`, th, rw).svg;
  const isDf = doFirst(m);
  s += quadrant(m.useCases, { x: P - 6, y: y + 22, w: lw, h: qh - 22 }, { colorOf: (u) => (isDf(u) ? th.blue : th.barAlt), dotOp: 1, axis: th.slate, grid: th.slate, ink: th.ink, muted: th.slate, bg: th.page,
    quadFill: th.pale, quadBg: th.pale, quadInk: th.blueText, mx: m.median.score, my: m.median.value, labelTop: 3, font: BODY, r: () => 4.5, quad: ['Strategic bets', 'Do first', 'Deprioritise', 'Quick wins'] });
  const above = m.useCases.filter((u) => u.score >= m.median.score);
  const stages = [['All use cases', m.useCases], ['Score at or above median', above], ['Value above median too', df], ['Top 3 by value', df.slice().sort((a, b) => b.value.amount - a.value.amount).slice(0, 3)]]
    .map(([name, list]) => ({ label: name, n: list.length, v: list.reduce((a, u) => a + u.value.amount, 0) }));
  const fx = rx; const fw = 96; const fy = y + 34; const fh = qh - 40;
  s += funnel(stages.map((st) => ({ name: String(st.n), n: st.n, text: '' })), { x: fx, y: fy, w: fw, h: fh }, { colors: th.funnel, font: BODY });
  stages.forEach((st, i) => {
    const sy = fy + (i + 0.5) * (fh / stages.length);
    s += T(fx + fw + 12, sy - 2, st.label, { size: 12, weight: 700, fill: th.ink, bg: th.page, font: BODY, maxW: rw - fw - 12, lines: 1, ctx: 'funnel l' }).svg;
    s += t(fx + fw + 12, sy + 13, `${money(st.v)} a year`, { size: 12, fill: th.slate, bg: th.page, font: BODY, ctx: 'funnel v' });
  });
  y += qh + 24;
  // Exhibit 4: ranked table
  s += line(P, y - 6, W - P, y - 6, th.rule, 1);
  const e4 = exhibit(P, y + 10, 4, 'The top use cases by estimated value', th, CW); s += e4.svg; y += 24;
  const cols = { rank: P, name: P + 26, dom: P + 296, val: P + 412, bar: P + 470, score: P + 584, verb: W - P };
  s += rect(P, y, CW, 22, th.panel);
  [['#', cols.rank + 4, 'start'], ['Use case', cols.name, 'start'], ['Domain', cols.dom, 'start'], ['Value a year', cols.val + 48, 'end'], ['Score', cols.score, 'start'], ['Lever', cols.verb, 'end']].filter((c) => (c[0] !== 'Score' || has(m, 'inspire_score')) && (c[0] !== 'Lever' || m.verbs.length)).forEach(([h, x, a]) => {
    s += t(x, y + 15, h, { size: 12, weight: 700, fill: th.slate, bg: th.panel, anchor: a, font: BODY, ctx: 'th' });
  });
  y += 22;
  const footer = 92; const rowH = 27; const rows = Math.max(3, Math.floor((H - y - footer) / rowH));
  const vmax = m.ranked[0].value.amount;
  m.ranked.slice(0, rows).forEach((u, i) => {
    const yy = y + i * rowH; const cy = yy + rowH / 2 + 4; const dname = m.domains.find((q) => q.name === u.domain).icon;
    s += t(cols.rank + 4, cy, String(i + 1), { size: 12, weight: 700, fill: th.ink, bg: th.page, font: BODY, ctx: 'td' });
    s += T(cols.name, cy, u.short, { size: 12, fill: th.ink, bg: th.page, font: BODY, maxW: 262, lines: 1, ctx: 'td' }).svg;
    s += icon(dname, cols.dom, cy - 10, 13, th.slate, 1.8) + t(cols.dom + 18, cy, u.domain, { size: 12, fill: th.ink, bg: th.page, font: BODY, maxW: 92, lines: 1, ctx: 'td' });
    s += t(cols.val + 48, cy, u.value.text, { size: 12, weight: 700, fill: th.ink, bg: th.page, anchor: 'end', font: BODY, ctx: 'td' });
    s += rect(cols.bar, cy - 8, 96, 8, th.panel) + rect(cols.bar, cy - 8, (u.value.amount / vmax) * 96, 8, isDf(u) ? th.blue : th.barAlt);
    if (has(m, 'inspire_score')) s += harvey(cols.score + 6, cy - 4, 6, u.score, th.navy, th.page) + t(cols.score + 18, cy, u.score.toFixed(1), { size: 12, fill: th.ink, bg: th.page, font: BODY, ctx: 'td' });
    if (m.verbs.length) s += t(cols.verb, cy, cap(u.verb), { size: 12, fill: th.slate, bg: th.page, anchor: 'end', font: BODY, ctx: 'td' });
    s += line(P, yy + rowH, W - P, yy + rowH, th.rule, 0.6);
  });
  y += rows * rowH + 16;
  s += T(P, y, `How to read: dashed lines mark the median score (${m.median.score.toFixed(1)}) and median value (${money(m.median.value)}). Blue = do first. Harvey ball = score out of 10.`, { size: 12, fill: th.ink, bg: th.page, font: BODY, maxW: CW, lines: 2, lh: 15, ctx: 'how' }).svg;
  s += T(P, y + 34, `Source: Databricks Inspire AI analysis of the ${m.businessName} catalog.${has(m, 'disclaimer') ? ` ${DISCLAIMER}` : ''}`, { size: 12, fill: th.slate, bg: th.page, font: BODY, maxW: CW, lines: 3, lh: 15, ctx: 'source' }).svg;
  return svgDoc(W, H, s, BODY);
}

const SW = 1333; const SH = 750; const SP = 60;
function slideFrame(th, title, n, right) {
  let s = rect(0, 0, SW, SH, th.page) + rect(0, 0, SW, 8, th.navy);
  const at = T(SP, 70, title, { size: 30, weight: 700, fill: th.ink, bg: th.page, font: BODY, maxW: SW - 2 * SP, lines: 2, lh: 36, ctx: 'action title' });
  s += at.svg + line(SP, 70 + at.h + 4, SW - SP, 70 + at.h + 4, th.rule, 1);
  s += line(SP, SH - 46, SW - SP, SH - 46, th.rule, 1);
  s += t(SP, SH - 20, 'Source: Databricks Inspire AI. Estimated value, not a promised value; your business value team must validate it.', { size: 16, fill: th.slate, bg: th.page, font: BODY, ctx: 'source' });
  s += t(SW - SP, SH - 20, `${right} · ${n}`, { size: 16, fill: th.slate, bg: th.page, anchor: 'end', font: BODY, ctx: 'page' });
  return { s, top: 70 + at.h + 30 };
}

function deckCover(m, th) {
  let s = rect(0, 0, SW, SH, th.page) + rect(0, 0, 24, SH, th.navy);
  s += t(90, 90, 'DATABRICKS INSPIRE AI', { size: 18, weight: 700, fill: th.blueText, bg: th.page, ls: 2, font: BODY, ctx: 'brand' });
  s += t(90, 230, 'Use case portfolio review', { size: 56, weight: 700, fill: th.ink, bg: th.page, font: BODY, ctx: 'title' });
  s += t(90, 284, `${m.businessName} · November 2026`, { size: 26, fill: th.slate, bg: th.page, font: BODY, ctx: 'sub' });
  s += rect(90, 318, 120, 4, th.blue);
  const df = m.useCases.filter(doFirst(m));
  [[m.total.text, 'estimated value a year'], [String(m.total.n), 'use cases scored'], [String(df.length), 'to do first']].forEach(([v, l], i) => {
    const x = 90 + i * 225;
    s += line(x, 420, x + 190, 420, th.ink, 2);
    s += t(x, 480, v, { size: 48, weight: 700, fill: th.ink, bg: th.page, font: BODY, ctx: 'kpi' }) + t(x, 512, l, { size: 18, fill: th.slate, bg: th.page, font: BODY, ctx: 'kpi l' });
  });
  // exhibit preview: the waterfall in a panel
  s += rect(790, 120, 483, 470, th.panel);
  s += t(814, 156, 'EXHIBIT', { size: 16, weight: 700, fill: th.blueText, bg: th.panel, font: BODY, ctx: 'exh' }) + t(814, 182, 'Value builds by domain', { size: 18, weight: 700, fill: th.ink, bg: th.panel, font: BODY, ctx: 'exh t' });
  const n = Math.min(3, m.domains.length); const rest = m.domains.slice(n).reduce((a, d) => a + d.value, 0);
  const items = [...m.domains.slice(0, n).map((d) => ({ name: d.name, value: d.value, text: money(d.value) })), ...(rest ? [{ name: 'Other', value: rest, text: money(rest) }] : [])];
  s += waterfall(items, { x: 808, y: 200, w: 447, h: 370 }, { fill: (i) => (i < 3 ? th.bar : th.barAlt), totalFill: th.green, ink: th.ink, muted: th.slate, bg: th.panel, grid: th.rule, font: BODY, size: 16 });
  s += t(90, 690, 'Estimated value, not a promised value. Your business value team must validate it.', { size: 16, fill: th.slate, bg: th.page, font: BODY, ctx: 'disc' });
  return svgDoc(SW, SH, s, BODY);
}

function deckDomain(m, th, d, idx) {
  const ucs = m.ranked.filter((u) => u.domain === d.name); const isDf = doFirst(m);
  const f = slideFrame(th, `${d.name} is worth ${d.text} a year across ${d.n} use cases; ${ucs[0].short} leads`, idx + 3, `Domain ${idx + 1} of ${m.total.nDomains}`);
  let s = f.s; const y0 = f.top;
  s += t(SP, y0, 'EXHIBIT 1', { size: 16, weight: 700, fill: th.blueText, bg: th.page, font: BODY, ctx: 'exh' }) + t(SP + 100, y0, 'Use cases in this domain', { size: 18, weight: 700, fill: th.ink, bg: th.page, font: BODY, ctx: 'exh t' });
  let y = y0 + 16;
  s += rect(SP, y, 760, 32, th.panel);
  [['Use case', SP + 12, 'start'], ['Value a year', SP + 520, 'end'], ['Score', SP + 600, 'middle'], ['Do first', SP + 700, 'middle']].forEach(([h, x, a]) => { s += t(x, y + 22, h, { size: 16, weight: 700, fill: th.slate, bg: th.panel, anchor: a, font: BODY, ctx: 'th' }); });
  y += 32; const max = ucs[0].value.amount;
  ucs.slice(0, 7).forEach((u) => {
    const cy = y + 30;
    s += T(SP + 12, cy - 6, u.short, { size: 16, fill: th.ink, bg: th.page, font: BODY, maxW: 360, lines: 1, ctx: 'td' }).svg;
    s += rect(SP + 12, cy + 4, (u.value.amount / max) * 330, 6, isDf(u) ? th.blue : th.barAlt);
    s += t(SP + 520, cy, u.value.text, { size: 16, weight: 700, fill: th.ink, bg: th.page, anchor: 'end', font: BODY, ctx: 'td' });
    s += harvey(SP + 586, cy - 5, 9, u.score, th.navy, th.page) + t(SP + 602, cy, u.score.toFixed(1), { size: 16, fill: th.ink, bg: th.page, font: BODY, ctx: 'td' });
    s += t(SP + 700, cy, isDf(u) ? 'Yes' : 'No', { size: 16, weight: isDf(u) ? 700 : 400, fill: isDf(u) ? th.blueText : th.slate, bg: th.page, anchor: 'middle', font: BODY, ctx: 'td' });
    s += line(SP, y + 48, SP + 760, y + 48, th.rule, 1);
    y += 48;
  });
  const rx = SP + 800; const rw = SW - SP - rx;
  s += t(rx, y0, 'EXHIBIT 2', { size: 16, weight: 700, fill: th.blueText, bg: th.page, font: BODY, ctx: 'exh' }) + t(rx + 100, y0, 'Share of all value', { size: 18, weight: 700, fill: th.ink, bg: th.page, font: BODY, ctx: 'exh t' });
  s += hbars(m.domains.map((q) => ({ label: q.name, value: q.value, text: money(q.value) })), { x: rx, y: y0 + 18, w: rw }, { rowH: 46, barH: 14, labelW: 130, valueW: 70, rx: 0, size: 16,
    fill: (i, r) => (r.label === d.name ? th.blue : th.barAlt), track: th.panel, ink: th.ink, bg: th.page, font: BODY }).svg;
  return svgDoc(SW, SH, s, BODY);
}

function deckUseCase(m, th, u, idx) {
  const f = slideFrame(th, `${u.short}: an estimated ${u.value.yearText}, score ${u.score.toFixed(1)} of 10`, idx + 12, `${u.id} · ${u.domain}`);
  let s = f.s; let y = f.top - 10;
  const rows = [['Situation', u.statement], ['Resolution', u.solution], ['Impact', u.businessValue]];
  rows.forEach(([l, v]) => {
    const lines = wrap(v, 590, 17, 'sans', 400, 4); const h = Math.max(80, lines.length * 24 + 30);
    s += rect(SP, y, 170, h - 6, th.panel) + t(SP + 16, y + 30, l, { size: 18, weight: 700, fill: th.ink, bg: th.panel, font: BODY, ctx: 'lbl' });
    s += T(SP + 194, y + 28, v, { size: 17, fill: th.ink, bg: th.page, font: BODY, maxW: 590, lines: 4, lh: 24, ctx: 'txt' }).svg;
    y += h;
  });
  const rx = 900; const rw = SW - SP - rx;
  s += rect(rx, f.top - 10, rw, 120, th.navy === '#6FA3FF' ? th.panel : th.navy);
  const vb = th.navy === '#6FA3FF' ? th.panel : th.navy; const vInk = bestInk(vb, '#14212E', '#FFFFFF');
  s += t(rx + 20, f.top + 22, 'ESTIMATED VALUE', { size: 16, weight: 700, fill: vInk, bg: vb, font: BODY, ctx: 'vb' });
  s += t(rx + 20, f.top + 80, u.value.yearText, { size: 40, weight: 700, fill: vInk, bg: vb, font: BODY, ctx: 'vb v' });
  let sy = f.top + 150;
  s += t(rx, sy, 'Scorecard', { size: 18, weight: 700, fill: th.ink, bg: th.page, font: BODY, ctx: 'sc' }); sy += 14;
  [['Inspire score', u.score, 10], ['Priority', u.priorityScore, 10], ['Feasibility', u.feasibility, 5], ['Value', u.valueScore, 5]].forEach(([l, v, max]) => {
    sy += 46; s += line(rx, sy + 14, rx + rw, sy + 14, th.rule, 1);
    s += t(rx, sy, l, { size: 17, fill: th.ink, bg: th.page, font: BODY, ctx: 'sc l' });
    s += harvey(rx + rw - 100, sy - 6, 12, (v / max) * 10, th.navy, th.page) + t(rx + rw, sy, `${v.toFixed(1)} / ${max}`, { size: 17, weight: 700, fill: th.ink, bg: th.page, anchor: 'end', font: BODY, ctx: 'sc v' });
  });
  sy += 46; s += t(rx, sy, `Lever: ${cap(u.verb)} · Sponsor: ${u.sponsor}`, { size: 16, fill: th.slate, bg: th.page, font: BODY, ctx: 'sc m' });
  return svgDoc(SW, SH, s, BODY);
}

function briefPage1(m, th) {
  const W = 794; const H = 1123; const P = 48; const CW = W - 2 * P; const df = m.useCases.filter(doFirst(m)); const dfv = df.reduce((a, u) => a + u.value.amount, 0);
  let s = rect(0, 0, W, H, th.page) + topline(W, P, th, `Executive summary · ${m.businessName}`);
  s += T(P, 84, `${m.total.yearText} of estimated value sits in ${m.total.n} use cases. ${df.length} of them should go first.`, { size: 24, weight: 700, fill: th.ink, bg: th.page, font: BODY, maxW: CW, lines: 2, lh: 30, ctx: 'title' }).svg;
  const d3 = m.domains.slice(0, 3); const share = Math.round((d3.reduce((a, d) => a + d.value, 0) / m.total.amount) * 100);
  const msgs = [`Value is concentrated: ${d3.map((d) => d.name).join(', ')} hold ${share}% of the ${m.total.text}.`,
    `${df.length} use cases sit above the median score (${m.median.score.toFixed(1)}) and the median value (${money(m.median.value)}); together they are worth ${money(dfv)} a year.`,
    `The largest single use case is ${m.ranked[0].short}, at ${m.ranked[0].value.yearText}.`];
  // REQ-526 part E: the session's executive summary (up to three lines) leads the page; the key messages follow.
  let y = 172;
  if (m.summary.length) { const r = T(P, 140, m.summary.join(' '), { size: 14, fill: th.ink, bg: th.page, font: BODY, maxW: CW, lines: 3, lh: 19, ctx: 'summary' }); s += r.svg; y = 140 + (r.lines - 1) * 19 + 34; }
  msgs.forEach((msg, i) => {
    s += rect(P, y - 16, 22, 22, th.blue) + t(P + 11, y, String(i + 1), { size: 13, weight: 700, fill: bestInk(th.blue, '#14212E', '#FFFFFF'), bg: th.blue, anchor: 'middle', font: BODY, ctx: 'n' });
    const r = T(P + 36, y, msg, { size: 14, fill: th.ink, bg: th.page, font: BODY, maxW: CW - 36, lines: 2, lh: 19, ctx: 'msg' }); s += r.svg; y += r.h + 16;
  });
  y += 8; s += line(P, y, W - P, y, th.rule, 1); y += 26;
  const e1 = exhibit(P, y, 1, 'Domain values build to the total', th, CW); s += e1.svg; y += e1.h + 4;
  s += waterfall(m.domains.map((d) => ({ name: d.name, value: d.value, text: money(d.value) })), { x: P, y, w: CW, h: 260 }, { fill: (i) => (i < 3 ? th.bar : th.barAlt), totalFill: th.green, ink: th.ink, muted: th.slate, bg: th.page, grid: th.rule, font: BODY });
  y += 280; s += line(P, y, W - P, y, th.rule, 1); y += 26;
  const e2 = exhibit(P, y, 2, 'Top seven use cases by value', th, CW); s += e2.svg; y += 14;
  s += rect(P, y, CW, 24, th.panel);
  [['Use case', P + 10, 'start'], ['Domain', P + 420, 'start'], ['Value a year', P + 600, 'end'], ['Score', W - P - 10, 'end']].filter((c) => c[0] !== 'Score' || has(m, 'inspire_score')).forEach(([h, x, a]) => { s += t(x, y + 16, h, { size: 12, weight: 700, fill: th.slate, bg: th.panel, anchor: a, font: BODY, ctx: 'th' }); });
  y += 24;
  m.ranked.slice(0, 7).forEach((u) => {
    const cy = y + 22;
    s += T(P + 10, cy, u.name, { size: 13, fill: th.ink, bg: th.page, font: BODY, maxW: 400, lines: 1, ctx: 'td' }).svg;
    s += t(P + 420, cy, u.domain, { size: 13, fill: th.ink, bg: th.page, font: BODY, ctx: 'td' });
    s += t(P + 600, cy, u.value.text, { size: 13, weight: 700, fill: th.ink, bg: th.page, anchor: 'end', font: BODY, ctx: 'td' });
    if (has(m, 'inspire_score')) s += harvey(W - P - 50, cy - 4, 7, u.score, th.navy, th.page) + t(W - P - 10, cy, u.score.toFixed(1), { size: 13, fill: th.ink, bg: th.page, anchor: 'end', font: BODY, ctx: 'td' });
    s += line(P, y + 34, W - P, y + 34, th.rule, 0.6); y += 34;
  });
  s += T(P, 1010, `Source: Databricks Inspire AI analysis of the ${m.businessName} catalog.${has(m, 'disclaimer') ? ` ${DISCLAIMER}` : ''}`, { size: 12, fill: th.slate, bg: th.page, font: BODY, maxW: CW, lines: 4, lh: 15, ctx: 'source' }).svg;
  s += line(P, 1076, W - P, 1076, th.rule, 1) + t(W - P, 1096, '1', { size: 12, fill: th.slate, bg: th.page, anchor: 'end', font: BODY, ctx: 'page' });
  return svgDoc(W, H, s, BODY);
}


// REQ-526 part C: the brief use case page in this design (board-pack topline, action title, panel of three facts, flat bars, source line).
function ucSkin(m, th, u, showScore) {
  const W = 794; const P = 48; const CW = W - 2 * P;
  const sub = [u.domain, u.subdomain].filter(Boolean).join(' · ');
  return {
    id: 'd_consulting', P, footH: 76, gap: 16, pad: 0, labelH: 28, chipH: 24, chipPad: 10, chartH: 190, factsH: 74,
    bg: th.page, boxBg: th.page, font: BODY, kind: 'sans', body: th.ink,
    frame: (n) => rect(0, 0, W, 1123, th.page) + topline(W, P, th, `${m.businessName} · Use case ${n - 1}`)
      + t(P, 1052, `Source: Databricks Inspire AI analysis of the ${m.businessName} catalog.`, { size: 12, fill: th.slate, bg: th.page, font: BODY, maxW: CW, lines: 1, ctx: 'source' })
      + line(P, 1076, W - P, 1076, th.rule, 1) + t(W - P, 1096, String(n), { size: 12, fill: th.slate, bg: th.page, anchor: 'end', font: BODY, ctx: 'page' }),
    head: () => {
      const nm = T(P, 96, u.name, { size: 22, weight: 700, fill: th.ink, bg: th.page, font: BODY, maxW: CW, lines: 3, lh: 28, ctx: 'uc name' });
      return { h: 96 + (nm.lines - 1) * 28 + 14, svg: t(P, 68, [u.id, sub].filter(Boolean).join(' · '), { size: 12, weight: 700, fill: th.blueText, bg: th.page, caps: true, ls: 0.6, font: BODY, maxW: CW, lines: 1, ctx: 'uc kicker' }) + nm.svg };
    },
    tile: (y) => {
      let s = rect(P, y, CW, 84, th.panel);
      if (u.value) s += t(P + 18, y + 42, u.value.text, { size: 28, weight: 700, fill: th.mode === 'dark' ? th.ink : th.navy, bg: th.panel, font: BODY, ctx: 'uc value' }) + t(P + 18, y + 64, `${u.value.status || 'estimated'} a year`, { size: 12, fill: th.slate, bg: th.panel, font: BODY, ctx: 'uc value l' });
      else s += t(P + 18, y + 48, NOT_YET, { size: 16, weight: 700, fill: th.slate, bg: th.panel, font: BODY, ctx: 'uc nv' });
      if (showScore && u.score != null) s += line(P + 236, y + 14, P + 236, y + 70, th.rule, 1) + harvey(P + 272, y + 42, 16, u.score, th.navy, th.page) + t(P + 302, y + 40, u.score.toFixed(1), { size: 20, weight: 700, fill: th.ink, bg: th.panel, font: BODY, ctx: 'uc score' }) + t(P + 302, y + 62, 'Inspire score of 10', { size: 12, fill: th.slate, bg: th.panel, font: BODY, ctx: 'uc score l' });
      if (u.verb) s += line(P + 490, y + 14, P + 490, y + 70, th.rule, 1) + icon(VERB_ICON[u.verb] || 'target', P + 508, y + 30, 24, th.blueText, 1.8) + T(P + 542, y + 38, u.verb, { size: 13, weight: 700, fill: th.ink, bg: th.panel, font: BODY, maxW: 150, lines: 2, lh: 16, ctx: 'uc verb' }).svg;
      return { h: 84, svg: s };
    },
    label: (text, x, y, w) => t(x, y + 12, text, { size: 12, weight: 700, fill: th.blueText, bg: th.page, caps: true, ls: 0.6, font: BODY, ctx: 'uc label' }) + line(x, y + 20, x + w, y + 20, th.rule, 1),
    chipW: (l) => Math.ceil(l.length * 12 * 0.56 + 20),
    chipSvg: (l, x, y, w) => rect(x, y, w, 24, th.panel, { stroke: th.rule }) + t(x + 10, y + 16, l, { size: 12, fill: th.ink, bg: th.panel, font: BODY, ctx: 'chip' }),
    chart: { colors: [th.barAlt, th.bar, th.green], bar: 'bars', radius: 0, ink: th.ink, muted: th.slate, grid: th.rule, bg: th.page },
    facts: (facts, x, y, w) => factCols(facts, x, y, w, { font: BODY }, { bg: th.page, labelFill: th.slate, valueFill: th.ink, rule: th.rule }),
  };
}
const briefUseCasePage = (m, th, u, idx) => ucPage(m, u, idx, ucSkin(m, th, u, has(m, 'inspire_score')));

export default { id: 'd_consulting', name: 'D. Consulting (Board Pack)', themes: { light, dark }, fonts: { display: BODY, body: BODY }, infographic, deckCover, deckDomain, deckUseCase, briefPage1, briefUseCasePage };
