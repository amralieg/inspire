const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const LIST = `/api/inspire/sessions?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}&all=1`;
const SETTINGS = { version: 1, params: { '00_business_name': 'Acme', '03_discovery_type': 'Deep' }, tableScopes: {}, priorityChecks: { growth: true }, relationships: 'keep' };
const runParams = (sid, business = 'Acme') => ({ params: { '00_business_name': business, '02_inspire_database': S.APP_DB, '14_session_id': sid, '15_operation': 'Discover Use Cases' } });

async function save(body, person = 'amr@example.com') {
  return S.request('POST', '/api/inspire/profiles', { person, body });
}

test('a profile saved on the App is listed for everyone, shows who saved it and when, and reads back with every key of the form', async () => {
  S.reset();
  const made = await save({ name: 'Acme retail', spec: SETTINGS });
  assert.equal(made.status, 200, made.text);
  assert.equal(made.data.profile.name, 'Acme retail');
  assert.equal(made.data.profile.updated_by, 'amr@example.com');
  const id = made.data.profile.profile_id;
  assert.match(id, /^[0-9a-f-]{36}$/, 'the id is an opaque uuid, not a number');

  const listed = await S.request('GET', '/api/inspire/profiles?business_name=ACME', { person: 'colleague@example.com' });
  assert.equal(listed.status, 200, listed.text);
  assert.deepEqual(listed.data.profiles.map((p) => [p.name, p.business_name, p.updated_by]), [['Acme retail', 'Acme', 'amr@example.com']]);

  const got = await S.request('GET', `/api/inspire/profiles/${id}`, { person: 'colleague@example.com' });
  assert.equal(got.status, 200, got.text);
  assert.deepEqual(got.data.profile.spec, SETTINGS, 'the relationships key and the priority checks ride along unchanged');
});

test('a name that is already taken answers 409 and changes nothing, and overwrite replaces the settings (must-fail, must-keep)', async () => {
  S.reset();
  const first = await save({ name: 'Acme', spec: SETTINGS });
  const refused = await save({ name: 'acme', spec: { ...SETTINGS, params: { '00_business_name': 'Other' } } });
  assert.equal(refused.status, 409, refused.text);
  assert.deepEqual([refused.data.exists, refused.data.profile_id], [true, first.data.profile.profile_id]);
  assert.equal(S.state.profiles.length, 1, 'the refused save wrote nothing');
  assert.equal(S.state.profiles[0].business_name, 'Acme');

  const replaced = await save({ name: 'Acme', spec: { ...SETTINGS, params: { '00_business_name': 'Other' } }, overwrite: true });
  assert.equal(replaced.status, 200, replaced.text);
  assert.equal(replaced.data.profile.profile_id, first.data.profile.profile_id, 'the same profile, not a second one');
  assert.equal(S.state.profiles.length, 1);
  assert.equal(JSON.parse(S.state.profiles[0].spec_json).params['00_business_name'], 'Other');
});

test('a manager may replace a profile somebody else saved (SEC-11; other people are refused, see c23Sec_11): the replacement keeps the id and names the person who updated it last (must-keep)', async () => {
  S.reset();
  S.state.managers = ['colleague@example.com'];
  const first = await save({ name: 'Acme', spec: SETTINGS }, 'amr@example.com');
  const replaced = await save({ name: 'ACME', spec: { ...SETTINGS, params: { '00_business_name': 'Other' } }, overwrite: true }, 'colleague@example.com');
  assert.equal(replaced.status, 200, replaced.text);
  assert.equal(replaced.data.profile.profile_id, first.data.profile.profile_id);
  assert.equal(replaced.data.profile.updated_by, 'colleague@example.com', 'the last person to update it is named');
  const listed = await S.request('GET', '/api/inspire/profiles', { person: 'reader@example.com' });
  assert.deepEqual(listed.data.profiles.map((p) => [p.name, p.updated_by]), [['ACME', 'colleague@example.com']]);
  assert.equal(Object.hasOwn(listed.data.profiles[0], 'saved_by'), false, 'the list uses the updated_by name');
});

