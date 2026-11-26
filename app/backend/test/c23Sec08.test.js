const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const H = require('../lib/hostedRun');
const { shellFolder, workspaceOf, fakePageChild } = require('./support/hostedShell');

const ROOT = '/Workspace/Users/someone/hosted/n01-u05-real/v1';
const record = { id: 'n01-u05-real', source: ROOT, version: 1, warehouse_id: 'wh2', page: 'n01_u05', published_at: '2026-10-31T05:00:00Z' };
const SOURCES = ['main.sales.orders', 'main.sales.customers'];

function get(base, url) {
  const { hostname, port } = new URL(base);
  return new Promise((resolve, reject) => {
    http.get({ host: hostname, port, path: url, headers: { 'sec-fetch-dest': 'document', 'x-forwarded-access-token': 't' } }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, text }));
    }).on('error', reject);
  });
}

async function serve(sources) {
  const { files } = shellFolder(ROOT, { settings: { sources } });
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'c23-sec08-'));
  const up = http.createServer((_req, res) => res.end('ok'));
  await new Promise((r) => up.listen(0, '127.0.0.1', r));
  const checks = [];
  const hosted = H.createHostedRun({
    spawn: () => fakePageChild(up.address().port), pickPython: async () => '/opt/venv/bin/python3', tmpRoot: tmp, env: { PATH: '/usr/bin' },
    checkHealth: async () => true, pause: async () => {}, files: () => workspaceOf(files),
  });
  hosted.setListed([{ hosted: record, owners: [], session_id: '77', use_case_id: 'n01-u05' }], { key: 'k' });
  hosted.useSessionCheck(async (_req, sessionId, scope) => { checks.push({ sessionId, scope }); return null; });
  const app = express();
  app.all('/run/:id/{*rest}', hosted.proxy);
  const server = await new Promise((r) => { const s = app.listen(0, '127.0.0.1', () => r(s)); });
  return { checks, base: `http://127.0.0.1:${server.address().port}`, close: async () => { server.close(); up.close(); hosted.stopAll(); } };
}

// SEC-08: the viewer gate is told the tables the page itself reads (its `sources` setting), not only the session id.
test('SEC-08: the session check receives the tables the page reads', async () => {
  const s = await serve(SOURCES);
  try {
    const res = await get(s.base, `/run/${record.id}/`);
    assert.equal(res.status, 200, res.text);
    assert.equal(s.checks.length >= 1, true);
    assert.deepEqual(s.checks[0].scope.tables, SOURCES);
  } finally { await s.close(); }
});
