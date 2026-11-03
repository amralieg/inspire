const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const FIXTURE = require('./fixtures/implement_settings_refused.json');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

const stepRow = (phase, status, second, payload, message) => ({
  step_id: String(100 + second), session_id: '42', stage_name: 'Implement Use Cases', step_name: `Inspire is working on ${phase.toLowerCase()}`,
  sub_step_name: 'Completed: n01-u01', status, message, last_updated: `2026-10-31T10:00:0${second}.000Z`,
  result_json: ({ use_case_id: 'N01-U01', phase, spec_version: 3, event_at: `2026-10-31T10:00:0${second}+00:00`, ...payload }),
});

function refusedRun(row, { recorded = true } = {}) {
  const latest = {
    use_case_id: 'N01-U01', spec_version: 3, status: 'failed', status_message: row.refusal, created_at: '2026-10-31T10:00:00.000Z',
    spec_json: { outputs: { dashboard: true } }, asset_status: recorded ? { checklist: row.entries, checklist_summary: row.summary } : {},
  };
  const steps = [stepRow(FIXTURE.step, 'ended_error', 2, { checklist: row.entries, ...row.summary }, row.step_message),
    stepRow('Implement', 'ended_error', 3, { spec_version: 3 }, row.refusal)];
  return { latest, steps };
}

test('the fixture is the agent record of a refused settings change', async () => {
  const P = await lib('mvpProgress.js');
  assert.equal(P.SETTINGS_REFUSED, FIXTURE.kind);
  assert.equal(P.VIBE_CHECKLIST_PHASE, FIXTURE.step);
  assert.equal(FIXTURE.owner_refusal, '', 'an owner is never refused');
  assert.equal(FIXTURE.rows.length, 3);
  for (const row of FIXTURE.rows) {
    assert.ok(row.entries.length >= 2 && row.entries.every((e) => e.kind === FIXTURE.kind && e.status === 'refused' && e.evidence === row.refusal), row.name);
    assert.deepEqual(row.summary, { met: 0, total: row.entries.length, refused: row.entries.length });
  }
});

test('a refused settings change is its own kind on the checklist: never a vibe ask, never one to rephrase or publish anyway, with the agent headline and reason', async () => {
  const P = await lib('mvpProgress.js');
  const C = await lib('implementControl.js');
  for (const row of FIXTURE.rows) {
    for (const recorded of [true, false]) {
      const { latest, steps } = refusedRun(row, { recorded });
      const checklist = P.vibeChecklist(steps, latest);
      const where = `${row.name}${recorded ? '' : ', read from the step'}`;
      assert.deepEqual([checklist.total, checklist.met, checklist.refused, checklist.missed, checklist.unchecked], [0, 0, row.entries.length, 0, 0], where);
      assert.equal(P.checklistHeadline(checklist), row.step_message, `${where}: the agent step message, byte for byte`);
      assert.doesNotMatch(P.checklistHeadline(checklist), /vibe requirement/, where);
      for (const entry of checklist.entries) {
        assert.deepEqual([P.checklistState(entry), P.checklistStatusText(entry), entry.evidence], ['refused', 'Settings change refused', row.refusal], where);
      }
      assert.deepEqual([P.missedAsks(checklist), P.notMetAsks(checklist)], [[], []], `${where}: nothing to rephrase or publish anyway`);
      assert.deepEqual(C.rephraseOf(checklist, latest), { text: '', replaces: [] }, where);
    }
  }
});

