// C26 (REQ-561 follow-up): every document kind prints business fields only (no tables, filters, foundations, notebook path or SQL, no "Data used"),
// the infographic is cut into pages no taller than three A4 pages, and the new agent labels come out in the run language.
import test from 'node:test';
import assert from 'node:assert/strict';
import JSZip from 'jszip';
import { agentPdfPages } from '../src/lib/docgen/agentPdf.js';
import { buildAgentPptx } from '../src/lib/docgen/agentPptx.js';
import { buildAgentModel, agentLabelTexts, AGENT_VALUE_EN } from '../src/lib/docgen/agentModel.js';
import { briefPagesSvg, infographicSvg, infographicPagesSvg } from '../src/lib/docgen/docSvg.js';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { buildDocx } from '../src/lib/docgen/docxDoc.js';
import { buildPptx } from '../src/lib/docgen/pptxDoc.js';
import { defaultDocOptions, CONTENT_BLOCKS } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';

const decode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const flat = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');
const TECH = ['main.sales.orders', 'main.sales.customers', 'region: north', 'SELECT order_id', '/Workspace/out/', '.ipynb', 'Orders and customers', 'Data used', 'Tables Involved', 'Data Filters'];

const uc = (id, name, extra = {}) => ({
  No: id, Name: name, usecase: name, 'Business Domain': 'Logistics', Subdomain: 'Delivery', type: 'Opportunity', 'Analytics Technique': 'Classification',
  Statement: 'Planners cannot see late deliveries early.', Solution: 'A model flags every late delivery each morning.', 'Business Value': 'Fewer expedited shipments.',
  Beneficiary: 'Logistics planner', Sponsor: 'Chief Supply Officer', 'Business Priority Alignment': 'Increase Revenue', Quality: 'Very High', 'Quality Score': 4.3,
  'Inspire Score': 8.7, Priority: 8.9, Value: 4.5, Feasibility: 4.2,
  'Tables Involved': 'main.sales.orders, main.sales.customers', data_filters: [{ column: 'region', text: 'north' }], Foundations: ['F1'],
  sql: 'SELECT order_id FROM main.sales.orders', notebook_path: `/Workspace/out/${id}.ipynb`,
  'Strategy Alignment': [{ id: 'S1', path: 'Operational excellence > Reliable delivery', evidence: 'Late deliveries cost money.' }],
  KPIs: [{ name: 'Late delivery rate', direction: 'decrease', unit: '%', query: 'SELECT order_id FROM main.sales.orders' }],
  'Expected Key Results': [{ statement: 'Late deliveries down 3 points' }], 'Measures of Success': ['Late rate under 5 percent'],
  best_of_best: 'N', best_of_best_reason: 'Below the bar.', ...extra,
});
const FOUNDATIONS = [{ id: 'F1', name: 'Orders and customers', tables: ['main.sales.orders', 'main.sales.customers'], use_case_count: 2, joins: [], use_cases: ['P01-U01'] }];
const YEARS = [1, 2, 3].map((year) => ({ year, low: 1000 * year, likely: 2000 * year, high: 3000 * year }));
const valueOf = () => ({ amount: 1200000, currency: 'USD', status: 'calculated', verb: 'CUT COST', story: 'Fewer late trucks mean less spend.', yearly: YEARS, factors: [{ name: 'Expediting', share: 1, formula: '10 times a year' }] });
const theme = (style) => resolveTheme(style, 'databricks', '', 'light');
const withTech = (text, where) => { for (const t of TECH) assert.ok(!text.includes(t), `${where} must not print "${t}"`); };
const argsOf = (n, extra = {}) => {
  const useCases = Array.from({ length: n }, (_, i) => uc(`P01-U${String(i + 1).padStart(2, '0')}`, `Predict late deliveries ${i + 1}`));
  const values = Object.fromEntries(useCases.map((u) => [u.No, valueOf()]));
  return { businessName: 'Acme', useCases, values, summary: ['Acme ships daily.'], foundations: FOUNDATIONS, language: 'English', date: '2026-11-27', ...extra };
};
const blocksAll = CONTENT_BLOCKS.map((b) => b.id).concat(['data_used', 'sql']);
const docModelOf = (a) => buildDocModel({ businessName: a.businessName, useCases: a.useCases, values: a.values, options: { ...defaultDocOptions('English'), blocks: blocksAll }, summary: a.summary, foundations: a.foundations });
const slideText = async (bytes) => {
  const zip = await JSZip.loadAsync(bytes);
  const out = [];
  for (const f of Object.keys(zip.files).filter((n) => /^ppt\/slides\/slide\d+\.xml$/.test(n))) out.push([...(await zip.file(f).async('string')).matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => x[1]).join(' '));
  return decode(out.join(' '));
};

