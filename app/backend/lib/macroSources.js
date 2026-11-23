// REQ-507 L3: public economic data. Databricks Marketplace first (an admin names its table; the read is a later step), then open APIs that
// need no key. Every URL is built here, on a fixed host allowlist, from a validated source id, indicator and country; nothing the user or the
// model types becomes a host or a path. Fetches have a timeout and no redirects. Every source is normalised to one series shape with a citation.
const FETCH_TIMEOUT_MS = 15000;
const CACHE_DAYS = 7;
const INDICATOR_RE = /^[A-Za-z0-9._@-]{1,40}$/;
const COUNTRY_RE = /^[A-Z]{2,3}$/;

const SOURCES = [
  { id: 'marketplace', name: 'Databricks Marketplace', host: null, licence: 'Per share terms', terms: 'Read from a Marketplace share an admin names.', needs_key: false, configured: false },
  { id: 'worldbank', name: 'World Bank', host: 'api.worldbank.org', licence: 'CC BY 4.0', terms: 'World Bank Open Data, CC BY 4.0.', needs_key: false, configured: true },
  { id: 'imf', name: 'IMF', host: 'www.imf.org', licence: 'IMF terms', terms: 'IMF data is never used to train a model; cite the IMF DataMapper.', needs_key: false, configured: true },
  { id: 'oecd', name: 'OECD', host: 'sdmx.oecd.org', licence: 'OECD terms', terms: 'OECD Data Explorer terms of use.', needs_key: false, configured: true },
  { id: 'eurostat', name: 'Eurostat', host: 'ec.europa.eu', licence: 'CC BY 4.0', terms: 'Eurostat reuse policy, CC BY 4.0.', needs_key: false, configured: true },
  { id: 'undata', name: 'UN Data', host: 'data.un.org', licence: 'UN terms', terms: 'UN Data terms of use.', needs_key: false, configured: true },
];
const ALLOWED_HOSTS = SOURCES.filter((s) => s.host).map((s) => s.host);
const BLOCKED_CODES = new Set(['ECONNREFUSED', 'ENOTFOUND', 'ECONNRESET', 'EAI_AGAIN', 'EHOSTUNREACH', 'ENETUNREACH', 'UNABLE_TO_VERIFY_LEAF_SIGNATURE', 'SELF_SIGNED_CERT_IN_CHAIN']);

