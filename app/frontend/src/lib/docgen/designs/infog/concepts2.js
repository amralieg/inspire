// REQ-574 / REQ-571: gallery concepts 5-12. Each draws one use case story with its own visual idea; the words and numbers come
// only from the use case (storyOf), the drawing from the library blocks. Phrases are cut from the use case text by pattern, with
// a neutral fallback when the pattern does not match.
import { P, tint, f1, badge, callout, blob, ring, curve, arrow, hex, radial, pill } from './shapes.js';
import { icon, iconDisc, iconFor } from './icons.js';
import { textBlock, label } from './text.js';
import { chevronSteps, funnel, hubSpokes, decisionSplit } from './process.js';
import { unitGrid, unitRow } from './pictogram.js';
import { dashboardScreen, person, documentSheet, mapField, constellation } from './scenes.js';
import { LAND, PORT, frame, titleBlock, hero, heroWidth, splitStake, whoBlock, tagline } from './common.js';
import { storyOf } from './story.js';

const fact = (s, unit, i = 0) => s.facts.filter((f) => unit == null || f.unit === unit)[i];
const cap = (t) => (t ? t.charAt(0).toUpperCase() + t.slice(1) : '');
const afterColon = (t) => String(t || '').split(':').pop().trim();
const proc = (name, svg) => `<g data-process="${name}">${svg}</g>`;

// 5. Before and after: a diagonal split. Left, the stack of flagged invoices and the money at risk; right, the matching that catches them.
export function beforeAfter(row) {
  const s = storyOf(row); const { w, h } = LAND; let b = '';
  b += `<path d="M0,250 L730,250 L560,${h} L0,${h}Z" fill="${tint(P.lava)}"/><path d="M730,250 L${w},250 L${w},${h} L560,${h}Z" fill="${tint(P.green)}"/>`;
  const t = titleBlock(s, 56, 36, 1100, { pill: P.lava, size: 44 }); b += t.svg;
  b += textBlock(56, t.bottom + 10, 1100, s.statement, { size: 22, color: P.body, maxLines: 2 }).svg;
  b += pill(40, 272, 'BEFORE', P.lava, '#fff', 20).svg + pill(1080, 272, 'AFTER', P.green, '#fff', 20).svg;
  // before: a fanned stack of invoices with alert stamps
  [[-10, 70, 360], [-4, 92, 340], [3, 112, 326]].forEach(([rot, x, y]) => { b += `<g transform="rotate(${rot} ${x + 80} ${y + 100})">${documentSheet(x, y, 160, 210, P.lava)}</g>`; });
  b += iconDisc('alert', 260, 360, 30, P.lava);
  const money = fact(s, '$', 0); const count = fact(s, '', 0); const old = s.facts.filter((f) => f.unit === '').slice(-1)[0];
  if (money) { b += hero(310, 410, money.raw, 88, P.lava) + label(312, 446, afterColon(money.clause).replace(/^.*?hold\s+\S+\s*/, '') || 'at risk', { size: 22, weight: 700, color: P.ink }); }
  if (count) { const g = unitGrid(312, 474, 10, count.value, count.value, 'doc', 22, 7, P.lava, P.panel2); b += g.svg + label(312, 474 + g.h + 30, `${count.raw} invoices`, { size: 22, weight: 700, color: P.ink }); }
  if (old && old !== count) { b += icon('clock', 60, 690, 30, P.lava, 2.2) + textBlock(100, 688, 400, cap(old.clause), { size: 22, weight: 600, color: P.ink, maxLines: 2 }).svg; }
  // after: one line matched to two records, a shield in the middle
  const st = s.steps; const m = /^(.*?)\s+(?:line\s+)?is matched to its\s+(.+?)\s+and its\s+(.+)$/i.exec(st[0]?.label || '');
  const ends = m ? [m[1].replace(/^every\s+/i, ''), m[2], m[3]] : ['each record', 'its source', 'its terms'];
  const pos = [[800, 380], [1150, 380], [975, 600]]; const ic = ['receipt', iconFor(ends[1], 'box'), iconFor(ends[2], 'document')]; const col = [P.blue, P.cyan, P.purple];
  let net = '';
  pos.forEach(([x, y]) => { net += `<path d="M${x},${y} L975,470" stroke="${P.green}" stroke-width="6" stroke-dasharray="2 10" stroke-linecap="round"/>`; });
  net += `<circle cx="975" cy="470" r="70" fill="#fff" filter="url(#sh)"/>` + iconDisc('shield', 975, 470, 56, P.green);
  pos.forEach(([x, y], i) => { net += `<circle cx="${x}" cy="${y}" r="44" fill="#fff" filter="url(#sh)"/>` + iconDisc(ic[i], x, y, 36, col[i]); });
  b += proc('match', net);
  b += label(800, 450, cap(ends[0]), { size: 20, weight: 700, color: P.ink, anchor: 'middle' }) + label(1150, 450, cap(ends[1]), { size: 20, weight: 700, color: P.ink, anchor: 'middle' });
  b += label(1050, 610, cap(ends[2]), { size: 20, weight: 700, color: P.ink });
  b += textBlock(600, 650, 330, st[1]?.label || '', { size: 20, color: P.body, maxLines: 6 }).svg;
  b += `<g transform="translate(950 660)">${whoBlock(0, 0, s, [P.green, P.blue, P.purple], { ph: 70, w: 180, size: 22 }).svg}</g>`;
  return frame('beforeafter', 'landscape', w, h, '', b, { uc: s.id });
}

