// SEC-02 (c23 security audit): the Discover launch read check fails closed. A probe that cannot run, a missing sign-in token or a scope too
// wide to probe refuses the launch with a clear reason, and no job starts.
const test = require('node:test');
const assert = require('node:assert/strict');
const { launch, PERSON_EMAIL } = require('./support/c23SecLaunch');

test('SEC-02: a person probe that fails for a reason other than a denied read (the warehouse refuses) refuses the launch and starts no job', async () => {
  const got = await launch({ personProbe: 'warehouse' });
  assert.equal(got.jobs.length, 0, `a job started although the launcher's read could not be checked: ${got.text}`);
  assert.equal(got.status, 403, got.text);
  assert.match(got.data.error || got.data.message || '', /could not check/i, got.text);
});

test('SEC-02: a launch with no sign-in token of the person (only the proxy email) is refused and starts no job', async () => {
  const got = await launch({ headers: { 'x-forwarded-email': PERSON_EMAIL } });
  assert.equal(got.jobs.length, 0, `a job started with no person token to check the read with: ${got.text}`);
  assert.equal(got.status, 403, got.text);
});

test('SEC-02: a scope of more than 5000 tables is refused and starts no job', async () => {
  const tables = Array.from({ length: 5001 }, (_, i) => `main.s.t${i}`);
  const got = await launch({ tables, scope: 'main.s' });
  assert.equal(got.jobs.length, 0, `a job started on a scope too wide to probe: ${got.text}`);
  assert.equal(got.status, 403, got.text);
});

test('SEC-02 control: a person who can read the table launches', async () => {
  const got = await launch({});
  assert.equal(got.status, 200, got.text);
  assert.ok(got.jobs.length >= 1, 'the job started');
});
