// FX-42: every export of lib/inspireValue.js has a caller in app/backend outside test/ (no orphan helpers).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const IV = require('../lib/inspireValue');

const root = path.join(__dirname, '..');
const sources = [];
(function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['test', 'node_modules', 'dist'].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full);
    else if (entry.name.endsWith('.js') && full !== path.join(root, 'lib', 'inspireValue.js')) sources.push(fs.readFileSync(full, 'utf8'));
  }
})(root);

test('every inspireValue export is referenced by a non-test backend file', () => {
  const orphans = Object.keys(IV).filter((name) => !sources.some((src) => new RegExp(`\\b${name}\\b`).test(src)));
  assert.deepEqual(orphans, []);
});
