const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

test('qualityGateDropsOf reads the dropped use cases of results_json in plain words, skips broken items, and an older run with none gives an empty list (must-exclude)', async () => {
  const { qualityGateDropsOf } = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'qualityGateDrops.js')).href);
  const { buildUseCaseList } = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'useCaseList.js')).href);
  assert.deepEqual(qualityGateDropsOf({}), []);
  assert.deepEqual(qualityGateDropsOf(null), []);
  assert.deepEqual(qualityGateDropsOf({ quality_gate_drops: 'x' }), []);
  const results = {
    domains: [{ domain_name: 'Sales', use_cases: [{ No: 'N01-U01', Name: 'Reduce churn' }] }],
    quality_gate_drops: [
      { no: 'N09-U01', name: 'Guess tomorrow', domain: 'Sales', subdomain: 'Demand', gate: 'D5', gate_name: 'logical possibility check', gate_score: 2.25 },
      { no: 'N09-U02', name: 'No score', gate: 'D9', gate_name: '', gate_score: null },
      { name: '', gate: 'D1' }, null, 'bad',
    ],
  };
  const drops = qualityGateDropsOf(results);
  assert.deepEqual(drops.map((d) => [d.no, d.where, d.gate, d.reason]), [
    ['N09-U01', 'Sales · Demand', 'D5', 'It scored 2.3 out of 10 on the logical possibility check, below the 3 every use case needs.'],
    ['N09-U02', '', 'D9', 'It failed the quality check.'],
  ]);
  const listed = buildUseCaseList(results, null).map((uc) => uc.No);
  assert.ok(!listed.includes('N09-U01') && !listed.includes('N09-U02'), 'the use case list never takes a dropped use case');
});
