const { parseExactJson } = require('./exactJson');

function parseResultsJson(raw) {
  if (raw && typeof raw === 'object' && !Array.isArray(raw)) return raw;
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = parseExactJson(raw);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function executiveSummaryOf(results) {
  const value = results && typeof results === 'object' ? results.executive_summary : null;
  return typeof value === 'string' ? value.trim() : '';
}

function runResultsStatement(table, sessionId) {
  return {
    sql: `SELECT results_json FROM ${table} WHERE session_id = :sid LIMIT 1`,
    parameters: [{ name: 'sid', value: String(sessionId), type: 'BIGINT' }],
  };
}

module.exports = { parseResultsJson, executiveSummaryOf, runResultsStatement };
