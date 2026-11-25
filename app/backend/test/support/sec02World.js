// SEC-02 shared world for the sec02_* acceptance tests. Layered on test/support/serverApp.js, like SEC-01 AT8:
// - READER's own token cannot read main.s.orders (SQL or Unity Catalog); COLLEAGUE's can; LAUNCHER launched both sessions.
// - SECRET (6001) covers main.s.orders, OPEN (6002) covers main.s.public, as __inspire_session stores the scope.
// - The run 777 belongs to SECRET in the launch ledger (__inspire_launch), run 778 to OPEN.
// - The Build registry (__inspire_implement) holds one hosted page per session.
// Every workspace call is recorded in S.state.calls with the token it carried, so a test can tell a person read from an App read.
const S = require('./serverApp');

const SECRET = '6001';
const OPEN = '6002';
const LAUNCHER = 'launcher@example.com';
const READER = 'reader@example.com';
const COLLEAGUE = 'colleague@example.com';
const TABLE = 'main.s.orders';
const HIDDEN_TABLE = /`?main`?\.`?s`?\.`?orders`?/;
const DB = `inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}`;
const SCOPE = { [SECRET]: { business_name: 'SecretCo', tables_str: TABLE }, [OPEN]: { business_name: 'OpenCo', tables_str: 'main.s.public' } };
const SCOPE_COLS = ['session_id', 'business_name', 'processing_status', 'completed_percent', 'create_at', 'catalogs', 'schemas_str', 'tables_str',
  'results_json', 'completed_on', 'table_scope'];
const RUNS = { 777: SECRET, 778: OPEN };

const sqlResult = (columns, rows) => ({ statement_id: 's1', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: columns.map((name) => ({ name })) } },
  result: { data_array: rows } });
const failed = (message) => ({ statement_id: 's1', status: { state: 'FAILED', error: { message } } });
const answer = (data, status = 200) => ({ ok: status >= 200 && status < 300, status, headers: new Map([['content-type', 'application/json']]),
  json: async () => data, text: async () => JSON.stringify(data), arrayBuffer: async () => Buffer.from(JSON.stringify(data)) });

const hostedRow = (sid, uc, id) => ({
  session_id: sid, use_case_id: uc, spec_version: '2', status: 'ready', created_by: LAUNCHER, app_name: null, app_url: null, dashboard_id: null, genie_space_id: null,
  spec_json: JSON.stringify({ use_case_name: `${SCOPE[sid].business_name} page`, outputs: { app: true, app_owners: [] } }),
  asset_status: JSON.stringify({ app: { placement: 'inspire', app_name: '', app_url: '', state: 'ready',
    hosted: { id, source: `/Workspace/Users/launcher/inspire/${id}/v2`, version: 2, warehouse_id: 'wh2', page: 'n01_u01', published_at: '2026-11-20T05:00:00Z' } } }),
  updated_at: '2026-11-20T06:00:00Z',
});
const REGISTRY_COLS = ['session_id', 'use_case_id', 'spec_version', 'spec_json', 'status', 'dashboard_id', 'genie_space_id', 'app_name', 'app_url',
  'asset_status', 'created_by', 'updated_at'];

