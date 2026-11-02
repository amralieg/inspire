const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const express = require('express');
const H = require('../lib/hostedRun');
const { HOSTED_OWNER: OWNER, shellFolder, workspaceOf } = require('./support/hostedShell');

const ROOT = '/Workspace/Users/someone/hosted/n01-u05-real/v1';

function get(base, url, headers = {}) {
  return new Promise((resolve, reject) => {
    http.get(`${base}${url}`, { headers }, (res) => {
      let text = '';
      res.on('data', (d) => { text += d; });
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, text }));
    }).on('error', reject);
  });
}

const gone = (pid) => {
  try {
    process.kill(pid, 0);
    return false;
  } catch {
    return true;
  }
};

test('the real App shell from the bundled notebook runs as a page Inside Inspire through the proxy, with the forwarded identity, and its process ends', async (t) => {
  const python = await H.pythonFor(process.env.PATH, process.cwd());
  if (!python) {
    t.skip('no python3 or python on PATH imports fastapi and uvicorn, so the real page cannot run on this machine');
    return;
  }
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hosted-shell-'));
  const { page, files } = shellFolder(ROOT);
  const hosted = H.createHostedRun({
    files: () => workspaceOf(files),
    tmpRoot: tmp,
    env: { PATH: process.env.PATH, HOME: os.homedir(), LANG: 'C.UTF-8', DATABRICKS_HOST: 'https://workspace.example.com',
      DATABRICKS_CLIENT_ID: 'never-given', DATABRICKS_CLIENT_SECRET: 'never-given', DATABRICKS_TOKEN: 'never-given' },
    pickPython: async () => python,
  });
  const app = express();
  app.all('/run/:id/{*rest}', (req, _res, next) => { req.dbHost = 'https://workspace.example.com'; req.dbToken = 'sp-token'; next(); }, hosted.proxy);
  const server = await new Promise((resolve) => { const s = app.listen(0, '127.0.0.1', () => resolve(s)); });
  const base = `http://127.0.0.1:${server.address().port}`;
  const record = { id: 'n01-u05-real', source: ROOT, version: 1, warehouse_id: 'wh2', page: page.id, published_at: '2026-10-31T05:00:00Z' };
  const viewer = { 'x-forwarded-access-token': 'fake-user-token', 'x-forwarded-email': OWNER, 'x-forwarded-preferred-username': 'Owner' };
  let pid = null;
  try {
    hosted.setListed([{ kind: 'inspire', id: record.id, hosted: record, owners: [OWNER] }], { key: 'db' });
    const health = await get(base, `/run/${record.id}/health`, viewer);
    assert.equal(health.status, 200, `${health.text}\n${hosted.stateOf(record.id, { owner: true }).stderr?.join('\n') || ''}`);
    assert.deepEqual(JSON.parse(health.text), { ok: true, pages: 1 });
    assert.equal(health.headers['content-security-policy'], H.hostedCsp(`http://127.0.0.1:${server.address().port}`, record.id));
    assert.equal(health.headers['x-content-type-options'], 'nosniff');
    pid = hosted.runs.get(record.id).child.pid;
    const info = await get(base, `/run/${record.id}/api/app`, viewer);
    assert.equal(info.status, 200, info.text);
    const appInfo = JSON.parse(info.text);
    assert.deepEqual([appInfo.auth, appInfo.user.email, appInfo.user.name, appInfo.pages.map((p) => p.id)], ['user', OWNER, 'Owner', [page.id]],
      'the shell reads the forwarded identity, so it reads data as the viewer');
    const index = await get(base, `/run/${record.id}/`, viewer);
    assert.equal(index.status, 200);
    assert.match(index.text, /<script type="module" crossorigin src="\.\/assets\/app\.js"><\/script>/, 'relative asset links, so the page works under /run/<id>/');
    const asset = await get(base, `/run/${record.id}/assets/app.js`, viewer);
    assert.equal(asset.status, 200);
    const refused = await get(base, `/run/${record.id}/api/app`, { 'x-forwarded-email': OWNER });
    assert.deepEqual([refused.status, refused.text], [401, H.HOSTED_NO_TOKEN], 'no forwarded token never reaches the page');
    assert.equal(appInfo.alerting.on, false, 'the real page sends no alerts of its own, since it has no service principal');
    hosted.useAlerts(async (_req, held, step) => ({ step, page: held.record.page }));
    const patched = JSON.parse((await get(base, `/run/${record.id}/api/app`, viewer)).text);
    assert.deepEqual([patched.alerting, patched.options.alerts, patched.auth, patched.user.email], [{ on: true, reason: '' }, true, 'user', OWNER],
      'Inspire turns the Alerts view of the real page on and keeps the rest of its answer');
    const alerts = await get(base, `/run/${record.id}/api/alerts?page=${page.id}`, viewer);
    assert.deepEqual([alerts.status, JSON.parse(alerts.text)], [200, { step: 'listing', page: page.id }]);
    assert.equal(hosted.stateOf(record.id).state, 'ready');
  } finally {
    hosted.stopAll();
    for (let i = 0; pid && i < 100 && !gone(pid); i += 1) await new Promise((r) => setTimeout(r, 50));
    await new Promise((resolve) => server.close(resolve));
    fs.rmSync(tmp, { recursive: true, force: true });
  }
  assert.ok(pid && gone(pid), 'the page process ended when Inspire stopped it');
});