test('the Build page step of a refused settings change is the settings change, and the reason the page gives is the agent refusal', async () => {
  const P = await lib('mvpProgress.js');
  const W = await lib('implementWizard.js');
  for (const row of FIXTURE.rows) {
    const { latest, steps } = refusedRun(row);
    const stages = P.mvpStages(steps, latest);
    assert.deepEqual([stages[0].id, stages[0].label, stages[0].state], ['Settings', 'Settings change', 'error'], row.name);
    assert.deepEqual(stages.filter((s) => s.state === 'error').map((s) => s.id), ['Settings'], `${row.name}: only the settings step failed`);
    assert.equal(W.statusReason(latest), row.refusal);
  }
  const failedVibe = { use_case_id: 'N01-U01', spec_version: 3, status: 'failed', status_message: 'the preview run failed', created_at: '2026-10-31T10:00:00.000Z',
    spec_json: { outputs: { dashboard: true } }, asset_status: {} };
  assert.ok(!P.mvpStages([], failedVibe).some((s) => s.id === 'Settings'), 'a build that failed for another reason has no settings step');
});

test('a checklist with a refused settings change reads the agent settings message, and a vibe ask beside it is still counted and missed', async () => {
  const P = await lib('mvpProgress.js');
  const [refused] = FIXTURE.rows[0].entries;
  const latest = { spec_version: 3, status: 'failed', asset_status: { checklist: [
    { n: 1, requirement: 'Put the riskiest customers first', part: '', where: '', status: 'met', evidence: 'sorted by risk', rounds: 1, tried: [], checks: [] },
    { n: 2, requirement: 'Answer in euros', part: '', where: '', status: 'not_met', evidence: 'in dollars', rounds: 3, tried: [], checks: [] },
    { ...refused, n: 3 }] } };
  const checklist = P.vibeChecklist(null, latest);
  assert.equal(P.checklistHeadline(checklist), `0 of 1 settings changes applied: ${refused.evidence}`, 'the agent refuses settings before it routes any vibe');
  assert.deepEqual([checklist.met, checklist.total], [1, 2]);
  assert.deepEqual(P.missedAsks(checklist).map((e) => e.requirement), ['Answer in euros']);
  const long = P.vibeChecklist(null, { spec_version: 3, asset_status: { checklist: [{ ...refused, evidence: `\u{1F600}${'x'.repeat(1600)}` }] } });
  assert.equal([...P.checklistHeadline(long)].length, 1500, 'cut at 1500 characters as the agent cuts its step message');
  assert.ok(P.checklistHeadline(long).startsWith('0 of 1 settings changes applied: \u{1F600}x'));
  const plain = P.vibeChecklist(null, { spec_version: 3, asset_status: { checklist: latest.asset_status.checklist.slice(0, 2) } });
  assert.equal(P.checklistHeadline(plain), '1 of 2 vibe requirements met', 'a checklist with no refused change reads as before');
});

test('the App refuses a settings change from someone who is not an owner with the same words the agent uses, for an App and for an MVP', async () => {
  const I = require('../lib/inspireImplement');
  const CLEAN = require('../../agent/tests/fixtures/implement_spec_parity.json').clean;
  const copy = (value) => JSON.parse(JSON.stringify(value));
  const lead = (row) => row.refusal.slice(0, row.refusal.indexOf(', and '));
  for (const [row, app] of [[FIXTURE.rows[0], true], [FIXTURE.rows[1], false]]) {
    const before = { ...copy(CLEAN), outputs: { ...copy(CLEAN.outputs), app, ...(app ? { app_name: 'churn-desk', app_access: 'sp' } : {}) } };
    const built = I.validateImplementSpec(before).spec;
    const history = [{ spec_version: 2, status: 'ready', created_by: 'owner@example.com', notebook_path: '/W/impl/N01-U01', spec_json: built,
      asset_status: { notebook: { state: 'ready', spec_version: 2, result_history: 1 }, settings: [{ name: 'top_k', source: 'widget' }] } }];
    const asked = I.validateImplementSpec({ ...copy(before), based_on_version: 2, config: { ...copy(before.config), widgets: { top_k: '12' } } }).spec;
    assert.throws(() => I.planSubmission(history, asked, null, { requester: 'someone.else@example.com' }), { message: lead(row), statusCode: 403 }, row.name);
  }
});