test('(a) no document kind prints tables, filters, foundations, notebook path, SQL or "Data used"', async () => {
  const a = argsOf(3); const m = docModelOf(a);
  assert.ok(!CONTENT_BLOCKS.some((b) => b.id === 'data_used' || b.id === 'sql'), 'the options no longer offer a data or SQL block');
  for (const style of ['original', 'executive', 'midnight']) {
    withTech(flat(briefPagesSvg(m, theme(style)).join(' ')), `the ${style} Word brief pages`);
    withTech(flat(infographicSvg(m, theme(style), buildAgentModel(a).ranked)), `the ${style} infographic`);
    withTech(await slideText(await buildPptx(m, theme(style))), `the ${style} classic deck`);
  }
  const docx = await JSZip.loadAsync(await buildDocx(m, theme('original')));
  withTech(flat(await docx.file('word/document.xml').async('string')), 'the Word document');
  withTech(flat(agentPdfPages(a).filter((p) => p.kind === 'cards' || p.kind === 'story').map((p) => p.svg).join(' ')), 'the PDF use case pages');
  withTech(await slideText(await buildAgentPptx(a)), 'the agent deck');
});

test('(b) the infographic of 30 use cases is cut into pages of at most 3 A4 pages, every tile kept', () => {
  const a = argsOf(30); const m = docModelOf(a);
  const views = buildAgentModel(a).ranked;
  for (const style of ['original', 'midnight']) {
    const pages = infographicPagesSvg(m, theme(style), views);
    assert.ok(pages.length > 1, `${style}: more than one page`);
    let tiles = 0;
    for (const svg of pages) {
      const hm = /^<svg [^>]*? height="(\d+)"/.exec(svg); assert.ok(hm, `page head: ${svg.slice(0, 160)}`); const h = Number(hm[1]);
      assert.ok(h <= 3 * 1123, `${style}: page height ${h} is at most 3369`);
      assert.equal(Number(/viewBox="0 \d+ \d+ (\d+)"/.exec(svg)[1]), h, 'the viewBox matches the height');
      tiles += (svg.match(/data-tile="/g) || []).length;
    }
    assert.equal(tiles, 30, `${style}: all 30 tiles are on some page`);
  }
});

test('(c) Arabic and French runs print the new labels translated, not in English', async () => {
  // The translation fake: every letter outside {holes} is shifted, so a label left in English is easy to see.
  const shift = (en, n) => en.replace(/\{[a-z_]+\}|[A-Za-z]/g, (c) => (c.length > 1 ? c : String.fromCharCode(((c.toLowerCase().charCodeAt(0) - 97 + n) % 26) + 97)));
  const a = argsOf(1);
  const NEW = ['strategy', 'strategy_serves', 'strategy_part_of', 'strategy_priorities', 'strategy_measured', 'not_starred', 'value_how', 'value_projection', 'value_low', 'value_likely', 'value_high', 'value_year_n'];
  const TILE = ['strategy_serves', 'strategy_part_of', 'strategy_priorities', 'strategy_measured', 'not_starred'];
  for (const [language, n] of [['Arabic', 3], ['French', 5]]) {
    const translated = Object.fromEntries(Object.entries(agentLabelTexts()).map(([k, en]) => [k, shift(en, n)]));
    const lang = { ...a, language, translated };
    const model = buildAgentModel(lang);
    const tile = flat(infographicSvg(docModelOf(a), theme('original'), model.ranked));
    const pdf = flat(agentPdfPages(lang).map((p) => p.svg).join(' '));
    const deck = await slideText(await buildAgentPptx(lang));
    for (const k of NEW) {
      const en = AGENT_VALUE_EN[k]; const tr = shift(en, n);
      const piece = (s) => s.split(/\{[a-z_]+\}/).map((x) => x.trim()).filter(Boolean).sort((x, y) => y.length - x.length)[0];
      const where = TILE.includes(k) ? [['tile', tile]] : [['PDF', pdf], ['deck', deck]];
      for (const [w, text] of where) assert.ok(text.toLowerCase().includes(piece(tr).toLowerCase()), `${language} ${w}: ${k} is translated ("${piece(tr)}")`);
      for (const [w, text] of where) if (en.length > 8) assert.ok(!text.toLowerCase().includes(piece(en).toLowerCase()), `${language} ${w}: ${k} is not left in English ("${piece(en)}")`);
    }
  }
});
