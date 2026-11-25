// SEC-02 AT4 (F6, F4 run pages; REQ-518): a run's notebook output and the hosted MVP pages belong to the session the run made. They go
// through the same session check: a person who may not see the session gets 403 for the output and does not get its pages listed.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./support/sec02World');

const { S } = W;
test.after(() => S.stopServer());

const OUTPUT = (run) => `/api/run/${run}/output`;
const PAGES = `/api/run/pages?${W.DB}`;

test('AT4: the output of a run of a hidden session is refused with 403 and carries no output', async () => {
  await W.seed();
  const got = await S.request('GET', OUTPUT(777), { person: W.READER });
  assert.equal(got.status, 403, `AT4: Not implemented: /api/run/777/output answers ${got.status} to ${W.READER}, who may not see session ${W.SECRET}: ${got.text.slice(0, 240)}`);
  assert.ok(!/SecretCo margin/.test(got.text), `AT4: no notebook output in the refusal: ${got.text.slice(0, 240)}`);
  assert.equal(got.data && got.data.request, 'person', `AT4: the refusal is the person's Request for Access: ${got.text.slice(0, 240)}`);
});

test('AT4: the output is read only after the check; a refused person causes no runs/get-output call', async () => {
  await W.seed();
  await S.request('GET', OUTPUT(777), { person: W.READER });
  const reads = S.state.calls.filter((c) => c.path === '/api/2.1/jobs/runs/get-output');
  assert.equal(reads.length, 0, `AT4: Not implemented: the output was fetched before (or without) the session check: ${W.describe(reads)}`);
});

test('AT4: the hosted pages of a hidden session are not listed', async () => {
  await W.seed();
  const got = await S.request('GET', PAGES, { person: W.READER });
  assert.equal(got.status, 200, got.text.slice(0, 240));
  const sessions = ((got.data && got.data.pages) || []).map((p) => String(p.session_id || ''));
  assert.ok(sessions.includes(W.OPEN), `AT4: the readable session's page stays listed: ${got.text.slice(0, 300)}`);
  assert.ok(!sessions.includes(W.SECRET), `AT4: Not implemented: the page of session ${W.SECRET} is listed to ${W.READER}: ${JSON.stringify(sessions)}`);
  assert.ok(!/SecretCo page/.test(got.text), 'AT4: its name appears nowhere');
});

test('AT4 control: the launcher reads the output of their own run and sees both pages', async () => {
  await W.seed();
  const out = await S.request('GET', OUTPUT(777), { person: W.LAUNCHER });
  assert.equal(out.status, 200, out.text.slice(0, 240));
  assert.match(out.text, /SecretCo margin/);
  const pages = await S.request('GET', PAGES, { person: W.LAUNCHER });
  const sessions = ((pages.data && pages.data.pages) || []).map((p) => String(p.session_id || ''));
  assert.deepEqual(sessions.sort(), [W.SECRET, W.OPEN].sort(), pages.text.slice(0, 300));
});
