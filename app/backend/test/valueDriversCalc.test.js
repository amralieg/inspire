// REQ-435: the amount each non-data driver is worth per year, the validation, and the total with attribution.
const test = require('node:test');
const assert = require('node:assert/strict');
const VDC = require('../lib/valueDriversCalc');

const bad = (message) => Object.assign(new Error(message), { statusCode: 400 });
const ALL = {
  time_saved: { events_per_year: 1200, people: 2, hours_before: 3, hours_after: 1, cost_per_hour: 150 },
  productivity: { headcount: 10, cost_per_person_year: 100000, gain_pct: 20 },
  revenue_uplift: { base_revenue_per_year: 1e6, uplift_pct: 5 },
  cost_cut: { spend_per_year: 500000, cut_pct: 10 },
  risk_avoided: { incidents_per_year: 4, cost_per_incident: 30000, reduction_pct: 50 },
};

test('A1: each driver is worth what its formula says', () => {
  assert.equal(VDC.amountOf('time_saved', ALL.time_saved), 720000);
  assert.equal(VDC.amountOf('productivity', ALL.productivity), 200000);
  assert.equal(VDC.amountOf('revenue_uplift', ALL.revenue_uplift), 50000);
  assert.equal(VDC.amountOf('cost_cut', ALL.cost_cut), 50000);
  assert.equal(VDC.amountOf('risk_avoided', ALL.risk_avoided), 60000);
});

test('A1: all five drivers plus 100000 from the data at 50% attribution total 590000 in six parts', () => {
  const out = VDC.combine({ drivers: ALL, attribution_pct: 50, currency: 'AED', data: { amount: 100000 } });
  assert.equal(out.total.amount, 590000);
  assert.equal(out.total.unit, 'AED');
  assert.equal(out.attribution_pct, 50);
  assert.equal(out.parts.length, 6);
  assert.deepEqual(out.parts.map((p) => p.source), ['data', ...Array(5).fill('assumption')]);
  assert.deepEqual(out.parts.map((p) => p.id), ['data', 'time_saved', 'productivity', 'revenue_uplift', 'cost_cut', 'risk_avoided']);
  assert.ok(out.parts.every((p) => p.unit === 'AED' && typeof p.label === 'string' && p.label));
});

test('a driver-only answer has no data part and attribution defaults to 100', () => {
  const out = VDC.combine({ drivers: { cost_cut: ALL.cost_cut }, currency: 'AED' });
  assert.deepEqual(out.parts.map((p) => p.id), ['cost_cut']);
  assert.equal(out.total.amount, 50000);
  assert.equal(out.attribution_pct, 100);
});

test('A2: a bad answer is refused with one plain line that names the field', () => {
  const cases = [
    [{ drivers: { time_saved: { ...ALL.time_saved, people: -1 } }, currency: 'AED' }, /Time saved.*People who work on it/],
    [{ drivers: { time_saved: { ...ALL.time_saved, people: 'abc' } }, currency: 'AED' }, /Time saved.*People who work on it/],
    [{ drivers: { time_saved: { ...ALL.time_saved, people: Number.NaN } }, currency: 'AED' }, /Time saved.*People who work on it/],
    [{ drivers: { time_saved: { ...ALL.time_saved, cost_per_hour: undefined } }, currency: 'AED' }, /Time saved.*Cost of one hour of work/],
    [{ drivers: { productivity: { ...ALL.productivity, gain_pct: 120 } }, currency: 'AED' }, /People productivity.*Time they get back/],
    [{ drivers: { cost_cut: ALL.cost_cut }, currency: 'AED', attribution_pct: 101 }, /Share of this value/],
    [{ drivers: { magic: { x: 1 } }, currency: 'AED' }, /magic/],
    [{ drivers: { cost_cut: ALL.cost_cut } }, /currency/i],
  ];
  for (const [answers, re] of cases) {
    assert.throws(() => VDC.validate(answers, bad), (err) => err.statusCode === 400 && re.test(err.message) && !err.message.includes('\n'), JSON.stringify(answers));
  }
});

test('a good answer validates to the filled drivers only', () => {
  const out = VDC.validate({ drivers: { cost_cut: ALL.cost_cut }, currency: 'AED', attribution_pct: 80 }, bad);
  assert.deepEqual(out, { drivers: { cost_cut: ALL.cost_cut }, currency: 'AED', attribution_pct: 80 });
  assert.equal(VDC.validate({ money: {} }, bad), null, 'no drivers means nothing to validate');
});
