// REQ-507 L3: GET /api/inspire/macro/sources and POST /api/inspire/macro/series. A series is read from the 7-day cache in the Inspire database
// (__inspire_macro_series) first; only a missing or stale one is fetched from an allowlisted host and written back.
const MS = require('./lib/macroSources');
const { factorFromSeries } = require('./lib/macroFactor');
const { isMissingTableError } = require('./lib/inspireFeedback');
const { INSPIRE_DB_SHAPE, splitInspireDatabase } = require('./lib/sqlInputs');
const PM_ERROR = require('./lib/permissionError');

const FACTOR_ID = /^[a-z][a-z0-9_]{0,30}$/;
const WAREHOUSE_ID = /^[A-Za-z0-9-]{1,64}$/;
const TABLE_NAME = '__inspire_macro_series';

function asUtc(text) {
  const t = String(text || '');
  return new Date(/[zZ]|[+-]\d{2}:?\d{2}$/.test(t) ? t : `${t.replace(' ', 'T')}Z`);
}

// Rows of one cached fetch back to a series, or null when empty or older than the cache days.
function seriesFromRows(rows, now) {
  if (!rows.length) return null;
  const first = rows[0];
  const at = asUtc(first.fetched_at);
  if (!Number.isFinite(at.getTime()) || now.getTime() - at.getTime() >= MS.CACHE_DAYS * 86400000) return null;
  const source = MS.SOURCES.find((s) => s.id === first.source);
  if (!source) return null;
  const year = now.getUTCFullYear();
  const points = rows.map((r) => ({ period: String(r.period), value: Number(r.value), forecast: Number(r.period) >= year }))
    .filter((p) => Number.isFinite(p.value)).sort((a, b) => (a.period < b.period ? -1 : a.period > b.period ? 1 : 0));
  return { source: first.source, indicator: first.indicator, country: first.country, unit: first.unit || '', fetched_at: first.fetched_at, points,
    citation: { name: source.name, indicator: first.indicator, country: first.country, url: first.citation_url, licence: first.licence || source.licence, fetched_at: first.fetched_at } };
}

function registerMacroRoutes(app, { requireToken, executeSql, sqlResultToObjects, fetchImpl, now = () => new Date() }) {
  app.get('/api/inspire/macro/sources', requireToken, (_req, res) => {
    res.json({ sources: MS.SOURCES, cache_days: MS.CACHE_DAYS });
  });

  // SEC-17: a series read can fill the cache table, so it is a POST (the cross-site guard covers every non-GET method).
  app.post('/api/inspire/macro/series', requireToken, async (req, res) => {
    const q = { ...(req.query || {}), ...(req.body && typeof req.body === 'object' ? req.body : {}) };
    const bad = (message) => res.status(400).json({ error: message });
    try {
      const ask = { source: String(q.source || ''), indicator: String(q.indicator || ''), country: String(q.country || '') };
      MS.seriesUrl(ask); // refuses an unknown source, indicator or country before any SQL or fetch
      const db = splitInspireDatabase(q.inspire_database);
      if (!db) return bad(INSPIRE_DB_SHAPE);
      if (!WAREHOUSE_ID.test(String(q.warehouse_id || ''))) return bad('Pick a SQL warehouse in Settings.');
      let elasticity = 1;
      if (q.elasticity !== undefined) {
        elasticity = Number(q.elasticity);
        if (q.elasticity === '' || !Number.isFinite(elasticity) || elasticity < 0 || elasticity > 3) return bad('elasticity is a number from 0 to 3.');
      }
      const factorId = q.factor_id === undefined ? null : String(q.factor_id);
      if (factorId !== null && !FACTOR_ID.test(factorId)) return bad('factor_id is lowercase letters, digits and underscores.');
      const factorLabel = String(q.factor_label || '').trim().slice(0, 60) || (factorId || '').replace(/_/g, ' ');

      const table = `\`${db.catalog}\`.\`${db.schema}\`.\`${TABLE_NAME}\``;
      const run = (stmt) => executeSql(req.dbHost, req.dbToken, q.warehouse_id, stmt.sql, stmt.parameters);
      const at = now();
      let series = null;
      let cached = false;
      if (!/^(1|true)$/i.test(String(q.refresh || ''))) {
        try {
          series = seriesFromRows(sqlResultToObjects(await run(MS.cacheReadSql(table, ask, at))), at);
          cached = !!series;
        } catch (err) {
          if (!isMissingTableError(err)) return PM_ERROR.sendFailure(res, 500, err.message);
        }
      }
      if (!series) {
        series = await MS.fetchSeries(ask, { fetchImpl, now: at });
        if (!series.blocked && series.points.length) {
          await run(MS.cacheCreateSql(table));
          await run(MS.cacheInsertSql(table, series));
        }
      }
      const factor = factorId && !series.blocked ? factorFromSeries(series, { id: factorId, label: factorLabel, elasticity }) : null;
      res.json({ series, cached, ...(factor ? { factor } : {}) });
    } catch (err) {
      PM_ERROR.sendFailure(res, PM_ERROR.failureStatus(err, 500), err.message);
    }
  });
}

module.exports = { registerMacroRoutes };
