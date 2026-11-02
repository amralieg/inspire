const { splitInspireDatabase } = require('./sqlInputs');

const LAUNCH_TABLE = '__inspire_launch';
const RUN_ID_RE = /^\d{1,19}$/;

function quoted(database, table) {
  const parsed = splitInspireDatabase(database);
  if (!parsed) return null;
  const q = (part) => '`' + String(part).replace(/`/g, '') + '`';
  return `${q(parsed.catalog)}.${q(parsed.schema)}.${q(table)}`;
}

function launchTableName(appDatabase) {
  return quoted(appDatabase, LAUNCH_TABLE);
}

function launchCreateSql(table) {
  return `CREATE TABLE IF NOT EXISTS ${table} (run_id BIGINT, job_id BIGINT, run_type STRING, inspire_database STRING, `
    + 'session_id STRING, opened_session BOOLEAN, launched_by STRING, launched_at TIMESTAMP, output_folder STRING, output_checked STRING)';
}

const OUTPUT_CHECKS = ['passed', 'manager'];

function launchInsertStatement(table, { runId, jobId, runType, inspireDatabase, sessionId, openedSession, launchedBy, outputFolder = '', outputChecked = '' }) {
  return {
    sql: `INSERT INTO ${table} (run_id, job_id, run_type, inspire_database, session_id, opened_session, launched_by, launched_at, output_folder, output_checked) `
      + 'VALUES (:run_id, :job_id, :run_type, :inspire_database, :session_id, :opened_session, :launched_by, current_timestamp(), :output_folder, :output_checked)',
    parameters: [
      { name: 'run_id', value: String(runId), type: 'BIGINT' },
      { name: 'job_id', value: String(jobId), type: 'BIGINT' },
      { name: 'run_type', value: String(runType || ''), type: 'STRING' },
      { name: 'inspire_database', value: String(inspireDatabase || '').trim().toLowerCase(), type: 'STRING' },
      { name: 'session_id', value: String(sessionId || ''), type: 'STRING' },
      { name: 'opened_session', value: openedSession ? 'true' : 'false', type: 'BOOLEAN' },
      { name: 'launched_by', value: String(launchedBy || '').trim().toLowerCase(), type: 'STRING' },
      { name: 'output_folder', value: String(outputFolder || ''), type: 'STRING' },
      { name: 'output_checked', value: outputFolder && OUTPUT_CHECKS.includes(outputChecked) ? outputChecked : '', type: 'STRING' },
    ],
  };
}

function runLauncherStatement(table, runId) {
  if (!RUN_ID_RE.test(String(runId || ''))) return null;
  return {
    sql: `SELECT launched_by FROM ${table} WHERE run_id = :run_id ORDER BY launched_at LIMIT 1`,
    parameters: [{ name: 'run_id', value: String(runId), type: 'BIGINT' }],
  };
}

function sessionLauncherStatement(table, inspireDatabase, sessionId) {
  if (!/^\d+$/.test(String(sessionId || '')) || !splitInspireDatabase(inspireDatabase)) return null;
  return {
    sql: `SELECT launched_by FROM ${table} WHERE inspire_database = :inspire_database AND session_id = :session_id `
      + 'AND opened_session ORDER BY launched_at LIMIT 1',
    parameters: [
      { name: 'inspire_database', value: String(inspireDatabase).trim().toLowerCase(), type: 'STRING' },
      { name: 'session_id', value: String(sessionId), type: 'STRING' },
    ],
  };
}

function sessionKnownStatements(table, inspireDatabase, sessionId) {
  const sessions = quoted(inspireDatabase, '__inspire_session');
  if (!sessions || !/^\d+$/.test(String(sessionId || ''))) return null;
  return {
    ledger: {
      sql: `SELECT 1 AS seen FROM ${table} WHERE inspire_database = :inspire_database AND session_id = :session_id LIMIT 1`,
      parameters: [
        { name: 'inspire_database', value: String(inspireDatabase).trim().toLowerCase(), type: 'STRING' },
        { name: 'session_id', value: String(sessionId), type: 'STRING' },
      ],
    },
    session: {
      sql: `SELECT 1 AS seen FROM ${sessions} WHERE session_id = :session_id LIMIT 1`,
      parameters: [{ name: 'session_id', value: String(sessionId), type: 'BIGINT' }],
    },
  };
}

function checkedOutputStatement(appDatabase) {
  const launches = launchTableName(appDatabase);
  const sessions = quoted(appDatabase, '__inspire_session');
  if (!launches || !sessions) return null;
  return {
    sql: `SELECT s.generation_path AS generation_path, l.output_folder AS output_folder FROM ${sessions} s JOIN ${launches} l `
      + `ON l.session_id = CAST(s.session_id AS STRING) WHERE l.inspire_database = :inspire_database AND l.output_checked IN (${OUTPUT_CHECKS.map((c) => `'${c}'`).join(', ')})`,
    parameters: [{ name: 'inspire_database', value: String(appDatabase).trim().toLowerCase(), type: 'STRING' }],
  };
}

function launcherOf(rows) {
  const who = rows && rows[0] ? String(rows[0].launched_by || '').trim().toLowerCase() : '';
  return who || null;
}

module.exports = {
  LAUNCH_TABLE,
  OUTPUT_CHECKS,
  launchTableName,
  launchCreateSql,
  launchInsertStatement,
  runLauncherStatement,
  sessionLauncherStatement,
  sessionKnownStatements,
  checkedOutputStatement,
  launcherOf,
};
