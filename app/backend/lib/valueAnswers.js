// REQ-435: the saved Calculate value answers. Append-only: every save and every undo is one new version row of one use case, and every
// value is a bound parameter, never part of the SQL text.
const { binder } = require('./scoreRefine');

const COLUMNS = 'session_id STRING, use_case_id STRING, version INT, answers STRING, yearly STRING, saved_at TIMESTAMP, saved_by STRING, note STRING';
const FIELDS = 'session_id, use_case_id, version, answers, yearly, saved_at, saved_by, note';
const READ = 'use_case_id, CAST(version AS INT) AS version, answers, yearly, CAST(saved_at AS STRING) AS saved_at, saved_by, note';

const createSql = (table) => `CREATE TABLE IF NOT EXISTS ${table} (${COLUMNS})`;

// sessionId is one run id, or a list of run ids: the list form reads every run in one statement, rows led by their session_id,
// and still keeps the latest version per (run, use case).
function latestSql(table, sessionId) {
  const b = binder();
  if (Array.isArray(sessionId)) {
    const marks = sessionId.map((sid) => b.bind(sid)).join(', ');
    return { sql: `SELECT CAST(session_id AS STRING) AS session_id, ${READ} FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY session_id, use_case_id ORDER BY version DESC) AS rn FROM ${table} WHERE session_id IN (${marks})) WHERE rn = 1`,
      parameters: b.parameters };
  }
  return { sql: `SELECT ${READ} FROM (SELECT *, ROW_NUMBER() OVER (PARTITION BY use_case_id ORDER BY version DESC) AS rn FROM ${table} WHERE session_id = ${b.bind(sessionId)}) WHERE rn = 1`,
    parameters: b.parameters };
}

function historySql(table, sessionId, useCaseId, limit = 200) {
  const b = binder();
  return { sql: `SELECT ${READ} FROM ${table} WHERE session_id = ${b.bind(sessionId)} AND use_case_id = ${b.bind(useCaseId)} ORDER BY version DESC LIMIT ${Number(limit)}`,
    parameters: b.parameters };
}

function latestVersionSql(table, sessionId, useCaseId) {
  const b = binder();
  return { sql: `SELECT MAX(version) AS latest FROM ${table} WHERE session_id = ${b.bind(sessionId)} AND use_case_id = ${b.bind(useCaseId)}`, parameters: b.parameters };
}

function insertSql(table, { sessionId, useCaseId, version, answers, yearly, savedBy, note }) {
  const b = binder();
  return { sql: `INSERT INTO ${table} (${FIELDS}) VALUES (${b.bind(sessionId)}, ${b.bind(useCaseId)}, ${b.bind(version, 'INT')}, ${b.bind(JSON.stringify(answers))}, `
    + `${b.bind(JSON.stringify(yearly))}, current_timestamp(), ${b.bind(savedBy)}, ${b.bind(note)})`, parameters: b.parameters };
}

const json = (text) => {
  try {
    return JSON.parse(String(text));
  } catch {
    return null;
  }
};

const versionOf = (row) => ({ version: Number(row.version), answers: json(row.answers), yearly: json(row.yearly), saved_at: row.saved_at ?? null, saved_by: row.saved_by ?? '' });

module.exports = { createSql, latestSql, historySql, latestVersionSql, insertSql, versionOf };
