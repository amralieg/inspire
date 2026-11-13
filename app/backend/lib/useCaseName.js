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

// REQ-155. One UPDATE renames the use case and brings its Genie Code instruction in step with the shown name.
// OLD is the name the instruction was written from (the shown name before the rename, from the stored columns). NEW is the
// shown name after it. Repairs first collapse the doubled forms the old joined-name bug wrote (OLD+OLD and NEW+OLD), then
// every remaining OLD becomes NEW. The instruction is left alone when either name is empty. The regenerate flag is still set,
// so a later Write Genie Code run rewrites the instruction from the stored name. User text is only ever bound as a parameter.
const OLD_NAME = "COALESCE(NULLIF(TRIM(user_use_case_name), ''), use_case)";

function renameStatement(table, sessionId, useCaseId, name) {
  const parameters = [];
  const bind = (value) => {
    const marker = `p${parameters.length}`;
    parameters.push({ name: marker, value, type: 'STRING' });
    return `:${marker}`;
  };
  const clearing = name == null;
  // Each use of the new name gets its own marker, so no marker is reused in one statement.
  const nextName = () => (clearing ? 'use_case' : bind(name));
  const setUser = clearing ? 'NULL' : bind(name);
  const flagWhen = clearing ? "COALESCE(user_use_case_name, '') <> ''" : `COALESCE(user_use_case_name, '') <> ${bind(name)}`;
  const repaired = `replace(replace(replace(genie_instruction, concat(${OLD_NAME}, ${OLD_NAME}), ${nextName()}), `
    + `concat(${nextName()}, ${OLD_NAME}), ${nextName()}), ${OLD_NAME}, ${nextName()})`;
  const guard = `TRIM(COALESCE(genie_instruction, '')) = '' OR ${OLD_NAME} IS NULL OR ${OLD_NAME} = '' `
    + `OR ${nextName()} IS NULL OR ${nextName()} = ''`;
  const rewritten = `CASE WHEN ${guard} THEN genie_instruction ELSE ${repaired} END`;
  const flag = `CASE WHEN ${flagWhen} AND TRIM(COALESCE(genie_instruction, '')) <> '' THEN 'Yes' ELSE generate_genie_code_instruction END`;
  const id = bind(useCaseId);
  return {
    sql: `UPDATE ${table} SET user_use_case_name = ${setUser}, genie_instruction = ${rewritten}, `
      + `generate_genie_code_instruction = ${flag} WHERE session_id = ${sessionId} AND id = ${id}`,
    parameters,
  };
}

module.exports = { USE_CASE_NAME_MAX, normalizeUseCaseName, renameStatement };
