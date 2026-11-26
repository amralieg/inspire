// c24_blaunch B-05: a run that is already submitted is answered at once. The business-profile link and the launcher name never hold the answer,
// and the run read names the person who started it (the run itself is the App's service principal, REQ-418).
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const SETTINGS = { version: 1, params: { '00_business_name': 'Acme' }, tableScopes: {}, priorityChecks: {}, relationships: 'keep' };
const runParams = (sid) => ({ params: { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': sid, '15_operation': 'Discover Use Cases' } });

test('B-05: a profile link that never answers does not hold the launch answer; the run id and a warning come back (must-fail)', async () => {
  S.reset({ notebookPresent: true, runStates: { 901: 'PENDING' } });
  const saved = await S.request('POST', '/api/inspire/profiles', { person: 'launcher@example.com', body: { name: 'Acme retail', spec: SETTINGS } });
  assert.equal(saved.status, 200, saved.text);
  S.state.nextRunId = 901;
  S.state.holdFetch = () => /__inspire_profile/.test(S.state.calls[S.state.calls.length - 1].statement);
  const answer = await Promise.race([
    S.request('POST', '/api/run', { person: 'launcher@example.com', body: { ...runParams('9001'), profile_id: saved.data.profile.profile_id } }),
    new Promise((resolve) => setTimeout(() => resolve({ status: 'still waiting after 20 s' }), 20000)),
  ]);
  assert.equal(answer.status, 200, `the launch answer came back: ${answer.status}`);
  assert.equal(String(answer.data.run_id), '901');
  assert.match((answer.data.warnings || []).join(' '), /business profile/i);
});

test('B-05: the run read carries started_by, the person the launch record names (must-fail)', async () => {
  S.reset({ notebookPresent: true, runStates: { 902: 'RUNNING' } });
  S.state.nextRunId = 902;
  const launched = await S.request('POST', '/api/run', { person: 'launcher@example.com', body: runParams('9002') });
  assert.equal(launched.status, 200, launched.text);
  const read = await S.request('GET', '/api/run/902', { person: 'launcher@example.com' });
  assert.equal(read.status, 200, read.text);
  assert.equal(read.data.started_by, 'launcher@example.com');
});
