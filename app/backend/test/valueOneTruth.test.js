// FX-34 (REQ-448, REQ-454, REQ-441; W16 D5/D6/D7/D12/D18): an estimate comes from the use case's own table and drivers, or it is
// "not estimated" with a reason; a value saved before that is never shown as current; counted-once rows carry the amount they add.
const test = require('node:test');
const assert = require('node:assert/strict');
const VCP = require('../lib/valueCasePlan');
const VT = require('../lib/valueTotals');

const COLUMNS = [{ column_name: 'region', data_type: 'STRING' }, { column_name: 'event_date', data_type: 'DATE' }];
const yearlyOf = (amount, { calculated = false, verb = 'AVOID RISK', currency = 'USD' } = {}) => ({ verb, calculated, estimated: !calculated, currency,
  total: { unit: currency, amount }, parts: [{ id: 'risk_avoided', verb, amount }] });
// A shape-2 saved value. plan: the plan it was saved with (basis and use_case_id say whose plan it is).
const savedOf = (amount, plan, opts = {}) => ({ version: 1, answers: { shape: 2, currency: 'USD', calculated: Boolean(opts.calculated), plan }, yearly: yearlyOf(amount, opts) });
const planFor = (id, table, extra = {}) => ({ basis: VCP.PLAN_BASIS, use_case_id: id, table, case_filter: null, grouping: '', drivers: [], ...extra });

test('1a: the case-plan prompt names the use case, so two use cases on one table are planned apart', () => {
  assert.equal(typeof VCP.PLAN_BASIS, 'string', 'valueCasePlan exports the plan basis a current estimate carries');
  const a = VCP.planMessages({ table: 'c.s.orders', columns: COLUMNS, useCase: { id: 'N01-U01', use_case: 'Spot late supplier deliveries', statement: 'Late deliveries cost stock-outs.' } });
  const b = VCP.planMessages({ table: 'c.s.orders', columns: COLUMNS, useCase: { id: 'N01-U02', use_case: 'Price by buyer sensitivity', statement: 'Prices ignore demand.' } });
  const userA = a.find((m) => m.role === 'user').content;
  const userB = b.find((m) => m.role === 'user').content;
  assert.match(userA, /Spot late supplier deliveries/, userA);
  assert.match(userA, /Late deliveries cost stock-outs/, userA);
  assert.match(userB, /Price by buyer sensitivity/, userB);
  assert.notEqual(userA, userB, 'two use cases on one table send two different plan requests');
});

test('1a: two use cases with their own current plans keep their own estimates', () => {
  const saved = new Map([
    ['A', savedOf(4200000, planFor('A', 'c.s.orders', { case_filter: { column: 'status', op: '=', value: 'late' } }))],
    ['B', savedOf(910000, planFor('B', 'c.s.prices', { grouping: 'region' }), { verb: 'GROW REVENUE' })],
  ]);
  const got = VT.runOf({ ids: ['A', 'B'], saved, estimates: {}, noTable: new Set(), tables: { A: 'c.s.orders', B: 'c.s.prices' } });
  assert.equal(got.use_cases.A.status, 'estimated');
  assert.equal(got.use_cases.B.status, 'estimated');
  assert.notEqual(got.use_cases.A.amount, got.use_cases.B.amount);
  assert.deepEqual(got.run.totals, [{ currency: 'USD', amount: 5110000, calculated: 0, estimated: 5110000 }]);
});

