const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const TEXTS = require('./fixtures/released_main_texts.json');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const SIDES = ['released', 'agent'];
const UC = TEXTS.use_case_id;

test('the fixture holds the strings released main 4407364 writes and the ones the agent writes now, plurals included', () => {
  assert.equal(TEXTS.released.source, 'released main 4407364');
  assert.match(TEXTS.agent.source, /^[a-z][a-z0-9-]* [0-9a-f]{7}$/);
  assert.deepEqual(TEXTS.released.ready_messages.slice(0, 3), ['ready: preview wrote 0 row(s)', 'ready: preview wrote 1 row(s)', 'ready: preview wrote 3 row(s)']);
  assert.deepEqual(TEXTS.agent.ready_messages.slice(0, 3), ['ready: preview wrote 0 rows', 'ready: preview wrote 1 row', 'ready: preview wrote 3 rows']);
  assert.equal(TEXTS.released.log.split('\n').filter(Boolean).length, 11);
});

test('the Genie feed reads every log line released main 4407364 writes as it reads the lines the agent writes now', () => {
  const [released, agent] = SIDES.map((side) => I.genieFeed(TEXTS[side].log, UC));
  assert.deepEqual(released, agent);
  assert.deepEqual(released.map((item) => item.kind), ['activity', 'message', 'stopped', 'activity', 'error', 'turn_done', 'run', 'failed', 'note']);
  assert.deepEqual(released[0], { at: '2026-01-02T10:05:00Z', phase: 'Genie build', kind: 'activity', commands: 2, failed: 1, files: [], until: '2026-01-02T10:05:01Z' });
  assert.deepEqual(released.slice(1, 3).map((item) => [item.kind, item.text]),
    [['message', 'Built the notebook and ran it'], ['stopped', 'the table has no date column']]);
  assert.deepEqual(released[3].files, ['N01-U01.py', 'notes.md']);
  assert.deepEqual([released[6].run_id, released[6].seconds, released[6].state, released[6].result], ['2222222222222222222', 60, 'TERMINATED', 'SUCCESS']);
  assert.deepEqual(released.slice(7).map((item) => [item.kind, item.text]),
    [['failed', 'the preview run did not write rows: stopped'], ['note', 'Wrote the notebook N01-U01']]);
  assert.deepEqual(I.genieFeed(TEXTS.released.log, 'N02-U01'), [], 'a line of another use case is never read as this one');
  assert.deepEqual(I.genieFeed(TEXTS.released.log.replace(/ - INFO - /g, ' INFO '), UC).length, 1, 'a line that is not in the log format is skipped');
});

test('a ready status message reads as quiet in its released main 4407364 form and in the form the agent writes now', async () => {
  const W = await lib('implementWizard.js');
  for (const side of SIDES) {
    assert.equal(TEXTS[side].ready_messages.length, 6);
    for (const message of TEXTS[side].ready_messages) {
      assert.equal(W.statusReason({ status: 'ready', status_message: message }), '', `${side}: ${message}`);
      assert.equal(W.statusReason({ status: 'ready_with_warnings', status_message: message }), message, 'the same text after a warning is the reason');
    }
  }
});

test('a step named the released main 4407364 way puts its stage where the agent step does, and an App it tagged is this use case\u2019s', async () => {
  const P = await lib('mvpProgress.js');
  const latest = { status: 'previewing', created_at: '2026-01-02T10:00:00.000Z', spec_json: { outputs: { dashboard: true } } };
  const [released, agent] = SIDES.map((side) => P.mvpStages([{ step_id: 1, step_name: TEXTS[side].step_name, sub_step_name: 'Completed: n01-u01', status: 'ended_success',
    last_updated: '2026-01-02T10:04:00.000Z', result_json: '{}' }], latest, { now: Date.parse('2026-01-02T10:05:00Z') }).map((s) => [s.id, s.state]));
  assert.deepEqual(released, agent);
  assert.deepEqual(released.find(([id]) => id === 'Genie build'), ['Genie build', 'done']);
  for (const side of SIDES) {
    assert.equal(TEXTS[side].app_tag, I.appOwnerTag(UC, TEXTS.session_id), side);
    const app = I.appStatusFrom({ ok: true, status: 200, data: { name: 'churn-desk', description: `${TEXTS[side].app_tag}: Predict churn` } },
      { useCaseId: UC, sessionId: TEXTS.session_id });
    assert.equal(app.ok, true, `${side}: ${JSON.stringify(app)}`);
  }
  const other = I.appStatusFrom({ ok: true, status: 200, data: { name: 'churn-desk', description: `${I.appOwnerTag('N02-U01', TEXTS.session_id)}: Other` } },
    { useCaseId: UC, sessionId: TEXTS.session_id });
  assert.equal(other.ok, false, 'an App another use case tagged is not this one');
});

test('the execution pattern of a use case mandate released main 4407364 wrote reads as the family the agent writes now', () => {
  assert.deepEqual(Object.keys(TEXTS.released.mandates), ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H']);
  for (const side of SIDES) {
    for (const [family, line] of Object.entries(TEXTS[side].mandates)) {
      assert.equal(I.executionFamily(`${line}\nThe rest of the mandate.`), family, `${side}: ${line}`);
    }
  }
  assert.equal(I.executionFamily('The rest of the mandate.\nExecution pattern: family B, Anomaly scoring.'), '', 'only a mandate that starts with the pattern names one');
});
