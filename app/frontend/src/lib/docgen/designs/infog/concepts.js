// C29 (REQ-571, REQ-574): the 12 approved infographic concepts, each drawn for one use case in landscape (1240 x 698, 16:9) and in
// portrait (1240 x 1754, A4). The two orientations re-flow the drawing (other positions, sizes and arrangement), never scale one picture.
// Every page has the same story frame: the display id and technique, the title, the problem, the value made big, the concept's picture
// (a process diagram with icons), who uses it and how often. Content comes from content.js (the AI pick, else the use case itself).
import { P, tint, f1, ribbon, badge, callout, blob, ring, curve, hex, pill, chevron } from './shapes.js';
import { icon, iconDisc, distinctIcons } from './icons.js';
import { textBlock, label, esc, wrap, tidy, measure, keepShown, shows, slot, hasText } from './text.js';
import { chevronSteps, cycle, funnel, hubSpokes, decisionSplit } from './process.js';
import { unitGrid } from './pictogram.js';
import { dashboardScreen, dataStack, person, mapField, constellation } from './scenes.js';
import { frame, hero, heroWidth, whoBlock, tagline, leader, spline } from './common.js';

export const SIZE = { landscape: { w: 1240, h: 698 }, portrait: { w: 1240, h: 1754 } };
const BOX = { landscape: { x: 40, y: 228, w: 1160, h: 330 }, portrait: { x: 48, y: 600, w: 1144, h: 900 } };
const cols = () => [P.lava, P.amber, P.blue, P.green, P.purple, P.cyan];
const fitSize = (text, max, width) => { let s = max; while (s > 20 && heroWidth(text, s) > width) s -= 2; return s; };
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));

// A numbered list of steps with an icon disc each (the "how it works" in a small space). Returns { svg, h }.
function stepList(x, y, w, steps0, o = {}) {
  const r = o.r || 18; const size = o.size || 20; const gap = o.gap ?? 8; const cs = o.colors || cols(); let yy = y; let svg = '';
  // adapt: a step that does not fit one line takes two or three, and the steps that no longer fit the height are left out (never a cut phrase).
  const tw = w - 2 * r - 12; const mlOf = (st) => (o.adapt ? Math.min(3, wrap(st.label, tw, size, o.weight || 600).length) : o.maxLines || 1);
  // A step whose label does not show goes with its icon; the next one takes its row.
  const steps = keepShown(steps0, (st) => shows(tw, st.label, { size, weight: o.weight || 600, maxLines: mlOf(st) }));
  for (let i = 0; i < steps.length; i += 1) { const st = steps[i]; const ml = mlOf(st);
    const t = textBlock(x + 2 * r + 12, yy + r - size * 0.62, tw, st.label, { size, weight: o.weight || 600, color: o.ink || P.ink, maxLines: ml });
    const rowH = Math.max(2 * r, t.h + (r - size * 0.62)); if (o.adapt && i > 0 && yy + rowH - y > (o.maxH || 1e9)) break;
    svg += slot(iconDisc(st.icon, x + r, yy + r, r, cs[i % cs.length]), t.svg); yy += rowH + gap;
  }
  return { svg: svg && `<g data-process="steps">${svg}</g>`, h: svg ? yy - y - gap : 0 };
}
// Steps in one row: an icon disc, its label to the right, a small arrow to the next one.
function inlineFlow(x, y, w, steps0, o = {}) {
  const r0 = o.r || 22; const lo = { size: o.size || 20, weight: 600, maxLines: 3 };
  const steps = keepShown(steps0, (st, n) => shows(w / n - 2 * r0 - 40, st.label, lo));
  const n = steps.length; const seg = w / n; const r = o.r || 22; const cs = o.colors || cols(); let svg = '';
  steps.forEach((st, i) => { const sx = x + i * seg;
    svg += slot(iconDisc(st.icon, sx + r, y + r, r, cs[i % cs.length]), textBlock(sx + 2 * r + 10, y + r - 23, seg - 2 * r - 40, st.label, { size: o.size || 20, weight: 600, color: o.ink || P.ink, maxLines: 3 }).svg);
    if (i < n - 1) svg += chevron(sx + seg - 24, y + r - 10, 16, 20, o.arrow || P.grey, true, 0.5); });
  return n ? `<g data-process="flow">${svg}</g>` : '';
}
// Steps as discs joined by arrows, each label centred under its disc.
function miniFlow(x, y, w, steps0, o = {}) {
  const lo = { size: o.size || 20, weight: 600, maxLines: o.maxLines || 2 };
  const steps = keepShown(steps0, (st, n) => shows(w / n - 20, st.label, lo));
  const n = steps.length; const seg = w / n; const r = o.r || 30; const cs = o.colors || cols(); let svg = '';
  steps.forEach((st, i) => { const cx = x + seg * i + seg / 2;
    if (i < n - 1) svg += curve([cx + r + 8, y + r], [cx + seg / 2, y + r - 18], [cx + seg / 2, y + r - 18], [cx + seg - r - 12, y + r], P.grey, 4, { head: 14 });
    svg += slot(iconDisc(st.icon, cx, y + r, r, cs[i % cs.length]) + badge(cx + r * 0.8, y + r * 0.2, 15, String(i + 1), P.ink),
      textBlock(cx, y + 2 * r + 12, seg - 20, st.label, { size: o.size || 20, weight: 600, color: o.ink || P.ink, anchor: 'middle', maxLines: o.maxLines || 2 }).svg); });
  return n ? `<g data-process="flow">${svg}</g>` : '';
}

// The steps the picture does not already show (a footer never repeats a line of the picture).
const unused = (steps, ...shown) => { const seen = new Set(shown.flat().filter(Boolean).map(String)); return steps.filter((x) => !seen.has(x.label)); };
const footSteps = (steps, ink) => (steps.length ? (x, y, w) => stepList(x, y, w, steps.slice(0, 3), { r: 16, size: 20, adapt: true, maxH: 112, gap: 4, ...(ink ? { ink } : {}) }).svg : null);

