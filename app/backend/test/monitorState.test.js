const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const SRC = path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib');
const lib = (name) => import(pathToFileURL(path.join(SRC, name)).href);

const NOW = Date.parse('2026-11-02T05:00:00.000Z');
const MINUTE = 60 * 1000;
const at = (ms) => new Date(NOW - ms).toISOString();

test('processing_status never decides whether a session finished: completed_on or 100 percent does', async () => {
  const M = await lib('monitorState.js');
  for (const processing of ['done', 'ready', 'running', 'FAILED', null]) {
    assert.equal(M.sessionFinished({ processing_status: processing, completed_percent: 37, completed_on: null }), false, String(processing));
    assert.equal(M.sessionFinished({ processing_status: processing, completed_percent: 100, completed_on: null }), true, String(processing));
    assert.equal(M.sessionFinished({ processing_status: processing, completed_percent: 99, completed_on: '2026-11-02T04:00:00Z' }), true, String(processing));
  }
  assert.equal(M.sessionFinished({ completed_percent: '100.0' }), true, 'the SQL API sends numbers as text');
  assert.equal(M.sessionFinished({ completed_percent: '99.0' }), false);
  assert.equal(M.sessionFinished(null), false);
  assert.equal(M.sessionFinished({}), false);
});

test('a session is quiet only after the bound passes with no news, and never once finished', async () => {
  const M = await lib('monitorState.js');
  assert.equal(M.SESSION_QUIET_AFTER_MS, 30 * MINUTE);
  const open = (lastUpdated, extra = {}) => ({ completed_percent: 40, completed_on: null, last_updated: lastUpdated, ...extra });
  assert.equal(M.sessionQuietSince(open(at(30 * MINUTE)), NOW), null, 'exactly the bound is not quiet');
  assert.equal(M.sessionQuietSince(open(at(30 * MINUTE + 1)), NOW), at(30 * MINUTE + 1));
  assert.equal(M.sessionQuietSince(open(at(MINUTE)), NOW), null);
  assert.equal(M.sessionQuietSince(open(at(5 * 60 * MINUTE), { completed_on: at(5 * 60 * MINUTE) }), NOW), null, 'a finished run is never quiet');
  assert.equal(M.sessionQuietSince(open(at(5 * 60 * MINUTE), { completed_percent: 100 }), NOW), null);
  assert.equal(M.sessionQuietSince(open('2026-11-02 04:00:00'), NOW), '2026-11-02T04:00:00.000Z', 'a time with no zone is UTC');
  assert.equal(M.sessionQuietSince(open('', { create_at: at(2 * 60 * MINUTE) }), NOW), at(2 * 60 * MINUTE), 'no update yet falls back to the creation time');
  assert.equal(M.sessionQuietSince(open('not a time'), NOW), null);
  assert.equal(M.sessionQuietSince(open(at(2 * 60 * MINUTE)), null), null, 'no clock yet, no verdict');
  assert.equal(M.sessionQuietSince(open(at(2 * 60 * MINUTE)), NOW, 3 * 60 * MINUTE), null, 'the bound can be given');
  assert.equal(M.sessionQuietSince(null, NOW), null);
});

test('sessionStatus names each state and a quiet run is not running', async () => {
  const M = await lib('monitorState.js');
  assert.equal(M.sessionStatus(null, NOW), 'none');
  assert.equal(M.sessionStatus({ completed_percent: 1, processing_status: 'done', last_updated: at(MINUTE) }, NOW), 'running');
  assert.equal(M.sessionStatus({ completed_percent: 62, processing_status: 'ready', last_updated: at(40 * MINUTE) }, NOW), 'quiet');
  assert.equal(M.sessionStatus({ completed_percent: 100, completed_on: at(40 * MINUTE), processing_status: 'ready', last_updated: at(40 * MINUTE) }, NOW), 'finished');
});

