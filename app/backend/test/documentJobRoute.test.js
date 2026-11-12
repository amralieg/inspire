const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');
const { CATALOG_MISSING_TEXT, CATALOG_CHECK_FAILED_TEXT, CATALOG_UNSAVED_TEXT } = require('../lib/documentJob');
const frontendLib = require('node:url');
const path = require('node:path');

test.after(() => S.stopServer());

const ME = 'editor@example.com';
const OUT = `/Users/${ME}/out`;
const CATALOG = `${OUT}/acme/docs/Acme-dbx_inspire.json`;
const BASE = { session_id: '7300', inspire_database: S.APP_DB, business_name: 'Acme', generation_path: OUT };
const creates = () => S.state.calls.filter((c) => c.path === '/api/2.1/jobs/create');

async function documentJobState(runId) {
  const lib = await import(frontendLib.pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'documentActions.js')).href);
  const run = await S.request('GET', `/api/run/${runId}`, { person: ME });
  assert.equal(run.status, 200, run.text.slice(0, 300));
  return lib.documentJobState(run.data);
}

test('the Create use case catalog button launches a docs-only run with the PDF catalog, the session and every language, then reads done when it ends (REQ-077)', async () => {
  S.reset({ presentPaths: [CATALOG], notebookPresent: true, managers: [], runStates: {}, sessionLaunchers: { 7300: ME }, folders: { [`/Users/${ME}`]: { id: 11, writers: [ME] } } });
  const got = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'use-case-catalog', output_language: 'English,Arabic' } });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.deepEqual(got.data.document, { kind: 'use-case-catalog', option: 'PDF Catalog', session_id: '7300', languages: ['English', 'Arabic'] });
  assert.equal(creates().length, 1, 'one job is created');
  const params = S.state.createdJob.tasks[0].notebook_task.base_parameters;
  assert.equal(params['09_generation_options'], 'PDF Catalog');
  assert.equal(params['01_uc_metadata'], CATALOG, 'the rebuild starts from the English catalog of this session');
  assert.equal(params['11_generation_path'], OUT, 'the session folder is passed as stored, so the documents land beside the session');
  assert.equal(params['12_documents_languages'], 'English,Arabic');
  assert.equal(params['14_session_id'], '7300', 'the documents are written beside this session');
  const runId = got.data.run_id;
  S.state.launchers[runId] = ME;
  S.state.runStates[runId] = { life_cycle_state: 'RUNNING' };
  assert.equal(await documentJobState(runId), 'running', 'a run that has not ended reads running');
  S.state.runStates[runId] = { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' };
  assert.equal(await documentJobState(runId), 'done');
  S.state.runStates[runId] = { life_cycle_state: 'TERMINATED', result_state: 'FAILED' };
  assert.equal(await documentJobState(runId), 'failed');
});

test('the Create strategy document button sends the format the person picked as the presentation or PDF option (REQ-077)', async () => {
  S.reset({ presentPaths: [CATALOG], notebookPresent: true, managers: [], runStates: {}, sessionLaunchers: { 7300: ME }, folders: { [`/Users/${ME}`]: { id: 11, writers: [ME] } } });
  const pptx = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'strategy-document', format: 'PPTX' } });
  assert.equal(pptx.status, 200, pptx.text.slice(0, 300));
  assert.equal(pptx.data.document.option, 'Presentation');
  assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['09_generation_options'], 'Presentation');
  const pdf = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'strategy-document', format: 'PDF' } });
  assert.equal(pdf.status, 200, pdf.text.slice(0, 300));
  assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['09_generation_options'], 'PDF Catalog');
});

test('the Create Excel workbook button launches a docs-only run with the Excel option, the session and the English catalog (REQ-077)', async () => {
  S.reset({ presentPaths: [CATALOG], notebookPresent: true, managers: [], runStates: {}, sessionLaunchers: { 7300: ME }, folders: { [`/Users/${ME}`]: { id: 11, writers: [ME] } } });
  const got = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'excel-workbook' } });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.deepEqual(got.data.document, { kind: 'excel-workbook', option: 'Excel', session_id: '7300', languages: ['English'] });
  const params = S.state.createdJob.tasks[0].notebook_task.base_parameters;
  assert.equal(params['09_generation_options'], 'Excel');
  assert.equal(params['01_uc_metadata'], CATALOG);
  assert.equal(params['14_session_id'], '7300');
});

test('a document request without a session or with a relative session folder starts no job (must-exclude)', async () => {
  S.reset({ presentPaths: [CATALOG], notebookPresent: true, managers: [], runStates: {}, sessionLaunchers: { 7300: ME }, folders: { [`/Users/${ME}`]: { id: 11, writers: [ME] } } });
  const noSession = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, session_id: '', kind: 'use-case-catalog' } });
  assert.ok([400, 403].includes(noSession.status), noSession.text.slice(0, 300));
  const relative = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'use-case-catalog', generation_path: 'inspire_output' } });
  assert.equal(relative.status, 400, relative.text.slice(0, 300));
  assert.equal(creates().length, 0);
});

test('a trailing slash on the session folder is passed as sent and the catalog is still found under the business folder (REQ-077)', async () => {
  S.reset({ presentPaths: [CATALOG], notebookPresent: true, managers: [], runStates: {}, sessionLaunchers: { 7300: ME }, folders: { [`/Users/${ME}`]: { id: 11, writers: [ME] } } });
  const got = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'use-case-catalog', generation_path: `${OUT}/` } });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  const params = S.state.createdJob.tasks[0].notebook_task.base_parameters;
  assert.equal(params['11_generation_path'], `${OUT}/`, 'the body is passed as sent; the notebook normalizes the trailing slash once');
  assert.equal(params['15_operation'], 'Discover Use Cases');
  assert.equal(params['01_uc_metadata'], `${OUT}/acme/docs/Acme-dbx_inspire.json`, 'the catalog is still found under the business folder');
});

