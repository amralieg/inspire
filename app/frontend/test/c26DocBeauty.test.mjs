// C26 (REQ-563): the downloaded documents read well for an executive: no empty "Not provided" rows, text big enough to read,
// pages and slides filled instead of half empty, no text printed twice, and a Word file with real headings and tables.
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { agentPdfPages } from '../src/lib/docgen/agentPdf.js';
import { buildAgentPptx } from '../src/lib/docgen/agentPptx.js';
import { buildAgentModel } from '../src/lib/docgen/agentModel.js';
import { infographicSvg } from '../src/lib/docgen/docSvg.js';
import { splitInfographic } from '../src/lib/docgen/designs/panelTiles.js';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { buildDocx } from '../src/lib/docgen/docxDoc.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';

const decode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const flat = (s) => decode(s.replace(/<style[\s\S]*?<\/style>/g, ' ').replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
const SOLUTION = 'A weekly planner proposes which units move between warehouses so every store keeps stock at the lowest freight cost.';
// A realistic use case: no strategic goals, no type and no value or feasibility score, as many real runs give.
const uc = (i) => ({
  No: `N0${i}-U01`, Name: `Rebalance stock across warehouses ${i}`, 'Business Domain': ['Supply chain', 'Finance', 'Marketing'][i % 3], Subdomain: 'Stock balancing',
  'Analytics Technique': 'Optimization', Statement: 'Moving 1,260 units between 6 warehouses saves $310K this week. One warehouse is almost full.',
  Solution: SOLUTION, 'Business Value': 'Fewer stockouts and less overstock: lost margin avoided plus holding cost saved. At stake: $310K this week.',
  Beneficiary: 'Supply planners', Sponsor: 'Head of Supply', Quality: 'Very High', 'Quality Score': 4.3, 'Inspire Score': 8.6 - i / 10, Priority: 8.6,
  serving_summary: SOLUTION.split(' so ')[0], method_summary: 'A solver picks the moves that cover forecast demand within warehouse capacity and truck slots.',
  KPIs: [{ name: 'Saving vs the current plan', direction: 'increase' }], best_of_best: i === 1 ? 'Y' : 'N', best_of_best_rank: '1',
});
const YEARS = [1, 2, 3].map((year) => ({ year, low: 300000 * year, likely: 500000 * year, high: 700000 * year }));
const value = () => ({ amount: 1380000, currency: 'USD', status: 'calculated', verb: 'CUT COST', story: 'Acting on the weekly plan returns about $1.4M a year.', yearly: YEARS,
  factors: [{ name: 'Margin kept', share: 0.6, formula: 'units kept in stock x margin per unit' }, { name: 'Cost avoided', share: 0.4, formula: 'transfers avoided x cost per transfer' }] });
const argsOf = (n) => {
  const useCases = Array.from({ length: n }, (_, i) => uc(i + 1));
  return { businessName: 'Acme Retail', useCases, values: Object.fromEntries(useCases.slice(0, n - 1).map((u) => [u.No, value()])), summary: ['Acme sells through stores and the web.', 'These use cases keep buyers and cut waste.'], foundations: [], language: 'English', date: '2026-11-27' };
};
const NOISE = ['Not provided', 'Not scored'];
const pxSizes = (svg) => [...svg.matchAll(/font-size\s*[:=]\s*"?([\d.]+)(px|pt)?/g)].map((m) => Number(m[1]) * (m[2] === 'pt' ? 4 / 3 : 1));
const slides = async (bytes) => {
  const zip = await JSZip.loadAsync(bytes);
  const names = Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n)).sort((a, b) => Number(/(\d+)\.xml/.exec(a)[1]) - Number(/(\d+)\.xml/.exec(b)[1]));
  return Promise.all(names.map(async (n) => zip.file(n).async('string')));
};
const theme = resolveTheme('original', 'databricks', '', 'light');
const docModelOf = (a) => buildDocModel({ businessName: a.businessName, useCases: a.useCases, values: a.values, options: { ...defaultDocOptions('English') }, summary: a.summary, foundations: [] });

test('(a) no document prints an empty "Not provided" or "Not scored" field, and no text twice on a use case page', async () => {
  const a = argsOf(4);
  const pdf = agentPdfPages(a);
  const pdfText = flat(pdf.map((p) => p.svg).join(' '));
  for (const w of NOISE) assert.ok(!pdfText.includes(w), `the PDF prints "${w}"`);
  for (const p of pdf.filter((x) => flat(x.svg).includes(SOLUTION))) assert.equal(flat(p.svg).split(SOLUTION).length - 1, 1, 'a PDF page prints the solution twice');
  const deck = (await slides(await buildAgentPptx(a))).map((x) => decode([...x.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((m) => m[1]).join(' ')));
  for (const w of NOISE) assert.ok(!deck.join(' ').includes(w), `the deck prints "${w}"`);
  for (const s of deck) assert.ok(s.split(SOLUTION).length - 1 <= 1, 'a slide prints the solution twice');
  const info = flat(infographicSvg(docModelOf(a), theme, buildAgentModel(a).ranked));
  for (const w of NOISE) assert.ok(!info.includes(w), `the infographic prints "${w}"`);
  const docx = flat(await (await JSZip.loadAsync(await buildDocx(docModelOf(a), theme))).file('word/document.xml').async('string'));
  for (const w of NOISE) assert.ok(!docx.includes(w), `the Word file prints "${w}"`);
});

test('(b) PDF: no text below 11px (8pt) on an A4 page, and every page but the cover and the last is at least 55% filled', () => {
  const pdf = agentPdfPages(argsOf(6));
  for (const [i, p] of pdf.entries()) {
    const small = pxSizes(p.svg).filter((s) => s < 11);
    assert.equal(small.length, 0, `PDF page ${i + 1} (${p.kind}) has text at ${[...new Set(small)].join(', ')}px`);
  }
  for (const [i, p] of pdf.entries()) {
    if (i === 0 || i === pdf.length - 1) continue;
    assert.ok(p.used / p.room >= 0.55, `PDF page ${i + 1} (${p.kind}) is only ${Math.round((100 * p.used) / p.room)}% filled`);
  }
});

test('(c) PPTX: body text is at least 14pt, nothing below 12pt, and a use case takes at most two slides (its card and its value story)', async () => {
  const a = argsOf(6);
  const xs = await slides(await buildAgentPptx(a));
  const sizes = xs.flatMap((x) => [...x.matchAll(/ sz="(\d+)"/g)].map((m) => Number(m[1])));
  assert.ok(sizes.every((s) => s >= 1200), `the deck has text below 12pt: ${[...new Set(sizes.filter((s) => s < 1200))].join(', ')}`);
  assert.ok(sizes.filter((s) => s >= 1400).length / sizes.length >= 0.9, 'less than 90% of the deck text is 14pt or more');
  for (const u of a.useCases) {
    const own = xs.filter((x) => decode(x).includes(u.Name));
    assert.ok(own.length <= 2, `${u.Name} takes ${own.length} slides`);
  }
});

test('(d) infographic: no text below 12px, and every use case has its own marked tile', () => {
  const a = argsOf(6);
  const pages = splitInfographic(infographicSvg(docModelOf(a), theme, buildAgentModel(a).ranked));
  for (const [i, svg] of pages.entries()) {
    const small = pxSizes(svg).filter((s) => s < 12);
    assert.equal(small.length, 0, `infographic page ${i + 1} has text at ${[...new Set(small)].join(', ')}px`);
  }
  const all = pages.join('');
  for (const u of a.useCases) {
    const at = all.indexOf(u.Name);
    assert.ok(at >= 0, `${u.Name} has a tile`);
  }
  const tiles = all.split(/<g[^>]*data-tile=/).slice(1);
  assert.ok(tiles.length >= a.useCases.length, 'each tile is marked with data-tile');
});

test('(e) Word: body text at least 11pt, a Heading 1 and a page break per use case, and the facts in a table', async () => {
  const a = argsOf(4);
  const xml = await (await JSZip.loadAsync(await buildDocx(docModelOf(a), theme))).file('word/document.xml').async('string');
  const sizes = [...xml.matchAll(/<w:sz w:val="(\d+)"/g)].map((m) => Number(m[1]));
  assert.ok(sizes.length && sizes.every((s) => s >= 22), `the Word file has text below 11pt: ${[...new Set(sizes.filter((s) => s < 22))].join(', ')} half-points`);
  const h1 = (xml.match(/<w:pStyle w:val="Heading1"\/>/g) || []).length;
  assert.ok(h1 >= a.useCases.length, `${h1} Heading 1 paragraphs for ${a.useCases.length} use cases`);
  const breaks = (xml.match(/<w:br w:type="page"\/>|<w:pageBreakBefore\/>/g) || []).length;
  assert.ok(breaks >= a.useCases.length, `${breaks} page breaks for ${a.useCases.length} use cases`);
  const tables = (xml.match(/<w:tbl>/g) || []).length;
  assert.ok(tables >= a.useCases.length, `${tables} tables for ${a.useCases.length} use cases`);
});

test('(f) the document model names the business domain, not the subdomain', () => {
  const a = argsOf(3);
  const m = docModelOf(a);
  assert.deepEqual(m.useCases.map((u) => u.domain).sort(), ['Finance', 'Marketing', 'Supply chain']);
});
