const test = require('node:test');
const assert = require('node:assert/strict');
const { pathToFileURL } = require('node:url');
const path = require('node:path');

const libUrl = pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'documentActions.js')).href;
const load = () => import(libUrl);

test('the English catalog is found in the loaded listing, inside a loaded folder, and never a translated copy (REQ-077)', async () => {
  const lib = await load();
  const tree = { 'out/docs': { files: [
    { name: 'Acme-dbx_inspire.json', path: 'out/docs/Acme-dbx_inspire.json' },
    { name: 'Acme-dbx_inspire_ar.json', path: 'out/docs/Acme-dbx_inspire_ar.json' },
  ] } };
  const root = [{ name: 'docs', path: 'out/docs', is_directory: true }, { name: 'Acme-dbx_inspire_ar.json', path: 'out/Acme-dbx_inspire_ar.json' }];
  assert.equal(lib.englishCatalogPath(root, tree), 'out/docs/Acme-dbx_inspire.json');
  assert.equal(lib.englishCatalogPath([{ name: 'Acme-dbx_inspire_ar.json', path: 'x' }], {}), null, 'nothing loaded: the buttons say so instead of guessing');
});

test('the request carries the session its documents are rebuilt beside (REQ-077)', async () => {
  const lib = await load();
  assert.deepEqual(lib.documentRunBody({ kind: 'strategy-document', format: 'PPTX', sessionId: 42, inspireDatabase: 'c.s',
    businessName: 'Acme', generationPath: '/Workspace/out', catalogPath: '/Workspace/out/docs/Acme-dbx_inspire.json', outputLanguage: 'English,Arabic' }), {
    kind: 'strategy-document', format: 'PPTX', session_id: '42', inspire_database: 'c.s', business_name: 'Acme',
    generation_path: '/Workspace/out', catalog_json_path: '/Workspace/out/docs/Acme-dbx_inspire.json', output_language: 'English,Arabic' });
  assert.equal('format' in lib.documentRunBody({ kind: 'use-case-catalog', sessionId: 1 }), false);
});

test('a document job reads running until its run ends, then done or failed (REQ-077)', async () => {
  const lib = await load();
  assert.equal(lib.documentJobState({ life_cycle_state: 'RUNNING' }), 'running');
  assert.equal(lib.documentJobState({ life_cycle_state: 'PENDING' }), 'running');
  assert.equal(lib.documentJobState({ life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' }), 'done');
  assert.equal(lib.documentJobState({ life_cycle_state: 'TERMINATED', result_state: 'FAILED' }), 'failed');
  assert.equal(lib.documentJobState({ life_cycle_state: 'INTERNAL_ERROR' }), 'failed');
});

test('the catalog button is named Create, the way Amr asked, because the button rebuilds the catalog on demand (REQ-077)', async () => {
  const lib = await load();
  assert.equal(lib.DOCUMENT_ACTIONS['use-case-catalog'].label, 'Create use case catalog');
  assert.equal(lib.DOCUMENT_ACTIONS['strategy-document'].label, 'Create strategy document');
  assert.deepEqual(lib.DOCUMENT_ACTIONS['strategy-document'].formats, ['PDF', 'PPTX']);
});
