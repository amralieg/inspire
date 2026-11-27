// REQ-574 / REQ-571: the gallery of infographic concepts. Each concept draws ONE use case story (the problem, how it works
// as a process diagram with icons, the value number made big, who uses it) with a different visual idea.
// Content comes only from the use case (storyOf); the drawing is built from the library blocks.
import { P, tint, f1, ribbon, badge, callout, blob, ring, curve, arrow, isoTile, hex, radial, grad } from './shapes.js';
import { icon, iconDisc } from './icons.js';
import { textBlock, label } from './text.js';
import { chevronSteps, cycle, funnel, hubSpokes, decisionSplit, isoStack, shade } from './process.js';
import { unitGrid, unitRow } from './pictogram.js';
import { dashboardScreen, dataStack, person, team, documentSheet, calendarSheet, mapField, constellation } from './scenes.js';
import { LAND, PORT, frame, titleBlock, hero, heroWidth, splitStake, whoBlock, tagline, leader, spline } from './common.js';
import { storyOf } from './story.js';
import { beforeAfter, forecastBand, funnelStory, hubAgent, mapPins, networkRings, waterfall, balanceDecision } from './concepts2.js';

const fact = (s, unit, i = 0) => s.facts.filter((f) => !unit || f.unit === unit)[i];
const detailParts = (s) => String(s.screenDetail || '').split(/,\s+(?:then\s+)?/).map((t) => t.trim()).filter((t) => t.split(' ').length >= 4);
const capf = (t) => t.charAt(0).toUpperCase() + t.slice(1);

// 1. Journey road: a winding road with milestones, the slow step as a callout, the value at the finish flag.
function journeyRoad(row) {
  const s = storyOf(row); const { w, h } = LAND; let b = '';
  b += blob(1080, 120, 260, 170, tint(P.amber), 2) + blob(140, 760, 260, 140, tint(P.cyan), 4);
  const t = titleBlock(s, 56, 40, 720, { pill: P.lava }); b += t.svg;
  b += textBlock(56, t.bottom + 14, 760, s.problem, { size: 24, color: P.body, maxLines: 2 }).svg;
  const pts = [[-20, 735], [190, 705], [370, 560], [600, 610], [820, 520], [990, 420], [1120, 330], [1150, 330]];
  const d = spline(pts.slice(0, 7));
  b += '<g data-process="road">' + ribbon(d, 64, '#3D4A5C', { edge: '#E6E0D6', dash: '18 16' });
  const stops = [pts[1], pts[2], pts[4], pts[5]]; const cols = [P.cyan, P.purple, P.lava, P.amber];
  const steps = s.steps.slice(0, 4);
  const lab = [[40, 520, 230], [250, 440, 300], [830, 585, 250], [1005, 480, 220]];
  steps.forEach((st, i) => { const [x, y] = stops[i];
    b += `<circle cx="${x}" cy="${y}" r="46" fill="#fff" filter="url(#sh)"/>` + iconDisc(st.icon, x, y, 38, cols[i]) + badge(x + 34, y - 34, 18, String(i + 1), P.ink);
    const [lx, ly, lw] = lab[i]; b += textBlock(lx, ly, lw, st.label, { size: 22, weight: i === 3 ? 700 : 500, color: P.ink, maxLines: 3 }).svg; });
  b += '</g>';
  const slow = fact(s, '', 0);
  if (slow) { b += callout(430, 650, 380, 120, 600, 612, P.ink, { r: 22, filter: 'sh' });
    b += icon('hourglass', 452, 672, 40, P.amber, 2.2) + label(504, 708, `${slow.raw} hours`, { size: 36, weight: 800, color: '#fff' });
    b += textBlock(452, 722, 340, slow.clause.replace(slow.raw, '').replace(/\s+/g, ' ').replace(/^Orders wait hours/, 'Wait').trim(), { size: 20, color: '#DDE3EA', maxLines: 1 }).svg; }
  // finish: flag and the value
  b += `<path d="M1160,330 L1160,236" stroke="${P.ink}" stroke-width="6" stroke-linecap="round"/><path d="M1160,238 L1220,256 L1160,276Z" fill="${P.lava}"/>`;
  const st = splitStake(s.stake);
  b += hero(1200, 130, st.num, 92, 'url(#gHot)', 'end') + label(1200, 165, `${st.rest} · ${s.valueWhat}`.trim(), { size: 22, weight: 600, color: P.body, anchor: 'end' });
  const late = fact(s, '', 1);
  if (late) { b += iconDisc('alert', 900, 690, 34, P.lava) + label(948, 684, late.raw, { size: 40, weight: 800, color: P.lava }) + textBlock(948, 696, 250, late.clause.replace(late.raw, '').trim(), { size: 20, color: P.body, maxLines: 2 }).svg; }
  b += `<g transform="translate(820 200)">${whoBlock(0, 0, s, [P.cyan, P.lava, P.purple], { ph: 84, w: 190 }).svg}</g>`;
  return frame('journey', 'landscape', w, h, '', b, { uc: s.id });
}