// The page: header (id, technique, title, problem, the value), the concept's picture, the footer (who uses it, the screen or the logo).
// What is on screen: the use case's own words; a stated screen that does not show whole, or a footer left with nothing else, takes the
// plain generic line (like the generic stages of a use case that states too few, never a topic claim) so the band is never left empty.
const SCREEN = 'The answer, ready to use';
const screenOf = (c, w, size, bare) => (c.screen && shows(w, c.screen, { size, weight: 700, maxLines: 2 }) ? c.screen : c.screen || bare ? SCREEN : '');
function page(c, orient, concept, draw, o = {}) {
  const { w, h } = SIZE[orient]; const box = BOX[orient]; const land = orient === 'landscape';
  const dark = !!o.dark; const ink = dark ? '#FFFFFF' : P.ink; const muted = dark ? '#C9D3DE' : P.body; const rule = dark ? '#2B3E54' : P.panel2;
  const k = { ink, muted, dark, accent: P.lava };
  const tag = [c.no, c.technique].filter(Boolean).join(' · ');
  let b = o.backdrop || '';
  const pic = draw(c, box, land, k); page.empty = !hasText(pic.svg);
  if (land) {
    const hStart = b.length;
    if (tag) b += pill(48, 28, tag, dark ? P.lava : P.ink, '#fff', 20).svg;
    // A title too long for two lines takes up to four (the use case name is never cut) and the problem keeps the line left under it.
    const ts = [38, 32, 28, 24].find((z) => wrap(c.title, 700, z, 800).length <= 2) || 24; const long = wrap(c.title, 700, 24, 800).length > 2;
    const t = textBlock(48, 76, 700, c.title, { size: ts, weight: 800, color: ink, lh: 1.08, maxLines: long ? 4 : 2 }); b += t.svg;
    const prL = textBlock(48, 76 + t.h + 12, 700, c.problem, { size: 21, color: muted, maxLines: long ? 1 : 2 }); b += prL.svg;
    if (c.hero) {
      b += hero(1192, 110, c.hero.value, fitSize(c.hero.value, 84, 400), 'url(#gHot)', 'end');
      if (c.hero.label) b += textBlock(1192, 124, 400, c.hero.label, { size: 22, weight: 700, color: ink, anchor: 'end', maxLines: 1 }).svg;
      if (c.heroNote) b += textBlock(1192, 154, 400, c.heroNote, { size: 20, color: muted, anchor: 'end', maxLines: 2 }).svg;
    }
    // No value to show: the header sits in the middle of its band instead of leaving an empty one above the picture.
    if (!c.hero) { const dy = Math.round((218 - (76 + t.h + 12 + prL.h) - 8) / 2); if (dy > 8) b = b.slice(0, hStart) + `<g transform="translate(0 ${dy})">${b.slice(hStart)}</g>`; }
    b += pic.svg;
    b += `<rect x="40" y="564" width="1160" height="2" fill="${rule}"/>`;
    const who = whoBlock(48, 572, c, [P.blue, P.lava, P.green], { ph: 90, w: 320, size: 22, ink, muted, accent: P.lava, maxH: h - 572 }); b += who.svg;
    // The middle of the footer: the picture's own footer, else (no value in the header to carry it) what changes for the person, else nothing.
    const foot = pic.foot ? pic.foot(500, 580, 410) : '';
    let mid = hasText(foot) ? foot : '';
    if (!mid && !c.hero && c.heroNote) mid = slot(icon('target', 500, 583, 24, P.lava, 2) + label(532, 604, 'WHAT CHANGES', { size: 20, weight: 700, color: P.grey, spacing: 1.5 }), textBlock(500, 616, 410, c.heroNote, { size: 22, weight: 700, color: ink, maxLines: 3 }).svg);
    b += mid;
    if (o.logo) b += `<image href="${esc(o.logo)}" x="1012" y="4" width="180" height="40" preserveAspectRatio="xMaxYMid meet"/>`;
    // What is on screen sits at the right; with nothing in the middle it moves in beside who uses it (never an empty middle of the band).
    const scr = (x, w) => slot(icon('monitor', x, 588, 30, P.lava, 2) + label(x + 40, 611, 'ON SCREEN', { size: 20, weight: 700, color: P.grey, spacing: 1.5 }), textBlock(x, 628, w, screenOf(c, w, 21, !mid && !who.svg), { size: 21, weight: 700, color: ink, maxLines: 2 }).svg);
    if (mid || !who.svg) b += scr(932, 262);
    else { const x0 = Math.max(500, who.right + 60); const tb = textBlock(x0, 628, 1192 - x0, screenOf(c, 1192 - x0, 21, false), { size: 21, weight: 700, maxLines: 2 });
      const bw = Math.max(tb.w, 40 + measure('ON SCREEN', 20, 700) + 15); const x = Math.round(Math.max(x0, Math.min((who.right + 1192 - bw) / 2, who.right + 220))); b += scr(x, 1192 - x); }
  } else {
    const hStart = b.length;
    if (tag) b += pill(64, 60, tag, dark ? P.lava : P.ink, '#fff', 22).svg;
    const ts = (c.hero ? [56, 46, 40, 34] : c.problem ? [72, 64, 56, 46, 40, 34] : [104, 88, 72, 64, 56, 46, 40, 34]).find((z) => wrap(c.title, 1112, z, 800).length <= 2) || 34;
    const t = textBlock(64, 124, 1112, c.title, { size: ts, weight: 800, color: ink, lh: 1.08, maxLines: 2 }); b += t.svg;
    const pr = textBlock(64, 124 + t.h + 18, 1112, c.problem, { size: c.hero ? 28 : 32, color: muted, maxLines: 3 }); b += pr.svg;
    if (c.hero) {
      const hs = fitSize(c.hero.value, 150, 560); const hw = heroWidth(c.hero.value, hs);
      const lx = 64 + hw + 32; const lw = 1176 - lx;
      const l = c.hero.label ? textBlock(lx, 0, lw, c.hero.label, { size: 34, weight: 700, color: ink, maxLines: 2 }) : { h: -14 };
      const nh = c.heroNote ? textBlock(lx, 0, lw, c.heroNote, { size: 26, color: muted, maxLines: 2 }).h : 0;
      // The hero block sits in the middle of the space between the problem line and the rule above the picture.
      const top = 124 + t.h + 18 + pr.h; const bh = Math.max(hs * 0.95, l.h + 14 + nh); const hy = Math.round(top + Math.max(24, (566 - top - bh) / 2));
      b += hero(64, hy + hs * 0.74, c.hero.value, hs, 'url(#gHot)');
      let ly = hy + 4;
      if (c.hero.label) { b += textBlock(lx, ly, lw, c.hero.label, { size: 34, weight: 700, color: ink, maxLines: 2 }).svg; ly += l.h + 14; }
      if (c.heroNote) b += textBlock(lx, ly, lw, c.heroNote, { size: 26, color: muted, maxLines: 2 }).svg;
    }
    // No value to show: the header block sits in the middle of its band instead of leaving an empty one under it.
    if (!c.hero) { const dy = Math.round((626 - (124 + t.h + 18 + pr.h)) / 2) + 10; if (dy > 12) b = b.slice(0, hStart) + `<g transform="translate(0 ${dy})">${b.slice(hStart)}</g>`; }
    b += `<rect x="48" y="574" width="1144" height="2" fill="${rule}"/>`;
    b += pic.svg;
    b += `<rect x="48" y="1524" width="1144" height="2" fill="${rule}"/>`;
    const who = whoBlock(64, 1548, c, [P.blue, P.lava, P.green], { ph: 130, w: 400, size: 28, ink, muted, accent: P.lava, maxH: h - 1548 - 24 }); b += who.svg;
    const sw = o.logo ? 250 : 496;
    b += slot(icon('monitor', 680, 1572, 34, P.lava, 2) + label(724, 1598, 'ON SCREEN', { size: 22, weight: 700, color: P.grey, spacing: 1.5 }), textBlock(680, 1620, sw, screenOf(c, sw, 26, !who.svg), { size: 26, weight: 700, color: ink, maxLines: 2 }).svg);
    if (o.logo) b += `<image href="${esc(o.logo)}" x="956" y="1566" width="220" height="110" preserveAspectRatio="xMaxYMid meet"/>`;
  }
  return frame(concept, orient, w, h, '', b, { uc: c.no, concept, bg: dark ? P.ink : '#FBF9F6' });
}

// 1. Journey road: the steps are stops on a winding road; the slowest wait is called out.
function journey(c, b, land, k) {
  // A stop whose label does not show goes, disc and number too; the road runs through the stops left, and with none there is no road.
  const lwOf = (n) => (land ? Math.min(360, (2 * (b.w - 120)) / Math.max(1, n - 1) - 40) : 568);
  const st = keepShown(c.steps, (x, n) => shows(lwOf(n), x.label, { size: land ? 20 : 24, weight: 600, maxLines: land ? 2 : 3 })); const n = st.length; const cs = cols(); let s = '';
  // The stops are the road's labels: the road with its start flag and end target goes with them.
  const road = (ends, stops) => (stops ? `<g data-process="road">${slot(ends, stops)}</g>` : '');
  if (land) {
    const sp = (b.w - 120) / Math.max(1, n - 1); const X = (i) => b.x + 60 + i * sp; const Y = (i) => b.y + (i % 2 ? 230 : 110);
    const pts = [[b.x - 30, Y(0) + 60], ...st.map((_, i) => [X(i), Y(i)]), [b.x + b.w + 30, Y(n - 1) + (n % 2 ? 60 : -60)]];
    const lw = lwOf(n); let stops = '';
    st.forEach((x, i) => { const cx = X(i); const cy = Y(i); const lc = clamp(cx, b.x + lw / 2, b.x + b.w - lw / 2);
      stops += slot(`<circle cx="${f1(cx)}" cy="${cy}" r="40" fill="#fff" filter="url(#sh)"/>${iconDisc(x.icon, cx, cy, 32, cs[i % cs.length])}${badge(cx + 30, cy - 30, 16, String(i + 1), P.ink)}`,
        textBlock(lc, i % 2 ? b.y + 282 : b.y - 2, lw, x.label, { size: 20, weight: 600, color: P.ink, anchor: 'middle', maxLines: 2 }).svg); });
    s += road(ribbon(spline(pts), 46, '#3D4A5C', { edge: '#E6E0D6', dash: '16 14' }) + iconDisc('flag', b.x + 14, Y(0) + 60, 24, P.green) + iconDisc('target', b.x + b.w - 14, Y(n - 1) + (n % 2 ? 60 : -60), 24, P.lava), stops);
    const pain = c.pain;
    return { svg: s, foot: pain ? (x, y, w) => slot(`<rect x="${x}" y="${y}" width="${w}" height="112" rx="20" fill="${P.ink}"/>${icon('hourglass', x + 18, y + 18, 40, P.amber, 2.2)}`, `${label(x + 70, y + 40, pain.value, { size: 32, weight: 800, color: '#fff' })}${textBlock(x + 70, y + 52, w - 90, pain.label, { size: 20, color: '#DDE3EA', maxLines: 2 }).svg}`) : null };
  }
  const gap = (b.h - 300) / Math.max(1, n - 1); const X = (i) => b.x + (i % 2 ? 380 : 170); const Y = (i) => b.y + 70 + i * gap;
  const pts = [[b.x + 90, b.y - 10], ...st.map((_, i) => [X(i), Y(i)]), [b.x + 280, b.y + b.h - 170]]; let stops = '';
  st.forEach((x, i) => { const cx = X(i); const cy = Y(i);
    stops += slot(`<circle cx="${cx}" cy="${f1(cy)}" r="48" fill="#fff" filter="url(#sh)"/>${iconDisc(x.icon, cx, cy, 40, cs[i % cs.length])}${badge(cx + 38, cy - 38, 18, String(i + 1), P.ink)}`,
      leader(cx + 56, cy, b.x + 556, cy) + textBlock(b.x + 576, cy - 30, 568, x.label, { size: 24, weight: 600, color: P.ink, maxLines: 3 }).svg); });
  s += road(ribbon(spline(pts), 56, '#3D4A5C', { edge: '#E6E0D6', dash: '18 16' }) + iconDisc('flag', b.x + 90, b.y + 10, 30, P.green) + iconDisc('target', b.x + 280, b.y + b.h - 190, 30, P.lava), stops);
  if (c.pain) { const y = b.y + b.h - 144;
    s += slot(`<rect x="${b.x}" y="${y}" width="${b.w}" height="128" rx="24" fill="${P.ink}"/>${icon('hourglass', b.x + 28, y + 36, 56, P.amber, 2.2)}`,
      label(b.x + 104, y + 62, c.pain.value, { size: 44, weight: 800, color: '#fff' }) + textBlock(b.x + 104, y + 76, b.w - 140, c.pain.label, { size: 24, color: '#DDE3EA', maxLines: 1 }).svg); }
  return { svg: s };
}

