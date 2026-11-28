// C33 (REQ-560): the agent PDF must fit the 8 MiB /api/inspire/docs/save takes. Live, the brief PDF of 40 use cases (a 168 use case run) was
// refused with "The file is over 8 MB, the most that can be saved", so the run had no PDF. buildAgentPdf now draws an over-cap PDF again at the
// resolution that fits, never below PDF_MIN_SCALE, and says why when even that does not fit.
// The rasterizer is a stand-in whose page bytes grow with the raster area (scale squared), like a drawn page does.
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

test('C33 (must-fail before): a PDF that would be 1.8 times the save cap at 200 DPI is drawn again at a lower resolution and fits the cap', async () => {
  assert.ok(PAGES > 10, `the PDF has ${PAGES} pages`);
  const scales = new Set();
  const bytes = await buildAgentPdf(ARGS, rasterOf(Math.round((CAP * 1.8) / PAGES), scales));
  assert.ok(bytes.length <= CAP, `the PDF is ${bytes.length} bytes, over the ${CAP} the save route takes`);
  assert.ok(bytes.length > CAP * 0.6, `the PDF keeps as much resolution as fits (${bytes.length} bytes)`);
  assert.ok([...scales].some((s) => s < 2.1 && s >= agentPdf.PDF_MIN_SCALE), `drawn again at ${[...scales].join(', ')}`);
  assert.equal(new TextDecoder('latin1').decode(bytes.subarray(0, 8)), '%PDF-1.4');
});

test('C33 (must-keep): a PDF under the cap is drawn once, at 200 DPI', async () => {
  const scales = new Set();
  const bytes = await buildAgentPdf(ARGS, rasterOf(Math.round((CAP * 0.5) / PAGES), scales));
  assert.deepEqual([...scales], [2.1]);
  assert.ok(bytes.length < CAP);
});

test('C33 (must-fail): a PDF that does not fit even at the lowest resolution is refused with the reason, before any save', async () => {
  const scales = new Set();
  await assert.rejects(buildAgentPdf(ARGS, rasterOf(Math.round((CAP * 6) / PAGES), scales)), (e) => {
    assert.match(e.message, new RegExp(`^The PDF of ${rows.length} use cases is [\\d.]+ MB even at the lowest print quality, over the 8\\.0 MB that can be saved\\. Pick fewer use cases\\.$`));
    return true;
  });
  assert.ok(scales.has(agentPdf.PDF_MIN_SCALE), `tried the lowest resolution (${[...scales].join(', ')})`);
});
