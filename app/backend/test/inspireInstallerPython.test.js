const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const TESTS = path.resolve(__dirname, '..', '..', 'installer', 'test');

test('the installer, its install steps and the release script pass their Python tests', (t) => {
  if (spawnSync('python3', ['--version']).status !== 0) {
    t.skip('python3 is not installed');
    return;
  }
  const run = spawnSync('python3', ['-m', 'unittest', 'discover', '-s', TESTS, '-p', 'test_*.py'], { encoding: 'utf8', cwd: TESTS });
  const ran = /Ran (\d+) tests?/.exec(run.stderr);
  assert.equal(run.status, 0, run.stderr.slice(-4000));
  assert.ok(ran && Number(ran[1]) >= 50, `ran ${ran ? ran[1] : 0} Python tests`);
});
