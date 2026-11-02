const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const BOSS = 'manager@example.com';
const ACL = `/api/2.0/permissions/apps/${S.APP_NAME}`;
const aclCalls = () => S.state.calls.filter((c) => c.path === ACL);
const createDb = (person, extra = {}) => S.request('POST', '/api/setup/create-database', { person, body: {}, ...extra });

test('/api/health says manager_check ok for a manager, whose own token reads who manages the App', async () => {
  S.reset({ managers: [BOSS] });
  const got = await S.request('GET', '/api/health', { person: BOSS });
  assert.equal(got.data.manager_check, 'ok');
  assert.equal(got.data.manager, true);
  assert.deepEqual(aclCalls().map((c) => c.token), [S.PERSON_TOKEN]);
});

test('/api/health says manager_check ok for a person who is not a manager, because the refusal itself answers the question', async () => {
  S.reset({ managers: [BOSS] });
  const got = await S.request('GET', '/api/health');
  assert.equal(got.data.manager_check, 'ok');
  assert.equal(got.data.manager, false);
});

test('/api/health gives a plain reason, with no token or id, when the user token lacks the apps scope (must-fail)', async () => {
  S.reset({ managers: [BOSS], personAppsScope: false });
  const got = await S.request('GET', '/api/health', { person: BOSS });
  assert.notEqual(got.data.manager_check, 'ok');
  assert.equal(got.data.manager, null);
  assert.match(got.data.manager_check, /cannot tell who manages this App.*lacks the apps scope.*re-run the Inspire installer/);
  for (const secret of [S.APP_SP, 'app-sp-token', S.PERSON_TOKEN, S.APP_NAME]) assert.doesNotMatch(got.data.manager_check, new RegExp(secret));
});

test('/api/health gives a plain reason when the proxy sends no user token (must-fail)', async () => {
  S.reset({ managers: [BOSS] });
  const got = await S.request('GET', '/api/health', { person: BOSS, userToken: false });
  assert.match(got.data.manager_check, /sent no user token.*re-run the Inspire installer/);
  assert.equal(got.data.manager, null);
  assert.deepEqual(aclCalls(), []);
});

test('the manager check reads the App permissions with the person token only, never the App token', async () => {
  S.reset({ managers: [BOSS] });
  const got = await createDb(BOSS);
  assert.equal(got.status, 400, got.text.slice(0, 300));
  assert.deepEqual(aclCalls().map((c) => c.token), [S.PERSON_TOKEN]);
});

test('a person whose token is refused the App permissions is told only managers may act, not that Inspire could not read them', async () => {
  S.reset({ managers: [BOSS] });
  const got = await createDb('someone@example.com');
  assert.equal(got.status, 403);
  assert.match(got.data.error, /^Only an App manager can create the Inspire database/);
  assert.doesNotMatch(got.data.error, /could not read/);
});

test('without the apps scope even a manager is refused, with the reason and the fix (must-fail)', async () => {
  S.reset({ managers: [BOSS], personAppsScope: false });
  const got = await createDb(BOSS);
  assert.equal(got.status, 403);
  assert.match(got.data.error, /could not read who manages .*lacks the apps scope; re-run the Inspire installer/);
});

test('without a user token even a manager is refused, with the reason and the fix (must-fail)', async () => {
  S.reset({ managers: [BOSS] });
  const got = await createDb(BOSS, { userToken: false });
  assert.equal(got.status, 403);
  assert.match(got.data.error, /could not read who manages .*sent no user token/);
  assert.deepEqual(aclCalls(), []);
});

test('an outage reading the App permissions refuses managers with the HTTP reason, never a 500', async () => {
  S.reset({ managers: [BOSS], aclStatus: 503 });
  const got = await createDb(BOSS);
  assert.equal(got.status, 403);
  assert.match(got.data.error, /could not read who manages .*\(denied\)/);
});
