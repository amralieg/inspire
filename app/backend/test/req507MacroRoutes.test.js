// REQ-507 L3 (routes): backend/macroRoutes.js registers GET /api/inspire/macro/sources and GET /api/inspire/macro/series. A series is read
// from the 7-day cache in the Inspire database first (__inspire_macro_series); only a missing or stale entry is fetched (allowlisted hosts,
// stubbed fetch here) and written back. server.js mounts it. Fake warehouse, no network.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const express = require('express');
const { listen, sqlResultToObjects } = require('./support/implementApp');

const MR = (() => {
  try {
    return require('../macroRoutes');
  } catch {
    return {};
  }
})();

const NOW = new Date('2026-11-23T10:00:00Z');
const WB_REPLY = [{ page: 1, pages: 1, per_page: 100, total: 3 }, [
  { indicator: { id: 'NE.CON.PRVT.KD.ZG' }, countryiso3code: 'USA', date: '2025', value: 4.1 },
  { indicator: { id: 'NE.CON.PRVT.KD.ZG' }, countryiso3code: 'USA', date: '2024', value: 3.2 },
  { indicator: { id: 'NE.CON.PRVT.KD.ZG' }, countryiso3code: 'USA', date: '2023', value: 2.7 },
]];
const QUERY = 'source=worldbank&indicator=NE.CON.PRVT.KD.ZG&country=USA&inspire_database=main.inspire&warehouse_id=wh1';

function appWith({ cacheRows = [], fetchReply = WB_REPLY } = {}) {
  const sqlCalls = [];
  const fetches = [];
  const app = express();
  app.use(express.json());
  MR.registerMacroRoutes(app, {
    requireToken: (req, _res, next) => {
      req.dbHost = 'https://workspace.example.com';
      req.dbToken = 'tok';
      next();
    },
    executeSql: async (_h, token, warehouse, sql, parameters) => {
      sqlCalls.push({ sql, parameters, token, warehouse });
      if (/^SELECT/i.test(sql) && sql.includes('__inspire_macro_series')) return { rows: cacheRows };
      return { rows: [] };
    },
    sqlResultToObjects,
    fetchImpl: async (url, opts) => {
      fetches.push({ url: String(url), opts });
      if (fetchReply instanceof Error) throw fetchReply;
      return { ok: true, status: 200, json: async () => fetchReply, text: async () => JSON.stringify(fetchReply) };
    },
    now: () => NOW,
  });
  return { app, sqlCalls, fetches };
}
// SEC-17: the series read is a POST (it can fill the cache table); the test keeps the query string for brevity.
async function postSeries(made, route) {
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${route}`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
    return { status: resp.status, data: await resp.json().catch(() => ({})) };
  } finally {
    await srv.close();
  }
}

async function get(made, route) {
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}${route}`);
    return { status: resp.status, data: await resp.json().catch(() => ({})) };
  } finally {
    await srv.close();
  }
}
const cached = (fetchedAt) => ['2023', '2024', '2025'].map((period, i) => ({ source: 'worldbank', indicator: 'NE.CON.PRVT.KD.ZG', country: 'USA', period,
  value: String([2.7, 3.2, 4.1][i]), unit: '%', fetched_at: fetchedAt, citation_url: 'https://api.worldbank.org/v2/country/USA/indicator/NE.CON.PRVT.KD.ZG', licence: 'CC BY 4.0' }));

test('L3 routes: registerMacroRoutes is exported and server.js mounts it', () => {
  assert.equal(typeof MR.registerMacroRoutes, 'function');
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /require\('\.\/macroRoutes'\)/);
  assert.match(server, /registerMacroRoutes\(app,/);
});

test('L3 routes: GET /macro/sources lists Marketplace first, then the open APIs, with licence and no keys', async () => {
  const made = appWith();
  const got = await get(made, '/api/inspire/macro/sources');
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.deepEqual(got.data.sources.map((s) => s.id), ['marketplace', 'worldbank', 'imf', 'oecd', 'eurostat', 'undata']);
  assert.ok(got.data.sources.every((s) => s.licence !== undefined && !s.needs_key));
  assert.equal(made.fetches.length, 0, 'listing the sources fetches nothing');
});

