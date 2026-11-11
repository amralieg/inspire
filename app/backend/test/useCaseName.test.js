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

test('the rename writes only the user name column and binds both values as parameters', () => {
  const stmt = renameStatement(TABLE, 4242, 'N01-U01', "Churn ' early");
  assert.equal(stmt.sql, `UPDATE ${TABLE} SET user_use_case_name = :name WHERE session_id = 4242 AND id = :id`);
  assert.deepEqual(stmt.parameters, [
    { name: 'name', value: "Churn ' early", type: 'STRING' },
    { name: 'id', value: 'N01-U01', type: 'STRING' },
  ]);
  assert.doesNotMatch(stmt.sql, /\buse_case\s*=/);
});

test('a cleared name sets the user name column to NULL and never touches the catalogue name', () => {
  const stmt = renameStatement(TABLE, 4242, 'N01-U01', null);
  assert.equal(stmt.sql, `UPDATE ${TABLE} SET user_use_case_name = NULL WHERE session_id = 4242 AND id = :id`);
  assert.deepEqual(stmt.parameters, [{ name: 'id', value: 'N01-U01', type: 'STRING' }]);
});
