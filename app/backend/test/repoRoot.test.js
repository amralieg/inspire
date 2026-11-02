const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const REPO = path.resolve(__dirname, '..', '..', '..');
const ROOT_FILES = ['LICENSE', 'README.md', 'inspire_installer.py'];
const ROOT_DOT_FILES = new Set(['.git', '.gitignore', '.gitattributes', '.github']);

test('the repo root holds only the installer, the README and the LICENSE, with everything else in app/', () => {
  const entries = fs.readdirSync(REPO).filter((name) => !ROOT_DOT_FILES.has(name)).sort();
  assert.deepEqual(entries, [...ROOT_FILES, 'app'].sort());
  assert.ok(fs.statSync(path.join(REPO, 'app')).isDirectory());
});

test('the LICENSE is the Apache 2.0 license', () => {
  const license = fs.readFileSync(path.join(REPO, 'LICENSE'), 'utf8');
  assert.match(license, /^\s+Apache License\n\s+Version 2\.0, January 2004\n\s+http:\/\/www\.apache\.org\/licenses\/\n/);
  assert.match(license, /END OF TERMS AND CONDITIONS/);
});

test('the README gives one short paragraph and the three steps: download the installer from the latest release, import it, run it', () => {
  const readme = fs.readFileSync(path.join(REPO, 'README.md'), 'utf8');
  const steps = readme.split('\n').filter((line) => /^\d\. /.test(line));
  assert.equal(steps.length, 3, readme);
  assert.match(steps[0], /https:\/\/github\.com\/amralieg\/inspire\/releases\/latest\/download\/inspire_installer\.py/);
  assert.match(steps[1], /[Ii]mport/);
  assert.match(steps[2], /[Rr]un/);
  assert.doesNotMatch(readme, /releases\/download\/v|releases\/tag\/v|api\.github\.com/);
  assert.doesNotMatch(readme, /[\u2013\u2014]/);
  assert.ok(readme.split('\n').filter((line) => line.trim()).length <= 12, 'short');
});