test('a run that ended with an error is failed, never completed, and its completed_on only means it ended', async () => {
  const M = await lib('monitorState.js');
  assert.equal(M.SESSION_FAILED, 'failed');
  const failed = { completed_percent: 42, completed_on: at(MINUTE), processing_status: 'failed', last_updated: at(MINUTE) };
  assert.deepEqual([M.sessionFinished(failed), M.sessionFailed(failed), M.sessionSucceeded(failed)], [true, true, false]);
  assert.equal(M.sessionStatus(failed, NOW), 'failed');
  assert.equal(M.sessionStatus({ ...failed, processing_status: 'FAILED' }, NOW), 'failed', 'the status is read without case');
  for (const processing of ['ready', 'done', null]) {
    const ended = { ...failed, processing_status: processing };
    assert.deepEqual([M.sessionFailed(ended), M.sessionSucceeded(ended)], [false, true], String(processing));
    assert.equal(M.sessionStatus(ended, NOW), 'finished', String(processing));
  }
  const open = { completed_percent: 42, completed_on: null, processing_status: 'failed', last_updated: at(MINUTE) };
  assert.deepEqual([M.sessionFailed(open), M.sessionSucceeded(open)], [false, false], 'a run still open has not failed yet');
  assert.deepEqual([M.sessionFailed(null), M.sessionSucceeded(null)], [false, false]);
});

test('the quiet line names the UTC time, and the day when it is not today', async () => {
  const M = await lib('monitorState.js');
  assert.equal(M.quietLine('2026-11-02T03:04:59Z', NOW), 'No news from this run since 03:04 UTC.');
  assert.equal(M.quietLine('2026-11-01T23:30:00Z', NOW), 'No news from this run since Nov 1, 23:30 UTC.');
  assert.equal(M.quietLine('2025-11-02T03:04:00Z', NOW), 'No news from this run since Nov 2, 03:04 UTC.', 'the same date a year ago is not today');
  const W = await lib('formatWhen.js');
  assert.equal(W.formatClockUtc('', NOW), '');
  assert.equal(W.formatClockUtc('2026-11-02T00:00:00+04:00', NOW), 'Nov 1, 20:00 UTC');
  assert.equal(W.formatClockUtc('2026-11-02T03:04:00Z', Number.NaN), 'Nov 2, 03:04 UTC');
});

test('formatDay reads the same times as before the UTC helper was shared', async () => {
  const W = await lib('formatWhen.js');
  assert.equal(W.formatDay('2026-11-02'), 'Nov 2, 2026');
  assert.equal(W.formatDay('2026-11-02 23:30:00'), 'Nov 2, 2026');
  assert.equal(W.formatDay('2026-11-02T23:30:00.5'), 'Nov 2, 2026');
  assert.equal(W.formatDay('2026-11-02T23:30:00-05:00'), 'Nov 3, 2026');
  assert.equal(W.formatDay('', 'none'), 'none');
  assert.equal(W.formatDay('bad', 'none'), 'none');
  assert.equal(W.utcDate(null), null);
  assert.equal(W.utcDate('2026-11-02T03:40:12.123456+00:00').toISOString(), '2026-11-02T03:40:12.123Z');
});

test('a step that has not ended is in progress only while the run is live', async () => {
  const M = await lib('monitorState.js');
  for (const status of ['started', 'running', '', null, 'queued']) {
    assert.equal(M.stepCategory(status, true), 'running', String(status));
    assert.equal(M.stepCategory(status, false), 'open', String(status));
  }
  for (const live of [true, false]) {
    assert.equal(M.stepCategory('ended_success', live), 'success');
    assert.equal(M.stepCategory('completed', live), 'success');
    assert.equal(M.stepCategory('ended_warning', live), 'warning');
    assert.equal(M.stepCategory('ended_error', live), 'error');
    assert.equal(M.stepCategory('failed', live), 'error');
  }
});

const row = (id, status, lastUpdated, eventAt) => ({ step_id: id, status, last_updated: lastUpdated, result_json: eventAt === undefined ? {} : { event_at: eventAt } });

