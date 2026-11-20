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
const SHARED_ONLY = (person) =>
  `Inspire cannot save to your own folder /Users/${person}/inspire_output, so it saves to /Shared/demos, a shared folder that everyone in the workspace can open.`;
const SCOPE_ONLY = (person) =>
  `Inspire cannot save to your own folder /Users/${person}/inspire_output, because this App may not use your sign-in for workspace folders (run the Inspire installer again to allow it), so it saves to /Shared/demos, a shared folder that everyone in the workspace can open.`;
const WRITE_CALL = (c) => ['POST', 'PUT', 'PATCH', 'DELETE'].includes(c.method) && !c.path.startsWith('/api/2.0/sql/') && c.path !== '/oidc/v1/token';
const APP_CANT = (folder) => `The Inspire App can't write to ${folder}, so the run saves no files there. Ask an App manager to give the App CAN MANAGE on it.`;
const APP_CANT_CREATE = (folder) => `${folder} does not exist yet, and the Inspire App can't create it, so the run saves no files there. Create ${folder}, then give the App CAN MANAGE on it.`;
const APP_CANT_VOLUME = (folder) => `The Inspire App can't write to ${folder}, so the run saves no files there. Ask your data owner to give the App WRITE VOLUME on it.`;
const APP_HIDDEN = (folder, at) => `${folder} does not exist yet, and the Inspire App cannot see ${at} to create it, so the run saves no files there. Pick a folder the App can see.`;
const APP_HIDDEN_VOLUME = (folder, at) => `${folder} does not exist yet, and the Inspire App cannot see ${at} to create it, so the run saves no files there. `
  + 'Create the volume, or ask your data owner for access to it.';
const APP_NOT_FOLDER = (at) => `${at} is not a folder, so the run saves no files there. Pick a folder, not a notebook or a file.`;
const APP_SCOPE = (folder) => `The Inspire App can't write to ${folder}, so the run saves no files there: the App's sign-in lacks a scope this check needs. `
  + 'Ask an App manager to re-run the Inspire installer, which adds the scopes Inspire needs.';
const UNRUNNABLE_OWN = (home) => `Inspire cannot save to your own folder ${home}, and the App cannot write there yet, so Inspire will not start a run that saves no files there: `
  + `ask an App manager to give the App CAN MANAGE on ${home}, then launch again.`;
const submitted = () => S.state.calls.filter((c) => c.path.startsWith('/api/2.1/jobs/'));
const probes = () => S.state.calls.filter((c) => c.path === '/api/2.0/workspace/mkdirs' || (c.path.startsWith('/api/2.0/fs/directories/') && c.method === 'PUT'));

test('a run launch into a folder the App cannot write is refused with a 403 that names the folder and the fix, and nothing is submitted', async () => {
  // The person can write the folder; the App cannot. The App's own probe decides, so the person's rights do not save the run.
  S.reset({ notebookPresent: true, folders: { [HOME]: { id: 11, writers: [OWNER] }, [`${HOME}/inspire_out`]: { id: 15, writers: [OWNER] } } });
  const got = await launch(`${HOME}/inspire_out`);
  assert.equal(got.status, 403, got.text);
  assert.equal(got.data.policy.rule, 'writer');
  assert.deepEqual(got.data.unwritable, [`${HOME}/inspire_out`]);
  assert.equal(got.data.error, APP_CANT(`${HOME}/inspire_out`));
  assert.deepEqual(submitted(), [], 'no job was created or run');
  assert.deepEqual(S.state.launches, []);
  assert.deepEqual(S.state.created, [], 'the refused probe created nothing');
  assert.ok(probes().length === 1 && probes()[0].token === S.APP_TOKEN, 'one probe, with the App token, never the person token');
});

