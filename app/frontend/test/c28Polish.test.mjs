// C28 (REQ-563, REQ-564): document polish. Index ids fit, no mid-word breaks in the index, the Word priority matrix has its dots,
// and no data chart in the PDF, Word or infographic is empty. Fails on e82890e99.
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { agentPdfPages, linesOf, PDF_INDEX_W } from '../src/lib/docgen/agentPdf.js';
import { buildAgentModel, DOC_INDEX_COLUMNS } from '../src/lib/docgen/agentModel.js';
import { buildDocx } from '../src/lib/docgen/docxDoc.js';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { infographicSvg } from '../src/lib/docgen/docSvg.js';
import { splitInfographic } from '../src/lib/docgen/designs/panelTiles.js';
import { portfolioChartSvg } from '../src/lib/docgen/designs/ucCharts.js';
import { ARGS } from './c27x_fixture.mjs';

const CW = 680; const SMALL = 12; // the PDF's content width and its small text size (agentPdf.js)
const am = buildAgentModel(ARGS);
const colPx = (w) => CW * w - 12; // column width less the cell padding

test('P1: every index row\'s id fits its column on one line (bold, as printed)', () => {
  const idCol = ['id', null, PDF_INDEX_W.id];
  const bad = am.ranked.filter((v) => linesOf(v.id, SMALL, colPx(idCol[2]), { bold: true }) !== 1).map((v) => v.id);
  assert.deepEqual(bad, [], `ids wider than the ID column: ${bad.join(', ')}`);
});

test('P2: no index cell breaks inside a word (every word fits its column on one line)', () => {
  const texts = { title: (v) => v.title, domain: (v) => v.domain, quality: (v) => v.quality || '', id: (v) => v.id };
  const bad = [];
  for (const [k, , w0] of DOC_INDEX_COLUMNS) {
    const w = PDF_INDEX_W[k] ?? w0;
    if (!texts[k]) continue;
    for (const v of am.ranked) for (const word of String(texts[k](v)).split(/\s+/).filter(Boolean)) {
      if (linesOf(word, SMALL, colPx(w), { bold: k === 'id' }) !== 1) bad.push(`${k}:${word}`);
    }
  }
  assert.deepEqual([...new Set(bad)], [], `words that would break mid-word: ${[...new Set(bad)].join(' | ')}`);
});

const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==', 'base64');
const seen = [];
const m = buildDocModel({ ...ARGS, options: defaultDocOptions('English') });
const theme = resolveTheme('original', 'databricks', '', 'light');
await buildDocx(m, theme, { chartPng: async (svg) => { seen.push(svg); return new Uint8Array(PNG); }, views: am.ranked });
const svgsOf = (s) => [...String(s).matchAll(/<svg\b[^>]*\bdata-chart="[^"]+"[\s\S]*?<\/svg>/g)].map((x) => x[0]);
const marks = (svg) => (svg.match(/<(circle|path|polygon|polyline|ellipse)\b/g) || []).length + Math.max(0, (svg.match(/<rect\b/g) || []).length - 3);

test('P3: the Word purpose-page priority matrix has one dot per scored use case', () => {
  const mx = seen.find((s) => /data-chart="matrix"/.test(s));
  assert.ok(mx, 'a matrix chart was drawn for Word');
  const dots = (mx.match(/<circle\b/g) || []).length;
  const expected = (portfolioChartSvg('matrix', am.ranked, { w: 560, h: 290 }).match(/<circle\b/g) || []).length;
  assert.ok(expected > 0, 'the PDF matrix has dots');
  assert.equal(dots, expected, `Word matrix dots ${dots}, PDF matrix dots ${expected}`);
});

test('P4: no data chart in the PDF, Word or infographic is empty', () => {
  const pdf = agentPdfPages(ARGS).flatMap((p) => svgsOf(p.svg));
  const info = splitInfographic(infographicSvg(m, theme, am.ranked)).flatMap(svgsOf);
  const all = [['pdf', pdf], ['word', seen], ['info', info]];
  const empty = [];
  for (const [kind, list] of all) { assert.ok(list.length > 0, `${kind} has data charts`); for (const s of list) if (marks(s) === 0) empty.push(`${kind}:${(s.match(/data-chart="([^"]+)"/) || [])[1]}`); }
  assert.deepEqual(empty, [], `empty charts: ${empty.join(', ')}`);
});
