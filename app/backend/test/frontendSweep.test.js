const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FRONTEND, SRC, relative, sourceFiles, withoutComments } = require('./support/frontendSource');
const { OUTSIDE_LOADS } = require('../../scripts/offline-gate');

test('the frontend loads no script, style, font or image from an outside host at run time', () => {
  const files = [...sourceFiles(SRC, ['.js', '.jsx', '.css']), path.join(FRONTEND, 'index.html')];
  const hits = [];
  for (const file of files) {
    const raw = fs.readFileSync(file, 'utf8');
    const text = /\.(css|html)$/.test(file) ? raw : withoutComments(raw);
    text.split('\n').forEach((line, i) => {
      if (OUTSIDE_LOADS.some((re) => re.test(line))) hits.push(`${relative(file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  assert.deepEqual(hits, []);
  assert.ok(OUTSIDE_LOADS.some((re) => re.test("s.src = 'https://cdn.jsdelivr.net/npm/canvas-confetti@1.9.3/dist/confetti.browser.min.js';")), 'the old confetti load is caught');
  assert.ok(OUTSIDE_LOADS.some((re) => re.test("s.src = 'https://cdn.sheetjs.com/xlsx-0.20.3/package/dist/xlsx.full.min.js';")), 'the old Excel reader load is caught');
  assert.ok(OUTSIDE_LOADS.some((re) => re.test('<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter">')));
  assert.equal(OUTSIDE_LOADS.some((re) => re.test('placeholder="https://adb-xxxx.xx.azuredatabricks.net"')), false, 'a placeholder is not a load');
});

test('confetti and the Excel reader are bundled from npm, confetti respects reduced motion, and Review fires none', () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(FRONTEND, 'package.json'), 'utf8'));
  assert.ok(pkg.dependencies['canvas-confetti'] && pkg.dependencies['read-excel-file']);
  const celebration = fs.readFileSync(path.join(SRC, 'components', 'Celebration.jsx'), 'utf8');
  assert.match(celebration, /^import confetti from 'canvas-confetti';$/m);
  assert.match(celebration, /reducedMotion\(\)/);
  assert.match(celebration, /disableForReducedMotion: true/);
  const review = fs.readFileSync(path.join(SRC, 'pages', 'ResultsPage.jsx'), 'utf8');
  assert.equal(/Celebration/.test(review), false, 'Review fires no confetti');
  assert.match(review, /await import\('read-excel-file\/browser'\)/, 'the Excel reader loads from the App bundle only when a person previews a workbook');
});

test('the frontend build never reads its own last output, so the same source builds the same dist', () => {
  const css = fs.readFileSync(path.join(SRC, 'index.css'), 'utf8').split('\n');
  assert.equal(css[0], '@import "tailwindcss";');
  assert.equal(css[1], '@source not "../dist";', 'frontend/dist is committed, so git does not hide it from the Tailwind class scan');
  const ignored = fs.readFileSync(path.join(FRONTEND, '.gitignore'), 'utf8').split('\n').map((line) => line.trim());
  assert.equal(ignored.includes('dist'), false, 'dist stays tracked for the App zip');
});

test('the App header and the home page show no made-up version badge', () => {
  for (const file of ['components/Header.jsx', 'pages/LandingPage.jsx']) {
    const text = withoutComments(fs.readFileSync(path.join(SRC, file), 'utf8'));
    assert.equal(/>\s*V\d+\s*</.test(text), false, file);
  }
});
