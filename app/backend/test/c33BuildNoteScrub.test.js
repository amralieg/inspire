// C33 (REQ-560): the Build notes of a recorded demo ("person can manage /Workspace/Shared/<app name>/...", the failure text of a round, the notebook
// paths) named the scratch App the demo was recorded from. The recorder now replaces that App name, and the committed demos carry none.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const zlib = require('node:zlib');
const { installReplace, installTagReplace, makeSanitizer, showcaseLeaks } = require('../lib/showcaseRecord');

const DIR = path.join(__dirname, '../showcase');
const SCRATCH = /inspire-rc[\w-]*/i;

test('C33 (must-fail before): no committed demo names a scratch App in its Build notes, failure text or notebook paths', () => {
  for (const file of fs.readdirSync(DIR).filter((f) => f.endsWith('.json.gz'))) {
    const text = zlib.gunzipSync(fs.readFileSync(path.join(DIR, file))).toString('utf8');
    const hits = [...new Set(text.match(new RegExp(SCRATCH.source, 'gi')) || [])];
    assert.deepEqual(hits, [], `${file} names the scratch App ${hits.join(', ')}`);
  }
});

test('C33: the recorder replaces the App the demo was recorded from, in the build feed and in a leak scan', () => {
  const replace = installReplace('https://inspire-rc2g-aws-1234567890.11.azure.databricksapps.com');
  assert.deepEqual(replace, { 'inspire-rc2g-aws': 'inspire' });
  const clean = makeSanitizer({ replace });
  const feed = { feed: [{ text: 'person@example.com can manage /Workspace/Shared/inspire-rc2g-aws/nyc/session_1/AI01-UC01' }] };
  const out = clean.value(feed);
  assert.equal(out.feed[0].text, 'person@example.com can manage /Workspace/Shared/inspire/nyc/session_1/AI01-UC01');
  assert.deepEqual(showcaseLeaks({ inspire: { 'GET /x': { status: 200, body: out } } }, Object.keys(replace)), []);
  assert.deepEqual(installReplace('https://inspire-1234567890.11.azure.databricksapps.com'), {});
});

test('C33: a run named after the scratch install ("W11 rc2g AWS Walk") is scrubbed by the recorder replace map, in any case and with spaces for dashes', () => {
  const url = 'https://inspire-rc2g-aws-1234567890.11.azure.databricksapps.com';
  const replace = { ...installReplace(url), ...installTagReplace(url) };
  assert.deepEqual(replace, { 'inspire-rc2g-aws': 'inspire', 'rc2g-aws': 'demo' });
  const out = makeSanitizer({ replace }).value({ runs: [{ name: 'W11 rc2g AWS Walk' }, { name: 'W11 RC2G-AWS Walk' }], path: '/Workspace/Shared/inspire-rc2g-aws/x' });
  assert.deepEqual(out.runs.map((r) => r.name), ['W11 demo Walk', 'W11 demo Walk']);
  assert.equal(out.path, '/Workspace/Shared/inspire/x');
  assert.deepEqual(installTagReplace('https://inspire-1234567890.11.azure.databricksapps.com'), {});
});
