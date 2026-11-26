const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const H = require('../lib/hostedRun');
const { shellFolder, workspaceOf, fakePageChild } = require('./support/hostedShell');

const ROOT = '/Workspace/Users/someone/hosted/n01-u05-real/v1';
const record = { id: 'n01-u05-real', source: ROOT, version: 1, warehouse_id: 'wh2', page: 'n01_u05', published_at: '2026-10-31T05:00:00Z' };
const entry = { record };

function build(files) {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c23-sec01-'));
  const spawned = [];
  const hosted = H.createHostedRun({
    spawn: (cmd, args, opts) => { const child = fakePageChild(4321); spawned.push({ cmd, args, opts, child }); return child; },
    pickPython: async () => '/opt/venv/bin/python3',
    tmpRoot: tmp,
    env: { PATH: '/usr/bin' },
    checkHealth: async () => true,
    pause: async () => {},
  });
  return { hosted, spawned, tmp, ws: workspaceOf(files) };
}

// SEC-01: the synced folder is code Inspire would run beside its own credentials; it runs only when it is the bundled shell.
test('SEC-01: the untouched bundled shell folder is synced and started', async () => {
  const { files } = shellFolder(ROOT);
  const { hosted, spawned, ws } = build(files);
  const run = await hosted.ensure(entry, ws);
  assert.equal(run.state, 'ready');
  assert.equal(spawned.length, 1);
});

test('SEC-01: a synced shell file changed after the App wrote it is refused, nothing is started, and the reason names the file', async () => {
  const { files } = shellFolder(ROOT);
  files[`${ROOT}/app.py`] = Buffer.concat([files[`${ROOT}/app.py`], Buffer.from('\nimport os; os.system("id")\n')]);
  const { hosted, spawned, ws } = build(files);
  await assert.rejects(() => hosted.ensure(entry, ws), /app\.py/);
  assert.equal(spawned.length, 0);
});

test('SEC-01: a planted Python file next to the shell is refused', async () => {
  const { files } = shellFolder(ROOT);
  files[`${ROOT}/sitecustomize.py`] = Buffer.from('import os\n');
  const { hosted, spawned, ws } = build(files);
  await assert.rejects(() => hosted.ensure(entry, ws), /sitecustomize\.py/);
  assert.equal(spawned.length, 0);
});

test('SEC-01: a shell file that is missing is refused', async () => {
  const { files } = shellFolder(ROOT);
  delete files[`${ROOT}/shell_core.py`];
  const { hosted, spawned, ws } = build(files);
  await assert.rejects(() => hosted.ensure(entry, ws), /shell_core\.py/);
  assert.equal(spawned.length, 0);
});
