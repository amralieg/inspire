const test = require('node:test');
const assert = require('node:assert/strict');
const { launchCheckMs, raceLaunchCheck, launchCheckStalled, LAUNCH_CHECK_MS } = require('../lib/launchDeadline');

test('the launch check answers with its value well before the deadline, and the deadline is set by the environment', async () => {
  assert.equal(await raceLaunchCheck(Promise.resolve({ ok: true }), 5000).then((v) => v.ok), true);
  assert.equal(launchCheckMs({ INSPIRE_LAUNCH_CHECK_MS: '250' }), 250);
  assert.equal(launchCheckMs({ INSPIRE_LAUNCH_CHECK_MS: 'soon' }), LAUNCH_CHECK_MS, 'a bad value keeps the default');
  assert.equal(launchCheckMs({}), 120000);
});

test('a check that never answers rejects with a 504 reason after the deadline', async () => {
  const started = Date.now();
  await assert.rejects(raceLaunchCheck(new Promise(() => {}), 50), (err) => {
    assert.equal(err.statusCode, 504);
    assert.match(err.message, /so nothing was started/);
    return true;
  });
  assert.ok(Date.now() - started < 2000);
});

test('the stalled reason names minutes for the default deadline and seconds below a minute', () => {
  assert.match(launchCheckStalled(120000).message, /within 2 minutes/);
  assert.match(launchCheckStalled(300).message, /within 1 second,/);
  assert.match(launchCheckStalled(45000).message, /within 45 seconds/);
});

test('a check that fails keeps its own error, so the caller shows that reason', async () => {
  await assert.rejects(raceLaunchCheck(Promise.reject(new Error('warehouse says no')), 5000), /warehouse says no/);
});
