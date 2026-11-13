import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZERO_TITLE, checkedNote, cutoffNote, zeroRule } from '../src/zeroState.js';

const CUTOFF = 'Reads rows dated before 2026-11-12; rows on 2026-11-12 are left out because that day may be incomplete.';

test('the cut-off sentence is read from the stored run summary the page already loads', () => {
  assert.equal(cutoffNote({ run: { summary: `Three exceptions this week. ${CUTOFF}` } }), CUTOFF);
  assert.equal(cutoffNote({ run: { summary: CUTOFF } }), CUTOFF);
});

test('the cut-off sentence with its count of left-out rows is read from the stored summary, wherever the summary is shown', () => {
  const counted = 'Reads rows dated before 2026-11-12; 3,333 rows on 2026-11-12 are left out because that day may be incomplete.';
  assert.equal(cutoffNote({ run: { summary: `Three exceptions this week. ${counted}` } }), counted);
  assert.equal(cutoffNote({ run: { summary: `${counted} Nothing is on the to fix list.` } }), counted);
});

test('a cut-off over several tables is read whole, though its table names carry full stops', () => {
  const several = 'Reads rows dated before 2026-11-12; rows on 2026-11-12 are left out of main.inspire.orders (14 rows) and main.inspire.returns (0 rows) because that day may be incomplete.';
  assert.equal(cutoffNote({ run: { summary: `Two tables read. ${several} Nothing is on the to fix list.` } }), several);
});

test('no cut-off sentence in the summary means no note, not a made-up one', () => {
  assert.equal(cutoffNote({ run: { summary: 'Three exceptions this week.' } }), '');
  assert.equal(cutoffNote({ run: null }), '');
  assert.equal(cutoffNote(null), '');
});

test('the zero-state title is generic and carries no number', () => {
  assert.equal(ZERO_TITLE, 'No matching records found in this data');
});

test('the rule is the decision-list definition the page holds, and no line when it holds none', () => {
  assert.equal(zeroRule({ records: { hint: 'Items from the latest run, ranked by loss.' }, question: 'Which items?' }), 'Items from the latest run, ranked by loss.');
  assert.equal(zeroRule({ question: 'Which items?' }), '');
});

test('the checked-row line shows the count the run wrote, and no line when the count is missing or not a whole number', () => {
  assert.equal(checkedNote({ charts: ['by_category'], rows_checked: 3333 }), '3,333 rows checked');
  assert.equal(checkedNote({ rows_checked: 0 }), '0 rows checked');
  assert.equal(checkedNote({ rows_checked: null }), '');
  assert.equal(checkedNote({ charts: ['by_category'] }), '');
  assert.equal(checkedNote({ rows_checked: '3333' }), '', 'a count sent as text is not shown');
  assert.equal(checkedNote({ rows_checked: 2.5 }), '');
  assert.equal(checkedNote(null), '');
});
