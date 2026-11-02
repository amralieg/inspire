const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { FRONTEND, SRC, relative, sourceFiles, withoutComments } = require('./support/frontendSource');

test('the comment stripper keeps strings and JSX text and drops only comments', () => {
  const kept = withoutComments("const a = 'x — y'; // gone — here\n/* gone — too */ <p>{/* gone — also */}Shown — text</p>\nconst u = 'https://a.b/c';");
  assert.equal((kept.match(/—/g) || []).length, 2, 'the string and the JSX text keep their dashes, the three comments do not');
  assert.ok(kept.includes("'https://a.b/c'"), 'a URL inside a string is not a comment');
  assert.equal(kept.split('\n').length, 3, 'line numbers stay put');
});

test('no user-visible text in the frontend uses an em or en dash', () => {
  const hits = [];
  for (const file of sourceFiles(SRC, ['.js', '.jsx'])) {
    withoutComments(fs.readFileSync(file, 'utf8')).split('\n').forEach((line, i) => {
      if (/[\u2013\u2014]/.test(line)) hits.push(`${relative(file)}:${i + 1}: ${line.trim().slice(0, 120)}`);
    });
  }
  if (/[\u2013\u2014]/.test(fs.readFileSync(path.join(FRONTEND, 'index.html'), 'utf8'))) hits.push('index.html');
  assert.deepEqual(hits, []);
});
