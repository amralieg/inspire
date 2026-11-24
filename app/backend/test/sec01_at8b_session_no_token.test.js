// SEC-01 W7 fail-closed (coordinator 15 review): with no forwarded user token, a session the caller did not launch is neither listed nor
// opened (403, request 'person'); a session they launched still is. With no person at all, nothing is listed and nothing opens.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const SECRET = '6001';
const OWN = '6002';
const CALLER = 'caller@example.com';
const OTHER = 'someone-else@example.com';
const LIST = `/api/inspire/sessions?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}&all=1`;
const ONE = (sid) => `/api/inspire/session?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}&session_id=${sid}`;
const SCOPE = { [SECRET]: { business_name: 'SecretCo', tables_str: 'main.s.orders' }, [OWN]: { business_name: 'OwnCo', tables_str: 'main.s.mine' } };
const SCOPE_COLS = ['session_id', 'business_name', 'processing_status', 'completed_percent', 'create_at', 'catalogs', 'schemas_str', 'tables_str'];
const answer = (data) => ({ ok: true, status: 200, headers: new Map([['content-type', 'application/json']]),
  json: async () => data, text: async () => JSON.stringify(data), arrayBuffer: async () => Buffer.from(JSON.stringify(data)) });

let wrapped = false;
async function seed() {
  await S.startServer();
  if (!wrapped) {
    wrapped = true;
    const base = global.fetch;
    global.fetch = async (url, opts = {}) => {
      const u = new URL(String(url));
      let body = {};
      try { body = typeof opts.body === 'string' ? JSON.parse(opts.body) : {}; } catch { body = {}; }
      const sql = String(body.statement || '');
      if (u.pathname === '/api/2.0/sql/statements' && /__inspire_session/.test(sql) && /\btables_str\b/.test(sql) && !/business_rank/.test(sql)) {
        const ids = [...new Set((sql.match(/\b600[12]\b/g) || []).concat((body.parameters || []).map((p) => String(p.value)).filter((v) => SCOPE[v])))];
        const rows = ids.filter((id) => SCOPE[id]).map((id) => SCOPE_COLS.map((c) => (c === 'session_id' ? id
          : ({ processing_status: 'Done', completed_percent: '100', create_at: '2026-11-20T10:00:00Z', catalogs: '', schemas_str: '', ...SCOPE[id] })[c] ?? null)));
        return answer({ statement_id: 's1', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: SCOPE_COLS.map((name) => ({ name })) } }, result: { data_array: rows } });
      }
      return base(url, opts);
    };
  }
  S.reset({
    sessionList: [
      { session_id: SECRET, business_name: 'SecretCo', completed_percent: 100, create_at: '2026-11-20T10:00:00Z', business_runs: 1, business_rank: 1 },
      { session_id: OWN, business_name: 'OwnCo', completed_percent: 100, create_at: '2026-11-19T10:00:00Z', business_runs: 1, business_rank: 1 },
    ],
    usecases: [
      { session_id: SECRET, use_case: 'Secret margin plan', inspire_score: 9, business_domain: 'Finance' },
      { session_id: OWN, use_case: 'Own demand plan', inspire_score: 8, business_domain: 'Operations' },
    ],
    sessionLaunchers: { [SECRET]: OTHER, [OWN]: CALLER },
    sessionBusiness: { [SECRET]: 'SecretCo', [OWN]: 'OwnCo' },
    knownSessions: [SECRET, OWN],
  });
}
const listed = (got) => ((got.data && got.data.sessions) || []).map((s) => String(s.session_id));

test('no user token: a session the caller did not launch is not listed, one they launched is', async () => {
  await seed();
  const got = await S.request('GET', LIST, { person: CALLER, userToken: false });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.ok(!listed(got).includes(SECRET), `W7 fails open: ${SECRET} is listed with no user token: ${JSON.stringify(listed(got))}`);
  assert.ok(!/SecretCo|Secret margin plan/.test(got.text));
  assert.ok(listed(got).includes(OWN), `the caller's own session stays listed: ${JSON.stringify(listed(got))}`);
});

test('no user token: opening another launcher\'s session is 403 with request "person", opening one\'s own is 200', async () => {
  await seed();
  const other = await S.request('GET', ONE(SECRET), { person: CALLER, userToken: false });
  assert.equal(other.status, 403, `W7 fails open: ${other.text.slice(0, 200)}`);
  assert.equal(other.data.request, 'person');
  assert.ok(!/SecretCo|Secret margin plan/.test(other.text));
  const own = await S.request('GET', ONE(OWN), { person: CALLER, userToken: false });
  assert.equal(own.status, 200, own.text.slice(0, 200));
});

test('no person at all: nothing is listed and the session does not open', async () => {
  await seed();
  const got = await S.request('GET', LIST, { person: '', signedIn: false });
  assert.deepEqual(listed(got), [], `no person lists nothing: ${got.text.slice(0, 200)}`);
  const one = await S.request('GET', ONE(OWN), { person: '', signedIn: false });
  assert.equal(one.status, 403, one.text.slice(0, 200));
});
