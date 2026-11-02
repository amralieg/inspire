const { spawn } = require('node:child_process');
const http = require('node:http');
const net = require('node:net');
const path = require('node:path');
const { folderAnswer, folderModel } = require('./workspaceFolders');

const SERVER = path.join(__dirname, '..', '..', 'server.js');
const CLEARED_ENV = ['DATABRICKS_HOST', 'DATABRICKS_TOKEN', 'DATABRICKS_CLIENT_ID', 'DATABRICKS_CLIENT_SECRET', 'SP_CLIENT_ID', 'SP_CLIENT_SECRET',
  'INSPIRE_WAREHOUSE_ID', 'INSPIRE_DATABASE', 'NOTEBOOK_PATH', 'NODE_ENV'];

function readBody(req) {
  return new Promise((resolve) => {
    let text = '';
    req.on('data', (chunk) => { text += chunk; });
    req.on('end', () => resolve(text));
  });
}

const SHARED_FOLDERS = { '/Shared': { writers: '*' } };

async function fakeWorkspace(answer, { folders = SHARED_FOLDERS } = {}) {
  const calls = [];
  const model = folderModel({ folders });
  const writable = (parent, token) => {
    const grant = (model.folders[parent] || {}).writers;
    return grant === '*' || (Array.isArray(grant) && grant.includes(token));
  };
  const server = http.createServer(async (req, res) => {
    const text = await readBody(req);
    let body = text;
    try { body = text ? JSON.parse(text) : null; } catch { body = text; }
    const call = { method: req.method, path: req.url, token: String(req.headers.authorization || '').replace(/^Bearer /, ''), body };
    calls.push(call);
    const url = new URL(`http://x${req.url}`);
    const missing = url.pathname === '/api/2.0/workspace/get-status'
      ? [404, { error_code: 'RESOURCE_DOES_NOT_EXIST', message: `${url.searchParams.get('path')} does not exist` }] : null;
    const [status, data] = answer(call)
      || folderAnswer(model, { method: req.method, pathname: url.pathname, searchParams: url.searchParams, body, token: call.token }, writable)
      || missing
      || [404, { error_code: 'NOT_FOUND', message: `not mocked ${req.method} ${req.url}` }];
    res.writeHead(status, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(data));
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  return {
    url: `http://127.0.0.1:${server.address().port}`,
    calls,
    model,
    close: () => new Promise((resolve) => server.close(resolve)),
  };
}

function freePort() {
  return new Promise((resolve, reject) => {
    const probe = net.createServer();
    probe.on('error', reject);
    probe.listen(0, '127.0.0.1', () => {
      const { port } = probe.address();
      probe.close(() => resolve(port));
    });
  });
}

const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function startInspire(env, { readyMs = 90000, command = [process.execPath, SERVER], cwd } = {}) {
  const port = await freePort();
  const childEnv = { PATH: process.env.PATH, HOME: process.env.HOME, PORT: String(port), ...Object.fromEntries(CLEARED_ENV.map((k) => [k, ''])), ...env };
  const child = spawn(command[0], command.slice(1), { cwd, env: childEnv, stdio: ['ignore', 'pipe', 'pipe'] });
  let output = '';
  child.stdout.on('data', (chunk) => { output += chunk; });
  child.stderr.on('data', (chunk) => { output += chunk; });
  const exited = new Promise((resolve) => child.on('exit', resolve));
  const url = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (child.exitCode === null && child.signalCode === null) {
      child.kill('SIGTERM');
      await exited;
    }
  };
  const deadline = Date.now() + readyMs;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`server.js exited with ${child.exitCode}: ${output.slice(-3000)}`);
    const ready = await fetch(`${url}/api/health`).then((resp) => resp.ok, () => false);
    if (ready) break;
    if (Date.now() > deadline) {
      await stop();
      throw new Error(`server.js did not answer /api/health within ${readyMs} ms: ${output.slice(-3000)}`);
    }
    await pause(200);
  }
  return { url, pid: child.pid, output: () => output, stop };
}

module.exports = { fakeWorkspace, startInspire };
