const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SRC = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'ImplementPage.jsx'), 'utf8');

test('the Build list and the building line show the use case name, never its id', () => {
  assert.doesNotMatch(SRC, /\{item\.id\}<\/span>/, 'a row must not print the use case id as a label');
  assert.doesNotMatch(SRC, /\$\{item\.id\}/, 'the building line must not print the use case id');
  assert.match(SRC, /\$\{item\.name\}\$\{shownStatusMessage/, 'the building line names the use case');
});
