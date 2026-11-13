// rc13 strategy PDF (REQ-121, REQ-077/097): the on-demand document buttons are never refused by a PDF already in the run folder,
// and the artifact tree helper flattens the opened folders.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

test('a PDF already in the run folder never disables the strategy PDF or the use case catalog: each is made any time (REQ-097)', async () => {
  const D = await lib('documentActions.js');
  assert.equal(D.documentBlockedText, undefined, 'no document button is refused by a PDF already in the folder');
  assert.equal(D.PDF_MADE_TEXT, undefined, 'the "already made its PDF" refusal is gone');
  assert.equal(D.DOCUMENT_ACTIONS['strategy-document'].label, 'Create strategy document');
  assert.equal(D.DOCUMENT_ACTIONS['use-case-catalog'].label, 'Create use case catalog');
});

test('the artifact tree is flattened through the opened folders', async () => {
  const A = await lib('artifactFiles.js');
  const root = [{ name: 'run.log', path: 'run.log' }, { is_directory: true, path: 'docs' }];
  const tree = { docs: { files: [{ name: 'strategy.pdf', path: 'docs/strategy.pdf' }, { is_directory: true, path: 'docs/deep' }] },
    'docs/deep': { files: [{ name: 'catalog.xlsx', path: 'docs/deep/catalog.xlsx' }] } };
  const files = A.artifactTreeFiles(root, tree).map((f) => f.name);
  assert.deepEqual(files, ['run.log', 'strategy.pdf', 'catalog.xlsx']);
  assert.deepEqual(A.artifactTreeFiles(null, undefined), []);
});
