// FX-63b (review of FX-63): a saved Gains only rule with no sign builds (REQ-473 removed the sign screen), and a bulk value row
// carries the model review of its plan (REQ-472 c).
import test from 'node:test';
import assert from 'node:assert/strict';
import { defaultSpecFromUseCase, sectionErrors, withMoneyRule } from '../../src/lib/implementWizard.js';
import { specWithMeasure } from '../../src/lib/measureSettings.js';
import { runBulk, valueWorker } from '../../src/lib/valueBulk.js';

const base = defaultSpecFromUseCase({}, { warehouseId: 'wh', inspireDatabase: 'cat.sch', sessionId: 1 });
const OLD_GAINS = { rule: 'gains', currency: 'per_currency', value: { method: 'column', column: 'amount', currency: 'USD' } };

test('R1: a saved Gains only rule with no sign becomes the default rule, so the money section has no error and Build is on', () => {
  const spec = withMoneyRule(base, OLD_GAINS);
  assert.equal(spec.money.rule, undefined, 'the movement falls back to the default (losses)');
  assert.deepEqual(spec.money.value, OLD_GAINS.value, 'the value itself is kept');
  assert.deepEqual(sectionErrors('money', spec), [], 'no sign error blocks the build');
});

test('R1b: the saved value-wizard answers take the same path (measure settings carry an old Gains rule)', () => {
  const spec = specWithMeasure(base, { money: OLD_GAINS });
  assert.deepEqual(sectionErrors('money', spec), []);
});

test('R1c: a Gains only rule that has its sign stays Gains only', () => {
  const signed = { ...OLD_GAINS, sign: { column: 'delta' } };
  assert.equal(withMoneyRule(base, signed).money.rule, 'gains');
});

const REVIEW = { approved: true, model: 'm1', reason: 'fits', amount: 1000000, anchor: null, tuned: false };

test('R6: the bulk worker returns the review of the plan it saved, and the bulk row keeps it', async () => {
  const plan = { model: 'm1', drivers: [], groups: [], review: REVIEW };
  const worker = valueWorker({ apiPostJson: async () => ({ plan }), inspireDatabase: 'cat.sch', warehouseId: 'wh', sessionId: 1,
    save: async (_id, _table, answers) => ({ yearly: { total: { unit: 'USD', amount: 1000000 } }, answers }) });
  const got = await worker({ id: 'U1', table: 'a.b.c' });
  assert.deepEqual(got.review, REVIEW);
  const rows = await runBulk({ items: [{ id: 'U1' }], worker: async () => got });
  assert.deepEqual(rows[0].review, REVIEW, 'the done row carries the review');
});
