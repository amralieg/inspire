// REQ-448: the plausibility check flags a yearly outside $100K-$100M; it never changes the number.
const test = require('node:test');
const assert = require('node:assert/strict');
const VP = require('../lib/valuePlausibility');
const VCP = require('../lib/valueCasePlan');
const VA = require('../lib/valueAnswers');

const yearly = (amount, currency = 'USD', parts = []) => ({ currency, total: { unit: currency, amount }, parts });

test('a number above the band is flagged high with the largest part and a plain reason', () => {
  const got = VP.checkOf(yearly(638960000, 'USD', [{ id: 'risk_avoided', label: 'Risk avoided', amount: 547500000 }, { id: 'time_saved', label: 'Time saved', amount: 91250000 }]));
  assert.equal(got.outside, 'high');
  assert.equal(got.driver.id, 'risk_avoided');
  assert.match(got.reason, /^Check the numbers/);
  assert.match(got.reason, /\$100M/);
  assert.match(got.reason, /Risk avoided/);
});

test('the band is inclusive and a low number is flagged low', () => {
  assert.equal(VP.checkOf(yearly(620)).outside, 'low');
  assert.equal(VP.checkOf(yearly(25610000)).outside, null);
  assert.equal(VP.checkOf(yearly(100000)).outside, null);
  assert.equal(VP.checkOf(yearly(100000000)).outside, null);
});

test('other currencies are converted with the static rates; an unknown currency is unchecked', () => {
  assert.equal(VP.checkOf(yearly(500000000, 'AED')).outside, 'high');
  assert.equal(VP.checkOf(yearly(5000000000, 'JPY')).outside, null);
  const unknown = VP.checkOf(yearly(5, 'XXX'));
  assert.equal(unknown.unchecked, true);
  assert.equal(unknown.outside, null);
});

test('yearlyOf adds check to every yearly', () => {
  const plan = { ...VCP.fallbackPlan([{ column_name: 'region', data_type: 'STRING' }]), groups: [{ g: 'a', records_per_year: 10, metrics: {} }] };
  plan.drivers = plan.drivers.map((d) => ({ ...d, on: d.id === 'time_saved' }));
  const got = VCP.yearlyOf(plan, { currency: 'USD', attribution_pct: 100, drivers: {} });
  assert.ok(got.yearly.check, 'check present');
  assert.equal(got.yearly.check.outside, 'low');
});

test('versionOf flags a stored yearly that has no check', () => {
  const got = VA.versionOf({ version: 1, answers: '{"shape":2}', yearly: JSON.stringify({ total: { unit: 'USD', amount: 638960000 }, currency: 'USD', parts: [] }) });
  assert.equal(got.yearly.check.outside, 'high');
});
