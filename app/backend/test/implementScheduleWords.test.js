const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = () => import(pathToFileURL(path.join(__dirname, '..', '..', 'frontend', 'src', 'lib', 'implementControl.js')).href);

test('a job schedule reads in plain words on the Build page, never as a cron expression', async () => {
  const { scheduleWords, controlRows } = await lib();
  assert.equal(scheduleWords('0 0 6 * * ?'), 'every day at 06:00');
  assert.equal(scheduleWords('0 0 6 ? * MON'), 'every Monday at 06:00');
  assert.equal(scheduleWords('0 30 7 ? * 2'), 'every Monday at 07:30');
  assert.equal(scheduleWords('0 0 18 ? * MON,WED,FRI'), 'every Monday, Wednesday and Friday at 18:00');
  assert.equal(scheduleWords('0 0 6 ? * * *'), 'every day at 06:00');
  const live = { targets: { job: '305' }, assets: { job: { ok: true, schedule: { cron: '0 0 6 ? * MON', timezone: 'UTC', paused: false }, active_runs: [] } } };
  const job = controlRows(live, { spec_version: 1, status: 'ready', spec_json: { schedule: { enabled: true } } }).find((r) => r.id === 'job');
  assert.equal(job.detail, 'Scheduled: every Monday at 06:00 (UTC)');
  assert.doesNotMatch(job.detail, /\?|\*/);
});

test('a schedule the words cannot say exactly stays as it is written, never a wrong guess (must-exclude)', async () => {
  const { scheduleWords } = await lib();
  for (const cron of ['0 0/15 * * * ?', '0 0 6 1 * ?', '0 0 6 ? 1 MON', '0 0 6 ? * MON-FRI', '15 0 6 * * ?', '0 0 6 ? * MON 2027', '0 0 6 ? * XYZ', 'every day', '']) {
    assert.equal(scheduleWords(cron), cron, cron);
  }
  assert.equal(scheduleWords(null), '');
});
