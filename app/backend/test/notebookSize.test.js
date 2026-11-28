const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const { NOTEBOOK_CANDIDATES } = require('../lib/appShell');

const IMPORT_LIMIT = 10_000_000;

test('each bundled agent notebook fits the workspace import the App publishes it with, under the 10 MB request limit', () => {
  for (const name of ['inspire_discover', 'inspire_generate']) {
    const file = NOTEBOOK_CANDIDATES.map((candidate) => path.join(path.dirname(candidate), `${name}.ipynb`)).find((candidate) => fs.existsSync(candidate));
    assert.ok(file, `the App carries the ${name} notebook`);
    const body = JSON.stringify({
      path: `/Shared/inspire-ai/${name}`, format: 'JUPYTER', content: fs.readFileSync(file).toString('base64'), language: 'PYTHON', overwrite: true,
    });
    assert.ok(Buffer.byteLength(body) < IMPORT_LIMIT, `the ${name} import request is ${Buffer.byteLength(body)} bytes, over the 10 MB workspace import limit`);
  }
  const lib = path.join(path.dirname(NOTEBOOK_CANDIDATES[0]), 'inspire_lib.py');
  assert.ok(fs.existsSync(lib), 'the App carries inspire_lib.py');
  const libBody = JSON.stringify({ path: '/Shared/inspire-ai/inspire_lib.py', format: 'AUTO', content: fs.readFileSync(lib).toString('base64'), overwrite: true });
  assert.ok(Buffer.byteLength(libBody) < IMPORT_LIMIT, `the inspire_lib.py import request is ${Buffer.byteLength(libBody)} bytes, over the 10 MB workspace import limit`);
  const publish = fs.readFileSync(path.resolve(__dirname, '..', 'lib', 'agentPublish.js'), 'utf8');
  assert.match(publish, /'\/api\/2\.0\/workspace\/import', \{ method: 'POST', body: JSON\.stringify\(\{ \.\.\.body, overwrite: true \}\) \}/,
    'the App publishes each agent file in one workspace import request, which is what the limit applies to');
  assert.match(publish, /content: files\[`\$\{n\}\.ipynb`\]\.toString\('base64'\)/, 'each notebook goes in one import body');
  assert.match(publish, /content: files\[AGENT_LIB\]\.toString\('base64'\)/, 'the lib goes in one import body');
  const packaging = fs.readFileSync(path.resolve(__dirname, '..', '..', 'scripts', 'package-for-workspace.sh'), 'utf8');
  assert.match(packaging, /10MB workspace import limit/);
});
