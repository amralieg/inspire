const USE_CASE_NAME_MAX = 200;
const CONTROL_CHARS_RE = /[\u0000-\u001f\u007f]/;

function normalizeUseCaseName(raw) {
  if (raw == null) return { name: null };
  if (typeof raw !== 'string') return { error: 'The use case name must be text.' };
  const name = raw.replace(/\s+/g, ' ').trim();
  if (!name) return { name: null };
  if (name.length > USE_CASE_NAME_MAX) return { error: `The use case name can be at most ${USE_CASE_NAME_MAX} characters.` };
  if (CONTROL_CHARS_RE.test(name)) return { error: 'The use case name cannot contain control characters.' };
  return { name };
}

function renameStatement(table, sessionId, useCaseId, name) {
  if (name == null) {
    return { sql: `UPDATE ${table} SET user_use_case_name = NULL WHERE session_id = ${sessionId} AND id = :id`,
      parameters: [{ name: 'id', value: useCaseId, type: 'STRING' }] };
  }
  return {
    sql: `UPDATE ${table} SET user_use_case_name = :name WHERE session_id = ${sessionId} AND id = :id`,
    parameters: [
      { name: 'name', value: name, type: 'STRING' },
      { name: 'id', value: useCaseId, type: 'STRING' },
    ],
  };
}

module.exports = { USE_CASE_NAME_MAX, normalizeUseCaseName, renameStatement };
