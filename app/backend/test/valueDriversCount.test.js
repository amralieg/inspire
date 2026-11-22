// REQ-476: every value input counts; time_saved takes one input, hours_saved; legacy before/after answers still compute.
const test = require('node:test');
const assert = require('node:assert/strict');
const VDC = require('../lib/valueDriversCalc');

const BASE = {
  events_per_year: 1000, people: 2, hours_saved: 1.5, cost_per_hour: 50, headcount: 10, cost_per_person_year: 60000, gain_pct: 10,
  base_revenue_per_year: 1000000, uplift_pct: 5, spend_per_year: 1000000, cut_pct: 10, incidents_per_year: 100, cost_per_incident: 1000, reduction_pct: 30,
};
const bad = (message) => Object.assign(new Error(message), { statusCode: 400 });

test('every input of every driver changes the amount when changed alone', () => {
  for (const d of VDC.DEFINITION.drivers) {
    const fixed = Object.fromEntries(d.inputs.map((i) => [i.id, BASE[i.id]]));
    assert.ok(d.inputs.every((i) => BASE[i.id] !== undefined), `${d.id} has an input the test has no base for`);
    const before = VDC.amountOf(d.id, fixed);
    assert.ok(before > 0, d.id);
    for (const i of d.inputs) {
      const after = VDC.amountOf(d.id, { ...fixed, [i.id]: fixed[i.id] * 0.5 });
      assert.notEqual(after, before, `${d.id}.${i.id} does not change the amount`);
    }
  }
});

test('time_saved has exactly one hours input, hours_saved', () => {
  const ids = VDC.DEFINITION.drivers.find((d) => d.id === 'time_saved').inputs.map((i) => i.id);
  assert.deepEqual(ids, ['events_per_year', 'people', 'hours_saved', 'cost_per_hour']);
});

test('time_saved with hours_saved 1.8, 8352 events, 1 person, 104 an hour is 1563494.4', () => {
  const v = VDC.amountOf('time_saved', { events_per_year: 8352, people: 1, hours_saved: 1.8, cost_per_hour: 104 });
  assert.ok(Math.abs(v - 1563494.4) < 0.01, String(v));
});

test('legacy hours_before 2 / hours_after 1 equals hours_saved 1; before < after gives 0, no throw', () => {
  const rest = { events_per_year: 1000, people: 2, cost_per_hour: 50 };
  assert.equal(VDC.amountOf('time_saved', { ...rest, hours_before: 2, hours_after: 1 }), VDC.amountOf('time_saved', { ...rest, hours_saved: 1 }));
  assert.equal(VDC.amountOf('time_saved', { ...rest, hours_before: 1, hours_after: 2 }), 0);
  const out = VDC.validate({ currency: 'USD', drivers: { time_saved: { ...rest, hours_before: 1, hours_after: 2 } } }, bad);
  assert.equal(VDC.combine(out).parts[0].amount, 0);
});
