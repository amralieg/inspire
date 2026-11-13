const FX = require('./fxRates');

const ISO = /^[A-Z]{3}$/;
const DISCOVER_DEFAULT_REPORTING = 'USD';

// The reporting currency and the rates the App shows, as the two notebook widgets (currency, currency_rates). One helper
// for both launch paths: Implement passes the Measure rule's own currency and rates; Discover, which has no rule yet, passes
// today's rates where the rate source answers and the saved averages where it does not.
function implementCurrencyParams(money) {
  if (!money || money.currency !== 'convert' || !ISO.test(String(money.base || ''))) return {};
  const rates = {};
  for (const [code, rate] of Object.entries(money.rates || {})) {
    const value = Number(rate);
    if (ISO.test(String(code)) && Number.isFinite(value) && value > 0) rates[String(code)] = value;
  }
  return { currency: money.base, currency_rates: JSON.stringify(rates) };
}

async function discoverCurrencyParams(params, { fetchImpl, sourceUrl } = {}) {
  const asked = String(params?.currency || '').trim().toUpperCase();
  const base = ISO.test(asked) ? asked : DISCOVER_DEFAULT_REPORTING;
  const codes = Object.keys(FX.AVERAGE_PER_USD).filter((code) => code !== base);
  const { rates } = await FX.currencyRates({ base, codes, fetchImpl, sourceUrl });
  return { currency: base, currency_rates: JSON.stringify(rates) };
}

module.exports = { implementCurrencyParams, discoverCurrencyParams, DISCOVER_DEFAULT_REPORTING };
