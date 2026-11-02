const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const ME = 'launcher@example.com';
const BOSS = 'manager@example.com';
const body = (ids) => ({ inspire_database: S.APP_DB, warehouse_id: S.APP_WAREHOUSE, session_id: '1001', use_case_ids: ids });
const refused = (got) => got.status === 403 && Boolean(got.data && got.data.policy);
const genie = (person, ids) => S.request('POST', '/api/inspire/generate-genie', { person, body: body(ids) });
const built = (uc, by) => ({ session_id: '1001', use_case_id: uc, spec_version: 1, status: 'ready', created_by: by });

test('the person who launched the session may add Genie code to a use case nobody has built', async () => {
  S.reset({ managers: [BOSS], sessionLaunchers: { 1001: ME }, history: [] });
  const got = await genie(ME, ['N01-U01']);
  assert.equal(refused(got), false, got.text.slice(0, 300));
});

test('someone else may not, and the refusal names who launched the session', async () => {
  S.reset({ managers: [BOSS], sessionLaunchers: { 1001: ME }, history: [] });
  const got = await genie('other@example.com', ['N01-U01']);
  assert.equal(refused(got), true, got.text.slice(0, 300));
  assert.match(got.data.error, /has no build, and session 1001 was launched by launcher@example\.com/);
});

test('a session with no launch record leaves unbuilt use cases to App managers', async () => {
  S.reset({ managers: [BOSS], sessionLaunchers: {}, history: [] });
  const got = await genie(ME, ['N01-U01']);
  assert.equal(refused(got), true, got.text.slice(0, 300));
  assert.match(got.data.error, /no record of who launched session 1001/);
  assert.equal(refused(await genie(BOSS, ['N01-U01'])), false);
});

test('a built use case stays with the owners of its build, even for the launcher of the session', async () => {
  S.reset({ managers: [BOSS], sessionLaunchers: { 1001: ME }, history: [built('N01-U01', 'builder@example.com')] });
  assert.equal(refused(await genie(ME, ['N01-U01'])), true);
  assert.equal(refused(await genie('builder@example.com', ['N01-U01'])), false);
});

test('every named use case must be the person own: one unbuilt and one built by them passes, one built by someone else does not', async () => {
  S.reset({ managers: [BOSS], sessionLaunchers: { 1001: ME }, history: [built('N01-U02', ME), built('N01-U03', 'builder@example.com')] });
  assert.equal(refused(await genie(ME, ['N01-U01', 'N01-U02'])), false);
  assert.equal(refused(await genie(ME, ['N01-U01', 'N01-U03'])), true);
});
