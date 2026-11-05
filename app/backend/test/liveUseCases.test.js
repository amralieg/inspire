const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const L = require('../../frontend/src/lib/liveUseCases.js');

const gen = (useCases, status = 'ended_success') => ({ status, result_json: { prompt_name: 'BASE_USE_CASE_GEN_PROMPT', use_cases: useCases } });

test('the live count keeps every drafted use case of every batch, even when two batches number their rows the same', () => {
  const steps = [
    gen([{ id: '1', name: 'Forecast weekly demand by store' }, { id: '2', name: 'Spot late supplier deliveries' }]),
    gen([{ id: '1', name: 'Rank stores by shrink risk' }, { id: '2', name: 'Spot late  supplier deliveries' }]),
    { status: 'ended_success', result_json: { prompt_name: 'COMBINED_VALUE_QUALITY_SCORE_PROMPT',
      scored_use_cases: [{ id: '1', name: 'Rank stores by shrink risk', quality: 'High', priority: 'Very High' }] } },
  ];
  const got = L.liveUseCasesOf(steps);
  assert.deepEqual(got.map((uc) => uc.Name), ['Forecast weekly demand by store', 'Spot late supplier deliveries', 'Rank stores by shrink risk']);
  assert.equal(got[2].Quality, 'High');
  assert.equal(L.liveCountText(got.length), '3 use cases so far');
  assert.equal(L.liveCountText(1), '1 use case so far');
});

test('placeholder rows the model echoed from its template never count or show as use cases (must-exclude)', () => {
  const steps = [gen([
    { id: '1', name: 'Name', type: 'type' }, { id: '2', name: 'Use Case 1' }, { id: '3', name: 'use_case' }, { id: '4', name: '<name>' },
    { id: '5', name: 'TBD' }, { id: '6', name: '' }, { id: '7', name: 'Cut stock-outs on fast movers' },
  ])];
  assert.deepEqual(L.liveUseCasesOf(steps).map((uc) => uc.Name), ['Cut stock-outs on fast movers']);
  for (const name of ['Name', 'Use Case 12', 'usecase', 'N/A', '...', '{name}', 'Title']) assert.equal(L.isPlaceholderName(name), true, name);
  for (const name of ['Use case mining for returns', 'Name the top churn drivers', 'Forecast demand']) assert.equal(L.isPlaceholderName(name), false, name);
});

test('the live preview lists the use cases of a step still running as they arrive, as in rc.3', () => {
  const steps = [gen([{ id: '1', name: 'Price baskets by margin' }], 'running'), gen([{ id: '2', name: 'Plan staff by footfall' }], 'started'),
    gen([{ id: '3', name: 'Find duplicate customer records' }], 'ended_warning')];
  assert.deepEqual(L.liveUseCasesOf(steps).map((uc) => uc.Name), ['Price baskets by margin', 'Plan staff by footfall', 'Find duplicate customer records']);
  assert.equal(L.liveUseCasesOf([gen([{ id: '1', name: 'Price baskets by margin' }], 'running')]).length, 1, 'a running step alone already shows its use case');
});

test('Monitor and the Review live preview count use cases through the same function', () => {
  const server = fs.readFileSync(path.join(__dirname, '..', 'server.js'), 'utf8');
  const monitor = fs.readFileSync(path.join(__dirname, '..', '..', 'frontend', 'src', 'pages', 'MonitorPage.jsx'), 'utf8');
  assert.match(server, /const allUcs = liveUseCasesOf\(steps\);/);
  assert.match(monitor, /liveUseCasesOf\(steps\)/);
  assert.equal(/ucMap|deduped/.test(server + monitor), false, 'no second copy of the live use case extraction');
});
