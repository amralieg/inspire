// REQ-481 (FX-76): the app shell shows the estimated-value disclaimer under the overall value and in a footer, only when a number is shown.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { valueStripOf } from '../src/valueStrip.js';
import { VALUE_DISCLAIMER, VALUE_DISCLAIMER_SHORT, showsMoney } from '../src/valueDisclaimer.js';

const { full, short } = JSON.parse(readFileSync(new URL('../../../../../backend/lib/valueDisclaimer.json', import.meta.url), 'utf8'));
const page = { id: 'n01', kpis: [{ id: 'at_risk', label: 'Revenue at risk', format: 'currency', currency: 'AED' }] };

test('the shell constants are the backend text', () => {
  assert.equal(VALUE_DISCLAIMER, full);
  assert.equal(VALUE_DISCLAIMER_SHORT, short);
});

test('the value strip carries the full text when the overall value is a number', () => {
  assert.equal(valueStripOf(page, { kpis: { at_risk: { now: 1234567 } } }, {}).disclaimer, full);
});

test('no number, no disclaimer: Not recorded, no data yet and a page with no currency value', () => {
  assert.ok(!valueStripOf(page, { kpis: {} }, {})?.disclaimer);
  assert.ok(!valueStripOf(page, null, {})?.disclaimer);
  assert.equal(showsMoney({ kpis: [{ id: 'o', format: 'integer' }] }, { kpis: { o: { now: 5 } } }), false);
});

test('showsMoney is true for a page with a currency figure and false for Not recorded', () => {
  assert.equal(showsMoney(page, { kpis: { at_risk: { now: 5 } } }), true);
  assert.equal(showsMoney(page, { kpis: {} }), false);
});

test('Page renders the footer from the one constant', () => {
  const src = readFileSync(new URL('../src/Page.jsx', import.meta.url), 'utf8');
  assert.match(src, /data-value-footer/);
  assert.match(src, /showsMoney/);
});
