// C25 (REQ-559 part 1): the PDF is the agent's original catalog PDF (the 6a7361a39 notebook, _catalog_pdf_html) plus value.
// Same sections and order, the same use case card with every label it had, the use case's value on each card, and one value page
// after the last domain's cards and before the index. The strategy document is made by the same generator.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { agentPdfPages } from '../src/lib/docgen/agentPdf.js';
import { buildAgentModel } from '../src/lib/docgen/agentModel.js';
import { strategyPagesSvg } from '../src/lib/strategyDoc.js';
import { moneyText } from '../src/lib/valueWizard.js';

// Every label the old use case card printed. Source: 6a7361a39 app/agent/agent/dbx_inspire_ai_agent.ipynb, concatenated cells
// (c25_scratch/old_src.py): _pdf_use_case_card 55957-55993, _use_case_view 55094-55179, the view constants 54507-54546
// (_USE_CASE_VIEW_TEXT, _USE_CASE_VIEW_FACTS, _USE_CASE_VIEW_VALUE, _USE_CASE_VIEW_SCORES) and their English in
// ENGLISH_TRANSLATIONS 19551-19889.
const OLD_UC_CARD_LABELS = [
  // _USE_CASE_VIEW_TEXT (narrative blocks)
  'Statement', 'Solution', 'Business Value',
  // _USE_CASE_VIEW_FACTS, plus data_filters, kind and key_measure_note inserted by _use_case_view
  'Sponsor', 'Beneficiary', 'Business Priority Alignment', 'Strategic Goals Alignment', 'Analytics Technique', 'Type',
  'Use Case Kind', 'Key measure', // REQ-561: Tables Involved, Data Foundations and Data Filters are technical and no longer on the card
  // value facts: what_you_get (INSPIRE_KIND_LINES) and _USE_CASE_VIEW_VALUE
  'What you get', 'KPIs', 'Expected Key Results', 'Value estimate', 'Measures of Success', 'Financial Benefits', 'Non-Financial Benefits',
  // metrics: quality, then _USE_CASE_VIEW_SCORES
  'Quality', 'Inspire Score', 'Elite Score', 'Quality Score', 'Best-of-Best Score', 'Priority', 'Value', 'Feasibility',
];
// The ribbons and the notebook button of _pdf_use_case_card.
const OLD_RIBBONS = { meets: 'Meets your quality bar', star: 'Best of Best', coverageReason: 'Reason', notebook: 'Open the Genie notebook' };

const full = (id, domain, sub, name, extra = {}) => ({
  No: id, Name: name, usecase: name, 'Business Domain': domain, Subdomain: sub, type: 'Opportunity', 'Analytics Technique': 'Forecasting',
  Statement: `Teams cannot see ${name.toLowerCase()} early enough. A second sentence explains more.`,
  Solution: `A model scores ${name.toLowerCase()} every day from the order history.`,
  'Business Value': `Planners act a week sooner on ${name.toLowerCase()}.`,
  Beneficiary: 'Planning lead', Sponsor: 'Chief Operating Officer', 'Business Priority Alignment': 'Increase Revenue',
  'Strategic Goals Alignment': 'Reduce Cost, Increase Revenue', 'Tables Involved': 'main.s.orders, main.s.customers',
  Quality: 'Very High', 'Quality Score': 4.3, 'Inspire Score': 8.7, elite_score: 8.1, bob_score: 8.4, Priority: 8.9, Value: 4.5, Feasibility: 4.2,
  data_filters: [{ column: 'region', text: 'north' }], use_case_kind: 'forecast', kind_label: 'Forecast', kind_family_label: 'Predict',
  key_measure_note: 'Units sold per day', serving_summary: 'A daily forecast per product', method_summary: 'Exponential smoothing per series',
  value_source: 'Less waste', value_estimate_text: 'About 2% less waste',
  KPIs: [{ name: 'Waste rate', direction: 'decrease', unit: '%' }], 'Expected Key Results': [{ statement: 'Waste down 2 points in a quarter' }],
  'Measures of Success': ['Forecast error under 15%'], 'Financial Benefits': ['Lower write-offs'], 'Non-Financial Benefits': ['Calmer mornings'],
  Foundations: ['F1'], notebook_path: `/Workspace/out/${id}.ipynb`, ...extra,
});
const UCS = [
  full('N01-U01', 'Sales', 'Demand', 'Forecast product demand', { elite_status: 'ELITE', best_of_best: 'Y', best_of_best_rank: 1, best_of_best_score: 9.1 }),
  full('N01-U02', 'Sales', 'Pricing', 'Price elasticity by store', { 'Inspire Score': 7.9 }),
  full('N02-U01', 'Operations', 'Stock', 'Spot late suppliers', { 'Inspire Score': 8.2 }),
  full('N02-U02', 'Operations', 'Stock', 'Cover a quiet domain', { 'Inspire Score': 5.1, elite_status: 'DOMAIN_COVERAGE_PICK', coverage_pick_reason: 'no use case above the bar' }),
];
const VALUES = {
  'N01-U01': { amount: 1200000, currency: 'USD', status: 'calculated', verb: 'CUT COST', story: '', factors: [{ name: 'Waste', share: 0.7 }, { name: 'Labour', share: 0.3 }] },
  'N01-U02': { amount: 300000, currency: 'USD', status: 'estimated', verb: 'GROW REVENUE', story: '', factors: [] },
  'N02-U01': { amount: 450000, currency: 'USD', status: 'estimated', verb: 'AVOID RISK', story: '', factors: [] },
};
const FOUNDATIONS = [{ id: 'F1', name: 'Orders and customers', tables: ['main.s.orders', 'main.s.customers'], use_case_count: 3,
  joins: [{ left: 'main.s.orders.customer_id', right: 'main.s.customers.id' }], use_cases: ['N01-U01', 'N01-U02', 'N02-U01'] }];