// 6. Timeline with a forecast band: history, today, the rising range, and the weeks where the top of the range crosses capacity.
export function forecastBand(row) {
  const s = storyOf(row); const { w, h } = LAND; let b = '';
  const t = titleBlock(s, 56, 36, 820, { pill: P.blue, size: 44 }); b += t.svg;
  b += textBlock(56, t.bottom + 10, 840, s.problem, { size: 22, color: P.body, maxLines: 2 }).svg;
  // the chart: x0..x1, history to `now`, then 8 forecast weeks; the curve is a drawn shape (no axis values are claimed)
  const x0 = 70; const now = 520; const x1 = 900; const base = 470; const wk = (x1 - now) / 8;
  const hist = Array.from({ length: 15 }, (_, i) => [x0 + i * ((now - x0) / 14), base - 10 * Math.sin(i * 1.3) - 6 * Math.cos(i * 0.7)]);
  const bump = [0, 12, 26, 44, 50, 28, 24, 18, 14]; const fc = bump.map((v, i) => [now + i * wk, base - 16 - v]);
  const band = (i) => 18 + i * 5; const cap0 = 380;
  let ch = `<rect x="${x0 - 20}" y="250" width="${x1 - x0 + 40}" height="290" rx="24" fill="#fff" filter="url(#sh)"/>`;
  // weeks over capacity
  const over = fc.map(([x, y], i) => ({ i, x, top: y - band(i) })).filter((p) => p.i > 0 && p.top < cap0);
  over.forEach((p) => { ch += `<rect x="${f1(p.x - wk / 2)}" y="262" width="${f1(wk)}" height="266" fill="${tint(P.lava)}"/>`; });
  ch += `<path d="M${fc.map(([x, y], i) => `${f1(x)},${f1(y - band(i))}`).join(' L')} L${fc.slice().reverse().map(([x, y], k) => `${f1(x)},${f1(y + band(8 - k))}`).join(' L')}Z" fill="${P.blue}" opacity="0.18"/>`;
  ch += `<path d="M${x0},${cap0} L${x1},${cap0}" stroke="${P.lava}" stroke-width="3" stroke-dasharray="10 8"/>`;
  ch += `<path d="M${hist.map((p) => p.map(f1).join(',')).join(' L')}" stroke="${P.ink}" stroke-width="5" fill="none" stroke-linejoin="round"/>`;
  ch += `<path d="M${fc.map((p) => p.map(f1).join(',')).join(' L')}" stroke="${P.blue}" stroke-width="5" fill="none" stroke-dasharray="12 8" stroke-linejoin="round"/>`;
  ch += `<path d="M${now},262 L${now},528" stroke="${P.grey}" stroke-width="2"/>` + label(now - 10, 290, 'TODAY', { size: 20, weight: 800, color: P.grey, anchor: 'end', spacing: 1.5 });
  ch += label(x0, 520, 'history', { size: 20, color: P.grey }) + label(now + 12, 520, 'forecast range', { size: 20, color: P.blue, weight: 700 });
  ch += label(x1 - 4, cap0 + 28, 'capacity', { size: 20, weight: 700, color: P.lava, anchor: 'end' });
  over.forEach((p) => { ch += iconDisc('alert', p.x, 298, 16, P.lava); });
  b += `<g data-chart="forecast">${ch}</g>`;
  const up = fact(s, '%', 0);
  if (up) { const px = now + 4 * wk; const py = fc[4][1]; b += `<circle cx="${f1(px)}" cy="${f1(py)}" r="9" fill="${P.blue}" stroke="#fff" stroke-width="3"/>`; }
  // value + who on the right
  const st = splitStake(s.stake);
  b += iconDisc('trendUp', 980, 290, 34, P.blue) + hero(1028, 312, up ? `+${up.raw}` : '', 64, 'url(#gCool)') + textBlock(944, 336, 270, up ? up.clause.replace(/^.*?rises\s+\S+\s*/i, '') : '', { size: 20, color: P.body, maxLines: 2 }).svg;
  b += hero(944, 462, st.num, 76, 'url(#gHot)');
  b += textBlock(944, 480, 270, `${st.rest}: ${s.valueWhat.charAt(0).toLowerCase()}${s.valueWhat.slice(1)}`, { size: 20, color: P.body, maxLines: 2 }).svg;
  b += `<g transform="translate(940 600)">${whoBlock(0, 0, s, [P.blue, P.amber, P.green], { ph: 84, w: 200, size: 22 }).svg}</g>`;
  b += chevronSteps(50, 572, 850, 70, s.steps.slice(0, 3), [P.ink, P.blue, P.green], { size: 20, maxLines: 3 }).svg;
  return frame('timeline', 'landscape', w, h, '', b, { uc: s.id });
}

