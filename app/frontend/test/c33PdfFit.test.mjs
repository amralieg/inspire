// C33 (REQ-560): the agent PDF must fit the 8 MiB /api/inspire/docs/save takes. Live, the brief PDF of 40 use cases (a 168 use case run) was
// refused with "The file is over 8 MB, the most that can be saved", so the run had no PDF. D5: buildAgentPdf writes an over-cap PDF as a vector PDF
// (shapes and real text, pdfLayout.js + pdfDoc.pdfFromVectorPages), and says why when even that does not fit.
// The first tests use a stand-in rasterizer and layout; the last draws the recorded NYC Taxi strategy PDF in a headless browser.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import * as agentPdf from '../src/lib/docgen/agentPdf.js';

const { buildAgentPdf, agentPdfSvgs } = agentPdf;
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const require = createRequire(import.meta.url);
const show = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'app/backend/showcase/kinds-retail.json.gz'))));
const rows = Object.entries(show.inspire).find(([k]) => k.startsWith('GET /api/inspire/results?'))[1].body.results.domains.flatMap((d) => d.use_cases);
const ARGS = { businessName: 'Retail', useCases: rows, values: {}, language: 'English', date: '2026-11-27', foundations: [], summary: ['Retail sells through stores and the web.'] };
const CAP = 8 * 1024 * 1024;
// The text a viewer extracts: every Flate stream inflated, the (...) strings of its Tj operators joined.
const pdfText = (bytes) => {
  const raw = Buffer.from(bytes).toString('latin1'); const out = [];
  for (let at = raw.indexOf('stream\n'); at >= 0; at = raw.indexOf('stream\n', at + 7)) {
    const end = raw.indexOf('endstream', at); const body = Buffer.from(raw.slice(at + 7, end), 'latin1');
    let t = ''; try { t = zlib.inflateSync(body).toString('latin1'); } catch { continue; }
    for (const m of t.matchAll(/\(((?:\\.|[^\\)])*)\) Tj/g)) out.push(m[1].replace(/\\([()\\])/g, '$1'));
  }
  return out.join('\n');
};
const PAGES = agentPdfSvgs(ARGS).length;

// Each page costs perPage bytes at scale 2.1, and (scale / 2.1)^2 of that at another scale. The bytes are JPEG-typed so the page goes in as is.
const rasterOf = (perPage, scales) => async (svg, scale = 1, { type = 'image/png' } = {}) => {
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg) || [];
  if (type === 'image/png') return { dataUrl: 'data:image/png;base64,AAAA', type, width: Math.round(w * scale), height: Math.round(h * scale) };
  scales.add(scale);
  const n = Math.max(16, Math.round(perPage * (scale / 2.1) ** 2));
  const bytes = Buffer.alloc(n, 0x41);
  return { dataUrl: `data:image/jpeg;base64,${bytes.toString('base64')}`, type: 'image/jpeg', width: Math.round(w * scale), height: Math.round(h * scale) };
};

test('C33: the PDF cap the browser fits is the cap the save route enforces', () => {
  assert.equal(agentPdf.PDF_MAX_BYTES, require('../../backend/lib/docFiles.js').DOC_MAX_BYTES);
  assert.equal(agentPdf.PDF_MAX_BYTES, CAP);
});

// A layout stand-in: one text line per page, so the vector PDF has text a viewer can extract.
const layoutOf = (calls) => async (svg) => {
  calls.push(svg.length);
  return { w: 794, h: 1123, ops: [{ t: 'rect', x: 0, y: 0, w: 794, h: 1123, r: 0, fill: { r: 255, g: 255, b: 255, a: 1 }, stroke: null }, { t: 'text', x: 40, y: 80, size: 13, text: 'Vector page text', bold: false, italic: false, serif: false, color: { r: 0, g: 0, b: 0, a: 1 }, width: 120, natural: 110, spacing: 0 }] };
};

test('C33 D5 (must-fail before): a PDF that would be 1.8 times the save cap at 200 DPI is written as a vector PDF that fits the cap', async () => {
  assert.ok(PAGES > 10, `the PDF has ${PAGES} pages`);
  const scales = new Set(); const calls = [];
  const bytes = await buildAgentPdf(ARGS, rasterOf(Math.round((CAP * 1.8) / PAGES), scales), { layout: layoutOf(calls) });
  assert.ok(bytes.length <= CAP, `the PDF is ${bytes.length} bytes, over the ${CAP} the save route takes`);
  assert.equal(calls.length, PAGES, 'every page was read as vectors');
  assert.deepEqual([...scales], [2.1], 'no page was drawn again at a lower scale');
  assert.equal(new TextDecoder('latin1').decode(bytes.subarray(0, 8)), '%PDF-1.4');
  assert.equal(pdfText(bytes).split('Vector page text').length - 1, PAGES, 'the text of every page is in the file as text');
});

test('C33 (must-keep): a PDF under the cap is drawn once, at 200 DPI', async () => {
  const scales = new Set();
  const bytes = await buildAgentPdf(ARGS, rasterOf(Math.round((CAP * 0.5) / PAGES), scales));
  assert.deepEqual([...scales], [2.1]);
  assert.ok(bytes.length < CAP);
});

test('C33 (must-fail): a PDF that does not fit even as vectors is refused with the reason, before any save', async () => {
  const scales = new Set();
  await assert.rejects(buildAgentPdf(ARGS, rasterOf(Math.round((CAP * 6) / PAGES), scales), { layout: layoutOf([]), maxBytes: 2000 }), (e) => {
    assert.match(e.message, new RegExp(`^The PDF of ${rows.length} use cases is [\\d.]+ MB, over the 0\\.0 MB that can be saved\\. Pick fewer use cases\\.$`));
    return true;
  });
  await assert.rejects(buildAgentPdf(ARGS, rasterOf(Math.round((CAP * 6) / PAGES), scales)), /Pick fewer use cases/, 'with no layout (outside a browser) the over-cap PDF is refused');
});

test('C33 D5 (must-fail before): the recorded NYC Taxi strategy PDF, drawn by the App in a browser, is under 8 MiB and its text can be extracted', { timeout: 600000 }, async () => {
  const { chromium } = require('playwright');
  const { pdfArgs, pageRasterize, pageLayout } = await import('../../scripts/showcasePdfs.mjs');
  const { groupByObjective } = await import('../src/lib/strategyDoc.js');
  const nyc = JSON.parse(zlib.gunzipSync(fs.readFileSync(path.join(ROOT, 'app/backend/showcase/nyctaxi.json.gz'))));
  const args = { ...(await pdfArgs(nyc)), groups: groupByObjective, groupLabelKey: 'objective_label' };
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const bytes = Buffer.from(await buildAgentPdf(args, pageRasterize(page), { maxBytes: CAP / 4, layout: await pageLayout(await browser.newPage()) }));
    assert.ok(bytes.length < CAP / 4, `the PDF is ${bytes.length} bytes`);
    const text = pdfText(bytes);
    assert.match(text, /NYC|Taxi/i, 'the business name is text in the PDF');
    for (const u of args.useCases.slice(0, 3)) assert.ok(text.includes(String(u.name || u.Name).slice(0, 18)), `the use case "${String(u.name || u.Name)}" is text in the PDF`);
  } finally { await browser.close(); }
});
