import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../src/format.js';
import { estimatedFigure, wrongFigure } from '../src/impact.js';
import { moneyText, savedTile, totals } from '../src/hub.js';
import { amountText, shownAmount, sumFormula } from '../src/money.js';
import { recordView, savingText } from '../src/records.js';
import { barsContext } from '../src/explain.js';

const ID = '2222222222222222222';
const EDGE = 2n ** 53n;
const COUNT = (EDGE + 1n).toString();
const g = (b) => b.toLocaleString('en-US');

test('a count that arrives as text is added as a number, never joined as digits', () => {
  assert.equal(F.addCounts([COUNT, 2]), (EDGE + 3n).toString());
  assert.equal(F.addCounts([COUNT, `-${COUNT}`]), 0);
  assert.equal(F.addCounts([0.1, 0.2]), 0.1 + 0.2);
  assert.equal(F.addCounts(['abc', null, '', undefined, 3]), 3);
  assert.equal(F.sumOf([{ n: ID }, { n: 1 }], (x) => x.n), (BigInt(ID) + 1n).toString());
  assert.equal(F.countOf(1e20), BigInt(1e20).toString());
  assert.equal(F.countOf(' 12.5 '), 12.5);
  assert.equal(F.numberOf(COUNT), Number(COUNT));
  assert.equal(F.percentOf(1, 3), 33);

  const estimated = estimatedFigure({ tracked: true, money: true, estimated: { 'Act now': { n: COUNT, money: ID }, Review: { n: 2, money: 3 } } }, 'USD');
  assert.equal(estimated.n, (EDGE + 3n).toString());
  assert.equal(estimated.value, `$${g(BigInt(ID) + 3n)}`);
  assert.equal(estimated.formula, `Act now $${g(BigInt(ID))} + Review $3 = $${g(BigInt(ID) + 3n)}`);
  const small = estimatedFigure({ tracked: true, money: true, estimated: { 'Act now': { n: 3, money: 10.5 }, Review: { n: 4, money: 2 } } }, 'USD');
  assert.equal(small.n, 7);
  assert.equal(small.value, '$13');

  const wrong = wrongFigure({ tracked: true, closed: { Dismissed: { n: 1 }, Done: { n: COUNT } } });
  assert.equal(wrong.n, (EDGE + 2n).toString());
  assert.equal(wrongFigure({ tracked: true, closed: { Dismissed: { n: 1 }, Done: { n: 3 } } }).value, '25%');
});

test('the Hub adds counts and money that arrive as text without losing digits', () => {
  const tile = savedTile([['a', { tracked: true, money: true, done: { saved: ID, saved_n: COUNT } }], ['b', { tracked: true, money: true, done: { saved: 5, saved_n: 1 } }]],
    [{ id: 'a' }, { id: 'b' }], {}, 'saved', null);
  assert.equal(tile.value, g(BigInt(ID) + 5n));
  assert.ok(tile.sub.includes(`${g(EDGE + 2n)} fixes`), tile.sub);

  assert.equal(moneyText(totals([{ money: ID, currency: 'USD' }, { money: 1, currency: 'USD' }, { money: 'abc', currency: 'USD' }])), `$${g(BigInt(ID) + 1n)}`);
  assert.equal(moneyText(totals([{ money: 5, currency: 'EUR' }, { money: ID, currency: 'USD' }])), `$${g(BigInt(ID))} + €5`);
});

test('every money amount is formatted the one way wholeMoney formats it, and sums keep every digit', () => {
  assert.equal(savingText(ID, 'USD'), `$${g(BigInt(ID))}`);
  assert.equal(savingText(1200, 'CAD'), F.wholeMoney(1200, 'CAD'));
  assert.equal(savingText(1200, 'CAD'), 'CAD 1,200');
  assert.equal(savingText(8400, 'USD'), '$8,400');
  assert.equal(savingText(8400.6, ''), '8,401');
  assert.equal(recordView({}, { value_at_stake: ID }, {}, {}, 'USD', '').saving.text, `$${g(BigInt(ID))}`);
  assert.equal(recordView({}, { value_at_stake: '' }, {}, {}, 'USD', '').saving, null);

  assert.equal(shownAmount({ money: ID }), ID);
  assert.equal(shownAmount({ money: '12' }), 12);
  assert.equal(amountText(ID, 'money', 'USD'), `${g(BigInt(ID))} USD`);
  assert.equal(amountText(1234.5, 'money', 'USD'), '1,234.5 USD');
  assert.ok(sumFormula([{ label: 'A', money: ID, currency: 'USD' }, { label: 'B', money: 1, currency: 'USD' }], 'Money at stake')
    .startsWith(`Money at stake: A $${g(BigInt(ID))} + B $1 = $${g(BigInt(ID) + 1n)}.`));
});

test('the context sent to Genie keeps a value that arrives as text', () => {
  const context = barsContext({ x: 'Kind', measure: 'Amount' }, [{ label: 'A', value: ID, text: 'x' }, { label: 'B', value: 7, text: 'y' }]);
  assert.deepEqual(context.rows.map((r) => r.Amount), [ID, 7]);
});

test('values sort by amount whether they arrive as numbers or as text', () => {
  const sorted = ['1.5', '1.25', 2, '-0.5', COUNT, null, ID, -3].sort(F.compareValues);
  assert.deepEqual(sorted, [-3, '-0.5', '1.25', '1.5', 2, COUNT, ID, null]);
  assert.equal(F.compareValues('abc', 'abd') < 0, true);
  assert.deepEqual([5, null, ID, 2, undefined, '7'].sort(F.largestFirst), [ID, '7', 5, 2, null, undefined]);
});
