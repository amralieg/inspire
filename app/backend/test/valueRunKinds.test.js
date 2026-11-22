// FX-34b (REQ-078, REQ-096, REQ-451): the one run value also carries what was saved, the non-money kinds, and the number of MVPs it is from.
const test = require('node:test');
const assert = require('node:assert/strict');
const VT = require('../lib/valueTotals');

const measured = { verb: 'REDUCE COST', entries: [{ kind: 'money', unit: 'AED', amount: 9000 }] };
const ledger = {
  a: { at_stake: [{ kind: 'money', unit: 'AED', amount: 6000 }, { kind: 'time', unit: 'hours', amount: 80 }], saved: [{ kind: 'money', unit: 'AED', amount: 1000 }], measured: true },
  b: { at_stake: [{ kind: 'money', unit: 'AED', amount: 3000 }, { kind: 'time', unit: 'hours', amount: 40 }], saved: [{ kind: 'money', unit: 'AED', amount: 500 }], measured: true },
  c: { at_stake: [], saved: [], measured: false },
};
const run = () => VT.runOf({ ids: ['a', 'b', 'c'], saved: new Map(), estimates: {}, measured: { a: measured, b: measured }, noTable: new Set(), ledger });

test('the run value carries saved, the non-money kinds and the MVP count', () => {
  const v = VT.runValueOf(run().use_cases);
  assert.deepEqual(v.saved, [{ kind: 'money', unit: 'AED', amount: 1500 }]);
  assert.deepEqual(v.kinds, [{ kind: 'time', unit: 'hours', amount: 120 }]);
  assert.equal(v.n_mvps, 2);
});

test('a run with no measured MVP has none of them, and the old reply is unchanged', () => {
  const v = VT.runValueOf(VT.runOf({ ids: ['a'], saved: new Map(), estimates: {}, noTable: new Set() }).use_cases);
  assert.deepEqual([v.saved, v.kinds, v.n_mvps], [[], [], 0]);
  assert.deepEqual(VT.runValueOf({}).totals, []);
});

test('several runs merge to one value that adds saved, kinds and MVPs', () => {
  const one = run().use_cases;
  const v = VT.mergedRunValueOf([one, run().use_cases]);
  assert.deepEqual(v.saved, [{ kind: 'money', unit: 'AED', amount: 3000 }]);
  assert.deepEqual(v.kinds, [{ kind: 'time', unit: 'hours', amount: 240 }]);
  assert.equal(v.n_mvps, 4);
});
