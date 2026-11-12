// rc13 strategy PDF (REQ-121, REQ-077/097): the on-demand document buttons never write a second PDF Catalog into a run folder
// that already holds one, and the artifact tree helpers find the PDF wherever it sits.
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

test('a second PDF Catalog is refused when the run folder already holds one, for the strategy PDF and the use case catalog', async () => {
  const D = await lib('documentActions.js');
  assert.equal(D.documentBlockedText('strategy-document', 'PDF', true), D.PDF_MADE_TEXT, 'the strategy PDF is refused once a PDF exists');
  assert.equal(D.documentBlockedText('use-case-catalog', '', true), D.PDF_MADE_TEXT, 'the use case catalog writes the same PDF Catalog option');
  assert.equal(D.documentBlockedText('strategy-document', 'PPTX', true), '', 'the PPTX is never refused by the PDF rule');
  assert.equal(D.documentBlockedText('excel-workbook', '', true), '', 'the Excel workbook is never refused by the PDF rule');
  assert.equal(D.documentBlockedText('strategy-document', 'PDF', false), '', 'with no PDF in the folder the PDF is made');
  assert.equal(D.documentBlockedText('use-case-catalog', '', false), '');
});

test('the artifact tree is flattened through the opened folders, and a PDF anywhere in it counts as made', async () => {
  const A = await lib('artifactFiles.js');
  const root = [{ name: 'run.log', path: 'run.log' }, { is_directory: true, path: 'docs' }];
  const tree = { docs: { files: [{ name: 'strategy.pdf', path: 'docs/strategy.pdf' }, { is_directory: true, path: 'docs/deep' }] },
    'docs/deep': { files: [{ name: 'catalog.xlsx', path: 'docs/deep/catalog.xlsx' }] } };
  const files = A.artifactTreeFiles(root, tree).map((f) => f.name);
  assert.deepEqual(files, ['run.log', 'strategy.pdf', 'catalog.xlsx']);
  assert.equal(A.hasPdfArtifact(A.artifactTreeFiles(root, tree)), true);
  assert.equal(A.hasPdfArtifact(A.artifactTreeFiles([{ name: 'run.json', path: 'run.json' }], {})), false, 'a run with no PDF has none');
  assert.deepEqual(A.artifactTreeFiles(null, undefined), []);
});
