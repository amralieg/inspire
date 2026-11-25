// REQ-529: every text a person reads says "Databricks AI", never "Genie Code". Code identifiers (genie_code, GenieCode, genie-code) stay.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');

const APP = path.resolve(__dirname, '..', '..');
const ROOTS = ['frontend/src', 'backend', 'installer', 'scripts', 'docs', 'CLAUDE.md'];
const SKIP_DIR = new Set(['node_modules', 'dist', 'test', 'tests', '__pycache__', 'docgen', 'agent']);
const SKIP_FILE = /^(GenerateDocs.*|ledger\.md)$/;
const EXT = /\.(js|jsx|mjs|py|md|json|sh)$/;
// Visible wording: "Genie Code" with space or hyphen in any case, but the lowercase kebab id genie-code stays.
const VISIBLE = /genie code|genie-code|Genie-Code|Genie-code/i;
const KEEP = [
  // [file suffix, substring that marks a data key or id, not a sentence]
  ['frontend/src/lib/mvpProgress.js', "'Genie Code'"],
  ['frontend/src/lib/useCaseFields.js', "'Has Genie Code'"],
  ['backend/lib/genieNotebookJob.js', 'LEGACY_JOB_NAME'],
];

function walk(p, out) {
  const st = fs.statSync(p);
  if (st.isFile()) { if (EXT.test(p) && !SKIP_FILE.test(path.basename(p))) out.push(p); return out; }
  for (const n of fs.readdirSync(p)) {
    if (SKIP_DIR.has(n)) continue;
    walk(path.join(p, n), out);
  }
  return out;
}

test('REQ-529 no visible "Genie Code" text remains in the App source, installer, scripts and docs', () => {
  const hits = [];
  for (const r of ROOTS) {
    const root = path.join(APP, r);
    if (!fs.existsSync(root)) continue;
    for (const f of walk(root, [])) {
      const rel = path.relative(APP, f);
      fs.readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (!VISIBLE.test(line)) return;
        // lowercase kebab ids such as genie-code alone are identifiers
        const stripped = line.replace(/\bgenie-code\b/g, '');
        if (!VISIBLE.test(stripped)) return;
        if (KEEP.some(([file, mark]) => rel.endsWith(file) && line.includes(mark))) return;
        hits.push(`${rel}:${i + 1}: ${line.trim().slice(0, 100)}`);
      });
    }
  }
  assert.deepEqual(hits, []);
});

test('REQ-529 identifiers and old job names still resolve', () => {
  const j = require('../lib/genieNotebookJob');
  assert.match(j.genieNotebookJobName('42'), /^Inspire AI - Databricks AI - 42$/);
  assert.equal(j.legacyGenieNotebookJobName('42'), 'Inspire AI - Genie Code - 42');
  const fields = fs.readFileSync(path.join(APP, 'frontend/src/lib/useCaseFields.js'), 'utf8');
  assert.match(fields, /has_genie_code/);
  assert.ok(fs.existsSync(path.join(APP, 'backend/lib/genieCodeCheck.js')));
});

test('REQ-529 an install that has only the old-named job is still found', async () => {
  const j = require('../lib/genieNotebookJob');
  const fetchJson = async (p) => {
    if (p.startsWith('/api/2.1/jobs/list')) {
      const name = decodeURIComponent(p.match(/name=([^&]*)/)[1]);
      return { ok: true, data: { jobs: name === 'Inspire AI - Genie Code - 7' ? [{ job_id: 5, created_time: 1, settings: { name } }] : [] } };
    }
    return { ok: true, data: { runs: [{ run_id: 9, state: { life_cycle_state: 'TERMINATED', result_state: 'SUCCESS' } }] } };
  };
  const run = await j.latestGenieNotebookRun(fetchJson, '7');
  assert.equal(run.run_id, 9);
  assert.equal(run.job_id, 5);
});
