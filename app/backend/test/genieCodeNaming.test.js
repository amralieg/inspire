const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const APP = path.join(__dirname, '..', '..');
const ROOTS = ['frontend/src', 'agent/agent/app_shell/web/src', 'backend/lib'].map((dir) => path.join(APP, dir));
const OFF_NAMES = /Genie instructions?\b|Genie code\b|Has Genie:|Genie text\b|Genie: \{/;

const sources = (dir) => fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
  const full = path.join(dir, entry.name);
  if (entry.isDirectory()) return sources(full);
  return /\.(jsx?|mjs)$/.test(entry.name) ? [full] : [];
});

test('every screen names the instruction Inspire writes the same way, a Genie Code instruction, never Genie code, Genie instruction or Has Genie', () => {
  const hits = ROOTS.flatMap(sources).flatMap((file) => fs.readFileSync(file, 'utf8').split('\n')
    .map((line, index) => (OFF_NAMES.test(line) && !/^\s*(\*|\/\/|\/\*)/.test(line) ? `${path.relative(APP, file)}:${index + 1}: ${line.trim()}` : ''))
    .filter(Boolean));
  assert.deepEqual(hits, []);
});

test('the name check catches the old names (must-exclude)', () => {
  for (const old of ['Has Genie: Yes', 'Genie instruction: Any', 'Has Genie code', 'partial Genie text', 'Genie: {x}']) assert.match(old, OFF_NAMES, old);
  for (const good of ['Genie Code instruction: Any', 'Draft Genie Code instruction', "uc['Has Genie Code']", 'has_genie_code']) assert.doesNotMatch(good, OFF_NAMES, good);
});

test('the use case list labels say Genie Code instruction', async () => {
  const { GENIE_LABELS } = await import(pathToFileURL(path.join(APP, 'frontend/src/lib/useCaseFacets.js')).href);
  assert.deepEqual({ ...GENIE_LABELS }, { shipped: 'Genie Code instruction written', draft: 'Draft Genie Code instruction', none: 'No Genie Code instruction' });
});