test('a save with no name, no settings or a bad profile id is refused before it touches the tables (must-fail)', async () => {
  S.reset();
  assert.equal((await save({ name: '  ', spec: SETTINGS })).status, 400);
  assert.equal((await save({ name: 'Acme', spec: 'not an object' })).status, 400);
  const bad = await S.request('GET', '/api/inspire/profiles/not%20an%20id', { person: 'amr@example.com' });
  assert.equal(bad.status, 400, bad.text);
  const missing = await S.request('GET', '/api/inspire/profiles/3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b', { person: 'amr@example.com' });
  assert.equal(missing.status, 404, missing.text);
  assert.equal(S.state.profiles.length, 0, 'no refused save wrote a row');
});

test('a run started with a profile is linked to it, so its row on Start names the profile; a run without one names none (must-exclude)', async () => {
  S.reset({ notebookPresent: true, runStates: { 801: 'PENDING', 802: 'PENDING' } });
  const saved = await save({ name: 'Acme retail', spec: SETTINGS });
  const profileId = saved.data.profile.profile_id;

  S.state.nextRunId = 801;
  const withProfile = await S.request('POST', '/api/run', { person: 'launcher@example.com', body: { ...runParams('8001'), profile_id: profileId } });
  assert.equal(withProfile.status, 200, withProfile.text);
  assert.deepEqual(S.state.profileLinks.map((l) => [l.session_id, l.profile_id, l.inspire_database]), [['8001', profileId, S.APP_DB]]);

  S.state.nextRunId = 802;
  const plain = await S.request('POST', '/api/run', { person: 'launcher@example.com', body: runParams('8002', 'Beta') });
  assert.equal(plain.status, 200, plain.text);

  const sessions = (await S.request('GET', LIST, { person: 'reader@example.com' })).data.sessions;
  const byId = Object.fromEntries(sessions.map((s) => [s.session_id, s]));
  assert.equal(byId['8001'].profile_name, 'Acme retail');
  assert.equal(byId['8001'].profile_id, profileId);
  assert.equal(Object.hasOwn(byId['8002'], 'profile_name'), false);
});

test('a profile id that is not saved does not stop the run: the run starts, carries a warning, and is not linked (must-keep)', async () => {
  S.reset({ notebookPresent: true, runStates: { 803: 'PENDING' } });
  S.state.nextRunId = 803;
  const got = await S.request('POST', '/api/run', { person: 'launcher@example.com', body: { ...runParams('8003'), profile_id: '3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b' } });
  assert.equal(got.status, 200, got.text);
  assert.match(got.data.warnings.join(' '), /business profile of this run was not found/);
  assert.equal(S.state.profileLinks.length, 0);
});

test('a run with a profile id that is not an id Inspire gave out is refused before anything launches (must-fail)', async () => {
  S.reset({ notebookPresent: true, runStates: {} });
  const got = await S.request('POST', '/api/run', { person: 'launcher@example.com', body: { ...runParams('8004'), profile_id: "x' OR 1=1" } });
  assert.equal(got.status, 400, got.text);
  assert.equal(S.state.launches.length, 0);
  assert.equal(S.state.calls.filter((c) => c.path === '/api/2.1/jobs/run-now').length, 0);
});

// REQ-PROF: the profile tables are created by the first save, so before it a list finds no table. The read was sent anyway and logged
// TABLE_OR_VIEW_NOT_FOUND as a failed SQL on every page load. The tables are checked first, and a missing table is never read.
test('before the first save the profile tables do not exist: the list and the run list answer without reading a missing table (must-keep, must-fail)', async () => {
  S.reset({ profileTablesMissing: true });
  const listed = await S.request('GET', '/api/inspire/profiles?business_name=Acme', { person: 'amr@example.com' });
  assert.equal(listed.status, 200, listed.text);
  assert.deepEqual(listed.data.profiles, []);
  const sessions = await S.request('GET', LIST, { person: 'amr@example.com' });
  assert.equal(sessions.status, 200, sessions.text);
  const missingReads = S.state.calls.filter((c) => /__inspire_profile/.test(c.statement || '') && !/information_schema/i.test(c.statement || ''));
  assert.deepEqual(missingReads.map((c) => c.statement.slice(0, 40)), [], 'no statement reads a profile table while it does not exist');
  const got = await S.request('GET', '/api/inspire/profiles/3f2a9c1e-8b7d-4e6f-9a0b-1c2d3e4f5a6b', { person: 'amr@example.com' });
  assert.equal(got.status, 404, got.text);
  S.reset();
});
