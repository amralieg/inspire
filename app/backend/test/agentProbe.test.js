const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { agentProbe, pythonReady } = require('./support/agentProbe');

const NOTEBOOK = path.resolve(__dirname, '..', '..', 'dbx_inspire_ai_agent.ipynb');

const CELL = [
  'import re',
  'COMPILED_SOURCE = "def compiled_word(n):\\n    return shared_word(n) + \' compiled\'\\n"',
  'PLAIN_SOURCE = "import json as _plain_json\\ndef plain_word(n):\\n    return _plain_json.dumps(n)\\n"',
  'PRIVATE_SOURCE = "def private_word(n):\\n    return \'private\'\\n"',
  '_PRIVATE_NS = {}',
  'def shared_word(n):',
  '    return re.sub("x", "", str(n))',
  'exec(compile(COMPILED_SOURCE, "<compiled>", "exec"), globals())',
  'exec(PLAIN_SOURCE, globals())',
  'exec(compile(PRIVATE_SOURCE, "<private>", "exec"), _PRIVATE_NS)',
  'def uses_all(n):',
  '    return [compiled_word(n), plain_word(n)]',
].join('\n');

const BODY = String.raw`
print(json.dumps({"executed": sorted(executed), "calls": ns["uses_all"](7) if "uses_all" in ns else None,
                  "private": "private_word" in top}))
`;

function tinyNotebook(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'inspire-agent-probe-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'agent.ipynb');
  fs.writeFileSync(file, JSON.stringify({ cells: [{ cell_type: 'code', source: CELL.split(/(?<=\n)/) }] }));
  return file;
}

test('the probe reads what the agent defines from a source it runs into its globals, with or without compile', (t) => {
  if (!pythonReady()) {
    t.skip('python3 is not installed');
    return;
  }
  const out = agentProbe(tinyNotebook(t), { names: ['uses_all'] }, BODY);
  assert.deepEqual(out.executed, ['COMPILED_SOURCE', 'PLAIN_SOURCE']);
  assert.deepEqual(out.calls, ['7 compiled', '7']);
});

test('a source the agent runs into its own namespace stays out of the probe', (t) => {
  if (!pythonReady()) {
    t.skip('python3 is not installed');
    return;
  }
  const out = agentProbe(tinyNotebook(t), { names: ['private_word'] }, BODY);
  assert.deepEqual(out, { missing: ['private_word'] });
});

test('in the bundled agent the probe reads the redaction and the result history, and not the private Genie number text', (t) => {
  if (!pythonReady()) {
    t.skip('python3 is not installed');
    return;
  }
  const out = agentProbe(NOTEBOOK, { names: ['inspire_plural'] }, String.raw`
print(json.dumps({"executed": sorted(executed), "plural": [ns["inspire_plural"](1234, "character"), ns["inspire_plural"](1, "character")]}))
`);
  assert.deepEqual(out.executed, ['IMPLEMENT_RESULT_HISTORY_SOURCE', 'REDACT_SOURCE']);
  assert.deepEqual(out.plural, ['1234 characters', '1 character']);
});
