import { test } from 'node:test';
import assert from 'node:assert/strict';
import { kpiHasValue, kpiText, storyPieces } from '../src/format.js';

const EXPOSURE = { id: 'exposure', label: 'Revenue at stake', format: 'currency', currency: 'USD' };
const MIXED = { now: null, before: null, by_currency: [{ currency: 'AED', now: 135, before: null }, { currency: 'USD', now: 50, before: null }] };

test('a money KPI over several currencies shows each currency and never one summed total', () => {
  const text = kpiText(EXPOSURE, MIXED);
  assert.match(text, /AED/);
  assert.match(text, /\$50/);
  assert.equal(text.includes('185'), false, 'AED and USD are never added together');
});

test('a money KPI in one currency shows one number in that currency', () => {
  assert.match(kpiText(EXPOSURE, { now: 50, before: null, by_currency: [{ currency: 'USD', now: 50, before: null }] }), /50/);
  assert.match(kpiText(EXPOSURE, { now: 50, before: null }), /\$50/);
});

test('a KPI with only per-currency values still counts as having a value for the story', () => {
  assert.equal(kpiHasValue(MIXED), true);
  assert.equal(kpiHasValue({ now: null, before: null }), false);
});

test('the story sentence names each currency total instead of dropping the sentence', () => {
  const pieces = storyPieces('Revenue at stake is {exposure}.', [{ ...EXPOSURE, words: {} }], { exposure: MIXED });
  const strong = pieces.filter((p) => p.strong).map((p) => p.text).join(' ');
  assert.match(strong, /AED/);
  assert.match(strong, /\$50/);
});
