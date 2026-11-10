const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const read = (...parts) => fs.readFileSync(path.resolve(__dirname, '..', '..', ...parts), 'utf8');

test('a skipped-table warning says the count and carries the names as warning_details, on the launch and build routes (must-fail before the contract)', () => {
  const server = read('backend', 'server.js');
  assert.match(server, /warning_details: details/, 'the launch route returns the names as warning_details');
  assert.match(server, /skippedTablesDetail\(reads\.skipped\)/);
  const routes = read('backend', 'implementRoutes.js');
  assert.match(routes, /warningDetails = readDetails/, 'the build route carries the names');
  assert.match(routes, /warning_details: \[\.\.\.warningDetails/, 'the build response returns them as warning_details');
});

test('the build page shows the warning details under Details, beside the notes', () => {
  const page = read('frontend', 'src', 'pages', 'ImplementPage.jsx');
  assert.match(page, /setBuildDetails\(Array\.isArray\(data\?\.warning_details\)/);
  assert.match(page, /<TechnicalDetails items=\{buildDetails\} \/>/);
});
