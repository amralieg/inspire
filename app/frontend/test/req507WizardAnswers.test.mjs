// REQ-507 L7 (pure): frontend/src/lib/valueWizard.js keeps the new answers across a reopen and a regroup: the chosen scope, the ramp and
// cost (economics), the story and the confidence (Low/Medium/High, its own question, apart from the share caused by this use case).
import test from 'node:test';
import assert from 'node:assert/strict';
import { initialAnswers, carryAnswers } from '../src/lib/valueWizard.js';

const PLAN = { grouping: 'region_name', drivers: [{ id: 'cost_cut', label: 'Fees avoided', on: true, asks: [{ id: 'cut_pct', label: 'Cut', kind: 'pct', source: 'estimate', default: 10 }] }] };
const SCOPE = { phrase: 'All data', filters: [], window: null, rows_before: 10, rows_after: 10, first: '2026-01-01', last: '2026-09-30' };
const ECONOMICS = { ramp_pct: [40, 80, 100], build_cost: 20000, run_cost_per_year: 12000, go_live_month: 3 };
const STORY = { text: 'Story', params_hash: 'h1', include_in_docs: true, approved: true, approved_by: 'person@example.com', approved_at: '2026-11-23T10:00:00.000Z' };
const SAVED = { shape: 2, currency: 'AED', attribution_pct: 60, drivers: { cost_cut: { on: true, inputs: { cut_pct: 12 } } }, scope: SCOPE, economics: ECONOMICS, story: STORY, confidence: 'medium' };

test('L7: a reopened value keeps its scope, ramp and cost, story and confidence', () => {
  const a = initialAnswers(PLAN, SAVED);
  assert.deepEqual(a.scope, SCOPE);
  assert.deepEqual(a.economics, ECONOMICS);
  assert.deepEqual(a.story, STORY);
  assert.equal(a.confidence, 'medium');
  assert.equal(a.attribution_pct, 60, 'the share caused by this use case is its own answer');
});

test('L7: a new value starts with the default ramp, no story and no confidence picked', () => {
  const a = initialAnswers(PLAN);
  assert.deepEqual(a.economics, { ramp_pct: [40, 80, 100] });
  assert.equal(a.story ?? null, null);
  assert.equal(a.confidence ?? null, null);
});

test('L7: a regroup carries the scope, economics and confidence; it clears the story approval, because the numbers moved', () => {
  const a = carryAnswers(PLAN, initialAnswers(PLAN, SAVED));
  assert.deepEqual(a.scope, SCOPE);
  assert.deepEqual(a.economics, ECONOMICS);
  assert.equal(a.confidence, 'medium');
  assert.ok(!a.story || a.story.approved !== true, 'approval cleared');
});