// The loop's heading names its cadence when that fits the line.
const loopLine = (cad, w) => { const t = `A LOOP THAT RUNS ${String(cad || '').toUpperCase()}`; return cad && measure(t, 22, 800) + 60 <= w ? t : 'A LOOP THAT RUNS AGAIN'; };

// The wheel's hub drawn inside the wheel's own diagram group.
const inWheel = (wheel, hub) => wheel.replace(/<\/g>$/, `${hub}</g>`);

// 2. Loop wheel: the steps run around a wheel that holds the headline result.
function cycleConcept(c, b, land, k) {
  // A step whose label does not show in the list goes from the wheel too (its node, icon and number); with none left there is no wheel.
  const mlOf = (n) => (land ? ((b.h - 64) / n >= 58 ? 2 : 1) : 190 / Math.ceil(n / 2) >= 60 ? 2 : 1);
  const st = keepShown(c.steps, (x, n) => shows(land ? 706 : 510, x.label, { size: 22, weight: 600, maxLines: mlOf(n) })); const n = st.length;
  const cs = [P.purple, P.pink, P.amber, P.cyan, P.blue]; let s = '';
  if (!n) return { svg: '' };
  const hubv = c.hub || c.hero;
  // With no headline value the hub names how many steps the loop has, under the loop icon, so the wheel never has an empty centre.
  const steps = (x, y, sz, ls) => slot(icon('refresh', x - sz / 2, y - sz * 0.78, sz, P.purple, 2), label(x, y + ls * 1.25, `${n} ${n === 1 ? 'step' : 'steps'}`, { size: ls, weight: 700, color: P.purple, anchor: 'middle' }));
  if (land) {
    const cx = b.x + 190; const cy = b.y + 165; const per = (b.h - 64) / n; const ml = mlOf(n);
    // Each node's label is its row in the list (number and text), so a node and its label are one slot.
    const cyc = cycle(cx, cy, 120, st, cs, { nodeR: 32, w: 10, text: (i, nd) => { const y = b.y + 56 + i * per;
      return badge(+f1(nd.x + nd.dx * 44), +f1(nd.y + nd.dy * 44), 16, String(i + 1), nd.color) + badge(456, y + 16, 16, String(i + 1), cs[i % cs.length]) + textBlock(486, y + 2, 706, st[i].label, { size: 22, weight: 600, color: P.ink, maxLines: ml }).svg; } });
    const wheel = inWheel(cyc.svg, `<circle cx="${cx}" cy="${cy}" r="76" fill="#fff" filter="url(#sh)"/>${ring(cx, cy, 66, 10, 0.7, P.purple, tint(P.purple))}${hubv ? '' : steps(cx, cy, 44, 20)}`);
    s += slot(tagline(440, b.y + 30, 'refresh', loopLine(c.cadence, land ? 700 : 1100), P.purple), wheel);
    if (hubv) s += hero(cx, cy + 16, hubv.value, fitSize(hubv.value, 46, 110), 'url(#gViolet)', 'middle');
    return { svg: s, foot: hubv ? (x, y, w) => slot(iconDisc('target', x + 30, y + 40, 30, P.purple), `${label(x + 74, y + 30, hubv.value, { size: 28, weight: 800, color: P.purple })}${textBlock(x + 74, y + 42, w - 74, hubv.label, { size: 20, color: P.body, maxLines: 2 }).svg}`) : null };
  }
  const cx = 620; const cy = b.y + 330; const rh = 190 / Math.ceil(n / 2);
  const cyc = cycle(cx, cy, 250, st, cs, { nodeR: 52, w: 16, text: (i, nd) => { const x0 = b.x + (i % 2) * 580; const y0 = b.y + 706 + Math.floor(i / 2) * rh;
    return badge(+f1(nd.x + nd.dx * 70), +f1(nd.y + nd.dy * 70), 18, String(i + 1), nd.color) + badge(x0 + 18, y0 + 18, 18, String(i + 1), cs[i % cs.length]) + textBlock(x0 + 50, y0 + 2, 510, st[i].label, { size: 22, weight: 600, color: P.ink, maxLines: rh >= 60 ? 2 : 1 }).svg; } });
  const wheel = inWheel(cyc.svg, `<circle cx="${cx}" cy="${cy}" r="150" fill="#fff" filter="url(#sh)"/>${ring(cx, cy, 134, 16, 0.7, P.purple, tint(P.purple))}${hubv ? '' : steps(cx, cy, 96, 30)}`);
  s += slot(tagline(b.x, b.y + 680, 'refresh', loopLine(c.cadence, land ? 700 : 1100), P.purple), wheel);
  // With a label under it the value sits higher and the label narrower, so both stay inside the ring.
  if (hubv) { const lab = hubv.label && hubv !== c.hero; s += hero(cx, cy + (lab ? -4 : 18), hubv.value, fitSize(hubv.value, lab ? 84 : 96, 200), 'url(#gViolet)', 'middle');
    if (lab) s += textBlock(cx, cy + 16, 196, hubv.label, { size: 20, color: P.body, anchor: 'middle', maxLines: 3 }).svg; }
  return { svg: s };
}