// 7. Funnel: everyone at risk, the few called this week, the share of the value they reach; how the list is made below.
export function funnelStory(row) {
  const s = storyOf(row); const { w, h } = PORT; let b = '';
  b += blob(1080, 260, 260, 220, tint(P.pink), 2) + blob(150, 1000, 240, 260, tint(P.amber), 5);
  const t = titleBlock(s, 64, 56, 1100, { pill: P.pink, size: 52 }); b += t.svg;
  b += textBlock(64, t.bottom + 18, 1100, s.statement, { size: 26, color: P.body, maxLines: 3 }).svg;
  const n1 = fact(s, '', 0); const n2 = fact(s, '', 1); const sh = fact(s, '%', 0); const money = fact(s, '$', 0);
  const stages = [
    { num: n1?.raw, txt: n1 ? n1.clause.replace(n1.raw, '').replace(/worth\s+\S+\s+a year\s*/, '').trim() : '', icon: 'users' },
    { num: n2 ? `Top ${n2.raw}` : '', txt: n2 ? (/(this \w+)/.exec(n2.clause) || [])[1] ? `called ${(/(this \w+)/.exec(n2.clause) || [])[1]}` : 'called' : '', icon: 'phone' },
    { num: sh?.raw, txt: 'of the value reached', icon: 'percent' },
  ];
  const fy = 330; const sH = 150; const f = funnel(170, fy, 900, sH, stages, [P.pink, P.purple, P.blue], { minW: 340 }); b += f.svg;
  f.nodes.forEach((nd, i) => { const st = stages[i]; const midW = (nd.top + nd.bot) / 2;
    b += label(nd.cx, nd.y + 70, st.num || '', { size: 60, weight: 800, color: '#fff', anchor: 'middle' }) + textBlock(nd.cx, nd.y + 86, midW - 120, st.txt, { size: 22, weight: 600, color: '#fff', anchor: 'middle', maxLines: 2 }).svg.replace(/x="[\d.]+"/g, `x="${f1(nd.cx)}"`);
    b += `<circle cx="${f1(nd.cx - nd.top / 2 - 30)}" cy="${f1(nd.y + sH / 2)}" r="42" fill="#fff" filter="url(#sh)"/>` + iconDisc(st.icon, nd.cx - nd.top / 2 - 30, nd.y + sH / 2, 34, [P.pink, P.purple, P.blue][i]); });
  // the drop out of the funnel: the value
  const by = fy + 3 * (sH + 10); b += arrow(620, by + 4, 620, by + 64, P.blue, 6, 22);
  const st = splitStake(s.stake); const hw = heroWidth(st.num, 120);
  b += hero(620 - (hw + 140) / 2 + 60, by + 190, st.num, 120, 'url(#gHot)') + label(620 - (hw + 140) / 2 + 70 + hw, by + 190, st.rest, { size: 32, weight: 700, color: P.body });
  b += iconDisc('coin', 620 - (hw + 140) / 2, by + 150, 44, P.amber);
  b += textBlock(620, by + 216, 800, s.valueWhat, { size: 24, color: P.body, anchor: 'middle', maxLines: 1 }).svg;
  // how the list is made: nodes joined by curved connectors
  const py = by + 330; b += tagline(64, py, 'route', 'HOW THE LIST IS MADE', P.pink);
  const steps = s.steps.slice(0, 3); const xs = [200, 620, 1040]; const cy = py + 90; let pr = '';
  steps.forEach((x, i) => { if (i) pr += curve([xs[i - 1] + 60, cy], [xs[i - 1] + 170, cy - 60], [xs[i] - 170, cy - 60], [xs[i] - 62, cy], P.grey, 4, { head: 16 }); });
  steps.forEach((x, i) => { pr += `<circle cx="${xs[i]}" cy="${cy}" r="52" fill="#fff" filter="url(#sh)"/>` + iconDisc(x.icon, xs[i], cy, 42, [P.purple, P.blue, P.pink][i]) + badge(xs[i] + 40, cy - 40, 18, String(i + 1), P.ink); });
  b += proc('nodes', pr);
  steps.forEach((x, i) => { b += textBlock(xs[i], cy + 76, 340, x.label, { size: 22, color: P.ink, anchor: 'middle', maxLines: 5 }).svg.replace(/x="[\d.]+"/g, `x="${xs[i]}"`); });
  b += `<g transform="translate(64 ${h - 170})">${whoBlock(0, 0, s, [P.pink, P.purple, P.blue]).svg}</g>`;
  if (money) b += tagline(700, h - 90, 'calendar', `A fresh list ${s.cadence.toLowerCase()}`, P.pink);
  return frame('funnel', 'portrait', w, h, '', b, { uc: s.id });
}

