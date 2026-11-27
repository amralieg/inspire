// C25 (REQ-559 part 2): the PPTX is the agent's original deck (the 6a7361a39 notebook, _build_presentation_deck) plus value.
// Same slide order, the same use case card and value slides with every label they had, the use case's value on each use case
// slide, and one value slide after the last domain and before the index. Reads the agent document model (agentModel.js).
// Source: c25_scratch/old_src.py, _doc_presentation 55335, the deck 56058-56920.
import { displayId } from '../../shared/useCaseId.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { buildAgentPptx, agentPptxSlides } from '../src/lib/docgen/agentPptx.js';
import { moneyText } from '../src/lib/valueWizard.js';

// Every label the old uc_card and uc_value slides printed (_deck_use_case, _deck_use_case_value, _use_case_view).
const OLD_UC_CARD_LABELS = [
  'Statement', 'Solution', 'Business Value',
  'Sponsor', 'Beneficiary', 'Business Priority Alignment', 'Strategic Goals Alignment', 'Analytics Technique', 'Type',
  'Use Case Kind', 'Key measure', // REQ-561: Tables Involved, Data Foundations and Data Filters are technical and no longer on the slides
  'What you get', 'KPIs', 'Expected Key Results', 'Value estimate', 'Measures of Success', 'Financial Benefits', 'Non-Financial Benefits',
  'Quality', 'Inspire Score', 'Elite Score', 'Quality Score', 'Best-of-Best Score', 'Priority', 'Value', 'Feasibility',
];

// The same 2-domain fixture as c25AgentPdf.test.mjs.
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

const unxml = (s) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&');
// Each slide of the produced file in order: its marker (the name of its first shape, slide:<kind>[:<key>]), every shape name and every text run.
async function slidesOf(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  const n = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
  const out = [];
  for (let i = 1; i <= n; i += 1) {
    const xml = await zip.file(`ppt/slides/slide${i}.xml`).async('string');
    const names = [...xml.matchAll(/<p:cNvPr [^>]*name="([^"]*)"/g)].map((x) => unxml(x[1]));
    const runs = [...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => unxml(x[1]));
    const marker = names.find((x) => x.startsWith('slide:')) || '';
    const [, kind = '', key = ''] = marker.split(':');
    out.push({ kind, key, names, runs, text: runs.join('\n') });
  }
  return out;
}

const bytes = await buildAgentPptx(ARGS);
const slides = await slidesOf(bytes);
const ucSlides = (id) => slides.filter((s) => (s.kind === 'uc_card' || s.kind === 'uc_value') && s.key === id);
const hasLabel = (s, label) => s.runs.some((r) => r.trim().replace(/:$/, '').toLowerCase() === label.toLowerCase());

test('(a) the slide sequence is the agent deck order, with the value slide after the last domain and before the index', () => {
  assert.ok(bytes instanceof Uint8Array && bytes.length > 1000, 'a pptx file');
  const seq = slides.map((s) => (s.key ? `${s.kind}:${s.key}` : s.kind));
  assert.deepEqual(seq, ['cover', 'contents', 'summary', 'guide', 'portfolio', 'top_index',
    'domain:1', 'uc_card:AI01-UC01', 'uc_value:AI01-UC01', 'uc_story:AI01-UC01', 'uc_card:AI01-UC02', 'uc_value:AI01-UC02', 'uc_story:AI01-UC02',
    'domain:2', 'uc_card:AI02-UC01', 'uc_value:AI02-UC01', 'uc_story:AI02-UC01', 'uc_card:AI02-UC02', 'uc_value:AI02-UC02',
    'value', 'index', 'methodology', 'glossary', 'foundations', 'roadmap', 'disclaimer', 'closing']);
  assert.ok(slides[0].text.includes('Acme') && slides[0].text.includes('Strategic AI Use Cases Powered by Databricks AI'), 'the cover');
  assert.ok(slides.find((s) => s.kind === 'summary').text.includes(SUMMARY[0]), 'the executive summary');
  assert.ok(slides.find((s) => s.kind === 'contents').text.includes('Value at stake'), 'the contents list the value slide');
  const dom2 = slides.find((s) => s.kind === 'domain' && s.key === '2').text;
  assert.ok(dom2.includes('Operations') && dom2.includes('Top opportunities'), 'the domain slide');
  const index = slides.find((s) => s.kind === 'index').text;
  for (const uc of UCS) assert.ok(index.includes(displayId(uc.No)) && index.includes(uc.Name), `${uc.No} is in the index`);
  // The in-App View lists the same slides with a title each.
  const outline = agentPptxSlides(ARGS);
  assert.deepEqual(outline.map((s) => (s.key ? `${s.kind}:${s.key}` : s.kind)), seq);
  assert.ok(outline.every((s) => typeof s.title === 'string' && s.title.trim()), 'every slide has a title for the View');
});

