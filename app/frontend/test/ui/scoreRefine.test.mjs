// REQ-433: the score refinement helper. A lower-scored use case worth at least 1.5x a higher-scored one moves just above it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { refineScores, REFINE_RATIO } from '../../src/lib/scoreRefine.js';

const usd = (amount) => [{ kind: 'money', unit: 'USD', amount }];
const uc = (id, score, entries) => ({ id, name: `Use case ${id}`, score, entries });
const moves = (items) => Object.fromEntries(refineScores(items).changes.map((c) => [c.id, [c.from, c.to]]));

test('a pair: 8.5 worth $3M against 9.0 worth $1M moves the 8.5 to 9.05', () => {
  const got = refineScores([uc('A', 9, usd(1e6)), uc('B', 8.5, usd(3e6))]);
  assert.deepEqual(moves([uc('A', 9, usd(1e6)), uc('B', 8.5, usd(3e6))]), { B: [8.5, 9.05] });
  assert.equal(got.pairs.length, 1);
  assert.equal(got.pairs[0].lower.id, 'B');
  assert.equal(got.pairs[0].higher.id, 'A');
  assert.equal(Math.round(got.pairs[0].ratio), 3);
});

test('a score that already follows the value is left alone, and so is a use case with no value', () => {
  assert.deepEqual(refineScores([uc('A', 9, usd(3e6)), uc('B', 8.5, usd(1e6))]).changes, []);
  assert.deepEqual(refineScores([uc('A', 9, usd(1e6)), uc('B', 8.5, [])]).changes, []);
  assert.deepEqual(refineScores([uc('A', 9, usd(1e6)), uc('B', 8.5, null)]).changes, []);
});

test('the trigger is 1.5x: exactly 1.5x refines, just under does not', () => {
  assert.equal(REFINE_RATIO, 1.5);
  assert.deepEqual(moves([uc('A', 9, usd(1e6)), uc('B', 8.5, usd(1.5e6))]), { B: [8.5, 9.05] });
  assert.deepEqual(refineScores([uc('A', 9, usd(1e6)), uc('B', 8.5, usd(1.49e6))]).changes, []);
});

test('a chain applies in value order: B goes above A, then C goes above B, with the fewest changes', () => {
  const items = [uc('A', 9, usd(1e6)), uc('B', 8.5, usd(3e6)), uc('C', 8, usd(9e6))];
  assert.deepEqual(moves(items), { B: [8.5, 9.05], C: [8, 9.1] });
});

test('only the out-of-order use cases move: a use case already above the ones it beats keeps its score', () => {
  const items = [uc('A', 9.5, usd(1e6)), uc('B', 9, usd(1.2e6)), uc('C', 8.5, usd(3e6))];
  assert.deepEqual(moves(items), { C: [8.5, 9.55] });
});

test('the new score is rounded to 2 decimals and capped at 10', () => {
  assert.deepEqual(moves([uc('A', 9.33, usd(1e6)), uc('B', 8, usd(5e6))]), { B: [8, 9.38] });
  assert.deepEqual(moves([uc('A', 10, usd(1e6)), uc('B', 8, usd(5e6))]), { B: [8, 10] });
  assert.deepEqual(moves([uc('A', 9.98, usd(1e6)), uc('B', 8, usd(5e6))]), { B: [8, 10] });
});

test('currencies and units are never mixed: USD against EUR, or money against a count, never triggers', () => {
  const eur = [{ kind: 'money', unit: 'EUR', amount: 9e6 }];
  const hours = [{ kind: 'time', unit: 'hours', amount: 9e6 }];
  assert.deepEqual(refineScores([uc('A', 9, usd(1e6)), uc('B', 8.5, eur)]).changes, []);
  assert.deepEqual(refineScores([uc('A', 9, usd(1e6)), uc('B', 8.5, hours)]).changes, []);
  assert.deepEqual(moves([uc('A', 9, [...usd(1e6), ...eur]), uc('B', 8.5, [{ kind: 'money', unit: 'EUR', amount: 9e7 }])]), { B: [8.5, 9.05] });
});

test('REQ-433: a pair in different sort tiers is never offered, the same items in one tier are', () => {
  const tiered = (tierA, tierB) => [{ ...uc('A', 9, usd(1e6)), tier: tierA }, { ...uc('B', 8.5, usd(3e6)), tier: tierB }];
  const apart = refineScores(tiered('meets', 'below'));
  assert.deepEqual(apart.changes, []);
  assert.deepEqual(apart.pairs, []);
  const together = refineScores(tiered('meets', 'meets'));
  assert.deepEqual(together.changes.map((c) => [c.id, c.from, c.to]), [['B', 8.5, 9.05]]);
  assert.equal(together.pairs.length, 1);
});
