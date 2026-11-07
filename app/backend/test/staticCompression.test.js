const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const { fileNames } = require('./support/sourceFiles');
const zlib = require('zlib');
const express = require('express');
const { listen } = require('./support/implementApp');
const { startInspire } = require('./support/serverProcess');
const A = require('../lib/assetTypes');

const DIST = path.resolve(__dirname, '..', '..', 'frontend', 'dist');
const BUNDLE = fileNames(path.join(DIST, 'assets')).filter((n) => n.endsWith('.js'))
  .sort((a, b) => fs.statSync(path.join(DIST, 'assets', b)).size - fs.statSync(path.join(DIST, 'assets', a)).size)[0];
const BUNDLE_BYTES = fs.readFileSync(path.join(DIST, 'assets', BUNDLE));

function raw(url, headers = {}, method = 'GET') {
  return new Promise((resolve, reject) => {
    const req = http.request(url, { method, headers }, (res) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: Buffer.concat(chunks) }));
    });
    req.on('error', reject);
    req.end();
  });
}

const decode = (r) => (r.headers['content-encoding'] === 'br' ? zlib.brotliDecompressSync(r.body)
  : r.headers['content-encoding'] === 'gzip' ? zlib.gunzipSync(r.body) : r.body);

async function serveDist(dir = DIST) {
  const app = express();
  app.use(A.compressedStatic(dir));
  app.use(express.static(dir, { setHeaders: A.staticHeaders }));
  return listen(app);
}

test('the hashed bundle goes out brotli or gzip compressed, byte for byte the build, and cached for a year as immutable', async () => {
  const srv = await serveDist();
  try {
    for (const [accept, expected] of [['gzip, deflate, br', 'br'], ['gzip', 'gzip'], ['br;q=0, gzip;q=0.8', 'gzip'], ['*', 'br']]) {
      const r = await raw(`${srv.url}/assets/${BUNDLE}`, { 'accept-encoding': accept });
      assert.equal(r.status, 200, accept);
      assert.equal(r.headers['content-encoding'], expected, accept);
      assert.ok(Number(r.headers['content-length']) < BUNDLE_BYTES.length / 2, `${accept}: ${r.headers['content-length']} of ${BUNDLE_BYTES.length}`);
      assert.ok(decode(r).equals(BUNDLE_BYTES), accept);
      assert.equal(r.headers['cache-control'], A.CACHE_HASHED);
      assert.equal(r.headers['content-type'], 'text/javascript; charset=utf-8');
      assert.equal(r.headers['x-content-type-options'], 'nosniff');
      assert.match(r.headers.vary, /accept-encoding/i);
    }
  } finally {
    await srv.close();
  }
});

test('a client that refuses compression gets the plain bundle, still immutable, and a repeat with its tag gets 304', async () => {
  const srv = await serveDist();
  try {
    for (const accept of [undefined, 'identity', 'gzip;q=0, br;q=0']) {
      const r = await raw(`${srv.url}/assets/${BUNDLE}`, accept ? { 'accept-encoding': accept } : {});
      assert.equal(r.headers['content-encoding'], undefined, String(accept));
      assert.ok(r.body.equals(BUNDLE_BYTES));
      assert.equal(r.headers['cache-control'], A.CACHE_HASHED);
    }
    const first = await raw(`${srv.url}/assets/${BUNDLE}`, { 'accept-encoding': 'gzip' });
    const again = await raw(`${srv.url}/assets/${BUNDLE}`, { 'accept-encoding': 'gzip', 'if-none-match': first.headers.etag });
    assert.equal(again.status, 304);
    assert.equal(again.body.length, 0);
    const head = await raw(`${srv.url}/assets/${BUNDLE}`, { 'accept-encoding': 'gzip' }, 'HEAD');
    assert.equal(head.status, 200);
    assert.equal(head.headers['content-length'], first.headers['content-length']);
    assert.equal(head.body.length, 0);
  } finally {
    await srv.close();
  }
});

