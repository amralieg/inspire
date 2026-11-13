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

test('the rename writes the user name and binds the values as parameters', () => {
  const stmt = renameStatement(TABLE, 4242, 'N01-U01', "Churn ' early");
  assert.ok(stmt.sql.startsWith(`UPDATE ${TABLE} SET user_use_case_name = :name, generate_genie_code_instruction = CASE`), stmt.sql);
  assert.match(stmt.sql, /WHERE session_id = 4242 AND id = :id$/);
  assert.deepEqual(stmt.parameters, [
    { name: 'name', value: "Churn ' early", type: 'STRING' },
    { name: 'name_new', value: "Churn ' early", type: 'STRING' },
    { name: 'id', value: 'N01-U01', type: 'STRING' },
  ]);
  assert.doesNotMatch(stmt.sql, /\buse_case\s*=/);
});

test('a cleared name sets the user name column to NULL and never touches the catalogue name', () => {
  const stmt = renameStatement(TABLE, 4242, 'N01-U01', null);
  assert.ok(stmt.sql.startsWith(`UPDATE ${TABLE} SET user_use_case_name = NULL, generate_genie_code_instruction = CASE`), stmt.sql);
  assert.match(stmt.sql, /WHERE session_id = 4242 AND id = :id$/);
  assert.deepEqual(stmt.parameters, [{ name: 'id', value: 'N01-U01', type: 'STRING' }]);
  assert.doesNotMatch(stmt.sql, /\buse_case\s*=/);
});

test('a rename flags a Genie Code instruction written under the old name for regeneration, so the next Generate Genie run rewrites it from the clean name (REQ-155)', () => {
  const stmt = renameStatement(TABLE, 4242, 'N01-U01', 'Churn early warning');
  assert.match(stmt.sql, /THEN 'Yes' ELSE generate_genie_code_instruction END/);
  assert.match(stmt.sql, /TRIM\(COALESCE\(genie_instruction, ''\)\) <> ''/);
  assert.match(stmt.sql, /COALESCE\(user_use_case_name, ''\) <> :name_new/);
});

test('clearing a name flags a stale instruction only when a user name was shown before', () => {
  const stmt = renameStatement(TABLE, 4242, 'N01-U01', null);
  assert.match(stmt.sql, /COALESCE\(user_use_case_name, ''\) <> '' AND TRIM/);
});
