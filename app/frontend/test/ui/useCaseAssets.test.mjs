import test from 'node:test';
import assert from 'node:assert/strict';
import { assetCells, dbuCell } from '../../src/lib/useCaseAssets.js';

test('REQ-427: the row shows App, Dashboard, Lakebase and Genie as Yes or No from the recorded flags', () => {
  assert.deepEqual(assetCells({ app: true, dashboard: false, lakebase: true, genie: false }).map((c) => `${c.label} ${c.value}`),
    ['Agentic App Yes', 'Dashboard No', 'Lakebase Yes', 'Genie Agent No']);
  assert.deepEqual(assetCells(undefined).map((c) => c.value), ['No', 'No', 'No', 'No']);
});

test('REQ-427: the DBU cell shows the total, says why it has none, and never shows a made-up 0', () => {
  const ok = { state: 'ok', use_cases: { A: 16.04, B: null } };
  assert.equal(dbuCell(ok, 'A').text, '16 DBUs');
  assert.equal(dbuCell(ok, 'B').text, 'DBUs: none billed yet');
  assert.equal(dbuCell(ok, 'Z').text, 'DBUs: none billed yet');
  assert.equal(dbuCell(null, 'A').text, 'DBUs loading');
  const permissions = [{ statements: ['GRANT SELECT ON TABLE `system`.`billing`.`usage` TO `sp`'], principal: 'sp' }];
  const denied = dbuCell({ state: 'denied', use_cases: { A: null }, permissions }, 'A');
  assert.deepEqual([denied.text, denied.permissions], ['DBUs: the App cannot read billing', permissions]);
  assert.equal(dbuCell({ state: 'error', use_cases: {} }, 'A').text, 'DBUs unavailable');
});
