// REQ-507 L3 (pure): public economic data for the market factors. backend/lib/macroSources.js lists the sources (Databricks Marketplace
// first, then World Bank, IMF, OECD, Eurostat, UN Data; no keys), builds URLs only for a fixed host allowlist (never a URL from the user or
// the model), fetches with a timeout and no redirects, and normalises every source to one series shape with a citation.
// backend/lib/macroFactor.js turns a series into a factor of the existing shape (valueReview.factorsFrom). No network: fetch is stubbed.
const test = require('node:test');
const assert = require('node:assert/strict');

const load = (p) => {
  try {
    return require(p);
  } catch {
    return {};
  }
};
const MS = load('../lib/macroSources');
const MF = load('../lib/macroFactor');
const VR = require('../lib/valueReview');

const NOW = new Date('2026-11-23T10:00:00Z');
// A recorded-shape World Bank Indicators API v2 reply: [paging, rows], newest first, a null year included.
const WB_REPLY = [{ page: 1, pages: 1, per_page: 100, total: 12 }, [
  ...[2025, 2024, 2023, 2022, 2021, 2020, 2019, 2018, 2017, 2016, 2015].map((y, i) => ({ indicator: { id: 'NE.CON.PRVT.KD.ZG', value: 'Households and NPISHs final consumption expenditure (annual % growth)' },
    country: { id: 'AE', value: 'United Arab Emirates' }, countryiso3code: 'ARE', date: String(y), value: 10 - i, unit: '', obs_status: '', decimal: 1 })),
  { indicator: { id: 'NE.CON.PRVT.KD.ZG', value: 'x' }, country: { id: 'AE', value: 'x' }, countryiso3code: 'ARE', date: '2014', value: null, unit: '', obs_status: '', decimal: 1 },
]];
// A recorded-shape IMF DataMapper v1 reply: values[indicator][country][year], with WEO forecasts past this year.
const IMF_REPLY = { values: { NGDP_RPCH: { ARE: { 2022: 7.5, 2023: 3.6, 2024: 3.8, 2025: 4.0, 2026: 5.0, 2027: 4.5, 2028: 4.2, 2029: 4.0, 2030: 4.0 } } }, api: { version: '1', 'output-method': 'json' } };
// SDMX-JSON 2.0 (OECD and UN Data) and JSON-stat 2.0 (Eurostat), the smallest recorded shapes.
const SDMX_REPLY = { data: { dataSets: [{ series: { '0:0:0': { observations: { 0: [98.1], 1: [99.4], 2: [100.2] } } } }],
  structures: [{ dimensions: { observation: [{ id: 'TIME_PERIOD', values: [{ id: '2023' }, { id: '2024' }, { id: '2025' }] }] } }] } };
const JSONSTAT_REPLY = { version: '2.0', class: 'dataset', id: ['time'], size: [3], value: { 0: 2.9, 1: 2.4, 2: 2.1 },
  dimension: { time: { category: { index: { 2023: 0, 2024: 1, 2025: 2 } } } } };

const okResponse = (body) => ({ ok: true, status: 200, json: async () => body, text: async () => JSON.stringify(body) });
function stubFetch(reply) {
  const calls = [];
  const fn = async (url, opts) => {
    calls.push({ url: String(url), opts: opts || {} });
    if (reply instanceof Error) throw reply;
    if (typeof reply === 'function') return reply(String(url));
    return okResponse(reply);
  };
  return { fn, calls };
}
const hostOf = (u) => new URL(u).host;

test('L3: the sources come in order, Marketplace first, no source needs a key, and IMF says its data is never used to train a model', () => {
  assert.deepEqual(MS.SOURCES.map((s) => s.id), ['marketplace', 'worldbank', 'imf', 'oecd', 'eurostat', 'undata']);
  assert.ok(MS.SOURCES.every((s) => !s.needs_key));
  assert.equal(MS.SOURCES[1].licence, 'CC BY 4.0');
  assert.match(MS.SOURCES.find((s) => s.id === 'imf').terms, /never used to train/i);
  assert.deepEqual([...MS.ALLOWED_HOSTS].sort(), ['api.worldbank.org', 'data.un.org', 'ec.europa.eu', 'sdmx.oecd.org', 'www.imf.org'].sort());
  assert.equal(MS.CACHE_DAYS, 7);
});

