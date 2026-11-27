// C25 (REQ-559 review): on the value page, the "Top use cases by value" table ranks by value (1, 2, 3 from the highest),
// not by the catalog rank, so the Rank column reads in order next to the amounts.
import test from 'node:test';
import assert from 'node:assert/strict';
import { agentPdfPages } from '../src/lib/docgen/agentPdf.js';

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

const s = agentPdfPages(ARGS).find((p) => p.kind === 'value').svg;
const top = s.slice(s.indexOf('Top use cases by value'), s.indexOf('Use cases without a value'));
const ranks = [...top.matchAll(/<td class="ix-rank">([^<]*)<\/td>/g)].map((m) => m[1]);

test('the top-by-value table ranks 1, 2, 3 by value, highest first', () => {
  assert.deepEqual(ranks, ['1', '2', '3']);
  assert.ok(top.indexOf('Forecast product demand') < top.indexOf('Spot late suppliers') && top.indexOf('Spot late suppliers') < top.indexOf('Price elasticity by store'));
});
