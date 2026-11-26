import test from 'node:test';
import assert from 'node:assert/strict';
import { assetCells } from '../../src/lib/useCaseAssets.js';

test('REQ-427: the row shows App, Dashboard, Lakebase and Genie as Yes or No from the recorded flags', () => {
  assert.deepEqual(assetCells({ app: true, dashboard: false, lakebase: true, genie: false }).map((c) => `${c.label} ${c.value}`),
    ['App Yes', 'Dashboard No', 'Lakebase Yes', 'Genie Agent No']);
  assert.deepEqual(assetCells(undefined).map((c) => c.value), ['No', 'No', 'No', 'No']);
});
