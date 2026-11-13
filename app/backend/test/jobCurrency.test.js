const test = require('node:test');
const assert = require('node:assert/strict');
const { implementCurrencyParams, discoverCurrencyParams } = require('../lib/jobCurrency');
const FX = require('../lib/fxRates');
const { INSPIRE_NOTEBOOK_WIDGET_KEYS, sanitizeInspireNotebookJobParams } = require('../lib/inspireJobParams');

const offline = async () => { throw new Error('getaddrinfo ENOTFOUND'); };
const live = (rates) => async () => ({ ok: true, status: 200, json: async () => ({ date: '2026-11-12', rates }) });

test('Implement sends the Measure rule currency and the exact rates the person saw or edited', async () => {
  const money = { currency: 'convert', base: 'AED', rates: { EUR: 4.28, USD: 3.6725 } };
  assert.deepEqual(await implementCurrencyParams(money), { currency: 'AED', currency_rates: '{"source":"typed","rates":{"EUR":4.28,"USD":3.6725}}' });
});

test('Implement drops a rate that is not a positive number for an ISO code, and sends nothing for a per-currency rule', async () => {
  assert.deepEqual(await implementCurrencyParams({ currency: 'convert', base: 'AED', rates: { EUR: 4.28, USD: 0, 'not-a-code': 2 } }),
    { currency: 'AED', currency_rates: '{"source":"typed","rates":{"EUR":4.28}}' });
  assert.deepEqual(await implementCurrencyParams({ currency: 'per_currency' }), {});
  assert.deepEqual(await implementCurrencyParams(null), {});
});

const RATE_TABLE = { table: 'main.fx.rates', currency_column: 'ccy', base_column: 'base_ccy', date_column: 'rate_date', rate_column: 'rate', load_column: 'loaded_at' };

test('a rate-table rule reads the latest rate per currency from its table and sends source table, so the run converts (REQ-103)', async () => {
  const seen = [];
  const runSql = async (sql) => { seen.push(sql); return [{ currency: 'EUR', rate: 4.28 }, { currency: 'usd', rate: 3.6725 }, { currency: 'GBP', rate: 0 }, { currency: 'XX', rate: 1 }]; };
  const out = await implementCurrencyParams({ currency: 'convert', base: 'AED', rate_table: RATE_TABLE }, { runSql });
  assert.deepEqual(out, { currency: 'AED', currency_rates: '{"source":"table","rates":{"EUR":4.28,"USD":3.6725}}' },
    'a zero rate and a code that is not ISO are dropped, and the table rates are labelled table');
  assert.equal(seen.length, 1, 'one read of the rate table');
  assert.match(seen[0], /`base_ccy` = 'AED'/, 'the read keeps the rows into the reporting currency');
  assert.match(seen[0], /LIMIT 500\b/, 'the read is not capped at the three sample rates');
});

test('a rate-table rule whose table cannot be named is refused, never sent as converted with no rates', async () => {
  await assert.rejects(implementCurrencyParams({ currency: 'convert', base: 'AED', rate_table: { ...RATE_TABLE, table: 'not a table' } },
    { runSql: async () => [] }), /rate table is not readable/);
});

test('a rate-column rule sends the rate column and the currency column, so each row converts with its own rate and never reads a table (REQ-103)', async () => {
  const out = await implementCurrencyParams({ currency: 'convert', base: 'AED', rate_column: 'fx_rate', currency_column: 'ccy' }, { runSql: async () => { throw new Error('must not read'); } });
  assert.deepEqual(out, { currency: 'AED', currency_rates: JSON.stringify({ source: 'column', column: 'fx_rate', currency_column: 'ccy', rates: {} }) });
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
  assert.match(implementRoutes, /Object\.assign\(params, await JC\.implementCurrencyParams\(spec\?\.money, \{ runSql \}\)\);/);
  assert.match(server, /jobType !== 'implement' && !\('currency_rates' in params\)\) Object\.assign\(params, await JC\.discoverCurrencyParams\(params\)\);/);
});
