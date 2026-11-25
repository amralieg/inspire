// SEC-02 AT2 (F4; REQ-518): every route that returns the content of a session goes through the ONE session check SEC-01 built for
// /api/inspire/session (sessionHiddenFrom): only the launcher, or a person whose own token reads every table of the session's scope, gets
// it. Anyone else gets 403 with request 'person' and no session content. Cross-session reads (all_sessions, the latest-session fallback,
// totals, portfolio, feedback by business) leave out the sessions the person may not see.
const test = require('node:test');
const assert = require('node:assert/strict');
const W = require('./support/sec02World');

const { S } = W;
test.after(() => S.stopServer());

const SECRET_TEXT = /SecretCo|Secret margin plan|SecretCo results/;
const one = (path) => `${path}${path.includes('?') ? '&' : '?'}${W.DB}&session_id=${W.SECRET}`;
const UC = '&use_case_id=N01-U01';
// Routes that name one session. Each must refuse READER, who did not launch it and cannot read main.s.orders.
const SESSION_ROUTES = [
  ['steps', 'GET', one('/api/inspire/steps')],
  ['step-results', 'GET', one('/api/inspire/step-results')],
  ['usecases of a session', 'GET', one('/api/inspire/usecases')],
  ['results of a session', 'GET', one('/api/inspire/results')],
  ['genie-progress', 'GET', one('/api/inspire/genie-progress') + '&use_case_ids=N01-U01'],
  ['value', 'GET', one('/api/inspire/value')],
  ['value estimates', 'GET', one('/api/inspire/value/estimates')],
  ['value totals', 'GET', one('/api/inspire/value/totals')],
  ['value answers', 'GET', one('/api/inspire/value/answers') + UC],
  ['implement context', 'GET', one('/api/inspire/implement/context') + UC],
  ['implement history', 'GET', one('/api/inspire/implement/history') + UC],
  ['implement status', 'GET', one('/api/inspire/implement/status') + UC],
  ['implement diagnostics', 'GET', one('/api/inspire/implement/diagnostics') + UC],
  ['implement usecase-assets', 'GET', one('/api/inspire/implement/usecase-assets')],
  ['implement live', 'GET', one('/api/inspire/implement/live') + UC],
];

for (const [label, method, path] of SESSION_ROUTES) {
  test(`AT2 ${label}: a person who did not launch the session and cannot read its scope gets 403 with request 'person'`, async () => {
    await W.seed();
    const got = await S.request(method, path, { person: W.READER });
    assert.equal(got.status, 403, `AT2 ${label}: Not implemented: answers ${got.status}, not 403, to ${W.READER} (no session check on this route): ${got.text.slice(0, 240)}`);
    assert.equal(got.data && got.data.request, 'person', `AT2 ${label}: the refusal is a Request for Access for the person: ${got.text.slice(0, 240)}`);
    assert.ok(!SECRET_TEXT.test(got.text), `AT2 ${label}: the refusal carries no session content: ${got.text.slice(0, 240)}`);
  });
}

// Reads across sessions: the hidden session's content must appear nowhere.
const CROSS = [
  ['usecases all_sessions', `/api/inspire/usecases?${W.DB}&all_sessions=1`],
  ['results latest fallback', `/api/inspire/results?${W.DB}`],
  ['value totals of every run', `/api/inspire/value/totals?${W.DB}`],
  ['value estimates of every run', `/api/inspire/value/estimates?${W.DB}`],
  ['portfolio', `/api/inspire/portfolio?${W.DB}`],
  ['feedback by business', `/api/inspire/feedback?${W.DB}&business_name=SecretCo`],
];

for (const [label, path] of CROSS) {
  test(`AT2 ${label}: the sessions the person may not see are left out`, async () => {
    await W.seed();
    const got = await S.request('GET', path, { person: W.READER });
    const leaked = got.status === 200 && SECRET_TEXT.test(got.text);
    const askedScope = S.state.calls.some((c) => /__inspire_session/.test(c.statement || '') && /tables_str/.test(c.statement || '') && /6001/.test(c.statement || ''));
    assert.ok(!leaked, `AT2 ${label}: Not implemented: the hidden session's content reaches ${W.READER}: ${got.text.slice(0, 240)}`);
    assert.ok(got.status === 403 || askedScope, `AT2 ${label}: Not implemented: answered ${got.status} without checking the scope of any session it covers (no visibleSessions filter)`);
  });
}

test('AT2 CUJ2 control: the launcher opens their own session and its steps, results and use cases (200)', async () => {
  await W.seed();
  for (const path of [one('/api/inspire/steps'), one('/api/inspire/results'), one('/api/inspire/usecases'), one('/api/inspire/session')]) {
    const got = await S.request('GET', path, { person: W.LAUNCHER });
    assert.equal(got.status, 200, `${path}: ${got.text.slice(0, 240)}`);
  }
});

test('AT2 CUJ2 control: a colleague who can read every table of the scope opens the session (200)', async () => {
  await W.seed();
  const got = await S.request('GET', one('/api/inspire/session'), { person: W.COLLEAGUE });
  assert.equal(got.status, 200, got.text.slice(0, 240));
});
