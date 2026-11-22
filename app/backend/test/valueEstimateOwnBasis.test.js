const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../lib/valueEstimate');

// FX-48 (REQ-448, REQ-431; W17 D42): each estimate comes from the use case's own spec and baseline, never a sibling's rate.
const spec = (name, amount, table = 'main.inspire.shared') => ({
  use_case_name: name,
  money: { currency: 'convert', base: 'AED', value: { method: 'fixed', amount, currency: 'AED' } },
  config: { result_table: table },
});
const bare = (table = 'main.inspire.shared') => ({ config: { result_table: table } });
const ucs = (n) => Array.from({ length: n }, (_, i) => ({ id: `N01-U0${i + 1}`, business_domain: 'Sales' }));

test('two use cases with different specs on the same table get different estimates', async () => {
  const specs = new Map([['N01-U01', spec('Alpha App', 10)], ['N01-U02', spec('Beta App', 50)]]);
  const out = await V.estimatesFor({ useCases: ucs(2), specs, measured: {}, baselineOf: async () => 100 });
  assert.equal(out.use_cases['N01-U01'].amount, 1000);
  assert.equal(out.use_cases['N01-U02'].amount, 5000);
  assert.deepEqual(out.totals, { estimated: { AED: 6000 } });
});

test('a use case with no spec of its own gets no estimate, and no baseline is read for it', async () => {
  const reads = [];
  const specs = new Map([['N01-U01', spec('Alpha App', 10)]]);
  const out = await V.estimatesFor({ useCases: ucs(2), specs, measured: {}, baselineOf: async (t, id) => { reads.push(id); return 100; } });
  assert.deepEqual(out.use_cases['N01-U02'], { status: 'set_rule' });
  assert.deepEqual(reads, ['N01-U01']);
});

test('the W10 shape: six use cases that only share one sibling rule and one baseline no longer give six equal values', async () => {
  const specs = new Map([['N01-U01', spec('Alpha App', 7.92)]]);
  for (let i = 2; i <= 7; i += 1) specs.set(`N01-U0${i}`, bare());
  const out = await V.estimatesFor({ useCases: ucs(7), specs, measured: {}, baselineOf: async () => 100000 });
  const estimated = Object.values(out.use_cases).filter((e) => e && e.status === 'estimated');
  assert.equal(estimated.length, 1, 'only the use case that owns the rule is estimated');
  assert.deepEqual(out.totals, { estimated: { AED: 792000 } });
});

test('equal inputs may give equal values, and the second card names the use case it shares with', async () => {
  const specs = new Map([['N01-U01', spec('Same App', 10)], ['N01-U02', spec('Same App', 10)]]);
  const out = await V.estimatesFor({ useCases: ucs(2), specs, measured: {}, baselineOf: async () => 100 });
  assert.equal(out.use_cases['N01-U01'].amount, 1000);
  assert.equal(out.use_cases['N01-U02'].amount, 1000);
  assert.equal(out.use_cases['N01-U01'].shares_with, undefined);
  assert.equal(out.use_cases['N01-U02'].shares_with, 'N01-U01');
  assert.deepEqual(out.totals, { estimated: { AED: 1000 } }, 'one pool of money is counted once');
});
