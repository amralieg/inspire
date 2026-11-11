const test = require('node:test');
const assert = require('node:assert/strict');
const { documentRunParams, englishCatalogPath, DOCUMENT_KINDS } = require('../lib/documentJob');

const SESSION = {
  session_id: '9000000000000009',
  inspire_database: 'inspire_kinds._inspire',
  business_name: 'v15 Water Utility rc7',
  generation_path: '/Workspace/Users/me@example.com/inspire_out',
};
const CATALOG = '/Workspace/Users/me@example.com/inspire_out/v15_water_utility_rc7/docs/v15 Water Utility rc7-dbx_inspire.json';

function body(overrides = {}) {
  return { kind: 'use-case-catalog', ...SESSION, ...overrides };
}

test('the English catalog of a session is the one Discover wrote under its business folder (REQ-077)', () => {
  assert.equal(englishCatalogPath('/Workspace/out', 'v15 Water Utility rc7'), '/Workspace/out/v15_water_utility_rc7/docs/v15 Water Utility rc7-dbx_inspire.json');
  assert.equal(englishCatalogPath('/Workspace/out/', 'Acme'), '/Workspace/out/acme/docs/Acme-dbx_inspire.json', 'a trailing slash is not doubled and the folder is sanitized');
  assert.equal(englishCatalogPath('/Workspace/out', '!!!'), '/Workspace/out/_/docs/!!!-dbx_inspire.json', 'an unusable business name keeps the notebook fallback folder');
});

test('a use case catalog re-runs the docs-only job against the session folder and its own catalog (REQ-077)', () => {
  const { params, document } = documentRunParams(body());
  assert.equal(document.kind, 'use-case-catalog');
  assert.equal(params['01_uc_metadata'], CATALOG, 'the job reads the English catalog the session wrote');
  assert.equal(params['09_generation_options'], 'PDF Catalog');
  assert.equal(params['14_session_id'], SESSION.session_id);
  assert.equal(params['02_inspire_database'], SESSION.inspire_database);
  assert.equal(params['00_business_name'], SESSION.business_name);
  assert.equal(params['11_generation_path'], SESSION.generation_path, 'the session folder is passed unchanged: the notebook adds the business folder once');
  assert.equal(params['15_operation'], 'Discover Use Cases');
});

test('the session folder is used as stored, even when its last folder already has the business name (REQ-077)', () => {
  const { params } = documentRunParams(body({ generation_path: '/Workspace/out/acme' }));
  assert.equal(params['11_generation_path'], '/Workspace/out/acme');
  assert.equal(params['01_uc_metadata'], '/Workspace/out/acme/v15_water_utility_rc7/docs/v15 Water Utility rc7-dbx_inspire.json');
});

test('a strategy document offers PDF or PPTX, and the presentation option is the only one it sends', () => {
  assert.equal(documentRunParams(body({ kind: 'strategy-document', format: 'PDF' })).params['09_generation_options'], 'PDF Catalog');
  assert.equal(documentRunParams(body({ kind: 'strategy-document', format: 'PPTX' })).params['09_generation_options'], 'Presentation');
  assert.throws(() => documentRunParams(body({ kind: 'strategy-document', format: 'DOCX' })), /format/);
  assert.throws(() => documentRunParams(body({ kind: 'strategy-document' })), /format/, 'a strategy document must name its format');
});

test('an unknown kind, a relative session folder, and a session id that is not numeric are refused (must-exclude)', () => {
  assert.throws(() => documentRunParams(body({ kind: 'deck' })), /kind/);
  assert.throws(() => documentRunParams(body({ generation_path: 'inspire_output' })), /absolute/, 'a relative folder would resolve somewhere else');
  assert.throws(() => documentRunParams(body({ session_id: 'abc' })), /session/);
  assert.throws(() => documentRunParams(body({ generation_path: '' })), /generation_path/);
  assert.throws(() => documentRunParams(body({ business_name: '' })), /business_name/);
});

test('the kinds are exactly the three Review document buttons', () => {
  assert.deepEqual(Object.keys(DOCUMENT_KINDS).sort(), ['excel-workbook', 'strategy-document', 'use-case-catalog']);
});

test('the rebuild regenerates every language the session was created with, English first, and refuses a language the notebook does not offer (REQ-077)', () => {
  const two = documentRunParams(body({ output_language: 'English,Arabic' }));
  assert.equal(two.params['12_documents_languages'], 'English,Arabic');
  assert.equal(documentRunParams(body({ output_language: 'Arabic, English' })).params['12_documents_languages'], 'English,Arabic', 'English is always first');
  assert.equal(documentRunParams(body({ output_language: '' })).params['12_documents_languages'], 'English', 'no language stored: English');
  assert.throws(() => documentRunParams(body({ output_language: 'Klingon' })), /Klingon/);
});
