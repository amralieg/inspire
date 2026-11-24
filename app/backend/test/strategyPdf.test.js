// The artifact tree helper flattens the opened folders (the document buttons that used to share this file went with FX-116).
const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

test('the artifact tree is flattened through the opened folders', async () => {
  const A = await lib('artifactFiles.js');
  const root = [{ name: 'run.log', path: 'run.log' }, { is_directory: true, path: 'docs' }];
  const tree = { docs: { files: [{ name: 'strategy.pdf', path: 'docs/strategy.pdf' }, { is_directory: true, path: 'docs/deep' }] },
    'docs/deep': { files: [{ name: 'catalog.xlsx', path: 'docs/deep/catalog.xlsx' }] } };
  const files = A.artifactTreeFiles(root, tree).map((f) => f.name);
  assert.deepEqual(files, ['run.log', 'strategy.pdf', 'catalog.xlsx']);
  assert.deepEqual(A.artifactTreeFiles(null, undefined), []);
});
