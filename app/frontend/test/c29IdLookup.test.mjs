// REQ-569 part 2 (c29_idlookup): a deep link that names a use case by either id form opens the use case the session saved, so the
// backend always receives the saved form. Old sessions saved Nx-Ux; the App's own Excel and doc links now print AIx-UCx.
import test from 'node:test';
import assert from 'node:assert/strict';
import * as F from '../src/lib/useCaseFields.js';
import { hashLink } from '../src/lib/runPages.js';

const OLD = [{ id: 'N01-U01', Name: 'First' }, { id: 'N01-U02', Name: 'Second' }];
const NEW = [{ id: 'AI01-UC01', Name: 'First' }, { id: 'AI01-UC02', Name: 'Second' }];

test('a #/review/42/AI01-UC01 link on an old session opens the N01-U01 use case', () => {
  const link = hashLink('#/review/42/AI01-UC01');
  assert.equal(link.useCaseId, 'AI01-UC01');
  assert.equal(typeof F.linkedUseCase, 'function', 'useCaseFields.js exports linkedUseCase');
  assert.equal(F.linkedUseCase(OLD, link.useCaseId), OLD[0]);
});

test('a #/review/42/N01-U02 link on a new session opens the AI01-UC02 use case', () => {
  assert.equal(typeof F.linkedUseCase, 'function', 'useCaseFields.js exports linkedUseCase');
  assert.equal(F.linkedUseCase(NEW, hashLink('#/review/42/N01-U02').useCaseId), NEW[1]);
});

test('a #/build/42/AI01-UC02 link on an old session focuses the N01-U02 use case, so its reads send N01-U02', () => {
  assert.equal(typeof F.linkedUseCase, 'function', 'useCaseFields.js exports linkedUseCase');
  const link = hashLink('#/build/42/AI01-UC02');
  assert.equal(F.trackingIdOf(F.linkedUseCase(OLD, link.useCaseId)), 'N01-U02');
});

test('the exact id wins, and an id the session does not hold opens nothing (must-keep)', () => {
  assert.equal(typeof F.linkedUseCase, 'function', 'useCaseFields.js exports linkedUseCase');
  const both = [{ id: 'AI01-UC01' }, { id: 'N01-U01' }];
  assert.equal(F.linkedUseCase(both, 'N01-U01'), both[1]);
  assert.equal(F.linkedUseCase(OLD, 'AI09-UC09'), null);
  assert.equal(F.linkedUseCase(OLD, ''), null);
  assert.equal(F.linkedUseCase(null, 'N01-U01'), null);
});
