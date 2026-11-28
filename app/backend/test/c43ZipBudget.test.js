'use strict';
// c43: the App zip must fit the 10,000,000-byte workspace import limit with room to spare.
// Root cause (v1.6.1-rc.9): the zip shipped the agent notebook twice (the .ipynb and a base64
// copy in backend/notebook_bundle.js), the demo notebook three times, and three landing images
// at several times their shown size, so re-recorded demos pushed it to 12,382,309 bytes.
const test = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const APP = path.resolve(__dirname, '..', '..');
const { APP_FILES, APP_FILES_WHEN_PRESENT } = require('../lib/appPaths');

// Zip budget: 5% under the workspace import limit, so the next demo re-record fails here, not at rc time.
const ZIP_BUDGET = 9500000;
// backend/build is made by `npm run build`/bundle-backend and is not in git; when absent, count what it weighs zipped.
const BUILD_ALLOWANCE = 1450000;
const IMAGE_MAX = 250000;
const IMAGE_RE = /\.(png|jpe?g|webp|gif)$/i;

function filesUnder(rel) {
  const abs = path.join(APP, rel);
  if (!fs.existsSync(abs)) return [];
  if (fs.statSync(abs).isFile()) return [rel];
  return fs.readdirSync(abs).flatMap((c) => filesUnder(path.join(rel, c)));
}

function shippedFiles() {
  const items = [...APP_FILES, ...APP_FILES_WHEN_PRESENT.filter((i) => fs.existsSync(path.join(APP, i)))];
  const files = items.flatMap(filesUnder);
  const installer = filesUnder('installer').filter((f) => !/\/test\/|__pycache__/.test(f));
  return [...files, ...installer].filter((f) => !f.endsWith('.DS_Store'));
}

function zipEstimate(files) {
  let total = 0;
  for (const f of files) {
    const data = fs.readFileSync(path.join(APP, f));
    const deflated = zlib.deflateRawSync(data, { level: 6 }).length;
    total += Math.min(data.length, deflated) + 76 + 2 * f.length;
  }
  if (!fs.existsSync(path.join(APP, 'backend', 'build', 'server.js'))) total += BUILD_ALLOWANCE;
  return total;
}

test('c43: the zip ships the agent notebook once, as the .ipynb (no base64 copy)', () => {
  const all = [...APP_FILES, ...APP_FILES_WHEN_PRESENT];
  assert.ok(all.includes('dbx_inspire_ai_agent.ipynb'), 'the physical agent notebook must stay in the zip');
  assert.ok(!all.includes('backend/notebook_bundle.js'), 'backend/notebook_bundle.js duplicates the .ipynb in the zip');
  const appShell = require('../lib/appShell');
  assert.strictEqual(appShell.NOTEBOOK_BUNDLE_FILE, undefined, 'appShell must not offer a base64 notebook fallback');
  for (const rel of ['backend/server.js', 'backend/lib/appShell.js', 'scripts/bundle-agent-notebook.mjs']) {
    const src = fs.readFileSync(path.join(APP, rel), 'utf8');
    assert.ok(!/notebook_bundle/.test(src), `${rel} still reads or writes notebook_bundle.js`);
  }
});

test('c43: the zip ships the demo data notebook once', () => {
  const shipped = shippedFiles();
  const copies = shipped.filter((f) => /dbx_generate_demo_data\.py$|demo_notebook_bundle\.js$/.test(f));
  assert.strictEqual(copies.length, 1, `demo notebook shipped ${copies.length} times: ${copies.join(', ')}`);
  const src = fs.readFileSync(path.join(APP, 'backend', 'lib', 'demoDataPipeline.js'), 'utf8');
  assert.ok(!/demo_notebook_bundle/.test(src), 'demoDataPipeline.js still falls back to demo_notebook_bundle.js');
});

test('c43: every shipped image is at most 250,000 bytes', () => {
  const big = shippedFiles()
    .filter((f) => IMAGE_RE.test(f))
    .map((f) => [f, fs.statSync(path.join(APP, f)).size])
    .filter(([, n]) => n > IMAGE_MAX);
  assert.deepStrictEqual(big, [], `images over ${IMAGE_MAX} bytes: ${big.map(([f, n]) => `${f}=${n}`).join(', ')}`);
  for (const f of ['frontend/public/inspire-agent.jpg', 'frontend/public/hero-vision.jpg', 'frontend/public/databricks-logo.png']) {
    assert.ok(fs.existsSync(path.join(APP, f)), `${f} must still exist (the landing page and logo use it)`);
  }
});

test('c43: the estimated zip is under the 9,500,000-byte budget', () => {
  const est = zipEstimate(shippedFiles());
  assert.ok(est <= ZIP_BUDGET, `estimated zip ${est} bytes is over the ${ZIP_BUDGET}-byte budget (limit 10,000,000)`);
});

test('c43 must-fail: the estimate catches a planted 3 MB incompressible file', () => {
  const files = shippedFiles();
  const base = zipEstimate(files);
  const planted = path.join(APP, 'backend', 'c43_planted.bin');
  fs.writeFileSync(planted, require('crypto').randomBytes(3000000));
  try {
    const est = zipEstimate([...files, 'backend/c43_planted.bin']);
    assert.ok(est - base >= 3000000, 'a 3 MB random file must add at least 3 MB to the estimate');
  } finally {
    fs.renameSync(planted, path.join(require('os').tmpdir(), `c43_planted_${process.pid}.bin`));
  }
});
