// RC3-02 / REQ-512f (latent defect of the same class; the rc3 walk itself showed 'Docs made' on the two rows that got docs, S4_docs_column.png): the Review Docs column ("Docs made", sort by docs made) reads docs_generated_at from the
// __inspire_usecases row. buildUseCaseList copies it only when the run JSON `No` equals the table id; when the two differ,
// the list falls back to a Name + Business Domain match, and that branch drops the flag (and the refined score and the
// quality fields), so a use case with saved docs shows no "Docs made" and sorts as if it had none.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildUseCaseList } from '../../src/lib/useCaseList.js';
import { trackingIdOf } from '../../src/lib/useCaseFields.js';

const MADE = '2026-11-25T08:38:01.000Z';
const NAME = 'Forecast weekly demand';
const tableRow = (extra = {}) => ({
  id: 'N01-U01', No: 'N01-U01', session_id: 42, use_case: NAME, Name: NAME, original_name: NAME,
  'Business Domain': 'Sales', business_domain: 'Sales', docs_generated_at: MADE, ...extra,
});
const results = (uc) => ({ domains: [{ domain_name: 'Sales', use_cases: [{ Name: NAME, Statement: 'Plan stock.', ...uc }] }] });

test('must-keep: when the run JSON id equals the table id, the docs flag reaches the row', () => {
  const [uc] = buildUseCaseList(results({ No: 'N01-U01' }), [tableRow()]);
  assert.equal(uc.docs_generated_at, MADE);
});

test('must-fail: when the run JSON id differs from the table id, the Name + domain match still carries the docs flag', () => {
  const [uc] = buildUseCaseList(results({ No: 'U-7' }), [tableRow()]);
  assert.equal(uc.docs_generated_at, MADE, 'the Name + domain branch drops docs_generated_at, so "Docs made" never shows');
});

test('must-fail: the flag is carried even when the run JSON row already has its scores', () => {
  const [uc] = buildUseCaseList(results({ No: 'U-7', priority_score: 4 }), [tableRow()]);
  assert.equal(uc.docs_generated_at, MADE, 'the hasScore early continue skips the flag');
});

test('must-fail: the matched row takes the table id even when the run JSON row has its scores, so docs/save marks the right row', () => {
  // The Generate docs wizard sends trackingIdOf(uc) as use_case_ids; with the JSON id the UPDATE on __inspire_usecases matches no row.
  const [uc] = buildUseCaseList(results({ No: 'U-7', priority_score: 4 }), [tableRow()]);
  assert.equal(trackingIdOf(uc), 'N01-U01', 'the hasScore early continue skips applyInspireTrackingId');
});

test('must-keep: a row with no saved docs stays without the flag in both branches', () => {
  for (const No of ['N01-U01', 'U-7']) {
    const [uc] = buildUseCaseList(results({ No }), [tableRow({ docs_generated_at: null })]);
    assert.ok(!uc.docs_generated_at, `${No}: no docs, no flag`);
  }
});
