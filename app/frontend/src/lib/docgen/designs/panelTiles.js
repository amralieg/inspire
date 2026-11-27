// REQ-561: one tile per use case under the infographic, with every business section of the side panel (the agent card view) and the value with a one-line story.
// No table, filter, SQL, notebook path or foundation is ever drawn here. Pure SVG strings; works for the design and the older themes alike.
import { esc, wrap, textW, mix } from './core.js';

// C26 (REQ-563): each use case is a one-glance card at two per A4 row: rank and name, domain, the value as the hero, chips for quality and score,
// then the side panel business fields as short labelled blocks (12-13px, bold uppercase labels, space between blocks).
const PAD = 40; const GAP = 20; const IN = 18;
const TITLE = 17; const HERO = 26; const SMALL = 12; const BODY = 13; const BLH = 18; const SLH = 16; const BLOCK = 12;

// The tile of one use case: its height for a width, and a drawing function for a position and a row height.
function tile(v, pal, cw, rtl) {
  const inW = cw - 2 * IN; const ops = []; let y = IN;
  const anchor = rtl ? 'end' : 'start';
  const tx = (x) => (rtl ? x + cw - IN : x + IN);
  const text = (lines, o, lh) => {
    lines.forEach((l, i) => {
      const yy = y + i * lh + o.size;
      ops.push((x, y0) => `<text x="${tx(x)}" y="${y0 + yy}" font-size="${o.size}"${o.bold ? ' font-weight="700"' : ''} fill="${o.color}" text-anchor="${anchor}"${o.ls ? ` letter-spacing="${o.ls}"` : ''}>${typeof l === 'string' ? `<tspan>${esc(l)}</tspan>` : l.map(([t, b]) => `<tspan${b ? ' font-weight="700"' : ''}>${esc(t)}</tspan>`).join('')}</text>`);
    });
    y += lines.length * lh;
  };
  const para = (str, o, lh) => text(wrap(String(str ?? ''), inW, o.size, 'sans', o.bold ? 700 : 400), o, lh);
  // Rank and name (the whole name is also the tile's <title> so it can be found whole when it wraps).
  para(`${v.rank}. ${v.title}`, { size: TITLE, bold: true, color: pal.ink }, 22);
  y += 2;
  const where = [v.domain, v.subdomain].filter(Boolean).join(' \u00B7 ');
  if (where) { para(where, { size: SMALL, color: pal.muted }, SLH); }
  // The value a year as the hero.
  const val = v.value || {};
  y += 10;
  if (val.amount != null) {
    para(val.text, { size: HERO, bold: true, color: pal.accent }, 32);
    if (val.story) para(val.story, { size: SMALL, color: pal.muted }, SLH);
  } else para(val.text || '', { size: 15, bold: true, color: pal.muted }, 20);
  // Chips: quality and Inspire score, and the star.
  const chips = [];
  for (const [key, label, value] of v.metrics || []) if (key === 'quality' || key === 'inspire_score') chips.push(`${label}: ${value}`);
  if (v.star) chips.push(v.star);
  if (chips.length) {
    y += 10; let cx = 0; let row = 0; const CH = 24; const place = [];
    for (const c of chips) {
      const w = Math.ceil(textW(c, SMALL, 'sans', 400) * 0.88 + 18);
      if (cx && cx + w > inW) { cx = 0; row++; }
      place.push([c, cx, row, w]); cx += w + 8;
    }
    const y0 = y;
    for (const [c, px, r, w] of place) {
      ops.push((x, yt) => {
        const rx = rtl ? x + cw - IN - px - w : x + IN + px; const ry = yt + y0 + r * (CH + 6);
        return `<rect x="${rx}" y="${ry}" width="${w}" height="${CH}" rx="12" fill="${mix(pal.accent, pal.card, 0.82)}"/><text x="${rx + w / 2}" y="${ry + 16}" font-size="${SMALL}" fill="${pal.ink}" text-anchor="middle"><tspan>${esc(c)}</tspan></text>`;
      });
    }
    y += (row + 1) * (CH + 6) - 6;
  }
  y += 12;
  const ly = y - 4;
  ops.push((x, y0) => `<line x1="${x + IN}" y1="${y0 + ly}" x2="${x + cw - IN}" y2="${y0 + ly}" stroke="${mix(pal.muted, pal.card, 0.7)}" stroke-width="1"/>`);
  y += 6;
  const label = (l) => { text([String(l).toUpperCase()], { size: SMALL, bold: true, color: pal.accent, ls: 0.6 }, SLH); y += 2; };
  for (const [, l, str] of v.narrative || []) {
    if (!String(str ?? '').trim()) continue;
    label(l); para(str, { size: BODY, color: pal.body }, BLH); y += BLOCK;
  }
  // Facts: one line each as "Label: value" with the label in bold.
  for (const [, l, str] of v.facts || []) {
    if (!String(str ?? '').trim()) continue;
    const full = `${l}: ${str}`; const lines = wrap(full, inW, BODY, 'sans', 400);
    text(lines.map((ln, i) => (i === 0 && ln.startsWith(`${l}:`) ? [[`${l}:`, true], [ln.slice(l.length + 1), false]] : ln)), { size: BODY, color: pal.body }, BLH);
    y += 2;
  }
  y += 8;
  for (const [, l, items] of v.valueFacts || []) {
    const list = (items || []).map((i) => String(i ?? '').trim()).filter(Boolean);
    if (!list.length) continue;
    label(l); list.forEach((i) => { para(i, { size: BODY, color: pal.body }, BLH); y += 4; }); y += BLOCK - 4;
  }
  const h = Math.ceil(y - BLOCK + IN);
  const title = `${v.rank}. ${v.title}`;
  return { id: v.id, h, draw: (x, y0, rowH) => `<rect x="${x}" y="${y0}" width="${cw}" height="${rowH}" rx="12" fill="${pal.card}"/><title>${esc(title)}</title>${ops.map((f) => f(x, y0, rowH)).join('')}` };
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
  const cw = (W - 2 * PAD - (colN - 1) * GAP) / colN;
  const rows = [];
  for (let i = 0; i < views.length; i += colN) {
    const row = views.slice(i, i + colN).map((v) => tile(v, pal, cw, rtl));
    rows.push({ tiles: row, h: Math.max(...row.map((t) => t.h)) });
  }
  let y = H0 + 10; let body = `<!--cut:${y}-->`;
  for (const r of rows) {
    r.tiles.forEach((t, j) => {
      const x = PAD + j * (cw + GAP);
      body += `<g data-tile="${esc(t.id)}" data-y="${Math.floor(y)}" data-b="${Math.ceil(y + r.h)}">${t.draw(x, y, r.h)}</g>`;
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
