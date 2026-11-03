const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { INSPIRE_AGENT_VERSION } = require('../lib/inspireJobParams');

const repoRoot = path.resolve(__dirname, '..', '..', '..');
const agentNotebook = path.join(repoRoot, 'app', 'agent', 'agent', 'dbx_inspire_ai_agent.ipynb');
const SKIPPED_DIRS = new Set(['.git', 'node_modules', 'dist', 'test', 'tests', 'demos', 'build', 'coverage', '.venv', '__pycache__']);
const TEXT_FILES = /\.(md|py|js|mjs|cjs|jsx|ts|tsx|yaml|yml|json|ipynb|html|sh|txt)$/;
const SKIPPED_FILES = new Set(['package-lock.json']);

const LABELS = [
  ['the agent version constant', /__AGENT_VERSION__\s*=\s*\\?["']v(\d\.\d\.\d)\\?["']/g],
  ['the backend version constant', /INSPIRE_AGENT_VERSION\s*=\s*['"]v(\d\.\d\.\d)['"]/g],
  ['the bundle version tag', /inspire_version:\s*"v(\d\.\d\.\d)"/g],
  ['the OpenAPI version', /^ {2}version: (\d\.\d\.\d)\s*$/gm],
  ['a Version header', /^\*\*Version:\*\* v(\d\.\d\.\d)/gm],
  ['a Release header', /^\*\*Release v(\d\.\d\.\d)\*\*/gm],
  ['a Version badge', /badge\/Version-(\d\.\d\.\d)-/g],
  ['the exec notes heading', /^## v(\d\.\d\.\d) — exec notes/gm],
  ['the exec notes agent line', /`__AGENT_VERSION__ = v(\d\.\d\.\d)`/g],
  ['a written App description or title', /Inspire AI v(\d\.\d\.\d)/g],
];

const REQUIRED = [
  ['app/agent/agent/dbx_inspire_ai_agent.ipynb', 'the agent version constant'],
  ['app/dbx_inspire_ai_agent.ipynb', 'the agent version constant'],
  ['app/backend/lib/inspireJobParams.js', 'the backend version constant'],
  ['app/databricks.yml', 'the bundle version tag'],
  ['app/backend/openapi.yaml', 'the OpenAPI version'],
  ['app/README.md', 'the exec notes heading'],
  ['app/README.md', 'the exec notes agent line'],
  ['app/agent/readme.md', 'a Release header'],
  ['app/agent/readme.md', 'a Version badge'],
  ['app/agent/docs/integration-guide.md', 'a Version header'],
  ['app/agent/docs/design-guide.md', 'a Version header'],
];

function shippedFiles(dir = repoRoot, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('.')) shippedFiles(full, out);
    } else if (TEXT_FILES.test(entry.name) && !SKIPPED_FILES.has(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

function labelsIn(text) {
  const found = [];
  for (const [label, pattern] of LABELS) {
    for (const match of text.matchAll(pattern)) {
      found.push({ label, version: `v${match[1]}`, line: text.slice(0, match.index).split('\n').length });
    }
  }
  return found;
}

function currentVersion() {
  const notebook = JSON.parse(fs.readFileSync(agentNotebook, 'utf8'));
  const source = notebook.cells.map((cell) => (Array.isArray(cell.source) ? cell.source.join('') : String(cell.source || ''))).join('\n');
  const found = [...source.matchAll(/^__AGENT_VERSION__ = "(v\d\.\d\.\d)"$/gm)].map((m) => m[1]);
  assert.equal(found.length, 1, 'the agent notebook defines __AGENT_VERSION__ once');
  return found[0];
}

test('the agent notebook __AGENT_VERSION__ is the one version, and the backend constant is it', () => {
  assert.equal(INSPIRE_AGENT_VERSION, currentVersion());
});

test('every shipped string that labels the Inspire version names the current one', () => {
  const current = currentVersion();
  const seen = new Set();
  const stale = [];
  for (const file of shippedFiles()) {
    const rel = path.relative(repoRoot, file).split(path.sep).join('/');
    for (const hit of labelsIn(fs.readFileSync(file, 'utf8'))) {
      seen.add(`${rel}\u0000${hit.label}`);
      if (hit.version !== current) stale.push(`${rel}:${hit.line} ${hit.label} names ${hit.version}, not ${current}`);
    }
  }
  assert.deepEqual(stale, []);
  const missing = REQUIRED.filter(([rel, label]) => !seen.has(`${rel}\u0000${label}`)).map(([rel, label]) => `${rel}: ${label}`);
  assert.deepEqual(missing, [], 'every place that must carry the version still carries it');
});

test('the version label scan refuses an older version and ignores history and tests (must-exclude)', () => {
  assert.deepEqual(labelsIn('**Version:** v1.2.1 (Production Release)').map((h) => h.version), ['v1.2.1']);
  assert.deepEqual(labelsIn('body = {"description": "Inspire AI v1.3.0"}').map((h) => [h.label, h.version]),
    [['a written App description or title', 'v1.3.0']]);
  assert.deepEqual(labelsIn('### v0.7.3 Validation Runs\nInspire AI {version} is ready\nSince v1.3.0 the column is nullable'), []);
  const rels = shippedFiles().map((f) => path.relative(repoRoot, f).split(path.sep).join('/'));
  assert.ok(rels.includes('app/installer/inspire_setup.py') && rels.includes('app/backend/openapi.yaml'));
  assert.ok(!rels.some((r) => /(^|\/)(tests?|demos|node_modules|dist)\//.test(r)), 'tests pinning old releases and generated demo outputs are not shipped labels');
});
