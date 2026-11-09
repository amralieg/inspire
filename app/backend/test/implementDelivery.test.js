const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);
const REASON = 'the Genie Agent still failed after 3 Genie rounds: it joins no other table';
const row = (status, delivery, extra = {}) => ({
  use_case_id: 'N01-U01', spec_version: 3, status, genie_space_id: 'g1', genie_space_url: 'https://host/genie/rooms/g1',
  dashboard_id: 'd1', dashboard_url: 'https://host/dashboards/d1',
  asset_status: { genie_space: { state: 'failed' }, dashboard: { state: 'ready' }, ...(delivery === undefined ? {} : { delivery }) },
  ...extra,
});
const missing = (version = 3) => ({ spec_version: version, delivered: ['dashboard'], not_delivered: [{ output: 'genie_space', label: 'Genie Agent', reason: REASON }] });

test('an output the build did not deliver is never shown as ready or delivered, and has no link', async () => {
  const W = await lib('implementWizard.js');
  const C = await lib('implementControl.js');
  const latest = row('ready_with_warnings', missing());
  assert.deepEqual(W.undeliveredOutputs(latest), [{ output: 'genie_space', label: 'Genie Agent', reason: REASON }]);
  assert.deepEqual(W.implementState(latest), { group: 'held', label: W.UNDELIVERED_LABEL, tone: 'warning', kind: 'mvp' });
  assert.deepEqual(C.deliveredOutputs(latest), ['dashboard']);
  const rows = C.controlRows({ targets: { genie_space: 'g1', dashboard: 'd1' }, assets: { genie_space: { ok: true }, dashboard: { ok: true } } }, latest);
  assert.equal(rows.find((r) => r.id === 'genie_space').url, '', 'no link to an agent that failed');
  assert.equal(rows.find((r) => r.id === 'dashboard').url, 'https://host/dashboards/d1');
});

test('a delivery record of an older version, an empty list or a full delivery changes nothing (must-exclude)', async () => {
  const W = await lib('implementWizard.js');
  const C = await lib('implementControl.js');
  assert.deepEqual(W.undeliveredOutputs(row('ready_with_warnings', missing(2))), []);
  assert.equal(W.implementState(row('ready_with_warnings', missing(2))).label, 'MVP ready with warnings');
  const full = row('ready', { spec_version: 3, delivered: ['dashboard', 'genie_space'], not_delivered: [] });
  assert.equal(W.implementState(full).label, 'MVP ready');
  assert.deepEqual(C.deliveredOutputs(full).sort(), ['dashboard', 'genie_space']);
  assert.deepEqual(W.undeliveredOutputs(row('ready', { spec_version: 3, not_delivered: [null, { output: ' ' }, 'x'] })), []);
  assert.equal(W.DELIVERY_RECORD, 'delivery', 'the agent writes this record');
});

test('a version that left an asked output undelivered reads MVP incomplete in one plain sentence, the raw reason kept for Details', async () => {
  const W = await lib('implementWizard.js');
  const P = await lib('mvpProgress.js');
  const said = `Genie Agent not built: ${REASON}; Notebook: Genie set Minimum usable rows to 1, not 0`;
  const latest = row('ready_with_warnings', missing(), { status_message: said });
  assert.deepEqual(W.statusChip(latest.status, null, latest), { label: W.UNDELIVERED_LABEL, tone: 'warning' });
  assert.equal(W.statusReason(latest), 'The MVP is incomplete: Inspire could not build the Genie Agent. Rebuild in Vibe/Add/Remove Features to try again.');
  assert.equal(W.statusDetails(latest), said);
  assert.equal(P.statusProgress({ latest, steps: [] }).percent, 100);
  const older = row('ready_with_warnings', missing(2), { status_message: said });
  assert.deepEqual(W.statusChip(older.status, null, older), { label: 'Warnings', tone: 'warning' }, 'an older version record changes nothing');
  assert.equal(W.statusReason(older), said);
  assert.equal(W.statusDetails(older), '');
  assert.deepEqual(W.statusChip('ready_with_warnings'), { label: 'Warnings', tone: 'warning' });
});

test('the Genie round label says the ceiling is an upper bound', async () => {
  const source = require('node:fs').readFileSync(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'mvpProgress.js'), 'utf8');
  assert.match(source, /` of up to \$\{current\.rounds\}`/);
});
