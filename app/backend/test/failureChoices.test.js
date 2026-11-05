const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

const ROUNDS = [
  { attempt: 1, error: 'run_use_case() returned None', repair: 'rebuild_with_error', why: 'the notebook failed when it ran' },
  { attempt: 2, error: 'run_use_case() returned None', repair: 'stop', why: 'the same failure came back' },
];
const failed = (extra = {}, spec_version = 3) => ({
  status: 'ended_error', last_updated: '2026-01-02T10:10:00.000Z', step_name: 'Inspire is working on implement',
  result_json: { phase: 'Implement', use_case_id: 'N01-U01', spec_version, attempts: 2, repair_rounds: ROUNDS, terminal: true, ...extra },
});
const latest = (spec = {}) => ({ status: 'failed', spec_version: 3, spec_json: { config: { profiles: { preview: { entity_cap: 1000 } } }, ...spec } });

test('the failure rounds read in plain words, newest Implement failure of this version only', async () => {
  const { mvpFailureOf } = await lib('mvpProgress.js');
  const got = mvpFailureOf([failed()], latest());
  assert.equal(got.terminal, true);
  assert.deepEqual(got.rounds.map((r) => [r.attempt, r.repair]), [[1, 'rebuild_with_error'], [2, 'stop']]);
  assert.match(got.rounds[0].tried, /Genie rebuild the notebook with this error/);
  assert.doesNotMatch(got.rounds.map((r) => r.tried).join(' '), /rebuild_with_error|smaller_query|contact|ticket|support/i);
  assert.equal(mvpFailureOf([failed({}, 2)], latest()), null, 'an older version does not speak for this one');
  assert.equal(mvpFailureOf([{ ...failed(), status: 'ended_success' }], latest()), null);
  assert.equal(mvpFailureOf([failed({ repair_rounds: 'x' })], latest()), null);
  assert.equal(mvpFailureOf([failed({ terminal: 'yes' })], latest()).terminal, false, 'only a real true is terminal');
  assert.equal(mvpFailureOf([], latest()), null);
});

test('the notebook choice and the wizard ask for the same notebook request', async () => {
  const { genieNotebookRequest } = await lib('implementWizard.js');
  assert.deepEqual(genieNotebookRequest({ inspireDatabase: 'c.s', warehouseId: 'w', sessionId: 12, useCaseId: 'N01-U01', notebookPath: '/x' }),
    { inspire_database: 'c.s', warehouse_id: 'w', session_id: '12', use_case_ids: ['N01-U01'], notebook_path: '/x' });
  assert.equal('notebook_path' in genieNotebookRequest({ inspireDatabase: 'c.s', warehouseId: 'w', sessionId: 1, useCaseId: 'u', notebookPath: '' }), false,
    'an empty notebook path is left out');
});

test('the choices change the spec, never resend it as it was, and never tell the user to contact anyone', async () => {
  const { failureChoices } = await lib('implementWizard.js');
  const choices = failureChoices(latest(), { technique: 'XGBoost', notebookUrl: 'https://h/#notebook/1' });
  assert.deepEqual(choices.map((c) => c.id), ['smaller', 'technique', 'notebook', 'ask']);
  assert.ok(choices.length >= 2 && choices.length <= 4);
  const smaller = choices[0];
  assert.equal(smaller.changes.config.profiles.preview.entity_cap, 200);
  assert.match(smaller.detail, /200 entities instead of 1000/);
  assert.match(choices[1].seed.text, /simpler analytical technique than XGBoost/);
  assert.equal(choices[2].url, 'https://h/#notebook/1');
  assert.doesNotMatch(JSON.stringify(choices), /contact|ticket|support|—/i);
  assert.deepEqual(failureChoices(latest({ config: { profiles: { preview: { entity_cap: 1 } } } })).map((c) => c.id), ['technique', 'notebook', 'ask'],
    'a first run of one entity cannot get smaller');
  assert.deepEqual(failureChoices(latest({ config: {} })).map((c) => c.id), ['technique', 'notebook', 'ask']);
  assert.equal(failureChoices(latest(), {})[2].url, '');
  assert.equal(failureChoices(latest({ config: { profiles: { preview: { entity_cap: 7 } } } }))[0].changes.config.profiles.preview.entity_cap, 1);
});
