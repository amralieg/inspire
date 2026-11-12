const test = require('node:test');
const assert = require('node:assert/strict');
const I = require('../lib/inspireImplement');
const { notebookParamsFromSessionForGenerateRun } = require('../lib/inspireSessionParams');
const { sanitizeInspireNotebookJobParams } = require('../lib/inspireJobParams');
const { makeApp, listen } = require('./support/implementApp');

const OWNER = ['owner', 'example.com'].join('@');
const PERSON_TOKEN = 'person-token';
const TABLE = 'main.s.orders';
const SCOPE = {
  [TABLE]: { columns: ['brand_name', 'total_sales'], rows: [{ column: 'brand_name', op: '=', values: ['Tokyo Tidbits'] }] },
};
const SCOPE_JSON = JSON.stringify(SCOPE);
const SESSION = { business_name: 'Acme', tables_str: TABLE, schemas_str: '', catalogs: '', inspire_database_name: 'main.inspire', generation_path: '/tmp/out' };
const DB = { inspire_database: 'main.inspire', warehouse_id: 'wh1', session_id: '42' };
const USE_CASE = { id: 'N01-U01', use_case: 'Predict churn', primary_table: TABLE, tables_involved: TABLE, genie_instruction: '' };
const SPEC = { use_case_id: 'N01-U01', use_case_name: 'Predict churn', config: { warehouse_id: 'wh1', result_table: 'main.inspire.churn_out' }, outputs: { dashboard: true } };

function implementParams(session) {
  const sessionParams = notebookParamsFromSessionForGenerateRun({ ...session, table_scope: session.table_scope }, '42');
  return { sessionParams, params: I.implementJobParams(sessionParams, 'N01-U01', 1, '') };
}

test('a Build on a scoped table passes the scope check, and its job carries the Launch scope', () => {
  const { sessionParams, params } = implementParams({ ...SESSION, table_scope: SCOPE_JSON });
  assert.equal(params['01_uc_metadata'], '', 'the Implement job blanks its metadata: each use case names its own tables');
  const job = sanitizeInspireNotebookJobParams(params, { scopePicks: sessionParams['01_uc_metadata'] });
  assert.equal(job['15_operation'], 'Implement Use Cases');
  assert.deepEqual(JSON.parse(job['17_table_scope'])[TABLE].rows, SCOPE[TABLE].rows);
});

test('the scope check reads the run picks for a picked schema and for a picked catalog', () => {
  for (const picks of [{ schemas_str: 'main.s', tables_str: '', catalogs: '' }, { catalogs: 'main', schemas_str: '', tables_str: '' }]) {
    const { sessionParams, params } = implementParams({ ...SESSION, ...picks, table_scope: SCOPE_JSON });
    const job = sanitizeInspireNotebookJobParams(params, { scopePicks: sessionParams['01_uc_metadata'] });
    assert.ok(job['17_table_scope'], `the scope is kept under ${JSON.stringify(picks)}`);
  }
});

test('a scope on a table outside the run picks is still refused, naming that table', () => {
  const outside = { ...SCOPE, 'main.other.returns': SCOPE[TABLE] };
  const { sessionParams, params } = implementParams({ ...SESSION, table_scope: JSON.stringify(outside) });
  assert.throws(() => sanitizeInspireNotebookJobParams(params, { scopePicks: sessionParams['01_uc_metadata'] }),
    /Table scope names main\.other\.returns, which is not picked under Unity Catalog Metadata/);
});

test('the Build route hands the run picks and the Launch scope to the job check', async () => {
  const made = makeApp({ useCase: USE_CASE, forwardedToken: PERSON_TOKEN, forwardedEmail: OWNER, session: { ...SESSION, table_scope: SCOPE_JSON } });
  const srv = await listen(made.app);
  try {
    const resp = await fetch(`${srv.url}/api/inspire/implement/submit`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...DB, spec: SPEC }) });
    assert.equal(resp.status, 200, JSON.stringify(await resp.json()));
  } finally {
    await srv.close();
  }
  assert.equal(made.jobs.length, 1, 'one Implement job is started');
  assert.equal(made.jobs[0].scopePicks, TABLE, 'the job is told which tables the run picked');
  assert.deepEqual(JSON.parse(made.jobs[0].params['17_table_scope'])[TABLE].rows, SCOPE[TABLE].rows);
});
