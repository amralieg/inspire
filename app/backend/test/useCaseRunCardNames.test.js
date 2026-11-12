const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');

const built = (over = {}) => ({
  session_id: '42', use_case_id: 'N01-U01', spec_version: 1, status: 'ready', app_name: 'churn-desk',
  spec_json: { use_case_id: 'N01-U01', use_case_name: 'Predict churn', outputs: { app: true, app_name: 'churn-desk' } },
  ...over,
});
const scope = [{ session_id: '42', use_case_id: 'N01-U01', domain: 'Retention', business: 'Acme' }];

test('a run card shows the name the person gave the use case, not the name the build was made under (must-exclude built name)', () => {
  const rows = [built()];
  const [page] = I.runPages(rows, scope, null, [{ session_id: '42', use_case_id: 'N01-U01', user_use_case_name: 'Churn early warning' }]);
  assert.equal(page.name, 'Churn early warning');
  assert.equal(page.domain, 'Retention', 'the scope still supplies the domain');
});

test('a use case with no name of the person keeps the built name on its run card (must-exclude)', () => {
  const [page] = I.runPages([built()], scope, null, []);
  assert.equal(page.name, 'Predict churn');
});

test('a rename of one use case never leaks onto another use case in the same session (must-exclude)', () => {
  const rows = [built(), built({ use_case_id: 'N01-U02', app_name: 'price-desk', spec_json: { use_case_id: 'N01-U02', use_case_name: 'Price right', outputs: { app: true, app_name: 'price-desk' } } })];
  const names = [{ session_id: '42', use_case_id: 'N01-U01', user_use_case_name: 'Churn early warning' }];
  const pages = I.runPages(rows, [], null, names);
  const byUc = Object.fromEntries(pages.map((p) => [p.use_case_id, p.name]));
  assert.deepEqual(byUc, { 'N01-U01': 'Churn early warning', 'N01-U02': 'Price right' });
});

test('the user-name lookup reads only renamed rows of the listed sessions, as bound parameters', () => {
  const stmt = I.useCaseUserNamesStatement('cat', 'sch', ['42', '43']);
  assert.match(stmt.sql, /WHERE user_use_case_name IS NOT NULL AND session_id IN \(:s0, :s1\)/);
  assert.deepEqual(stmt.parameters.map((p) => [p.name, p.value, p.type]), [['s0', '42', 'BIGINT'], ['s1', '43', 'BIGINT']]);
  assert.match(stmt.sql, /FROM `cat`\.`sch`\.`__inspire_usecases`/);
});
