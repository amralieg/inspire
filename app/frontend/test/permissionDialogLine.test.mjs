// REQ-300: the Permission Required dialog says its one instruction line as Amr worded it, in the component source.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const SRC = fs.readFileSync(new URL('../src/components/PermissionRequired.jsx', import.meta.url), 'utf8');

test('the one instruction line reads: Copy the text below and pass it on to your Databricks admin', () => {
  assert.match(SRC, /ADVANCED_LINE = 'Copy the text below and pass it on to your Databricks admin\.';/);
  assert.doesNotMatch(SRC, /send it to your Databricks admin/);
});
