// REQ-507 L5 (pure): the Market data pages of the value wizard. Source cards, the query for the App's macro series route, chart points,
// the citation line and the blocked-host line. No network here; the component asks through the App.
export const SOURCES_ROUTE = '/api/inspire/macro/sources';
export const SERIES_ROUTE = '/api/inspire/macro/series';

const ORDER = ['marketplace', 'worldbank', 'imf', 'oecd', 'eurostat', 'undata'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const QUERY_KEYS = ['source', 'indicator', 'country', 'inspire_database', 'warehouse_id'];

// Approved order; a source the list does not know goes last, in its own order. The input list is not changed.
export function orderSources(sources) {
  const rank = (s) => { const i = ORDER.indexOf(s.id); return i < 0 ? ORDER.length : i; };
  return (sources || []).map((s, i) => ({ s, i })).sort((a, b) => rank(a.s) - rank(b.s) || a.i - b.i).map((x) => x.s);
}

// Only the picked source, indicator, country and where to cache; nothing else (never a URL) reaches the server.
export function seriesQuery(input = {}) {
  const q = {};
  for (const k of QUERY_KEYS) if (input[k] !== undefined && input[k] !== null && input[k] !== '') q[k] = String(input[k]);
  return q;
}

const dateText = (iso) => {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '' : `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
};

export function chartPoints(series) {
  const pts = (series?.points || []).filter((p) => typeof p.value === 'number' && Number.isFinite(p.value));
  const toXY = (p) => ({ x: String(p.period), y: p.value });
  const byPeriod = (a, b) => (a.x < b.x ? -1 : a.x > b.x ? 1 : 0);
  return { history: pts.filter((p) => !p.forecast).map(toXY).sort(byPeriod), forecast: pts.filter((p) => p.forecast).map(toXY).sort(byPeriod) };
}

export function citationLine(series) {
  const c = series?.citation || {};
  const { history } = chartPoints(series);
  const years = history.length ? `${history[0].x}-${history[history.length - 1].x}` : '';
  return [c.name, c.indicator, c.country, years, `fetched ${dateText(c.fetched_at || series?.fetched_at)}`, c.licence].filter(Boolean).join(', ');
}

export const blockedLine = (reply) => (reply?.blocked ? String(reply.message || '') : '');
