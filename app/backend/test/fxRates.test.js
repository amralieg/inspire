const test = require('node:test');
const assert = require('node:assert/strict');
const { currencyRates, AVERAGE_PER_USD } = require('../lib/fxRates');

const liveFrom = (rates, date = '2026-11-11') => async () => ({ ok: true, status: 200, json: async () => ({ amount: 1, base: 'USD', date, rates }) });
const offline = async () => { throw new Error('getaddrinfo ENOTFOUND api.frankfurter.dev'); };

test('today\'s rate is the live rate, turned into units of the reporting currency', async () => {
  const out = await currencyRates({ base: 'USD', codes: ['EUR'], fetchImpl: liveFrom({ EUR: 0.8 }) });
  assert.equal(out.rates.EUR, 1.25, '1 EUR is 1.25 USD when 1 USD is 0.8 EUR');
  assert.equal(out.sources.EUR, 'today');
  assert.equal(out.as_of, '2026-11-11');
  assert.equal(out.offline, false);
  assert.equal(out.message, '');
});

test('a currency the live source does not list falls back to the saved average and the person is told so', async () => {
  const out = await currencyRates({ base: 'USD', codes: ['EUR', 'AED'], fetchImpl: liveFrom({ EUR: 0.8 }) });
  assert.equal(out.sources.AED, 'average');
  assert.equal(out.rates.AED, Math.round((1 / AVERAGE_PER_USD.AED) * 1e6) / 1e6);
  assert.match(out.message, /AED is not in today's source, so its rate is the saved historical average/);
});

test('with no internet every rate is the saved average and the message says so in one line', async () => {
  const out = await currencyRates({ base: 'AED', codes: ['USD', 'GBP'], fetchImpl: offline });
  assert.equal(out.offline, true);
  assert.equal(out.sources.USD, 'average');
  assert.equal(out.sources.GBP, 'average');
  assert.equal(out.rates.USD, Math.round((AVERAGE_PER_USD.AED / 1) * 1e6) / 1e6, '1 USD is 3.6725 AED');
  assert.match(out.message, /^No internet: every rate is the saved historical average/);
});

test('a source that answers with an error is treated as offline', async () => {
  const out = await currencyRates({ base: 'USD', codes: ['EUR'], fetchImpl: async () => ({ ok: false, status: 503, json: async () => ({}) }) });
  assert.equal(out.offline, true);
  assert.equal(out.sources.EUR, 'average');
});

test('a code that neither source knows is returned as missing, never guessed', async () => {
  const out = await currencyRates({ base: 'USD', codes: ['XYZ', 'EUR'], fetchImpl: liveFrom({ EUR: 0.8 }) });
  assert.deepEqual(out.missing, ['XYZ']);
  assert.equal(out.rates.XYZ, undefined);
  assert.match(out.message, /No rate is known for XYZ; type it in\./);
});

test('the base currency is never converted to itself and codes are read in capitals without duplicates', async () => {
  const out = await currencyRates({ base: 'USD', codes: ['usd', 'eur', 'EUR', 'not-a-code'], fetchImpl: liveFrom({ EUR: 0.8 }) });
  assert.deepEqual(Object.keys(out.rates), ['EUR']);
  assert.deepEqual(out.missing, []);
});
