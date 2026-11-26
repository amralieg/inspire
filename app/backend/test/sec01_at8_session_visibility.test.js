// SEC-01 AT8 (W7, D4): a session is shown only to its launcher (launched_by, launchLedger.js) or to a person who can read every table
// in its scope (checked with that person's own token). Anyone else does not get it listed, and opening it returns 403 with RfA.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const SECRET = '6001';
const OPEN = '6002';
const LAUNCHER = 'launcher@example.com';
const READER = 'reader@example.com';
const COLLEAGUE = 'colleague@example.com';
const LIST = `/api/inspire/sessions?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}&all=1`;
const ONE = (sid) => `/api/inspire/session?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}&session_id=${sid}`;
// Each session's scope as the notebook stores it in __inspire_session (catalogs, schemas_str, tables_str).
const SCOPE = { [SECRET]: { business_name: 'SecretCo', tables_str: 'main.s.orders' }, [OPEN]: { business_name: 'OpenCo', tables_str: 'main.s.public' } };
const HIDDEN_TABLE = /`?main`?\.`?s`?\.`?orders`?/;

const sqlResult = (columns, rows) => ({ statement_id: 's1', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: columns.map((name) => ({ name })) } },
  result: { data_array: rows } });
const failed = (message) => ({ statement_id: 's1', status: { state: 'FAILED', error: { message } } });
const answer = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: new Map([['content-type', 'application/json']]),
  json: async () => data, text: async () => JSON.stringify(data), arrayBuffer: async () => Buffer.from(JSON.stringify(data)) });
const SCOPE_COLS = ['session_id', 'business_name', 'processing_status', 'completed_percent', 'create_at', 'catalogs', 'schemas_str', 'tables_str'];

// Layered on the shared stub: the reader's own token cannot read main.s.orders (SQL or Unity Catalog), and every read of
// __inspire_session that names the scope columns answers them for the asked sessions.
let wrapped = false;
async function wrapFetch() {
  await S.startServer();
  if (wrapped) return;
  wrapped = true;
  const base = global.fetch;
  global.fetch = async (url, opts = {}) => {
    const u = new URL(String(url));
    const auth = String((opts.headers && (opts.headers.Authorization || opts.headers.authorization)) || '');
    const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
    const asReader = token === S.PERSON_TOKEN && S.state.person === READER;
    let body = {};
    try { body = typeof opts.body === 'string' ? JSON.parse(opts.body) : {}; } catch { body = {}; }
    const sql = String(body.statement || '');
    if (asReader && u.pathname === '/api/2.0/sql/statements' && HIDDEN_TABLE.test(sql) && !/__inspire_/.test(sql)) {
      S.state.calls.push({ method: 'POST', path: u.pathname, token, statement: sql, category: 'action' });
      return answer(failed("[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table 'main.s.orders'."));
    }
    // SEC-03 (c23): the reader can list (BROWSE) main.s.orders, so its name may be shown; the table's data stays unreadable.
    if (asReader && /^\/api\/2\.1\/unity-catalog\/tables\/main\.s\.orders/.test(u.pathname)) return answer({ full_name: 'main.s.orders' });
    if (asReader && /^\/api\/2\.1\/unity-catalog\/(permissions|effective-permissions)\/(table\/)?main\.s\.orders/.test(u.pathname)) {
      return answer({ error_code: 'PERMISSION_DENIED', message: "User does not have SELECT on Table 'main.s.orders'." }, 403);
    }
    if (u.pathname === '/api/2.0/sql/statements' && /__inspire_session/.test(sql) && /\btables_str\b/.test(sql) && !/business_rank/.test(sql)) {
      const ids = [...new Set((sql.match(/\b600[12]\b/g) || []).concat((body.parameters || []).map((p) => String(p.value)).filter((v) => SCOPE[v])))];
      const rows = ids.filter((id) => SCOPE[id]).map((id) => SCOPE_COLS.map((c) => (c === 'session_id' ? id
        : ({ processing_status: 'Done', completed_percent: '100', create_at: '2026-11-20T10:00:00Z', catalogs: '', schemas_str: '', ...SCOPE[id] })[c] ?? null)));
      return answer(sqlResult(SCOPE_COLS, rows));
    }
    if (u.pathname === '/api/2.0/sql/statements' && /LIMIT 0/.test(sql)) return answer(sqlResult(['x'], []));
    return base(url, opts);
  };
}

