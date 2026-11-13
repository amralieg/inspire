const FX = require('./fxRates');
const GP = require('./groupingProfile');

const ISO = /^[A-Z]{3}$/;
const DISCOVER_DEFAULT_REPORTING = 'USD';
const RATE_TABLE_CURRENCIES = 500;

function cleanRates(rates) {
  const out = {};
  for (const [code, rate] of Object.entries(rates || {})) {
    const value = Number(rate);
    if (ISO.test(String(code)) && Number.isFinite(value) && value > 0) out[String(code)] = value;
  }
  return out;
}

// The latest rate per currency into the base, read from the rate table the rule names. runSql runs the statement with the
// person's sign-in, so the table is read through what that person can see.
async function rateTableRates(rateTable, base, runSql) {
  const sql = GP.rateSampleSql(rateTable, base, RATE_TABLE_CURRENCIES);
  if (!sql) throw new Error('The rate table is not readable: name its table and its columns, and the reporting currency as a three-letter code.');
  const rows = await runSql(sql);
  const rates = {};
  for (const row of rows) rates[String(row.currency ?? '').trim().toUpperCase()] = Number(row.rate);
  return cleanRates(rates);
}

// The reporting currency and the rates the App shows, as the two notebook widgets (currency, currency_rates). One helper
// for both launch paths: Implement passes the Measure rule's own currency and rates (typed, or read from its rate table);
// Discover, which has no rule yet, passes today's rates where the rate source answers and the saved averages where it does not.
// A rate-column rule has one rate per record, not one per currency: it sends the rate and currency columns, and each record converts with its own rate.
async function implementCurrencyParams(money, { runSql } = {}) {
  if (!money || money.currency !== 'convert' || !ISO.test(String(money.base || ''))) return {};
  if (money.rate_table !== undefined) {
    const rates = await rateTableRates(money.rate_table, money.base, runSql);
    return { currency: money.base, currency_rates: JSON.stringify({ source: 'table', rates }) };
  }
  if (money.rate_column !== undefined) {
    return { currency: money.base, currency_rates: JSON.stringify({ source: 'column', column: money.rate_column, currency_column: money.currency_column, rates: {} }) };
  }
  return { currency: money.base, currency_rates: JSON.stringify({ source: 'typed', rates: cleanRates(money.rates) }) };
}

async function discoverCurrencyParams(params, { fetchImpl, sourceUrl } = {}) {
  const asked = String(params?.currency || '').trim().toUpperCase();
  const base = ISO.test(asked) ? asked : DISCOVER_DEFAULT_REPORTING;
  const codes = Object.keys(FX.AVERAGE_PER_USD).filter((code) => code !== base);
  const { rates, offline } = await FX.currencyRates({ base, codes, fetchImpl, sourceUrl });
  const currency_default = ISO.test(asked) ? 'false' : 'true';
  return { currency: base, currency_default, currency_rates: JSON.stringify({ source: offline ? 'saved' : 'live', rates }) };
}

module.exports = { implementCurrencyParams, discoverCurrencyParams, rateTableRates, DISCOVER_DEFAULT_REPORTING };
