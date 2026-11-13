// v1.5.3-rc.1 (customer polish): a fresh install is the normal first-run state, not an error, and no message a user reads
// names an internal __inspire_* table. Real errors keep their text.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const USER_FACING = ['server.js', 'implementRoutes.js'].map((f) => path.join(__dirname, '..', f));

function userFacingLines(file) {
  return fs.readFileSync(file, 'utf8').split('\n')
    .filter((line) => /\b(message|error)\s*:/.test(line) || /new Error\(/.test(line));
}

test('no message or error a user reads names an internal __inspire_* table', () => {
  for (const file of USER_FACING) {
    const leaking = userFacingLines(file).filter((line) => /__inspire_/.test(line));
    assert.deepEqual(leaking, [], `${path.basename(file)} shows an internal table name`);
  }
});

test('the first-run states are not errors, and the empty session list says so plainly', () => {
  const server = fs.readFileSync(USER_FACING[0], 'utf8');
  assert.doesNotMatch(server, /Session table not found/);
  assert.doesNotMatch(server, /Run Inspire once/);
  assert.match(server, /first_run: true/);
});
