// One label for the delivery output, "App" (REQ-209, D-LABEL209). Internal ids stay `app`; progress step names stay `App`
// (events name the step, not the label). Every person-facing surface reads the shared label file, so no source writes a plain
// 'App' label for this output.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const LABELS = require('../lib/implementOutputLabels.json');
const I = require('../lib/inspireImplement');

const ROOT = path.resolve(__dirname, '..', '..');
const SCANNED = ['backend/lib', 'frontend/src/lib', 'frontend/src/components', 'frontend/src/pages'];
const WHITELIST = [/OUTPUT_STEP/, /EARLIER_OUTPUT_LABELS/, /the App's step is 'App'/, /step name/];

function sourcesOf(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return e.name === 'test' || e.name === 'node_modules' || e.name === 'dist' ? [] : sourcesOf(full);
    return /\.(js|jsx|mjs)$/.test(e.name) ? [full] : [];
  });
}

test('the delivery output is labelled App in the one shared file, and the backend table reads it', () => {
  assert.equal(LABELS.app, 'App');
  assert.equal(I.IMPLEMENT_OUTPUT_LABELS.app, 'App');
  assert.deepEqual(Object.keys(LABELS).sort(), ['alert', 'app', 'dashboard', 'genie_space', 'notebook']);
});

test('no person-facing source writes a plain App label for the delivery output', () => {
  const offenders = [];
  for (const dir of SCANNED) {
    for (const file of sourcesOf(path.join(ROOT, dir))) {
      fs.readFileSync(file, 'utf8').split('\n').forEach((line, i) => {
        if (!/'App'|"App"/.test(line) || WHITELIST.some((re) => re.test(line))) return;
        offenders.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim()}`);
      });
    }
  }
  assert.deepEqual(offenders, [], 'a plain App label: use OUTPUT_LABELS.app (backend/lib/implementOutputLabels.json)');
});