// 2. Cycle wheel: the weekly loop around a hub that holds the headline number.
function cycleWheel(row) {
  const s = storyOf(row); const { w, h } = PORT; let b = '';
  b += blob(1040, 300, 300, 260, tint(P.purple), 3) + blob(200, 1180, 320, 280, tint(P.cyan), 6);
  const t = titleBlock(s, 64, 56, 1100, { pill: P.purple, size: 52 }); b += t.svg;
  b += textBlock(64, t.bottom + 18, 1100, s.screenDetail, { size: 28, color: P.body, maxLines: 3 }).svg;
  const loop = [...s.steps.slice(0, 2).map((x) => x.label), ...detailParts(s).map(capf)].slice(0, 4);
  const icons = ['brain', 'monitor', 'target', 'send'];
  const cx = 620; const cy = 780; const r = 300;
  const c = cycle(cx, cy, r, loop.map((l, i) => ({ icon: icons[i] })), [P.purple, P.pink, P.amber, P.cyan], { nodeR: 54, w: 16 }); b += c.svg;
  b += `<circle cx="${cx}" cy="${cy}" r="180" fill="#fff" filter="url(#sh)"/>` + ring(cx, cy, 160, 18, 0.64, P.purple, tint(P.purple));
  const big = fact(s, 'x', 0) || fact(s, '%', 0) || s.facts[0];
  if (big) { b += hero(cx, cy + 20, big.raw, 110, 'url(#gViolet)', 'middle'); b += textBlock(cx - 120, cy + 44, 240, big.clause.replace(big.raw, '').replace(/\s+by$/, '').trim(), { size: 20, color: P.body, anchor: 'middle', maxLines: 3 }).svg.replace(/x="[\d.]+"/g, `x="${cx}"`); }
  // node labels outside the wheel
  const spots = [[cx - 260, cy - r - 190, 520, 'middle'], [cx + r + 74, cy - 70, 230, 'start'], [cx - 260, cy + r + 76, 520, 'middle'], [40, cy - 70, 230, 'start']];
  loop.forEach((l, i) => { const [x, y, lw, a] = spots[i]; const tb = textBlock(a === 'middle' ? x + lw / 2 : x, y, lw, l, { size: 22, weight: 600, color: P.ink, maxLines: 4, anchor: a });
    b += tb.svg; b += badge(a === 'middle' ? x + lw / 2 : x + 16, y - 26, 18, String(i + 1), c.nodes[i].color); });
  // value + pictogram + who
  const y0 = 1260; const st = splitStake(s.stake);
  b += `<rect x="40" y="${y0}" width="1160" height="2" fill="${P.panel2}"/>`;
  b += iconDisc('coin', 100, y0 + 110, 46, P.amber) + hero(168, y0 + 136, st.num, 96, 'url(#gHot)') + label(168 + heroWidth(st.num, 96) + 16, y0 + 136, st.rest, { size: 28, weight: 700, color: P.body });
  b += textBlock(168, y0 + 158, 460, s.valueWhat, { size: 22, color: P.body, maxLines: 2 }).svg;
  const sh = fact(s, '%', 0);
  if (sh) { const g = unitGrid(700, y0 + 50, 20, 100, Math.round(sh.value), 'square', 20, 5, P.pink, P.panel2); b += g.svg + textBlock(700, y0 + 190, 480, sh.clause, { size: 20, color: P.body, maxLines: 2 }).svg; }
  b += `<g transform="translate(64 ${y0 + 260})">${whoBlock(0, 0, s, [P.purple, P.pink, P.cyan]).svg}</g>`;
  b += tagline(700, y0 + 310, 'refresh', `A loop that runs ${s.cadence.toLowerCase()}`, P.purple);
  return frame('cycle', 'portrait', w, h, '', b, { uc: s.id });
}

