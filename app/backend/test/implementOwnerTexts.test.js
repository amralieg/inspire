const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const I = require('../lib/inspireImplement');
const FIXTURE = require('./fixtures/implement_owner_texts.json');

const wizard = () => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'implementWizard.js')).href);
const lowerFirst = (text) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

test('the owners of a use case are the set the agent writes into use_case_owners, compared the way the agent compares them', () => {
  assert.equal(FIXTURE.owners.length, 6);
  for (const { row, owners } of FIXTURE.owners) assert.deepEqual(I.implementOwners(row), owners, JSON.stringify(row));
  const bom = FIXTURE.owners[2];
  assert.deepEqual(bom.owners, ['\ufeffbom@example.com'], 'a BOM is no space to the agent, so it is kept');
});

test('the App refuses a settings change with the agent\u2019s own owner words, and lets an owner through', () => {
  assert.equal(I.IMPLEMENT_SETTINGS_OWNERS, FIXTURE.settings_owners);
  for (const { live, requester, refusal } of FIXTURE.refusals) {
    const before = { spec_version: live, created_by: 'owner@example.com', spec_json: { outputs: { app_owners: [], app: live === 1 } } };
    const got = I.implementSettingsOwnerRefusal(before, requester);
    if (!refusal) {
      assert.equal(got, null);
      continue;
    }
    const lead = FIXTURE.settings_owners.replace('{live}', String(live));
    assert.ok(refusal.startsWith(`${lead}, and `), refusal);
    if (requester) assert.deepEqual(got, { status: 403, message: lead }, 'whether the use case has an App or not');
    else assert.deepEqual(got, { status: 403, message: 'Inspire could not tell who you are, so it cannot check that you own this MVP' });
  }
});

test('the wizard says what owners of a use case may do in the App as the agent now lets them, and names the kept record tag as the App shows it', async () => {
  const w = await wizard();
  const [, , runOwners] = FIXTURE.run_words;
  assert.equal(runOwners, 'Only the owners of this use case can run it now');
  assert.ok(w.APP_REFRESH_NOTE.includes(lowerFirst(runOwners)), w.APP_REFRESH_NOTE);
  assert.ok(w.APP_REFRESH_NOTE.includes(FIXTURE.settings_owners.split(': ')[1].replace('asked for v{live}', 'asks for this version')), w.APP_REFRESH_NOTE);
  assert.doesNotMatch(w.APP_REFRESH_NOTE, /anyone who can open it/, 'a shared App no longer lets anyone refresh it');
  assert.equal(w.KEPT_RECORD_TAG, FIXTURE.kept_tag);
  assert.ok(w.REPLACE_EDITS_CHOICES[0].blurb.endsWith(`tagged ${FIXTURE.kept_tag}.`), w.REPLACE_EDITS_CHOICES[0].blurb);
  assert.match(w.APP_OWNERS_HELP, /settings and assumptions in the App and run it now/);
  assert.equal(FIXTURE.setting_words[2], 'Only the owners of this use case can change its settings');
  assert.equal(FIXTURE.assumption_words[2], 'Only the owners of this use case can change its assumptions');
  assert.equal(FIXTURE.use_case_owners_max, w.APP_OWNERS_MAX + 1, 'the asker and at most 50 App owners fit the App\u2019s use_case_owners');
});
