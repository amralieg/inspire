// REQ-482: a wait state shown as static text reads as a hang to a business user. Every wait-state text in app/frontend/src
// renders with BusyNote or a spinning icon next to it.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const src = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'src');

const WAIT_WORD = '(?:Loading|Reading|Calculating|Checking|Saving|Connecting|Opening|Starting|Finding|Searching|Fetching|Listing|Working out|Requesting|Waiting for|Rebuilding|Hydrating|Building the)';
// A wait state: the word opens a JSX text, a string literal or a template, and is more than a one-word label.
const WAIT = new RegExp(`(?:>|['"\`]|\\{)\\s*${WAIT_WORD}\\b(?:[^<>{}'"\`]*?(?:\\.\\.\\.|…)|\\s+[^<>{}'"\`\\s]+)`);
const MOTION = /BusyNote|PageSpinner|SaveButton|animate-spin|Loader2/;
const MARK = /busy-ok:/;
const REACH = 4;

// Files other lanes are editing; their sites are listed in the FX-77 report and applied after those lanes land.
const PENDING = new Set([
  'components/CalculateValueDialog.jsx', // pending FX-64b landing
  'pages/ResultsPage.jsx', // pending FX-63c landing
  'components/BuildNext.jsx', // pending FX-63c landing
]);

export function waitStatesWithoutMotion(name, text) {
  const lines = text.split('\n');
  const found = [];
  lines.forEach((line, i) => {
    const code = line.replace(/\/\/.*$/, '').replace(/\{\/\*.*?\*\/\}/g, '');
    if (/^\s*(\*|\/\*)|aria-label=/.test(line) || !WAIT.test(code)) return;
    const near = lines.slice(Math.max(0, i - REACH), i + REACH + 1).join('\n');
    if (MOTION.test(near) || MARK.test(near)) return;
    found.push(`${name}:${i + 1}: ${line.trim().slice(0, 120)}`);
  });
  return found;
}

function sources(dir, base = '') {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => {
    const rel = base ? `${base}/${e.name}` : e.name;
    if (e.isDirectory()) return sources(path.join(dir, e.name), rel);
    return e.name.endsWith('.jsx') ? [rel] : [];
  });
}

test('must-fail: a planted static "Loading..." is caught', () => {
  const planted = `export default function X() {\n  return <p className="note">Loading...</p>;\n}\n`;
  assert.equal(waitStatesWithoutMotion('fixture.jsx', planted).length, 1);
  assert.equal(waitStatesWithoutMotion('fixture.jsx', `const a = cond ? 'Reading the table' : null;\n`).length, 1, 'a string literal too');
});

test('must-keep: a BusyNote, a spinning icon or an audit mark passes; a one-word label is not a wait state', () => {
  assert.deepEqual(waitStatesWithoutMotion('fixture.jsx', `<BusyNote text="Loading..." />\n`), []);
  assert.deepEqual(waitStatesWithoutMotion('fixture.jsx', `<Loader2 className="animate-spin" />\n<span>Loading the groups</span>\n`), []);
  assert.deepEqual(waitStatesWithoutMotion('fixture.jsx', `// busy-ok: the step beside it spins\nconst s = 'Reading what you asked';\n`), []);
  assert.deepEqual(waitStatesWithoutMotion('fixture.jsx', `const LABELS = { building: 'Building', waiting: 'Waiting' };\n`), []);
});

test('every wait-state text in app/frontend/src renders with motion', () => {
  const missing = sources(src).filter((f) => !PENDING.has(f)).flatMap((f) => waitStatesWithoutMotion(f, fs.readFileSync(path.join(src, f), 'utf8')));
  assert.deepEqual(missing, [], `wait states with no spinner:\n${missing.join('\n')}`);
});
