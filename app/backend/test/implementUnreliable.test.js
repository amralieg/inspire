const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const REASON = 'the data ends on 2024-05-17, so this run has no recent records to judge';
const row = (status, held, version = 3) => ({ use_case_id: 'N01-U01', spec_version: version, status, asset_status: held === undefined ? {} : { not_reliable: held } });

test('a build whose run is not reliable is never shown as ready, and says why and the one next step (must-exclude)', async () => {
  const W = await lib('implementWizard.js');
  for (const status of ['ready', 'ready_with_warnings']) {
    const state = W.implementState(row(status, { reason: REASON, spec_version: 3 }));
    assert.deepEqual(state, { group: 'held', label: W.UNRELIABLE_LABEL, tone: 'warning', kind: 'mvp' }, status);
    assert.doesNotMatch(state.label, /ready/i);
    const said = W.statusReason(row(status, { reason: REASON, spec_version: 3 }));
    assert.equal(said, `The latest run's results are not reliable yet: ${REASON}. The App is not published until a run passes. `
      + 'Next step: change the data or the method so the run passes what it missed, then build again with Vibe/Add/Remove Features.');
  }
  const groups = W.implementGroups([{ id: 'N01-U01', Name: 'x' }], [row('ready_with_warnings', { reason: REASON, spec_version: 3 })], null);
  assert.equal(groups.find((g) => g.id === 'attention').items.length, 1, 'it sits under Needs attention, not Ready');
  assert.equal(groups.find((g) => g.id === 'ready').items.length, 0);
});

test('a first build whose run is not reliable says the App is published with the banner, and an App held back says so (must-exclude)', async () => {
  const W = await lib('implementWizard.js');
  const said = W.statusReason(row('ready_with_warnings', { reason: REASON, spec_version: 3, app: W.UNTRUSTED_APP_PUBLISHED, monitor: true }));
  assert.equal(said, `The latest run's results are not reliable yet: ${REASON}. The App is published with a Results not trusted yet banner `
    + 'and every row in Monitor until a run passes. Next step: change the data or the method so the run passes what it missed, then build again with Vibe/Add/Remove Features.');
  assert.doesNotMatch(said, /not published/);
  const stopped = W.statusReason(row('ready_with_warnings', { reason: REASON, spec_version: 3, app: W.UNTRUSTED_APP_PUBLISHED }));
  assert.match(stopped, /The App is published with a Results not trusted yet banner until a run passes/);
  assert.doesNotMatch(stopped, /Monitor/, 'no claim about the rows when the run did not show they are all Monitor');
  const held = W.statusReason(row('ready_with_warnings', { reason: REASON, spec_version: 3 }));
  assert.match(held, /The App is not published until a run passes/);
  assert.equal(W.UNTRUSTED_BANNER, 'Results not trusted yet');
  assert.equal(W.UNTRUSTED_APP_PUBLISHED, 'published', 'the agent writes this value');
});

test('a reliable run, an older version hold or a blank reason keeps the ready status', async () => {
  const W = await lib('implementWizard.js');
  assert.equal(W.implementState(row('ready')).label, 'MVP ready');
  assert.equal(W.implementState(row('ready', { reason: REASON, spec_version: 2 })).label, 'MVP ready', 'a hold recorded by an older version is gone');
  assert.equal(W.implementState(row('ready_with_warnings', { reason: '  ', spec_version: 3 })).label, 'MVP ready with warnings');
  assert.equal(W.unreliableHold(row('failed', { reason: REASON, spec_version: 3 })), REASON);
  assert.equal(W.implementState(row('failed', { reason: REASON, spec_version: 3 })).label, 'MVP failed', 'a failed build stays failed');
  assert.equal(W.NOT_RELIABLE_RECORD, 'not_reliable', 'the agent writes this record');
});

test('a build that just started says so in words, never the job run link or a bare run id (rc.4 live R38)', async () => {
  const W = await lib('implementWizard.js');
  const I = require('../lib/inspireImplement');
  const live = 'https://adb-1111111111111111.11.azuredatabricks.net/#job/222222222222222/run/333333333333333';
  assert.equal(W.shownStatusMessage({ status_message: live }), '', 'a row written before this release still hides its link');
  assert.equal(W.shownStatusMessage({ status_message: 'run 333333333333333' }), '');
  assert.equal(W.shownStatusMessage({ status_message: ` ${I.IMPLEMENT_RUN_STARTED_MESSAGE} ` }), I.IMPLEMENT_RUN_STARTED_MESSAGE);
  assert.equal(W.shownStatusMessage({ status_message: 'Genie stopped the build: see https://x/y for the run' }), 'Genie stopped the build: see https://x/y for the run');
  const started = I.implementRunStartedStatement('t', { sessionId: 1, useCaseId: 'N01-U01', specVersion: 1, runId: '5', message: I.IMPLEMENT_RUN_STARTED_MESSAGE });
  assert.equal(started.parameters[1].value, 'Inspire started building this version.');
  const routes = require('node:fs').readFileSync(path.resolve(__dirname, '..', 'implementRoutes.js'), 'utf8');
  assert.match(routes, /implementRunStartedStatement\(table, \{ \.\.\.version, runId: out\.run_id, message: I\.IMPLEMENT_RUN_STARTED_MESSAGE \}\)/);
  assert.doesNotMatch(routes, /message: out\.job_run_url/);
});
