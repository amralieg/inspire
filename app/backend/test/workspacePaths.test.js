const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const W = require('../lib/workspacePaths');
const S = require('./support/serverApp');

const NONOWNER = 'nonowner@example.com';
const VOLUME_OUT = '/Volumes/main/inspire/vol/out';
const VOLUME_SEED = () => ({
  sessionRows: { [S.APP_DB]: [{ session_id: '1001', generation_path: VOLUME_OUT }] },
  launches: [{ run_id: '91001', inspire_database: S.APP_DB, session_id: '1001', output_folder: VOLUME_OUT, output_checked: 'passed' }],
});
const actions = () => S.state.calls.filter((c) => c.category === 'action');

test.after(() => S.stopServer());

test('a workspace path must be absolute and free of . and .. folders, and every refusal names the field (must-exclude)', () => {
  for (const ok of ['/Workspace/Users/a@example.com/out', '/Users/a/out/acme/catalog.pdf', '/Volumes/c/s/v/out/', '  /Shared/demos  ', '/Shared/..hidden/x', '/Shared/a.b/c']) {
    assert.equal(W.workspacePathProblem('path', ok), '', ok);
  }
  assert.equal(W.workspacePathProblem('path', ''), 'path is required.');
  assert.equal(W.workspacePathProblem('path', '   '), 'path is required.');
  assert.equal(W.workspacePathProblem('path', undefined), 'path is required.');
  assert.equal(W.workspacePathProblem('path', ['/a', '/b']), 'path is required.');
  for (const bad of ['./../demos/acme', '../demos', 'demos/acme', '/Workspace/../demos/acme', '/Shared/./demos', `${VOLUME_OUT}/..`, `${VOLUME_OUT}/../../other/vol`]) {
    assert.equal(W.workspacePathProblem('destination_path', bad), `destination_path ${W.PATH_RULE}`, bad);
  }
});

test('a files API path encodes each folder, so encoded dots, ? and # stay inside the file name', () => {
  assert.equal(W.fsApiPath('directories', '/Volumes/c/s/v/out'), '/api/2.0/fs/directories/Volumes/c/s/v/out');
  assert.equal(W.fsApiPath('files', '/Volumes/c/s/v/a b/%2e%2e/x?y#z'), '/api/2.0/fs/files/Volumes/c/s/v/a%20b/%252e%252e/x%3Fy%23z');
  assert.equal(new URL(`https://h.example.com${W.fsApiPath('files', `${VOLUME_OUT}/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/secrets/list`)}`).pathname
    .startsWith('/api/2.0/fs/files/Volumes/main/inspire/vol/out/'), true);
});

test('list, export and status refuse a relative or .. path with 400 before any workspace call (must-exclude)', async () => {
  for (const route of ['/api/workspace/list', '/api/workspace/export', '/api/workspace/status']) {
    for (const bad of ['./../demos/acme', 'demos/acme', '/Workspace/../demos/acme', `${VOLUME_OUT}/x/..`, '/Shared/./demos']) {
      S.reset(VOLUME_SEED());
      const got = await S.request('GET', `${route}?path=${encodeURIComponent(bad)}`, { person: NONOWNER });
      assert.equal(got.status, 400, `${route} ${bad}: ${got.text}`);
      assert.equal(got.data.error, `path ${W.PATH_RULE}`);
      assert.deepEqual(actions(), [], `${route} ${bad} called nothing`);
    }
    S.reset(VOLUME_SEED());
    const twice = await S.request('GET', `${route}?path=%2FShared%2Fa&path=%2FShared%2Fb`, { person: NONOWNER });
    assert.equal(twice.status, 400, `${route} with two paths: ${twice.text}`);
  }
});

test('an encoded .. under an App output volume cannot climb out of the files API with the App token (must-exclude)', async () => {
  const escape = `${VOLUME_OUT}/${Array(7).fill('%2e%2e').join('/')}/secrets/list`;
  for (const route of ['/api/workspace/list', '/api/workspace/export']) {
    S.reset(VOLUME_SEED());
    await S.request('GET', `${route}?path=${encodeURIComponent(escape)}`, { person: NONOWNER });
    const called = actions().map((c) => c.path);
    assert.ok(called.length > 0, `${route} reached the files API`);
    assert.deepEqual([...new Set(actions().map((c) => c.token))], ['app-sp-token'], 'the path sits inside an App output folder, so it reads with the App token');
    for (const p of called) assert.ok(p.startsWith(`/api/2.0/fs/`) && p.includes('/Volumes/main/inspire/vol/out/'), `${route} called ${p}`);
  }
});

test('publish refuses a relative or .. destination with the same rule', async () => {
  for (const route of ['/api/publish', '/api/publish/upload']) {
    for (const destination_path of ['relative/path', '/Shared/../Users/someone-else']) {
      S.reset({ managers: ['boss@example.com'] });
      const got = await S.request('POST', route, { person: 'boss@example.com', body: { destination_path } });
      assert.equal(got.status, 400, `${route} ${destination_path}: ${got.text}`);
      assert.equal(got.data.error, `destination_path ${W.PATH_RULE}`);
      assert.deepEqual(actions().filter((c) => c.path.startsWith('/api/2.0/workspace')), [], `${route} wrote nothing`);
    }
  }
});

test('Review candidates are absolute and collapsed, and a relative folder yields none (must-exclude)', async () => {
  const lib = pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'useCaseFields.js')).href;
  const { expandWorkspaceListCandidates } = await import(lib);
  assert.deepEqual(expandWorkspaceListCandidates('/Shared/../demos/acme'), ['/demos/acme', '/Workspace/demos/acme']);
  assert.deepEqual(expandWorkspaceListCandidates('/Workspace/Users/a/out/'), ['/Workspace/Users/a/out', '/Users/a/out']);
  assert.deepEqual(expandWorkspaceListCandidates(`${VOLUME_OUT}/acme/../beta/`), [`${VOLUME_OUT}/beta`]);
  for (const relative of ['./../demos/acme', '../demos', 'demos', '', null]) assert.deepEqual(expandWorkspaceListCandidates(relative), [], String(relative));
});
