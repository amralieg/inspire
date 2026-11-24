const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = path.resolve(__dirname, '..', '..', 'frontend', 'src');

test('the App no longer rebuilds documents: the document action library, its components and the backend job are gone (REQ-503 FX-116)', () => {
  for (const gone of ['lib/documentActions.js', 'components/DocumentActions.jsx', 'components/DocumentLanguagesMultiselect.jsx']) {
    assert.equal(fs.existsSync(path.join(SRC, gone)), false, `${gone} is still there`);
  }
  assert.equal(fs.existsSync(path.resolve(__dirname, '..', 'lib', 'documentJob.js')), false, 'backend/lib/documentJob.js is still there');
});

test('no source file asks for a Create strategy document, use case catalog or Excel workbook action (REQ-503 FX-116)', () => {
  const hits = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) walk(p);
      else if (/\.(jsx?|mjs)$/.test(e.name) && /Create (strategy document|use case catalog|Excel workbook)|documentRunBody|documentJobState/.test(fs.readFileSync(p, 'utf8'))) hits.push(path.relative(SRC, p));
    }
  };
  walk(SRC);
  assert.deepEqual(hits, []);
});
