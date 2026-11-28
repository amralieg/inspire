// c36 (REQ-578, REQ-579): Generate Use Cases is retired. The notebook refuses it; the App never offers, sends or describes it.
// Must-fail: the Implement page's notebook step said "Inspire runs Generate Use Cases", and the implement test server's session rebuild
// answered 15_operation Generate Use Cases while the real rebuild answers Implement Use Cases.
// Must-keep: the refusal paths still name it (so an old caller gets a 400 that says why), and the App's launch list is the notebook's.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.join(__dirname, '..', '..');
const read = (rel) => fs.readFileSync(path.join(APP, rel), 'utf8');
const RETIRED = 'Generate Use Cases';

function filesUnder(rel, exts) {
  const out = [];
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) { if (e.name !== 'node_modules' && e.name !== 'dist') walk(p); } else if (exts.some((x) => e.name.endsWith(x))) out.push(p);
    }
  };
  walk(path.join(APP, rel));
  return out;
}

test('REQ-578: no App screen offers or describes Generate Use Cases (must-fail before c36)', () => {
  const hits = filesUnder('frontend/src', ['.js', '.jsx', '.ts', '.tsx']).filter((f) => fs.readFileSync(f, 'utf8').includes(RETIRED));
  assert.deepEqual(hits.map((f) => path.relative(APP, f)), []);
});

test('REQ-578: the implement test server rebuilds a session as the real rebuild does, Implement Use Cases (must-fail before c36)', () => {
  const real = require('../lib/inspireSessionParams').notebookParamsFromSessionForGenerateRun({ business_name: 'Example Co' }, '42');
  assert.equal(real['15_operation'], 'Implement Use Cases');
  assert.ok(!read('backend/test/support/implementApp.js').includes(`'15_operation': '${RETIRED}'`), 'the test stub answers what the real rebuild answers');
  assert.ok(!read('backend/lib/inspireSessionParams.js').includes(`Operation = ${RETIRED}`), 'the rebuild names the operation it builds');
});

test('REQ-578 must-keep: the App launches only operations the notebook accepts, and the refusal still names the retired one', () => {
  const nb = read('dbx_inspire_ai_agent.ipynb');
  const constant = (name) => { const m = nb.match(new RegExp(`${name} = \\\\"([^\\\\"]+)\\\\"`)); return m && m[1]; };
  const ops = ['Discover Use Cases', constant('MATCH_OPERATION'), constant('IMPLEMENT_OPERATION')];
  assert.ok(ops.every(Boolean), `the notebook defines its operations: ${ops}`);
  assert.match(nb, /INSPIRE_OPERATIONS = \(\\"Discover Use Cases\\", MATCH_OPERATION, IMPLEMENT_OPERATION\)/);
  const { LAUNCH_OPERATIONS } = require('../lib/launchChoice');
  for (const op of LAUNCH_OPERATIONS) assert.ok(ops.includes(op), `${op} is a notebook operation`);
  assert.ok(!LAUNCH_OPERATIONS.includes(RETIRED));
  assert.match(read('backend/openapi.yaml'), /enum: \[Discover Use Cases, Match Use Cases\]/);
  assert.match(read('backend/lib/inspireJobParams.js'), /Generate Use Cases is no longer a launch operation/);
});