test('L3 routes: a missing cache entry is fetched once, written to __inspire_macro_series with bound values, and returned with a citation', async () => {
  const made = appWith();
  const got = await postSeries(made, `/api/inspire/macro/series?${QUERY}`);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(made.fetches.length, 1);
  assert.equal(new URL(made.fetches[0].url).host, 'api.worldbank.org');
  assert.deepEqual(got.data.series.points.map((p) => p.period), ['2023', '2024', '2025']);
  assert.equal(got.data.series.citation.licence, 'CC BY 4.0');
  assert.equal(got.data.cached, false);
  const writes = made.sqlCalls.filter((c) => /^INSERT INTO/i.test(c.sql) && c.sql.includes('__inspire_macro_series'));
  assert.equal(writes.length, 1, 'one write');
  assert.ok(!writes[0].sql.includes('NE.CON.PRVT.KD.ZG'), 'values bound');
  assert.equal(made.sqlCalls[0].warehouse, 'wh1');
});

test('L3 routes: a cache entry under 7 days old is served with no fetch; an older one is fetched again', async () => {
  const fresh = appWith({ cacheRows: cached('2026-11-20T10:00:00Z') });
  const hit = await postSeries(fresh, `/api/inspire/macro/series?${QUERY}`);
  assert.equal(hit.status, 200, JSON.stringify(hit.data));
  assert.equal(fresh.fetches.length, 0, 'fresh cache: no fetch');
  assert.equal(hit.data.cached, true);
  assert.deepEqual(hit.data.series.points.map((p) => p.value), [2.7, 3.2, 4.1]);
  assert.equal(hit.data.series.fetched_at, '2026-11-20T10:00:00Z');
  const stale = appWith({ cacheRows: cached('2026-11-10T10:00:00Z') });
  const miss = await postSeries(stale, `/api/inspire/macro/series?${QUERY}`);
  assert.equal(miss.status, 200);
  assert.equal(stale.fetches.length, 1, 'stale cache: fetched again');
  const forced = appWith({ cacheRows: cached('2026-11-20T10:00:00Z') });
  await postSeries(forced, `/api/inspire/macro/series?${QUERY}&refresh=1`);
  assert.equal(forced.fetches.length, 1, 'refresh=1 fetches');
});

test('L3 routes: with factor_id the reply carries the factor from macroFactor (the maths stays on the server); elasticity scales it', async () => {
  const one = await postSeries(appWith(), `/api/inspire/macro/series?${QUERY}&factor_id=consumer_demand&factor_label=Consumer%20demand`);
  assert.equal(one.status, 200, JSON.stringify(one.data));
  assert.equal(one.data.factor.id, 'consumer_demand');
  assert.equal(one.data.factor.elasticity, 1);
  assert.equal(one.data.factor.source.indicator, 'NE.CON.PRVT.KD.ZG');
  const half = await postSeries(appWith(), `/api/inspire/macro/series?${QUERY}&factor_id=consumer_demand&factor_label=Consumer%20demand&elasticity=0.5`);
  assert.equal(half.data.factor.elasticity, 0.5);
  assert.equal(half.data.factor.likely_pct, Math.round(one.data.factor.likely_pct * 0.5 * 100) / 100);
  const bad = await postSeries(appWith(), `/api/inspire/macro/series?${QUERY}&factor_id=consumer_demand&elasticity=9`);
  assert.equal(bad.status, 400, 'elasticity is between 0 and 3');
});

test('L3 routes security: an unknown source, a URL-shaped indicator or a bad Inspire database is a 400 before any fetch or SQL', async () => {
  for (const q of [
    'source=https://evil.example.com&indicator=X&country=USA&inspire_database=main.inspire&warehouse_id=wh1',
    'source=worldbank&indicator=..%2F..%2Fx%3Fy%3D%40evil.example.com&country=USA&inspire_database=main.inspire&warehouse_id=wh1',
    'source=worldbank&indicator=NE.CON.PRVT.KD.ZG&country=USA&inspire_database=main.inspire%60%3B%20DROP%20TABLE%20x&warehouse_id=wh1',
  ]) {
    const made = appWith();
    const got = await postSeries(made, `/api/inspire/macro/series?${q}`);
    assert.equal(got.status, 400, `${q}: ${JSON.stringify(got.data)}`);
    assert.equal(made.fetches.length, 0);
    assert.equal(made.sqlCalls.length, 0);
  }
});

test('L3 routes: a blocked host is a 200 with blocked true and the plain message, so the wizard can offer Marketplace or a manual value', async () => {
  const made = appWith({ fetchReply: Object.assign(new TypeError('fetch failed'), { cause: { code: 'ENOTFOUND' } }) });
  const got = await postSeries(made, `/api/inspire/macro/series?${QUERY}`);
  assert.equal(got.status, 200, JSON.stringify(got.data));
  assert.equal(got.data.series.blocked, true);
  assert.match(got.data.series.message, /Your workspace blocks api\.worldbank\.org/);
  assert.equal(made.sqlCalls.filter((c) => /^INSERT/i.test(c.sql)).length, 0, 'nothing cached for a blocked host');
});
