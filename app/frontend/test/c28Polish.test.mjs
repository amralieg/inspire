// C28 (REQ-564) polish: the PDF index table fits its ID and domain cells, and the Word matrix chart has its dots.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentPdfPages, linesOf } from '../src/lib/docgen/agentPdf.js';
import { buildAgentModel } from '../src/lib/docgen/agentModel.js';
import { buildDocx } from '../src/lib/docgen/docxDoc.js';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { ARGS, flat } from './c27x_fixture.mjs';

const CW = 680; // the PDF content width (agentPdf.js)
const pages = agentPdfPages(ARGS);
const idx = pages.filter((p) => /data-section="index"|class="index"/.test(p.svg)).map((p) => p.svg).join('\n');
const rows = [...idx.matchAll(/<tr><td class="ix-rank">[\s\S]*?<\/tr>/g)].map((m) => m[0]);
const cell = (r, k) => flat((r.match(new RegExp(`<td class="ix-${k}">([\\s\\S]*?)</td>`)) || [])[1] || '');
const colPct = [...idx.matchAll(/<col style="width:([\d.]+)%"\/>/g)].map((m) => Number(m[1]));

test('P1: every index row ID fits its column on one line', () => {
  assert.ok(rows.length >= 10, `index rows (${rows.length})`);
  const wId = CW * colPct[1] / 100 - 12;
  for (const r of rows) assert.equal(linesOf(cell(r, 'id'), 12, wId, { bold: true }), 1, `ID "${cell(r, 'id')}" fits ${wId.toFixed(0)}px`);
});
test('P2: no domain cell breaks inside a word (each word fits the column alone)', () => {
  const wDom = CW * colPct[3] / 100 - 12;
  for (const r of rows) for (const w of cell(r, 'domain').split(' ')) assert.equal(linesOf(w, 12, wDom), 1, `"${w}" fits ${wDom.toFixed(0)}px`);
  assert.match(idx, /table\.index td\.ix-domain \{[^}]*overflow-wrap:\s*normal/, 'domain cells never break mid-word');
});
test('P3: the Word matrix chart has one dot per scored use case', async () => {
  const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
  const seen = [];
  const m = buildDocModel({ ...ARGS, options: defaultDocOptions('English') });
  const views = buildAgentModel(ARGS).ranked;
  await buildDocx(m, resolveTheme('original', 'databricks', '', 'light'), { chartPng: async (svg) => { seen.push(svg); return new Uint8Array(PNG); }, views });
  const matrix = seen.find((s) => /data-chart="matrix"/.test(s));
  assert.ok(matrix, 'a matrix chart');
  const scored = views.filter((v) => Number.isFinite(Number(v.metrics?.[1]?.[2])) || true).length;
  const dots = (matrix.match(/<circle/g) || []).length;
  assert.ok(dots >= 10, `dots in the Word matrix: ${dots}`);
  const pdfMatrix = pages.map((p) => p.svg).join('').match(/data-chart="matrix"[\s\S]*?<\/svg>/)[0];
  assert.equal(dots, (pdfMatrix.match(/<circle/g) || []).length, 'same dots as the PDF matrix');
});
