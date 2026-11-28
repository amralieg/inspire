// c33 base STUB (lane C owns this file). REQ-578, REQ-579 Match existing use cases to data (a run of its own, REQ-579).
// Contract (agreed with the agent; report_json shape in app/frontend/src/lib/startWizard.js):
//   POST /api/inspire/match/start    { inspire_database, warehouse_id, business_name, use_cases: [{ input_no, name, description }], params }
//        Mints a session id, writes <inspire_db>.__inspire_match_input (session_id, input_no, name, description, event_at), then launches
//        through deps.launchRun with 15_operation='Match Use Cases', 19_match_phase='match', 14_session_id set. Answers { session_id, run_id }.
//   GET  /api/inspire/match/result   ?inspire_database&warehouse_id&session_id[&run_id]
//        Answers { state: 'none'|'running'|'done'|'failed', inputs: [{ input_no, name, description }] (from __inspire_match_input),
//                  reports: Report[] (from __inspire_match.report_json, latest event_at per input_no),
//                  decisions: [{ input_no, piece_no, decision, event_at }] (from __inspire_match_decision, latest event_at per piece wins) }.
//        state 'none' means the session has no match input (not a Match run): the Monitor and Results pages then show nothing extra.
//        With run_id the state follows the job run (deps.readRun); without it, 'done' once every input has a report.
//   POST /api/inspire/match/decision { inspire_database, warehouse_id, session_id, input_no, piece_no, decision: keep|drop|use_known_data }
//        Appends one row to __inspire_match_decision. Answers { ok: true }.
//   POST /api/inspire/match/accept   { inspire_database, warehouse_id, session_id, params }
//        Phase 2: launches with 19_match_phase='accept' in the same session. Answers { session_id, run_id }.
// deps: same as wizPlanRoutes.js.

const { splitInspireDatabase, INSPIRE_DB_SHAPE } = require('./sqlInputs');
const { isInt64Id } = require('./int64Id');

const MATCH_INPUT_MAX = 50;
const DECISIONS = ['keep', 'drop', 'use_known_data'];
const NAME_MAX = 300;
const DESCRIPTION_MAX = 2000;
const MATCH_OPERATION = 'Match Use Cases';
const MISSING_TABLE = /\b(?:TABLE_OR_VIEW_NOT_FOUND|SCHEMA_NOT_FOUND|CATALOG_NOT_FOUND)\b|cannot be found|does not exist/i;

const str = (v) => (v == null ? '' : String(v).trim());
const fail = (res, status, error) => res.status(status).json({ error });
const tableOf = (db, name) => { const d = splitInspireDatabase(db); return d ? `\`${d.catalog}\`.\`${d.schema}\`.\`${name}\`` : null; };
const positiveInt = (v) => { const n = typeof v === 'number' ? v : (/^\d+$/.test(str(v)) ? Number(v) : NaN); return Number.isSafeInteger(n) && n >= 1 ? n : null; };
const newSessionId = () => `${Date.now()}${Math.floor(Math.random() * 1e6)}`;
const atOf = (row) => { const t = Date.parse(str(row.event_at)); return Number.isFinite(t) ? t : 0; };

const INPUT_DDL = (t) => `CREATE TABLE IF NOT EXISTS ${t} (session_id BIGINT, input_no INT, name STRING, description STRING, event_at TIMESTAMP)`;
const DECISION_DDL = (t) => `CREATE TABLE IF NOT EXISTS ${t} (session_id BIGINT, input_no INT, piece_no INT, decision STRING, event_at TIMESTAMP)`;

// Latest row per key by event_at; on a tie the later row in the answer wins.
function latestBy(rows, keyOf) {
  const best = new Map();
  for (const row of rows) {
    const key = keyOf(row);
    const held = best.get(key);
    if (!held || atOf(row) >= atOf(held)) best.set(key, row);
  }
  return [...best.values()];
}

