// C28 (REQ-566): the documents are crisp and no text overlaps. (a) every raster in the PDF, the infographic PDF and the Word file has
// >= 200 DPI at its printed size; (b) no two text boxes of any page / chart / tile intersect and no text leaves its card; (c) the
// strategy PDF stays under 4,000,000 bytes. The PPTX deck draws everything as shapes and text (no raster), checked below.
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { chromium } from 'playwright';
import { buildAgentPdf, agentPdfSvgs } from '../src/lib/docgen/agentPdf.js';
import { buildAgentPptx } from '../src/lib/docgen/agentPptx.js';
import { buildDocx } from '../src/lib/docgen/docxDoc.js';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { buildAgentModel } from '../src/lib/docgen/agentModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { infographicSvg } from '../src/lib/docgen/docSvg.js';
import { splitInfographic } from '../src/lib/docgen/designs/panelTiles.js';
import { portfolioChartSvg, ucChartSvg, chartTypesFor } from '../src/lib/docgen/designs/ucCharts.js';
import * as GD from '../src/lib/generateDocs.js';
import { ARGS, ROWS } from './c27x_fixture.mjs';

const DPI = 200 / 72; // raster pixels per printed point
const rasterOf = (page) => async (svg, scale = 1, { type = 'image/png', quality } = {}) => {
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg) || [];
  const dataUrl = await page.evaluate(async ([s, k, t, q]) => {
    const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(s) || [];
    const img = new Image();
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`; });
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(t, q);
  }, [svg, scale, type, quality]);
  return { dataUrl, type, width: Math.round(w * scale), height: Math.round(h * scale), bytes: Uint8Array.from(Buffer.from(dataUrl.split(',')[1], 'base64')) };
};

// Every image of a jsPDF file against the size of the page it fills (the objects' dictionaries are plain text).
function pdfImageDpis(bytes) {
  const s = Buffer.from(bytes).toString('latin1');
  const boxes = [...s.matchAll(/\/MediaBox \[0 0 ([\d.]+) ([\d.]+)\]/g)].map((m) => Number(m[1]));
  const imgs = [...s.matchAll(/\/Type \/XObject\s*\/Subtype \/Image\s*\/Width (\d+)/g)].map((m) => Number(m[1]));
  assert.ok(imgs.length > 0 && imgs.length === boxes.length, `${imgs.length} images on ${boxes.length} pages`);
  return imgs.map((px, i) => (px / boxes[i]) * 72);
}

let browser; let page;
test.before(async () => { browser = await chromium.launch({ headless: true }); page = await browser.newPage(); });
test.after(async () => { await browser.close(); });

test('a1: the strategy PDF has >= 200 DPI on every page, and stays under 4,000,000 bytes (c)', async () => {
  const bytes = await buildAgentPdf(ARGS, rasterOf(page));
  const dpis = pdfImageDpis(bytes);
  assert.ok(Math.min(...dpis) >= 199.5, `lowest page is ${Math.min(...dpis).toFixed(0)} DPI`);
  console.log('strategy pdf bytes', bytes.length, 'min dpi', Math.min(...dpis).toFixed(0));
  assert.ok(bytes.length < 4000000, `PDF is ${bytes.length} bytes`);
});

test('a2: the infographic PDF has >= 200 DPI on every page', async () => {
  const options = defaultDocOptions('English');
  const m = GD.modelFor({ businessName: 'Retail', useCases: ROWS, values: {}, options, language: 'English', ids: ARGS.useCases.map((r) => String(r.No)), translated: null, summary: ARGS.summary, foundations: [] });
  const bytes = await GD.infographicPdf(m, resolveTheme('original', 'databricks', '', 'light'), ARGS, rasterOf(page));
  const dpis = pdfImageDpis(bytes);
  assert.ok(Math.min(...dpis) >= 199.5, `lowest page is ${Math.min(...dpis).toFixed(0)} DPI`);
});

test('a3: every chart picture in the Word file has >= 200 DPI at its printed width', async () => {
  const theme = resolveTheme('original', 'databricks', '', 'light');
  const m = buildDocModel({ businessName: ARGS.businessName, useCases: ROWS, values: {}, options: defaultDocOptions('English'), summary: ARGS.summary, foundations: [] });
  const scale = GD.DOCX_RASTER_SCALE ?? 2; const draw = rasterOf(page);
  const docx = await buildDocx(m, theme, { chartPng: async (svg) => (await draw(svg, scale)).bytes, views: buildAgentModel(ARGS).ranked });
  const zip = await JSZip.loadAsync(docx);
  const xml = await zip.file('word/document.xml').async('string');
  const rels = await zip.file('word/_rels/document.xml.rels').async('string');
  const pics = [...xml.matchAll(/<wp:extent cx="(\d+)"[\s\S]*?<a:blip r:embed="([^"]+)"/g)];
  assert.ok(pics.length > 10, `${pics.length} pictures`);
  const bad = [];
  for (const [, cx, rid] of pics) {
    const target = new RegExp(`Id="${rid}"[^>]*Target="([^"]+)"|Target="([^"]+)"[^>]*Id="${rid}"`).exec(rels);
    const buf = await zip.file(`word/${target[1] || target[2]}`).async('nodebuffer');
    const pts = (Number(cx) / 914400) * 72; const px = buf.readUInt32BE(16);
    if (px / pts < DPI - 0.01) bad.push(`${(px / pts * 72 / 1).toFixed(0)} DPI`);
  }
  assert.deepEqual(bad, [], `${bad.length} of ${pics.length} pictures under 200 DPI`);
});

test('a4: the PPTX deck embeds no raster picture (everything is shapes and text, so it never blurs)', async () => {
  const zip = await JSZip.loadAsync(await buildAgentPptx(ARGS));
  assert.deepEqual(Object.keys(zip.files).filter((f) => /^ppt\/media\/./.test(f)), []);
});

// ---- (b) overlap: lay each SVG out in Chromium and compare the boxes of its text ----
const MEASURE = () => {
  const out = []; const root = document.getElementById('host');
  // the glyph box of a line: its line box cut to 0.95 em (the ink plus its descenders), so the empty leading of tall lines is not counted
  const box = (r, fs) => { const h = Math.min(r.height, fs * 0.95); return { x: r.left, y: r.top + (r.height - h) / 2, w: r.width, h }; };
  const cardOf = (el) => { for (let e = el.parentElement; e && e !== root; e = e.parentElement) {
    const cs = getComputedStyle(e); const r = e.getBoundingClientRect();
    if (r.width > 1000 || r.height > 1100) return null;
    const painted = cs.backgroundColor !== 'rgba(0, 0, 0, 0)' || parseFloat(cs.borderTopWidth) > 0 || parseFloat(cs.borderLeftWidth) > 0;
    if (painted && cs.overflow === 'visible' && r.width > 20 && r.height > 12) return r; } return null; };
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const t = n.nodeValue.trim(); if (!t) continue;
    const el = n.parentElement; if (el.closest('style, defs')) continue;
    if (el.closest('svg') && !el.closest('foreignObject')) continue; // svg text below
    const rg = document.createRange(); rg.selectNodeContents(n);
    const rects = [...rg.getClientRects()].filter((r) => r.width > 1 && r.height > 1);
    const card = cardOf(el);
    const fs = parseFloat(getComputedStyle(el).fontSize) || 12;
    rects.forEach((r) => out.push({ t: t.slice(0, 40), ...box(r, fs), card: card ? { x: card.left, y: card.top, w: card.width, h: card.height } : null }));
  }
  root.querySelectorAll('text').forEach((el) => { if (el.closest('foreignObject')) return; const t = el.textContent.trim(); if (!t) return;
    const r = el.getBoundingClientRect(); if (r.width > 1 && r.height > 1) out.push({ t: t.slice(0, 40), ...box(r, parseFloat(getComputedStyle(el).fontSize) || 12), card: null }); });
  return out;
};
const problems = (texts) => {
  const bad = []; const inter = (a, b) => Math.max(0, Math.min(a.x + a.w, b.x + b.w) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.h, b.y + b.h) - Math.max(a.y, b.y));
  for (let i = 0; i < texts.length; i++) for (let j = i + 1; j < texts.length; j++) {
    const a = texts[i]; const b = texts[j]; const ov = inter(a, b);
    // 5% of the smaller glyph box: anti-aliasing and hinting move a glyph edge by a pixel without the glyphs meeting
    if (ov > 4 && ov > 0.05 * Math.min(a.w * a.h, b.w * b.h)) bad.push(`overlap "${a.t}" x "${b.t}"`);
  }
  for (const a of texts) if (a.card) { const c = a.card; if (a.x < c.x - 1.5 || a.y < c.y - 1.5 || a.x + a.w > c.x + c.w + 1.5 || a.y + a.h > c.y + c.h + 1.5) bad.push(`outside card "${a.t}"`); }
  return bad;
};
async function check(svg, w, h) {
  await page.setViewportSize({ width: Math.max(w, 100) + 40, height: Math.max(h, 100) + 40 });
  await page.setContent(`<html><body style="margin:0"><div id="host" style="position:absolute;left:0;top:0">${svg}</div></body></html>`);
  return problems(await page.evaluate(MEASURE));
}
const dimsOf = (svg) => { const m = /width="(\d+)" height="(\d+)"/.exec(svg) || []; return [Number(m[1]) || 600, Number(m[2]) || 400]; };

test('b1: no two texts overlap and no text leaves its card on any strategy PDF page', async () => {
  const svgs = agentPdfSvgs(ARGS); const bad = [];
  for (const [i, svg] of svgs.entries()) for (const p of await check(svg, ...dimsOf(svg))) bad.push(`pdf p${i + 1}: ${p}`);
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} problems`);
});

