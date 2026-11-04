const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const { agentProbe, pythonReady } = require('./support/agentProbe');

const NOTEBOOK = path.resolve(__dirname, '..', '..', 'dbx_inspire_ai_agent.ipynb');
const FIXTURE_PATH = path.resolve(__dirname, '..', '..', 'frontend', 'test', 'ui', 'runSummary.json');
const FIXTURE = require(FIXTURE_PATH);

const PROBE = String.raw`
import threading
agent = next(n for n in tree if isinstance(n, ast.ClassDef) and n.name == "DatabricksInspire")
wanted = {"_record_executive_summary", "_merge_run_outcome_into_results"}
methods = [n for n in agent.body if isinstance(n, ast.FunctionDef) and n.name in wanted]
if {m.name for m in methods} != wanted:
    sys.exit("the bundled agent lacks " + ", ".join(sorted(wanted - {m.name for m in methods})))
class Health:
    def snapshot(self):
        return {}
ns["LLM_ENDPOINT_HEALTH"] = Health()
seen.add("LLM_ENDPOINT_HEALTH")
before = len(chosen)
for method in methods:
    for name in sorted(free(method)):
        need(name)
exec(compile(ast.Module(body=sorted(chosen[before:], key=lambda n: n.lineno) + methods, type_ignores=[]), "agent", "exec"), ns)
class Log:
    def __init__(self):
        self.lines = []
    def info(self, message, *a, **k):
        self.lines.append(str(message))
    warning = error = debug = info
class Writer:
    def __init__(self):
        self.recorded = []
    def record_results(self, results):
        self.recorded.append(results)
        return True
class Run:
    _RUN_OUTCOME_LOCK = threading.Lock()
    def __init__(self):
        self.final_inspire_results_json = {}
        self.atomic_writer = Writer()
        self.logger = Log()
    def _metadata_unavailable_report(self):
        return {}
    def _v130_results_keys(self):
        return {}
    def run_exit_value(self):
        return ""
Run._record_executive_summary = ns["_record_executive_summary"]
Run._merge_run_outcome_into_results = ns["_merge_run_outcome_into_results"]
fixture = json.load(open(cases["fixture"], encoding="utf-8"))
run = Run()
returned = run._record_executive_summary(fixture["summary_dict"])
print(json.dumps({"returned": returned, "recorded": [r.get("executive_summary") for r in run.atomic_writer.recorded],
                  "completion": run._merge_run_outcome_into_results().get("executive_summary"), "log": run.logger.lines}))
`;

test('the bundled agent writes the summary the App demo fixture carries, from that one fixture', (t) => {
  if (!pythonReady()) {
    t.skip('python3 is not installed');
    return;
  }
  const out = agentProbe(NOTEBOOK, { names: [], fixture: FIXTURE_PATH }, PROBE);
  const written = FIXTURE.results_json.executive_summary;
  assert.equal(out.returned, written);
  assert.deepEqual(out.recorded, [written], 'the session row gets it the moment the summary exists');
  assert.equal(out.completion, written, 'and the completion writes the same text');
  assert.match(out.log[0], /^\[EXECUTIVE-SUMMARY FIRED\]/);
});

test('the App shows that summary as the paragraphs the fixture names', async () => {
  const F = await import(pathToFileURL(path.resolve(__dirname, '..', '..', 'frontend', 'src', 'lib', 'reviewFigures.js')).href);
  assert.deepEqual(F.executiveSummaryOf(FIXTURE.results_json), FIXTURE.paragraphs);
  assert.deepEqual(F.executiveSummaryOf({ executive_summary: { markdown: 'an object' } }), [], 'only the string the agent writes');
  assert.deepEqual(F.executiveSummaryOf(null), []);
});
