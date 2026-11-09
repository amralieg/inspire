const test = require('node:test');
const assert = require('node:assert/strict');
const S = require('./support/serverApp');
const W = () => require('../lib/ucReads');

const ME = 'nonowner@example.com';
const OWNER = 'owner@example.com';
const BOSS = 'boss@example.com';
const HOME = `/Users/${OWNER}`;

test.after(() => S.stopServer());

const launch = (generationPath, options = {}) => S.request('POST', '/api/run', {
  person: options.person || ME, signedIn: options.signedIn, userToken: options.userToken,
  body: { params: { '00_business_name': 'Acme', '02_inspire_database': S.APP_DB, '14_session_id': '1001', ...(generationPath === undefined ? {} : { '11_generation_path': generationPath }) } },
});
const SHARED_ONLY = (person, why = 'the Inspire App cannot write there; give the App CAN MANAGE on it to keep your runs private') =>
  `Inspire cannot save to your folder /Users/${person}/inspire_output (${why}), so it saves to /Shared/demos, a shared folder that everyone in the workspace can open.`;
const APP_CANT = (folder) => `The Inspire App can't write to ${folder}, so the run saves no files there. Ask an App manager to give the App CAN MANAGE on it.`;
const APP_CANT_CREATE = (folder) => `${folder} does not exist yet, and the Inspire App can't create it, so the run saves no files there. Create ${folder}, then give the App CAN MANAGE on it.`;
const submitted = () => S.state.calls.filter((c) => c.path.startsWith('/api/2.1/jobs/'));
const probes = () => S.state.calls.filter((c) => c.path === '/api/2.0/workspace/mkdirs' || (c.path.startsWith('/api/2.0/fs/directories/') && c.method === 'PUT'));

test('a run launch into a folder the person cannot edit is refused with a 403 that names the folder and the fix, and nothing is submitted', async () => {
  S.reset({ notebookPresent: true, folders: { [HOME]: { id: 11, writers: [OWNER] } } });
  const got = await launch(`${HOME}/inspire_out`);
  assert.equal(got.status, 403, got.text);
  assert.equal(got.data.policy.rule, 'writer');
  assert.deepEqual(got.data.unwritable, [`${HOME}/inspire_out`]);
  assert.equal(got.data.error, `You cannot write to ${HOME}/inspire_out (you cannot create anything in ${HOME}) with your own sign-in, and Inspire never writes `
    + 'for you where you cannot write: choose a folder you can manage, such as one under your own user folder, or ask its owner for CAN MANAGE on it, '
    + 'which Databricks needs before anyone can create something in a folder.');
  assert.deepEqual(submitted(), [], 'no job was created or run');
  assert.deepEqual(S.state.launches, []);
  assert.deepEqual(S.state.created, [], 'the refused probe created nothing');
  assert.ok(probes().length === 1 && probes()[0].token === S.PERSON_TOKEN, 'one probe, with the person token');
});

test('a run launch into a folder the person can edit is submitted, the probe is deleted, and the launch record says the check passed on that folder', async () => {
  for (const [label, seed, asked, folder] of [
    ['the default folder beside the notebook, open to all users', {}, undefined, '/Shared/demos'],
    ['the nearest existing parent decides for a folder that does not exist yet', { folders: { [`/Users/${ME}`]: { id: 12, writers: [ME] } } }, `/Workspace/Users/${ME}/new/deeper`, `/Users/${ME}/new/deeper`],
    ['CAN MANAGE through a group the person is directly in', { personGroups: ['analysts'], folders: { '/Shared/team': { id: 13, writers: ['group:analysts'] } } }, '/Shared/team/out', '/Shared/team/out'],
    ['a grant reached through a nested group, which the person\'s own group list does not name', { personGroups: ['analysts'], groupParents: { analysts: ['data'], data: ['everyone-in-finance'] },
      folders: { '/Shared/team': { id: 13, writers: ['group:everyone-in-finance'] } } }, '/Shared/team/out', '/Shared/team/out'],
  ]) {
    S.reset({ notebookPresent: true, ...seed });
    const got = await launch(asked);
    assert.equal(got.status, 200, `${label}: ${got.text}`);
    assert.equal(S.state.launches.length, 1, label);
    assert.equal(S.state.launches[0].output_folder, folder, label);
    assert.equal(S.state.launches[0].output_checked, 'passed', label);
    assert.equal(S.state.created.length, 0, `${label}: the probe was deleted`);
    assert.ok(S.state.deleted.length >= 1, label);
    for (const gone of S.state.deleted) assert.match(gone.split('/').pop(), new RegExp(`^${W().PROBE_PREFIX.replace('.', '\\.')}[0-9a-f]{32}$`), label);
  }
});

