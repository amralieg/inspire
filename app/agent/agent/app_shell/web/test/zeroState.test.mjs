import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ZERO_TITLE, cutoffNote, zeroRule } from '../src/zeroState.js';

const CUTOFF = 'Reads rows dated before 2026-11-12; rows on 2026-11-12 are left out because that day may be incomplete.';

test('the cut-off sentence is read from the stored run summary the page already loads', () => {
  assert.equal(cutoffNote({ run: { summary: `Three exceptions this week. ${CUTOFF}` } }), CUTOFF);
  assert.equal(cutoffNote({ run: { summary: CUTOFF } }), CUTOFF);
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
