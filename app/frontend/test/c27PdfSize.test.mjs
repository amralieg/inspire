// C27 (RC7C-C-01): the strategy PDF the App saves after "Accept and save" must be small enough for /api/inspire/docs/save
// (the live App posted 30,295,924 bytes and got HTTP 413). The recorded demo (17 use cases) is built through the same raster
// path as the App: strategyDoc's buildAgentPdf(args, rasterize) with a rasterizer that draws each page SVG on a canvas.
// Node-side equivalent: headless Chromium (playwright) draws the SVG exactly as generateDocs.svgToPng does (Image + canvas, 2x scale),
// and honours the type and quality buildAgentPdf asks for.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import zlib from 'node:zlib';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { chromium } from 'playwright';
import { buildAgentPdf } from '../src/lib/docgen/agentPdf.js';
import { groupByObjective } from '../src/lib/strategyDoc.js';
import { infographicPdf, modelFor } from '../src/lib/generateDocs.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { trackingIdOf } from '../src/lib/useCaseFields.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..');
const show = JSON.parse(zlib.brotliDecompressSync(fs.readFileSync(path.join(ROOT, 'app/backend/showcase/kinds-retail.json.br'))));
const rows = show.inspire['GET /api/inspire/results?session_id=2001'].body.results.domains.flatMap((d) => d.use_cases);
const values = {};
rows.slice(0, 13).forEach((r, i) => {
  const amt = 500000 + i * 150000;
  values[r.No] = { amount: amt, currency: 'USD', status: 'calculated', verb: 'CUT COST', story: `Acting on ${String(r.Name).toLowerCase()} returns about ${Math.round(amt / 1e5) / 10}M a year.`,
    yearly: [1, 2, 3].map((year) => ({ year, low: amt * year * 0.25, likely: amt * year * 0.4, high: amt * year * 0.55 })),
    factors: [{ name: 'Margin kept', share: 0.6, formula: 'buyers kept x margin per buyer' }, { name: 'Cost avoided', share: 0.4, formula: 'calls avoided x cost per call' }] };
});
const ARGS = { businessName: 'Retail', useCases: rows, values, language: 'English', date: '2026-11-27', foundations: [], summary: ['Retail sells through stores and the web.', 'These use cases keep buyers and cut waste.'], groups: groupByObjective, groupLabelKey: 'objective_label' };

// Same drawing as generateDocs.svgToPng(svg, scale, { type, quality }): Image + canvas at `scale`, white page, encoded as asked.
const makeRasterize = (page) => async (svg, scale = 1, { type = 'image/png', quality } = {}) => {
  const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(svg) || [];
  const dataUrl = await page.evaluate(async ([s, k, t, q]) => {
    const [, w, h] = /width="(\d+)" height="(\d+)"/.exec(s) || [];
    const img = new Image();
    await new Promise((r, j) => { img.onload = r; img.onerror = j; img.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(s)}`; });
    const c = document.createElement('canvas'); c.width = Math.round(w * k); c.height = Math.round(h * k);
    const g = c.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, c.width, c.height); g.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL(t, q);
  }, [svg, scale, type, quality]);
  return { dataUrl, width: Math.round(w * scale), height: Math.round(h * scale), type };
};

test('RC7C-C-01: the strategy PDF of the recorded demo is under 4,000,000 bytes', async () => {
  assert.equal(rows.length, 17);
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const rasterize = makeRasterize(page);
    const bytes = await buildAgentPdf(ARGS, rasterize);
    console.log('strategy pdf bytes', bytes.length);
    if (process.env.C27_PDF_OUT) fs.writeFileSync(process.env.C27_PDF_OUT, bytes);
    assert.ok(bytes.length < 4000000, `PDF is ${bytes.length} bytes`);
    assert.ok(bytes.length > 100000, 'PDF has pages');
  } finally { await browser.close(); }
});

// Every PDF the App posts to /api/inspire/docs/save: the strategy PDF (strategyDoc.js saveStrategyDoc), and generateDocs.js makeFile kinds pdf
// (agent PDF, above) and infographic (this case). The other kinds saved there are pptx, docx and xlsx (not PDFs).
test('C27: the infographic PDF of the recorded demo is under 4,000,000 bytes', async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    const page = await browser.newPage();
    const options = defaultDocOptions('English');
    const ids = rows.map(trackingIdOf);
    const m = modelFor({ businessName: 'Retail', useCases: rows, values, options, language: 'English', ids, translated: null, summary: ARGS.summary, foundations: [] });
    const agent = { businessName: 'Retail', useCases: rows, values, summary: ARGS.summary, foundations: [], language: 'English', translated: null };
    const bytes = await infographicPdf(m, resolveTheme('original', 'databricks', '', 'light'), agent, makeRasterize(page));
    console.log('infographic pdf bytes', bytes.length);
    assert.ok(bytes.length < 4000000, `infographic PDF is ${bytes.length} bytes`);
    assert.ok(bytes.length > 50000, 'infographic PDF has pages');
  } finally { await browser.close(); }
});