test('a group grant the platform does not resolve, a hidden folder and a file in the way all refuse the launch (must-exclude)', async () => {
  for (const [label, seed, reason] of [
    ['a grant to a group the person is not in, even through parents', { personGroups: ['analysts'], groupParents: { analysts: ['data'] },
      folders: { '/Shared/team': { id: 13, writers: ['group:finance'] } } }, 'you cannot create anything in /Shared/team'],
    ['a folder the person cannot see', { folders: { '/Shared/team': { id: 13, hidden: true } } }, 'you cannot see /Shared/team'],
    ['a notebook where the folder would be', { folders: { '/Shared/team': { id: 13, type: 'NOTEBOOK' } } }, '/Shared/team is not a folder'],
    ['a person sign-in without the workspace scope', { scopeless: true, folders: { '/Shared/team': { id: 13, writers: '*' } } }, "Inspire's sign-in for you lacks a scope this check needs"],
  ]) {
    S.reset({ notebookPresent: true, ...seed });
    const got = await launch('/Shared/team/out');
    assert.equal(got.status, 403, `${label}: ${got.text}`);
    assert.ok(got.data.error.includes(reason), `${label}: ${got.data.error}`);
    assert.deepEqual(submitted(), [], label);
  }
});

test('a CAN_USE person launching into a volume they can only read is refused with a 403 and nothing is submitted', async () => {
  S.reset({ notebookPresent: true, volumes: { 'main.sales.files': { writers: [OWNER] } } });
  const got = await launch('/Volumes/main/sales/files/out');
  assert.equal(got.status, 403, got.text);
  assert.equal(got.data.policy.rule, 'writer');
  assert.deepEqual(got.data.unwritable, ['/Volumes/main/sales/files/out']);
  assert.deepEqual(submitted(), [], 'no job was created or run');
  assert.deepEqual(S.state.launches, []);
});