// 8. Hub and spokes: a person asks in plain words, the agent at the hub draws on its sources, the answer comes back with the proof.
export function hubAgent(row) {
  const s = storyOf(row); const { w, h } = LAND; let b = '';
  b += blob(620, 470, 330, 250, tint(P.cyan), 4);
  const t = titleBlock(s, 56, 36, 620, { pill: P.cyan, size: 42 }); b += t.svg;
  const q = fact(s, '', 0); const right = fact(s, '', 1); const of = fact(s, '', 2);
  if (q) b += hero(1190, 112, q.raw, 92, 'url(#gCool)', 'end') + label(1190, 148, q.clause.replace(q.raw, '').trim(), { size: 22, weight: 700, color: P.body, anchor: 'end' });
  if (right && of) { b += ring(750, 112, 56, 14, right.value / of.value, P.green, tint(P.green)) + label(750, 122, `${right.raw}/${of.raw}`, { size: 26, weight: 800, color: P.green, anchor: 'middle' });
    b += textBlock(750, 186, 260, right.clause.replace(/^\S+\s+of\s+\S+\s+/, ''), { size: 20, color: P.body, anchor: 'middle', maxLines: 2 }).svg.replace(/x="[\d.]+"/g, 'x="750"'); }
  // inputs cut from the method: "X, with Y. Z"
  const parts = String(s.steps[0]?.label || '').split(/,\s+with\s+|\.\s+/).map((p) => p.trim()).filter(Boolean);
  const src = parts[0] ? parts[0].replace(/^.*?\bon\s+(?:the\s+)?/i, '') : 'the data'; const spokes = [src, parts[1] || 'checked examples', (parts[2] || 'short summaries').replace(/^.*?writes\s+/i, '')];
  const ask = (/^(.*?)\s+and get\s+(.+)$/i.exec(s.screenDetail) || []);
  const cx = 600; const cy = 500;
  const hs = hubSpokes(cx, cy, 175, 'message', spokes.map((x, i) => ({ icon: ['database', 'checklist', 'document'][i] })), [P.blue, P.purple, P.amber], { start: -Math.PI * 5 / 6, span: Math.PI * 2 / 3, hubR: 70, spokeR: 36, hubColor: P.cyan });
  let net = hs.svg.replace('data-process="hub"', 'data-part="hub"');
  net += curve([200, 560], [300, 600], [420, 580], [515, 530], P.grey, 5, { head: 18 }) + curve([680, 540], [780, 600], [850, 570], [895, 505], P.grey, 5, { head: 18 });
  b += proc('hub', net);
  const sp = hs.nodes; const lab = [[sp[0].x - 190, sp[0].y + 50, 200], [sp[1].x + 52, sp[1].y - 30, 200], [sp[2].x - 20, sp[2].y + 50, 200]];
  spokes.forEach((x, i) => { b += textBlock(lab[i][0], lab[i][1], lab[i][2], cap(x), { size: 20, weight: 600, color: P.ink, maxLines: 3 }).svg; });
  // the person asking, with a speech bubble
  b += person(140, 700, 170, P.purple) + callout(40, 290, 300, 150, 150, 510, '#fff', { r: 20, filter: 'sh' }) + icon('message', 62, 308, 28, P.purple, 2.2);
  b += textBlock(100, 306, 220, cap(ask[1] || s.screenDetail), { size: 20, color: P.ink, maxLines: 5 }).svg;
  // the answer on a screen, with the code that proves it
  b += dashboardScreen(900, 340, 290, 190, [P.cyan, P.green, P.amber, P.blue]) + iconDisc('code', 1165, 350, 24, P.ink);
  b += textBlock(900, 600, 300, cap(ask[2] || ''), { size: 22, weight: 700, color: P.ink, maxLines: 2 }).svg;
  b += textBlock(cx, 610, 280, s.screen, { size: 22, weight: 800, color: P.cyan, anchor: 'middle', maxLines: 2 }).svg.replace(/x="[\d.]+"/g, `x="${cx}"`);
  b += `<g transform="translate(820 690)">${whoBlock(0, 0, s, [P.cyan, P.blue, P.purple], { ph: 74, w: 300, size: 22 }).svg}</g>`;
  b += label(56, 770, s.valueWhat, { size: 20, weight: 600, color: P.grey });
  return frame('hub', 'landscape', w, h, '', b, { uc: s.id, bg: '#F8FBFC' });
}

