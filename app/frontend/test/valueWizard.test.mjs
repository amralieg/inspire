// REQ-436: the wizard's pure helpers, and a guard that no value formula lives in the browser (D1).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { sliderRange } from '../src/lib/valueWizard.js';

test('slider ranges: pct 0-100 step 1; hours max(8, 3x) step 0.25; count max(10, 3x) step 1; money 3x rounded', () => {
  assert.deepEqual(sliderRange('pct', 60), { min: 0, max: 100, step: 1 });
  assert.deepEqual(sliderRange('hours', 0.5), { min: 0, max: 8, step: 0.25 });
  assert.deepEqual(sliderRange('hours', 5), { min: 0, max: 20, step: 0.25 });
  assert.deepEqual(sliderRange('count', 1), { min: 0, max: 10, step: 1 });
  assert.deepEqual(sliderRange('count', 12), { min: 0, max: 50, step: 1 });
  assert.deepEqual(sliderRange('money', 45), { min: 0, max: 200, step: 1 });
  assert.deepEqual(sliderRange('money', 90000), { min: 0, max: 500000, step: 2500 });
});

test('a typed value above the range grows the slider max; a value inside keeps it', () => {
  assert.equal(sliderRange('pct', 60, 250).max, 250);
  assert.equal(sliderRange('pct', 60, 40).max, 100);
  assert.equal(sliderRange('money', 45, 100000).max, 100000);
});

test('no value formula lives in the browser wizard files', () => {
  const files = ['../src/lib/valueWizard.js', ...readdirSync(new URL('../src/components/valueWizard/', import.meta.url)).map((f) => `../src/components/valueWizard/${f}`)];
  assert.ok(files.length >= 4, 'the wizard components exist');
  for (const f of files) {
    const src = readFileSync(new URL(f, import.meta.url), 'utf8');
    assert.doesNotMatch(src, /hours_before\s*-\s*hours_after/, f);
    assert.doesNotMatch(src, /\/\s*100\b/, `${f} divides by 100`);
    assert.doesNotMatch(src, /\bAMOUNTS\b/, f);
  }
});
