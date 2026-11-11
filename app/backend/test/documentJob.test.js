const test = require('node:test');
const assert = require('node:assert/strict');
const { documentRunParams, DOCUMENT_KINDS } = require('../lib/documentJob');

const SESSION = {
  session_id: '1527863599011743540',
  inspire_database: 'inspire_kinds._inspire',
  business_name: 'v15 Water Utility rc7',
  generation_path: '/Workspace/Users/me@example.com/inspire_out',
  catalog_json_path: '/Workspace/Users/me@example.com/inspire_out/v15_water_utility_rc7/docs/v15 Water Utility rc7-dbx_inspire.json',
};

function body(overrides = {}) {
  return { kind: 'use-case-catalog', ...SESSION, ...overrides };
}

test('a use case catalog re-runs the docs-only job with the PDF option and the session as its inputs', () => {
  const { params, document } = documentRunParams(body());
  assert.equal(document.kind, 'use-case-catalog');
  assert.equal(params['01_uc_metadata'], SESSION.catalog_json_path, 'the stored catalog is the job input (docs-only mode)');
  assert.equal(params['09_generation_options'], 'PDF Catalog');
  assert.equal(params['14_session_id'], SESSION.session_id);
  assert.equal(params['02_inspire_database'], SESSION.inspire_database);
  assert.equal(params['00_business_name'], SESSION.business_name);
  assert.equal(params['11_generation_path'], SESSION.generation_path, 'the files land beside the session they rebuild');
  assert.equal(params['15_operation'], 'Discover Use Cases');
});

test('a strategy document offers PDF or PPTX, and the presentation option is the only one it sends', () => {
  assert.equal(documentRunParams(body({ kind: 'strategy-document', format: 'PDF' })).params['09_generation_options'], 'PDF Catalog');
  assert.equal(documentRunParams(body({ kind: 'strategy-document', format: 'PPTX' })).params['09_generation_options'], 'Presentation');
  assert.throws(() => documentRunParams(body({ kind: 'strategy-document', format: 'DOCX' })), /format/);
  assert.throws(() => documentRunParams(body({ kind: 'strategy-document' })), /format/, 'a strategy document must name its format');
});

test('an unknown kind, a path that is not the English catalog, and a session id that is not numeric are refused (must-exclude)', () => {
  assert.throws(() => documentRunParams(body({ kind: 'deck' })), /kind/);
  assert.throws(() => documentRunParams(body({ catalog_json_path: 'docs/catalog.json' })), /absolute/);
  assert.throws(() => documentRunParams(body({ catalog_json_path: '/Workspace/x/Acme-dbx_inspire_ar.json' })), /English/,
    'a translated copy is not regenerated from; the English catalog is the input');
  assert.throws(() => documentRunParams(body({ session_id: 'abc' })), /session/);
  assert.throws(() => documentRunParams(body({ generation_path: '' })), /generation_path/);
});

test('the kinds are exactly the two Review buttons', () => {
  assert.deepEqual(Object.keys(DOCUMENT_KINDS).sort(), ['strategy-document', 'use-case-catalog']);
});