test('1b: an estimate saved before the fix (no use-case basis) is not estimated, with a reason, and adds nothing', () => {
  const old = { version: 1, answers: { shape: 2, currency: 'USD', calculated: false, plan: { table: 'c.s.orders', drivers: [] } }, yearly: yearlyOf(25300000) };
  const copied = savedOf(25300000, planFor('OTHER', 'c.s.orders'));
  const saved = new Map([['OLD', old], ['COPY', copied], ['NEW', savedOf(3100000, planFor('NEW', 'c.s.orders'))]]);
  const got = VT.runOf({ ids: ['OLD', 'COPY', 'NEW', 'BARE'], saved, estimates: {}, noTable: new Set(['BARE']), tables: { OLD: 'c.s.orders', COPY: 'c.s.orders', NEW: 'c.s.orders' } });
  for (const id of ['OLD', 'COPY']) {
    const e = got.use_cases[id];
    assert.equal(e.status, 'not_estimated', `${id}: ${JSON.stringify(e)}`);
    assert.equal(e.amount, null, `${id} shows no shared default`);
    assert.equal(e.stale, true);
    assert.ok(String(e.reason || '').length > 10, `${id} says why: ${e.reason}`);
  }
  assert.equal(got.use_cases.BARE.status, 'no_data');
  assert.ok(String(got.use_cases.BARE.reason || '').length > 10, 'a use case with no usable table says why');
  assert.deepEqual(got.run.totals, [{ currency: 'USD', amount: 3100000, calculated: 0, estimated: 3100000 }], 'only the current estimate counts');
  assert.equal(got.run.n_estimated, 1);
});

test('1b: a calculated value keeps counting (the person checked its numbers), whatever its plan basis', () => {
  const calc = { version: 2, answers: { shape: 2, currency: 'USD', calculated: true, plan: { table: 'c.s.orders' } }, yearly: yearlyOf(6800000, { calculated: true }) };
  const got = VT.runOf({ ids: ['C'], saved: new Map([['C', calc]]), estimates: {}, noTable: new Set(), tables: { C: 'c.s.orders' } });
  assert.equal(got.use_cases.C.status, 'calculated');
  assert.equal(got.run.totals[0].amount, 6800000);
});

test('1d: counted-once rows report the amount they add, and those amounts sum to the total', () => {
  const plan = (id) => planFor(id, 'c.s.orders');
  const saved = new Map([
    ['A', savedOf(6800000, plan('A'), { calculated: true })],
    ['B', savedOf(25300000, plan('B'))],
    ['C', savedOf(25300000, plan('C'))],
    ['D', savedOf(900000, planFor('D', 'c.s.prices'), { verb: 'GROW REVENUE' })],
  ]);
  const got = VT.runOf({ ids: ['A', 'B', 'C', 'D'], saved, estimates: {}, noTable: new Set(), tables: { A: 'c.s.orders', B: 'c.s.orders', C: 'c.s.orders', D: 'c.s.prices' } });
  const entries = Object.values(got.use_cases);
  assert.ok(entries.every((e) => Number.isFinite(e.counted_amount)), `every valued row has counted_amount: ${JSON.stringify(got.use_cases)}`);
  const sum = Math.round(entries.reduce((s, e) => s + e.counted_amount, 0) * 100) / 100;
  assert.equal(sum, got.run.totals[0].amount, 'the visible counted-in parts add up to the run total');
  assert.ok(got.run.n_shared >= 1, 'the three rows on one table share one pool');
  assert.ok(entries.some((e) => e.counted_amount === 0 && e.overlap && e.overlap.counted === false), 'a shared row adds 0');
});

test('1c: runValueOf is the one run value: totals and counts, the same for one run and for runs merged', () => {
  assert.equal(typeof VT.runValueOf, 'function');
  const saved = new Map([['A', savedOf(6800000, planFor('A', 'c.s.orders'), { calculated: true })], ['B', savedOf(900000, planFor('B', 'c.s.prices'))]]);
  const got = VT.runOf({ ids: ['A', 'B', 'X'], saved, estimates: {}, noTable: new Set(), tables: { A: 'c.s.orders', B: 'c.s.prices' } });
  const value = VT.runValueOf(got.use_cases);
  assert.deepEqual(value, { totals: got.run.totals, n: 3, n_calculated: 1, n_estimated: 1, n_measured: 0, n_none: 1, n_shared: 0, saved: [], kinds: [], n_mvps: 0 });
  assert.deepEqual(VT.mergedRunValueOf([got.use_cases]), value, 'one run merged is the same run value');
});
