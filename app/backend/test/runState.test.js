const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.resolve(__dirname, '..', '..', 'frontend', 'src');
const lib = () => import(pathToFileURL(path.join(SRC, 'lib', 'runState.js')).href);
const RAW = /\b(TERMINATED|INTERNAL_ERROR|TIMEDOUT|CANCELED|FAILED|SUCCESS|PENDING|QUEUED|TERMINATING)\b/;

test('a job state reads in words, the result first and the life cycle when there is no result', async () => {
  const { runStateText, RUN_STATE_UNKNOWN } = await lib();
  const cases = [
    [['PENDING'], 'Waiting to start'], [['QUEUED'], 'Waiting to start'], [['BLOCKED'], 'Waiting to start'],
    [['RUNNING'], 'Running'], [['TERMINATING'], 'Finishing'], [['TERMINATED'], 'Ended'], [['SKIPPED'], 'Skipped'],
    [['INTERNAL_ERROR'], 'Ended by Databricks'], [['INTERNAL_ERROR', 'FAILED'], 'Failed'],
    [['TERMINATED', 'SUCCESS'], 'Finished'], [['TERMINATED', 'FAILED'], 'Failed'], [['TERMINATED', 'TIMEDOUT'], 'Timed out'],
    [['TERMINATED', 'CANCELED'], 'Stopped'], [['TERMINATED', 'USER_CANCELED'], 'Stopped'],
    [['TERMINATED', 'UPSTREAM_FAILED'], 'Not run, an earlier task failed'],
    [['FAILED'], 'Failed'], [['canceled'], 'Stopped'], [[' running '], 'Running'],
    [['TERMINATED', 'DRIVER_ERROR'], 'Ended'],
    [['SOMETHING_NEW'], RUN_STATE_UNKNOWN], [[undefined, 'SOMETHING_NEW'], RUN_STATE_UNKNOWN],
    [[], ''], [[null, null], ''], [['', ''], ''],
  ];
  for (const [args, want] of cases) {
    const got = runStateText(...args);
    assert.equal(got, want, JSON.stringify(args));
    assert.doesNotMatch(got, RAW, `no raw platform word for ${JSON.stringify(args)}`);
  }
});

test('no page shows a raw job state: every life_cycle_state, result_state and run.state shown goes through runStateText', () => {
  const offenders = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const file = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(file);
      else if (/\.jsx$/.test(entry.name)) {
        fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
          if (/[{:?]\s*[\w?.]*\.(life_cycle_state|result_state)\s*\}/.test(line) || /\{\s*run\.state\s*(\|\||\})/.test(line)
            || /`[^`]*\$\{[\w?.]*\.(life_cycle_state|result_state)\}/.test(line)) {
            offenders.push(`${path.relative(SRC, file)}:${i + 1}`);
          }
        });
      }
    }
  };
  walk(SRC);
  assert.deepEqual(offenders, []);
});
