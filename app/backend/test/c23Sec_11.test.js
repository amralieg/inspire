// SEC-11 (c23 security audit): a business profile is overwritten only by the person who last updated it or by an App manager.
const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const SETTINGS = { version: 1, params: { '00_business_name': 'Acme' }, tableScopes: {}, priorityChecks: {}, relationships: 'keep' };
const save = (person, extra = {}) => S.request('POST', '/api/inspire/profiles', { person, body: { name: 'Acme', spec: SETTINGS, ...extra } });

test('SEC-11: another App user cannot overwrite a profile, and the stored profile is unchanged', async () => {
  S.reset();
  await save('amr@example.com');
  const changed = { ...SETTINGS, params: { '00_business_name': 'Hijacked' } };
  const got = await save('colleague@example.com', { overwrite: true, spec: changed });
  assert.equal(got.status, 403, got.text);
  assert.equal(JSON.parse(S.state.profiles[0].spec_json).params['00_business_name'], 'Acme');
});

test('SEC-11: the person who last updated the profile, and an App manager, can overwrite it', async () => {
  S.reset();
  await save('amr@example.com');
  assert.equal((await save('amr@example.com', { overwrite: true })).status, 200);
  S.state.managers = ['boss@example.com'];
  const got = await save('boss@example.com', { overwrite: true, spec: { ...SETTINGS, params: { '00_business_name': 'Boss' } } });
  assert.equal(got.status, 200, got.text);
  assert.equal(JSON.parse(S.state.profiles[0].spec_json).params['00_business_name'], 'Boss');
});
