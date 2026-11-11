import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MORE_USE_CASES, valueStripOf } from '../src/valueStrip.js';

const REVIEW = 'https://inspire.example.com/?review=5150';
const page = (extra = {}) => ({ id: 'n01_u01', title: 'Churn', kpis: [
  { id: 'at_risk', label: 'Revenue at risk', format: 'currency', currency: 'AED' },
  { id: 'orders', label: 'Orders', format: 'integer' },
], ...extra });

test('the strip shows the page own currency KPI as value at stake now, read from the page data', () => {
  const strip = valueStripOf(page(), { kpis: { at_risk: { now: 1234567 } } }, {});
  assert.equal(strip.kpi.label, 'Revenue at risk');
  assert.match(strip.kpi.now, /AED/);
  assert.match(strip.kpi.now, /1\.2/);
  assert.equal(strip.more, null);
});

test('a page with no value reads Not recorded, never a dash, and says so instead of showing zero', () => {
  const strip = valueStripOf(page(), { kpis: {} }, {});
  assert.equal(strip.kpi.now, 'Not recorded');
  assert.doesNotMatch(strip.kpi.now, /[–—-]/);
});

test('before the page data loads the strip has no figure to show yet', () => {
  assert.equal(valueStripOf(page(), null, {}).kpi.now, '');
});

test('the More use cases link goes to the run on Inspire Review, in a new tab outside Inspire', () => {
  const strip = valueStripOf(page({ kpis: [] }), null, { review_run: REVIEW });
  assert.equal(strip.kpi, null);
  assert.deepEqual(strip.more, { href: REVIEW, inside: false });
  assert.equal(MORE_USE_CASES, 'More use cases for this business');
});

test('inside Inspire the More use cases link opens in the same window', () => {
  assert.deepEqual(valueStripOf(page(), null, { review_run: REVIEW, inside: true }).more, { href: REVIEW, inside: true });
});

test('a page with no currency KPI and no run link shows no strip', () => {
  assert.equal(valueStripOf(page({ kpis: [{ id: 'orders', label: 'Orders', format: 'integer' }] }), null, {}), null);
});

const SAVED = (lines, warning = '') => ({ since: '2026-11-10T20:00:00Z', lines, warning });

test('saved since go-live reads the ledger total per currency and unit, never adding currencies together', () => {
  const strip = valueStripOf(page(), { kpis: {} }, {}, SAVED([
    { kind: 'money', currency: 'AED', unit: 'a year', amount: 12000, records: 3 },
    { kind: 'money', currency: 'USD', unit: 'a year', amount: 900, records: 1 },
  ]));
  assert.match(strip.saved.text, /^Saved since go-live: /);
  assert.match(strip.saved.text, /AED/);
  assert.equal(strip.saved.text, 'Saved since go-live: AED 12,000 a year · $900 a year');
  assert.match(strip.saved.text, /a year/);
  assert.doesNotMatch(strip.saved.text, /[\u2013\u2014]/);
  assert.equal(strip.saved.warning, '');
});

test('a go-live with no saved value yet says none is recorded yet, never zero', () => {
  const strip = valueStripOf(page(), { kpis: {} }, {}, SAVED([]));
  assert.equal(strip.saved.text, 'Saved since go-live: none recorded yet');
});

test('a saved total the ledger cannot give says why, and shows no figure', () => {
  const strip = valueStripOf(page(), { kpis: {} }, {}, SAVED([], 'the App has no go-live date, so the saved total has no start'));
  assert.equal(strip.saved.text, '');
  assert.equal(strip.saved.warning, 'the App has no go-live date, so the saved total has no start');
});

test('before the saved total is read the strip has no saved line yet', () => {
  assert.equal(valueStripOf(page(), { kpis: {} }, {}, null).saved, null);
});

test('a page with only a saved total still shows the strip', () => {
  const strip = valueStripOf(page({ kpis: [] }), null, {}, SAVED([{ kind: 'money', currency: 'AED', unit: '', amount: 5, records: 1 }]));
  assert.notEqual(strip, null);
  assert.equal(strip.kpi, null);
});
