const test = require('node:test');
const assert = require('node:assert/strict');
const { implementCurrencyParams, discoverCurrencyParams } = require('../lib/jobCurrency');
const FX = require('../lib/fxRates');
const { INSPIRE_NOTEBOOK_WIDGET_KEYS, sanitizeInspireNotebookJobParams } = require('../lib/inspireJobParams');

const offline = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
const live = (rates) => async () => ({ ok: true, status: 200, json: async () => ({ date: '2026-11-12', rates }) });

test('Implement sends the Measure rule currency and the exact rates the person saw or edited', () => {
  const money = { currency: 'convert', base: 'AED', rates: { EUR: 4.28, USD: 3.6725 } };
  assert.deepEqual(implementCurrencyParams(money), { currency: 'AED', currency_rates: '{"source":"typed","rates":{"EUR":4.28,"USD":3.6725}}' });
});

test('Implement drops a rate that is not a positive number for an ISO code, and sends nothing for a per-currency rule', () => {
  assert.deepEqual(implementCurrencyParams({ currency: 'convert', base: 'AED', rates: { EUR: 4.28, USD: 0, 'not-a-code': 2 } }),
    { currency: 'AED', currency_rates: '{"source":"typed","rates":{"EUR":4.28}}' });
  assert.deepEqual(implementCurrencyParams({ currency: 'per_currency' }), {});
  assert.deepEqual(implementCurrencyParams(null), {});
});

test('Discover with no currency asked sends USD and today’s rates for every saved currency', async () => {
  const out = await discoverCurrencyParams({}, { sourceUrl: 'https://rates.example.test/v1/latest', fetchImpl: live({ EUR: 0.8, AED: 3.6725 }) });
  assert.equal(out.currency, 'USD');
  assert.equal(out.currency_default, 'true', 'nothing typed, so the reporting currency is the default');
  const rates = JSON.parse(out.currency_rates).rates;
  assert.equal(out.currency_rates.includes('"source":"live"'), true, 'a live answer is labelled live');
  assert.equal(rates.EUR, Number((1 / 0.8).toPrecision(10)), 'today’s rate, in USD per 1 EUR');
});

test('Discover offline sends the saved averages, so the run still converts', async () => {
  const out = await discoverCurrencyParams({ currency: 'aed' }, { sourceUrl: 'https://rates.example.test/v1/latest', fetchImpl: offline });
  assert.equal(out.currency, 'AED');
  assert.equal(out.currency_default, 'false', 'a currency the person chose is not a default');
  const rates = JSON.parse(out.currency_rates).rates;
  assert.equal(JSON.parse(out.currency_rates).source, 'saved', 'an offline answer is labelled saved');
  assert.equal(rates.USD, Number((3.6725).toPrecision(10)), 'the AED peg: 1 USD is 3.6725 AED');
  assert.equal(Object.keys(rates).length, Object.keys(FX.AVERAGE_PER_USD).length - 1, 'every saved currency but the base gets a rate, none dropped');
  assert.ok(FX.AVERAGE_PER_USD.EUR > 0);
});

test('both launch keys survive the notebook parameter sanitizer, so the notebook receives them on both paths', () => {
  assert.ok(INSPIRE_NOTEBOOK_WIDGET_KEYS.includes('currency'));
  assert.ok(INSPIRE_NOTEBOOK_WIDGET_KEYS.includes('currency_rates'));
  assert.ok(INSPIRE_NOTEBOOK_WIDGET_KEYS.includes('currency_default'));
  const out = sanitizeInspireNotebookJobParams({ '15_operation': 'Discover Use Cases', '00_business_name': 'x', '01_uc_metadata': 'a.b',
    currency: 'AED', currency_rates: '{"source":"typed","rates":{"EUR":4.28}}' });
  assert.equal(out.currency, 'AED');
  assert.equal(out.currency_rates, '{"source":"typed","rates":{"EUR":4.28}}');
});

test('both launch paths send the currency params: Implement from its rule in startVersion, Discover from the run trigger', () => {
  const fs = require('node:fs');
  const path = require('node:path');
  const implementRoutes = fs.readFileSync(path.join(__dirname, '..', 'implementRoutes.js'), 'utf8');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(implementRoutes, /Object\.assign\(params, JC\.implementCurrencyParams\(spec\?\.money\)\);/);
  assert.match(server, /jobType !== 'implement' && !\('currency_rates' in params\)\) Object\.assign\(params, await JC\.discoverCurrencyParams\(params\)\);/);
});
