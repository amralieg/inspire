const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

test('the version a vibe builds on is the newest built one, and each action sends only its own keys', async () => {
  const C = await lib('implementControl.js');
  const rows = [{ spec_version: 1, status: 'ready' }, { spec_version: 4, status: 'failed' }, { spec_version: 3, status: 'ready_with_warnings' },
    { spec_version: 5, status: 'uninstalled' }];
  assert.equal(C.liveVersion(rows), 3, 'a failed or uninstalled version is not live');
  assert.equal(C.liveVersion([{ spec_version: 1, status: 'queued' }]), null);
  assert.equal(C.liveVersion(null), null);
  assert.deepEqual(C.removeKeptChanges('2'), { remove_kept: [2] });
  assert.deepEqual(C.uninstallChanges(), { uninstall: true });
});

test('a new version drops every one-version action of the version it is based on, and keeps the lasting choices', async () => {
  const W = await lib('implementWizard.js');
  const C = await lib('implementControl.js');
  const latest = {
    spec_version: 4,
    spec_json: {
      use_case_id: 'N01-U01', outputs: { dashboard: true, dashboard_vibes: 'Trend first' }, vibes: 'old ask', vibe_previous: 'remove',
      remove_kept: [2], uninstall: true, retry_outputs: ['dashboard'], retry_asks: { dashboard: ['x'] }, rollback_outputs: { app: 1 },
      confirm_notebook_overwrite: true, based_on_version: 3,
    },
  };
  const next = W.nextSpecFrom(latest, { vibes: 'New ask', vibe_previous: 'keep' });
  assert.deepEqual(next, { use_case_id: 'N01-U01', outputs: { dashboard: true, dashboard_vibes: 'Trend first' }, based_on_version: 4,
    vibes: 'New ask', vibe_previous: 'keep' });
  const plain = W.nextSpecFrom(latest);
  for (const key of ['vibes', 'vibe_previous', 'remove_kept', 'uninstall', 'retry_outputs', 'retry_asks', 'rollback_outputs', 'confirm_notebook_overwrite']) {
    assert.ok(!Object.hasOwn(plain, key), `${key} is carried into the next version`);
  }
  assert.deepEqual(W.nextSpecFrom(latest, C.uninstallChanges()).uninstall, true);
});

test('kept versions come from the newest list, grouped by version newest first, and bad entries are dropped', async () => {
  const C = await lib('implementControl.js');
  const entry = (output, id, version) => ({ output, id, url: `https://x/${id}`, title: `${output} v${version}`, version, kept_in: 4 });
  const history = [
    { spec_version: 3, asset_status: { kept: { state: 'kept', assets: [entry('dashboard', 'old', 1)] } } },
    { spec_version: 4, asset_status: { kept: { state: 'kept', assets: [
      entry('dashboard', 'd2', 2), entry('app', 'churn-desk-v3', 3), entry('genie_space', 'g2', 2),
      entry('notebook', 'n1', 2), entry('alert', '', 2), entry('app', 'x', 0), { output: 'dashboard', id: 'd9', version: 'two' },
    ] } } },
  ];
  assert.deepEqual(C.keptVersions(history), [
    { version: 3, keptIn: 4, assets: [{ output: 'app', label: 'App', id: 'churn-desk-v3', url: 'https://x/churn-desk-v3', title: 'app v3' }] },
    { version: 2, keptIn: 4, assets: [
      { output: 'dashboard', label: 'Dashboard', id: 'd2', url: 'https://x/d2', title: 'dashboard v2' },
      { output: 'genie_space', label: 'Genie Agent', id: 'g2', url: 'https://x/g2', title: 'genie_space v2' },
    ] },
  ]);
  const emptied = [...history, { spec_version: 5, asset_status: { kept: { state: 'kept', assets: [] } } }];
  assert.deepEqual(C.keptVersions(emptied), [], 'a removal that emptied the list keeps nothing');
  assert.deepEqual(C.keptVersions([{ spec_version: 1, asset_status: {} }]), []);
});

test('the rail filter counts and keeps only use cases that have the asset, and an uninstalled MVP has none of its own', async () => {
  const C = await lib('implementControl.js');
  const full = { id: 'A', latest: { status: 'ready', dashboard_url: 'https://x/d', app_url: 'https://x/a', notebook_path: '/W/a' } };
  const notebookOnly = { id: 'B', latest: null, notebook: { state: 'ready' } };
  const requested = { id: 'C', latest: null, notebook: { state: 'requested' } };
  const gone = { id: 'D', latest: { status: 'uninstalled', dashboard_url: 'https://x/stale', notebook_path: '/W/stale' }, notebook: null };
  const goneKeepsDiscovery = { id: 'E', latest: { status: 'uninstalled' }, notebook: { state: 'ready' } };
  const items = [full, notebookOnly, requested, gone, goneKeepsDiscovery];
  assert.deepEqual([...C.itemAssets(full)].sort(), ['app', 'dashboard', 'notebook']);
  assert.deepEqual([...C.itemAssets(gone)], [], 'an uninstalled MVP shows none of the assets it removed');
  assert.deepEqual([...C.itemAssets(goneKeepsDiscovery)], ['notebook'], 'the notebook Discover wrote survives an uninstall');
  assert.deepEqual(C.assetFilterCounts(items).map((f) => [f.id, f.count]),
    [['notebook', 3], ['app', 1], ['dashboard', 1], ['genie_space', 0], ['alert', 0]]);
  const groups = [{ id: 'ready', items: [full, notebookOnly] }, { id: 'not_started', items: [requested, gone, goneKeepsDiscovery] }];
  assert.equal(C.filterByAsset(groups, ''), groups, 'no filter changes nothing');
  assert.deepEqual(C.filterByAsset(groups, 'dashboard').map((g) => g.items.map((i) => i.id)), [['A'], []]);
  assert.deepEqual(C.filterByAsset(groups, 'notebook').map((g) => g.items.map((i) => i.id)), [['A', 'B'], ['E']]);
  assert.deepEqual(C.filterByAsset(groups, 'genie_space').map((g) => g.items.length), [0, 0]);
});

test('an uninstalled MVP reads as uninstalled and goes back to Start, and only a built MVP is an MVP to open', async () => {
  const W = await lib('implementWizard.js');
  assert.deepEqual(W.statusChip('uninstalled'), { label: 'Uninstalled', tone: 'idle' });
  assert.deepEqual(W.implementState({ status: 'uninstalled' }, { state: 'ready', label: 'Notebook ready', tone: 'success' }),
    { group: 'not_started', label: 'MVP uninstalled', tone: 'idle', kind: 'uninstalled' });
  assert.equal(W.implementState({ status: 'ready' }).kind, 'mvp');
  assert.equal(W.implementState(null, { state: 'ready', label: 'Notebook ready', tone: 'success' }).kind, 'notebook');
  assert.equal(W.START_MVP_LABEL, 'Start Use Case MVP with Genie');
});
