const FX_TIMEOUT_MS = 5000;
const ISO = /^[A-Z]{3}$/;

const SAVED = require('./fxAverages.json');
const AVERAGE_PER_USD = { ...SAVED.per_usd, ...SAVED.pegged.per_usd };
const PEGGED = new Set(Object.keys(SAVED.pegged.per_usd));
const AVERAGE_PERIOD = SAVED.period;

async function todayPerUsd(fetchImpl, codes, sourceUrl) {
  if (!codes.length) return { perUsd: {}, date: null };
  const url = `${sourceUrl}?base=USD&symbols=${codes.join(',')}`;
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
async function currencyRates({ base, codes, fetchImpl = fetch, sourceUrl = process.env.INSPIRE_FX_URL || '' }) {
  const wanted = [...new Set(codes.map((c) => String(c).toUpperCase()).filter((c) => ISO.test(c) && c !== base))];
  let live = { perUsd: {}, date: null };
  let offline = false;
  let problem = '';
  if (!sourceUrl) {
    offline = true;
    problem = 'no live rate source is set for this App';
  } else {
    try {
      live = await todayPerUsd(fetchImpl, wanted, sourceUrl);
    } catch (err) {
      offline = true;
      problem = err && err.message ? err.message : 'the rate source is unreachable';
    }
  }
  const rateOf = (code) => {
    if (live.perUsd[code] !== undefined) return { perUsd: live.perUsd[code], source: 'today' };
    if (AVERAGE_PER_USD[code] !== undefined) return { perUsd: AVERAGE_PER_USD[code], source: PEGGED.has(code) ? 'peg' : 'average' };
    return null;
  };
  const baseRate = base === 'USD' ? { perUsd: 1 } : rateOf(base);
  const rates = {};
  const sources = {};
  const missing = [];
  for (const code of wanted) {
    const mine = rateOf(code);
    if (!mine || !baseRate) { missing.push(code); continue; }
    rates[code] = Number((baseRate.perUsd / mine.perUsd).toPrecision(10));
    sources[code] = mine.source;
  }
  const averaged = Object.keys(sources).filter((c) => sources[c] === 'average');
  const pegged = Object.keys(sources).filter((c) => sources[c] === 'peg');
  let message = '';
  if (offline) message = `${problem.startsWith('no live') ? 'No live rate source' : 'No internet'}: every rate is saved in Inspire, the ${AVERAGE_PERIOD.from.slice(0, 4)} ECB average or an official peg${problem ? ` (${problem})` : ''}.`;
  else if (averaged.length) message = `${averaged.join(', ')} ${averaged.length === 1 ? 'is' : 'are'} not in today's source, so ${averaged.length === 1 ? 'its rate is' : 'their rates are'} the ${AVERAGE_PERIOD.from.slice(0, 4)} average from the ECB.`;
  if (pegged.length) message = `${message} ${pegged.join(', ')} ${pegged.length === 1 ? 'is' : 'are'} at the official peg to the US dollar.`.trim();
  if (missing.length) message = `${message} No rate is known for ${missing.join(', ')}; type it in.`.trim();
  return { base, rates, sources, missing, as_of: live.date, offline, message: message.trim() };
}

module.exports = { currencyRates, AVERAGE_PER_USD, AVERAGE_PERIOD, FX_TIMEOUT_MS };
