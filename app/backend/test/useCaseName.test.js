const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeUseCaseName, renameStatement, USE_CASE_NAME_MAX } = require('../lib/useCaseName');

const TABLE = '`main`.`inspire`.`__inspire_usecases`';

test('a typed name is trimmed and its inner spaces collapse to one', () => {
  assert.deepEqual(normalizeUseCaseName('  Churn   early\twarning  '), { name: 'Churn early warning' });
});

test('a blank name clears the user name so the catalogue name stands again', () => {
  assert.deepEqual(normalizeUseCaseName('   '), { name: null });
  assert.deepEqual(normalizeUseCaseName(null), { name: null });
  assert.deepEqual(normalizeUseCaseName(undefined), { name: null });
});

test('a name longer than the limit is refused, the limit itself is accepted', () => {
  assert.equal(normalizeUseCaseName('x'.repeat(USE_CASE_NAME_MAX)).name, 'x'.repeat(USE_CASE_NAME_MAX));
  assert.match(normalizeUseCaseName('x'.repeat(USE_CASE_NAME_MAX + 1)).error, /at most 200 characters/);
});

test('control characters are refused and a newline is not kept as one', () => {
  assert.match(normalizeUseCaseName('churn\u0007risk').error, /control characters/);
  assert.deepEqual(normalizeUseCaseName('churn\nrisk'), { name: 'churn risk' });
});

test('a name that is not text is refused', () => {
  assert.match(normalizeUseCaseName(42).error, /must be text/);
  assert.match(normalizeUseCaseName({ name: 'x' }).error, /must be text/);
});

const OLD = "COALESCE(NULLIF(TRIM(user_use_case_name), ''), use_case)";

function markers(stmt) {
  return Object.fromEntries(stmt.parameters.map((p) => [p.name, p.value]));
}

test('the rename writes the user name and binds every value as a parameter, one marker per use', () => {
  const stmt = renameStatement(TABLE, 4242, 'N01-U01', 'Churn early warning');
  assert.ok(stmt.sql.startsWith(`UPDATE ${TABLE} SET user_use_case_name = :p0, genie_instruction = CASE WHEN`), stmt.sql);
  assert.match(stmt.sql, /WHERE session_id = 4242 AND id = :p\d+$/);
  const names = stmt.parameters.map((p) => p.name);
  assert.equal(new Set(names).size, names.length, 'no marker is reused');
  assert.ok(stmt.parameters.every((p) => p.type === 'STRING'));
  assert.ok(!stmt.sql.includes('Churn early warning'), 'the name is never spliced into the SQL');
  assert.doesNotMatch(stmt.sql, /\buse_case\s*=/);
});

test('a rename rewrites the stored instruction: every old name becomes the new name, in the same UPDATE (REQ-155)', () => {
  const stmt = renameStatement(TABLE, 4242, 'N01-U01', 'Churn early warning');
  assert.match(stmt.sql, /genie_instruction = CASE WHEN .* ELSE replace\(replace\(replace\(genie_instruction, /);
  // the final replace turns every remaining occurrence of the old shown name into the new one
  assert.match(stmt.sql, new RegExp(`\\), ${OLD.replace(/[()*+?.[\]|\\$]/g, '\\$&')}, :p\\d+\\) END`));
});

test('the doubled forms the old joined-name bug wrote are collapsed to the new name before the single rewrite (old+old, then new+old)', () => {
  const stmt = renameStatement(TABLE, 4242, 'N01-U01', 'Churn early warning');
  const oldOld = `concat(${OLD}, ${OLD})`;
  const newOld = /concat\(:p\d+, COALESCE\(NULLIF\(TRIM\(user_use_case_name\), ''\), use_case\)\)/;
  const single = new RegExp(`, ${OLD.replace(/[()*+?.[\]|\\$]/g, '\\$&')}, :p\\d+\\) END`);
  const at = stmt.sql.indexOf(oldOld);
  const nAt = stmt.sql.search(newOld);
  const sAt = stmt.sql.search(single);
  assert.ok(at > 0 && nAt > at && sAt > nAt, `order must be old+old, new+old, then the single rewrite (got ${at}, ${nAt}, ${sAt})`);
  assert.match(stmt.sql, /replace\(genie_instruction, concat\(COALESCE/);
});

test('a name with quotes and percent signs is bound as parameters, so it cannot break or widen the SQL (must-exclude: no string-built name)', () => {
  const hostile = "O'Brien 100% ' ; DROP TABLE t -- _ \" done";
  const stmt = renameStatement(TABLE, 4242, 'N01-U01', hostile);
  assert.ok(!stmt.sql.includes("O'Brien") && !stmt.sql.includes('DROP'), 'no piece of the name is in the SQL text');
  assert.ok(stmt.parameters.some((p) => p.value === hostile), 'the name travels as a parameter');
  const markers = stmt.sql.match(/:p\d+/g) || [];
  assert.equal(markers.length, stmt.parameters.length, 'every bound value has exactly one marker in the SQL');
});

test('a cleared name sets the user name to NULL, restores the catalogue name in the instruction, and never reads a generated label', () => {
  const stmt = renameStatement(TABLE, 4242, 'N01-U01', null);
  assert.ok(stmt.sql.startsWith(`UPDATE ${TABLE} SET user_use_case_name = NULL, genie_instruction = CASE WHEN`), stmt.sql);
  assert.match(stmt.sql, /ELSE replace\(replace\(replace\(genie_instruction, .*, use_case\), .*\), use_case\) END/);
  assert.doesNotMatch(stmt.sql, /name_with_technique/);
  assert.deepEqual(stmt.parameters, [{ name: 'p0', value: 'N01-U01', type: 'STRING' }]);
});

test('an empty stored name or a NULL instruction is left alone by the rewrite (guard)', () => {
  const stmt = renameStatement(TABLE, 4242, 'N01-U01', 'B');
  assert.match(stmt.sql, /WHEN TRIM\(COALESCE\(genie_instruction, ''\)\) = '' OR .* = '' OR :p\d+ IS NULL OR :p\d+ = '' THEN genie_instruction/);
  assert.equal(markers(stmt).p0, 'B');
});

test('a rename still flags a Genie Code instruction for regeneration, so a later Write Genie Code run refreshes it (REQ-155)', () => {
  const stmt = renameStatement(TABLE, 4242, 'N01-U01', 'Churn early warning');
  assert.match(stmt.sql, /generate_genie_code_instruction = CASE WHEN COALESCE\(user_use_case_name, ''\) <> :p\d+ AND TRIM\(COALESCE\(genie_instruction, ''\)\) <> '' THEN 'Yes' ELSE generate_genie_code_instruction END/);
});

test('clearing a name flags a stale instruction only when a user name was shown before', () => {
  const stmt = renameStatement(TABLE, 4242, 'N01-U01', null);
  assert.match(stmt.sql, /WHEN COALESCE\(user_use_case_name, ''\) <> '' AND TRIM/);
});
