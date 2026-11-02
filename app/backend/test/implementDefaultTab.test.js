const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

async function load() {
  const control = await lib('implementControl.js');
  const { versionActive } = await lib('implementWizard.js');
  const follow = (statuses, start = null, idle = 'app') => statuses.reduce(
    (view, status) => control.implementDefaultTab(view, versionActive(status && { status }), null, idle), start);
  return { ...control, versionActive, follow };
}

const built = (status, outputs) => ({ status, spec_json: { outputs } });

test('the page has six tabs in a fixed order, the Build tab first', async () => {
  const { MVP_TABS, BUILD_TAB } = await load();
  assert.deepEqual(MVP_TABS.map((t) => [t.id, t.label]), [
    ['build', 'Build'], ['app', 'App'], ['dashboard', 'Dashboard'], ['alert', 'Alert'], ['genie_space', 'Agent'], ['notebook', 'Notebook']]);
  assert.equal(BUILD_TAB, 'build');
});

test('a finished MVP opens on its first built asset, and a failed, stopped or uninstalled one opens on Build', async () => {
  const { idleMvpTab } = await load();
  const all = { app: true, dashboard: true, alert: true, genie_space: true };
  assert.equal(idleMvpTab(built('ready', all)), 'app');
  assert.equal(idleMvpTab(built('ready_with_warnings', { ...all, app: false })), 'dashboard');
  assert.equal(idleMvpTab(built('ready', { alert: true, genie_space: true })), 'alert');
  assert.equal(idleMvpTab(built('ready', { genie_space: true })), 'genie_space');
  assert.equal(idleMvpTab(built('ready', {})), 'notebook', 'a notebook-only MVP opens on its notebook');
  for (const status of ['failed', 'uninstalled', 'filling', 'queued', '']) {
    assert.equal(idleMvpTab(built(status, all)), 'build', status);
  }
  assert.equal(idleMvpTab(null), 'build');
  assert.equal(idleMvpTab({ status: 'ready' }), 'notebook', 'a version with no spec opens on the notebook');
});

test('the first look opens Build while a build runs and the idle tab otherwise', async () => {
  const { implementDefaultTab, versionActive } = await load();
  for (const status of ['queued', 'filling', 'previewing', 'building_outputs']) {
    assert.deepEqual(implementDefaultTab(null, versionActive({ status }), null, 'app'), { tab: 'build', active: true }, status);
  }
  for (const status of ['ready', 'ready_with_warnings']) {
    assert.deepEqual(implementDefaultTab(null, versionActive({ status }), null, 'dashboard'), { tab: 'dashboard', active: false }, status);
  }
  assert.deepEqual(implementDefaultTab(null, versionActive({ status: 'filling' }, { reason: 'the run ended' }), null, 'build'),
    { tab: 'build', active: false }, 'a run that stopped while filling is not building');
  assert.deepEqual(implementDefaultTab(undefined, undefined), { tab: 'build', active: false }, 'no idle tab given falls back to Build');
});

test('a build that starts opens Build and a build that ends opens the idle tab', async () => {
  const { follow } = await load();
  assert.equal(follow(['ready', 'queued']).tab, 'build', 'the user submits a change');
  assert.equal(follow(['queued', 'filling', 'ready']).tab, 'app', 'the build finished');
  assert.equal(follow(['filling', 'failed'], null, 'build').tab, 'build', 'the build failed');
  assert.equal(follow([null, 'queued']).tab, 'build', 'the first MVP of a use case starts');
  assert.equal(follow(['ready', 'queued', 'ready', 'queued']).tab, 'build');
});

test('between transitions the tab the user clicked stays, and a status flapping between two active states never switches it', async () => {
  const { implementDefaultTab, follow } = await load();
  const building = follow(['filling']);
  const clicked = implementDefaultTab(building, true, 'alert');
  assert.deepEqual(clicked, { tab: 'alert', active: true });
  assert.equal(follow(['previewing', 'building_outputs', 'filling'], clicked).tab, 'alert', 'the build moves on without a switch');
  assert.equal(follow(['building_outputs', 'ready'], clicked).tab, 'app', 'the build ends: the user sees what it built');

  const done = follow(['ready']);
  const looked = implementDefaultTab(done, false, 'notebook');
  assert.deepEqual(looked, { tab: 'notebook', active: false });
  assert.equal(follow(['ready_with_warnings', 'ready'], looked).tab, 'notebook', 'a finished status that changes is no transition');
  assert.equal(follow(['queued'], looked).tab, 'build', 'a new build starts while the user reads the notebook');

  const flapping = follow(['filling', 'previewing', 'filling', 'previewing']);
  assert.equal(flapping.tab, 'build');
  assert.equal(implementDefaultTab(flapping, true), flapping, 'the same view comes back while nothing changes');
});

test('a click on a tab that does not exist changes nothing', async () => {
  const { implementDefaultTab, follow } = await load();
  const done = follow(['ready']);
  for (const picked of ['Edit', 'Progress', 'Control Tower', 'pdf', 'App']) {
    assert.equal(implementDefaultTab(done, false, picked), done, picked);
  }
  assert.deepEqual(implementDefaultTab(null, true, 'History'), { tab: 'build', active: true });
  assert.deepEqual(implementDefaultTab(done, true, 'Edit'), { tab: 'build', active: true }, 'an unknown click never hides a transition');
});
