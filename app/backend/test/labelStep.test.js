// rc13 label step (REQ-119): the steps route returns every row of the session, the FIRED line included.
const test = require('node:test');
const assert = require('node:assert/strict');
const { stepsStatement } = require('../lib/sqlInputs');

const TABLE = '`main`.`insp`.`__inspire_step`';

test('the steps statement for a session returns every step row, with the message and stage the App shows', () => {
  const { sql, parameters } = stepsStatement(TABLE, 1111222233334444n, null);
  assert.equal(parameters, null);
  for (const column of ['stage_name', 'step_name', 'message', 'status']) assert.match(sql, new RegExp(`\\b${column}\\b`));
  assert.doesNotMatch(sql, /stage_name\s*=|step_name\s*=|status\s*=|message\s*(LIKE|=)/i, 'no stage, step, status or message filter drops a row');
  assert.match(sql, /WHERE session_id = 1111222233334444 ORDER BY last_updated, step_id/);
});

test('a poll since the last update still returns the rows written after it, with no content filter', () => {
  const { sql, parameters } = stepsStatement(TABLE, 42, '2026-11-12T16:51:00.000Z');
  assert.doesNotMatch(sql, /stage_name\s*=|status\s*=/i);
  assert.equal(parameters[0].name, 'since');
  assert.match(sql, /last_updated > CAST\(:since AS TIMESTAMP\)/);
});
