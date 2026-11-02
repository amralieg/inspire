const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { NOTEBOOK_CANDIDATES } = require('../lib/appShell');

const IMPORT_LIMIT = 10_000_000;

test('the bundled agent notebook fits the workspace import the App publishes it with, under the 10 MB request limit', () => {
  const file = NOTEBOOK_CANDIDATES.find((candidate) => fs.existsSync(candidate));
  assert.ok(file, 'the App carries the agent notebook');
  const body = JSON.stringify({
    path: '/Shared/inspire-ai/dbx_inspire_ai_agent', format: 'JUPYTER', content: fs.readFileSync(file).toString('base64'), language: 'PYTHON', overwrite: true,
  });
  assert.ok(Buffer.byteLength(body) < IMPORT_LIMIT, `the import request is ${Buffer.byteLength(body)} bytes, over the 10 MB workspace import limit`);
  const server = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /'\/api\/2\.0\/workspace\/import', \{\n\s+method: 'POST',\n\s+body: JSON\.stringify\(\{\n\s+path: importPath,\n\s+format: importFormat,\n\s+content: base64Content,/,
    'the App publishes the notebook in one workspace import request, which is what the limit applies to');
  const packaging = fs.readFileSync(path.resolve(__dirname, '..', '..', 'scripts', 'package-for-workspace.sh'), 'utf8');
  assert.match(packaging, /10MB workspace import limit/);
});
