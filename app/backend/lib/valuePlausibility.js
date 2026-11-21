// REQ-448: is a yearly value inside the range one use case usually lands in? The check flags a number; it never changes it.
const { AVERAGE_PER_USD } = require('./fxRates');

const BAND = { min: 100000, max: 100000000, currency: 'USD' };

// $638.96M, $547.5M, $25.61M, $620: up to two decimals, no trailing zeros.
function usdText(n) {
  const trim = (v) => String(Math.round(v * 100) / 100);
  if (n >= 1e9) return `$${trim(n / 1e9)}B`;
  if (n >= 1e6) return `$${trim(n / 1e6)}M`;
  if (n >= 1e3) return `$${trim(n / 1e3)}K`;
  return `$${trim(n)}`;
}

const toUsd = (amount, currency) => {
  if (currency === 'USD') return amount;
  const rate = AVERAGE_PER_USD[currency];
  return Number.isFinite(rate) && rate > 0 ? amount / rate : null;
};

// yearly: { currency, total: { unit, amount }, parts: [{ id, label, amount }] } -> { outside: 'high' | 'low' | null, usd, band, driver, reason, unchecked? }
function checkOf(yearly) {
  const currency = String((yearly && (yearly.currency || (yearly.total && yearly.total.unit))) || '').toUpperCase();
  const amount = Number(yearly && yearly.total && yearly.total.amount);
  const usd = Number.isFinite(amount) ? toUsd(amount, currency) : null;
  if (usd === null) return { outside: null, unchecked: true, usd: null, band: BAND, driver: null, reason: '' };
  const outside = usd > BAND.max ? 'high' : usd < BAND.min ? 'low' : null;
  const parts = Array.isArray(yearly.parts) ? yearly.parts.filter((p) => p && Number.isFinite(Number(p.amount))) : [];
  const largest = parts.reduce((best, p) => (!best || Number(p.amount) > Number(best.amount) ? p : best), null);
  const driver = largest ? { id: largest.id, label: largest.label || largest.id, amount: Number(largest.amount) } : null;
  let reason = '';
  if (outside === 'high') {
    const top = driver && driver.amount > 0 ? ` Most of it is ${driver.label} (${usdText(toUsd(driver.amount, currency))}).` : '';
    reason = `Check the numbers: ${usdText(usd)} a year is above ${usdText(BAND.max)}, the top of the usual range for one use case.${top}`;
  } else if (outside === 'low') {
    reason = `Check the numbers: ${usdText(usd)} a year is under ${usdText(BAND.min)}, the bottom of the usual range for one use case.`;
  }
  return { outside, usd: Math.round(usd * 100) / 100, band: BAND, driver, reason };
}

module.exports = { BAND, checkOf, usdText };