// 9. Map with pins: the chosen sites on a drawn map, catchment glows, and the one site that eats into a current store.
export function mapPins(row) {
  const s = storyOf(row); const { w, h } = PORT; let b = '';
  const t = titleBlock(s, 64, 56, 1100, { pill: P.green, size: 52 }); b += t.svg;
  const st = splitStake(s.stake); let y = t.bottom + 30;
  b += hero(64, y + 120, st.num, 140, 'url(#gGreen)') + label(64 + heroWidth(st.num, 140) + 16, y + 120, st.rest, { size: 32, weight: 700, color: P.body });
  const n = Number((/^(\d+)\s/.exec(s.problem) || [])[1] || 0);
  if (n) b += unitRow(700, y + 20, n, 'pin', 64, 18, P.green).svg;
  b += textBlock(700, y + 100, 480, s.problem, { size: 26, weight: 600, color: P.ink, maxLines: 2 }).svg;
  b += textBlock(64, y + 150, 1100, s.valueWhat, { size: 24, color: P.body, maxLines: 1 }).svg;
  y += 200;
  const mx = 64; const my = y; const mw = 1112; const mh = 760;
  const sites = [[0.16, 0.32], [0.38, 0.7], [0.55, 0.42], [0.86, 0.36], [0.84, 0.76]].slice(0, n || 5);
  const stores = [[0.28, 0.5], [0.64, 0.5], [0.7, 0.86], [0.12, 0.8]];
  const m = mapField(mx, my, mw, mh, sites.map(([fx, fy], i) => [fx, fy, i === 2 ? P.lava : P.green, 1.4]), { id: 'mapclip9' });
  let glow = `<defs>${radial('glowG', 'rgba(22,165,113,0.35)', 'rgba(22,165,113,0)')}${radial('glowL', 'rgba(255,54,33,0.32)', 'rgba(255,54,33,0)')}${radial('glowB', 'rgba(46,111,230,0.30)', 'rgba(46,111,230,0)')}</defs>`;
  sites.forEach(([fx, fy], i) => { glow += `<circle cx="${f1(mx + mw * fx)}" cy="${f1(my + mh * fy - 30)}" r="120" fill="url(#${i === 2 ? 'glowL' : 'glowG'})"/>`; });
  stores.forEach(([fx, fy]) => { glow += `<circle cx="${f1(mx + mw * fx)}" cy="${f1(my + mh * fy)}" r="110" fill="url(#glowB)"/>`; });
  b += m.svg.replace('</g><ellipse', `</g>${glow}<ellipse`);
  stores.forEach(([fx, fy]) => { const x = mx + mw * fx; const yy = my + mh * fy; b += `<rect x="${f1(x - 22)}" y="${f1(yy - 22)}" width="44" height="44" rx="10" fill="${P.blue}" stroke="#fff" stroke-width="4"/>` + icon('building', x - 14, yy - 14, 28, '#fff', 2); });
  // the cannibalization callout
  const can = fact(s, '%', 0); const p3 = m.pins[2];
  if (can && p3) { const sx = mx + mw * stores[1][0]; const sy = my + mh * stores[1][1];
    b += `<path d="M${f1(p3.x)},${f1(p3.y - 20)} Q${f1((p3.x + sx) / 2)},${f1(p3.y - 90)} ${f1(sx - 26)},${f1(sy - 10)}" stroke="${P.lava}" stroke-width="5" fill="none" stroke-dasharray="10 8"/>`;
    b += callout(560, my + 40, 440, 100, p3.x, p3.top - 6, '#fff', { r: 20, filter: 'sh' });
    b += label(584, my + 106, `−${can.raw}`, { size: 44, weight: 800, color: P.lava }) + textBlock(584 + 130, my + 58, 290, cap(can.clause.replace(/\s*takes\s+\S+\s+(?:from\s+)?/, ' takes from ').replace(/\s+looks strong alone but/, ' looks strong alone, but')), { size: 20, weight: 600, color: P.ink, maxLines: 4 }).svg; }
  // legend
  const ly = my + mh - 70; b += `<rect x="${mx + 24}" y="${ly}" width="430" height="50" rx="14" fill="#fff" opacity="0.92"/>` + icon('pin', mx + 40, ly + 11, 28, P.green, 2.2) + label(mx + 74, ly + 33, 'new site', { size: 20, color: P.body });
  b += `<rect x="${mx + 200}" y="${ly + 13}" width="24" height="24" rx="6" fill="${P.blue}"/>` + label(mx + 234, ly + 33, 'current store', { size: 20, color: P.body });
  y = my + mh + 50;
  b += chevronSteps(64, y, 1112, 90, s.steps.slice(0, 3), [P.cyan, P.green, P.blue], { size: 22, maxLines: 3 }).svg;
  b += `<g transform="translate(64 ${h - 170})">${whoBlock(0, 0, s, [P.green, P.blue, P.amber]).svg}</g>`;
  b += tagline(700, h - 90, 'calendar', `${s.screen}, ${s.cadence.toLowerCase()}`, P.green);
  return frame('map', 'portrait', w, h, '', b, { uc: s.id });
}