function registerMatchRoutes(app, deps) {
  const { requireToken, executeSql, sqlResultToObjects, launchRun, readRun } = deps;

  const run = (req, warehouse, sql, parameters = null) => executeSql(req.dbHost, req.dbToken, warehouse, sql, parameters);
  const where = (src) => {
    const db = str(src.inspire_database);
    const warehouse = str(src.warehouse_id);
    if (!splitInspireDatabase(db)) return { error: INSPIRE_DB_SHAPE };
    if (!warehouse) return { error: 'warehouse_id is required.' };
    return { db, warehouse };
  };
  const sessionOf = (src) => {
    const id = str(src.session_id);
    return isInt64Id(id) ? { id } : { error: 'session_id must be a numeric Inspire session id.' };
  };
  const launched = (res, out, sessionId) => {
    if (out.status !== 200 || !out.body) return fail(res, out.status >= 400 ? out.status : 500, str(out.body && out.body.error) || 'Inspire could not start the match run.');
    const { run_id: runId, warnings } = out.body;
    return res.json({ session_id: sessionId, run_id: runId, ...(warnings && warnings.length ? { warnings } : {}) });
  };
  const launchParams = (params, db, sessionId, phase, business) => ({
    ...(params && typeof params === 'object' && !Array.isArray(params) ? params : {}),
    ...(business ? { '00_business_name': business } : {}),
    '02_inspire_database': db, '14_session_id': sessionId, '15_operation': MATCH_OPERATION, '19_match_phase': phase,
  });

  app.post('/api/inspire/match/start', requireToken, async (req, res) => {
    try {
      const body = req.body || {};
      const at = where(body);
      if (at.error) return fail(res, 400, at.error);
      const business = str(body.business_name);
      if (!business) return fail(res, 400, 'business_name is required.');
      const given = Array.isArray(body.use_cases) ? body.use_cases : [];
      if (!given.length) return fail(res, 400, 'Add at least one use case to match.');
      if (given.length > MATCH_INPUT_MAX) return fail(res, 400, `Match at most ${MATCH_INPUT_MAX} use cases in one run; this has ${given.length}.`);
      const cases = given.map((u, i) => ({ input_no: i + 1, name: str(u && u.name).slice(0, NAME_MAX), description: str(u && u.description).slice(0, DESCRIPTION_MAX) }));
      const blank = cases.find((u) => !u.name);
      if (blank) return fail(res, 400, `Use case ${blank.input_no} has no name.`);
      const sessionId = newSessionId();
      const table = tableOf(at.db, '__inspire_match_input');
      await run(req, at.warehouse, INPUT_DDL(table));
      const parameters = [{ name: 'session_id', value: sessionId, type: 'BIGINT' }];
      const values = cases.map((u) => {
        parameters.push({ name: `n${u.input_no}`, value: u.name, type: 'STRING' }, { name: `d${u.input_no}`, value: u.description, type: 'STRING' });
        return `(:session_id, ${u.input_no}, :n${u.input_no}, :d${u.input_no}, current_timestamp())`;
      });
      await run(req, at.warehouse, `INSERT INTO ${table} (session_id, input_no, name, description, event_at) VALUES ${values.join(', ')}`, parameters);
      const params = launchParams(body.params, at.db, sessionId, 'match', business);
      const out = await launchRun(req, { params, notebook_path: body.notebook_path, cluster_id: body.cluster_id });
      return launched(res, out, sessionId);
    } catch (err) {
      return fail(res, err.statusCode && Number.isFinite(err.statusCode) ? err.statusCode : 500, str(err.message) || 'Inspire could not start the match run.');
    }
  });

  app.get('/api/inspire/match/result', requireToken, async (req, res) => {
    try {
      const at = where(req.query || {});
      if (at.error) return fail(res, 400, at.error);
      const session = sessionOf(req.query || {});
      if (session.error) return fail(res, 400, session.error);
      const parameters = [{ name: 'session_id', value: session.id, type: 'BIGINT' }];
      const read = async (name, columns) => {
        try {
          return sqlResultToObjects(await run(req, at.warehouse, `SELECT ${columns} FROM ${tableOf(at.db, name)} WHERE session_id = :session_id`, parameters));
        } catch (err) {
          if (MISSING_TABLE.test(str(err && err.message))) return null;
          throw err;
        }
      };
      const none = { state: 'none', inputs: [], reports: [], decisions: [] };
      const inputRows = await read('__inspire_match_input', 'session_id, input_no, name, description, event_at');
      if (!inputRows || !inputRows.length) return res.json(none);
      const inputs = latestBy(inputRows, (r) => Number(r.input_no)).map((r) => ({ input_no: Number(r.input_no), name: str(r.name), description: str(r.description) }))
        .sort((a, b) => a.input_no - b.input_no);
      const reportRows = (await read('__inspire_match', 'session_id, input_no, report_json, verdict, confidence, event_at')) || [];
      const reports = latestBy(reportRows, (r) => Number(r.input_no)).map((r) => {
        try { const doc = JSON.parse(r.report_json); return doc && typeof doc === 'object' ? { ...doc, input_no: Number(r.input_no) } : null; } catch { return null; }
      }).filter(Boolean).sort((a, b) => a.input_no - b.input_no);
      const decisionRows = (await read('__inspire_match_decision', 'session_id, input_no, piece_no, decision, event_at')) || [];
      const decisions = latestBy(decisionRows, (r) => `${Number(r.input_no)}:${Number(r.piece_no)}`)
        .map((r) => ({ input_no: Number(r.input_no), piece_no: Number(r.piece_no), decision: str(r.decision), event_at: str(r.event_at) }))
        .sort((a, b) => a.input_no - b.input_no || a.piece_no - b.piece_no);
      let state = 'running';
      const runId = str((req.query || {}).run_id);
      if (inputs.every((u) => reports.some((r) => r.input_no === u.input_no))) state = 'done';
      else if (runId && readRun) {
        const got = await readRun(req, runId);
        const life = str(got && got.data && got.data.state && got.data.state.life_cycle_state);
        const result = str(got && got.data && got.data.state && got.data.state.result_state);
        if (['TERMINATED', 'INTERNAL_ERROR', 'SKIPPED'].includes(life)) state = life === 'TERMINATED' && result === 'SUCCESS' ? 'done' : 'failed';
      }
      return res.json({ state, ...(runId ? { run_id: runId } : {}), inputs, reports, decisions });
    } catch (err) {
      return fail(res, err.statusCode && Number.isFinite(err.statusCode) ? err.statusCode : 500, str(err.message) || 'Inspire could not read the match.');
    }
  });

  app.post('/api/inspire/match/decision', requireToken, async (req, res) => {
    try {
      const body = req.body || {};
      const at = where(body);
      if (at.error) return fail(res, 400, at.error);
      const session = sessionOf(body);
      if (session.error) return fail(res, 400, session.error);
      const inputNo = positiveInt(body.input_no);
      const pieceNo = positiveInt(body.piece_no);
      const decision = str(body.decision);
      if (!inputNo) return fail(res, 400, 'input_no must be a whole number from 1.');
      if (!pieceNo) return fail(res, 400, 'piece_no must be a whole number from 1.');
      if (!DECISIONS.includes(decision)) return fail(res, 400, `decision must be one of: ${DECISIONS.join(', ')}.`);
      const table = tableOf(at.db, '__inspire_match_decision');
      await run(req, at.warehouse, DECISION_DDL(table));
      await run(req, at.warehouse, `INSERT INTO ${table} (session_id, input_no, piece_no, decision, event_at) VALUES (:session_id, :input_no, :piece_no, :decision, current_timestamp())`, [
        { name: 'session_id', value: session.id, type: 'BIGINT' }, { name: 'input_no', value: String(inputNo), type: 'INT' },
        { name: 'piece_no', value: String(pieceNo), type: 'INT' }, { name: 'decision', value: decision, type: 'STRING' }]);
      return res.json({ ok: true });
    } catch (err) {
      return fail(res, err.statusCode && Number.isFinite(err.statusCode) ? err.statusCode : 500, str(err.message) || 'Inspire could not save the choice.');
    }
  });

  app.post('/api/inspire/match/accept', requireToken, async (req, res) => {
    try {
      const body = req.body || {};
      const at = where(body);
      if (at.error) return fail(res, 400, at.error);
      const session = sessionOf(body);
      if (session.error) return fail(res, 400, session.error);
      const params = launchParams(body.params, at.db, session.id, 'accept', '');
      const out = await launchRun(req, { params, notebook_path: body.notebook_path, cluster_id: body.cluster_id });
      return launched(res, out, session.id);
    } catch (err) {
      return fail(res, err.statusCode && Number.isFinite(err.statusCode) ? err.statusCode : 500, str(err.message) || 'Inspire could not accept the match.');
    }
  });
}

module.exports = { registerMatchRoutes };
