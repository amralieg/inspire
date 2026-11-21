// REQ-454: one pool of money is counted once in every total; REQ-448: an estimate outside $100K-$100M is listed, not counted.
const test = require('node:test');
const assert = require('node:assert/strict');
const VT = require('../lib/valueTotals');
const VA = require('../lib/valueAnswers');
const VE = require('../lib/valueEstimate');
const IV = require('../lib/inspireValue');

const entry = (table, amount, { filter = null, calculated = false } = {}) => VA.versionOf({
  version: 1,
  answers: JSON.stringify({ shape: 2, currency: 'USD', attribution_pct: 100, calculated, plan: { table, case_filter: filter, groups: [{ g: 'a' }] } }),
  yearly: JSON.stringify({ verb: 'AVOID RISK', currency: 'USD', calculated, estimated: !calculated, total: { unit: 'USD', amount }, parts: [{ id: 'risk_avoided', label: 'Risk avoided', verb: 'AVOID RISK', amount }] }),
});
const fixture = (over = {}) => new Map(Object.entries({
  'N04-U02': entry('main.s.accounts', 10000000, { calculated: true }),
  'N04-U03': entry('`MAIN`.`s`.`Accounts`', 10000000),
  'N04-U04': entry('main.s.accounts', 4000000, { filter: { column: 'status', op: '=', value: 'closed' } }),
  'N01-U01': entry('main.s.loans', 25610000),
  'N05-U01': entry('main.s.cards', 638960000),
  ...over,
}));
const run = (saved) => VT.runOf({ ids: [...saved.keys()], saved, estimates: {}, measured: {}, noTable: new Set() });

test('the run counts 10M once, the filtered 4M, the loans 25.61M, and not the out-of-band estimate', () => {
  assert.equal(run(fixture()).run.totals[0].amount, 39610000);
});

test('the shared use case says who it shares with, and the counted one says who shares', () => {
  const got = run(fixture());
  assert.deepEqual(got.use_cases['N04-U03'].overlap, { counted: false, with: 'N04-U02', not_counted: 10000000 });
  assert.deepEqual(got.use_cases['N04-U02'].overlap, { counted: true, shared_with: ['N04-U03'] });
  assert.equal(got.run.n_shared, 1);
});

test('an out-of-band estimate is not counted, is listed in excluded and keeps its check', () => {
  const got = run(fixture());
  assert.equal(got.use_cases['N05-U01'].counted, false);
  assert.equal(got.use_cases['N05-U01'].check.outside, 'high');
  assert.deepEqual(got.run.excluded, [{ currency: 'USD', amount: 638960000, n: 1 }]);
});

test('a calculated out-of-band value is counted (the person confirmed it) and keeps its check', () => {
  const got = run(fixture({ 'N05-U01': entry('main.s.cards', 638960000, { calculated: true }) }));
  assert.equal(got.run.totals[0].amount, 678570000);
  assert.equal(got.use_cases['N05-U01'].check.outside, 'high');
});

test('mergeRuns counts the same pool of money once across runs', () => {
  const one = run(new Map([['N04-U02', entry('main.s.accounts', 10000000, { calculated: true })]]));
  const two = run(new Map([['N04-U02', entry('main.s.accounts', 10000000, { calculated: true })]]));
  const all = VT.mergeRuns([{ ...one.run }, { ...two.run }], [one.use_cases, two.use_cases]);
  assert.equal(all.totals[0].amount, 10000000);
});

test('estimate totals count one rule over one baseline once', () => {
  const e = { status: 'estimated', app: 'a1', per_record: 50, baseline: 1000, amount: 50000, currency: 'USD' };
  assert.equal(VE.totalsOf([e, { ...e }]).estimated.USD, 50000);
});

test('the overall stake CTE keeps one row per result table, not one per use case', () => {
  const sql = IV.valueOverallSql('t', 's');
  assert.match(sql, /PARTITION BY session_id, result_table, kind, currency, unit/);
  const stake = sql.slice(sql.indexOf('stake AS'), sql.indexOf('saved AS'));
  assert.doesNotMatch(stake, /use_case_id ORDER BY/);
});