async function seed() {
  await wrapFetch();
  S.reset({
    sessionList: [
      { session_id: SECRET, business_name: 'SecretCo', completed_percent: 100, create_at: '2026-11-20T10:00:00Z', business_runs: 1, business_rank: 1 },
      { session_id: OPEN, business_name: 'OpenCo', completed_percent: 100, create_at: '2026-11-19T10:00:00Z', business_runs: 1, business_rank: 1 },
    ],
    usecases: [
      { session_id: SECRET, use_case: 'Secret margin plan', inspire_score: 9, business_domain: 'Finance' },
      { session_id: OPEN, use_case: 'Open demand plan', inspire_score: 8, business_domain: 'Operations' },
    ],
    sessionLaunchers: { [SECRET]: LAUNCHER, [OPEN]: LAUNCHER },
    sessionBusiness: { [SECRET]: 'SecretCo', [OPEN]: 'OpenCo' },
    knownSessions: [SECRET, OPEN],
  });
}
const listed = (got) => ((got.data && got.data.sessions) || []).map((s) => String(s.session_id));

test('AT8: a person who is not the launcher and cannot read the scope does not get the session listed', async () => {
  await seed();
  const got = await S.request('GET', LIST, { person: READER });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.ok(listed(got).includes(OPEN), `the readable session stays listed: ${JSON.stringify(listed(got))}`);
  assert.ok(!listed(got).includes(SECRET), `AT8: session ${SECRET} is listed to ${READER}, who cannot read main.s.orders (no per-person filter on /api/inspire/sessions)`);
  assert.ok(!/SecretCo|Secret margin plan/.test(got.text), 'AT8: the hidden session\'s business name and use cases must appear nowhere in the list');
});

test('AT8: opening that session returns 403 with a table-level RfA payload for the person', async () => {
  await seed();
  const got = await S.request('GET', ONE(SECRET), { person: READER });
  assert.equal(got.status, 403, `AT8: /api/inspire/session returns ${got.status} to a person who cannot read its scope (no filter): ${got.text.slice(0, 300)}`);
  assert.ok(!/SecretCo|Secret margin plan/.test(got.text), 'AT8: the 403 carries no session content');
  assert.equal(got.data.request, 'person', `AT8: the RfA is for the person: ${got.text.slice(0, 300)}`);
  const statements = (got.data.permissions || []).flatMap((p) => p.statements || []);
  assert.ok(statements.some((s) => /^GRANT SELECT ON TABLE `main`\.`s`\.`orders` TO `reader@example\.com`$/.test(s)), `AT8: table-level grant naming the table: ${JSON.stringify(got.data)}`);
  assert.deepEqual(statements.filter((s) => /ON (SCHEMA|CATALOG) /.test(s) && /SELECT/.test(s)), [], 'AT8: no schema- or catalog-level SELECT');
});

test('AT8 control: the launcher and a person who can read the scope both see and open the session', async () => {
  await seed();
  for (const person of [LAUNCHER, COLLEAGUE]) {
    const got = await S.request('GET', LIST, { person });
    assert.ok(listed(got).includes(SECRET), `${person} sees ${SECRET}: ${JSON.stringify(listed(got))}`);
    const one = await S.request('GET', ONE(SECRET), { person });
    assert.equal(one.status, 200, `${person}: ${one.text.slice(0, 300)}`);
  }
});