function refusal(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

function checked(ask) {
  const a = ask || {};
  const source = SOURCES.find((s) => s.id === a.source);
  if (!source) throw refusal('That source is not one Inspire reads. Pick one from the list.');
  if (!source.host) throw refusal('Marketplace is not set up yet; an admin names its table first.');
  if (typeof a.indicator !== 'string' || !INDICATOR_RE.test(a.indicator)) throw refusal('That indicator is not valid. Use the code the source gives, such as NE.CON.PRVT.KD.ZG.');
  if (typeof a.country !== 'string' || !COUNTRY_RE.test(a.country)) throw refusal('That country is not valid. Use its 2 or 3 letter code, such as DE or ARE.');
  return { source, indicator: a.indicator, country: a.country };
}

function seriesUrl(ask) {
  const { source, indicator, country } = checked(ask);
  const i = encodeURIComponent(indicator);
  const c = encodeURIComponent(country);
  const url = {
    worldbank: `https://api.worldbank.org/v2/country/${c}/indicator/${i}?format=json&per_page=100`,
    imf: `https://www.imf.org/external/datamapper/api/v1/${i}/${c}`,
    oecd: `https://sdmx.oecd.org/public/rest/data/${i}/${c}?format=jsondata`,
    eurostat: `https://ec.europa.eu/eurostat/api/dissemination/statistics/1.0/data/${i}?format=JSON&lang=en&geo=${c}`,
    undata: `https://data.un.org/ws/rest/data/${i}/${c}?format=jsondata`,
  }[source.id];
  if (new URL(url).host !== source.host || !ALLOWED_HOSTS.includes(source.host)) throw refusal('That address is not on the allowed list.');
  return url;
}

const num = (v) => (v === null || v === undefined || v === '' ? NaN : Number(v));
const byPeriod = (a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0);

function worldBankPoints(body) {
  const rows = Array.isArray(body) && Array.isArray(body[1]) ? body[1] : [];
  return { points: rows.map((r) => ({ period: String(r && r.date), value: num(r && r.value) })), unit: (rows.find((r) => r && r.unit) || {}).unit || '' };
}
function imfPoints(body, indicator, country) {
  const by = (((body || {}).values || {})[indicator] || {})[country] || {};
  return { points: Object.entries(by).map(([period, value]) => ({ period, value: num(value) })), unit: '' };
}
// SDMX-JSON 1.0 (structure) and 2.0 (structures): the first series, its observations keyed by the position in the time dimension.
function sdmxPoints(body) {
  const data = (body && body.data) || {};
  const set = (data.dataSets || [])[0] || {};
  const series = Object.values(set.series || {})[0] || {};
  const struct = (data.structures || [])[0] || data.structure || {};
  const dims = (struct.dimensions || {}).observation || [];
  const time = dims.find((d) => d.id === 'TIME_PERIOD') || dims[0] || {};
  const periods = (time.values || []).map((v) => String(v.id));
  const obs = series.observations || (set.observations || {});
  return { points: Object.entries(obs).map(([k, v]) => ({ period: periods[Number(k)], value: num(Array.isArray(v) ? v[0] : v) })), unit: '' };
}
// JSON-stat 2.0: values sit at a flat position; keep the ones where every non-time dimension is at its first category.
function jsonStatPoints(body) {
  const ids = (body && body.id) || [];
  const sizes = (body && body.size) || [];
  const t = ids.findIndex((d) => /^(time|time_period)$/i.test(d));
  if (t < 0) return { points: [], unit: '' };
  const idx = body.dimension[ids[t]].category.index;
  const entries = Array.isArray(idx) ? idx.map((p, n) => [p, n]) : Object.entries(idx);
  const stride = sizes.slice(t + 1).reduce((a, n) => a * n, 1);
  const values = body.value || {};
  return { points: entries.map(([period, n]) => ({ period: String(period), value: num(Array.isArray(values) ? values[n * stride] : values[n * stride]) })), unit: '' };
}

const PARSERS = {
  worldbank: (b) => worldBankPoints(b),
  imf: (b, ask) => imfPoints(b, ask.indicator, ask.country),
  oecd: (b) => sdmxPoints(b),
  undata: (b) => sdmxPoints(b),
  eurostat: (b) => jsonStatPoints(b),
};

function blockedBy(err) {
  const code = (err && err.cause && err.cause.code) || (err && err.code);
  return BLOCKED_CODES.has(code) || (err instanceof TypeError && /fetch failed/i.test(err.message) && !code);
}
const blockedSeries = (host) => ({ blocked: true, host, message: `Your workspace blocks ${host}; ask an admin to allow it, or use a Marketplace share` });

// One validated ask in, one series out: {source, indicator, country, unit, fetched_at, points: [{period, value, forecast}], citation}.
// A blocked host returns {blocked, host, message}; anything else that goes wrong throws.
async function fetchSeries(ask, { fetchImpl = fetch, now = new Date() } = {}) {
  const { source, indicator, country } = checked(ask);
  const url = seriesUrl(ask);
  const year = now.getUTCFullYear();
  let resp;
  try {
    resp = await fetchImpl(url, { method: 'GET', redirect: 'manual', headers: { Accept: 'application/json' }, signal: AbortSignal.timeout(FETCH_TIMEOUT_MS) });
  } catch (err) {
    if (blockedBy(err)) return blockedSeries(source.host);
    throw refusal(`${source.name} did not answer in time or could not be reached. Try again, or use a Marketplace share.`, 502);
  }
  if (resp.status === 403 || resp.status === 407) return blockedSeries(source.host);
  if (resp.status >= 300 && resp.status < 400) throw refusal(`${source.name} sent Inspire to another address, which Inspire does not follow.`, 502);
  if (!resp.ok) throw refusal(`${source.name} answered with status ${resp.status}.`, 502);
  let body;
  try {
    body = await resp.json();
  } catch {
    throw refusal(`${source.name} sent an answer Inspire cannot read.`, 502);
  }
  const parsed = PARSERS[source.id](body, { indicator, country });
  const points = parsed.points.filter((p) => p.period && Number.isFinite(p.value)).sort(byPeriod)
    .map((p) => ({ period: p.period, value: p.value, forecast: Number(p.period) >= year }));
  const fetched_at = now.toISOString();
  return { source: source.id, indicator, country, unit: parsed.unit, fetched_at, points,
    citation: { name: source.name, indicator, country, url, licence: source.licence, fetched_at } };
}

const COLUMNS = ['source', 'indicator', 'country', 'period', 'value', 'unit', 'fetched_at', 'citation_url', 'licence'];
const KEY_WHERE = 'source = :source AND indicator = :indicator AND country = :country';

function cacheCreateSql(table) {
  return { sql: `CREATE TABLE IF NOT EXISTS ${table} (source STRING, indicator STRING, country STRING, period STRING, value DOUBLE, unit STRING, `
    + 'fetched_at TIMESTAMP, citation_url STRING, licence STRING)', parameters: null };
}

// The latest fetch of one series that is not older than CACHE_DAYS; every value is a bound parameter.
function cacheReadSql(table, key, now = new Date()) {
  const since = new Date(now.getTime() - CACHE_DAYS * 86400000).toISOString();
  return {
    sql: `SELECT ${COLUMNS.join(', ')} FROM ${table} WHERE ${KEY_WHERE} AND fetched_at >= CAST(:since AS TIMESTAMP) `
      + `AND fetched_at = (SELECT MAX(fetched_at) FROM ${table} WHERE ${KEY_WHERE}) ORDER BY period`,
    parameters: [
      { name: 'source', value: String(key.source), type: 'STRING' },
      { name: 'indicator', value: String(key.indicator), type: 'STRING' },
      { name: 'country', value: String(key.country), type: 'STRING' },
      { name: 'since', value: since, type: 'STRING' },
    ],
  };
}

function cacheInsertSql(table, series) {
  const parameters = [];
  const rows = series.points.map((p, n) => {
    const add = (name, value, type = 'STRING') => {
      parameters.push({ name: `${name}${n}`, value: String(value), type });
      return `:${name}${n}`;
    };
    return `(${add('source', series.source)}, ${add('indicator', series.indicator)}, ${add('country', series.country)}, ${add('period', p.period)}, `
      + `CAST(${add('value', p.value)} AS DOUBLE), ${add('unit', series.unit || '')}, CAST(${add('fetched_at', series.fetched_at)} AS TIMESTAMP), `
      + `${add('citation_url', (series.citation || {}).url || '')}, ${add('licence', (series.citation || {}).licence || '')})`;
  });
  return { sql: `INSERT INTO ${table} (${COLUMNS.join(', ')}) VALUES ${rows.join(', ')}`, parameters };
}

module.exports = { SOURCES, ALLOWED_HOSTS, CACHE_DAYS, INDICATOR_RE, COUNTRY_RE, seriesUrl, fetchSeries, cacheCreateSql, cacheReadSql, cacheInsertSql };
