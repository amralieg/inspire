const { test, after } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const AdmZip = require('adm-zip');
const APP_DIR = path.resolve(__dirname, '..', '..');
const { APP_FILES } = require('../lib/appPaths');
const G = require('../../scripts/offline-gate');
const { startInspire } = require('./support/serverProcess');
const { loadShowcases } = require('../lib/showcase');

const PACKAGE = path.join(APP_DIR, 'scripts', 'package-for-workspace.sh');
const TRACKED_OUTPUTS = ['backend/notebook_bundle.js', 'backend/demo_notebook_bundle.js', 'backend/dbx_generate_demo_data.py'];
const SHOWCASE_DIR = path.join(APP_DIR, 'backend', 'showcase');
const RECORDINGS = spawnSync('git', ['ls-files', '--', 'backend/showcase'], { cwd: APP_DIR, encoding: 'utf8' }).stdout.split('\n').filter(Boolean);
const work = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire_offline_'));
const NO_INTERNET = {
  HTTP_PROXY: 'http://127.0.0.1:9', HTTPS_PROXY: 'http://127.0.0.1:9', http_proxy: 'http://127.0.0.1:9', https_proxy: 'http://127.0.0.1:9',
  npm_config_offline: 'true', npm_config_cache: path.join(work, 'empty-npm-cache'),
};
after(() => fs.rmSync(work, { recursive: true, force: true }));

let packed;
function packApp() {
  if (packed) return packed;
  const zip = path.join(work, 'app.zip');
  const stamp = () => TRACKED_OUTPUTS.map((file) => fs.statSync(path.join(APP_DIR, file)).mtimeMs);
  const before = stamp();
  const shown = fs.readdirSync(SHOWCASE_DIR).sort();
  const run = spawnSync('bash', [PACKAGE], { cwd: APP_DIR, env: { ...process.env, SKIP_BUILD: '1', ARTIFACT_ZIP: zip }, encoding: 'utf8' });
  assert.deepEqual(fs.readdirSync(SHOWCASE_DIR).sort(), shown, 'packaging adds and removes nothing in the App demo folder');
  packed = { zip, run, before, after: stamp() };
  return packed;
}

function extracted(name) {
  const dir = path.join(work, name);
  new AdmZip(packApp().zip).extractAllTo(dir, true);
  return dir;
}

async function read(url, route) {
  const resp = await fetch(`${url}${route}`);
  return { status: resp.status, type: resp.headers.get('content-type') || '', body: Buffer.from(await resp.arrayBuffer()) };
}

const BUNDLE_TEXT = [
  '"use strict";',
  '// node_modules/express/index.js',
  'var a = "see https://github.com/expressjs/express for help";',
  '// lib/appPaths.js',
  'var b = `https://${host}/api/2.0/jobs`;',
  '// server.js',
  'var c = "https://login.microsoftonline.com/x/oauth2/v2.0/token"; var d = `http://localhost:${PORT}`; var e = "https://inspire.example.com";',
].join('\n');
const CLEAN = () => [
  { name: 'app.yaml', data: Buffer.from('command:\n  - "bash"\n  - "start.sh"\n') },
  { name: 'start.sh', data: Buffer.from('#!/usr/bin/env bash\nexec node backend/build/server.js\n') },
  { name: G.BUNDLE, data: Buffer.from(BUNDLE_TEXT) },
  { name: 'frontend/dist/index.html', data: Buffer.from('<script type="module" src="/assets/index.js"></script><a href="https://docs.example.org/guide">Docs</a>') },
  { name: 'frontend/dist/assets/index.js', data: Buffer.from('jsx("input",{placeholder:"https://adb-xxxx.xx.azuredatabricks.net"});var ns="http://www.w3.org/2000/svg";') },
  { name: 'installer/inspire_setup.py', data: Buffer.from('URL = "https://github.com/x/releases/latest/download/a"\n') },
  { name: 'backend/api-docs.html', data: Buffer.from('<link rel="stylesheet" href="/api-docs/swagger-ui.css" /><script src="/api-docs/swagger-ui-bundle.js"></script>') },
  { name: 'backend/build/swagger-ui/swagger-ui-bundle.js', data: Buffer.from('var validatorUrl="https://validator.swagger.io/validator";') },
  { name: 'backend/build/swagger-ui/swagger-ui.css', data: Buffer.from('.a{background:url("data:image/svg+xml;base64,AA==")}') },
  { name: 'backend/build/swagger-ui/LICENSE', data: Buffer.from('Apache License') },
  { name: 'backend/build/swagger-ui/NOTICE', data: Buffer.from('swagger-ui') },
];
const withEntry = (name, text) => [...CLEAN().filter((e) => e.name !== name), { name, data: Buffer.from(text) }];