// 10. Network constellation: every ring drawn as a cluster of linked accounts, the new ones glowing.
export function networkRings(row) {
  const s = storyOf(row); const { w, h } = LAND; let b = '';
  b += `<rect width="${w}" height="${h}" fill="#101D2C"/>`;
  const t = titleBlock(s, 56, 36, 700, { pill: P.pink, size: 44, ink: '#fff' }); b += t.svg;
  b += textBlock(56, t.bottom + 10, 700, s.statement, { size: 22, color: '#C9D3DF', maxLines: 2 }).svg;
  const rings = fact(s, '', 0); const accts = fact(s, '', 1); const money = fact(s, '$', 0);
  const nR = rings ? rings.value : 8; const nA = accts ? accts.value : nR * 6;
  const hot = Number((/^(\d+)\s+rings?\s+are\s+new/i.exec(s.insight) || [])[1] || 0);
  const spots = [[140, 330], [330, 290], [520, 340], [720, 300], [910, 330], [1100, 300], [230, 470], [430, 480], [640, 470], [850, 480], [1060, 470]];
  const sizes = Array.from({ length: nR }, (_, i) => Math.floor(nA / nR) + (i < nA % nR ? 1 : 0));
  const hotIdx = new Set([1, 9].slice(0, hot));
  const cl = spots.slice(0, nR).map(([cx, cy], i) => ({ cx, cy: cy + 20, r: 34 + sizes[i] * 2, n: sizes[i], color: hotIdx.has(i) ? P.lava : [P.purple, P.cyan, P.pink][i % 3], hot: hotIdx.has(i) }));
  b += `<rect x="40" y="236" width="1160" height="330" rx="28" fill="#16273A"/>` + constellation(cl, { bridges: [[0, 6], [2, 7], [4, 9]] }).replace('data-scene="network"', 'data-scene="network" data-chart="network"');
  [...hotIdx].forEach((i) => { const c = cl[i]; b += iconDisc('alert', c.cx - 98, c.cy - c.r - 48, 20, P.lava) + pill(c.cx - 70, c.cy - c.r - 66, 'NEW THIS WEEK', P.lava, '#fff', 20).svg; });
  if (money) b += hero(1190, 112, money.raw, 92, 'url(#gHot)', 'end') + label(1190, 150, 'of refunds', { size: 22, weight: 700, color: '#C9D3DF', anchor: 'end' });
  b += iconDisc('coin', 1190 - heroWidth(money?.raw || '', 92) - 30, 82, 30, P.amber) + icon('users', 922, 168, 28, '#C9D3DF', 2);
  b += label(1190, 190, `${rings?.raw || ''} rings · ${accts?.raw || ''} accounts`, { size: 22, weight: 800, color: '#fff', anchor: 'end' });
  // how it works: three nodes with arrows
  const steps = s.steps.slice(0, 3); let pr = '';
  steps.forEach((st, i) => { const x = 80 + i * 300; pr += iconDisc(st.icon, x, 640, 32, [P.cyan, P.purple, P.pink][i]); if (i) pr += arrow(x - 300 + 40, 640, x - 44, 640, '#5D6B7C', 3, 14); });
  b += proc('nodes', pr);
  steps.forEach((st, i) => { b += textBlock(60 + i * 300, 684, 250, st.label, { size: 20, color: '#DDE3EA', maxLines: 4 }).svg; });
  b += `<g transform="translate(940 620)">${whoBlock(0, 0, s, [P.pink, P.cyan, P.purple], { ph: 66, w: 190, size: 22, ink: '#fff', muted: '#C9D3DF' }).svg}</g>`;
  return frame('network', 'landscape', w, h, '', b, { uc: s.id });
}

const DRV_ICON = [[/volume|unit/i, 'trendDown'], [/price/i, 'tag'], [/mix/i, 'layers'], [/cost/i, 'coin']];

