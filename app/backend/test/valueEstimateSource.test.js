const test = require('node:test');
const assert = require('node:assert/strict');
const V = require('../lib/valueEstimate');
const VT = require('../lib/valueTotals');
const VA = require('../lib/valueAnswers');

// FX-48b (REQ-448, REQ-431; W17 D42): the W10 run's six equal $791,561.47 cards were saved answers of the older shape (no plan, no
// shape 2): one typed driver set and the default "1 per record" rule over one table. An older-shape estimate was made for no use case's
// own data, so it is "not estimated", never a number (the same rule FX-34 holds for a shape-2 estimate without its own plan).
const legacy = (amount, { calculated = false } = {}) => VA.versionOf({
  version: 1,
  answers: JSON.stringify({ money: { currency: 'per_currency', value: { method: 'fixed', amount: 1, currency: 'USD' } }, currency: 'USD', drivers: { time_saved: { events_per_year: 1200 } }, attribution_pct: 100 }),
  yearly: JSON.stringify({ verb: 'VALUE AT STAKE', currency: 'USD', calculated, estimated: !calculated, total: { unit: 'USD', amount }, parts: [{ source: 'data', id: 'data', amount: 71561.47 }, { source: 'assumption', id: 'time_saved', amount: 720000 }] }),
});

test('six use cases with equal older-shape saved estimates are not estimated, and add nothing', () => {
  const ids = ['N02-U01', 'N03-U01', 'N06-U01', 'N06-U02', 'N07-U01', 'N08-U01'];
  const saved = new Map(ids.map((id) => [id, legacy(791561.47)]));
  const got = VT.runOf({ ids, saved, estimates: {}, measured: {}, noTable: new Set(), tables: Object.fromEntries(ids.map((id) => [id, 'c.s.t'])) });
  for (const id of ids) {
    assert.equal(got.use_cases[id].status, 'not_estimated', id);
    assert.equal(got.use_cases[id].amount, null, id);
  }
  assert.deepEqual(got.run.totals, []);
  assert.equal(got.run.n_estimated, 0);
});

test('an older-shape saved estimate does not hide the use case own rule estimate', () => {
  const estimate = { status: 'estimated', app: 'A', currency: 'USD', per_record: 5, baseline: 100, amount: 500 };
  const got = VT.useCaseOf({ id: 'N01-U01', saved: legacy(791561.47), estimate, hasTable: true, table: 'c.s.t' });
  assert.equal(got.status, 'estimated');
  assert.equal(got.amount, 500);
});

test('shares_with and the total key on currency, per-record rate and baseline, not on the use case name', async () => {
  const spec = (name) => ({ use_case_name: name, money: { currency: 'convert', base: 'AED', value: { method: 'fixed', amount: 10, currency: 'AED' } }, config: { result_table: 'main.s.t' } });
  const specs = new Map([['N01-U01', spec('Alpha App')], ['N01-U02', spec('Beta App')]]);
  const useCases = [{ id: 'N01-U01' }, { id: 'N01-U02' }];
  const out = await V.estimatesFor({ useCases, specs, measured: {}, baselineOf: async () => 100 });
  assert.equal(out.use_cases['N01-U02'].shares_with, 'N01-U01');
  assert.deepEqual(out.totals, { estimated: { AED: 1000 } });
});