test('the packaged App zip has no install step, no outside host and fits the workspace import limit', () => {
  const { zip, run } = packApp();
  assert.equal(run.status, 0, `${run.stdout}\n${run.stderr}`);
  assert.deepEqual(G.checkZip(zip), []);
  const names = G.zipEntries(zip).map((e) => e.name);
  for (const item of APP_FILES) assert.ok(names.some((name) => name === item || name.startsWith(`${item}/`)), `${item} ships`);
  assert.ok(RECORDINGS.length > 0, 'the App carries demo recordings in backend/showcase');
  for (const name of [G.BUNDLE, 'backend/build/THIRD_PARTY_NOTICES', 'backend/build/swagger-ui/LICENSE', 'backend/build/swagger-ui/NOTICE', ...RECORDINGS]) {
    assert.ok(names.includes(name), `${name} ships`);
  }
  const notShipped = /^backend\/(lib\/|test\/|server\.js$|implementRoutes\.js$|package)|^scripts\/|^frontend\/(src|test|public|package)|^(package|README|deployment|databricks)/;
  assert.deepEqual(names.filter((n) => notShipped.test(n)), [], 'no source, test, package file, doc or build script ships');
  assert.ok(fs.statSync(zip).size < G.IMPORT_LIMIT, `${fs.statSync(zip).size} bytes`);
});

test('packaging rewrites no tracked build output that is already current', () => {
  const { before, after: afterStamp } = packApp();
  assert.deepEqual(afterStamp, before);
});

test('start.sh runs the bundle with no node_modules and no internet, and every file the App reads resolves from the bundle', async () => {
  const dir = extracted('run');
  assert.equal(fs.existsSync(path.join(dir, 'node_modules')) || fs.existsSync(path.join(dir, 'backend', 'node_modules')), false);
  const app = await startInspire(NO_INTERNET, { command: ['bash', 'start.sh'], cwd: dir });
  try {
    const health = await read(app.url, '/api/health');
    assert.equal(health.status, 200);
    assert.equal(JSON.parse(health.body).hasBundledDbc, true, 'the agent notebook resolves from the bundle');
    const home = await read(app.url, '/');
    assert.equal(home.status, 200);
    assert.equal(home.body.toString('utf8'), fs.readFileSync(path.join(dir, 'frontend', 'dist', 'index.html'), 'utf8'));
    assert.equal(JSON.parse((await read(app.url, '/api/defaults')).body).frontendBuild.ok, true);
    const docs = await read(app.url, '/api-docs');
    assert.equal(docs.status, 200);
    assert.match(docs.body.toString('utf8'), /<script src="\/api-docs\/swagger-ui-bundle\.js"><\/script>/);
    for (const [file, type] of [['swagger-ui-bundle.js', /^text\/javascript/], ['swagger-ui.css', /^text\/css/]]) {
      const got = await read(app.url, `/api-docs/${file}`);
      assert.equal(got.status, 200, file);
      assert.match(got.type, type, file);
      assert.ok(got.body.equals(fs.readFileSync(path.join(dir, 'backend', 'build', 'swagger-ui', file))), file);
    }
    const spec = await read(app.url, '/api/openapi.json');
    assert.equal(spec.status, 200);
    assert.match(JSON.parse(spec.body).openapi, /^3\./);
    const demos = JSON.parse((await read(app.url, '/api/showcase')).body);
    assert.equal(demos.error, undefined);
    assert.deepEqual(demos.showcases.map((s) => s.id).sort(), Object.keys(loadShowcases(SHOWCASE_DIR)).sort(), 'every demo recording in backend/showcase ships and is listed');
    assert.match(app.output(), /Inspire AI starting from .* with node v\d+/);
  } finally {
    await app.stop();
  }
});

