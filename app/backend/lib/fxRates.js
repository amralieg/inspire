const FX_URL = 'https://api.frankfurter.dev/v1/latest';
const FX_TIMEOUT_MS = 5000;
const ISO = /^[A-Z]{3}$/;

// Units of each currency per 1 USD, the average of recent years (approximate, not a published average). Used when the live source is
// unreachable or does not list a currency. Replace with a published average table before a customer relies on it.
const AVERAGE_PER_USD = {
  USD: 1, AED: 3.6725, AUD: 1.52, BHD: 0.376, BRL: 5.4, CAD: 1.37, CHF: 0.88, CNY: 7.2, CZK: 22.8, DKK: 6.9, EGP: 48.5, EUR: 0.92,
  GBP: 0.78, HKD: 7.8, HUF: 360, IDR: 15700, ILS: 3.7, INR: 83.5, JOD: 0.709, JPY: 150, KES: 129, KRW: 1380, KWD: 0.307, MAD: 10,
  MXN: 18.3, MYR: 4.5, NGN: 1500, NOK: 10.6, NZD: 1.67, OMR: 0.385, PHP: 56.5, PKR: 280, PLN: 3.9, QAR: 3.64, RON: 4.6, SAR: 3.75,
  SEK: 10.4, SGD: 1.34, THB: 35, TRY: 32.5, TWD: 32, ZAR: 18.2,
};

async function todayPerUsd(fetchImpl, codes) {
  if (!codes.length) return { perUsd: {}, date: null };
  const url = `${FX_URL}?base=USD&symbols=${codes.join(',')}`;
  const res = await fetchImpl(url, { signal: AbortSignal.timeout(FX_TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`the rate source answered ${res.status}`);
  const body = await res.json();
  const perUsd = {};
  for (const [code, rate] of Object.entries(body?.rates || {})) {
    if (ISO.test(code) && Number.isFinite(Number(rate)) && Number(rate) > 0) perUsd[code] = Number(rate);
  }
  return { perUsd, date: typeof body?.date === 'string' ? body.date : null };
}

// The rate of each currency into the base currency (units of base per 1 unit of the currency): today's rate where the live source
// lists it, the saved average otherwise, and no rate at all for a code neither source knows.
async function currencyRates({ base, codes, fetchImpl = fetch }) {
  const wanted = [...new Set(codes.map((c) => String(c).toUpperCase()).filter((c) => ISO.test(c) && c !== base))];
  let live = { perUsd: {}, date: null };
  let offline = false;
  let problem = '';
  try {
    live = await todayPerUsd(fetchImpl, wanted);
  } catch (err) {
    offline = true;
    problem = err && err.message ? err.message : 'the rate source is unreachable';
  }
  const rateOf = (code) => {
    if (live.perUsd[code] !== undefined) return { perUsd: live.perUsd[code], source: 'today' };
    if (AVERAGE_PER_USD[code] !== undefined) return { perUsd: AVERAGE_PER_USD[code], source: 'average' };
    return null;
  };
  const baseRate = base === 'USD' ? { perUsd: 1 } : rateOf(base);
  const rates = {};
  const sources = {};
  const missing = [];
  for (const code of wanted) {
    const mine = rateOf(code);
    if (!mine || !baseRate) { missing.push(code); continue; }
    rates[code] = Math.round((baseRate.perUsd / mine.perUsd) * 1e6) / 1e6;
    sources[code] = mine.source;
  }
  const averaged = Object.keys(sources).filter((c) => sources[c] === 'average');
  let message = '';
  if (offline) message = `No internet: every rate is the saved historical average${problem ? ` (${problem})` : ''}.`;
  else if (averaged.length) message = `${averaged.join(', ')} ${averaged.length === 1 ? 'is' : 'are'} not in today's source, so ${averaged.length === 1 ? 'its rate is' : 'their rates are'} the saved historical average.`;
  if (missing.length) message = `${message} No rate is known for ${missing.join(', ')}; type it in.`.trim();
  return { base, rates, sources, missing, as_of: live.date, offline, message: message.trim() };
}

module.exports = { currencyRates, AVERAGE_PER_USD, FX_URL, FX_TIMEOUT_MS };
