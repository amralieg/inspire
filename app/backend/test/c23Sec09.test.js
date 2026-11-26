const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const H = require('../lib/hostedRun');
const { shellFolder, workspaceOf, fakePageChild } = require('./support/hostedShell');

const ROOT = '/Workspace/Users/someone/hosted/n01-u05-real/v1';
const record = { id: 'n01-u05-real', source: ROOT, version: 1, warehouse_id: 'wh2', page: 'n01_u05', published_at: '2026-10-31T05:00:00Z' };

function hostedRun() {
  const spawned = [];
  const hosted = H.createHostedRun({
    spawn: () => { const child = fakePageChild(4321); spawned.push(child); return child; },
    pickPython: async () => '/opt/venv/bin/python3',
    tmpRoot: fs.mkdtempSync(path.join(os.tmpdir(), 'c23-sec09-')),
    env: { PATH: '/usr/bin' },
    checkHealth: async () => true,
    pause: async () => {},
  });
  return { hosted, spawned };
}

async function serve(hosted) {
  const app = express();
  app.all('/run/:id/{*rest}', hosted.proxy);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise((resolve) => server.close(resolve)) };
}

function directives(csp) {
  return Object.fromEntries(csp.split(';').map((part) => part.trim().split(/\s+/)).filter((words) => words[0]).map(([name, ...values]) => [name, values]));
}

// SEC-09: page JSON reaches only the verified shell, so the policy must stop any script it could inject from running.
function assertStrictPolicy(csp) {
  const d = directives(csp);
  const scripts = d['script-src'] || d['default-src'];
  assert.ok(scripts && scripts.length, `the policy names where scripts may come from: ${csp}`);
  for (const value of scripts) {
    assert.ok(!["'unsafe-inline'", "'unsafe-eval'", "'unsafe-hashes'", "'strict-dynamic'", '*', 'data:', 'blob:', 'http:', 'https:'].includes(value),
      `script-src allows ${value}: ${csp}`);
    assert.ok(!value.includes('*'), `script-src has a wildcard source ${value}: ${csp}`);
  }
  assert.deepEqual(d['object-src'], ["'none'"], csp);
  assert.ok(["'none'", "'self'"].includes((d['base-uri'] || [])[0]) && d['base-uri'].length === 1, `base-uri is 'none' or 'self': ${csp}`);
  assert.deepEqual(d['frame-ancestors'], ["'self'"], csp);
}

test('SEC-09 (a): every hosted policy keeps scripts to the page assets and the boot guard hash, with no plugin, base or framing hole', async () => {
  const csp = H.hostedCsp('https://inspire.example.com', record.id);
  assertStrictPolicy(csp);
  assert.deepEqual(directives(csp)['script-src'], ['https://inspire.example.com/run/n01-u05-real/assets/', `'${require('../lib/bootGuardCsp').BOOT_GUARD_SCRIPT_HASH}'`]);
  assertStrictPolicy(H.hostedCsp('', record.id));
  assertStrictPolicy(H.hostedCsp('https://inspire.example.com', '../bad'));
  assertStrictPolicy(H.sameOriginCsp());

  const { hosted } = hostedRun();
  const s = await serve(hosted);
  try {
    const got = await fetch(`${s.base}/run/${record.id}/`, { headers: { 'x-forwarded-access-token': 'user-token', host: 'inspire.example.com' } });
    assertStrictPolicy(got.headers.get('content-security-policy'));
  } finally {
    await s.close();
  }
});

test('SEC-09 (b): a request from an opaque origin (Origin: null) gets no cross-origin read permission', async () => {
  const { hosted } = hostedRun();
  const s = await serve(hosted);
  try {
    for (const method of ['GET', 'POST', 'OPTIONS']) {
      const got = await fetch(`${s.base}/run/${record.id}/api/app`, { method, headers: { origin: 'null', 'x-forwarded-access-token': 'user-token' } });
      const granted = [...got.headers.keys()].filter((name) => name.startsWith('access-control-'));
      assert.deepEqual(granted, [], `${method} answered ${granted.map((n) => `${n}: ${got.headers.get(n)}`).join(', ')}`);
    }
  } finally {
    await s.close();
  }
});

test('SEC-09 (c): a page folder carrying an extra script file is refused before anything starts', async () => {
  for (const extra of ['static/assets/extra.js', 'pages/extra.js', 'static/inject.html']) {
    const { files } = shellFolder(ROOT);
    files[`${ROOT}/${extra}`] = Buffer.from('fetch("/run/n01-u05-real/api/app")');
    const { hosted, spawned } = hostedRun();
    await assert.rejects(() => hosted.ensure({ record }, workspaceOf(files)), (err) => err.message.includes(`${extra} is not part of the App shell`));
    assert.equal(spawned.length, 0, extra);
  }
});
