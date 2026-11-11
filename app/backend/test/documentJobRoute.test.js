const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');
const frontendLib = require('node:url');
const path = require('node:path');

test.after(() => S.stopServer());

const ME = 'editor@example.com';
const OUT = `/Users/${ME}/out`;
const CATALOG = `${OUT}/Acme-dbx_inspire.json`;
const BASE = { session_id: '7300', inspire_database: S.APP_DB, business_name: 'Acme', generation_path: OUT, catalog_json_path: CATALOG };
const creates = () => S.state.calls.filter((c) => c.path === '/api/2.1/jobs/create');

async function documentJobState(runId) {
  const lib = await import(frontendLib.pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'documentActions.js')).href);
  const run = await S.request('GET', `/api/run/${runId}`, { person: ME });
  assert.equal(run.status, 200, run.text.slice(0, 300));
  return lib.documentJobState(run.data);
}

test('the Create use case catalog button launches a docs-only run with the PDF catalog, the session and every language, then reads done when it ends (REQ-077)', async () => {
  S.reset({ notebookPresent: true, managers: [], runStates: {}, sessionLaunchers: { 7300: ME }, folders: { [`/Users/${ME}`]: { id: 11, writers: [ME] } } });
  const got = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'use-case-catalog', output_language: 'English,Arabic' } });
  assert.equal(got.status, 200, got.text.slice(0, 300));
  assert.deepEqual(got.data.document, { kind: 'use-case-catalog', option: 'PDF Catalog', session_id: '7300', languages: ['English', 'Arabic'] });
  assert.equal(creates().length, 1, 'one job is created');
  const params = S.state.createdJob.tasks[0].notebook_task.base_parameters;
  assert.equal(params['09_generation_options'], 'PDF Catalog');
  assert.equal(params['01_uc_metadata'], CATALOG, 'the rebuild starts from the English catalog of this session');
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
  S.reset({ notebookPresent: true, managers: [], runStates: {}, sessionLaunchers: { 7300: ME }, folders: { [`/Users/${ME}`]: { id: 11, writers: [ME] } } });
  const pptx = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'strategy-document', format: 'PPTX' } });
  assert.equal(pptx.status, 200, pptx.text.slice(0, 300));
  assert.equal(pptx.data.document.option, 'Presentation');
  assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['09_generation_options'], 'Presentation');
  const pdf = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'strategy-document', format: 'PDF' } });
  assert.equal(pdf.status, 200, pdf.text.slice(0, 300));
  assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['09_generation_options'], 'PDF Catalog');
});

test('a document request without a session or with a catalog that is not the English one starts no job (must-exclude)', async () => {
  S.reset({ notebookPresent: true, managers: [], runStates: {}, sessionLaunchers: { 7300: ME }, folders: { [`/Users/${ME}`]: { id: 11, writers: [ME] } } });
  const noSession = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, session_id: '', kind: 'use-case-catalog' } });
  assert.ok([400, 403].includes(noSession.status), noSession.text.slice(0, 300));
  const translated = await S.request('POST', '/api/documents', { person: ME, body: { ...BASE, kind: 'use-case-catalog', catalog_json_path: CATALOG.replace('dbx_inspire', 'dbx_inspire_ar') } });
  assert.equal(translated.status, 400, translated.text.slice(0, 300));
  assert.equal(creates().length, 0);
});