// 3. Data to decision scene: a data stack, a model, a cloud of scenarios and the screen a person decides on, on one floor.
function isometric(c, b, land, k) {
  // Four stations: data, model, scenarios, decision. With fewer than four steps the model station is named by the technique.
  const st = c.steps; const four = st.length >= 4;
  const labels = (four ? st.slice(0, 4).map((x) => x.label) : st.length === 3 ? [st[0].label, c.technique, st[1].label, st[2].label] : [...st.map((x) => x.label), c.screen || '']).slice(0, 4);
  while (labels.length < 4) labels.push('');
  const icons = four ? st.map((x) => x.icon) : ['database', 'brain', 'sparkles', 'monitor'];
  const cs = [P.cyan, P.blue, P.pink, P.green]; let s = '';
  const dots = (cx, cy, sc) => { let d = ''; for (let i = 0; i < 60; i++) { const a = i * 2.4; const rr = (14 + (i % 9) * 7) * sc; d += `<circle cx="${f1(cx + Math.cos(a) * rr * 1.25)}" cy="${f1(cy + Math.sin(a) * rr * 0.62)}" r="${f1((4 + (i % 3)) * sc)}" fill="${[P.amber, P.pink, P.purple][i % 3]}" opacity="0.8"/>`; } return `<g data-scene="scenarios">${d}</g>`; };
  const station = (i, x, y, sc) => i === 0 ? dataStack(x, y, 70 * sc, [P.cyan, P.blue, P.purple]) : i === 1 ? hex(x, y, 60 * sc, P.blue) + icon('brain', x - 26 * sc, y - 26 * sc, 52 * sc, '#fff', 2.2)
    : i === 2 ? dots(x, y, sc) : dashboardScreen(x - 110 * sc, y - 80 * sc, 220 * sc, 150 * sc, [P.blue, P.green, P.amber, P.pink]);
  // A station whose label does not show goes (its scene, icon and number); the stations left share the floor, and with none the scene is empty.
  const lo = land ? { size: 20, weight: 600, maxLines: 4, lh: 1.15 } : { size: 22, weight: 600, maxLines: 3 };
  const named = [0, 1, 2, 3].filter((i) => labels[i]); const keep = named.filter((i) => shows(land ? 266 : 440, labels[i], lo)); textBlock.dropped += named.length - keep.length;
  if (!keep.length) return { svg: '' };
  const m = keep.length;
  if (land) {
    const xs = m === 4 ? [b.x + 130, b.x + 420, b.x + 720, b.x + 1000] : keep.map((_, j) => (m === 1 ? b.x + 565 : b.x + 130 + (j * 870) / (m - 1))); const y = b.y + 120;
    s += `<path d="M${b.x + 40},${b.y + 236} L${b.x + 170},${b.y + 30} L${b.x + b.w - 10},${b.y + 30} L${b.x + b.w - 140},${b.y + 236}Z" fill="#EEF2F8"/>`;
    s += '<g data-process="iso-flow">';
    keep.forEach((i, j) => { const x = xs[j]; if (j < m - 1) s += curve([x + 90, y], [x + 140, y - 30], [xs[j + 1] - 150, y - 30], [xs[j + 1] - 100, y], P.grey, 5, { head: 18 });
      s += slot(station(i, x, i === 0 ? y - 10 : y, 1) + iconDisc(icons[i] || 'sparkles', x - 104, b.y + 54, 22, cs[i]) + badge(x - 82, b.y + 34, 14, String(j + 1), P.ink),
        textBlock(x, b.y + 246, 266, labels[i], { ...lo, color: P.ink, anchor: 'middle' }).svg); });
    s += '</g>' + person(b.x + 1140, b.y + 236, 120, P.lava);
    const r = c.ring;
    return { svg: s, foot: r ? (x, y, w) => `${ring(x + 40, y + 44, 38, 12, r.value / 100, P.green, tint(P.green))}${label(x + 40, y + 51, r.raw, { size: 20, weight: 800, color: P.green, anchor: 'middle' })}${textBlock(x + 92, y + 4, w - 92, r.label, { size: 20, color: P.body, maxLines: 3 }).svg}` : null };
  }
  const pos = [[b.x + 260, b.y + 110], [b.x + 880, b.y + 300], [b.x + 260, b.y + 490], [b.x + 880, b.y + 680]];
  s += blob(b.x + 570, b.y + 450, 560, 420, '#EEF2F8', 4);
  s += '<g data-process="iso-flow">';
  keep.forEach((i, j) => { const [x, y] = pos[j];
    if (j < m - 1) { const [nx, ny] = pos[j + 1]; const dir = nx > x ? 1 : -1; s += curve([x + dir * 150, y + 10], [x + dir * 300, y + 40], [nx - dir * 300, ny - 40], [nx - dir * 160, ny - 10], P.grey, 6, { head: 22 }); }
    s += slot(station(i, x, i === 0 ? y - 14 : y, 1.3) + iconDisc(icons[i] || 'sparkles', x - dir0(j) * 170, y - 90, 28, cs[i]) + badge(x - dir0(j) * 170 + 26, y - 116, 16, String(j + 1), P.ink),
      textBlock(x, y + (i === 3 ? 150 : 112), 440, labels[i], { ...lo, color: P.ink, anchor: 'middle' }).svg); });
  s += '</g>';
  if (c.ring) { const r = c.ring; s += ring(b.x + 1040, b.y + 70, 62, 18, r.value / 100, P.green, tint(P.green)) + label(b.x + 1040, b.y + 82, r.raw, { size: 32, weight: 800, color: P.green, anchor: 'middle' });
    s += textBlock(b.x + 950, b.y + 2, 470, r.label, { size: 22, color: P.body, anchor: 'end', maxLines: 3 }).svg; }
  return { svg: s };
}
const dir0 = (i) => (i % 2 ? -1 : 1);

// 4. Unit chart: 100 units of the value at stake, the share the use case is about filled in.
function pictogram(c, b, land, k) {
  const sh = c.share; const on = sh ? Math.round(sh.value) : 100; const unit = sh ? sh.unit : 'square';
  const big = sh ? `${sh.value}%` : (c.hero ? c.hero.value : ''); const what = sh ? sh.label : (c.hero ? c.hero.label : '');
  // The legend names what the squares are a share of; when the stake's label does not fit the line, the number alone does.
  const legendOf = (w, size) => [c.hero && `One square = 1% of ${c.hero.value} ${c.hero.label}`.trim(), c.hero && `One square = 1% of ${c.hero.value}`, 'One square = 1%'].find((t) => t && wrap(t, w, size).length <= (land ? 1 : 3));
  let s = '';
  if (land) {
    const g = unitGrid(b.x + 20, b.y + 14, 10, 100, on, unit, 24, 6, P.green, '#DDE3E8'); s += g.svg;
    const rx = b.x + 360;
    s += hero(rx, b.y + 80, big, fitSize(big, 88, 300), 'url(#gGreen)') + textBlock(rx + 320, b.y + 14, b.x + b.w - rx - 320, what, { size: 22, weight: 600, color: P.ink, maxLines: 3 }).svg;
    s += `<rect x="${rx}" y="${b.y + 112}" width="22" height="22" rx="5" fill="${P.green}"/>` + label(rx + 34, b.y + 131, legendOf(b.x + b.w - rx - 34, 20), { size: 20, color: P.body });
    s += slot(tagline(rx, b.y + 162, 'route', 'HOW IT WORKS', P.green), chevronSteps(rx, b.y + 174, b.x + b.w - rx, 52, c.steps, [P.cyan, P.blue, P.green, P.purple, P.amber], { size: 20, maxLines: 3 }).svg);
    return { svg: s };
  }
  const g = unitGrid(b.x + 10, b.y + 10, 10, 100, on, unit, 48, 14, P.green, '#DDE3E8'); s += g.svg;
  const rx = b.x + g.w + 60; const rw = b.x + b.w - rx;
  s += hero(rx, b.y + 120, big, fitSize(big, 130, rw), 'url(#gGreen)') + textBlock(rx, b.y + 150, rw, what, { size: 28, weight: 600, color: P.ink, maxLines: 4 }).svg;
  s += `<rect x="${rx}" y="${b.y + 330}" width="28" height="28" rx="6" fill="${P.green}"/>` + textBlock(rx + 42, b.y + 330, rw - 42, legendOf(rw - 42, 22), { size: 22, color: P.body, maxLines: 3 }).svg;
  s += slot(tagline(b.x, b.y + 676, 'route', 'HOW IT WORKS', P.green), chevronSteps(b.x, b.y + 700, b.w, 80, c.steps, [P.cyan, P.blue, P.green, P.purple, P.amber], { size: 22, maxLines: 3 }).svg);
  return { svg: s };
}

