// REQ-561: one tile per use case under the infographic, with every business section of the side panel (the agent card view) and the value with a one-line story.
// No table, filter, SQL, notebook path or foundation is ever drawn here. Pure SVG strings; works for the design and the older themes alike.
import { esc, wrap } from './core.js';

const SIZE = 12; const LH = 16; const PAD = 40; const GAP = 20; const IN = 14;

// The lines of one tile as [{ text, bold, color, size }], wrapped to the tile's inner width.
function tileLines(v, pal, width) {
  const out = [];
  const add = (text, o = {}) => {
    const size = o.size || SIZE;
    for (const line of wrap(String(text ?? ''), width, size, 'sans', o.bold ? 700 : 400)) out.push({ text: line, bold: !!o.bold, color: o.color || pal.body, size, gap: o.gap || 0 });
  };
  const section = (label, items) => {
    const list = items.map((i) => String(i ?? '').trim()).filter(Boolean);
    if (!list.length) return;
    add(label, { bold: true, color: pal.accent, gap: 6 });
    list.forEach((i) => add(i));
  };
  add(`${v.rank}. ${v.title}`, { bold: true, color: pal.ink, size: 15 });
  add([v.id, v.domain, v.subdomain].filter(Boolean).join(' · '), { color: pal.muted });
  const s = v.value;
  add(s.amount === null ? s.text : `${s.text} ${s.currency ? '' : ''}`.trim(), { bold: true, color: pal.accent, size: 14, gap: 4 });
  if (s.amount !== null && s.story) add(s.story, { color: pal.muted });
  v.metrics.forEach(([, label, value]) => add(`${label}: ${value}`, { color: pal.muted }));
  if (v.star) add(v.star, { bold: true, color: pal.accent });
  v.narrative.forEach(([, label, value]) => section(label, [value]));
  v.facts.forEach(([, label, value]) => add(`${label}: ${value}`));
  v.valueFacts.forEach(([, label, items]) => section(label, items));
  return out;
}

const A4_H = 1123;
export const MAX_PAGE_H = 3 * A4_H; // an infographic page is at most three A4 pages tall

// svg: a finished infographic; views: the agent card views (agentModel ranked); pal: { page, card, ink, body, muted, accent }.
// Returns the svg grown by the tiles, one tall picture. It carries <!--cut:y--> marks where it may be cut into pages (splitInfographic).
export function withPanelTiles(svg, views, pal, { rtl = false } = {}) {
  if (!Array.isArray(views) || !views.length) return svg;
  const head = /^<svg [^>]*>/.exec(svg)?.[0];
  const W = Number(/ width="(\d+)"/.exec(head || '')?.[1]); const H0 = Number(/ height="(\d+)"/.exec(head || '')?.[1]);
  if (!head || !W || !H0) return svg;
  const colN = W >= 1000 ? 3 : 2;
  const cw = (W - 2 * PAD - (colN - 1) * GAP) / colN; const inW = cw - 2 * IN;
  const rows = [];
  for (let i = 0; i < views.length; i += colN) {
    const row = views.slice(i, i + colN).map((v) => ({ id: v.id, lines: tileLines(v, pal, inW) }));
    row.forEach((t) => { t.h = IN * 2 + t.lines.reduce((a, l) => a + (l.size > SIZE ? l.size * 1.3 : LH) + l.gap, 0); });
    rows.push({ tiles: row, h: Math.max(...row.map((t) => t.h)) });
  }
  let y = H0 + 10; let body = `<!--cut:${y}-->`;
  for (const r of rows) {
    r.tiles.forEach((t, j) => {
      const x = PAD + j * (cw + GAP); const left = rtl ? x + cw - IN : x + IN;
      let ty = y + IN; let inner = `<rect x="${x}" y="${y}" width="${cw}" height="${r.h}" rx="10" fill="${pal.card}"/>`;
      for (const l of t.lines) {
        ty += l.gap + (l.size > SIZE ? l.size * 1.1 : SIZE + 1);
        inner += `<text x="${left}" y="${ty}" font-size="${l.size}"${l.bold ? ' font-weight="700"' : ''} fill="${l.color}" text-anchor="${rtl ? 'end' : 'start'}"><tspan>${esc(l.text)}</tspan></text>`;
        ty += l.size > SIZE ? l.size * 0.2 : LH - SIZE - 1;
      }
      body += `<g data-tile="${esc(t.id)}" data-y="${Math.floor(y)}" data-b="${Math.ceil(y + r.h)}">${inner}</g>`;
    });
    y += r.h + GAP; body += `<!--cut:${Math.floor(y - GAP / 2)}-->`;
  }
  const H = Math.ceil(y + 10);
  const root = head.replace(/viewBox="[^"]*"/, `viewBox="0 0 ${W} ${H}"`).replace(/ height="\d+"/, ` height="${H}"`);
  const grown = `<rect x="0" y="${H0}" width="${W}" height="${H - H0}" fill="${pal.page}"/>${body}`;
  return root + svg.slice(head.length).replace(/<\/svg>\s*$/, `${grown}</svg>`);
}

// Cuts a tall infographic into pages of at most maxH, at its <!--cut:y--> marks (a page with no mark in reach is cut at maxH). Each page is the same
// picture seen through a window (viewBox) that shows only the tiles inside it; every tile is on exactly one page. A picture within maxH is returned as is.
export function splitInfographic(svg, maxH = MAX_PAGE_H) {
  const head = /^<svg [^>]*>/.exec(svg)?.[0];
  const box = /viewBox="0 0 (\d+) (\d+)"/.exec(head || '');
  const clean = (x) => x.replace(/<!--cut:\d+-->/g, '');
  if (!box) return [clean(svg)];
  const W = Number(box[1]); const H = Number(box[2]);
  if (H <= maxH) return [clean(svg)];
  const points = [...new Set([...svg.matchAll(/<!--cut:(\d+)-->/g)].map((x) => Number(x[1])))].filter((c) => c > 0 && c < H).sort((a, b) => a - b);
  const windows = []; let start = 0;
  while (H - start > maxH) {
    const fit = points.filter((c) => c > start && c - start <= maxH);
    const cut = fit.length ? fit[fit.length - 1] : start + maxH;
    windows.push([start, cut]); start = cut;
  }
  windows.push([start, H]);
  const tileRe = /<g data-tile="[^"]*" data-y="(\d+)" data-b="(\d+)">.*?<\/g>/g;
  return windows.map(([y0, y1]) => {
    const h = y1 - y0;
    const root = head.replace(/viewBox="[^"]*"/, `viewBox="0 ${y0} ${W} ${h}"`).replace(/ height="\d+"/, ` height="${h}"`);
    const inner = svg.slice(head.length).replace(tileRe, (g, ty, tb) => (Number(tb) > y0 && Number(ty) < y1 ? g : ''));
    return clean(root + inner);
  });
}