test('the bundle writes the agent notebook from notebook_bundle.js on disk when the .ipynb is missing', async () => {
  const dir = extracted('fallback');
  const original = fs.readFileSync(path.join(dir, 'dbx_inspire_ai_agent.ipynb'));
  fs.rmSync(path.join(dir, 'dbx_inspire_ai_agent.ipynb'));
  const app = await startInspire(NO_INTERNET, { command: ['bash', 'start.sh'], cwd: dir });
  try {
    assert.equal(JSON.parse((await read(app.url, '/api/health')).body).hasBundledDbc, true);
    assert.ok(fs.readFileSync(path.join(dir, 'backend', 'dbx_inspire_ai_agent.ipynb')).equals(original));
  } finally {
    await app.stop();
  }
  const bundle = fs.readFileSync(path.join(dir, G.BUNDLE), 'utf8');
  const embedded = fs.readFileSync(path.join(dir, 'backend', 'notebook_bundle.js'), 'utf8');
  assert.equal(bundle.includes(embedded.slice(20, 220)), false, 'the notebook data stays out of the bundle');
});

test('start.sh stops with one plain message when the bundle is missing', () => {
  const dir = fs.mkdtempSync(path.join(work, 'empty_'));
  fs.copyFileSync(path.join(APP_DIR, 'start.sh'), path.join(dir, 'start.sh'));
  const run = spawnSync('bash', ['start.sh'], { cwd: dir, encoding: 'utf8' });
  assert.equal(run.status, 1);
  assert.equal(run.stdout.trim().split('\n').length, 1);
  assert.match(run.stdout, /^Inspire cannot start: backend\/build\/server\.js is missing from this App folder\./);
});