// 11. Waterfall bridge: the month's margin change split into what each driver took or added.
export function waterfall(row) {
  const s = storyOf(row); const { w, h } = PORT; let b = '';
  const t = titleBlock(s, 64, 56, 1100, { pill: P.amber, size: 52 }); b += t.svg;
  const money = s.facts.filter((f) => f.unit === '$'); const total = money[0];
  const neg = /fell|lost|down|dropped/i.test(total?.clause || '');
  b += hero(64, t.bottom + 140, total ? `${neg ? '−' : '+'}${total.raw}` : '', 130, neg ? P.lava : P.green) + label(80 + heroWidth(total?.raw || '', 130) + 50, t.bottom + 140, total ? total.clause.replace(total.raw, '').replace(/^Margin\s+\w+\s*/, 'margin ').trim() : '', { size: 32, weight: 700, color: P.body });
  b += textBlock(64, t.bottom + 170, 1100, s.insight, { size: 26, color: P.body, maxLines: 2 }).svg;
  // drivers: "<Name> took $x", "<name> $y", "<name> added $z"; the rest is what the drivers leave of the total
  const drv = money.slice(1).map((f) => { const pre = f.clause.slice(0, f.clause.indexOf(f.raw)).replace(/\$$/, ''); const nm = (/(\w+)\s+(?:(?:took|added|lost|gave)\s+)?$/i.exec(pre) || [])[1] || ''; const up = /(?:added|gave|rose)\s*\$?$/i.test(pre); return { name: cap(nm), v: up ? f.value : -f.value, raw: f.raw }; });
  const totalV = total ? (neg ? -total.value : total.value) : 0; const rest = totalV - drv.reduce((a, d) => a + d.v, 0);
  if (Math.abs(rest) > 1) drv.push({ name: 'The rest', v: rest, raw: `$${(Math.abs(rest) / 1e6).toFixed(2)}M` });
  const cols = [...drv, { name: 'Total', v: totalV, raw: total?.raw || '', total: true }];
  const top = t.bottom + 330; const zero = top + 80; const scale = 560 / Math.max(...cols.map((c) => Math.abs(c.v)), 1); const bw = 150; const gap = (1112 - cols.length * bw) / (cols.length - 1);
  let ch = `<path d="M64,${zero} L1176,${zero}" stroke="${P.grey}" stroke-width="2"/>`; let run = 0;
  cols.forEach((c, i) => { const x = 64 + i * (bw + gap); const y0 = c.total ? zero : zero - run * scale; const y1 = c.total ? zero - c.v * scale : zero - (run + c.v) * scale; const col = c.total ? P.ink : c.v < 0 ? P.lava : P.green;
    const yt = Math.min(y0, y1); const hh = Math.max(6, Math.abs(y1 - y0));
    ch += `<rect x="${f1(x)}" y="${f1(yt)}" width="${bw}" height="${f1(hh)}" rx="12" fill="${col}"/>`;
    if (i < cols.length - 1 && !c.total) { const ny = zero - (run + c.v) * scale; ch += `<path d="M${f1(x + bw)},${f1(ny)} L${f1(x + bw + gap)},${f1(ny)}" stroke="${P.grey}" stroke-width="2" stroke-dasharray="6 6"/>`; }
    ch += iconDisc(c.total ? 'coin' : (DRV_ICON.find(([re]) => re.test(c.name)) || [0, 'sliders'])[1], x + bw / 2, top - 10, 34, col);
    ch += label(x + bw / 2, top + 54, c.name, { size: 22, weight: 800, color: P.ink, anchor: 'middle' });
    ch += label(x + bw / 2, yt + hh + 40, `${c.v < 0 ? '−' : '+'}${c.raw}`, { size: 28, weight: 800, color: col, anchor: 'middle' });
    if (!c.total) run += c.v; });
  b += `<g data-chart="waterfall">${ch}</g>`;
  let y = zero + 560 + 110;
  b += tagline(64, y, 'route', 'HOW IT WORKS', P.amber); y += 26;
  b += chevronSteps(64, y, 1112, 90, s.steps.slice(0, 3), [P.amber, P.blue], { size: 22, maxLines: 3 }).svg;
  b += `<g transform="translate(64 ${h - 170})">${whoBlock(0, 0, s, [P.amber, P.blue, P.green]).svg}</g>`;
  b += textBlock(700, h - 150, 470, s.valueWhat, { size: 24, weight: 600, color: P.body, maxLines: 3 }).svg;
  return frame('waterfall', 'portrait', w, h, '', b, { uc: s.id });
}

