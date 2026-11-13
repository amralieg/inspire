const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');

const BASE = {
  use_case_id: 'N01-U01', use_case_name: 'Predict churn',
  config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' },
  outputs: { dashboard: true, genie_space: true, app: true, app_name: 'churn-desk', app_access: 'sp' },
};
const validate = (outputs) => I.validateImplementSpec(I.withInspireUrl({ ...JSON.parse(JSON.stringify(BASE)), outputs: { ...BASE.outputs, ...outputs } }, 'https://inspire.example.com'));

test('an App without a Genie Agent validates, and the Genie Agent stays off', () => {
  const { spec, errors } = validate({ genie_space: false, app: true });
  assert.deepEqual(errors, [], errors.join(' | '));
  assert.equal(spec.outputs.app, true);
  assert.equal(spec.outputs.genie_space, false, 'the App no longer forces a Genie Agent on');
  assert.deepEqual(spec.outputs.genie_questions, []);
  assert.equal(spec.outputs.genie_space_name, '');
});

test('a Genie Agent alone still validates with no App, and an App with a Genie Agent keeps both', () => {
  assert.equal(validate({ app: false, genie_space: true }).spec.outputs.genie_space, true);
  const both = validate({ app: true, genie_space: true });
  assert.deepEqual(both.errors, []);
  assert.equal(both.spec.outputs.genie_space, true);
});