test('the offline check passes the clean case and refuses every install step and outside load', () => {
  assert.deepEqual(G.offlineProblems(CLEAN(), 1), []);
  assert.deepEqual(G.offlineProblems(CLEAN(), G.IMPORT_LIMIT - 1), []);
  const HOISTED = '\n// ../../shared/node_modules/debug/src/browser.js\nvar see = "https://stackoverflow.com/questions/1";';
  assert.deepEqual(G.offlineProblems(withEntry(G.BUNDLE, `${BUNDLE_TEXT}${HOISTED}`), 1), [], 'a package from a hoisted or linked node_modules may name a host');
  const refused = [
    [CLEAN(), G.IMPORT_LIMIT, /not under the 10000000-byte workspace import limit/],
    [withEntry('package.json', '{"name":"a","dependencies":{"express":"5"}}'), 1, /^package\.json: Databricks Apps installs/],
    [withEntry('backend/package.json', '{"scripts":{"postinstall":"npm install"}}'), 1, /^backend\/package\.json:/],
    [withEntry('package.json', '{"name":"a"}'), 1, /^package\.json:/],
    [withEntry('frontend/package-lock.json', '{}'), 1, /^frontend\/package-lock\.json:/],
    [withEntry('requirements.txt', 'fastapi\n'), 1, /^requirements\.txt:/],
    [withEntry('backend/node_modules/express/index.js', ''), 1, /node_modules must not ship/],
    [withEntry('start.sh', 'cd backend && npm ci\nexec node backend/build/server.js\n'), 1, /^start\.sh: runs npm/],
    [withEntry('start.sh', 'npx --yes concurrently\nexec node backend/build/server.js\n'), 1, /^start\.sh: runs npx/],
    [withEntry('start.sh', 'pip install -r requirements.txt\nexec node backend/build/server.js\n'), 1, /^start\.sh: runs pip/],
    [withEntry('start.sh', 'exec node backend/server.js\n'), 1, /^start\.sh does not start backend\/build\/server\.js/],
    [withEntry('app.yaml', 'command:\n  - "npm"\n  - "run"\n  - "start"\n'), 1, /^app\.yaml: runs npm/],
    [CLEAN().filter((e) => e.name !== G.BUNDLE), 1, /^backend\/build\/server\.js is missing/],
    [CLEAN().filter((e) => e.name !== 'backend/build/swagger-ui/LICENSE'), 1, /^backend\/build\/swagger-ui\/LICENSE is missing/],
    [withEntry('frontend/dist/index.html', '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">'), 1, /^frontend\/dist\/index\.html: loads from an outside host/],
    [withEntry('frontend/dist/assets/index.js', 'const d=document.createElement("script");d.src="https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js";'), 1, /canvas-confetti/],
    [withEntry('frontend/dist/assets/index.js', 'x.src="https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js"'), 1, /cdn\.sheetjs\.com/],
    [withEntry('frontend/dist/assets/index.js', 'jsx("img",{src:"https://images.example.org/a.png"})'), 1, /images\.example\.org/],
    [withEntry('frontend/dist/assets/index.css', '@import url(https://fonts.googleapis.com/css2?family=Inter);'), 1, /index\.css: loads from an outside host/],
    [withEntry('backend/api-docs.html', '<script src="https://unpkg.com/swagger-ui-dist@5.18.2/swagger-ui-bundle.js"></script>'), 1, /^backend\/api-docs\.html: loads from an outside host/],
    [withEntry('backend/build/swagger-ui/swagger-ui.css', 'a{background:url("https://validator.swagger.io/badge.svg")}'), 1, /swagger-ui\.css: loads from an outside host/],
    [withEntry(G.BUNDLE, `${BUNDLE_TEXT}\n// lib/telemetry.js\nfetch("https://telemetry.vendor.io/ping");`), 1, /lib\/telemetry\.js: (names|calls) the internet host telemetry\.vendor\.io/],
    [withEntry(G.BUNDLE, `${BUNDLE_TEXT}\n// lib/hostedRun.js\nvar t = "https://login.microsoftonline.com/x";`), 1, /lib\/hostedRun\.js: names the internet host login\.microsoftonline\.com/],
    [withEntry(G.BUNDLE, `${BUNDLE_TEXT}\n// node_modules/@scarf/scarf/report.js\nhttps.get("https://scarf.sh/api/v1");`), 1, /node_modules\/@scarf\/scarf\/report\.js: calls the internet host scarf\.sh/],
    [withEntry(G.BUNDLE, `${BUNDLE_TEXT}\n// ../../shared/node_modules/evil/index.js\nfetch("https://telemetry.vendor.io/ping");`), 1, /shared\/node_modules\/evil\/index\.js: calls the internet host telemetry\.vendor\.io/],
    [withEntry(G.BUNDLE, `${BUNDLE_TEXT}\n// ../lib/own.js\nvar u = "https://telemetry.vendor.io/ping";`), 1, /\.\.\/lib\/own\.js: names the internet host telemetry\.vendor\.io/],
    [withEntry(G.BUNDLE, 'var a = 1;'), 1, /carries no esbuild module markers/],
  ];
  for (const [entries, bytes, expected] of refused) {
    const problems = G.offlineProblems(entries, bytes);
    assert.ok(problems.some((p) => expected.test(p)), `${expected} not in ${JSON.stringify(problems)}`);
  }
});
