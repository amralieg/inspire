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

// REQ-155: a rename changes the name the Genie Code instruction was written from, so an instruction already written under
// the old name is flagged for regeneration (generate_genie_code_instruction = 'Yes', the same flag the Generate Genie run
// reads and clears). Only a use case that has an instruction and whose shown name changes gets the flag.
const GENIE_STALE_WHEN_RENAMED = "CASE WHEN COALESCE(user_use_case_name, '') <> %NEW% AND TRIM(COALESCE(genie_instruction, '')) <> '' "
  + "THEN 'Yes' ELSE generate_genie_code_instruction END";

function renameStatement(table, sessionId, useCaseId, name) {
  if (name == null) {
    return { sql: `UPDATE ${table} SET user_use_case_name = NULL, generate_genie_code_instruction = ${GENIE_STALE_WHEN_RENAMED.replace('%NEW%', "''")} `
      + `WHERE session_id = ${sessionId} AND id = :id`,
      parameters: [{ name: 'id', value: useCaseId, type: 'STRING' }] };
  }
  return {
    sql: `UPDATE ${table} SET user_use_case_name = :name, generate_genie_code_instruction = ${GENIE_STALE_WHEN_RENAMED.replace('%NEW%', ':name_new')} `
      + `WHERE session_id = ${sessionId} AND id = :id`,
    parameters: [
      { name: 'name', value: name, type: 'STRING' },
      { name: 'name_new', value: name, type: 'STRING' },
      { name: 'id', value: useCaseId, type: 'STRING' },
    ],
  };
}

module.exports = { USE_CASE_NAME_MAX, normalizeUseCaseName, renameStatement };
