// REQ-481 (FX-76): the estimated-value disclaimer has one source file per bundle, the app shell copy equals the backend one,
// and the full sentence appears in no source file but those JSON files.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const SOURCE = path.join(__dirname, '../lib/valueDisclaimer.json');
const SHELL = path.join(__dirname, '../../agent/agent/app_shell/web/src/valueDisclaimer.json');
const read = (p) => JSON.parse(fs.readFileSync(p, 'utf8'));

function walk(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === 'node_modules' || entry.name === 'dist') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, found); else if (/\.(jsx?|mjs|json|css)$/.test(entry.name)) found.push(full);
  }
  return found;
}

test('the full text says estimated, not promised, not guaranteed by Databricks, validated by business value teams', () => {
  const { full, short } = read(SOURCE);
  assert.match(full, /^Estimated or calculated value, not a promised value\./);
  assert.match(full, /Databricks does not promise or guarantee this number\./);
  assert.match(full, /Specialist business value teams in your organization must validate every number before it is shared or used in a decision\.$/);
  assert.equal(short, 'Estimated, not promised. Validate with your business value team.');
});

test('the app shell copy equals the backend copy', () => {
  assert.ok(fs.existsSync(SHELL), 'the app shell has its own copy of the JSON');
  assert.deepEqual(read(SHELL), read(SOURCE));
});

test('the full sentence is in exactly one JSON file per source tree and in no JSX or JS file', () => {
  const { full } = read(SOURCE);
  const trees = { frontend: path.join(__dirname, '../../frontend/src'), shell: path.join(__dirname, '../../agent/agent/app_shell/web/src') };
  for (const [name, dir] of Object.entries(trees)) {
    const hits = walk(dir).filter((f) => fs.readFileSync(f, 'utf8').includes(full));
    // the frontend reads the backend file, so its tree holds zero copies; the shell tree holds exactly one
    assert.equal(hits.length, name === 'shell' ? 1 : 0, `${name}: ${hits.join(', ')}`);
    for (const f of hits) assert.match(f, /valueDisclaimer\.json$/);
  }
});