const world = { probeError: null, probeLimitTable: null, extraScope: {} };

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
    const record = () => S.state.calls.push({ method: String(opts.method || 'GET').toUpperCase(), path: u.pathname, query: u.search, token, statement: sql, category: 'action' });
    if (u.pathname === '/api/2.0/sql/statements' && token === S.PERSON_TOKEN && !/__inspire_/.test(sql)) {
      // world.probeError answers every person read of a source table with that message (a warehouse refusal, a hidden schema, ...).
      if (world.probeError && /LIMIT 0/.test(sql)) { record(); return answer(failed(world.probeError)); }
      if (world.probeLimitTable && S.state.person === READER && sql.replace(/`/g, '').includes(world.probeLimitTable)) {
        record(); return answer(failed(`[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table '${world.probeLimitTable}'.`));
      }
    }
    if (asReader && u.pathname === '/api/2.0/sql/statements' && HIDDEN_TABLE.test(sql) && !/__inspire_/.test(sql)) {
      record();
      return answer(failed(`[INSUFFICIENT_PERMISSIONS] User does not have SELECT on Table '${TABLE}'.`));
    }
    if (asReader && /^\/api\/2\.1\/unity-catalog\/(tables|permissions|effective-permissions)\/(table\/)?main\.s\.orders/.test(u.pathname)) {
      record();
      return answer({ error_code: 'PERMISSION_DENIED', message: `User does not have SELECT on Table '${TABLE}'.` }, 403);
    }
    // The launch ledger maps a run to its session.
    if (u.pathname === '/api/2.0/sql/statements' && /__inspire_launch/.test(sql) && /^\s*SELECT\b[\s\S]*?\bsession_id\b[\s\S]*?\bFROM\b/i.test(sql) && /\brun_id\b/.test(sql)
      && !/launched_at/.test(sql)) {
      record();
      const asked = [...new Set([...(sql.match(/\b77[78]\b/g) || []), ...(body.parameters || []).map((p) => String(p.value))])].filter((r) => RUNS[r]);
      return answer(sqlResult(['run_id', 'session_id', 'launched_by'], asked.map((r) => [r, RUNS[r], LAUNCHER])));
    }
    // The Build registry: one hosted page per session.
    if (u.pathname === '/api/2.0/sql/statements' && /__inspire_implement/.test(sql) && /LIMIT 5000/.test(sql) && /asset_status/.test(sql)) {
      record();
      const rows = [hostedRow(SECRET, 'N01-U01', 'n01-u01-secret'), hostedRow(OPEN, 'N02-U01', 'n02-u01-open')];
      return answer(sqlResult(REGISTRY_COLS, rows.map((r) => REGISTRY_COLS.map((c) => r[c] ?? null))));
    }
    // Every read of __inspire_session that names the scope columns answers them for the asked sessions.
    if (u.pathname === '/api/2.0/sql/statements' && /__inspire_session/.test(sql) && /\btables_str\b/.test(sql) && !/business_rank/.test(sql)) {
      record();
      const all = { ...SCOPE, ...world.extraScope };
      const ids = [...new Set((sql.match(/\b\d{4}\b/g) || []).concat((body.parameters || []).map((p) => String(p.value))))].filter((id) => all[id]);
      const rows = ids.map((id) => SCOPE_COLS.map((c) => (c === 'session_id' ? id
        : ({ processing_status: 'Done', completed_percent: '100', create_at: '2026-11-20T10:00:00Z', catalogs: '', schemas_str: '', completed_on: '2026-11-20T11:00:00Z',
          results_json: JSON.stringify({ business_name: all[id].business_name, secret: `${all[id].business_name} results` }), table_scope: '', ...all[id] })[c] ?? null)));
      return answer(sqlResult(SCOPE_COLS, rows));
    }
    // The latest-session fallback of /api/inspire/results (no session_id named) finds SECRET, the newest run.
    if (u.pathname === '/api/2.0/sql/statements' && /__inspire_session/.test(sql) && /results_json/.test(sql) && /ORDER BY completed_on DESC/.test(sql)) {
      record();
      return answer(sqlResult(['results_json', 'completed_on', 'session_id'], [[JSON.stringify({ business_name: 'SecretCo', secret: 'SecretCo results' }), '2026-11-20T11:00:00Z', SECRET]]));
    }
    if (u.pathname === '/api/2.0/sql/statements' && /LIMIT 0/.test(sql)) { record(); return answer(sqlResult(['x'], [])); }
    return base(url, opts);
  };
}

async function seed(overrides = {}) {
  await wrapFetch();
  world.probeError = null;
  world.probeLimitTable = null;
  world.extraScope = {};
  S.reset({
    sessionList: [
      { session_id: SECRET, business_name: 'SecretCo', completed_percent: 100, create_at: '2026-11-20T10:00:00Z', business_runs: 1, business_rank: 1 },
      { session_id: OPEN, business_name: 'OpenCo', completed_percent: 100, create_at: '2026-11-19T10:00:00Z', business_runs: 1, business_rank: 1 },
    ],
    usecases: [
      { session_id: SECRET, use_case: 'Secret margin plan', inspire_score: 9, business_domain: 'Finance' },
      { session_id: OPEN, use_case: 'Open demand plan', inspire_score: 8, business_domain: 'Operations' },
    ],
    listedUseCases: [
      { session_id: SECRET, use_case_id: 'N01-U01', use_case: 'Secret margin plan', business_domain: 'Finance', tables_involved: TABLE },
      { session_id: OPEN, use_case_id: 'N02-U01', use_case: 'Open demand plan', business_domain: 'Operations', tables_involved: 'main.s.public' },
    ],
    sessionLaunchers: { [SECRET]: LAUNCHER, [OPEN]: LAUNCHER },
    launchers: { 777: LAUNCHER, 778: LAUNCHER },
    sessionBusiness: { [SECRET]: 'SecretCo', [OPEN]: 'OpenCo' },
    knownSessions: [SECRET, OPEN],
    ledgerSessions: [SECRET, OPEN],
    runOutputs: { 777: { notebook_output: { result: 'SecretCo margin by customer: 41%' }, metadata: { run_id: 777 } },
      778: { notebook_output: { result: 'OpenCo demand' }, metadata: { run_id: 778 } } },
    tableColumns: { 'main.s.orders': ['region', 'amount', 'currency', 'rate'] },
    ...overrides,
  });
}

// The workspace calls that read customer data or metadata: Unity Catalog, the Files API, the workspace API, SCIM directory search, and SQL that
// names no Inspire tracking table. The App's own sign-in, the policy reads and Inspire's tracking tables are left out.
function dataCalls(calls = S.state.calls) {
  return calls.filter((c) => {
    if (c.path === '/oidc/v1/token' || c.path === '/api/2.0/preview/scim/v2/Me' || c.path.startsWith('/api/2.0/permissions/apps/')) return false;
    if (c.path === '/api/2.0/sql/statements') return !/__inspire_/.test(c.statement || '') && !!c.statement;
    return /^\/api\/2\.(0|1)\/(unity-catalog|fs|workspace|preview\/scim\/v2\/(Users|Groups))\b/.test(c.path);
  });
}
const asApp = (calls) => calls.filter((c) => c.token === S.APP_TOKEN);
const describe = (calls) => calls.map((c) => `${c.token === S.APP_TOKEN ? 'APP' : c.token === S.PERSON_TOKEN ? 'PERSON' : c.token || 'none'} ${c.method} ${c.path}${c.statement ? ` :: ${c.statement.slice(0, 80)}` : ''}`).join('\n');

module.exports = { S, world, seed, dataCalls, asApp, describe, SECRET, OPEN, LAUNCHER, READER, COLLEAGUE, TABLE, DB, RUNS, sqlResult, answer };
