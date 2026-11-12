import test from 'node:test';
import assert from 'node:assert/strict';
import { splitTechnical } from '../../src/lib/plainText.js';

test('a failed fetch reads as a plain reason, never the raw "Failed to fetch" text (must-exclude raw text)', () => {
  const { plain } = splitTechnical('Failed to fetch');
  assert.match(plain, /lost its connection to Databricks/, 'the reason is plain language');
  assert.doesNotMatch(plain, /Failed to fetch/, 'the raw browser text is not shown');
});
