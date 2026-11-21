// REQ-432: one helper turns a value measured on a sample of records into a value per year for all the eligible records.
// The measured path (GET /api/inspire/value/yearly) and the Calculate path (POST /api/inspire/value/estimate) both use it.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const load = () => require('../lib/valueYearly');

test('extrapolate scales by record count, then to a year: 1,000 over 100 of 10,000 records in 90 days is about 405,556 a year', () => {
  const { extrapolate } = load();
  const per = extrapolate({ amount: 1000, sampled: 100, eligible: 10000, days: 90 });
  assert.ok(Math.abs(per - 405555.56) < 0.01, `got ${per}`);
  assert.equal(extrapolate({ amount: 1000, sampled: 100, eligible: 100, days: 365 }), 1000, 'every record scored over a year changes nothing');
});

test('extrapolate returns null, never 0, when the basis is missing', () => {
  const { extrapolate } = load();
  for (const bad of [{ sampled: 0 }, { sampled: null }, { eligible: 0 }, { days: 0 }, { days: undefined }, { amount: 'x' }, { amount: null }]) {
    assert.equal(extrapolate({ amount: 1000, sampled: 100, eligible: 10000, days: 90, ...bad }), null, JSON.stringify(bad));
  }
});

test('the verb phrase comes from the KPI name and direction, with no fixed industry list', () => {
  const { valueVerb } = load();
  assert.equal(valueVerb({ kind: 'money', direction: 'increase', name: 'revenue' }), 'INCREASE REVENUE');
  assert.equal(valueVerb({ kind: 'money', direction: 'decrease', name: 'cost' }), 'REDUCE COST');
  assert.equal(valueVerb({ kind: 'time', unit: 'hours', direction: 'decrease', name: 'handling time' }), 'SAVE HOURS');
  assert.equal(valueVerb({ kind: 'money', direction: 'increase', name: 'seat occupancy' }), 'INCREASE SEAT OCCUPANCY');
  assert.equal(valueVerb({ kind: 'money', rule: 'losses' }), 'REDUCE LOSS', 'no KPI: the money rule names the movement');
});

test('yearlyOf scales each entry per currency and unit, never adding them together, and keeps the basis', () => {
  const { yearlyOf } = load();
  const got = yearlyOf({
    entries: [{ kind: 'money', unit: 'USD', amount: 1000 }, { kind: 'money', unit: 'EUR', amount: 100 }],
    sampled: 100, eligible: 10000, days: 90, kpi: { name: 'revenue', direction: 'increase' },
  });
  assert.equal(got.verb, 'INCREASE REVENUE');
  assert.equal(got.period, 'Per Year');
  assert.equal(got.estimated, true);
  assert.deepEqual(got.entries.map((e) => [e.kind, e.unit]), [['money', 'USD'], ['money', 'EUR']]);
  assert.ok(Math.abs(got.entries[0].amount - 405555.56) < 0.01);
  assert.ok(Math.abs(got.entries[1].amount - 40555.56) < 0.01);
  assert.deepEqual(got.basis, { sampled_records: 100, eligible_records: 10000, days: 90 });
  assert.equal(yearlyOf({ entries: [{ kind: 'money', unit: 'USD', amount: 1000 }], sampled: 0, eligible: 10, days: 10 }), null);
  assert.equal(yearlyOf({ entries: [], sampled: 1, eligible: 1, days: 1 }), null);
});

test('one helper: both value routes use it, and no second extrapolation exists in the backend or the frontend', () => {
  const root = path.join(__dirname, '..', '..');
  const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
  assert.match(read('backend/implementRoutes.js'), /require\('\.\/lib\/valueYearly'\)/);
  const defined = [];
  for (const dir of ['backend', 'backend/lib', 'frontend/src/lib', 'frontend/src/components', 'frontend/src/pages']) {
    for (const file of fs.readdirSync(path.join(root, dir))) {
      if (!/\.(js|jsx)$/.test(file) || /bundle/.test(file)) continue;
      if (/function extrapolate\b|extrapolate\s*=\s*(\(|async)/.test(read(`${dir}/${file}`))) defined.push(`${dir}/${file}`);
    }
  }
  assert.deepEqual(defined, ['backend/lib/valueYearly.js']);
});
