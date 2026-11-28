'use strict';
// c51 (REQ-586) T-NB2-06: the App ships and publishes the split agent (inspire_discover.ipynb, inspire_generate.ipynb,
// inspire_lib.py) into one workspace folder, checks the lib against the INSPIRE_LIB_SHA256 both notebooks pin, and no
// longer ships or publishes dbx_inspire_ai_agent. The zip size stays guarded by c43ZipBudget.test.js (it reads APP_FILES).
// Stand-in files in a temp folder; the builder never edits this file.
const test = require('node:test');
const assert = require('node:assert');
const crypto = require('crypto');
const fs = require('fs');
const os = require('os');
const path = require('path');

const APP = path.resolve(__dirname, '..', '..');
const LEGACY = 'dbx_inspire_ai_agent';
const FOLDER = '/Shared/inspire-ai';
const NOTEBOOKS = ['inspire_discover', 'inspire_generate'];
const LIB = 'inspire_lib.py';
const sha = (b) => crypto.createHash('sha256').update(b).digest('hex');

function notebook(pin, operation) {
  const cells = [{ cell_type: 'markdown', metadata: {}, source: [`# ${operation}`] },
    { cell_type: 'code', metadata: {}, outputs: [], execution_count: null, source: [`INSPIRE_LIB_SHA256 = "${pin}"\n`, 'import os\n'] }];
  return Buffer.from(JSON.stringify({ cells, metadata: {}, nbformat: 4, nbformat_minor: 5 }));
}

function standIns({ tamper = false, pins } = {}) {
  const lib = Buffer.from('# inspire_lib stand-in\n__AGENT_VERSION__ = "v1.6.1"\ndef run(operation):\n    return operation\n');
  const [p1, p2] = pins || [sha(lib), sha(lib)];
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'c51-'));
  const files = { 'inspire_discover.ipynb': notebook(p1, 'Discover Use Cases'),
    'inspire_generate.ipynb': notebook(p2, 'Implement Use Cases'), [LIB]: tamper ? Buffer.concat([lib, Buffer.from('# tampered\n')]) : lib };
  for (const [name, data] of Object.entries(files)) fs.writeFileSync(path.join(dir, name), data);
  return { dir, files };
}

function fakeFetch() {
  const calls = [];
  const dbFetch = async (host, token, apiPath, options = {}) => {
    const body = options.body ? JSON.parse(options.body) : null;
    calls.push({ apiPath, body });
    return { ok: true, status: 200, json: async () => ({ object_type: 'NOTEBOOK' }), text: async () => '' };
  };
  return { calls, dbFetch };
}

function loadPublish() {
  const file = path.join(APP, 'backend', 'lib', 'agentPublish.js');
  assert.ok(fs.existsSync(file), 'backend/lib/agentPublish.js exports publishAgent, the one App path that publishes the split agent');
  return require(file);
}

function codeLines(rel) {
  return fs.readFileSync(path.join(APP, rel), 'utf8').split('\n')
    .filter((l) => !/^\s*(\/\/|\*|\/\*|#)/.test(l)).filter((l) => l.includes(LEGACY)).map((l) => `${rel}: ${l.trim().slice(0, 120)}`);
}

test('T-NB2-06a the App zip ships the three agent files and not the single notebook', () => {
  const { APP_FILES } = require('../lib/appPaths');
  for (const f of ['inspire_discover.ipynb', 'inspire_generate.ipynb', LIB]) assert.ok(APP_FILES.includes(f), `APP_FILES ships ${f}`);
  assert.deepStrictEqual(APP_FILES.filter((f) => f.includes(LEGACY)), [], 'APP_FILES no longer ships dbx_inspire_ai_agent.ipynb');
});

test('T-NB2-06b publishAgent imports the two notebooks and the lib into one folder, byte for byte', async () => {
  const { publishAgent } = loadPublish();
  const { dir, files } = standIns();
  const { calls, dbFetch } = fakeFetch();
  const out = await publishAgent({ dbFetch, host: 'h', token: 't', folder: FOLDER, dir });
  const imports = calls.filter((c) => c.apiPath === '/api/2.0/workspace/import').map((c) => c.body);
  assert.deepStrictEqual(imports.map((b) => b.path).sort(), [...NOTEBOOKS.map((n) => `${FOLDER}/${n}`), `${FOLDER}/${LIB}`].sort());
  for (const n of NOTEBOOKS) {
    const b = imports.find((i) => i.path === `${FOLDER}/${n}`);
    assert.strictEqual(b.format, 'JUPYTER', n);
    assert.strictEqual(sha(Buffer.from(b.content, 'base64')), sha(files[`${n}.ipynb`]), `${n} is uploaded byte for byte`);
  }
  const lib = imports.find((i) => i.path === `${FOLDER}/${LIB}`);
  assert.ok(['AUTO', 'RAW'].includes(lib.format), 'the lib is a workspace file, not a notebook');
  assert.strictEqual(sha(Buffer.from(lib.content, 'base64')), sha(files[LIB]), 'the lib is uploaded byte for byte');
  assert.strictEqual(out.path, `${FOLDER}/inspire_discover`, 'the returned path is a notebook in the folder c50 routing launches both from');
  assert.deepStrictEqual(calls.filter((c) => JSON.stringify(c).includes(LEGACY)), [], 'no workspace call names dbx_inspire_ai_agent');
});

test('T-NB2-06c a lib that is not the pinned one, or notebooks that pin two libs, are refused before any import', async () => {
  const { publishAgent } = loadPublish();
  const s = standIns();
  for (const bad of [standIns({ tamper: true }), standIns({ pins: [sha(fs.readFileSync(path.join(s.dir, LIB))), '0'.repeat(64)] })]) {
    const { calls, dbFetch } = fakeFetch();
    await assert.rejects(publishAgent({ dbFetch, host: 'h', token: 't', folder: FOLDER, dir: bad.dir }), /INSPIRE_LIB_SHA256/);
    assert.deepStrictEqual(calls.filter((c) => c.apiPath === '/api/2.0/workspace/import'), [], 'nothing was imported');
  }
});

test('T-NB2-06d no App ship, publish or launch path still names dbx_inspire_ai_agent', () => {
  const sites = ['backend/server.js', 'backend/lib/appShell.js', 'backend/lib/appPaths.js', 'scripts/bundle-agent-notebook.mjs',
    'databricks.yml', 'dbx_inspire_after_demo.py', 'frontend/src/pages/ConfigPage.jsx'];
  assert.deepStrictEqual(sites.flatMap(codeLines), []);
  assert.match(fs.readFileSync(path.join(APP, 'backend', 'server.js'), 'utf8'), /publishAgent\(/, 'server.js publishes through publishAgent');
});