test('mergeSteps keeps the latest event of each step, and its end when two rows tie', async () => {
  const M = await lib('monitorState.js');
  const flush = '2026-11-02T03:10:06.000Z';
  const ended = row('9', 'ended_success', flush, '2026-11-02T03:10:05.250000+00:00');
  const started = row('9', 'started', flush, '2026-11-02T03:10:01.000000+00:00');
  assert.deepEqual(M.mergeSteps([], [ended, started]).map((s) => s.status), ['ended_success'], 'by event time');
  assert.deepEqual(M.mergeSteps([], [started, ended]).map((s) => s.status), ['ended_success']);
  assert.deepEqual(M.mergeSteps([ended], [started]).map((s) => s.status), ['ended_success'], 'across polls too');
  const tieEnd = row('9', 'ended_warning', flush);
  const tieStart = row('9', 'started', flush);
  assert.deepEqual(M.mergeSteps([], [tieEnd, tieStart]).map((s) => s.status), ['ended_warning'], 'same flush time: the end wins');
  assert.deepEqual(M.mergeSteps([], [tieStart, tieEnd]).map((s) => s.status), ['ended_warning']);
  const sameTime = '2026-11-02T03:10:02.000000+00:00';
  assert.deepEqual(M.mergeSteps([], [row('9', 'started', flush, sameTime), row('9', 'ended_error', flush, sameTime)]).map((s) => s.status), ['ended_error']);
});

test('mergeSteps never lets an earlier event replace a later one, whatever its status', async () => {
  const M = await lib('monitorState.js');
  const earlyEnd = row('3', 'ended_success', '2026-11-02T03:00:02.000Z', '2026-11-02T03:00:01.000000+00:00');
  const laterStart = row('3', 'started', '2026-11-02T03:00:09.000Z', '2026-11-02T03:00:08.000000+00:00');
  assert.deepEqual(M.mergeSteps([], [laterStart, earlyEnd]).map((s) => s.status), ['started'], 'time beats status');
  const warning = row('4', 'ended_warning', '2026-11-02T03:00:09.000Z', '2026-11-02T03:00:08.000000+00:00');
  const success = row('4', 'ended_success', '2026-11-02T03:00:02.000Z', '2026-11-02T03:00:01.000000+00:00');
  assert.deepEqual(M.mergeSteps([warning], [success]).map((s) => s.status), ['ended_warning'], 'a late answer with an older row does not win');
  const noEvent = row('5', 'started', '2026-11-02T03:00:01.000Z');
  const laterFlush = row('5', 'ended_success', '2026-11-02T03:00:03.000Z');
  assert.deepEqual(M.mergeSteps([laterFlush], [noEvent]).map((s) => s.status), ['ended_success'], 'with no event time the flush time decides');
});

test('mergeSteps keeps one row per step id, numeric or text, sorted by flush time', async () => {
  const M = await lib('monitorState.js');
  const merged = M.mergeSteps([row(2, 'started', '2026-11-02T03:00:05.000Z')], [
    row('2', 'ended_success', '2026-11-02T03:00:06.000Z'), row('1', 'ended_success', '2026-11-02T03:00:01.000Z'),
  ]);
  assert.deepEqual(merged.map((s) => [String(s.step_id), s.status]), [['1', 'ended_success'], ['2', 'ended_success']]);
  assert.deepEqual(M.mergeSteps(null, null), []);
  assert.deepEqual(M.mergeSteps(undefined, [row('7', 'started', '')]).map((s) => s.status), ['started']);
});

test('the run time comes from run_duration, then start to end, and counts up while the run goes on', async () => {
  const M = await lib('monitorState.js');
  assert.equal(M.runElapsedMs({ run_duration: 3723000, execution_duration: 0, start_time: 1, end_time: 2 }, NOW), 3723000);
  assert.equal(M.runElapsedMs({ run_duration: 0, execution_duration: 0, start_time: NOW - 20 * MINUTE, end_time: NOW - 5 * MINUTE }, NOW), 15 * MINUTE);
  assert.equal(M.runElapsedMs({ execution_duration: 4000 }, NOW), 4000);
  assert.equal(M.runElapsedMs({ start_time: NOW - 9 * 60 * MINUTE, end_time: 0, execution_duration: 0 }, NOW), 9 * 60 * MINUTE);
  assert.equal(M.runElapsedMs({ start_time: NOW + MINUTE }, NOW), null, 'a clock behind the run start shows no time, never a negative one');
  assert.equal(M.runElapsedMs({}, NOW), null);
  assert.equal(M.runElapsedMs(null, NOW), null);
});
