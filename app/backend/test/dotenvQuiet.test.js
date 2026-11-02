const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');

const { sourceFiles } = require('./support/sourceFiles');

const backend = path.join(__dirname, '..');

function callArgs(text, open) {
  let depth = 0;
  for (let i = open; i < text.length; i += 1) {
    if (text[i] === '(') depth += 1;
    if (text[i] === ')') depth -= 1;
    if (depth === 0) return text.slice(open + 1, i);
  }
  return text.slice(open + 1);
}

function dotenvLoads(text) {
  const loads = [];
  const call = /(?:\bdotenv|require\(\s*['"]dotenv['"]\s*\))\s*\.\s*config\s*\(/g;
  for (let m = call.exec(text); m; m = call.exec(text)) loads.push(callArgs(text, m.index + m[0].length - 1));
  return loads;
}

test('every dotenv load in the App backend passes quiet: true, so the App start prints no dotenv tip lines', () => {
  const files = sourceFiles(backend, { ext: ['.js', '.cjs', '.mjs'] }).filter((file) => file !== __filename);
  const loads = files.flatMap((file) => dotenvLoads(fs.readFileSync(file, 'utf8')).map((args) => ({ file: path.relative(backend, file), args })));
  assert.ok(loads.some((l) => l.file === 'server.js'), 'server.js loads dotenv');
  for (const { file, args } of loads) assert.match(args, /\bquiet\s*:\s*true\b/, `${file}: dotenv.config(${args})`);
  for (const file of files) {
    assert.doesNotMatch(fs.readFileSync(file, 'utf8'), /['"]dotenv\/config['"]/, `${path.relative(backend, file)} loads dotenv/config, which cannot be made quiet`);
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(backend, 'package.json'), 'utf8'));
  for (const [name, script] of Object.entries(pkg.scripts || {})) assert.doesNotMatch(script, /dotenv\/config/, `script ${name}`);
});

test('the dotenv parser finds a load whose arguments hold nested calls and flags one that is not quiet', () => {
  const loads = dotenvLoads("dotenv.config({ path: path.resolve(a, '.env'), quiet: true });\nrequire('dotenv').config({ path: x });");
  assert.deepEqual(loads, ["{ path: path.resolve(a, '.env'), quiet: true }", '{ path: x }']);
  assert.doesNotMatch(loads[1], /\bquiet\s*:\s*true\b/);
});
