import { test } from 'node:test';
import assert from 'node:assert/strict';
import { watchBreakdown } from '../src/records.js';

test('an Open tab with nothing to fix says what is on watch, done and dismissed in one plain sentence', () => {
  const counts = { open: 0, watch: 95, all: 1000, statuses: { New: 95, Done: 904, Dismissed: 1, 'Could not fix': 0 } };
  assert.equal(watchBreakdown(counts), 'Nothing to fix right now: 95 on watch (held back on purpose), 904 done, 1 dismissed.');
});

test('the sentence appears only when the Open count is zero and something is on watch', () => {
  assert.equal(watchBreakdown({ open: 3, watch: 92, statuses: {} }), '', 'open records are listed, so no breakdown');
  assert.equal(watchBreakdown({ open: 0, watch: 0, statuses: { Done: 5 } }), '', 'nothing on watch, so the plain empty state stays');
  assert.equal(watchBreakdown(null), '');
});