// 12. Balance and decision: a scale weighs the stores with the action against matched stores without it, then each one goes keep, change or stop.
export function balanceDecision(row) {
  const s = storyOf(row); const { w, h } = PORT; let b = '';
  b += blob(1060, 220, 260, 200, tint(P.purple), 3) + iconDisc('tag', 1090, 230, 64, P.purple);
  const t = titleBlock(s, 64, 56, 1100, { pill: P.purple, size: 52 }); b += t.svg;
  const st = splitStake(s.stake); let y = t.bottom + 30;
  b += hero(64, y + 110, st.num, 130, 'url(#gViolet)') + textBlock(64 + heroWidth(st.num, 130) + 24, y + 50, 1100 - heroWidth(st.num, 130) - 40, st.rest, { size: 30, weight: 700, color: P.body, maxLines: 2 }).svg;
  y += 170;
  // the scale
  const m = /compares\s+(.+?)\s+against\s+(.+?),\s+with\s+(.+)$/i.exec(s.steps[0]?.label || '') || [];
  const A = cap(m[1] || 'with the change'); const B = cap(m[2] || 'without it'); const C = cap(m[3] || '');
  const cx = 620; const by = y + 120; const L = [330, by + 40]; const R = [910, by - 40];
  let sc = `<path d="M${cx},${by - 30} L${cx},${by + 330}" stroke="${P.ink}" stroke-width="10" stroke-linecap="round"/><path d="M${cx - 90},${by + 340} L${cx + 90},${by + 340}" stroke="${P.ink}" stroke-width="12" stroke-linecap="round"/>`;
  sc += `<path d="M${L[0]},${L[1]} L${R[0]},${R[1]}" stroke="${P.ink}" stroke-width="10" stroke-linecap="round"/><circle cx="${cx}" cy="${by}" r="18" fill="${P.amber}"/>`;
  [[L, P.purple, 3], [R, P.grey, 3]].forEach(([[px, py], col, k]) => { sc += `<path d="M${px},${py} L${px - 110},${py + 120} M${px},${py} L${px + 110},${py + 120}" stroke="${P.grey}" stroke-width="3"/><path d="M${px - 140},${py + 120} L${px + 140},${py + 120} Q${px},${py + 190} ${px - 140},${py + 120}Z" fill="${col}"/>`;
    for (let i = 0; i < k; i++) sc += `<rect x="${px - 96 + i * 66}" y="${py + 64}" width="56" height="56" rx="12" fill="#fff" stroke="${col}" stroke-width="3"/>` + icon('building', px - 86 + i * 66, py + 74, 36, col, 2); });
  b += `<g data-scene="scale">${sc}</g>`;
  b += textBlock(L[0], L[1] + 210, 360, A, { size: 22, weight: 700, color: P.purple, anchor: 'middle', maxLines: 2 }).svg.replace(/x="[\d.]+"/g, `x="${L[0]}"`);
  b += textBlock(R[0], R[1] + 210, 360, B, { size: 22, weight: 700, color: P.grey, anchor: 'middle', maxLines: 2 }).svg.replace(/x="[\d.]+"/g, `x="${R[0]}"`);
  if (C) b += icon('calendar', cx + 40, by + 270, 30, P.amber, 2.2) + textBlock(cx + 80, by + 270, 300, C, { size: 20, color: P.body, maxLines: 2 }).svg;
  b += icon('trendUp', L[0] - 20, L[1] - 70, 40, P.purple, 2.4) + label(L[0] + 30, L[1] - 38, 'the lift', { size: 22, weight: 800, color: P.purple });
  y = by + 470;
  // the decision
  const calls = (/\ba\s+(\w+),\s+(\w+)\s+or\s+(\w+)\s+call/i.exec(s.screenDetail) || []).slice(1); const names = calls.length === 3 ? calls.map(cap) : ['Keep', 'Change', 'Stop'];
  const ds = decisionSplit(64, y, 560, 480, { icon: 'tag' }, [{ icon: 'check' }, { icon: 'sliders' }, { icon: 'alert' }], [P.green, P.amber, P.lava]); b += ds.svg;
  const plus = s.facts.find((f) => f.unit === '$' && afterColon(f.clause).includes(f.raw) && /added|gained|rose/i.test(afterColon(f.clause))); const minus = s.facts.find((f) => f.unit === '$' && /lost|fell|cost/i.test(f.clause));
  const ex = [plus ? [`+${plus.raw}`, afterColon(plus.clause).replace(plus.raw, '').replace(/\s+/g, ' ')] : null, null, minus ? [`−${minus.raw}`, minus.clause.replace(minus.raw, '').replace(/\s+/g, ' ')] : null];
  ds.nodes.slice(1).forEach((nd, i) => { const col = [P.green, P.amber, P.lava][i]; b += label(nd.x + 76, nd.y - 6, names[i], { size: 34, weight: 800, color: col });
    if (ex[i]) b += label(nd.x + 76 + 150, nd.y - 6, ex[i][0], { size: 30, weight: 800, color: col }) + textBlock(nd.x + 76, nd.y + 8, 460, cap(ex[i][1].trim()), { size: 20, color: P.body, maxLines: 2 }).svg; });
  b += textBlock(64, ds.nodes[0].y + 80, 200, s.screen, { size: 20, weight: 700, color: P.ink, maxLines: 3 }).svg;
  b += `<g transform="translate(64 ${h - 170})">${whoBlock(0, 0, s, [P.purple, P.green, P.amber]).svg}</g>`;
  b += textBlock(700, h - 150, 470, s.valueWhat, { size: 22, weight: 600, color: P.body, maxLines: 3 }).svg;
  return frame('balance', 'portrait', w, h, '', b, { uc: s.id });
}
