const fs = require('node:fs');
const path = require('node:path');

const BASE = 'USD';
const SERIES_URL = 'https://api.frankfurter.dev/v1';
const OUT = path.join(__dirname, '..', 'lib', 'fxAverages.json');
const PEGGED_PER_USD = { AED: 3.6725, SAR: 3.75, QAR: 3.64, OMR: 0.3845, BHD: 0.376, JOD: 0.709 };
const PEG_SOURCE = 'official peg to the US dollar, central rate';

function previousFullYear(today = new Date()) {
  const year = today.getUTCFullYear() - 1;
  return { year, from: `${year}-01-01`, to: `${year}-12-31` };
}

async function fetchSeries(from, to) {
  const res = await fetch(`${SERIES_URL}/${from}..${to}?base=${BASE}`, { signal: AbortSignal.timeout(60000), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`the ECB series answered ${res.status} for ${from}..${to}`);
  return res.json();
}

function averagesOf(series) {
  const sums = {};
  const counts = {};
  for (const day of Object.values(series.rates || {})) {
    for (const [code, rate] of Object.entries(day)) {
      if (!Number.isFinite(rate) || rate <= 0) continue;
      sums[code] = (sums[code] || 0) + rate;
      counts[code] = (counts[code] || 0) + 1;
    }
  }
  const perUsd = {};
  for (const code of Object.keys(sums).sort()) perUsd[code] = Math.round((sums[code] / counts[code]) * 1e6) / 1e6;
  perUsd[BASE] = 1;
  return { perUsd, days: Object.keys(series.rates || {}).length, counts };
}

async function main() {
  const { year, from, to } = previousFullYear();
  const series = await fetchSeries(from, to);
  const { perUsd, days } = averagesOf(series);
  for (const code of Object.keys(PEGGED_PER_USD)) if (perUsd[code] !== undefined) throw new Error(`${code} is in the ECB series and must not be pegged`);
  const out = {
    base: BASE,
    period: { from, to, days },
    source: `${SERIES_URL} (European Central Bank reference rates, daily, ${year})`,
    generated_at: new Date().toISOString(),
    method: 'arithmetic mean of the daily rates published in the period, units of each currency per 1 USD',
    per_usd: perUsd,
    pegged: { source: PEG_SOURCE, per_usd: PEGGED_PER_USD },
  };
  fs.writeFileSync(OUT, `${JSON.stringify(out, null, 2)}\n`);
  process.stdout.write(`wrote ${Object.keys(perUsd).length} currencies for ${from}..${to} (${days} publishing days) to ${OUT}\n`);
}

if (require.main === module) {
  main().catch((err) => {
    process.stderr.write(`${err.message}\n`);
    process.exit(1);
  });
}

module.exports = { averagesOf, previousFullYear };
