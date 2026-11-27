// REQ-569: a document built from an old session (Nx-Ux rows) prints AIx-UCx and never Nx-Ux.
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildDocModel } from '../src/lib/docgen/docModel.js';
import { buildAgentModel } from '../src/lib/docgen/agentModel.js';
import { displayId, sameUseCaseId } from '../../shared/useCaseId.mjs';

const row = (no, name) => ({ No: no, id: no, Name: name, Statement: `${name} statement`, Solution: 'Solve it', 'Business Domain': 'Ops', Tables: 'a.b.c' });
const ROWS = [row('N01-U02', 'Plan the week'), row('N02-U01', 'Cut the waste')];
const OLD = /\bN\d+-U\d+\b/;

test('the doc model prints AI01-UC02 for an N01-U02 row and keeps its value', () => {
  const m = buildDocModel({ businessName: 'Acme', useCases: ROWS, values: { 'N01-U02': { amount: 1000, currency: 'USD', status: 'estimated' } }, options: {} });
  assert.deepEqual(m.useCases.map((u) => u.id), ['AI01-UC02', 'AI02-UC01']);
  assert.equal(m.useCases[0].value.amount, 1000);
  assert.doesNotMatch(JSON.stringify(m), OLD);
});

test('the agent document model never carries an old id', () => {
  const a = buildAgentModel({ businessName: 'Acme', useCases: ROWS, values: {}, language: 'English' });
  assert.doesNotMatch(JSON.stringify(a.ranked), OLD);
  assert.ok(a.ranked.some((v) => v.id === 'AI01-UC02'));
});

test('the helper reads both forms the same way', () => {
  assert.equal(displayId('N01-U02'), 'AI01-UC02');
  assert.equal(sameUseCaseId('AI01-UC02', 'N01-U02'), true);
});
