// REQ-507 L2: gross value per year -> a 3-year business case. Pure maths, no SQL.
// Low/likely/high on a capture ramp, net after build and run cost, payback months and 3-year ROI.
const DEFAULT_RAMP = [40, 80, 100];
const YEARS = 3;
const MONTHS = YEARS * 12;

const num = (v) => (v === null || v === undefined || v === '' || typeof v === 'boolean' ? NaN : Number(v));
const round2 = (n) => Math.round(n * 100) / 100;

function rampOf(ramp) {
  const r = ramp === undefined || ramp === null ? DEFAULT_RAMP : ramp;
  if (!Array.isArray(r) || r.length !== YEARS) throw new Error(`ramp_pct must be ${YEARS} numbers between 0 and 100`);
  const out = r.map(num);
  if (!out.every((v) => Number.isFinite(v) && v >= 0 && v <= 100)) throw new Error(`ramp_pct must be ${YEARS} numbers between 0 and 100`);
  return out;
}

function costOf(value, name) {
  if (value === undefined || value === null || value === '') return 0;
  const n = num(value);
  if (!Number.isFinite(n) || n < 0) throw new Error(`${name} must be a number of 0 or more`);
  return n;
}

// gross: {low, likely, high} per year at full capture. A missing low/high falls back to likely; the three are ordered.
function projectionOf({ gross, ramp_pct, build_cost, run_cost_per_year } = {}) {
  const ramp = rampOf(ramp_pct);
  const build = costOf(build_cost, 'build_cost');
  const run = costOf(run_cost_per_year, 'run_cost_per_year');
  const likely = num(gross && gross.likely);
  if (!Number.isFinite(likely)) throw new Error('gross.likely must be a number');
  const pick = (v) => (Number.isFinite(num(v)) ? num(v) : likely);
  const low = Math.min(pick(gross.low), pick(gross.high), likely);
  const high = Math.max(pick(gross.low), pick(gross.high), likely);

  const years = ramp.map((pct, i) => ({
    year: i + 1,
    low: Math.round((low * pct) / 100),
    likely: Math.round((likely * pct) / 100),
    high: Math.round((high * pct) / 100),
  }));
  const gross3 = years.reduce((s, y) => s + y.likely, 0);
  const grossOnly = !(build > 0 || run > 0);
  const cost3 = build + run * YEARS;
  const net3 = gross3 - cost3;

  let payback = null;
  if (!grossOnly && build > 0) {
    let cum = 0;
    for (let m = 1; m <= MONTHS; m += 1) {
      cum += (years[Math.ceil(m / 12) - 1].likely - run) / 12;
      if (cum >= build) { payback = m; break; }
    }
  }
  return {
    years,
    gross_3y: gross3,
    cost_3y: cost3,
    net_3y: net3,
    roi_3y: grossOnly || cost3 <= 0 ? null : round2(net3 / cost3),
    payback_months: payback,
    gross_only: grossOnly,
  };
}

module.exports = { DEFAULT_RAMP, projectionOf };
