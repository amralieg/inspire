const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const { SAMPLES, WH, ME, BOSS, qs, UC, someoneElsesBuild } = require('./support/routeSamples');

const refusedByPolicy = (got) => got.status === 403 && Boolean(got.data && got.data.policy);
const nonPolicyCalls = () => S.state.calls.filter((c) => c.category === 'action');
const label = (s) => `${s.key}${s.name ? ` (${s.name})` : ''}`;

function historyFor(sample) {
  if (sample.name === 'first build') return [];
  return someoneElsesBuild;
}

for (const sample of SAMPLES.filter((s) => !['any', 'delegated'].includes(s.rule))) {
  test(`${label(sample)}: a non-manager non-owner gets a plain 403 and the route makes no Databricks call`, async () => {
    S.reset({ managers: [BOSS], history: historyFor(sample), launchers: { 77: 'someone@example.com' }, sessionLaunchers: { 1001: 'someone@example.com' } });
    const got = await S.request(sample.method, sample.path, { person: ME, body: sample.body });
    assert.equal(got.status, 403, `${label(sample)} answered ${got.status}: ${got.text.slice(0, 300)}`);
    assert.ok(got.data && got.data.policy, 'the refusal names the policy rule');
    assert.equal(got.data.policy.rule, sample.rule);
    assert.match(got.data.error, /^[A-Z][^\n]*\.$/, 'one plain sentence');
    assert.doesNotMatch(got.text, /\n\s+at |node_modules|Error:/);
    assert.deepEqual(nonPolicyCalls(), [], 'only read-only policy lookups reach Databricks');
    assert.ok(S.state.calls.every((c) => c.category !== 'action'));
  });

  test(`${label(sample)}: an App manager passes the check`, async () => {
    S.reset({ managers: [BOSS], history: historyFor(sample) });
    const got = await S.request(sample.method, sample.path, { person: BOSS, body: sample.body });
    assert.equal(refusedByPolicy(got), false, `${label(sample)} refused a manager: ${got.text.slice(0, 300)}`);
  });
}

for (const sample of SAMPLES.filter((s) => s.rule === 'owners')) {
  test(`${label(sample)}: an owner of the use case passes the check`, async () => {
    S.reset({ managers: [BOSS], history: [{ ...someoneElsesBuild[0], created_by: 'Owner@Example.com' }] });
    const got = await S.request(sample.method, sample.path, { person: 'owner@example.com', body: sample.body });
    assert.equal(refusedByPolicy(got), false, `${label(sample)} refused the owner: ${got.text.slice(0, 300)}`);
  });
}

for (const sample of SAMPLES.filter((s) => s.rule === 'launcher')) {
  test(`${label(sample)}: the person who launched it passes the check`, async () => {
    S.reset({ managers: [BOSS], launchers: { 77: ME }, sessionLaunchers: { 1001: ME } });
    const got = await S.request(sample.method, sample.path, { person: ME, body: sample.body });
    assert.equal(refusedByPolicy(got), false, `${label(sample)} refused its launcher: ${got.text.slice(0, 300)}`);
  });
}

for (const sample of SAMPLES.filter((s) => ['any', 'delegated'].includes(s.rule))) {
  test(`${label(sample)}: any person who can use the App passes the check`, async () => {
    S.reset({ managers: [BOSS], history: historyFor(sample) });
    const got = await S.request(sample.method, sample.path, { person: ME, body: sample.body });
    assert.equal(refusedByPolicy(got), false, `${label(sample)} refused a CAN_USE person: ${got.text.slice(0, 300)}`);
  });
}

test('a manager through a group passes; the group must be one the person is in', async () => {
  const sample = SAMPLES[0];
  S.reset({ managerGroups: ['inspire-admins'], personGroups: ['inspire-admins'] });
  assert.equal(refusedByPolicy(await S.request(sample.method, sample.path, { person: ME, body: sample.body })), false);
  S.reset({ managerGroups: ['inspire-admins'], personGroups: ['analysts'] });
  assert.equal(refusedByPolicy(await S.request(sample.method, sample.path, { person: ME, body: sample.body })), true);
});

test('owning another use case does not make you an owner of this one', async () => {
  S.reset({ history: [{ ...someoneElsesBuild[0], use_case_id: 'N01-U02', created_by: ME }, ...someoneElsesBuild] });
  const got = await S.request('POST', `/api/inspire/implement/rerun?${qs(UC)}`, { person: ME, body: {} });
  assert.equal(refusedByPolicy(got), true, got.text.slice(0, 300));
});

test('use case owners are read only from the App database, so a database the caller names cannot make them an owner', async () => {
  S.reset({ history: [{ ...someoneElsesBuild[0], created_by: ME }] });
  const got = await S.request('POST', `/api/inspire/implement/rerun?${qs({ ...UC, inspire_database: 'their_catalog.their_schema' })}`, { person: ME, body: {} });
  assert.equal(refusedByPolicy(got), true, got.text.slice(0, 300));
  assert.equal(S.state.calls.filter((c) => c.statement.includes('their_catalog')).length, 0);
});

test('someone else launched the run, so cancelling it is refused; a run with no launcher recorded refuses non-managers', async () => {
  S.reset({ launchers: { 77: 'someone@example.com' } });
  assert.equal(refusedByPolicy(await S.request('POST', '/api/run/77/cancel', { person: ME, body: {} })), true);
  S.reset({ launchers: {} });
  const old = await S.request('POST', '/api/run/78/cancel', { person: ME, body: {} });
  assert.equal(refusedByPolicy(old), true);
  assert.match(old.data.error, /no record of who launched/);
});

test('the check runs before input validation: garbage input from a non-manager is refused, not validated', async () => {
  S.reset({ managers: [BOSS] });
  const garbage = await S.request('DELETE', '/api/inspire/session?session_id=abc', { person: ME });
  assert.equal(refusedByPolicy(garbage), true, garbage.text.slice(0, 300));
  const asManager = await S.request('DELETE', '/api/inspire/session?session_id=abc', { person: BOSS });
  assert.equal(asManager.status, 400, asManager.text.slice(0, 300));
});

test('a person the proxy did not name is refused with a plain sentence', async () => {
  S.reset({ managers: [BOSS] });
  const got = await S.request('POST', '/api/setup/create-database', { signedIn: false, body: {} });
  assert.equal(refusedByPolicy(got), true, got.text.slice(0, 300));
  assert.match(got.data.error, /could not tell who you are/);
});

test('when the App permissions cannot be read, managers-only actions are refused with a 403, never a 500', async () => {
  S.reset({ managers: [BOSS], aclStatus: 500 });
  const got = await S.request('POST', '/api/setup/create-database', { person: BOSS, body: {} });
  assert.equal(got.status, 403, got.text.slice(0, 300));
  assert.match(got.data.error, /could not read who manages/);
});

test('email case does not matter for owners, launchers and managers', async () => {
  S.reset({ managers: ['MANAGER@example.com'] });
  assert.equal(refusedByPolicy(await S.request('POST', '/api/setup/create-database', { person: 'manager@EXAMPLE.com', body: {} })), false);
  S.reset({ launchers: { 77: 'NonOwner@Example.com' } });
  assert.equal(refusedByPolicy(await S.request('POST', '/api/run/77/cancel', { person: ME, body: {} })), false);
});

