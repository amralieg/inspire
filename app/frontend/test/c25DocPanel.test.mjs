// C25 (REQ-561): the use case pages of the PDF, the PPTX and the infographic carry everything the side panel shows, business only,
// plus a value-story follow-up page or slide for each use case that has a value. One field list (panelFields.js) is read from the panel.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import JSZip from 'jszip';
import { agentPdfPages } from '../src/lib/docgen/agentPdf.js';
import { buildAgentPptx } from '../src/lib/docgen/agentPptx.js';
import { buildAgentModel } from '../src/lib/docgen/agentModel.js';
import { infographicSvg } from '../src/lib/docgen/docSvg.js';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { defaultDocOptions } from '../src/lib/docgen/docOptions.js';
import { resolveTheme } from '../src/lib/docgen/docStyles.js';
import { PANEL_BUSINESS, PANEL_TECHNICAL } from '../src/lib/docgen/panelFields.js';
import { moneyText } from '../src/lib/valueWizard.js';

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), 'utf8');
const decode = (s) => s.replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&');
const flat = (s) => decode(s.replace(/<[^>]+>/g, ' ')).replace(/\s+/g, ' ');

// One use case with every field of the side panel filled, business and technical.
const BIZ = {
  statement: 'Planners cannot see late deliveries early.',
  solution: 'A model flags every late delivery each morning.',
  businessValue: 'Fewer expedited shipments each quarter.',
  beneficiary: 'Logistics planner', sponsor: 'Chief Supply Officer', priority: 'Increase Revenue',
  serve: 'A morning list per depot', how: 'Gradient boosting per lane', source: 'Less expediting spend',
  goal: 'Reliable delivery', under: 'Operational excellence', goalEvidence: 'Late deliveries cost expediting spend.',
  kpi: 'Late delivery rate', kr: 'Late deliveries down 3 points', measure: 'Late rate under 5 percent',
  financial: 'Lower expediting cost', nonFinancial: 'Calmer depots', estimate: 'About 2 percent less expediting',
  star: 'Passed every Best of Best check on delivery.',
};
const TECH = ['main.sales.orders', 'main.sales.customers', 'customer_id', 'region: north', 'SELECT AVG(late)', 'SELECT order_id', '/Workspace/out/P01-U01.ipynb', 'P01-U01.ipynb',
  'Orders and customers', 'Data Filters', 'Data Evidence', 'Data evidence', 'Data foundations', 'Data Foundations', 'Tables Involved', 'SQL Implementation', 'Use case notebook', 'Databricks AI Instruction', 'No baseline'];
const uc = (id, name, extra = {}) => ({
  No: id, Name: name, usecase: name, 'Business Domain': 'Logistics', Subdomain: 'Delivery', type: 'Opportunity', 'Analytics Technique': 'Classification',
  Statement: BIZ.statement, Solution: BIZ.solution, 'Business Value': BIZ.businessValue, Beneficiary: BIZ.beneficiary, Sponsor: BIZ.sponsor,
  'Business Priority Alignment': BIZ.priority, Quality: 'Very High', 'Quality Score': 4.3, 'Inspire Score': 8.7, Priority: 8.9, Value: 4.5, Feasibility: 4.2,
  'Tables Involved': 'main.sales.orders, main.sales.customers', data_filters: [{ column: 'region', text: 'north' }], Foundations: ['F1'],
  sql: 'SELECT order_id FROM main.sales.orders', notebook_path: `/Workspace/out/${id}.ipynb`,
  serving_summary: BIZ.serve, method_summary: BIZ.how, value_source: BIZ.source, value_estimate_text: BIZ.estimate,
  'Strategy Alignment': [{ id: 'S1', path: `${BIZ.under} > ${BIZ.goal}`, evidence: BIZ.goalEvidence }],
  KPIs: [{ name: BIZ.kpi, direction: 'decrease', unit: '%', query: 'SELECT AVG(late) FROM main.sales.orders' }],
  'Expected Key Results': [{ statement: BIZ.kr }], 'Measures of Success': [BIZ.measure], 'Financial Benefits': [BIZ.financial], 'Non-Financial Benefits': [BIZ.nonFinancial],
  'Data Evidence': { tables: { 'main.sales.orders': { rows: 10 } }, joins: [{ left: 'main.sales.orders.customer_id', right: 'main.sales.customers.id' }] },
  best_of_best: 'Y', best_of_best_rank: 1, best_of_best_score: 9.1, best_of_best_reason: BIZ.star, elite_status: 'ELITE', elite_score: 8.1, bob_score: 8.4, ...extra,
});
const YEARS = [1, 2, 3].map((year) => ({ year, low: 100000 * year + 11, likely: 200000 * year + 22, high: 300000 * year + 33 }));
const VALUED = uc('P01-U01', 'Predict late deliveries');
const PLAIN = uc('P01-U02', 'Cover a quiet depot', { 'Inspire Score': 5.1, best_of_best: 'N', best_of_best_reason: 'Below the Best of Best bar.', elite_status: '' });
const VALUES = {
  'P01-U01': { amount: 1200000, currency: 'USD', status: 'calculated', verb: 'CUT COST', story: 'Fewer late trucks mean less expediting spend.', yearly: YEARS,
    factors: [{ name: 'Expediting', share: 0.7, formula: '8,352 times a year × 1 person × 1.8 hours saved' }, { name: 'Labour', share: 0.3, formula: '400 people × 2% of their time back' }] },
};
const FOUNDATIONS = [{ id: 'F1', name: 'Orders and customers', tables: ['main.sales.orders', 'main.sales.customers'], use_case_count: 1,
  joins: [{ left: 'main.sales.orders.customer_id', right: 'main.sales.customers.id' }], use_cases: ['P01-U01'] }];