// 5. Before and after: today's way against the new way, the steps that make the change underneath.
function beforeafter(c, b, land, k) {
  const before = (c.before || []).slice(0, 3); const after = (c.after || []).slice(0, 3); let s = '';
  // A panel sized to its lines (never a tall panel holding one line): { svg, h }. Each line gets the fewest text lines that show a whole
  // phrase of it; a line with none, or one past the panel's most height (hMax), goes with its icon. The room left lets lines grow toward
  // their whole text. The heading, icon and panel go with the lines: with none left there is no panel.
  const panel = (x, y, w, hMax, title, ic, col, lines0, icons, size) => {
    const tw = w - 80 - size; const avail = hMax - 90; const lh = size * 1.22; const hOf = (n) => Math.max(size + 10, (n - 1) * lh + size); const sum = (a) => a.reduce((q, z) => q + z, 0);
    const minL = (t) => [1, 2, 3, 4].find((m) => shows(tw, t, { size, weight: 600, maxLines: m })) || 0; const gap = 14;
    let lines = lines0.filter((t) => minL(t)); while (lines.length && sum(lines.map((t) => hOf(minL(t)))) + gap * (lines.length - 1) > avail) lines = lines.slice(0, -1);
    textBlock.dropped += lines0.length - lines.length;
    if (!lines.length) return { svg: '', h: 0 };
    const al = lines.map(minL); const full = lines.map((t) => Math.min(4, wrap(t, tw, size, 600).length));
    for (let grew = true; grew;) { grew = false; al.forEach((n, i) => { if (n < full[i] && sum(al.map(hOf)) - hOf(n) + hOf(n + 1) + gap * (lines.length - 1) <= avail) { al[i] = n + 1; grew = true; } }); }
    const hh = al.map(hOf); const top = size >= 26 ? 76 : 70; const h = Math.round(top + sum(hh) + gap * (lines.length - 1) + 20); let yy = y + top; let body = '';
    lines.forEach((t, i) => { body += slot(icon(icons[i % icons.length], x + 26, yy + (hh[i] - size - 6) / 2, size + 6, col, 2.2), textBlock(x + 40 + size + 6, yy, tw, t, { size, weight: 600, color: P.ink, maxLines: al[i] }).svg); yy += hh[i] + gap; });
    return { svg: slot(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="24" fill="${tint(col)}"/>${iconDisc(ic, x + 40, y + 38, 22, col)}${label(x + 74, y + 46, title, { size: size + 2, weight: 800, color: col, spacing: 1.5 })}`, body), h };
  };
  const TODAY = (x, y, w, h, z) => panel(x, y, w, h, 'TODAY', 'alert', P.red, before, ['clock', 'alert', 'document'], z);
  const AFTER = (x, y, w, h, z) => panel(x, y, w, h, 'AFTER', 'check', P.green, after, ['check', 'shield', 'sparkles'], z);
  // The steps spread down the room left under y (a big numbered list, so no band of the box is left empty).
  const spread = (y0) => { const steps = keepShown(c.steps.slice(0, 5), (st) => shows(b.w - 2 * (land ? 30 : 46) - 12, st.label, { size: land ? 24 : 32, weight: 600, maxLines: 2 }));
    const r = land ? 30 : 46; const size = land ? 24 : 32; const top = y0 + (land ? 56 : 80);
    const rowH = steps.length ? (b.y + b.h - top) / steps.length : 0; let t = '';
    steps.forEach((st, i) => { t += stepList(b.x, top + i * rowH + Math.max(0, (rowH - 2 * r) / 2), b.w, [st], { r, size, maxLines: 2, colors: [cols()[i % 6]] }).svg; });
    return slot(tagline(b.x, y0 + (land ? 26 : 40), 'route', 'HOW IT WORKS', P.lava, { size: land ? 22 : 28 }), t); };
  // The steps in the landscape room left under the panels: a chevron row under a heading when the room holds one, else one inline row.
  const under = (y0) => (b.y + b.h - y0 >= 150
    ? slot(tagline(b.x, y0 + 26, 'route', 'HOW IT WORKS', P.lava), chevronSteps(b.x, y0 + 40, b.w, 52, c.steps, [P.cyan, P.blue, P.green, P.purple, P.amber], { size: 20, maxLines: 3 }).svg)
    : inlineFlow(b.x, y0, b.w, c.steps));
  // A list left empty (or none of whose lines shows) gets no panel: with neither list the steps fill the box, with one list its panel takes the
  // whole width; the panels take the height their lines need and the steps take the room they leave.
  const z = land ? 21 : 26; const any = (lines, w) => lines.some((t) => shows(w - 80 - z, t, { size: z, weight: 600, maxLines: 4 }));
  const two = any(before, land ? 540 : b.w) && any(after, land ? 540 : b.w);
  if (!two) {
    const one = any(before, b.w) ? TODAY : any(after, b.w) ? AFTER : null; textBlock.dropped += (one === TODAY ? after : one === AFTER ? before : [...before, ...after]).length;
    const p = one ? one(b.x, b.y, b.w, land ? 240 : 300, z) : { svg: '', h: 0 };
    if (!p.h) return { svg: spread(b.y) };
    return { svg: p.svg + (land ? under(b.y + p.h + 16) : spread(b.y + p.h + 40)) };
  }
  if (land) {
    const L = TODAY(b.x, b.y, 540, 240, 21); const R = AFTER(b.x + 620, b.y, 540, 240, 21); const ph = Math.max(L.h, R.h);
    s += L.svg + R.svg + chevron(b.x + 552, b.y + Math.min(L.h, R.h) / 2 - 30, 56, 60, P.lava, true, 0.5);
    s += under(b.y + ph + 16);
    return { svg: s };
  }
  const T = TODAY(b.x, b.y, b.w, 300, 26); const A = AFTER(b.x, b.y + T.h + 72, b.w, 300, 26);
  s += T.svg + `<path d="M${620 - 40},${b.y + T.h + 12} L${620 + 40},${b.y + T.h + 12} L620,${b.y + T.h + 60}Z" fill="${P.lava}"/>` + A.svg;
  s += spread(b.y + T.h + 72 + A.h + 20);
  return { svg: s };
}

// 6. Forecast band: the history line runs into a widening forecast band past "today".
function timeline(c, b, land, k) {
  const tr = c.trend; const down = tr && (/^-|−/.test(tr.value) || /\b(fall|falls|drop|drops|declin|down|less|fewer|lower)\b/i.test(tr.label)); const dir = down ? 1 : -1;
  const chart = (x0, x1, yT, yB, rise, spread, lineW) => {
    const mid = (yT + yB) / 2 + (dir < 0 ? 0.18 : -0.18) * (yB - yT); const tx = x0 + 0.56 * (x1 - x0); let p = '';
    const hist = Array.from({ length: 15 }, (_, i) => [x0 + (i / 14) * (tx - x0), mid + Math.sin(i * 1.7) * spread * 0.35 + Math.cos(i * 0.9) * spread * 0.2]);
    const fc = (t) => mid + dir * rise * t * t * 0.6 + dir * rise * t * 0.4;
    const up = []; const lo = []; for (let i = 0; i <= 10; i++) { const t = i / 10; const x = tx + t * (x1 - tx); up.push([x, fc(t) - spread * t]); lo.push([x, fc(t) + spread * t]); }
    p += `<path d="M${up.map((q) => q.map(f1).join(',')).join(' L')} L${lo.reverse().map((q) => q.map(f1).join(',')).join(' L')}Z" fill="${P.lava}" opacity="0.18"/>`;
    p += `<path d="${spline([hist[hist.length - 1], ...Array.from({ length: 6 }, (_, i) => [tx + ((i + 1) / 6) * (x1 - tx), fc((i + 1) / 6)])])}" stroke="${P.lava}" stroke-width="${lineW}" fill="none" stroke-dasharray="10 8"/>`;
    p += `<path d="${spline(hist)}" stroke="${P.ink}" stroke-width="${lineW}" fill="none" stroke-linecap="round"/>`;
    p += `<path d="M${f1(tx)},${yT} L${f1(tx)},${yB}" stroke="${P.grey}" stroke-width="2" stroke-dasharray="4 6"/>${slot(iconDisc('calendar', tx, yT + 4, 20, P.ink), label(tx + 30, yT + 12, 'Today', { size: 20, weight: 700, color: P.ink }))}`;
    p += label(x0 + 4, yB - 8, 'History', { size: 20, color: P.grey }) + label(tx + 16, yB - 8, 'Forecast range', { size: 20, color: P.grey });
    return { svg: `<g data-chart="forecast-band">${p}</g>`, endY: fc(1), tx };
  };
  let s = '';
  if (land) {
    s += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="242" rx="20" fill="#fff" filter="url(#sh)"/>`;
    const ch = chart(b.x + 30, b.x + b.w - 30, b.y + 26, b.y + 226, 60, 40, 5); s += ch.svg;
    if (tr) { const ty = dir < 0 ? b.y + 136 : b.y + 40; const xr = b.x + b.w - 40;
      s += slot(icon(dir < 0 ? 'trendUp' : 'trendDown', xr - 40, ty, 36, P.lava, 2.4), hero(xr - 50, ty + 32, tr.value, fitSize(tr.value, 40, 160), 'url(#gHot)', 'end') + textBlock(xr, ty + 44, 330, tr.label, { size: 20, color: P.body, anchor: 'end', maxLines: 2 }).svg); }
    s += inlineFlow(b.x, b.y + 264, b.w, c.steps);
    return { svg: s };
  }
  s += `<rect x="${b.x}" y="${b.y}" width="${b.w}" height="560" rx="24" fill="#fff" filter="url(#sh)"/>`;
  const ch = chart(b.x + 40, b.x + b.w - 40, b.y + 40, b.y + 520, 150, 90, 7); s += ch.svg;
  if (tr) { const ty = dir < 0 ? b.y + 320 : b.y + 80; const xr = b.x + b.w - 50;
    s += slot(icon(dir < 0 ? 'trendUp' : 'trendDown', xr - 56, ty, 52, P.lava, 2.4), hero(xr - 70, ty + 46, tr.value, fitSize(tr.value, 60, 260), 'url(#gHot)', 'end') + textBlock(xr, ty + 66, 440, tr.label, { size: 26, color: P.body, anchor: 'end', maxLines: 3 }).svg); }
  s += slot(tagline(b.x, b.y + 612, 'route', 'HOW IT WORKS', P.lava), chevronSteps(b.x, b.y + 636, b.w, 80, c.steps, [P.cyan, P.blue, P.green, P.purple, P.amber], { size: 22, maxLines: 4 }).svg);
  return { svg: s };
}

// 7. Funnel: a wide set narrowed to the few to act on; each stage's number inside, its meaning beside it.
function funnelConcept(c, b, land, k) {
  // A stage whose meaning does not show beside it goes, its band, icon and number too; the stages left share the funnel.
  const lw0 = land ? b.w - 610 : b.w - 700;
  const stages = keepShown((c.stages || []).slice(0, 4), (x) => shows(lw0, x.label, { size: land ? 21 : 24, weight: 600, maxLines: land ? 2 : 3 }));
  const n = Math.max(1, stages.length); const ics = distinctIcons(stages.map((x) => x.label));
  const cs = [P.blue, P.purple, P.pink, P.lava]; let s = '';
  const draw = (x, y, w, sh, minW, vs, ls, lx, lw, ml) => {
    const f = funnel(x, y, w, sh, stages, cs, { minW }); let p = f.svg;
    f.nodes.forEach((nd, i) => { const st = stages[i]; const mid = nd.y + nd.h / 2; const half = (nd.top + nd.bot) / 4;
      p += slot(icon(ics[i], nd.cx - nd.bot / 2 + 18, mid - vs * 0.55, vs * 1.1, '#fff', 2.2) + (st.value ? label(nd.cx + vs * 0.4, mid + vs * 0.36, st.value, { size: vs, weight: 800, color: '#fff', anchor: 'middle' }) : ''),
        leader(nd.cx + half + 8, mid, lx - 16, mid) + textBlock(lx, mid - ls * (ml > 1 ? 1.1 : 0.55), lw, st.label, { size: ls, weight: 600, color: P.ink, maxLines: ml }).svg); });
    return p;
  };
  if (land) {
    const sh = (310 - 10 * (n - 1)) / n;
    s += draw(b.x + 20, b.y + 10, 520, sh, 200, fitSize(stages.reduce((a, x) => (x.value.length > a.length ? x.value : a), '') || '0', 30, 120), 21, b.x + 610, b.x + b.w - b.x - 610, 2);
    return { svg: s, foot: (x, y, w) => stepList(x, y, w, c.steps.slice(0, 3), { r: 16, size: 20, adapt: true, maxH: 112, gap: 4 }).svg };
  }
  // Two stages or fewer take taller bands, and the steps sit in the middle of the room the funnel leaves (never an empty band under it).
  const sh = Math.min(n >= 3 ? 130 : 200, (540 - 12 * (n - 1)) / n); const fe = b.y + 10 + n * sh + 12 * (n - 1);
  const ty = Math.round(Math.min(b.y + 612, fe + (b.y + b.h + 10 - fe - 120) / 2));
  s += draw(b.x + 10, b.y + 10, 640, sh, 240, fitSize(stages.reduce((a, x) => (x.value.length > a.length ? x.value : a), '') || '0', 44, 160), 24, b.x + 700, b.w - 700, 3);
  s += slot(tagline(b.x, ty, 'route', 'HOW IT WORKS', P.blue), chevronSteps(b.x, ty + 24, b.w, 84, c.steps, [P.cyan, P.blue, P.green, P.purple, P.amber], { size: 22, maxLines: 4 }).svg);
  return { svg: s };
}

// 8. Hub and spokes: a person asks, the central capability draws on the sources around it.
function hub(c, b, land, k) {
  // A spoke whose text does not show in its row goes with its icon; the others share the room.
  const sx0 = b.x + 850; const spokeML = (n) => (land ? (n <= 1 || 280 / (n - 1) >= 76 ? 3 : 2) : (170 / Math.max(1, Math.ceil(n / 2)) >= 56 ? 2 : 1));
  const spokes = keepShown(c.spokes || [], (t, n) => shows(land ? 1192 - sx0 - 40 : 520, t, { size: land ? 20 : 21, weight: 600, maxLines: spokeML(n) }), land ? 5 : 6);
  const ics = distinctIcons(spokes); const cs = [P.blue, P.green, P.amber, P.pink, P.purple, P.cyan];
  // The centre's name is the screen's, else (it does not show whole) the technique's.
  const centre = (w, size, maxLines) => [c.center, c.technique].find((t) => t && shows(w, t, { size, weight: 800, maxLines })) || '';
  const ask = c.steps[0] ? c.steps[0].label : c.problem; const rest = unused(c.steps.slice(1), spokes, c.center); let s = '';
  if (land) {
    s += slot(callout(b.x, b.y, 300, 104, b.x + 100, b.y + 132, '#fff', { r: 20, filter: 'sh' }) + icon('message', b.x + 16, b.y + 16, 28, P.lava, 2.2), textBlock(b.x + 54, b.y + 12, 234, ask, { size: 20, color: P.ink, maxLines: 3 }).svg);
    s += person(b.x + 100, b.y + 318, 186, P.lava);
    const hx = b.x + 520; const hy = b.y + 140; const sx = b.x + 850; let p = '';
    p += curve([b.x + 160, b.y + 200], [b.x + 260, b.y + 200], [hx - 180, hy], [hx - 100, hy], P.grey, 5, { head: 18 });
    const gap = spokes.length > 1 ? 280 / (spokes.length - 1) : 0;
    spokes.forEach((t, i) => { const y = b.y + 24 + i * gap; p += curve([hx + 92, hy], [hx + 200, hy], [sx - 140, y], [sx - 30, y], cs[i], 4, { head: 0 });
      p += slot(iconDisc(ics[i], sx, y, 26, cs[i]), textBlock(sx + 40, y - 22, 1192 - sx - 40, t, { size: 20, weight: 600, color: P.ink, maxLines: spokeML(spokes.length) }).svg); });
    // The centre disc goes with the capability's name under it.
    p += slot(`<circle cx="${hx}" cy="${hy}" r="92" fill="#fff" filter="url(#sh)"/>${iconDisc('brain', hx, hy, 70, P.ink)}`, textBlock(hx, b.y + 252, 320, centre(320, 21, 2), { size: 21, weight: 800, color: P.ink, anchor: 'middle', maxLines: 2 }).svg);
    s += `<g data-process="hub">${p}</g>`;
    return { svg: s, foot: footSteps(rest) };
  }
  s += person(b.x + 70, b.y + 220, 210, P.lava);
  const aq = textBlock(b.x + 236, 0, b.w - 276, ask, { size: 26, color: P.ink, maxLines: 3 }); const bh = Math.max(64, aq.h + 36);
  s += slot(`<rect x="${b.x + 160}" y="${b.y}" width="${b.w - 160}" height="${bh}" rx="24" fill="#fff" filter="url(#sh)"/>` + icon('message', b.x + 184, b.y + (bh - 36) / 2, 36, P.lava, 2.2), textBlock(b.x + 236, b.y + (bh - aq.h) / 2, b.w - 276, ask, { size: 26, color: P.ink, maxLines: 3 }).svg);
  // Each satellite's label is its numbered row under the wheel; the centre's is the capability's name over it.
  const n = spokes.length; const rows = Math.ceil(n / 2); const rh = 170 / Math.max(1, rows);
  const hs = hubSpokes(620, b.y + 440, 230, 'brain', spokes.map((t, i) => ({ icon: ics[i] })), cs, { start: -Math.PI / 2 + Math.PI / Math.max(1, n), hubR: 90, spokeR: 44,
    centre: textBlock(620, b.y + 160, 640, centre(640, 26, 1), { size: 26, weight: 800, color: P.ink, anchor: 'middle', maxLines: 1 }).svg,
    text: (i, nd) => { const x0 = b.x + (i % 2) * 580; const y0 = b.y + 730 + Math.floor(i / 2) * rh;
      return badge(+f1(nd.x + 34), +f1(nd.y - 34), 16, String(i + 1), P.ink) + badge(x0 + 18, y0 + 16, 16, String(i + 1), cs[i]) + textBlock(x0 + 48, y0 + 2, 520, spokes[i], { size: 21, weight: 600, color: P.ink, maxLines: spokeML(spokes.length) }).svg; } });
  s += hs.svg;
  return { svg: s };
}

// 9. Map with pins: the places the story is about, numbered, with the steps that choose them.
const PINS = [[0.22, 0.42], [0.55, 0.3], [0.8, 0.6], [0.38, 0.8], [0.66, 0.88]];
function map(c, b, land, k) {
  // A place whose text does not show in its row goes with its pin and icon; the others share the room.
  const placeOK = (t, n) => (land ? shows(b.w - 778, t, { size: 21, weight: 600, maxLines: 280 / Math.max(1, n) >= 56 ? 2 : 1 })
    : shows(484, t, { size: 22, weight: 600, maxLines: 170 / Math.max(1, Math.ceil(n / 2)) >= 60 ? 2 : 1 }));
  const places = keepShown(c.places || [], placeOK, land ? 4 : 5); const ics = distinctIcons(places, ['pin', 'route', 'target', 'flag', 'users']); const cs = [P.lava, P.blue, P.purple, P.amber, P.green]; let s = '';
  const field = (x, y, w, h, sz, id) => { const m = mapField(x, y, w, h, places.map((_, i) => [...PINS[i], cs[i], sz]), { id });
    let p = m.svg; const pts = m.pins.map((q) => [q.x, q.y]);
    if (pts.length > 1) p += `<g data-process="route"><path d="${spline(pts)}" stroke="${P.ink}" stroke-width="4" fill="none" stroke-dasharray="2 10" stroke-linecap="round"/></g>`;
    m.pins.forEach((q, i) => { p += badge(+f1(q.x), +f1(q.y - 18 * sz * 1.75), Math.round(13 * sz), String(i + 1), '#fff', cs[i]); });
    return p; };
  if (land) {
    s += field(b.x, b.y, 640, 330, 1.3, 'mapL');
    const per = (330 - 50) / Math.max(1, places.length); let rows = '';
    places.forEach((t, i) => { const y = b.y + 50 + i * per; rows += slot(badge(b.x + 706, y + 16, 16, String(i + 1), cs[i]) + icon(ics[i], b.x + 734, y + 2, 28, cs[i], 2), textBlock(b.x + 778, y + 2, b.w - 778, t, { size: 21, weight: 600, color: P.ink, maxLines: per >= 56 ? 2 : 1 }).svg); });
    s += slot(tagline(b.x + 690, b.y + 28, 'pin', 'THE PLACES', P.lava), rows);
    return { svg: s, foot: footSteps(unused(c.steps, places)) };
  }
  // The steps left for the row under the places, when one of them shows; else the map takes their room (never an empty band).
  const more = unused(c.steps, places); const d0 = textBlock.dropped; const hasMore = more.length > 0 && /<text/.test(miniFlow(b.x, 0, b.w, more, { r: 30, size: 20, maxLines: 2 })); textBlock.dropped = d0;
  const mh = hasMore ? 500 : 660;
  s += field(b.x, b.y, b.w, mh, 1.7, 'mapP');
  const rows = Math.ceil(places.length / 2); const rh = 170 / Math.max(1, rows); let list = '';
  places.forEach((t, i) => { const x0 = b.x + (i % 2) * 580; const y0 = b.y + mh + 52 + Math.floor(i / 2) * rh;
    list += slot(badge(x0 + 18, y0 + 16, 16, String(i + 1), cs[i]) + icon(ics[i], x0 + 44, y0 + 2, 28, cs[i], 2), textBlock(x0 + 84, y0 + 2, 484, t, { size: 22, weight: 600, color: P.ink, maxLines: rh >= 60 ? 2 : 1 }).svg); });
  s += slot(tagline(b.x, b.y + mh + 34, 'pin', 'THE PLACES', P.lava), list);
  if (hasMore) s += miniFlow(b.x, b.y + 744, b.w, more, { r: 30, size: 20, maxLines: 2 });
  return { svg: s };
}

// 10. Network clusters (a dark page): the groups found among linked entities, the new ones glowing.
function network(c, b, land, k) {
  // A card's text area: as many lines as the card holds (up to 3), so a long group keeps its whole phrase.
  const cardText = (w, h, size) => { const r = Math.min(32, Math.max(20, h * 0.28)); const tx = 2 * r + 28; return { r, tx, tw: w - tx - 20, ml: Math.max(2, Math.min(3, Math.floor((h - 6 - size) / (size * 1.22)) + 1)) }; };
  // The card size for n groups (portrait cards grow when no step is left for the footer).
  // Landscape cards share the column up to 110 px each (a taller card would be a half-empty box); the stack sits in the column's middle.
  const cardOf = (n, k) => (land ? { w: b.w - 720, h: Math.min(110, (330 - 10 * (n - 1)) / Math.max(1, n)), size: 20 } : { w: 562, h: 88 + (unused(c.steps, k).length ? 0 : 20), size: 22 });
  // A group whose text does not show in its card goes, card and icon too; the others re-flow.
  const groups = keepShown(c.groups || [], (t, n, k) => { const q = cardOf(n, k); const a = cardText(q.w, q.h, q.size); return shows(a.tw, t, { size: q.size, weight: 600, maxLines: a.ml }); }, 4);
  const ics = distinctIcons(groups, ['network', 'users', 'link', 'alert']); const cs = [P.cyan, P.lava, P.purple, P.amber]; let s = '';
  const card = (x, y, w, h, t, i, size) => { const { r, tx, ml } = cardText(w, h, size); return slot(`<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="16" fill="#22364C"/>${iconDisc(ics[i], x + r + 14, y + h / 2, r, cs[i])}`, textBlock(x + tx, y + h / 2 - size * 0.55 * Math.min(wrap(t, w - tx - 20, size, 600).length, ml), w - tx - 20, t, { size, weight: 600, color: '#fff', maxLines: ml }).svg); };
  if (land) {
    s += '<g data-process="links">' + constellation([{ cx: b.x + 130, cy: b.y + 110, r: 80, n: 7, color: P.cyan }, { cx: b.x + 360, cy: b.y + 210, r: 88, n: 8, color: P.lava, hot: true }, { cx: b.x + 570, cy: b.y + 96, r: 66, n: 6, color: P.purple }, { cx: b.x + 600, cy: b.y + 262, r: 50, n: 5, color: P.amber, hot: true }], { bridges: [[0, 1], [1, 2], [1, 3]] }) + '</g>';
    if (c.count) s += `<circle cx="${b.x + 130}" cy="${b.y + 270}" r="44" fill="${P.lava}"/>` + label(b.x + 130, b.y + 282, c.count, { size: fitSize(c.count, 34, 70), weight: 800, color: '#fff', anchor: 'middle' });
    // A column with room over its cards names them.
    const ch = cardOf(groups.length).h; const sh = groups.length * (ch + 10) - 10; const room = groups.length && 330 - sh >= 60;
    const gy = room ? b.y + 44 + (286 - sh) / 2 : b.y + (330 - sh) / 2;
    const cards = groups.map((t, i) => card(b.x + 720, gy + i * (ch + 10), b.w - 720, ch, t, i, 20)).join('');
    s += room ? slot(tagline(b.x + 720, b.y + 28, 'network', 'THE GROUPS FOUND', P.cyan), cards) : cards;
    return { svg: s, foot: footSteps(unused(c.steps, groups), '#fff') };
  }
  // With no step left to show, the picture and the cards share the space the steps would take.
  const more = unused(c.steps, groups); const dy = more.length ? 0 : 60; const cy0 = b.y + dy;
  s += '<g data-process="links">' + constellation([{ cx: b.x + 200, cy: cy0 + 140, r: 120, n: 8, color: P.cyan }, { cx: b.x + 560, cy: cy0 + 300, r: 130, n: 9, color: P.lava, hot: true }, { cx: b.x + 930, cy: cy0 + 130, r: 100, n: 7, color: P.purple }, { cx: b.x + 940, cy: cy0 + 380, r: 72, n: 6, color: P.amber, hot: true }], { bridges: [[0, 1], [1, 2], [1, 3]] }) + '</g>';
  if (c.count) s += `<circle cx="${b.x + 150}" cy="${cy0 + 390}" r="64" fill="${P.lava}"/>` + label(b.x + 150, cy0 + 406, c.count, { size: fitSize(c.count, 48, 100), weight: 800, color: '#fff', anchor: 'middle' });
  groups.forEach((t, i) => { s += card(b.x + (i % 2) * 582, b.y + 510 + 2 * dy + Math.floor(i / 2) * (100 + dy / 3), 562, 88 + dy / 3, t, i, 22); });
  if (more.length) s += chevronSteps(b.x, b.y + 726, b.w, 64, more, [P.cyan, P.purple, P.lava, P.amber, P.green], { size: 20, maxLines: 2, ink: '#DDE3EA' }).svg;
  return { svg: s };
}

// 11. Waterfall bridge: one change split into the drivers that explain it, an icon over every bar.
const amount = (v) => { const m = /([-−+])?\s*\$?\s*(\d[\d,]*(?:\.\d+)?)\s*([KMB])?/i.exec(String(v ?? '')); if (!m) return null; const n = parseFloat(m[2].replace(/,/g, '')) * ({ K: 1e3, M: 1e6, B: 1e9 }[(m[3] || '').toUpperCase()] || 1); return m[1] === '-' || m[1] === '−' ? -n : n; };
function waterfall(c, b, land, k) {
  const bars = (c.bars || []).slice(0, 5); const total = c.total; const nums = bars.map((x) => amount(x.value)); const numeric = nums.every((v) => v !== null) && bars.length >= 2;
  const vals = numeric ? nums : bars.map(() => -1); const tot = numeric ? (total && amount(total.value) !== null ? amount(total.value) : vals.reduce((a, v) => a + v, 0)) : vals.reduce((a, v) => a + v, 0);
  const cum = []; let run = 0; vals.forEach((v) => { cum.push([run, run + v]); run += v; });
  const all = [0, tot, ...cum.flat()]; const hi = Math.max(...all); const lo = Math.min(...all);
  const ics = [...distinctIcons(bars.map((x) => x.label)), 'flag']; const items = [...bars, { label: total ? total.label || 'Total' : 'Total', value: total ? total.value : '' }];
  const draw = (x0, x1, yT, yB, iy, ir, vs, ls, lml) => {
    const sw = (x1 - x0) / items.length; const bw = sw * 0.58; const Y = (v) => yT + ((hi - v) / Math.max(1e-9, hi - lo)) * (yB - yT); let p = '';
    p += `<path d="M${x0},${f1(Y(0))} L${x1},${f1(Y(0))}" stroke="${P.grey}" stroke-width="2" stroke-dasharray="4 6"/>`;
    items.forEach((it, i) => { const cx = x0 + sw * i + sw / 2; const isT = i === items.length - 1; const [a, z] = isT ? [0, tot] : cum[i];
      const top = Math.min(Y(a), Y(z)); const hgt = Math.max(4, Math.abs(Y(a) - Y(z))); const col = isT ? P.ink : (z < a ? P.red : P.green);
      p += `<rect x="${f1(cx - bw / 2)}" y="${f1(top)}" width="${f1(bw)}" height="${f1(hgt)}" rx="6" fill="${col}"/>`;
      if (!isT) p += `<path d="M${f1(cx + bw / 2)},${f1(Y(z))} L${f1(cx + sw - bw / 2)},${f1(Y(z))}" stroke="${P.grey}" stroke-width="2" stroke-dasharray="3 4"/>`;
      if (it.value) p += label(cx, top - 10, it.value, { size: vs, weight: 800, color: col, anchor: 'middle' });
      // The icon over a bar goes with the bar's name under it.
      p += slot(iconDisc(ics[i], cx, iy, ir, isT ? P.ink : col), textBlock(cx, yB + 16, sw - 14, it.label, { size: ls, weight: isT ? 800 : 600, color: P.ink, anchor: 'middle', maxLines: lml }).svg); });
    return `<g data-process="bridge" data-chart="waterfall">${p}</g>`;
  };
  if (land) return { svg: draw(b.x + 10, b.x + b.w - 10, b.y + 84, b.y + 224, b.y + 24, 20, 22, 20, 3), foot: (x, y, w) => stepList(x, y, w, c.steps.slice(0, 3), { r: 16, size: 20, adapt: true, maxH: 112, gap: 4 }).svg };
  let s = draw(b.x + 10, b.x + b.w - 10, b.y + 130, b.y + 520, b.y + 40, 28, 28, 22, 3);
  s += slot(tagline(b.x, b.y + 690, 'route', 'HOW IT WORKS', P.lava), chevronSteps(b.x, b.y + 714, b.w, 70, c.steps, [P.cyan, P.blue, P.green, P.purple, P.amber], { size: 20, maxLines: 3 }).svg);
  return { svg: s };
}

// 12. Balance and decision: the measured effect weighed on a scale, then the keep, change or stop fork.
const VERB = (o, fit = () => true) => (o.label && tidy(o.label).split(/\s+/).length <= 3 && fit(tidy(o.label)) ? tidy(o.label) : o.sign > 0 || /^\+/.test(o.value) ? 'Keep' : o.sign < 0 || /^-|^−/.test(o.value) ? 'Stop' : 'Review');
function balance(c, b, land, k) {
  const opts = (c.options || []).slice(0, 3).map((o) => ({ ...o, sign: o.sign ?? (/^-|^−/.test(o.value) ? -1 : /^\+/.test(o.value) ? 1 : 0) }));
  const [A, B] = [opts[0] || { label: '', value: '' }, opts[1] || { label: '', value: '' }];
  const va = Math.abs(amount(A.value) || 0); const vb = Math.abs(amount(B.value) || 0); const tilt = va === vb ? 0 : va > vb ? 0.12 : -0.12;
  const colOf = (o) => (o.sign > 0 ? P.green : o.sign < 0 ? P.red : P.amber);
  const scale = (px, py, half, baseY, panW, vs, ls, lw, lml) => {
    const ex = Math.cos(tilt) * half; const ey = Math.sin(tilt) * half; const L = [px - ex, py + ey]; const R = [px + ex, py - ey]; let p = '';
    p += `<path d="M${px},${py} L${px - half * 0.3},${baseY} L${px + half * 0.3},${baseY}Z" fill="${P.ink}"/><rect x="${f1(px - half * 0.45)}" y="${baseY}" width="${f1(half * 0.9)}" height="14" rx="7" fill="${P.ink}"/>`;
    p += `<path d="M${f1(L[0])},${f1(L[1])} L${f1(R[0])},${f1(R[1])}" stroke="${P.ink}" stroke-width="10" stroke-linecap="round"/><circle cx="${px}" cy="${py}" r="14" fill="${P.lava}"/>`;
    [[L, A], [R, B]].forEach(([e, o]) => { const pyb = e[1] + panW * 0.5; const col = colOf(o);
      p += `<path d="M${f1(e[0])},${f1(e[1])} L${f1(e[0] - panW / 2)},${f1(pyb)} M${f1(e[0])},${f1(e[1])} L${f1(e[0] + panW / 2)},${f1(pyb)}" stroke="${P.grey}" stroke-width="3"/>`;
      p += `<path d="M${f1(e[0] - panW / 2)},${f1(pyb)} Q${f1(e[0])},${f1(pyb + panW * 0.34)} ${f1(e[0] + panW / 2)},${f1(pyb)}Z" fill="${col}"/>`;
      if (o.value) p += label(e[0], pyb - 8, o.value, { size: vs, weight: 800, color: col, anchor: 'middle' });
      p += slot(iconDisc(o.sign < 0 ? 'trendDown' : 'trendUp', e[0], e[1] - vs * 1.2, vs * 0.6, col), textBlock(clamp(e[0], b.x + lw / 2, b.x + b.w - lw / 2), pyb + panW * 0.26, lw, o.label, { size: ls, weight: 600, color: P.ink, anchor: 'middle', maxLines: lml }).svg); });
    return `<g data-chart="balance">${p}</g>`;
  };
  // Each outcome's label is its verb and its value beside the hex.
  const split = (x, y, w, h, vs, ls) => decisionSplit(x, y, w, h, { icon: 'scale' }, opts.map((o) => ({ icon: o.sign > 0 ? 'check' : o.sign < 0 ? 'alert' : 'refresh' })), opts.map(colOf),
    (i, nd) => textBlock(nd.x + 72, nd.y - 4 - vs * 0.92, Math.max(120, 1200 - nd.x - 72), VERB(opts[i], (v) => measure(v, vs, 800) <= Math.max(120, 1200 - nd.x - 72)), { size: vs, weight: 800, color: nd.color, maxLines: 1 }).svg + (opts[i].value ? label(nd.x + 72, nd.y + ls + 6, opts[i].value, { size: ls, weight: 600, color: P.ink }) : '')).svg;
  if (land) {
    const s = scale(b.x + 300, b.y + 120, 170, b.y + 300, 150, 24, 20, 300, 3) + split(b.x + 630, b.y + 10, 360, 310, 24, 22);
    return { svg: s, foot: (x, y, w) => stepList(x, y, w, c.steps.slice(0, 3), { r: 16, size: 20, adapt: true, maxH: 112, gap: 4 }).svg };
  }
  let s = scale(620, b.y + 150, 330, b.y + 440, 220, 34, 24, 420, 3);
  s += slot(tagline(b.x, b.y + 520, 'scale', 'THE DECISION', P.lava), split(b.x + 60, b.y + 540, 640, 340, 34, 26));
  return { svg: s };
}

export const RENDER = { journey, cycle: cycleConcept, isometric, pictogram, beforeafter, timeline, funnel: funnelConcept, hub, map, network, waterfall, balance };

// One concept drawn for one content (contentFor) in one orientation.
export function drawConcept(concept, c, orient = 'landscape', o = {}) {
  const fn = RENDER[concept] || RENDER.isometric; const id = RENDER[concept] ? concept : 'isometric';
  const svg = page(c, orient === 'portrait' ? 'portrait' : 'landscape', id, fn, { logo: o.logo, dark: id === 'network' });
  drawConcept.empty = page.empty; return svg;
}