test('the page, images and any unhashed file revalidate (no-cache) and are never marked immutable (must-exclude)', async () => {
  const srv = await serveDist();
  try {
    const page = await raw(`${srv.url}/`, { 'accept-encoding': 'gzip, br' });
    assert.equal(page.status, 200);
    assert.equal(page.headers['cache-control'], 'no-cache');
    for (const name of fileNames(DIST).filter((n) => /\.(png|jpe?g)$/.test(n))) {
      const r = await raw(`${srv.url}/${name}`, { 'accept-encoding': 'gzip, br' });
      assert.equal(r.status, 200, name);
      assert.equal(r.headers['cache-control'], 'no-cache', name);
      assert.equal(r.headers['content-encoding'], undefined, `${name} is already compressed`);
    }
  } finally {
    await srv.close();
  }
  assert.equal(A.assetCacheControl('assets/index-BpKjh2u5.js'), A.CACHE_HASHED);
  assert.equal(A.assetCacheControl('/assets/ImplementPage-T4Hg5AFR.js'), A.CACHE_HASHED);
  for (const name of ['index.html', 'assets/app.js', 'static/assets/app.js', 'hero-vision.jpg', 'assets/fonts/inter-LICENSE', 'assets/x-short.js']) {
    assert.equal(A.assetCacheControl(name), 'no-cache', name);
  }
});

test('the compressor never reads outside the build folder and leaves small or unknown files to the plain server', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-gz-'));
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-gz-out-'));
  fs.mkdirSync(path.join(dir, 'assets'));
  fs.writeFileSync(path.join(dir, 'assets', 'tiny-abcdefgh.js'), 'x');
  fs.writeFileSync(path.join(dir, 'notes.txt'), 'a'.repeat(5000));
  fs.writeFileSync(path.join(outside, 'secret.js'), 'b'.repeat(5000));
  const srv = await serveDist(dir);
  try {
    const tiny = await raw(`${srv.url}/assets/tiny-abcdefgh.js`, { 'accept-encoding': 'gzip' });
    assert.equal(tiny.headers['content-encoding'], undefined);
    assert.equal(tiny.body.toString(), 'x');
    const text = await raw(`${srv.url}/notes.txt`, { 'accept-encoding': 'gzip' });
    assert.equal(text.headers['content-encoding'], undefined);
    assert.equal(text.headers['content-type'], A.UNKNOWN_ASSET_TYPE);
    const rel = path.relative(dir, path.join(outside, 'secret.js')).split(path.sep).join('/');
    for (const probe of [`/${rel}`, `/..%2f${path.basename(outside)}%2fsecret.js`, `/%2e%2e/${path.basename(outside)}/secret.js`]) {
      const r = await raw(`${srv.url}${probe}`, { 'accept-encoding': 'gzip' });
      assert.notEqual(r.status, 200, probe);
      assert.ok(!r.body.toString().includes('bbbb'), probe);
    }
  } finally {
    await srv.close();
    fs.rmSync(dir, { recursive: true, force: true });
    fs.rmSync(outside, { recursive: true, force: true });
  }
});

test('Accept-Encoding is read with its weights', () => {
  assert.equal(A.acceptedEncoding('gzip, deflate, br'), 'br');
  assert.equal(A.acceptedEncoding('gzip'), 'gzip');
  assert.equal(A.acceptedEncoding('br;q=0,gzip'), 'gzip');
  assert.equal(A.acceptedEncoding('BR;q=0.5'), 'br');
  assert.equal(A.acceptedEncoding('*;q=0'), '');
  assert.equal(A.acceptedEncoding('identity'), '');
  assert.equal(A.acceptedEncoding(''), '');
  assert.equal(A.acceptedEncoding(undefined), '');
});

test('the running Inspire App sends its bundle compressed and immutable, and its page as no-cache on every path', async () => {
  const inspire = await startInspire({});
  try {
    const bundle = await raw(`${inspire.url}/assets/${BUNDLE}`, { 'accept-encoding': 'gzip, br' });
    assert.equal(bundle.status, 200);
    assert.equal(bundle.headers['content-encoding'], 'br');
    assert.equal(bundle.headers['cache-control'], A.CACHE_HASHED);
    assert.ok(decode(bundle).equals(BUNDLE_BYTES));
    for (const page of ['/', '/monitor', '/launch?x=1']) {
      const r = await raw(`${inspire.url}${page}`, { 'accept-encoding': 'gzip, br' });
      assert.equal(r.status, 200, page);
      assert.equal(r.headers['cache-control'], 'no-cache', page);
      assert.match(r.headers['content-type'], /^text\/html/, page);
      assert.match(decode(r).toString('utf8'), /<div id="root">/, page);
    }
  } finally {
    await inspire.stop();
  }
});
