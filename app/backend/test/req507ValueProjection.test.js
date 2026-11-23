// REQ-507 L2: backend/lib/valueProjection.js turns the gross yearly value into a business case: 3 years of low/likely/high with the
// capture ramp (default 40/80/100), net value after build and run cost, payback months and 3-year ROI. The preview and the saved yearly carry
// it as yearly.projection (the shape the generated docs already expect, fx113DocGen: yearly[{year, low, likely, high}]). Pure maths, no SQL.
const test = require('node:test');
const assert = require('node:assert/strict');
const { makeApp, listen } = require('./support/implementApp');

const VPJ = (() => {
  try {
    return require('../lib/valueProjection');
  } catch {
    return {};
  }
})();

const CASE = { gross: { low: 600000, likely: 1200000, high: 1800000 }, ramp_pct: [40, 80, 100], build_cost: 180000, run_cost_per_year: 60000 };

test('L2: the default ramp is 40/80/100 and projectionOf is exported', () => {
  assert.equal(typeof VPJ.projectionOf, 'function');
  assert.deepEqual(VPJ.DEFAULT_RAMP, [40, 80, 100]);
});

test('L2: 3 years of low/likely/high follow the ramp', () => {
  const p = VPJ.projectionOf(CASE);
  assert.deepEqual(p.years, [
    { year: 1, low: 240000, likely: 480000, high: 720000 },
    { year: 2, low: 480000, likely: 960000, high: 1440000 },
    { year: 3, low: 600000, likely: 1200000, high: 1800000 },
  ]);
});

test('L2: net over 3 years is gross minus build and run cost; ROI is net over cost; payback is the first month the build is paid back', () => {
  const p = VPJ.projectionOf(CASE);
  assert.equal(p.gross_3y, 2640000);
  assert.equal(p.cost_3y, 360000);
  assert.equal(p.net_3y, 2280000);
  assert.equal(p.roi_3y, 6.33);
  // Year 1: 480,000 / 12 = 40,000 a month less 5,000 run cost = 35,000 net a month; 5 months pay 175,000 < 180,000, 6 months pay 210,000.
  assert.equal(p.payback_months, 6);
  assert.equal(p.gross_only, false);
});

test('L2: with no costs the case stays labelled gross; payback and ROI are null, not invented', () => {
  const p = VPJ.projectionOf({ gross: CASE.gross });
  assert.equal(p.gross_only, true);
  assert.equal(p.payback_months, null);
  assert.equal(p.roi_3y, null);
  assert.equal(p.net_3y, 2640000);
  assert.deepEqual(p.years.map((y) => y.likely), [480000, 960000, 1200000]);
});

test('L2: a case that never pays back within 36 months says null; a bad ramp is refused', () => {
  const p = VPJ.projectionOf({ gross: { low: 10000, likely: 20000, high: 30000 }, build_cost: 5000000, run_cost_per_year: 1000 });
  assert.equal(p.payback_months, null);
  assert.ok(p.net_3y < 0);
  assert.throws(() => VPJ.projectionOf({ ...CASE, ramp_pct: [40, 80] }), /ramp/i);
  assert.throws(() => VPJ.projectionOf({ ...CASE, ramp_pct: [40, 180, 100] }), /ramp/i);
  assert.throws(() => VPJ.projectionOf({ ...CASE, build_cost: -1 }), /cost/i);
});

test('L2: low <= likely <= high in every year, even when the gross range comes in unordered', () => {
  const p = VPJ.projectionOf({ gross: { low: 1800000, likely: 1200000, high: 600000 } });
  for (const y of p.years) assert.ok(y.low <= y.likely && y.likely <= y.high, JSON.stringify(y));
});

// ---- wired into POST /value/preview (and so into the saved yearly) ----

const ORDERS = 'main.s.orders';
const PLAN = {
  case_noun: 'transaction', table: ORDERS, date_column: 'event_date', days: 365, grouping: 'region', groupings: [{ column: 'region', label: 'By region' }],
  groups: [{ g: 'north', records_per_year: 1000, metrics: {} }], metrics: [],
  drivers: [{ id: 'cost_cut', label: 'Fees avoided', verb: 'REDUCE COST', on: true, why: '', asks: [
    { id: 'spend_per_year', label: 'Spend', kind: 'money', source: 'estimate', default: 1000000, why: '' }, { id: 'cut_pct', label: 'Cut', kind: 'pct', source: 'estimate', default: 10, why: '' }] }],
};
const answers = (extra = {}) => ({ shape: 2, currency: 'USD', attribution_pct: 100, grouping: 'region', excluded_groups: [], calculated: false, plan: PLAN,
  drivers: { cost_cut: { on: true, inputs: { spend_per_year: 1000000, cut_pct: 10 } } }, ...extra });
async function preview(body) {
  const made = makeApp({ forwardedToken: 'person-tok' });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/value/preview`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
    return { status: resp.status, data: await resp.json(), sql: made.sqlCalls.length };
  } finally {
    await srv.close();
  }
}

test('L2 preview: answers.economics adds yearly.projection from the server total (ramp, net, payback, ROI) and runs no SQL', async () => {
  const got = await preview({ plan: PLAN, answers: answers({ economics: { ramp_pct: [40, 80, 100], build_cost: 20000, run_cost_per_year: 12000 } }) });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  const { yearly } = got.data;
  assert.equal(yearly.total.amount, 100000);
  const p = yearly.projection;
  assert.ok(p, 'projection present');
  assert.deepEqual(p.years.map((y) => y.likely), [40000, 80000, 100000]);
  assert.equal(p.net_3y, 220000 - 20000 - 36000);
  assert.equal(typeof p.payback_months, 'number');
  assert.equal(got.sql, 0);
});

test('L2 preview: without economics the projection still comes with the default ramp and is labelled gross', async () => {
  const got = await preview({ plan: PLAN, answers: answers() });
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.data.yearly.projection.years.map((y) => y.likely), [40000, 80000, 100000]);
  assert.equal(got.data.yearly.projection.gross_only, true);
});

test('L2 preview: a ramp share above 100 is a 400 that names the economics', async () => {
  const got = await preview({ plan: PLAN, answers: answers({ economics: { ramp_pct: [40, 180, 100] } }) });
  assert.equal(got.status, 400, JSON.stringify(got.data));
  assert.match(JSON.stringify(got.data), /ramp/i);
});
