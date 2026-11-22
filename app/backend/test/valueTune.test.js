// REQ-472: scaleToTarget moves the money estimate inputs of the ON drivers so the plan's default yearly lands on the reviewer's amount.
const test = require('node:test');
const assert = require('node:assert/strict');
const VCP = require('../lib/valueCasePlan');

const ask = (id, kind, def) => ({ id, label: id, kind, source: 'estimate', default: def, why: 'x' });
const plan = {
  case_noun: 'order', groupings: [], metrics: [], groups: [],
  drivers: [
    { id: 'revenue_uplift', label: 'Uplift', on: true, asks: [ask('base_revenue_per_year', 'money', 41000000), ask('uplift_pct', 'pct', 50)] },
    { id: 'cost_cut', label: 'Cut', on: true, asks: [ask('spend_per_year', 'money', 2000000), ask('cut_pct', 'pct', 10)] },
    { id: 'productivity', label: 'Productivity', on: false, asks: [ask('headcount', 'count', 10), ask('cost_per_person_year', 'money', 60000), ask('gain_pct', 'pct', 10)] },
  ],
};
const yearlyOf = (p) => VCP.yearlyOf(p, { currency: 'USD' }).yearly.total.amount;

test('scaleToTarget lands within 1% of the target; the OFF driver and the pct inputs are untouched', () => {
  const before = yearlyOf(plan);
  assert.ok(before > 20000000);
  const scaled = VCP.scaleToTarget(plan, 600000);
  assert.ok(Math.abs(yearlyOf(scaled) - 600000) <= 6000, `got ${yearlyOf(scaled)}`);
  assert.deepEqual(scaled.drivers[2], plan.drivers[2]);
  assert.equal(scaled.drivers[0].asks[1].default, 50);
  assert.notEqual(scaled.drivers[0].asks[0].default, 41000000);
});

test('scaleToTarget gives null when there is nothing to scale or no target', () => {
  assert.equal(VCP.scaleToTarget(plan, 0), null);
  assert.equal(VCP.scaleToTarget({ ...plan, drivers: plan.drivers.map((d) => ({ ...d, on: false })) }, 1000), null);
});
