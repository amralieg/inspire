// REQ-586a (T-VAL-DRY-03): one value engine. POST /api/inspire/value/preview with { spec } answers { value: calculateValue(spec) }
// from app/frontend/src/lib/valueFormula.js on every case of app/shared/value_spec_fixtures.json (refused cases included), and the
// typed-driver amounts of the user-edit path (valueDriversCalc.amountOf) are calculateValue(driverSpec(id, inputs)).scenarios.base.gross_annual.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { readFileSync } = require('node:fs');
const { makeApp, listen } = require('./support/implementApp');
const VF = require('../../frontend/src/lib/valueFormula.js');
const VDC = require('../lib/valueDriversCalc');

const DATA = JSON.parse(readFileSync(path.join(__dirname, '../../shared/value_spec_fixtures.json'), 'utf8'));
const SESSION = { business_name: 'Acme', discovery_type: 'Deep', catalogs: 'main', schemas_str: 's', tables_str: 'main.s.orders',
  inspire_database_name: 'main.inspire', generation_path: '/tmp/out', table_scope: JSON.stringify({}) };
const asJson = (v) => JSON.parse(JSON.stringify(v));

async function preview(made, body) {
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/value/preview`, { method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-forwarded-email': 'person@example.com' }, body: JSON.stringify(body) });
    return { status: resp.status, data: await resp.json() };
  } finally {
    await srv.close();
  }
}

test('valueFormula.js exports calculateValue and driverSpec, the one engine the server uses', () => {
  assert.equal(typeof VF.calculateValue, 'function', 'src/lib/valueFormula.js exports no calculateValue(spec)');
  assert.equal(typeof VF.driverSpec, 'function', 'src/lib/valueFormula.js exports no driverSpec(id, inputs, currency)');
});

for (const c of DATA.cases) {
  test(`preview { spec } = calculateValue(spec): ${c.id}`, async () => {
    assert.equal(typeof VF.calculateValue, 'function', 'no calculateValue export');
    const made = makeApp({ forwardedToken: 'person-tok', session: SESSION });
    const got = await preview(made, { spec: c.spec });
    assert.equal(got.status, 200, JSON.stringify(got.data));
    assert.ok(got.data && got.data.value, `no "value" in the reply: ${JSON.stringify(got.data)}`);
    assert.deepStrictEqual(got.data.value, asJson(VF.calculateValue(c.spec)));
    assert.equal(got.data.value.ok, c.expected.ok);
    assert.deepEqual([...got.data.value.problems].sort(), [...c.expected.problems].sort());
    assert.equal(made.sqlCalls.length, 0, 'a spec preview runs no SQL');
  });
}

// The current driver formulas (REQ-435/476) are the behaviour to keep: same amount, now priced by the spec engine.
const DRIVERS = [
  ['time_saved', { events_per_year: 100, people: 2, hours_saved: 1.5, cost_per_hour: 40 }, 12000, 'cost'],
  ['time_saved', { events_per_year: 10, people: 2, hours_before: 5, hours_after: 3, cost_per_hour: 50 }, 2000, 'cost'],
  ['productivity', { headcount: 10, cost_per_person_year: 50000, gain_pct: 5 }, 25000, 'cost'],
  ['revenue_uplift', { base_revenue_per_year: 2000000, uplift_pct: 3 }, 60000, 'revenue'],
  ['cost_cut', { spend_per_year: 400000, cut_pct: 10 }, 40000, 'cost'],
  ['risk_avoided', { incidents_per_year: 20, cost_per_incident: 5000, reduction_pct: 30 }, 30000, 'risk'],
];
for (const [id, inputs, amount, mechanism] of DRIVERS) {
  test(`driver ${id} ${JSON.stringify(inputs)}: amountOf = calculateValue(driverSpec).scenarios.base.gross_annual = ${amount}`, () => {
    assert.equal(typeof VF.driverSpec, 'function', 'no driverSpec export');
    const spec = VF.driverSpec(id, inputs, 'USD');
    assert.equal(spec.mechanism, mechanism);
    const out = VF.calculateValue(spec);
    assert.equal(out.ok, true, JSON.stringify(out.problems));
    const gross = out.scenarios.base.gross_annual;
    assert.ok(Math.abs(gross - amount) <= 0.01, `gross_annual ${gross} != ${amount}`);
    assert.equal(VDC.amountOf(id, inputs), gross, 'valueDriversCalc.amountOf is not the spec engine');
  });
}
