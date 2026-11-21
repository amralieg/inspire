// REQ-457: the MVP measure settings (money, target KPI, hold back) move between the build spec and the saved answers.
import test from 'node:test';
import assert from 'node:assert/strict';
import { MEASURE_FIELDS, measureAnswersOf, measureOfSaved, measureRows, specWithMeasure } from '../../src/lib/measureSettings.js';
import { defaultSpecFromUseCase } from '../../src/lib/implementWizard.js';

const base = defaultSpecFromUseCase({}, { warehouseId: 'wh', inspireDatabase: 'cat.sch', sessionId: 1 });
const money = { rule: 'gains', sign: { column: 'delta' }, currency: 'per_currency', value: { method: 'column', column: 'amount' } };
const spec = { ...base, money, kpi: { target: 'Churn rate' }, holdout: { enabled: true, share: 0.1 } };

test('1: the measure fields are money, kpi, holdout', () => assert.deepEqual(MEASURE_FIELDS, ['money', 'kpi', 'holdout']));
test('2: the spec becomes saved answers', () => {
  assert.deepEqual(measureAnswersOf(spec), { money, kpi: { name: 'Churn rate' }, holdout: { enabled: true, share: 0.1 } });
  assert.deepEqual(measureAnswersOf(base), {});
});
test('3: saved answers become the spec, and the round trip is exact', () => {
  const back = specWithMeasure(base, measureAnswersOf(spec));
  assert.deepEqual({ money: back.money, kpi: back.kpi, holdout: back.holdout }, { money, kpi: { target: 'Churn rate' }, holdout: { enabled: true, share: 0.1 } });
  assert.deepEqual(specWithMeasure(spec, {}), spec, 'absent answers leave the spec as it is');
});
test('4: one row per setting, in order; sign only for gains', () => {
  assert.deepEqual(measureRows(spec).map((r) => r.id), ['method', 'direction', 'sign', 'currency', 'window', 'off', 'kpi', 'holdout']);
  assert.ok(!measureRows({ ...spec, money: { ...money, rule: 'losses' } }).some((r) => r.id === 'sign'));
  assert.ok(measureRows(spec).every((r) => r.label && typeof r.summary === 'string'));
});
test('5: the carry-through keeps only the measure fields', () => {
  assert.deepEqual(measureOfSaved({ shape: 2, drivers: {}, money, holdout: { enabled: false, share: 0.1 } }), { money, holdout: { enabled: false, share: 0.1 } });
  assert.deepEqual(measureOfSaved(null), {});
});