const ARGS = { businessName: 'Acme', useCases: [VALUED, PLAIN], values: VALUES, summary: ['Acme ships daily.'], foundations: FOUNDATIONS, language: 'English', date: '2026-11-27' };

// Business text the card, the slide and the tile must carry; the labels are the agent's English.
const BUSINESS_TEXT = [BIZ.statement, BIZ.solution, BIZ.businessValue, BIZ.beneficiary, BIZ.sponsor, BIZ.priority, BIZ.serve, BIZ.how, BIZ.source, BIZ.goal, BIZ.goalEvidence,
  BIZ.kpi, BIZ.kr, BIZ.measure, BIZ.financial, BIZ.nonFinancial, BIZ.estimate, BIZ.star];
const BUSINESS_LABELS = ['Statement', 'Solution', 'Business Value', 'Sponsor', 'Beneficiary', 'Quality', 'Business Priority Alignment', 'What you get', 'Strategy', 'KPIs',
  'Value estimate', 'Expected Key Results', 'Measures of Success', 'Financial Benefits', 'Non-Financial Benefits'];
const STORY_TEXT = ['Fewer late trucks mean less expediting spend.', 'Expediting', '70%', 'Labour', '30%', '8,352 times a year × 1 person × 1.8 hours saved', '400 people × 2% of their time back'];
const projectionText = YEARS.flatMap((y) => [y.low, y.likely, y.high].map((n) => moneyText('USD', n)));

function checkBusiness(text, where, { labels = BUSINESS_LABELS } = {}) {
  for (const t of BUSINESS_TEXT) assert.ok(text.includes(t), `${where} carries "${t}"`);
  for (const l of labels) assert.ok(text.includes(l), `${where} carries the label "${l}"`);
}
function checkNoTechnical(text, where) {
  for (const t of TECH) assert.ok(!text.includes(t), `${where} must not carry the technical text "${t}"`);
}

