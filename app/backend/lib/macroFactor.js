// REQ-507 L3: a public series becomes a market factor of the shape valueReview.factorsFrom keeps, plus its source. The maths stays on the server.
const LIMIT = 50;
const round2 = (n) => Math.round(n * 100) / 100;
const clamp = (n) => Math.max(-LIMIT, Math.min(LIMIT, n));
const mean = (a) => a.reduce((s, n) => s + n, 0) / a.length;
function median(a) {
  const s = [...a].sort((x, y) => x - y);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}
// Linear interpolation between the closest ranks.
function percentile(a, p) {
  const s = [...a].sort((x, y) => x - y);
  const at = (s.length - 1) * p;
  const lo = Math.floor(at);
  const hi = Math.ceil(at);
  return s[lo] + (s[hi] - s[lo]) * (at - lo);
}

// likely = mean of the first horizon_years forecast points (no forecast: the median of the last 10 points); min and max = P10 and P90 of the
// last 10 history points (all points when there is no history); all times the elasticity, clamped to +-50, 2 places. Null when there is no data.
function factorFromSeries(series, { id, label, elasticity = 1, horizon_years = 3 } = {}) {
  const points = series && Array.isArray(series.points) ? series.points.filter((p) => Number.isFinite(p.value)) : [];
  if (!points.length || series.blocked) return null;
  const history = points.filter((p) => !p.forecast).slice(-10).map((p) => p.value);
  const ahead = points.filter((p) => p.forecast).slice(0, Math.max(1, horizon_years)).map((p) => p.value);
  const basis = history.length ? history : points.map((p) => p.value);
  const likely = ahead.length ? mean(ahead) : median(basis);
  const out = (n) => round2(clamp(n * elasticity));
  const c = series.citation || {};
  return {
    id, label, why: `${c.name || series.source} ${series.indicator}, ${series.country}`,
    likely_pct: out(likely), min_pct: out(percentile(basis, 0.1)), max_pct: out(percentile(basis, 0.9)), elasticity,
    source: { name: c.name || series.source, indicator: series.indicator, country: series.country, fetched_at: series.fetched_at, url: c.url },
  };
}

module.exports = { factorFromSeries };