test('a session whose English catalog file is gone is told in plain words, with no raw path, and no job starts (REQ-077)', async () => {
  S.reset({ presentPaths: [CATALOG], notebookPresent: true, managers: [], runStates: {}, sessionLaunchers: { 7300: ME }, folders: { [`/Users/${ME}`]: { id: 11, writers: [ME] } },
    presentPaths: [] });
  const got = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'use-case-catalog' } });
  assert.equal(got.status, 409, got.text.slice(0, 300));
  assert.equal(got.data.error, CATALOG_MISSING_TEXT);
  assert.equal(got.data.error.includes(OUT), false, 'no path in the words the person reads');
  assert.equal(creates().length, 0);
});

test('a catalog check that answers an error other than missing says so in plain words, with no raw detail, and starts no job (REQ-077)', async () => {
  S.reset({ presentPaths: [CATALOG], notebookPresent: true, managers: [], runStates: {}, sessionLaunchers: { 7300: ME }, folders: { [`/Users/${ME}`]: { id: 11, writers: [ME] } },
    statusErrors: { [CATALOG]: 500 } });
  const got = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'use-case-catalog' } });
  assert.equal(got.status, 503, got.text.slice(0, 300));
  assert.equal(got.data.error, CATALOG_CHECK_FAILED_TEXT);
  assert.equal(got.text.includes('raw workspace detail'), false, 'the workspace answer is not passed on');
  assert.equal(got.text.includes('missing'), false, 'an error that is not a 404 is never reported as a missing catalog');
  assert.equal(creates().length, 0);
});

test('a catalog check that cannot reach the workspace says so in plain words, with no raw host or error text, and starts no job (REQ-077)', async () => {
  S.reset({ presentPaths: [CATALOG], notebookPresent: true, managers: [], runStates: {}, sessionLaunchers: { 7300: ME }, folders: { [`/Users/${ME}`]: { id: 11, writers: [ME] } },
    statusErrors: { [CATALOG]: 'network' } });
  const got = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'use-case-catalog' } });
  assert.equal(got.status, 503, got.text.slice(0, 300));
  assert.equal(got.data.error, CATALOG_CHECK_FAILED_TEXT);
  assert.equal(got.text.includes('ENOTFOUND'), false, 'no raw network error reaches the person');
  assert.equal(creates().length, 0);
});

const RENAMED_CATALOG = `${OUT}/acme/docs/Acme-dbx_inspire.json`;

test('a renamed business still finds the English catalog its Discover run wrote, from the path the session stored (REQ-077)', async () => {
  S.reset({ presentPaths: [RENAMED_CATALOG], notebookPresent: true, managers: [], runStates: {}, sessionLaunchers: { 7300: ME }, folders: { [`/Users/${ME}`]: { id: 11, writers: [ME] } },
    catalogPaths: { 7300: RENAMED_CATALOG } });
  const got = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, business_name: 'Acme Renamed', kind: 'use-case-catalog' } });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['01_uc_metadata'], RENAMED_CATALOG, 'the stored path is used, not the new business name');
});

test('an old session whose stored catalog path is empty falls back to the business-name folder (REQ-077)', async () => {
  S.reset({ presentPaths: [CATALOG], notebookPresent: true, managers: [], runStates: {}, sessionLaunchers: { 7300: ME }, folders: { [`/Users/${ME}`]: { id: 11, writers: [ME] } },
    catalogPaths: { 7300: null } });
  const got = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'use-case-catalog' } });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['01_uc_metadata'], CATALOG);
});

test('a workspace that has not added the catalog path column yet falls back to the business-name folder (REQ-077)', async () => {
  S.reset({ presentPaths: [CATALOG], notebookPresent: true, managers: [], runStates: {}, sessionLaunchers: { 7300: ME }, folders: { [`/Users/${ME}`]: { id: 11, writers: [ME] } },
    catalogColumnMissing: true });
  const got = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'use-case-catalog' } });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['01_uc_metadata'], CATALOG);
});

test('a failed read of the stored catalog path says so in plain words and starts no job (REQ-077)', async () => {
  S.reset({ presentPaths: [CATALOG], notebookPresent: true, managers: [], runStates: {}, sessionLaunchers: { 7300: ME }, folders: { [`/Users/${ME}`]: { id: 11, writers: [ME] } },
    catalogQueryError: 'PERMISSION_DENIED: User does not have SELECT on __inspire_session' });
  const got = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'use-case-catalog' } });
  assert.equal(got.status, 503, got.text.slice(0, 300));
  assert.equal(got.data.error, CATALOG_CHECK_FAILED_TEXT);
  assert.equal(got.text.includes('PERMISSION_DENIED'), false, 'no raw SQL error reaches the person');
  assert.equal(creates().length, 0);
});

test('a session whose catalog could not be saved, and recorded why, says so in plain words and starts no job, even when a derived catalog exists (REQ-077)', async () => {
  S.reset({ presentPaths: [CATALOG], notebookPresent: true, managers: [], runStates: {}, sessionLaunchers: { 7300: ME }, folders: { [`/Users/${ME}`]: { id: 11, writers: [ME] } },
    catalogPaths: { 7300: null }, catalogReasons: { 7300: 'workspace refused the write' } });
  const got = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'use-case-catalog' } });
  assert.equal(got.status, 409, got.text.slice(0, 300));
  assert.equal(got.data.error, CATALOG_UNSAVED_TEXT);
  assert.equal(got.text.includes('workspace refused'), false, 'the raw reason is not shown');
  assert.equal(creates().length, 0);
});

