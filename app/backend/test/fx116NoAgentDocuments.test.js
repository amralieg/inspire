// FX-116 (REQ-503): the documents are made in the App by the Generate docs wizard, so the job no longer makes them (DRY). The App stops
// sending `09_generation_options`, the documents job and POST /api/documents are gone, and the job keeps every other parameter, including
// `12_documents_languages`, which still picks the languages of the Markdown, CSV and JSON catalogs in the notebook.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const BACKEND = path.resolve(__dirname, '..');
const J = require('../lib/inspireJobParams');
const S = require('../lib/inspireSessionParams');
const P = require('../lib/routePolicy');

test('the documents job, its route and its policy entry are gone', () => {
  assert.equal(fs.existsSync(path.join(BACKEND, 'lib', 'documentJob.js')), false, 'lib/documentJob.js still exists');
  const server = fs.readFileSync(path.join(BACKEND, 'server.js'), 'utf8');
  assert.equal(/require\(\s*['"]\.\/lib\/documentJob['"]\s*\)/.test(server), false, 'server.js still loads the documents job');
  assert.equal(/app\.\w+\(\s*['"`]\/api\/documents['"`]/.test(server), false, 'server.js still registers /api/documents');
  assert.equal(Object.hasOwn(P.ROUTE_POLICY, 'POST /api/documents'), false, 'the route policy still lists POST /api/documents');
});

test('the job takes no generation options: not a widget key, dropped from a launch, not in the demo run or a session re-run', () => {
  assert.equal(J.INSPIRE_NOTEBOOK_WIDGET_KEYS.includes('09_generation_options'), false);
  const out = J.sanitizeInspireNotebookJobParams({ '00_business_name': 'Acme', '09_generation_options': 'PDF Catalog,Excel', '12_documents_languages': 'English,French' });
  assert.equal(Object.hasOwn(out, '09_generation_options'), false, 'a launch that still sends it does not pass it to the job');
  assert.equal(out['00_business_name'], 'Acme', 'the other parameters pass');
  assert.equal(out['12_documents_languages'], 'English,French', 'the catalog languages still pass');
  const demo = J.buildDemoInspireDiscoveryParams({ inspireDatabase: 'main.inspire', sessionId: '42' });
  assert.equal(Object.hasOwn(demo, '09_generation_options'), false, 'the demo run sends no generation options');
  const rerun = S.notebookParamsFromSessionForGenerateRun({ session_id: '42', business_name: 'Acme', generate_choices: 'PDF Catalog,Excel' }, '43');
  assert.equal(Object.hasOwn(rerun, '09_generation_options'), false, 'a re-run from a session sends no generation options');
});

test('the catalog languages widget key stays (the notebook still writes the Markdown, CSV and JSON catalogs per language)', () => {
  assert.equal(J.INSPIRE_NOTEBOOK_WIDGET_KEYS.includes('12_documents_languages'), true);
});
