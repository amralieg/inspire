// FX-97 (REQ-493, REQ-494): market and customer factors. The model names 0-6 factors for the use case; each is a bounded uplift or downturn
// on the revenue part of the value only. Cost and risk parts are untouched, bounds are clamped on the server, and the old single trend still works.
const test = require('node:test');
const assert = require('node:assert/strict');
const VCP = require('../lib/valueCasePlan');
const VR = require('../lib/valueReview');

const ask = (id, def, kind = 'money') => ({ id, source: 'estimate', default: def, kind, label: id, why: 'a guess' });
const REVENUE = { id: 'revenue_uplift', label: 'Uplift', verb: 'GROW REVENUE', on: true, why: 'more sales', asks: [ask('base_revenue_per_year', 1000000), ask('uplift_pct', 50, 'pct')] };
const COST = { id: 'cost_cut', label: 'Savings', verb: 'REDUCE COST', on: true, why: 'less spend', asks: [ask('spend_per_year', 400000), ask('cut_pct', 50, 'pct')] };
const FACTORS = [
  { id: 'confidence', label: 'Consumer confidence', why: 'Shoppers spend more when they feel secure.', likely_pct: 4, min_pct: -10, max_pct: 15 },
  { id: 'satisfaction', label: 'Customer satisfaction', why: 'Happy customers come back.', likely_pct: 2, min_pct: -5, max_pct: 8 },
];
const plan = (drivers, extra = {}) => ({ case_noun: 'order', case_filter: null, groupings: [], metrics: [], groups: [], drivers, ...extra });
const total = (p, answers) => VCP.yearlyOf(p, { currency: 'USD', ...answers });
const on = (pct) => ({ on: true, pct });

test('F1: factors move the total by their pct on the revenue part only', () => {
  const p = plan([REVENUE, COST], { economic_factors: FACTORS });
  const base = total(p, {}).yearly;
  const got = total(p, { economic_factors: { confidence: on(10), satisfaction: on(-4) } }).yearly;
  const revenue = base.parts.find((x) => x.id === 'revenue_uplift').amount * (base.attribution_pct / 100);
  assert.ok(revenue > 0);
  assert.ok(Math.abs(got.total.amount - (base.total.amount + revenue * 0.06)) < 0.05, `${got.total.amount} vs ${base.total.amount + revenue * 0.06}`);
  const parts = got.parts.filter((x) => /^factor_/.test(x.id));
  assert.deepEqual(parts.map((x) => [x.id, x.pct]), [['factor_confidence', 10], ['factor_satisfaction', -4]]);
  assert.ok(Math.abs(parts[0].amount - revenue * 0.1) < 0.05);
  assert.equal(got.parts.find((x) => x.id === 'cost_cut').amount, base.parts.find((x) => x.id === 'cost_cut').amount, 'the cost part is unchanged');
  assert.equal(total(p, { economic_factors: { confidence: { on: false, pct: 10 } } }).yearly.total.amount, base.total.amount, 'off changes nothing');
});

test('F2: a plan with only cost or risk kinds ignores factors', () => {
  const p = plan([COST], { economic_factors: FACTORS });
  const base = total(p, {}).yearly.total.amount;
  const got = total(p, { economic_factors: { confidence: on(10) } });
  assert.equal(got.yearly.total.amount, base);
  assert.equal(got.yearly.parts.filter((x) => /^factor_/.test(x.id)).length, 0);
});

test('F3: the old economic_trend of a stored plan still applies, to the revenue part', () => {
  const trend = { likely: 'bear', options: [{ id: 'bear', label: 'Bear market', pct: -20, why: 'x' }, { id: 'bull', label: 'Bull market', pct: 10, why: 'y' }] };
  const p = plan([REVENUE, COST], { economic_trend: trend });
  const base = total(p, {}).yearly;
  const revenue = base.parts.find((x) => x.id === 'revenue_uplift').amount * (base.attribution_pct / 100);
  const got = total(p, { economic_trend: { on: true, option: 'bear' } }).yearly;
  assert.ok(Math.abs(got.total.amount - (base.total.amount - revenue * 0.2)) < 0.05);
  assert.ok(got.parts.some((x) => x.label === 'Bear market' && x.pct === -20));
  assert.ok(total(p, { economic_trend: { on: true, option: 'nope' } }).errors.economic_trend);
});

test('F4: a pct outside a factor\'s bounds is clamped on the server; an unknown factor is refused', () => {
  const p = plan([REVENUE], { economic_factors: FACTORS });
  const base = total(p, {}).yearly;
  const revenue = base.parts[0].amount * (base.attribution_pct / 100);
  const high = total(p, { economic_factors: { confidence: on(99) } }).yearly;
  assert.equal(high.parts.find((x) => x.id === 'factor_confidence').pct, 15);
  assert.ok(Math.abs(high.total.amount - (base.total.amount + revenue * 0.15)) < 0.05);
  const low = total(p, { economic_factors: { confidence: on(-99) } }).yearly;
  assert.equal(low.parts.find((x) => x.id === 'factor_confidence').pct, -10);
  assert.ok(total(p, { economic_factors: { nope: on(1) } }).errors.economic_factors);
});

test('F5: the model reply is read into at most 6 bounded factors, and the prompt asks for them', () => {
  const raw = Array.from({ length: 8 }, (_, i) => ({ id: `f_${i}`, label: `Factor ${i}`, why: 'w', likely_pct: 90, min_pct: -90, max_pct: 30 }));
  raw.push({ id: 'Bad Id', label: 'x', likely_pct: 1, min_pct: 0, max_pct: 1 }, null);
  const got = VR.factorsFrom(raw);
  assert.equal(got.length, 6);
  assert.deepEqual([got[0].min_pct, got[0].max_pct, got[0].likely_pct], [-50, 30, 30], 'bounds limited to 50 and likely kept inside them');
  assert.deepEqual(VR.factorsFrom(null), []);
  const system = VR.anchorMessages({ useCase: { use_case: 'x' }, businessName: 'b', records: 10, range: { low: 1, high: 100 } })[0].content;
  assert.match(system, /economic_factors/);
  assert.doesNotMatch(system, /"economic_trend": null or/);
});
