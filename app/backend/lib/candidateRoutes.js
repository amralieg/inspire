// REQ-581 U3: GET /api/inspire/candidates?inspire_database&warehouse_id&session_id
// Reads <inspire_db>.__inspire_candidates for one session and answers one row per candidate (latest event_at wins):
//   { candidates: [{ candidate_id, state, merged_into, provisional_rank, name, history, event_at }] }
// ordered by provisional_rank (unranked last), then candidate_id. A database with no candidate table yet answers an empty list.

const { splitInspireDatabase, INSPIRE_DB_SHAPE } = require('./sqlInputs');
const { isInt64Id } = require('./int64Id');

const MISSING_TABLE = /\b(?:TABLE_OR_VIEW_NOT_FOUND|SCHEMA_NOT_FOUND|CATALOG_NOT_FOUND)\b|cannot be found|does not exist/i;

const str = (v) => (v == null ? '' : String(v).trim());
const fail = (res, status, error) => res.status(status).json({ error });
const atOf = (row) => { const t = Date.parse(str(row.event_at)); return Number.isFinite(t) ? t : 0; };
const rankOf = (row) => { const n = row.provisional_rank == null || str(row.provisional_rank) === '' ? NaN : Number(row.provisional_rank); return Number.isFinite(n) ? n : null; };

function historyOf(raw) {
  try { const doc = JSON.parse(str(raw)); return Array.isArray(doc) ? doc : []; } catch { return []; }
}
function nameOf(history, id) {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const name = history[i] && typeof history[i] === 'object' ? str(history[i].name) : '';
    if (name) return name;
  }
  return id;
}

function registerCandidateRoutes(app, deps) {
  const { requireToken, executeSql, sqlResultToObjects } = deps;

  app.get('/api/inspire/candidates', requireToken, async (req, res) => {
    try {
      const q = req.query || {};
      // The App pins the database it owns into req.query before routes run (SEC-07); the shape check looks at what the caller asked for.
      let asked = q.inspire_database;
      try { asked = new URL(req.originalUrl || req.url || '', 'http://app.invalid').searchParams.get('inspire_database') ?? asked; } catch { /* keep the parsed query */ }
      const db = splitInspireDatabase(str(asked)) && splitInspireDatabase(str(q.inspire_database));
      if (!db) return fail(res, 400, INSPIRE_DB_SHAPE);
      const warehouse = str(q.warehouse_id);
      if (!warehouse) return fail(res, 400, 'warehouse_id is required.');
      const sessionId = str(q.session_id);
      if (!isInt64Id(sessionId)) return fail(res, 400, 'session_id must be a numeric Inspire session id.');
      const table = `\`${db.catalog}\`.\`${db.schema}\`.\`__inspire_candidates\``;
      let rows;
      try {
        rows = sqlResultToObjects(await executeSql(req.dbHost, req.dbToken, warehouse,
          `SELECT session_id, candidate_id, state, merged_into, provisional_rank, history_json, event_at FROM ${table} WHERE session_id = :session_id`,
          [{ name: 'session_id', value: sessionId, type: 'BIGINT' }]));
      } catch (err) {
        if (MISSING_TABLE.test(str(err && err.message))) return res.json({ candidates: [] });
        throw err;
      }
      const best = new Map();
      for (const row of rows || []) {
        const key = str(row.candidate_id);
        const held = best.get(key);
        if (!held || atOf(row) >= atOf(held)) best.set(key, row);
      }
      const candidates = [...best.values()].map((r) => {
        const history = historyOf(r.history_json);
        const id = str(r.candidate_id);
        return { candidate_id: id, state: str(r.state), merged_into: str(r.merged_into) || null, provisional_rank: rankOf(r), name: nameOf(history, id), history, event_at: str(r.event_at) };
      }).sort((a, b) => (a.provisional_rank == null) - (b.provisional_rank == null)
        || (a.provisional_rank ?? 0) - (b.provisional_rank ?? 0) || a.candidate_id.localeCompare(b.candidate_id));
      return res.json({ candidates });
    } catch (err) {
      return fail(res, err.statusCode && Number.isFinite(err.statusCode) ? err.statusCode : 500, str(err.message) || 'Inspire could not read the candidates.');
    }
  });
}

module.exports = { registerCandidateRoutes };
