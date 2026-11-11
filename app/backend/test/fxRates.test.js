const test = require('node:test');
const assert = require('node:assert/strict');
const { currencyRates, AVERAGE_PER_USD, AVERAGE_PERIOD } = require('../lib/fxRates');

const liveFrom = (rates, date = '2026-11-11') => async () => ({ ok: true, status: 200, json: async () => ({ amount: 1, base: 'USD', date, rates }) });
const offline = async () => { throw new Error('getaddrinfo ENOTFOUND api.frankfurter.dev'); };
const round6 = (n) => Math.round(n * 1e6) / 1e6;

test('the saved averages are the previous full calendar year of the ECB series, with a real period', () => {
  assert.equal(AVERAGE_PERIOD.from, '2025-01-01');
  assert.equal(AVERAGE_PERIOD.to, '2025-12-31');
  assert.ok(AVERAGE_PERIOD.days > 200, 'a year of publishing days');
  assert.equal(AVERAGE_PER_USD.USD, 1);
  assert.equal(AVERAGE_PER_USD.AED, undefined, 'the ECB series does not list AED, so no average is invented for it');
});

test('today’s rate is the live rate, turned into units of the reporting currency', async () => {
  const out = await currencyRates({ base: 'USD', codes: ['EUR'], fetchImpl: liveFrom({ EUR: 0.8 }) });
  assert.equal(out.rates.EUR, 1.25, '1 EUR is 1.25 USD when 1 USD is 0.8 EUR');
  assert.equal(out.sources.EUR, 'today');
  assert.equal(out.as_of, '2026-11-11');
  assert.equal(out.offline, false);
  assert.equal(out.message, '');
});

test('a currency the live source does not list falls back to its saved ECB average and the person is told so', async () => {
  const out = await currencyRates({ base: 'USD', codes: ['EUR', 'GBP'], fetchImpl: liveFrom({ EUR: 0.8 }) });
  assert.equal(out.sources.GBP, 'average');
  assert.equal(out.rates.GBP, round6(1 / AVERAGE_PER_USD.GBP));
  assert.match(out.message, /GBP is not in today's source, so its rate is the 2025 average from the ECB/);
});

test('with no internet every rate is the saved ECB average and the message says so in one line', async () => {
  const out = await currencyRates({ base: 'EUR', codes: ['USD', 'GBP'], fetchImpl: offline });
  assert.equal(out.offline, true);
  assert.equal(out.sources.USD, 'average');
  assert.equal(out.rates.USD, round6(AVERAGE_PER_USD.EUR / AVERAGE_PER_USD.USD));
  assert.match(out.message, /^No internet: every rate is the 2025 average from the ECB/);
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

test('AED, which the ECB does not publish, is missing when the source is offline and must be typed in', async () => {
  const out = await currencyRates({ base: 'USD', codes: ['AED'], fetchImpl: offline });
  assert.deepEqual(out.missing, ['AED']);
  assert.equal(out.rates.AED, undefined);
});

test('the base currency is never converted to itself and codes are read in capitals without duplicates', async () => {
  const out = await currencyRates({ base: 'USD', codes: ['usd', 'eur', 'EUR', 'not-a-code'], fetchImpl: liveFrom({ EUR: 0.8 }) });
  assert.deepEqual(Object.keys(out.rates), ['EUR']);
  assert.deepEqual(out.missing, []);
});

test('a table with 60 currencies gets a rate for every one of them, none dropped', async () => {
  const letters = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';
  const codes = [];
  for (const a of letters) for (const b of letters) { if (codes.length < 60) codes.push(`${a}${b}Q`); }
  const live = Object.fromEntries(codes.map((c, i) => [c, 1 + i / 10]));
  const out = await currencyRates({ base: 'USD', codes, fetchImpl: liveFrom(live) });
  assert.equal(Object.keys(out.rates).length, 60);
  assert.deepEqual(out.missing, []);
  assert.ok(Object.values(out.sources).every((s) => s === 'today'));
  assert.equal(out.message, '');
});
