// v1.5.3-rc.2 (REQ-164): a launch or build start that never answers ends with a reason, never a spinner forever.
import test from 'node:test';
import assert from 'node:assert/strict';
import { withStartDeadline, startDeadlineError } from '../src/lib/startDeadline.js';

test('a start the server never answers rejects with the reason after the deadline, and aborts the request', async () => {
  let signal = null;
  const started = Date.now();
  await assert.rejects(
    withStartDeadline((s) => { signal = s; return new Promise(() => {}); }, { ms: 60, label: 'Inspire' }),
    (err) => {
      assert.match(err.message, /did not answer within 1 minute/);
      assert.match(err.message, /check the Monitor page before you start it again/);
      return true;
    },
  );
  assert.ok(Date.now() - started < 2000, 'the spinner stops at the deadline, not when the server gives up');
  assert.equal(signal.aborted, true, 'the request is aborted at the deadline');
});

test('a start that fails names its own reason, so the user sees what the server said', async () => {
  await assert.rejects(
    withStartDeadline(async () => { throw new Error('Table scope names main.s.x, which is not picked'); }, { ms: 5000 }),
    /Table scope names main\.s\.x, which is not picked/,
  );
});

test('a start that answers in time returns its value and clears the deadline', async () => {
  const value = await withStartDeadline(async () => ({ run_id: '501' }), { ms: 5000 });
  assert.deepEqual(value, { run_id: '501' });
});

test('the deadline message states the minutes, singular or plural', () => {
  assert.match(startDeadlineError('Inspire', 240000).message, /within 4 minutes/);
  assert.match(startDeadlineError('Inspire', 60000).message, /within 1 minute\./);
});