test('a person whose sign-in cannot read folder permissions or Unity Catalog grants, as the documented Apps scopes allow, still launches into a folder and a volume they can write', async () => {
  for (const [label, seed, asked] of [
    ['their own folder', { folders: { [`/Users/${ME}`]: { id: 12, writers: [ME] } } }, `/Users/${ME}/out`],
    ['a volume they can write', { volumes: { 'main.sales.files': { writers: [ME] } } }, '/Volumes/main/sales/files/out'],
  ]) {
    S.reset({ notebookPresent: true, ...seed });
    const got = await launch(asked);
    assert.equal(got.status, 200, `${label}: ${got.text}`);
    assert.equal(S.state.launches[0].output_checked, 'passed', label);
    const reads = S.state.calls.filter((c) => /^\/api\/2\.0\/permissions\/directories\/|^\/api\/2\.1\/unity-catalog\//.test(c.path));
    assert.deepEqual(reads, [], `${label}: no read the person scopes do not cover`);
  }
});

test('a probe left behind by a failed delete is swept by the next check in that folder', async () => {
  const stale = `/Users/${ME}/${W().PROBE_PREFIX}0123456789abcdef0123456789abcdef`;
  S.reset({ notebookPresent: true, deleteFails: true, folders: { [`/Users/${ME}`]: { id: 12, writers: [ME] } } });
  assert.equal((await launch(`/Users/${ME}/out`)).status, 200, 'a failed delete does not fail the launch');
  assert.equal(S.state.created.length, 1, 'the probe stayed');
  assert.ok(S.state.logs.some((l) => l.includes('could not be deleted; the next check in that folder deletes it')));
  const left = S.state.created[0];
  const file = `/Users/${ME}/${W().PROBE_PREFIX}notes.py`;
  S.reset({ notebookPresent: true, leftovers: [left, stale, `/Users/${ME}/keep_me`], leftoverFiles: [file], folders: { [`/Users/${ME}`]: { id: 12, writers: [ME] } } });
  assert.equal((await launch(`/Users/${ME}/out`)).status, 200);
  assert.deepEqual(S.state.leftovers, [`/Users/${ME}/keep_me`], 'only probe leftovers are swept');
  assert.deepEqual(S.state.leftoverFiles, [file], 'a file that only shares the probe name is never deleted (must-exclude)');
  assert.ok(S.state.deleted.includes(left) && S.state.deleted.includes(stale));
});

test('a volume needs a probe the platform lets the person create, read with the person token', async () => {
  for (const [label, volume, status] of [
    ['WRITE VOLUME for the person', { writers: [ME] }, 200],
    ['WRITE VOLUME through a nested group', { writers: ['group:lake-writers'] }, 200],
    ['READ VOLUME only', { writers: [OWNER] }, 403],
    ['no such volume', null, 403],
  ]) {
    S.reset({ notebookPresent: true, personGroups: ['analysts'], groupParents: { analysts: ['lake-writers'] }, volumes: volume ? { 'main.sales.files': volume } : {} });
    const got = await launch('/Volumes/Main/Sales/Files/out');
    assert.equal(got.status, status, `${label}: ${got.text}`);
    if (status === 403) assert.match(got.data.error, /ask an owner of the volume main\.sales\.files for WRITE VOLUME on it\.$/, label);
    if (status === 200) assert.deepEqual([S.state.launches[0].output_folder, S.state.created.length], ['/Volumes/main/sales/files/out', 0], label);
    const reads = S.state.calls.filter((c) => c.path.startsWith('/api/2.0/fs/'));
    assert.ok(reads.some((c) => c.token === S.PERSON_TOKEN), `${label}: the person check uses the person token`);
    assert.ok(reads.every((c) => [S.PERSON_TOKEN, S.APP_TOKEN].includes(c.token)), `${label}: any other volume call is the App checking its own write`);
  }
});

test('an App manager skips the write check, the launch record says manager, and a CAN_USE person launching into the same folder is refused', async () => {
  const folders = { [HOME]: { id: 11, writers: [OWNER] } };
  S.reset({ notebookPresent: true, managers: [BOSS], folders });
  const boss = await launch(`${HOME}/inspire_out`, { person: BOSS });
  assert.equal(boss.status, 200, boss.text);
  assert.deepEqual([S.state.launches[0].output_folder, S.state.launches[0].output_checked], [`${HOME}/inspire_out`, 'manager']);
  assert.deepEqual([...new Set(probes().map((c) => c.token))], [S.APP_TOKEN], 'no person probe for a manager, only the App checking the folder it writes to');
  S.reset({ notebookPresent: true, managers: [BOSS], folders });
  const person = await launch(`${HOME}/inspire_out`);
  assert.equal(person.status, 403, person.text);
  assert.deepEqual(submitted(), []);
});

test('CAN MANAGE on the App through a nested group, which the person sign-in lists as an indirect group, also skips the write check', async () => {
  const folders = { [HOME]: { id: 11, writers: [OWNER] } };
  S.reset({ notebookPresent: true, managerGroups: ['app-admins'], personGroups: ['analysts', 'app-admins'], indirectGroups: ['app-admins'], folders });
  const nested = await launch(`${HOME}/inspire_out`);
  assert.equal(nested.status, 200, nested.text);
  assert.equal(S.state.launches[0].output_checked, 'manager');
  assert.ok(probes().every((c) => c.token === S.APP_TOKEN), 'no person probe');
  S.reset({ notebookPresent: true, managerGroups: ['app-admins'], personGroups: ['analysts'], groupParents: { analysts: ['data'] }, folders });
  const outside = await launch(`${HOME}/inspire_out`);
  assert.equal(outside.status, 403, `a group that does not reach the App managers grants nothing (must-exclude): ${outside.text}`);
  assert.deepEqual(submitted(), []);
});

test('a launch without the person token is refused with a 401 and nothing is submitted', async () => {
  S.reset({ notebookPresent: true });
  const got = await launch(undefined, { userToken: false });
  assert.equal(got.status, 401, got.text);
  assert.equal(got.data.policy.identity, 'person');
  assert.equal(got.data.error, W().WRITE_NO_SIGN_IN);
  assert.deepEqual(submitted(), []);
});

test('the output folder check answers the same verdict without launching anything, and says when a manager skipped it', async () => {
  const folders = { [HOME]: { id: 11, writers: [OWNER] } };
  const ask = (person, path = `${HOME}/inspire_out`) => S.request('POST', '/api/output-folder/check', { person, body: { generation_path: path } });
  S.reset({ folders, managers: [BOSS] });
  const mine = await ask(OWNER);
  assert.equal(mine.status, 200, mine.text);
  assert.deepEqual(mine.data, { allowed: true, folder: `${HOME}/inspire_out`, checked: 'passed', warnings: [APP_CANT_CREATE(`${HOME}/inspire_out`)] });
  assert.deepEqual(S.state.created, [], 'the probe was deleted');
  S.reset({ folders: { ...folders, '/Shared/demos': { id: 7, writers: '*' } }, managers: [BOSS] });
  for (const path of ['./../demos/', '']) {
    const fallback = await ask(OWNER, path);
    assert.deepEqual([fallback.status, fallback.data], [200, { allowed: true, folder: '/Shared/demos', checked: 'passed', warnings: [SHARED_ONLY(OWNER)], generation_path: '/Workspace/Shared/demos' }], `${JSON.stringify(path)}: ${fallback.text}`);
  }
  const old = await S.request('GET', `/api/output-folder/check?generation_path=${encodeURIComponent('./../demos/')}`, { person: OWNER });
  assert.equal(old.status, 404, 'the check is a POST, so no generation path ever travels in a request URL');
  const boss = await ask(BOSS);
  assert.deepEqual([boss.status, boss.data.checked], [200, 'manager']);
  const theirs = await ask(ME);
  assert.equal(theirs.status, 403, theirs.text);
  assert.equal(theirs.data.policy.rule, 'writer');
  assert.deepEqual(S.state.calls.filter((c) => c.path.startsWith('/api/2.1/jobs/') || c.statement.startsWith('INSERT')), []);
});

test('a launched run opens its output folder with the App token, for a passed check and for a manager skip of that exact folder', async () => {
  for (const [person, seed] of [[ME, {}], [BOSS, { managers: [BOSS], folders: { '/Shared/demos': { id: 7, writers: [S.APP_SP] } } }]]) {
    S.reset({ notebookPresent: true, sessionRows: { [S.APP_DB]: [{ session_id: '1001', generation_path: './../demos/' }] }, ...seed });
    assert.equal((await launch(undefined, { person })).status, 200, person);
    S.state.calls.length = 0;
    const got = await S.request('GET', `/api/workspace/list?path=${encodeURIComponent('/Workspace/Shared/demos/acme')}`, { person: 'someone@example.com' });
    assert.equal(got.status, 200, got.text);
    assert.deepEqual([...new Set(S.state.calls.filter((c) => c.path === '/api/2.0/workspace/list').map((c) => c.token))], ['app-sp-token'], person);
  }
});

test('the write targets come from the generation path, resolved like the notebook resolves it', () => {
  assert.deepEqual(W().discoverWrites({}, '/Shared/x/nb'), { folders: ['/Shared/demos'], defaulted: true });
  assert.deepEqual(W().discoverWrites({ '11_generation_path': '  ' }, '/Shared/x/nb'), { folders: ['/Shared/demos'], defaulted: true });
  assert.deepEqual(W().discoverWrites({ '11_generation_path': './../demos/' }, '/Shared/x/nb'), { folders: ['/Shared/demos'], defaulted: true });
  assert.deepEqual(W().discoverWrites({ '11_generation_path': '/Workspace/Users/someone@example.com/out/' }, ''), { folders: ['/Users/someone@example.com/out'], defaulted: false });
  assert.deepEqual(W().discoverWrites({ '11_generation_path': 'out' }, ''), { folders: ['out'], defaulted: false });
  assert.deepEqual(W().discoverWrites({ '11_generation_path': 'dbfs:/tmp/out' }, '/Shared/x/nb'), { folders: ['dbfs:/tmp/out'], defaulted: false });
});

test('the default output folder is the person\u2019s own inspire_output, a locked or App-less home falls back to the shared folder and says everyone can read it, and a typed folder is never swapped (must-exclude)', async () => {
  const mine = `/Users/${ME}`;
  const private_ = { notebookPresent: true, folders: { '/Shared/demos': { id: 7, writers: '*' }, [mine]: { id: 12, writers: [ME, S.APP_SP] } } };
  for (const asked of [undefined, '', './../demos/']) {
    S.reset(private_);
    const got = await launch(asked);
    assert.equal(got.status, 200, `${JSON.stringify(asked)}: ${got.text}`);
    assert.equal(got.data.warnings, undefined, `${JSON.stringify(asked)}: the person\u2019s own folder needs no warning`);
    assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['11_generation_path'], `/Workspace${mine}/inspire_output`);
    assert.equal(S.state.launches[0].output_folder, `${mine}/inspire_output`);
  }
  S.reset(private_);
  const check = await S.request('POST', '/api/output-folder/check', { person: ME, body: { generation_path: '' } });
  assert.deepEqual([check.status, check.data], [200, { allowed: true, folder: `${mine}/inspire_output`, checked: 'passed',
    warnings: [], generation_path: `/Workspace${mine}/inspire_output` }]);
  S.reset(private_);
  const typed = await launch('/Shared/demos/');
  assert.equal(typed.status, 200, typed.text);
  assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['11_generation_path'], '/Shared/demos/', 'a folder the person typed is never swapped');
  S.reset({ notebookPresent: true, folders: { '/Shared/demos': { id: 7, writers: '*' }, [mine]: { id: 12, writers: [ME] } } });
  const appless = await launch(undefined);
  assert.equal(appless.status, 200, appless.text);
  assert.deepEqual(appless.data.warnings, [SHARED_ONLY(ME)]);
  assert.equal(S.state.launches[0].output_folder, '/Shared/demos');
  assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['11_generation_path'], '/Workspace/Shared/demos',
    'the shared folder the warning names is the folder the notebook is told to save to, never an empty path it refuses');
  S.reset({ notebookPresent: true, folders: { '/Shared/demos': { id: 7, writers: '*' }, [mine]: { id: 12, writers: [ME] } } });
  const applessCheck = await S.request('POST', '/api/output-folder/check', { person: ME, body: { generation_path: '' } });
  assert.equal(applessCheck.data.generation_path, '/Workspace/Shared/demos');
  S.reset({ notebookPresent: true, folders: { '/Shared/demos': { id: 7, writers: '*' } } });
  const nohome = await launch(undefined);
  assert.deepEqual(nohome.data.warnings, [SHARED_ONLY(ME, 'you cannot write there')]);
  assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['11_generation_path'], '/Workspace/Shared/demos');
  S.reset({ notebookPresent: true, folders: { '/Shared/demos': { id: 7, writers: [] }, [mine]: { id: 12, writers: [ME, S.APP_SP] } } });
  const locked = await launch(undefined);
  assert.equal(locked.status, 200, locked.text);
  assert.equal(S.state.launches[0].output_folder, `${mine}/inspire_output`);
  S.reset({ notebookPresent: true, folders: { '/Shared/demos': { id: 7, writers: [] }, [mine]: { id: 12, writers: [OWNER] } } });
  const nowhere = await launch(undefined);
  assert.equal(nowhere.status, 403, `neither folder takes the run: ${nowhere.text}`);
  assert.deepEqual(nowhere.data.unwritable, ['/Shared/demos']);
  assert.deepEqual(submitted(), []);
});

