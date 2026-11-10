const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const lib = (name) => import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', name)).href);

test('each build version lists its own unmet asks as history: Not done in vN, the ask, and the reason; a version with none lists nothing', async () => {
  const C = await lib('implementControl.js');
  const v3 = { spec_version: 3, asset_status: { checklist: [
    { n: 1, requirement: 'Answer in euros', status: 'not_met', fact: 'Genie could not answer in euros' },
    { n: 2, requirement: 'Add a map by region', status: 'not_met', evidence: 'Inspire could not check this ask: the judge did not answer' },
    { n: 3, requirement: 'Count returns by week', status: 'met', evidence: 'It counts returns' },
  ] } };
  assert.deepEqual(C.notDoneLines(v3), [
    'Not done in v3: Answer in euros, Genie could not answer in euros',
    'Not done in v3: Add a map by region, Inspire could not check this ask: the judge did not answer',
  ]);
  assert.deepEqual(C.notDoneLines({ spec_version: 4, asset_status: { checklist: [{ n: 1, requirement: 'Answer in euros', status: 'met' }] } }), []);
  assert.deepEqual(C.notDoneLines({ spec_version: 5 }), []);
});