// 3. Isometric scene: data to model to scenarios to the screen a person decides on.
function isoScene(row) {
  const s = storyOf(row); const { w, h } = LAND; let b = '';
  const t = titleBlock(s, 56, 40, 640, { pill: P.blue, size: 42 }); b += t.svg;
  b += textBlock(56, t.bottom + 12, 640, s.problem, { size: 22, color: P.body, maxLines: 3 }).svg;
  b += isoTile(640, 600, 600, '#EEF2F8') + isoTile(640, 600, 520, '#E4EAF4');
  b += '<g data-process="iso-flow">' + dataStack(230, 560, 90, [P.cyan, P.blue, P.purple]);
  b += curve([330, 560], [380, 520], [420, 520], [470, 520], P.grey, 5, { head: 18 });
  b += hex(540, 520, 62, P.blue) + icon('brain', 512, 492, 56, '#fff', 2.2);
  b += curve([610, 520], [650, 520], [680, 540], [720, 560], P.grey, 5, { head: 18 });
  let dots = ''; for (let i = 0; i < 64; i++) { const a = i * 2.4; const rr = 18 + (i % 9) * 8; dots += `<circle cx="${f1(800 + Math.cos(a) * rr * 1.3)}" cy="${f1(570 + Math.sin(a) * rr * 0.6)}" r="${4 + (i % 3)}" fill="${[P.amber, P.pink, P.purple][i % 3]}" opacity="0.8"/>`; }
  b += `<g data-scene="scenarios">${dots}</g>`;
  b += curve([900, 560], [930, 540], [950, 520], [975, 505], P.grey, 5, { head: 18 });
  b += dashboardScreen(980, 380, 230, 160, [P.blue, P.green, P.amber, P.pink]) + '</g>' + person(1150, 745, 130, P.lava);
  const st = s.steps;
  b += leader(230, 640, 150, 700) + textBlock(40, 712, 260, st[0]?.label || '', { size: 20, color: P.ink, maxLines: 3 }).svg;
  b += leader(540, 588, 470, 668) + label(330, 700, 'Driver model', { size: 22, weight: 800, color: P.blue });
  b += leader(800, 620, 760, 688) + textBlock(330, 710, 470, st[1]?.label || '', { size: 20, color: P.ink, maxLines: 2 }).svg;
  // the hero numbers in the open sky
  const ch = fact(s, '%', 0); const st0 = splitStake(s.stake);
  if (ch) { b += ring(860, 160, 74, 18, ch.value / 100, P.green, tint(P.green)) + label(860, 175, ch.raw, { size: 44, weight: 800, color: P.green, anchor: 'middle' });
    b += textBlock(950, 110, 260, ch.clause.replace(/^.*?with an?\s/, '').replace(ch.raw, '').replace(/\s+/g, ' ').trim(), { size: 22, weight: 600, color: P.ink, maxLines: 3 }).svg; }
  b += icon('coin', 760, 268, 34, P.amber, 2.2) + label(804, 296, `${st0.lead} ${st0.num} ${st0.rest}`.trim(), { size: 26, weight: 800, color: P.ink }) + label(804, 326, s.valueWhat, { size: 20, color: P.body });
  b += iconDisc('database', 230, 420, 26, P.cyan) + iconDisc('sliders', 800, 470, 26, P.pink) + iconDisc('target', 742, 160, 22, P.green) + icon('users', 1050, 600, 34, P.lava, 2) + icon('calendar', 1095, 708, 24, P.grey, 2);
  b += label(1085, 668, 'WHO USES IT', { size: 20, weight: 700, color: P.grey, anchor: 'end', spacing: 1.5 }) + label(1085, 700, s.who, { size: 22, weight: 800, color: P.lava, anchor: 'end' }) + label(1085, 730, s.cadence, { size: 20, weight: 600, color: P.body, anchor: 'end' });
  return frame('isometric', 'landscape', w, h, '', b, { uc: s.id, bg: '#F7F9FC' });
}