test('the App writes the run\u2019s files, so a folder only the person can write warns up front, for a manager too, and a folder the App can write says nothing', async () => {
  S.reset({ notebookPresent: true, managers: [BOSS], folders: { [HOME]: { id: 11, writers: [OWNER] } } });
  const boss = await launch(`${HOME}/inspire_out`, { person: BOSS });
  assert.equal(boss.status, 200, boss.text);
  assert.deepEqual(boss.data.warnings, [APP_CANT_CREATE(`${HOME}/inspire_out`)]);
  S.reset({ notebookPresent: true, managers: [BOSS], folders: { [HOME]: { id: 11, writers: [OWNER, S.APP_SP] } } });
  const granted = await launch(`${HOME}/inspire_out`, { person: BOSS });
  assert.equal(granted.status, 200, granted.text);
  assert.equal(granted.data.warnings, undefined);
  assert.ok(probes().some((c) => c.token === S.APP_TOKEN), 'the App checked its own write');
});

test('a folder that does not exist yet is checked on its nearest existing parent for the App too: a parent the App can write says nothing, a parent it cannot says the folder is new and how to fix it, and an existing locked folder keeps the grant text (must-exclude)', async () => {
  const ask = (path) => S.request('POST', '/api/output-folder/check', { person: OWNER, body: { generation_path: path } });
  const fresh = `${HOME}/brand_new/deeper`;
  S.reset({ folders: { [HOME]: { id: 11, writers: [OWNER, S.APP_SP] } } });
  const open = await ask(`/Workspace${fresh}`);
  assert.deepEqual([open.status, open.data.warnings], [200, []], `the App can create under the parent, so a new folder is fine: ${open.text}`);
  assert.ok(probes().some((c) => c.token === S.APP_TOKEN && String(JSON.parse(c.raw).path).startsWith(`${HOME}/${W().PROBE_PREFIX}`)), 'the App probe ran in the existing parent');
  S.reset({ folders: { [HOME]: { id: 11, writers: [OWNER] } } });
  const closed = await ask(`/Workspace${fresh}`);
  assert.deepEqual([closed.status, closed.data.warnings], [200, [APP_CANT_CREATE(fresh)]], closed.text);
  S.reset({ folders: { [HOME]: { id: 11, writers: [OWNER] }, [`${HOME}/made`]: { id: 14, writers: [OWNER] } } });
  const existing = await ask(`${HOME}/made`);
  assert.deepEqual([existing.status, existing.data.warnings], [200, [APP_CANT(`${HOME}/made`)]], 'an existing folder the App cannot write keeps the grant text');
  S.reset({ folders: { [HOME]: { id: 11, writers: [OWNER] }, [`${HOME}/made`]: { id: 14, writers: [OWNER, S.APP_SP] } } });
  assert.deepEqual((await ask(`${HOME}/made`)).data.warnings, [], 'an existing folder the App can write says nothing');
  S.reset({ volumes: { 'main.sales.files': { writers: [OWNER] } } });
  const volume = await ask('/Volumes/main/sales/files/new_out');
  assert.deepEqual(volume.data.warnings, ["The Inspire App can't write to /Volumes/main/sales/files/new_out, so the run saves no files there. Ask an owner of its volume to give the App WRITE VOLUME on it."],
    'a volume needs WRITE VOLUME, never CAN MANAGE');
});