test('b2: no overlap in the infographic tiles', async () => {
  const theme = resolveTheme('original', 'databricks', '', 'light');
  const m = buildDocModel({ businessName: ARGS.businessName, useCases: ROWS, values: {}, options: defaultDocOptions('English'), summary: ARGS.summary, foundations: [] });
  const bad = [];
  for (const [i, svg] of splitInfographic(infographicSvg(m, theme, buildAgentModel(ARGS).ranked)).entries()) for (const p of await check(svg, ...dimsOf(svg))) bad.push(`tile ${i + 1}: ${p}`);
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} problems`);
});

test('b3: no overlap in any Word chart', async () => {
  const views = buildAgentModel(ARGS).ranked; const bad = [];
  const m = buildDocModel({ businessName: ARGS.businessName, useCases: ROWS, values: {}, options: defaultDocOptions('English'), summary: ARGS.summary, foundations: [] });
  const charts = ['domain-value', 'matrix'].map((t) => [t, portfolioChartSvg(t, views, { w: 560, h: 290 })]);
  for (const u of m.useCases) for (const t of (chartTypesFor(u) || []).slice(0, 2)) charts.push([`${u.id} ${t}`, ucChartSvg(t, u, { w: 560, h: 250 })]);
  for (const [name, svg] of charts) for (const p of await check(svg, ...dimsOf(svg))) bad.push(`${name}: ${p}`);
  assert.deepEqual(bad.slice(0, 20), [], `${bad.length} problems`);
});