test('L3 security: every URL is built on an allowlisted host; a source, indicator or country that tries to steer the URL is refused without a fetch', async () => {
  for (const s of MS.SOURCES.filter((x) => x.id !== 'marketplace')) {
    const url = MS.seriesUrl({ source: s.id, indicator: s.id === 'imf' ? 'NGDP_RPCH' : 'NE.CON.PRVT.KD.ZG', country: 'ARE' });
    assert.ok(MS.ALLOWED_HOSTS.includes(hostOf(url)), `${s.id}: ${url}`);
    assert.match(url, /^https:\/\//);
  }
  const { fn, calls } = stubFetch(WB_REPLY);
  for (const ask of [
    { source: 'https://evil.example.com', indicator: 'X', country: 'ARE' },
    { source: 'worldbank', indicator: '../../x?y=@evil.example.com', country: 'ARE' },
    { source: 'worldbank', indicator: 'NE.CON.PRVT.KD.ZG', country: 'ARE/../../evil' },
    { source: 'worldbank', indicator: 'NE.CON.PRVT.KD.ZG#@evil.example.com', country: 'ARE' },
  ]) {
    await assert.rejects(() => MS.fetchSeries(ask, { fetchImpl: fn, now: NOW }), `refused: ${JSON.stringify(ask)}`);
  }
  assert.equal(calls.length, 0, 'nothing was fetched');
});

test('L3: World Bank normalises to one series shape, oldest first, nulls dropped, with a citation', async () => {
  const { fn, calls } = stubFetch(WB_REPLY);
  const s = await MS.fetchSeries({ source: 'worldbank', indicator: 'NE.CON.PRVT.KD.ZG', country: 'ARE' }, { fetchImpl: fn, now: NOW });
  assert.equal(calls.length, 1);
  assert.equal(hostOf(calls[0].url), 'api.worldbank.org');
  assert.notEqual(calls[0].opts.redirect || 'follow', 'follow', 'a redirect cannot take the fetch off the allowlist');
  assert.ok(calls[0].opts.signal, 'the fetch has a timeout signal');
  assert.equal(s.source, 'worldbank');
  assert.equal(s.indicator, 'NE.CON.PRVT.KD.ZG');
  assert.equal(s.country, 'ARE');
  assert.equal(s.fetched_at, NOW.toISOString());
  assert.equal(s.points.length, 11);
  assert.deepEqual(s.points[0], { period: '2015', value: 0, forecast: false });
  assert.deepEqual(s.points[10], { period: '2025', value: 10, forecast: false });
  assert.deepEqual(s.citation, { name: 'World Bank', indicator: 'NE.CON.PRVT.KD.ZG', country: 'ARE', url: calls[0].url, licence: 'CC BY 4.0', fetched_at: NOW.toISOString() });
});

test('L3: IMF DataMapper normalises to the same shape, years from this one on marked as forecast', async () => {
  const { fn } = stubFetch(IMF_REPLY);
  const s = await MS.fetchSeries({ source: 'imf', indicator: 'NGDP_RPCH', country: 'ARE' }, { fetchImpl: fn, now: NOW });
  assert.deepEqual(Object.keys(s).sort(), ['citation', 'country', 'fetched_at', 'indicator', 'points', 'source', 'unit'].sort());
  assert.deepEqual(s.points.map((p) => p.period), ['2022', '2023', '2024', '2025', '2026', '2027', '2028', '2029', '2030']);
  assert.deepEqual(s.points.filter((p) => p.forecast).map((p) => p.period), ['2026', '2027', '2028', '2029', '2030']);
  assert.equal(s.citation.name, 'IMF');
});

test('L3: OECD and UN Data (SDMX-JSON) and Eurostat (JSON-stat) normalise to the same shape', async () => {
  for (const [source, reply, indicator, country] of [['oecd', SDMX_REPLY, 'DSD_STES@DF_CLI', 'ARE'], ['undata', SDMX_REPLY, 'DF_UNDATA_WPP', 'ARE'], ['eurostat', JSONSTAT_REPLY, 'prc_hicp_aind', 'DE']]) {
    const { fn, calls } = stubFetch(reply);
    const s = await MS.fetchSeries({ source, indicator, country }, { fetchImpl: fn, now: NOW });
    assert.ok(MS.ALLOWED_HOSTS.includes(hostOf(calls[0].url)), source);
    assert.deepEqual(s.points.map((p) => p.period), ['2023', '2024', '2025'], source);
    assert.ok(s.points.every((p) => typeof p.value === 'number'), source);
    assert.ok(s.citation.name && s.citation.url, source);
  }
});

test('L3: a host the workspace blocks gives a plain message instead of an error', async () => {
  const refused = Object.assign(new TypeError('fetch failed'), { cause: { code: 'ECONNREFUSED' } });
  for (const reply of [refused, () => ({ ok: false, status: 403, json: async () => ({}), text: async () => 'Forbidden' })]) {
    const { fn } = stubFetch(reply);
    const s = await MS.fetchSeries({ source: 'worldbank', indicator: 'NE.CON.PRVT.KD.ZG', country: 'ARE' }, { fetchImpl: fn, now: NOW });
    assert.equal(s.blocked, true);
    assert.equal(s.host, 'api.worldbank.org');
    assert.equal(s.message, 'Your workspace blocks api.worldbank.org; ask an admin to allow it, or use a Marketplace share');
  }
});

test('L3: the cache SQL reads and writes with bound parameters only, in the Inspire database table __inspire_macro_series', () => {
  const table = '`main`.`inspire`.`__inspire_macro_series`';
  const read = MS.cacheReadSql(table, { source: 'worldbank', indicator: 'NE.CON.PRVT.KD.ZG', country: 'ARE' }, NOW);
  assert.match(read.sql, /^SELECT .+ FROM `main`\.`inspire`\.`__inspire_macro_series` WHERE /s);
  for (const v of ['NE.CON.PRVT.KD.ZG', 'ARE', 'worldbank']) {
    assert.ok(!read.sql.includes(v), `${v} is bound`);
    assert.ok(read.parameters.some((p) => p.value === v), `${v} is a parameter`);
  }
  const series = { source: 'worldbank', indicator: "x'; DROP TABLE t; --", country: 'ARE', unit: '%', fetched_at: NOW.toISOString(),
    points: [{ period: '2024', value: 1.5, forecast: false }], citation: { name: 'World Bank', url: 'https://api.worldbank.org/v2/x', licence: 'CC BY 4.0' } };
  const write = MS.cacheInsertSql(table, series);
  assert.match(write.sql, /^INSERT INTO `main`\.`inspire`\.`__inspire_macro_series` /);
  assert.doesNotMatch(write.sql, /DROP/);
  for (const col of ['source', 'indicator', 'country', 'period', 'value', 'unit', 'fetched_at', 'citation_url', 'licence']) assert.match(MS.cacheCreateSql(table).sql, new RegExp(`\\b${col}\\b`));
});

test('L3: a series becomes a factor: likely = forecast change x elasticity, min/max = P10/P90 of the last 10 years x elasticity, clamped to +-50', () => {
  const series = { source: 'imf', indicator: 'NGDP_RPCH', country: 'ARE', unit: '%', fetched_at: NOW.toISOString(), citation: { name: 'IMF', url: 'https://www.imf.org/x', licence: 'IMF terms' },
    points: [...[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((v, i) => ({ period: String(2016 + i), value: v, forecast: false })),
      { period: '2026', value: 2, forecast: true }, { period: '2027', value: 3, forecast: true }, { period: '2028', value: 4, forecast: true }, { period: '2029', value: 40, forecast: true }] };
  const f = MF.factorFromSeries(series, { id: 'gdp_growth', label: 'Real GDP growth', horizon_years: 3 });
  assert.equal(f.likely_pct, 3);
  assert.equal(f.min_pct, 1.9);
  assert.equal(f.max_pct, 9.1);
  assert.equal(f.elasticity, 1);
  assert.deepEqual(f.source, { name: 'IMF', indicator: 'NGDP_RPCH', country: 'ARE', fetched_at: NOW.toISOString(), url: 'https://www.imf.org/x' });
  const half = MF.factorFromSeries(series, { id: 'gdp_growth', label: 'Real GDP growth', horizon_years: 3, elasticity: 0.5 });
  assert.deepEqual([half.likely_pct, half.min_pct, half.max_pct], [1.5, 0.95, 4.55]);
  const big = MF.factorFromSeries({ ...series, points: series.points.map((p) => ({ ...p, value: p.value * 10 })) }, { id: 'gdp_growth', label: 'x', horizon_years: 3 });
  assert.equal(big.max_pct, 50);
  // The factor keeps the existing shape: valueReview.factorsFrom keeps its numbers as they are.
  const kept = VR.factorsFrom([f])[0];
  assert.deepEqual([kept.id, kept.likely_pct, kept.min_pct, kept.max_pct], ['gdp_growth', 3, 1.9, 9.1]);
});
