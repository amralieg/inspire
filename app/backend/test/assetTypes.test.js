const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const express = require('express');
const { listen } = require('./support/implementApp');
const { ASSET_TYPES, UNKNOWN_ASSET_TYPE, assetType, staticHeaders } = require('../lib/assetTypes');

const DIST = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
const EXPECTED = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.json': 'application/json',
  '.map': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif',
  '.webp': 'image/webp', '.ico': 'image/x-icon', '.woff2': 'font/woff2',
};

function walk(dir, base = dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) return walk(full, base);
    return entry.isFile() ? [path.relative(base, full).split(path.sep).join('/')] : [];
  });
}

async function serveStatic(dir) {
  const app = express();
  app.use(express.static(dir, { setHeaders: staticHeaders }));
  return listen(app);
}

test('the App types every asset class it can ship from its own table, the same table the shell server holds', () => {
  assert.deepEqual(ASSET_TYPES, EXPECTED);
  const { asset_types: shared } = require('../../agent/tests/fixtures/implement_change_classes.json');
  assert.deepEqual(ASSET_TYPES, shared, 'the shared fixture carries the agent shell server table');
  assert.equal(assetType('a/b/PICTURE.WEBP'), 'image/webp');
  assert.equal(assetType('notes.txt'), null);
  assert.equal(assetType('LICENSE'), null);
  assert.equal(UNKNOWN_ASSET_TYPE, 'application/octet-stream');
});

test('every file of the built Inspire App is served with its own type and nosniff, never what the host guesses', async () => {
  const files = walk(DIST);
  assert.ok(files.length >= 5 && files.includes('index.html'), files.join(' '));
  const srv = await serveStatic(DIST);
  try {
    for (const rel of files) {
      const resp = await fetch(`${srv.url}/${rel}`);
      assert.equal(resp.status, 200, rel);
      assert.equal(resp.headers.get('content-type'), EXPECTED[path.extname(rel).toLowerCase()], rel);
      assert.equal(resp.headers.get('x-content-type-options'), 'nosniff', rel);
      await resp.arrayBuffer();
    }
  } finally {
    await srv.close();
  }
});

test('a file of an unknown type is served as application/octet-stream with nosniff, never as text', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-asset-types-'));
  const names = ['notes.txt', 'run.py', 'LICENSE', 'page.weird', 'app.js.bak', 'shown.HTML5'];
  for (const name of names) fs.writeFileSync(path.join(dir, name), 'alert(1)');
  fs.writeFileSync(path.join(dir, 'UPPER.PNG'), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
  const srv = await serveStatic(dir);
  try {
    for (const name of names) {
      const resp = await fetch(`${srv.url}/${name}`);
      assert.equal(resp.headers.get('content-type'), UNKNOWN_ASSET_TYPE, name);
      assert.equal(resp.headers.get('x-content-type-options'), 'nosniff', name);
      await resp.arrayBuffer();
    }
    const png = await fetch(`${srv.url}/UPPER.PNG`);
    assert.equal(png.headers.get('content-type'), 'image/png');
    await png.arrayBuffer();
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test('the Inspire App server mounts its static files with these headers and answers its page fallback with nosniff', () => {
  const server = fs.readFileSync(path.resolve(__dirname, '..', 'server.js'), 'utf8');
  assert.match(server, /app\.use\(express\.static\(STATIC_DIR, \{ setHeaders: staticHeaders \}\)\);/);
  assert.match(server, /res\.set\(\{ 'X-Content-Type-Options': 'nosniff', 'Cache-Control': CACHE_REVALIDATE \}\)\.type\('html'\)\.send\(indexHtml\);/);
  assert.match(server, /app\.use\(compressedStatic\(STATIC_DIR\)\);\n\s*app\.use\(express\.static\(STATIC_DIR/, 'the compressor answers before the plain static server');
  const mounts = server.split('\n').filter((line) => line.includes('express.static('));
  assert.equal(mounts.length, 2);
  assert.deepEqual(mounts.filter((line) => !/express\.static\([^\n]*setHeaders: staticHeaders \}\)/.test(line)), [], 'every static route types its files, so none is left untyped');
  assert.equal(/express\.static\([^\n]*setHeaders: staticHeaders \}\)/.test('app.use(express.static(DIR, { index: false }));'), false, 'an untyped mount is caught');
});