const SUMMARY = ['Acme runs stores where margins move daily.', 'Forecasting and pricing are the first moves.'];
const ARGS = { businessName: 'Acme', useCases: UCS, values: VALUES, summary: SUMMARY, foundations: FOUNDATIONS, language: 'English', date: '2026-11-26' };

const pages = agentPdfPages(ARGS);
const collapse = (kinds) => kinds.filter((k, i) => k !== kinds[i - 1]);
const articleOf = (id) => pages.filter((p) => p.kind === 'cards').map((p) => p.svg)
  .flatMap((s) => [...s.matchAll(/<article class="uc[^"]*" data-uc="([^"]+)"[\s\S]*?<\/article>/g)].filter((m) => m[1] === id).map((m) => m[0])).join('\n');

test('(a) the page sequence is the agent PDF order, with the value page after the last domain and before the index', () => {
  const seq = collapse(pages.map((p) => (p.kind === 'domain' || p.kind === 'cards' ? `${p.kind}${p.domain}` : p.kind)));
  assert.deepEqual(seq, ['cover', 'contents', 'exec', 'guide', 'portfolio', 'domain1', 'cards1', 'story', 'cards1', 'story', 'domain2', 'cards2', 'story', 'cards2', 'value', 'index',
    'methodology', 'foundations', 'roadmap', 'disclaimer', 'closing']);
  // Domain 1 (Sales, best rank) holds its use cases; domain 2 holds the other two.
  const ids = (d) => pages.filter((p) => p.kind === 'cards' && p.domain === d).map((p) => p.svg).join('').match(/data-uc="[^"]+"/g);
  assert.deepEqual([...new Set(ids(1))], ['data-uc="N01-U01"', 'data-uc="N01-U02"']);
  assert.deepEqual([...new Set(ids(2))], ['data-uc="N02-U01"', 'data-uc="N02-U02"']);
  assert.ok(pages.every((p) => /^<svg [^>]*width="794" height="1123"/.test(p.svg) && p.svg.includes('<foreignObject')), 'every page is an A4 foreignObject SVG');
  assert.ok(pages.every((p) => p.used <= p.room), 'no page is filled past its height (the height model)');
  const exec = pages.find((p) => p.kind === 'exec').svg;
  assert.ok(exec.includes('Executive Summary') && exec.includes(SUMMARY[0]), 'the executive summary page carries the summary');
  const dom = pages.find((p) => p.kind === 'domain' && p.domain === 2).svg;
  assert.ok(dom.includes('Operations') && dom.includes('About this domain') && dom.includes('Top opportunities'), 'the domain opener');
});

test('(b) every use case card carries every label of the old card, the ribbons and the notebook button', () => {
  for (const uc of UCS) {
    const html = articleOf(uc.No);
    assert.ok(html, `${uc.No} has a card`);
    for (const label of OLD_UC_CARD_LABELS) assert.ok(html.includes(`>${label}<`), `${uc.No} card shows the label ${label}`);
    assert.ok(html.includes(OLD_RIBBONS.notebook), `${uc.No} has the notebook button`);
    assert.ok(html.includes(uc.Statement.split('.')[0]) && html.includes(uc['Business Value']), `${uc.No} prints its text in full`);
  }
  assert.ok(articleOf('N01-U01').includes(OLD_RIBBONS.meets), 'meets the bar ribbon');
  assert.ok(articleOf('N01-U01').includes(`${OLD_RIBBONS.star} #1`), 'Best of Best ribbon');
  assert.ok(articleOf('N02-U02').includes(`${OLD_RIBBONS.coverageReason}:`) && articleOf('N02-U02').includes('no use case above the bar'), 'coverage ribbon');
  assert.ok(!articleOf('N02-U02').includes(OLD_RIBBONS.meets), 'a coverage pick does not meet the bar');
});

test('(c) each card shows its value a year with its basis, and the value page totals add up', () => {
  for (const uc of UCS) {
    const html = articleOf(uc.No);
    const v = VALUES[uc.No];
    assert.ok(html.includes('Value at stake per year'), `${uc.No} has the value block`);
    if (v) {
      assert.ok(html.includes(moneyText(v.currency, v.amount)), `${uc.No} shows ${moneyText(v.currency, v.amount)}`);
      assert.ok(html.includes('Basis'), `${uc.No} shows its basis`);
      assert.equal(html.includes('Estimate note'), v.status === 'estimated', `${uc.No} shows the estimate note only when it is an estimate`);
    } else assert.ok(html.includes('Value not calculated yet'), `${uc.No} says it has no value`);
  }
  const value = pages.filter((p) => p.kind === 'value');
  assert.equal(value.length, 1, 'one value page');
  const s = value[0].svg;
  const total = Object.values(VALUES).reduce((a, v) => a + v.amount, 0);
  assert.equal(Number(/data-total-amount="(\d+(?:\.\d+)?)"/.exec(s)?.[1]), total, 'the page total is the sum of the use case values');
  assert.ok(s.includes(moneyText('USD', total)), 'the total is printed');
  const domains = [...s.matchAll(/data-domain-amount="(\d+(?:\.\d+)?)"/g)].map((m) => Number(m[1]));
  assert.deepEqual(domains, [1500000, 450000], 'value per domain, in domain order');
  assert.equal(domains.reduce((a, b) => a + b, 0), total, 'the domains add up to the total');
  assert.ok(s.indexOf('Forecast product demand') < s.indexOf('Spot late suppliers') && s.indexOf('Spot late suppliers') < s.indexOf('Price elasticity by store'), 'top use cases by value, highest first');
  assert.ok(s.includes('Cover a quiet domain') && s.includes('Value not calculated yet'), 'a use case with no value says so');
  const m = buildAgentModel(ARGS);
  assert.equal(m.value.total.amount, total);
  assert.equal(m.value.nWith, 3);
  assert.equal(m.value.nWithout, 1);
});

test('(d) right-to-left languages keep the agent direction, and the pages build in Node without a DOM', () => {
  const ar = agentPdfPages({ ...ARGS, language: 'Arabic' });
  assert.ok(ar.length > 10);
  assert.ok(ar.every((p) => /dir="rtl"/.test(p.svg)), 'every Arabic page is right to left');
  assert.equal(typeof globalThis.document, 'undefined');
});

test('(e) Generate docs (the pdf kind) and the strategy document use the agent PDF generator', () => {
  const strategy = fs.readFileSync(new URL('../src/lib/strategyDoc.js', import.meta.url), 'utf8');
  const gen = fs.readFileSync(new URL('../src/lib/generateDocs.js', import.meta.url), 'utf8');
  assert.match(strategy, /from '\.\/docgen\/agentPdf\.js'/);
  assert.doesNotMatch(strategy, /briefPagesSvg/);
  assert.match(gen, /from '\.\/docgen\/agentPdf\.js'/);
  assert.doesNotMatch(/if \(file\.kind === 'pdf'\) \{[\s\S]*?\n {2}\}/.exec(gen)?.[0] || '', /briefPagesSvg/, 'the pdf kind no longer draws the brief pages');
  const svgs = strategyPagesSvg({ businessName: 'Acme', useCases: UCS, values: VALUES, summary: SUMMARY, foundations: FOUNDATIONS });
  const all = svgs.join('\n');
  assert.ok(svgs.every((s) => typeof s === 'string' && s.includes('<foreignObject')), 'strategy pages are agent PDF pages');
  assert.ok(all.includes('class="uc') && all.includes('Value at stake per year'), 'strategy pages carry the agent use case card with value');
  for (const uc of UCS) assert.ok(all.includes(uc.No) && all.includes(uc.Name), `${uc.No} is in the strategy document`);
});