test('(b) the use case slides carry every label of the old uc_card and uc_value slides, the ribbons and the notebook button', () => {
  for (const uc of UCS) {
    const pair = ucSlides(displayId(uc.No));
    assert.equal(pair.length, 2, `${uc.No} has a card and a value slide`);
    for (const label of OLD_UC_CARD_LABELS) assert.ok(pair.some((s) => hasLabel(s, label)), `${uc.No} shows the label ${label}`);
    const card = pair[0].text;
    assert.ok(card.includes(uc.Name) && card.includes(uc.Statement) && card.includes(uc['Business Value']), `${uc.No} prints its title and text`);
    assert.ok(card.includes('Open the Genie notebook'), `${uc.No} has the notebook button`);
  }
  const first = ucSlides('AI01-UC01')[0].text;
  assert.ok(first.includes('Meets your quality bar') && first.includes('Best of Best #1'), 'meets-bar and Best of Best ribbons');
  const cover = ucSlides('AI02-UC02')[0].text;
  assert.ok(cover.includes('no use case above the bar') && !cover.includes('Meets your quality bar'), 'coverage ribbon, not meeting the bar');
});

test('(c) each use case slide shows the value a year with its basis and, for an estimate, the estimate note', () => {
  for (const uc of UCS) {
    const v = VALUES[uc.No];
    for (const s of ucSlides(displayId(uc.No))) {
      assert.ok(hasLabel(s, 'Value at stake per year'), `${uc.No} ${s.kind} has the value block`);
      if (v) {
        assert.ok(s.text.includes(moneyText(v.currency, v.amount)), `${uc.No} ${s.kind} shows ${moneyText(v.currency, v.amount)}`);
        assert.ok(hasLabel(s, 'Basis'), `${uc.No} ${s.kind} shows its basis`);
        assert.equal(hasLabel(s, 'Estimate note'), v.status === 'estimated', `${uc.No} ${s.kind} shows the estimate note only for an estimate`);
      } else assert.ok(s.text.includes('Value not calculated yet'), `${uc.No} ${s.kind} says it has no value`);
    }
  }
});

test('(d) one value slide: the total, the value per domain and the top use cases, and the totals add up', () => {
  const value = slides.filter((s) => s.kind === 'value');
  assert.equal(value.length, 1, 'one value slide');
  const s = value[0];
  const total = Object.values(VALUES).reduce((a, v) => a + v.amount, 0);
  const num = (prefix) => s.names.filter((x) => x.startsWith(prefix)).map((x) => Number(x.slice(prefix.length)));
  assert.deepEqual(num('value-total:'), [total], 'the slide total is the sum of the use case values');
  assert.ok(s.text.includes(moneyText('USD', total)), 'the total is printed');
  const domains = num('value-domain:');
  assert.deepEqual(domains, [1500000, 450000], 'value per domain, in domain order');
  assert.equal(domains.reduce((a, b) => a + b, 0), total, 'the domains add up to the total');
  for (const d of domains) assert.ok(s.text.includes(moneyText('USD', d)), `the domain value ${moneyText('USD', d)} is printed`);
  assert.ok(s.text.indexOf('Forecast product demand') < s.text.indexOf('Spot late suppliers')
    && s.text.indexOf('Spot late suppliers') < s.text.indexOf('Price elasticity by store'), 'top use cases by value, highest first');
  assert.ok(s.text.includes('Cover a quiet domain') && s.text.includes('Value not calculated yet'), 'a use case with no value says so');
});

test('(e) right-to-left languages build, and Generate docs (the pptx kind) uses the agent deck', async () => {
  const ar = await slidesOf(await buildAgentPptx({ ...ARGS, language: 'Arabic' }));
  assert.equal(ar.length, slides.length);
  assert.equal(typeof globalThis.document, 'undefined');
  const gen = fs.readFileSync(new URL('../src/lib/generateDocs.js', import.meta.url), 'utf8');
  const branch = /if \(file\.kind === 'pptx'\)[^\n]*/.exec(gen)?.[0] || '';
  assert.match(branch, /agentPptx\.js/, 'the pptx kind loads the agent deck');
  assert.doesNotMatch(branch, /pptxDoc\.js/, 'the pptx kind no longer builds the old deck');
  const src = fs.readFileSync(new URL('../src/lib/docgen/agentPptx.js', import.meta.url), 'utf8');
  assert.match(src, /from '\.\/agentModel\.js'/, 'the deck reads the agent document model');
});
