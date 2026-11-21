// REQ-433: the stored side of a refined Inspire score. The refined score sits on the use case row (refined_score, with the first score in
// refined_from) and every apply and undo is one row in __inspire_score_history, so the old score and the reason are never lost.
const CHANGES_MAX = 50;
const REASON_MAX = 500;
const ID_SHAPE = /^[a-zA-Z0-9_.\-]+$/;
const COLUMNS = [['refined_score', 'DOUBLE'], ['refined_from', 'DOUBLE']];
const HISTORY_COLUMNS = 'session_id BIGINT, use_case_id STRING, action STRING, score_from DOUBLE, score_to DOUBLE, reason STRING, changed_at TIMESTAMP';

const scoreOk = (n) => typeof n === 'number' && Number.isFinite(n) && n >= 0 && n <= 10;

function parseChanges(raw, badRequest) {
  if (!Array.isArray(raw) || !raw.length) throw badRequest('Send the use cases to refine: changes needs at least one entry.');
  if (raw.length > CHANGES_MAX) throw badRequest(`Refine at most ${CHANGES_MAX} use cases at once.`);
  return raw.map((c) => {
    const id = String(c?.use_case_id ?? '').trim();
    if (!ID_SHAPE.test(id)) throw badRequest('Each change needs a use_case_id made of letters, digits, dot, dash or underscore.');
    const score = typeof c.score === 'number' ? c.score : NaN;
    const from = typeof c.from === 'number' ? c.from : NaN;
    if (!scoreOk(score) || !scoreOk(from)) throw badRequest('Each change needs a score and a from score between 0 and 10.');
    const reason = String(c.reason ?? '').replace(/\s+/g, ' ').trim().slice(0, REASON_MAX);
    return { use_case_id: id, score: Math.round(score * 100) / 100, from, reason };
  });
}

function parseIds(raw, badRequest) {
  if (!Array.isArray(raw) || !raw.length || raw.length > CHANGES_MAX) throw badRequest('Send use_case_ids: a list of 1 to 50 use case ids.');
  const ids = raw.map((v) => String(v ?? '').trim());
  if (!ids.every((id) => ID_SHAPE.test(id))) throw badRequest('Each use case id is made of letters, digits, dot, dash or underscore.');
  return [...new Set(ids)];
}

const binder = () => {
  const parameters = [];
  const bind = (value, type = 'STRING') => {
    const name = `p${parameters.length}`;
    parameters.push({ name, value: String(value), type });
    return `:${name}`;
  };
  return { parameters, bind };
};

const historyCreateSql = (table) => `CREATE TABLE IF NOT EXISTS ${table} (${HISTORY_COLUMNS})`;

function applyStatements(usecases, history, sessionId, change) {
  const u = binder();
  const update = { sql: `UPDATE ${usecases} SET refined_score = ${u.bind(change.score, 'DOUBLE')}, refined_from = COALESCE(refined_from, ${u.bind(change.from, 'DOUBLE')}) `
    + `WHERE session_id = ${sessionId} AND id = ${u.bind(change.use_case_id)}`, parameters: u.parameters };
  const h = binder();
  const record = { sql: `INSERT INTO ${history} (session_id, use_case_id, action, score_from, score_to, reason, changed_at) VALUES (${sessionId}, ${h.bind(change.use_case_id)}, `
    + `${h.bind('apply')}, ${h.bind(change.from, 'DOUBLE')}, ${h.bind(change.score, 'DOUBLE')}, ${h.bind(change.reason)}, current_timestamp())`, parameters: h.parameters };
  return { update, record };
}

function undoStatements(usecases, history, sessionId, ids) {
  const h = binder();
  const marks = ids.map((id) => h.bind(id)).join(', ');
  const record = { sql: `INSERT INTO ${history} (session_id, use_case_id, action, score_from, score_to, reason, changed_at) `
    + `SELECT session_id, id, ${h.bind('undo')}, refined_score, refined_from, ${h.bind('Refinement undone.')}, current_timestamp() FROM ${usecases} `
    + `WHERE session_id = ${sessionId} AND id IN (${marks}) AND refined_score IS NOT NULL`, parameters: h.parameters };
  const u = binder();
  const update = { sql: `UPDATE ${usecases} SET refined_score = NULL, refined_from = NULL WHERE session_id = ${sessionId} AND id IN (${ids.map((id) => u.bind(id)).join(', ')})`,
    parameters: u.parameters };
  return { update, record };
}

module.exports = { binder, CHANGES_MAX, COLUMNS, parseChanges, parseIds, historyCreateSql, applyStatements, undoStatements };