test('(a) the generators use one field list and it equals the side panel business list', () => {
  const detail = read('../src/components/UseCaseDetailBody.jsx');
  const strategy = read('../src/components/UseCaseStrategyDetail.jsx');
  const titles = new Set([
    ...[...detail.matchAll(/<h4[^>]*>\s*([A-Za-z][^<{]*?)\s*(?:<|\{)/g)].map((x) => x[1]),
    ...[...strategy.matchAll(/<Section title="([^"]+)"/g)].map((x) => x[1]),
    ...[...detail.matchAll(/label: '([^']+)'/g)].map((x) => x[1]),
    'Best of Best', 'Databricks AI Instruction', 'Use case notebook',
  ]);
  const classified = new Set([...PANEL_BUSINESS.flatMap((p) => p.panels), ...PANEL_TECHNICAL]);
  for (const t of titles) assert.ok(classified.has(t), `the panel title "${t}" is classified as business or technical`);
  for (const t of classified) assert.ok(titles.has(t), `the classified title "${t}" is on the panel`);
  const m = buildAgentModel(ARGS);
  const view = m.ranked.find((v) => v.id === 'P01-U01');
  assert.deepEqual([...view.panelKeys].sort(), PANEL_BUSINESS.map((p) => p.key).sort(), 'the card view lists exactly the panel business fields');
});

test('(b) PDF: the card carries every business section and no technical field; a valued use case gets a value-story page right after it', () => {
  const pages = agentPdfPages(ARGS);
  const own = (id) => pages.map((p, i) => ({ p, i })).filter(({ p }) => (p.kind === 'cards' && p.svg.includes(`data-uc="${id}"`)) || (p.kind === 'story' && p.svg.includes(`data-story="${id}"`)));
  const cards = flat(pages.filter((p) => p.kind === 'cards').map((p) => p.svg).join(' '));
  checkBusiness(cards, 'the PDF cards');
  checkNoTechnical(flat(pages.filter((p) => p.kind === 'cards' || p.kind === 'story').map((p) => p.svg).join(' ')), 'the PDF use case pages');
  const mine = own('P01-U01');
  const story = mine.filter(({ p }) => p.kind === 'story');
  assert.ok(story.length >= 1, 'a value-story page exists');
  const lastCard = Math.max(...mine.filter(({ p }) => p.kind === 'cards').map(({ i }) => i));
  assert.equal(story[0].i, lastCard + 1, 'the story page follows the card');
  const text = flat(story.map(({ p }) => p.svg).join(' '));
  for (const t of [...STORY_TEXT, ...projectionText, 'Value story', 'Basis']) assert.ok(text.includes(t), `the story page carries "${t}"`);
  assert.ok(!pages.some((p) => p.kind === 'story' && p.svg.includes('data-story="P01-U02"')), 'no value, no story page');
  assert.ok(flat(pages.filter((p) => p.kind === 'cards').map((p) => p.svg).join(' ')).includes('Value not calculated yet'), 'the unvalued card keeps saying so');
  assert.ok(pages.every((p) => p.used <= p.room), 'no page overflows');
});

test('(c) PPTX: the card slide carries every business section and no technical field; the story slide follows the valued card', async () => {
  const zip = await JSZip.loadAsync(await buildAgentPptx(ARGS));
  const n = Object.keys(zip.files).filter((f) => /^ppt\/slides\/slide\d+\.xml$/.test(f)).length;
  const slides = [];
  for (let i = 1; i <= n; i += 1) {
    const xml = await zip.file(`ppt/slides/slide${i}.xml`).async('string');
    const marker = [...xml.matchAll(/<p:cNvPr [^>]*name="([^"]*)"/g)].map((x) => decode(x[1])).find((x) => x.startsWith('slide:')) || '';
    const [, kind = '', key = ''] = marker.split(':');
    slides.push({ kind, key, text: decode([...xml.matchAll(/<a:t>([^<]*)<\/a:t>/g)].map((x) => x[1]).join(' ')).replace(/\s+/g, ' ') });
  }
  const ucKinds = new Set(['uc_card', 'uc_value', 'uc_story']);
  const mine = slides.map((s, i) => ({ ...s, i })).filter((s) => ucKinds.has(s.kind) && s.key === 'P01-U01');
  checkBusiness(mine.filter((s) => s.kind !== 'uc_story').map((s) => s.text).join(' '), 'the PPTX card slides');
  checkNoTechnical(slides.filter((s) => ucKinds.has(s.kind)).map((s) => s.text).join(' '), 'the PPTX use case slides');
  const story = mine.filter((s) => s.kind === 'uc_story');
  assert.equal(story.length, 1, 'one story slide');
  assert.equal(story[0].i, Math.max(...mine.filter((s) => s.kind !== 'uc_story').map((s) => s.i)) + 1, 'the story slide follows the use case slides');
  for (const t of [...STORY_TEXT, ...projectionText, 'Value story', 'Basis']) assert.ok(story[0].text.includes(t), `the story slide carries "${t}"`);
  assert.ok(!slides.some((s) => s.kind === 'uc_story' && s.key === 'P01-U02'), 'no value, no story slide');
});

for (const style of ['original', 'midnight']) {
  test(`(d) infographic (${style}): the tile carries every business section and the value with a one-line story, and no technical field`, () => {
    const options = { ...defaultDocOptions('English'), blocks: ['use_case_story', 'value_story', 'value_projection', 'data_used', 'inspire_score', 'disclaimer'] };
    const m = buildDocModel({ businessName: 'Acme', useCases: ARGS.useCases, values: VALUES, options });
    const views = buildAgentModel(ARGS).ranked;
    const svg = infographicSvg(m, resolveTheme(style, 'databricks', '', 'light'), views);
    const text = flat(svg);
    checkBusiness(text, `the ${style} infographic`);
    checkNoTechnical(text, `the ${style} infographic`);
    assert.ok(text.includes(moneyText('USD', 1200000)) || /1\.2M/.test(text), 'the tile shows the value');
    assert.ok(text.includes('Fewer late trucks mean less expediting spend.'), 'the tile shows the one-line story');
    assert.ok(text.includes('Cover a quiet depot'), 'a use case without a value still has a tile');
  });
}

test('(e) Generate docs passes the card views to the infographic', () => {
  assert.match(read('../src/lib/generateDocs.js'), /infographicSvg\(m, theme, buildAgentModel\(agent\)\.ranked\)/);
});
