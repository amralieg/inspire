const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const ME = 'launcher@example.com';
const BOSS = 'manager@example.com';
const cancels = () => S.state.calls.filter((c) => c.path === '/api/2.1/jobs/runs/cancel');
const check = (person, extra = {}) => S.request('GET', '/api/run/777/cancel', { person, ...extra });

test('the person who launched a run may cancel it, and asking changes nothing', async () => {
  S.reset({ managers: [BOSS], launchers: { 777: ME } });
  const got = await check(ME);
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.deepEqual(got.data, { allowed: true });
  assert.deepEqual(cancels(), []);
});

test('anyone else is told why, in exactly the words the cancel route refuses with', async () => {
  S.reset({ managers: [BOSS], launchers: { 777: ME } });
  const asked = await check('other@example.com');
  assert.equal(asked.status, 200);
  assert.equal(asked.data.allowed, false);
  assert.deepEqual(asked.data.policy, { route: 'POST /api/run/:runId/cancel', rule: 'launcher', needs: 'the person who launched it, or an App manager' });
  const refused = await S.request('POST', '/api/run/777/cancel', { person: 'other@example.com', body: {} });
  assert.equal(refused.status, 403);
  assert.equal(asked.data.error, refused.data.error);
  assert.match(asked.data.error, /^Only the person who launched run 777, or an App manager, can cancel it\. launcher@example\.com launched it/);
  assert.deepEqual(cancels(), []);
});

test('an App manager may cancel a run someone else launched', async () => {
  S.reset({ managers: [BOSS], launchers: { 777: ME } });
  assert.deepEqual((await check(BOSS)).data, { allowed: true });
});

test('a run with no launch record, or a request with no signed-in person, may not be cancelled by a non-manager', async () => {
  S.reset({ managers: [BOSS], launchers: {} });
  const unknown = await check('other@example.com');
  assert.equal(unknown.data.allowed, false);
  assert.match(unknown.data.error, /Inspire has no record of who launched it/);
  const nobody = await check('', { signedIn: false });
  assert.equal(nobody.data.allowed, false);
  assert.match(nobody.data.error, /could not tell who you are/);
});

test('the launcher cancel goes through once the check said yes', async () => {
  S.reset({ managers: [BOSS], launchers: { 777: ME } });
  assert.equal((await check(ME)).data.allowed, true);
  const got = await S.request('POST', '/api/run/777/cancel', { person: ME, body: {} });
  assert.notEqual(got.status, 403, got.text.slice(0, 300));
  assert.equal(cancels().length, 1);
});
