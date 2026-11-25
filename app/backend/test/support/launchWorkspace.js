// The fake Databricks workspace one launch needs, shared by the launch-record tests. Options make one read or write fail the way the live App saw it.
const PERSON = ['pat.lee', 'example.com'].join('@');
const NOTEBOOK = '/Workspace/Shared/inspire_ai/dbx_inspire_ai_agent';
const SP_TOKEN = 'sp-token';
const NO_CREDENTIAL = 'Credential was not sent or was of an unsupported type for this API';
const OUTPUT_FOLDERS = { '/Shared': { id: 1, writers: '*' }, '/Shared/inspire_out': { id: 7, writers: '*' } };
const LAUNCH_PARAMS = { '00_business_name': 'Acme', '02_inspire_database': 'main._inspire', '01_uc_metadata': 'main.s.orders', '11_generation_path': '/Shared/inspire_out' };

const statementOf = (call) => String((call.body && call.body.statement) || '');
const sqlOk = (columns, rows) => [200, { statement_id: 's1', status: { state: 'SUCCEEDED' }, manifest: { schema: { columns: columns.map((name) => ({ name })) } }, result: { data_array: rows } }];

// options: insertFails (the launch record INSERT answers 500), ledgerFails (every App-database read answers 500), cancelStatus (the cancel answer).
function launchWorkspaceAnswer({ insertFails = false, ledgerFails = false, cancelStatus = 200 } = {}) {
  return (call) => {
    if (call.path === '/oidc/v1/token') return [200, { access_token: SP_TOKEN, expires_in: 3600 }];
    if (call.path.startsWith('/api/2.0/preview/scim/v2/Me')) return [200, { userName: PERSON }];
    if (/^\/api\/2\.1\/unity-catalog\/tables\//.test(call.path)) return [200, { full_name: 'main.s.orders' }];
    if (call.path.split('?')[0] === '/api/2.0/workspace/get-status') {
      const at = new URL(`http://x${call.path}`).searchParams.get('path');
      return at === NOTEBOOK ? [200, { object_type: 'NOTEBOOK', path: NOTEBOOK }] : [200, { object_type: 'DIRECTORY', path: at }];
    }
    if (call.path === '/api/2.1/jobs/create') return [200, { job_id: 1111111111111111 }];
    if (call.path === '/api/2.0/permissions/jobs/1111111111111111') return [200, {}];
    if (call.path === '/api/2.1/jobs/run-now') return [200, { run_id: 99 }];
    if (call.path === '/api/2.1/jobs/runs/cancel') return cancelStatus === 200 ? [200, {}] : [cancelStatus, { error_code: 'INTERNAL_ERROR', message: 'cancel refused' }];
    if (call.path.startsWith('/api/2.1/jobs/runs/get')) return [200, { run_id: 99, run_name: 'Inspire AI - Acme', state: { life_cycle_state: 'RUNNING' } }];
    if (call.path === '/api/2.0/sql/statements') {
      const statement = statementOf(call);
      if (/__inspire_launch/.test(statement) && ledgerFails) return [500, { error_code: 'INTERNAL_ERROR', message: 'warehouse did not answer' }];
      if (/^INSERT INTO .*__inspire_launch/.test(statement) && insertFails) return [500, { error_code: 'INTERNAL_ERROR', message: 'ledger write refused' }];
      if (/^SELECT (?:run_id, session_id, )?launched_by FROM/.test(statement)) {
        if (call.token !== SP_TOKEN) return [401, { error_code: 'UNAUTHENTICATED', message: NO_CREDENTIAL }];
        return sqlOk(['launched_by'], [[PERSON]]);
      }
      return sqlOk(['num_inserted_rows'], [['1']]);
    }
    return null;
  };
}

const LAUNCH_ENV = { NOTEBOOK_PATH: NOTEBOOK, NODE_ENV: 'production', INSPIRE_WAREHOUSE_ID: 'w1', INSPIRE_DATABASE: 'main._inspire',
  DATABRICKS_CLIENT_ID: 'inspire-client', DATABRICKS_CLIENT_SECRET: 'inspire-secret' };

const PERSON_HEADERS = { 'Content-Type': 'application/json', 'x-forwarded-access-token': 'person-token', 'x-forwarded-email': PERSON };

module.exports = { PERSON, NOTEBOOK, SP_TOKEN, NO_CREDENTIAL, OUTPUT_FOLDERS, LAUNCH_PARAMS, LAUNCH_ENV, PERSON_HEADERS, launchWorkspaceAnswer, statementOf };
