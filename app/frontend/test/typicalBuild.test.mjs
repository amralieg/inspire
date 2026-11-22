import test from 'node:test';
import assert from 'node:assert/strict';
import { typicalBuildText } from '../src/lib/mvpProgress.js';

// FX-41 (REQ-431, W16 D38): the typical build time is the median of this workspace's finished successful builds, never a made-up figure.
const MIN = 60 * 1000;
const T0 = Date.parse('2026-11-16T10:00:00Z');
const row = (minutes, status = 'ready') => ({ status, created_at: new Date(T0).toISOString(), updated_at: new Date(T0 + minutes * MIN).toISOString() });

test('the median of five finished builds is shown with its count', () => {
  assert.equal(typicalBuildText([10, 12, 14, 30, 60].map((m) => row(m))), 'Builds here usually take about 14 min (median of 5)');
});

test('with fewer than 3 finished builds there is no typical text', () => {
  assert.equal(typicalBuildText([row(10), row(12)]), '');
  assert.equal(typicalBuildText([]), '');
});

test('failed and running builds are excluded, warnings count', () => {
  const rows = [row(10), row(12), row(500, 'failed'), row(700, 'building_outputs'), row(14, 'ready_with_warnings')];
  assert.equal(typicalBuildText(rows), 'Builds here usually take about 12 min (median of 3)');
  assert.equal(typicalBuildText([row(10), row(12), row(500, 'failed'), row(600, 'failed')]), '');
});