test('a run launch into a folder the App can write is submitted, the probe is deleted, and the launch record says the check passed on that folder', async () => {
  for (const [label, seed, asked, folder] of [
    ['the default folder beside the notebook, open to all users', {}, undefined, '/Shared/demos'],
    ['the nearest existing parent decides for a folder that does not exist yet', { folders: { [`/Users/${ME}`]: { id: 12, writers: [ME, S.APP_SP] } } }, `/Workspace/Users/${ME}/new/deeper`, `/Users/${ME}/new/deeper`],
    ['a folder the App is granted on directly, while the person is in a group the App is not in', { personGroups: ['analysts'], folders: { '/Shared/team': { id: 13, writers: [S.APP_SP] } } }, '/Shared/team/out', '/Shared/team/out'],
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

test('a folder the App cannot write refuses the launch even when the person can reach it: a group the App is not in, a hidden folder, a notebook in the way and a missing scope (must-exclude)', async () => {
  // The person reaches group:finance through parents, but the App is not in it, so the App's probe fails.
  // The refusal wording is the App's own (the copy does not carry the reason, see the report).
  for (const [label, seed, expected] of [
    ['a group the App is not in, though the person reaches it through parents',
      { personGroups: ['analysts'], groupParents: { analysts: ['data'], data: ['finance'] }, folders: { '/Shared/team': { id: 13, writers: ['group:finance'] } } }, APP_CANT_CREATE('/Shared/team/out')],
    ['a folder the App cannot see', { folders: { '/Shared/team': { id: 13, hidden: true } } }, APP_HIDDEN('/Shared/team/out', '/Shared/team')],
    ['a notebook where the folder would be', { folders: { '/Shared/team': { id: 13, type: 'NOTEBOOK' } } }, APP_NOT_FOLDER('/Shared/team')],
    ['an App check that lacks a workspace scope', { scopeless: true, folders: { '/Shared/team': { id: 13, writers: '*' } } }, APP_SCOPE('/Shared/team/out')],
  ]) {
    S.reset({ notebookPresent: true, ...seed });
    const got = await launch('/Shared/team/out');
    assert.equal(got.status, 403, `${label}: ${got.text}`);
    assert.equal(got.data.policy.rule, 'writer', label);
    assert.deepEqual(got.data.unwritable, ['/Shared/team/out'], label);
    assert.equal(got.data.error, expected, label);
    assert.deepEqual(submitted(), [], label);
    assert.deepEqual(S.state.launches, [], label);
  }
});

test('a volume the App can only read is refused with a 403 that names the data-owner fix, and nothing is submitted', async () => {
  S.reset({ notebookPresent: true, volumes: { 'main.sales.files': { writers: [OWNER] } } });
  const got = await launch('/Volumes/main/sales/files/out');
  assert.equal(got.status, 403, got.text);
  assert.equal(got.data.policy.rule, 'writer');
  assert.deepEqual(got.data.unwritable, ['/Volumes/main/sales/files/out']);
  assert.equal(got.data.error, APP_CANT_VOLUME('/Volumes/main/sales/files/out'));
  assert.deepEqual(submitted(), [], 'no job was created or run');
  assert.deepEqual(S.state.launches, []);
});

test('a person whose sign-in cannot read folder permissions or Unity Catalog grants still launches, because the App writes the output and reads no person grant', async () => {
  for (const [label, seed, asked] of [
    ['their own folder', { folders: { [`/Users/${ME}`]: { id: 12, writers: [ME, S.APP_SP] } } }, `/Users/${ME}/out`],
    ['a volume the App can write', { volumes: { 'main.sales.files': { writers: [S.APP_SP] } } }, '/Volumes/main/sales/files/out'],
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
  S.reset({ notebookPresent: true, deleteFails: true, folders: { [`/Users/${ME}`]: { id: 12, writers: [ME, S.APP_SP] } } });
  assert.equal((await launch(`/Users/${ME}/out`)).status, 200, 'a failed delete does not fail the launch');
  assert.equal(S.state.created.length, 1, 'the probe stayed');
  assert.ok(S.state.logs.some((l) => l.includes('could not be deleted; the next check in that folder deletes it')));
  const left = S.state.created[0];
  const file = `/Users/${ME}/${W().PROBE_PREFIX}notes.py`;
  S.reset({ notebookPresent: true, leftovers: [left, stale, `/Users/${ME}/keep_me`], leftoverFiles: [file], folders: { [`/Users/${ME}`]: { id: 12, writers: [ME, S.APP_SP] } } });
  assert.equal((await launch(`/Users/${ME}/out`)).status, 200);
  assert.deepEqual(S.state.leftovers, [`/Users/${ME}/keep_me`], 'only probe leftovers are swept');
  assert.deepEqual(S.state.leftoverFiles, [file], 'a file that only shares the probe name is never deleted (must-exclude)');
  assert.ok(S.state.deleted.includes(left) && S.state.deleted.includes(stale));
});

test('a volume needs a probe the App can create, read with the App token, and a grant the App does not hold is refused', async () => {
  for (const [label, volume, status, message] of [
    ['WRITE VOLUME for the App', { writers: [S.APP_SP] }, 200, null],
    ['WRITE VOLUME for the person only, which the App does not hold', { writers: [ME] }, 403, APP_CANT_VOLUME('/Volumes/main/sales/files/out')],
    ['WRITE VOLUME through a group the App is not in, though the person is', { writers: ['group:lake-writers'] }, 403, APP_CANT_VOLUME('/Volumes/main/sales/files/out')],
    ['READ VOLUME only', { writers: [OWNER] }, 403, APP_CANT_VOLUME('/Volumes/main/sales/files/out')],
    ['no such volume', null, 403, APP_HIDDEN_VOLUME('/Volumes/main/sales/files/out', '/Volumes/main/sales/files')],
  ]) {
    S.reset({ notebookPresent: true, personGroups: ['analysts'], groupParents: { analysts: ['lake-writers'] }, volumes: volume ? { 'main.sales.files': volume } : {} });
    const got = await launch('/Volumes/Main/Sales/Files/out');
    assert.equal(got.status, status, `${label}: ${got.text}`);
    if (status === 403) assert.equal(got.data.error, message, label);
    if (status === 200) assert.deepEqual([S.state.launches[0].output_folder, S.state.created.length], ['/Volumes/main/sales/files/out', 0], label);
    const fsCalls = S.state.calls.filter((c) => c.path.startsWith('/api/2.0/fs/'));
    assert.ok(fsCalls.length > 0, `${label}: the volume was checked`);
    assert.ok(fsCalls.every((c) => c.token === S.APP_TOKEN), `${label}: every volume call is the App checking its own write, never the person`);
  }
});

test('an App manager is checked like everyone else: a folder the App cannot write refuses the launch, and one it can write launches as passed (REQ-418: no manager skip)', async () => {
  const folders = { [HOME]: { id: 11, writers: [OWNER] } };
  S.reset({ notebookPresent: true, managers: [BOSS], folders });
  const refused = await launch(`${HOME}/inspire_out`, { person: BOSS });
  assert.equal(refused.status, 403, refused.text);
  assert.equal(refused.data.error, APP_CANT_CREATE(`${HOME}/inspire_out`));
  assert.deepEqual(submitted(), [], 'nothing is submitted');
  S.reset({ notebookPresent: true, managers: [BOSS], folders: { [HOME]: { id: 11, writers: [OWNER, S.APP_SP] } } });
  const ok = await launch(`${HOME}/inspire_out`, { person: BOSS });
  assert.equal(ok.status, 200, ok.text);
  assert.deepEqual([S.state.launches[0].output_folder, S.state.launches[0].output_checked], [`${HOME}/inspire_out`, 'passed']);
  assert.ok(probes().length > 0, 'the App probe runs for a manager too');
});

test('a CAN MANAGE grant on the App through a nested group refuses a person outside it, and that group is checked like everyone else', async () => {
  const folders = { [HOME]: { id: 11, writers: [OWNER] } };
  S.reset({ notebookPresent: true, managerGroups: ['app-admins'], personGroups: ['analysts'], groupParents: { analysts: ['data'] }, folders });
  const outside = await launch(`${HOME}/inspire_out`);
  assert.equal(outside.status, 403, `a group that does not reach the App managers grants nothing (must-exclude): ${outside.text}`);
  assert.equal(outside.data.error, APP_CANT_CREATE(`${HOME}/inspire_out`));
  assert.deepEqual(submitted(), []);
  S.reset({ notebookPresent: true, managerGroups: ['app-admins'], personGroups: ['analysts', 'app-admins'], indirectGroups: ['app-admins'], folders });
  const nested = await launch(`${HOME}/inspire_out`);
  assert.equal(nested.status, 403, `a nested manager is checked too, and the App cannot write there (REQ-418): ${nested.text}`);
  assert.equal(nested.data.error, APP_CANT_CREATE(`${HOME}/inspire_out`));
  assert.ok(probes().length > 0, 'the App probe runs for a nested manager too');
});

test('a launch with no person sign-in still runs as the App: no 401, the App token on every write check, and the shared folder when there is no own folder', async () => {
  S.reset({ notebookPresent: true });
  const got = await launch(undefined, { signedIn: false });
  assert.equal(got.status, 200, got.text);
  assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['11_generation_path'], '/Workspace/Shared/demos', 'the shared folder is the one the notebook saves to');
  assert.ok(S.state.createdJob, 'the job was created');
  assert.deepEqual([...new Set(probes().map((c) => c.token))], [S.APP_TOKEN]);
  assert.equal(S.state.calls.filter((c) => c.token === S.PERSON_TOKEN).length, 0, 'no call carried a person token');
  S.reset({ notebookPresent: true });
  const signedInNoToken = await launch(undefined, { userToken: false });
  assert.equal(signedInNoToken.status, 200, `no 401 when only the person's token is missing: ${signedInNoToken.text}`);
  assert.deepEqual(signedInNoToken.data.warnings, [SHARED_ONLY(ME)]);
  assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['11_generation_path'], '/Workspace/Shared/demos');
});

test('the output folder check answers the same verdict a launch would, without launching anything, for a manager too', async () => {
  const ask = (person, path = `${HOME}/inspire_out`) => S.request('POST', '/api/output-folder/check', { person, body: { generation_path: path } });
  S.reset({ folders: { [HOME]: { id: 11, writers: [OWNER, S.APP_SP] } } });
  const writable = await ask(OWNER);
  assert.equal(writable.status, 200, writable.text);
  assert.deepEqual(writable.data, { allowed: true, folder: `${HOME}/inspire_out`, checked: 'passed', warnings: [] });
  assert.deepEqual(S.state.created, [], 'the probe was deleted');
  S.reset({ folders: { [HOME]: { id: 11, writers: [OWNER] } } });
  const refused = await ask(OWNER);
  assert.equal(refused.status, 403, refused.text);
  assert.equal(refused.data.error, APP_CANT_CREATE(`${HOME}/inspire_out`));
  assert.equal(refused.data.policy.rule, 'writer');
  assert.deepEqual(S.state.created, [], 'the refused probe created nothing');
  const folders = { [HOME]: { id: 11, writers: [OWNER] } };
  for (const path of ['./../demos/', '']) {
    S.reset({ folders: { ...folders, '/Shared/demos': { id: 7, writers: '*' } }, managers: [BOSS] });
    const own = await ask(OWNER, path);
    assert.deepEqual([own.status, own.data], [200, { allowed: true, folder: `${HOME}/inspire_output`, checked: 'passed', warnings: [], generation_path: `/Workspace${HOME}/inspire_output` }], `${JSON.stringify(path)}: ${own.text}`);
    assert.deepEqual(S.state.calls.filter(WRITE_CALL).map((c) => `${c.method} ${c.path}`), [], `${JSON.stringify(path)}: loading Start writes nothing (must-exclude)`);
    assert.deepEqual([S.state.grants, S.state.folders[`${HOME}/inspire_output`]], [[], undefined], `${JSON.stringify(path)}: no folder and no grant until Start`);
    S.reset({ folders: { ...folders, '/Shared/demos': { id: 7, writers: '*' } }, managers: [BOSS], scopeless: true });
    const fallback = await ask(OWNER, path);
    assert.deepEqual([fallback.status, fallback.data.folder, fallback.data.warnings, fallback.data.generation_path],
      [200, '/Shared/demos', [SCOPE_ONLY(OWNER)], '/Workspace/Shared/demos'], `${JSON.stringify(path)}: ${fallback.text}`);
  }
  const old = await S.request('GET', `/api/output-folder/check?generation_path=${encodeURIComponent('./../demos/')}`, { person: OWNER });
  assert.equal(old.status, 404, 'the check is a POST, so no generation path ever travels in a request URL');
  const theirs = await ask(ME);
  assert.equal(theirs.status, 403, theirs.text);
  assert.equal(theirs.data.policy.rule, 'writer');
  assert.deepEqual(S.state.calls.filter((c) => c.path.startsWith('/api/2.1/jobs/') || c.statement.startsWith('INSERT')), []);
  S.reset({ folders, managers: [BOSS] });
  const boss = await ask(BOSS);
  assert.equal(boss.status, 403, boss.text);
  assert.equal(boss.data.error, APP_CANT_CREATE(`${HOME}/inspire_out`));
  assert.deepEqual(S.state.created, [], 'the refused probe created nothing');
});

test('a launched run opens its output folder with the App token, for a passed check and for a manager skip of that exact folder', async () => {
  for (const [person, seed] of [[ME, {}], [BOSS, { managers: [BOSS], folders: { '/Shared/demos': { id: 7, writers: [S.APP_SP] } } }]]) {
    S.reset({ notebookPresent: true, sessionRows: { [S.APP_DB]: [{ session_id: '1001', generation_path: './../demos/', business_name: 'Acme' }] }, ...seed });
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

test('the default output folder is the person’s own inspire_output once the App can write it, a folder the App cannot write falls back to the shared folder with a line of text, and a typed folder is never swapped (must-exclude)', async () => {
  const mine = `/Users/${ME}`;
  const appWritable = { notebookPresent: true, folders: { '/Shared/demos': { id: 7, writers: '*' }, [mine]: { id: 12, writers: [ME, S.APP_SP] } } };
  for (const asked of [undefined, '', './../demos/']) {
    S.reset(appWritable);
    const got = await launch(asked);
    assert.equal(got.status, 200, `${JSON.stringify(asked)}: ${got.text}`);
    assert.equal(got.data.warnings, undefined, `${JSON.stringify(asked)}: the person’s own folder needs no warning`);
    assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['11_generation_path'], `/Workspace${mine}/inspire_output`);
    assert.equal(S.state.launches[0].output_folder, `${mine}/inspire_output`);
  }
  S.reset(appWritable);
  const check = await S.request('POST', '/api/output-folder/check', { person: ME, body: { generation_path: '' } });
  assert.deepEqual([check.status, check.data], [200, { allowed: true, folder: `${mine}/inspire_output`, checked: 'passed',
    warnings: [], generation_path: `/Workspace${mine}/inspire_output` }]);
  S.reset(appWritable);
  const typed = await launch('/Shared/demos/');
  assert.equal(typed.status, 200, typed.text);
  assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['11_generation_path'], '/Shared/demos/', 'a folder the person typed is never swapped');
  S.reset({ notebookPresent: true, permissionsRefused: 'sharing is off', folders: { '/Shared/demos': { id: 7, writers: '*' }, [mine]: { id: 12, writers: [ME] } } });
  const appless = await launch(undefined);
  assert.equal(appless.status, 200, appless.text);
  assert.deepEqual(appless.data.warnings, [SHARED_ONLY(ME)]);
  assert.equal(S.state.launches[0].output_folder, '/Shared/demos');
  assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['11_generation_path'], '/Workspace/Shared/demos',
    'the shared folder the warning names is the folder the notebook is told to save to, never an empty path it refuses');
  S.reset({ notebookPresent: true, scopeless: true, folders: { '/Shared/demos': { id: 7, writers: '*' }, [mine]: { id: 12, writers: [ME] } } });
  const applessCheck = await S.request('POST', '/api/output-folder/check', { person: ME, body: { generation_path: '' } });
  assert.equal(applessCheck.data.generation_path, '/Workspace/Shared/demos');
  S.reset({ notebookPresent: true, folders: { '/Shared/demos': { id: 7, writers: '*' } } });
  const nohome = await launch(undefined);
  assert.deepEqual(nohome.data.warnings, [SHARED_ONLY(ME)]);
  assert.match(nohome.data.warning_details[0], /^POST \/api\/2\.0\/workspace\/mkdirs \/Users\/nonowner@example\.com\/inspire_output answered HTTP 403/, 'why the person’s own folder failed sits under Details');
  assert.deepEqual(S.state.grants, [], 'a folder the App cannot write is never shared by a failed grant');
  assert.equal(S.state.createdJob.tasks[0].notebook_task.base_parameters['11_generation_path'], '/Workspace/Shared/demos');
  S.reset({ notebookPresent: true, folders: { '/Shared/demos': { id: 7, writers: [] }, [mine]: { id: 12, writers: [ME, S.APP_SP] } } });
  const locked = await launch(undefined);
  assert.equal(locked.status, 200, locked.text);
  assert.equal(S.state.launches[0].output_folder, `${mine}/inspire_output`);
  S.reset({ notebookPresent: true, folders: { '/Shared/demos': { id: 7, writers: [] }, [mine]: { id: 12, writers: [OWNER] } } });
  const nowhere = await launch(undefined);
  assert.equal(nowhere.status, 403, `neither folder takes the run: ${nowhere.text}`);
  assert.deepEqual(nowhere.data.unwritable, [`${mine}/inspire_output`], 'the refusal names the person’s own output folder, the one the run would save to');
  assert.equal(nowhere.data.error, UNRUNNABLE_OWN(`${mine}/inspire_output`));
  assert.deepEqual(submitted(), []);
});

test('a folder the App can write takes the run with no warning, and the App’s own probe is the only write check', async () => {
  S.reset({ notebookPresent: true, folders: { [HOME]: { id: 11, writers: [OWNER, S.APP_SP] } } });
  const granted = await launch(`${HOME}/inspire_out`);
  assert.equal(granted.status, 200, granted.text);
  assert.equal(granted.data.warnings, undefined);
  assert.ok(probes().length > 0 && probes().every((c) => c.token === S.APP_TOKEN), 'the App checked its own write, and the person was never probed');
});

test('a folder that does not exist yet is checked on its nearest existing parent for the App too: a parent the App can write says nothing, a parent it cannot refuses and says the folder is new and how to fix it, and an existing locked folder keeps the grant text (must-exclude)', async () => {
  const ask = (path) => S.request('POST', '/api/output-folder/check', { person: OWNER, body: { generation_path: path } });
  const fresh = `${HOME}/brand_new/deeper`;
  S.reset({ folders: { [HOME]: { id: 11, writers: [OWNER, S.APP_SP] } } });
  const open = await ask(`/Workspace${fresh}`);
  assert.deepEqual([open.status, open.data.warnings], [200, []], `the App can create under the parent, so a new folder is fine: ${open.text}`);
  assert.ok(probes().some((c) => c.token === S.APP_TOKEN && String(JSON.parse(c.raw).path).startsWith(`${HOME}/${W().PROBE_PREFIX}`)), 'the App probe ran in the existing parent');
  S.reset({ folders: { [HOME]: { id: 11, writers: [OWNER] } } });
  const closed = await ask(`/Workspace${fresh}`);
  assert.deepEqual([closed.status, closed.data.error], [403, APP_CANT_CREATE(fresh)], closed.text);
  S.reset({ folders: { [HOME]: { id: 11, writers: [OWNER] }, [`${HOME}/made`]: { id: 14, writers: [OWNER] } } });
  const existing = await ask(`${HOME}/made`);
  assert.deepEqual([existing.status, existing.data.error], [403, APP_CANT(`${HOME}/made`)], 'an existing folder the App cannot write keeps the grant text');
  S.reset({ folders: { [HOME]: { id: 11, writers: [OWNER] }, [`${HOME}/made`]: { id: 14, writers: [OWNER, S.APP_SP] } } });
  assert.deepEqual((await ask(`${HOME}/made`)).data.warnings, [], 'an existing folder the App can write says nothing');
  S.reset({ volumes: { 'main.sales.files': { writers: [S.APP_SP] } } });
  const volumeOpen = await ask('/Volumes/main/sales/files/new_out');
  assert.deepEqual([volumeOpen.status, volumeOpen.data.warnings], [200, []], 'a volume the App can write says nothing');
  S.reset({ volumes: { 'main.sales.files': { writers: [OWNER] } } });
  const volume = await ask('/Volumes/main/sales/files/new_out');
  assert.deepEqual([volume.status, volume.data.error], [403, APP_CANT_VOLUME('/Volumes/main/sales/files/new_out')], 'a volume needs WRITE VOLUME for the App, never CAN MANAGE');
});

test('a Generation Path that is no folder is refused with a 400 that says why, for an App manager too, before any probe or job (must-exclude)', async () => {
  const NOT_A_FOLDER = (folder) => `Inspire cannot save to ${folder}: it is not a workspace folder or a volume path Inspire can resolve. Give an absolute folder, such as one under your own user folder.`;
  const NO_VOLUME = (folder) => `Inspire cannot save to ${folder}: it names no Unity Catalog volume. Choose a folder inside a volume, /Volumes/<catalog>/<schema>/<volume>/....`;
  for (const [asked, folder, text] of [
    ['https://x/y', 'https://x/y', NOT_A_FOLDER], ['/Volumes/c', '/Volumes/c', NO_VOLUME], ['/Volumes/c/s', '/Volumes/c/s', NO_VOLUME],
  ]) {
    for (const person of [ME, BOSS]) {
      S.reset({ notebookPresent: true, managers: [BOSS] });
      const got = await launch(asked, { person });
      assert.equal(got.status, 400, `${asked} as ${person}: ${got.text}`);
      assert.equal(got.data.error, text(folder), `${asked} as ${person}`);
      assert.deepEqual(got.data.unwritable, [folder]);
      assert.deepEqual(submitted(), [], `${asked} as ${person}: no job`);
      assert.deepEqual(probes(), [], `${asked} as ${person}: no probe`);
      S.reset({ notebookPresent: true, managers: [BOSS] });
      const check = await S.request('POST', '/api/output-folder/check', { person, body: { generation_path: asked } });
      assert.equal(check.status, 400, `the check of ${asked} as ${person}: ${check.text}`);
      assert.equal(check.data.error, text(folder));
    }
  }
  S.reset({ notebookPresent: true, managers: [BOSS] });
  const fine = await launch('/Volumes/c/s/v/out', { person: BOSS });
  assert.notEqual(fine.status, 400, `a full volume path is a folder: ${fine.text}`);
});
