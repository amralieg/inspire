const test = require('node:test');
const assert = require('node:assert/strict');
const L = require('../lib/launchLedger');
const S = require('./support/serverApp');

test.after(() => S.stopServer());

const TABLE = L.launchTableName('Main.Inspire');
const params = (st) => Object.fromEntries(st.parameters.map((p) => [p.name, [p.value, p.type]]));

test('the ledger lives in the App database and refuses a malformed one', () => {
  assert.equal(TABLE, '`Main`.`Inspire`.`__inspire_launch`');
  assert.equal(L.launchTableName('a.b.c'), null);
  assert.equal(L.launchTableName(''), null);
  assert.match(L.launchCreateSql(TABLE), /^CREATE TABLE IF NOT EXISTS `Main`\.`Inspire`\.`__inspire_launch` \(run_id BIGINT/);
});

test('a launch row stores the run, the session it opened and the person, lowercased, as typed parameters', () => {
  const st = L.launchInsertStatement(TABLE, { runId: 501, jobId: 5, runType: 'discovery', inspireDatabase: 'Main.Inspire', sessionId: '5001', openedSession: true, launchedBy: ' Person@Example.com ' });
  assert.match(st.sql, /^INSERT INTO `Main`\.`Inspire`\.`__inspire_launch` \(run_id, job_id,/);
  assert.doesNotMatch(st.sql, /Person|5001|501/, 'values travel as parameters, never in the SQL text');
  assert.deepEqual(params(st), {
    run_id: ['501', 'BIGINT'], job_id: ['5', 'BIGINT'], run_type: ['discovery', 'STRING'], inspire_database: ['main.inspire', 'STRING'],
    session_id: ['5001', 'STRING'], opened_session: ['true', 'BOOLEAN'], launched_by: ['person@example.com', 'STRING'],
    output_folder: ['', 'STRING'], output_checked: ['', 'STRING'],
  });
  for (const checked of ['passed', 'manager']) {
    const row = params(L.launchInsertStatement(TABLE, { runId: 1, jobId: 1, outputFolder: '/Users/a/out', outputChecked: checked }));
    assert.deepEqual([row.output_folder[0], row.output_checked[0]], ['/Users/a/out', checked]);
  }
  for (const [folder, checked] of [['', 'passed'], ['/Users/a/out', 'true'], ['/Users/a/out', true], ['/Users/a/out', '']]) {
    assert.equal(params(L.launchInsertStatement(TABLE, { runId: 1, jobId: 1, outputFolder: folder, outputChecked: checked })).output_checked[0], '', `${folder} ${checked} is no check`);
  }
  assert.match(L.checkedOutputStatement('Main.Inspire').sql, /AND l\.output_checked IN \('passed', 'manager'\)$/);
  assert.equal(params(L.launchInsertStatement(TABLE, { runId: 1, jobId: 1, openedSession: false })).opened_session[0], 'false');
});

test('launcher lookups take only well-formed ids, and a session counts only for the launch that opened it', () => {
  assert.equal(L.runLauncherStatement(TABLE, 'abc'), null);
  assert.equal(L.runLauncherStatement(TABLE, '1; DROP TABLE x'), null);
  assert.deepEqual(params(L.runLauncherStatement(TABLE, '77')), { run_id: ['77', 'BIGINT'] });
  assert.equal(L.sessionLauncherStatement(TABLE, 'main.inspire', 'x'), null);
  assert.equal(L.sessionLauncherStatement(TABLE, 'not-a-db', '5'), null);
  const st = L.sessionLauncherStatement(TABLE, 'Main.Inspire', '5001');
  assert.match(st.sql, /AND opened_session ORDER BY launched_at LIMIT 1$/);
  assert.equal(params(st).inspire_database[0], 'main.inspire');
  assert.equal(L.sessionKnownStatements(TABLE, 'bad', '1'), null);
  assert.match(L.sessionKnownStatements(TABLE, 'main.inspire', '5001').session.sql, /FROM `main`\.`inspire`\.`__inspire_session` WHERE session_id = :session_id/);
});

test('the launcher is the lowercased first row, or nobody', () => {
  assert.equal(L.launcherOf([{ launched_by: ' A@B.com ' }, { launched_by: 'c@d.com' }]), 'a@b.com');
  assert.equal(L.launcherOf([]), null);
  assert.equal(L.launcherOf([{ launched_by: '' }]), null);
});

const runParams = (sid) => ({ params: { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': sid } });
const refused = (got) => got.status === 403 && Boolean(got.data && got.data.policy);

test('a launch records who launched it, so that person may cancel the run and delete the session it opened, and nobody else may', async () => {
  S.reset({ notebookPresent: true, managers: ['manager@example.com'] });
  const launched = await S.request('POST', '/api/run', { person: 'Launcher@Example.com', body: runParams('5001') });
  assert.equal(launched.status, 200, launched.text.slice(0, 300));
  assert.equal(launched.data.run_id, '501');
  assert.equal(launched.data.job_id, '5');
  assert.equal(launched.data.launcher_recorded, true, launched.text.slice(0, 300));
  assert.equal(S.state.launches.length, 1);
  assert.deepEqual([S.state.launches[0].launched_by, S.state.launches[0].session_id, S.state.launches[0].opened_session, S.state.launches[0].run_type],
    ['launcher@example.com', '5001', 'true', 'discovery']);
  assert.equal(refused(await S.request('POST', '/api/run/501/cancel', { person: 'launcher@example.com', body: {} })), false);
  assert.equal(refused(await S.request('POST', '/api/run/501/cancel', { person: 'other@example.com', body: {} })), true);
  const del = `/api/inspire/session?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}&session_id=5001`;
  assert.equal(refused(await S.request('DELETE', del, { person: 'launcher@example.com' })), false);
  assert.equal(refused(await S.request('DELETE', del, { person: 'other@example.com' })), true);
});

test('launching with a session id that already exists neither runs it for you nor makes you its launcher', async () => {
  S.reset({ notebookPresent: true, knownSessions: ['5002'] });
  const got = await S.request('POST', '/api/run', { person: 'taker@example.com', body: runParams('5002') });
  assert.equal(got.status, 403, got.text.slice(0, 300));
  assert.equal(S.state.launches.length, 0);
  assert.deepEqual(S.state.calls.filter((c) => c.path.startsWith('/api/2.1/jobs/')), []);
  const del = `/api/inspire/session?inspire_database=${S.APP_DB}&warehouse_id=${S.APP_WAREHOUSE}&session_id=5002`;
  assert.equal(refused(await S.request('DELETE', del, { person: 'taker@example.com' })), true);
  S.reset({ notebookPresent: true, ledgerSessions: ['5003'], sessionLaunchers: { 5003: 'owner@example.com' } });
  const again = await S.request('POST', '/api/run', { person: 'owner@example.com', body: runParams('5003') });
  assert.equal(again.status, 200, again.text.slice(0, 300));
  assert.equal(S.state.launches[0].opened_session, 'false', 'a session another launch already named is not reopened');
});

test('a launch with no signed-in person is refused before anything is submitted or recorded, because its output folder cannot be checked', async () => {
  S.reset({ notebookPresent: true });
  const got = await S.request('POST', '/api/run', { signedIn: false, body: runParams('5004') });
  assert.equal(got.status, 401, got.text);
  assert.equal(S.state.launches.length, 0);
  assert.deepEqual(S.state.calls.filter((c) => c.path.startsWith('/api/2.1/jobs/')), []);
});

test('a launch answers with the run and job ids as strings, small or past 2^53, so the App never sees one id in two types', async () => {
  S.reset({ notebookPresent: true });
  S.state.createdJobIdText = '9007199254740993';
  const big = await S.request('POST', '/api/run', { person: 'launcher@example.com', body: runParams('5002') });
  assert.equal(big.status, 200, big.text.slice(0, 300));
  assert.deepEqual([big.data.job_id, big.data.run_id], ['9007199254740993', '501']);
  assert.match(big.text, /"job_id":"9007199254740993"/, 'the id keeps every digit');
  S.reset({ notebookPresent: true });
  const small = await S.request('POST', '/api/run', { person: 'launcher@example.com', body: runParams('5003') });
  assert.deepEqual([typeof small.data.job_id, typeof small.data.run_id], ['string', 'string']);
});
