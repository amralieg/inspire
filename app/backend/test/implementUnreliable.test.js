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
    assert.equal(said, `The latest run marked its results not reliable: ${REASON}. The App is not published until a run can be trusted. `
      + 'Next step: fix what it names, then build again with Vibe/Add/Remove Features.');
  }
  const groups = W.implementGroups([{ id: 'N01-U01', Name: 'x' }], [row('ready_with_warnings', { reason: REASON, spec_version: 3 })], null);
  assert.equal(groups.find((g) => g.id === 'attention').items.length, 1, 'it sits under Needs attention, not Ready');
  assert.equal(groups.find((g) => g.id === 'ready').items.length, 0);
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