// 4. Pictogram: 100 units of the value at risk, the share one action reaches filled in.
function pictogram(row) {
  const s = storyOf(row); const { w, h } = PORT; let b = '';
  b += blob(1100, 160, 240, 200, tint(P.green), 5);
  const t = titleBlock(s, 64, 56, 1000, { pill: P.green, size: 52 }); b += t.svg;
  const st = splitStake(s.stake); const share = fact(s, '%', 0); const count = fact(s, '', 0);
  let y = t.bottom + 50;
  b += hero(64, y + 120, st.num, 150, 'url(#gGreen)') + label(64 + heroWidth(st.num, 150) + 20, y + 120, st.rest, { size: 34, weight: 700, color: P.body });
  b += textBlock(64, y + 150, 1080, s.problem, { size: 28, color: P.body, maxLines: 2 }).svg;
  y += 270;
  const g = unitGrid(64, y, 10, 100, share ? Math.round(share.value) : 0, 'doc', 52, 14, P.green, '#DDE3E8', { rowGap: 1 }); b += g.svg;
  const rx = 64 + g.w + 60;
  if (share) { b += hero(rx, y + 120, share.raw, 120, P.green) + textBlock(rx, y + 150, 1176 - rx, share.clause.replace(share.raw, 'that share'), { size: 26, weight: 600, color: P.ink, maxLines: 3 }).svg; }
  b += `<rect x="${rx}" y="${y + 300}" width="26" height="26" rx="6" fill="${P.green}"/>` + label(rx + 40, y + 321, `reached by today's calls`, { size: 20, color: P.body });
  b += `<rect x="${rx}" y="${y + 344}" width="26" height="26" rx="6" fill="#DDE3E8"/>` + label(rx + 40, y + 365, 'one sheet = 1% of the value', { size: 20, color: P.body });
  if (count) b += iconDisc('receipt', rx + 30, y + 460, 30, P.ink) + label(rx + 74, y + 472, `${count.raw} open`, { size: 34, weight: 800, color: P.ink });
  y += g.h + 80;
  b += tagline(64, y, 'route', 'HOW IT WORKS', P.green); y += 30;
  const steps = s.steps.slice(-3);
  b += chevronSteps(64, y, 1112, 96, steps, [P.cyan, P.blue, P.green], { size: 22, maxLines: 5 }).svg;
  y += 96 + 170;
  b += `<g transform="translate(64 ${y})">${whoBlock(0, 0, s, [P.green, P.amber, P.blue]).svg}</g>`;
  b += calendarSheet(720, y - 10, 220, 160, P.green, [0, 1, 2, 3, 4, 7, 8, 9, 10, 11]) + iconDisc('phone', 1040, y + 70, 56, P.amber);
  return frame('pictogram', 'portrait', w, h, '', b, { uc: s.id });
}

export const CONCEPTS = [
  { n: 1, pattern: 'journey', orientation: 'landscape', uc: 'N09-U01', idea: 'a winding road with numbered milestones, the slowest wait as a callout, the value at the finish flag', build: journeyRoad },
  { n: 2, pattern: 'cycle', orientation: 'portrait', uc: 'N06-U04', idea: 'a weekly loop wheel with the headline multiple in the hub and a 100-square share grid', build: cycleWheel },
  { n: 3, pattern: 'isometric', orientation: 'landscape', uc: 'N04-U02', idea: 'an isometric floor: data stack to model hex to a cloud of scenarios to the screen a person decides on', build: isoScene },
  { n: 4, pattern: 'pictogram', orientation: 'portrait', uc: 'N01-U04', idea: '100 document units of the value at risk, the share today\'s calls reach filled in, chevron steps below', build: pictogram },
  { n: 5, pattern: 'beforeafter', orientation: 'landscape', uc: 'N02-U02', idea: 'a diagonal split: a fanned stack of flagged invoices and the money at risk, against a shield that matches each line to its two records', build: beforeAfter },
  { n: 6, pattern: 'timeline', orientation: 'landscape', uc: 'N03-U01', idea: 'a history line running into a rising forecast band, the weeks the band crosses the dashed capacity line shaded', build: forecastBand },
  { n: 7, pattern: 'funnel', orientation: 'portrait', uc: 'N01-U01', idea: 'a funnel from everyone at risk to the few called this week to the share of value reached, the value dropping out of it', build: funnelStory },
  { n: 8, pattern: 'hub', orientation: 'landscape', uc: 'N11-U01', idea: 'a person asks in a speech bubble, the agent hub draws on its sources, the answer comes back on a screen with its code', build: hubAgent },
  { n: 9, pattern: 'map', orientation: 'portrait', uc: 'N10-U01', idea: 'a drawn map with the chosen site pins, catchment glows over current stores and the one site that eats into a store', build: mapPins },
  { n: 10, pattern: 'network', orientation: 'landscape', uc: 'N10-U03', idea: 'a dark night-sky constellation: each ring a cluster of linked accounts, the new ones glowing red', build: networkRings },
  { n: 11, pattern: 'waterfall', orientation: 'portrait', uc: 'N12-U01', idea: 'a waterfall bridge of what each driver took or added to the month\'s margin change, an icon over every bar', build: waterfall },
  { n: 12, pattern: 'balance', orientation: 'portrait', uc: 'N08-U01', idea: 'a balance scale weighing stores with the promotion against matched stores without it, then a keep, change or stop split', build: balanceDecision },
];

export function galleryFor(rows) {
  const byId = new Map(rows.map((r) => [String(r.No), r]));
  return CONCEPTS.filter((c) => byId.has(c.uc)).map((c) => ({ ...c, file: `${String(c.n).padStart(2, '0')}_${c.pattern}_${c.orientation}`, svg: c.build(byId.get(c.uc)) }));
}
