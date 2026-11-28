const { spawnSync } = require('node:child_process');
const path = require('node:path');

const AGENT_ROOT = path.resolve(__dirname, '..', '..', '..', 'agent');

const LOADER = String.raw`
import ast, json, os, re, sys
nb = json.load(open(sys.argv[1], encoding="utf-8"))
tree = [node for cell in nb["cells"] if cell.get("cell_type") == "code" for node in ast.parse("".join(cell.get("source") or [])).body]
def executed_source(node):
    call = node.value if isinstance(node, ast.Expr) else None
    if not (isinstance(call, ast.Call) and isinstance(call.func, ast.Name) and call.func.id == "exec" and call.args):
        return None
    into = call.args[1] if len(call.args) > 1 else None
    if into is not None and not (isinstance(into, ast.Call) and isinstance(into.func, ast.Name) and into.func.id == "globals" and not into.args):
        return None
    source = call.args[0]
    if isinstance(source, ast.Call) and isinstance(source.func, ast.Name) and source.func.id == "compile" and source.args:
        source = source.args[0]
    return source.id if isinstance(source, ast.Name) else None
executed = {executed_source(node) for node in tree} - {None}
pins = next((ast.literal_eval(node.value) for node in tree if isinstance(node, ast.Assign) and len(node.targets) == 1
             and getattr(node.targets[0], "id", "") == "INSPIRE_NOTEBOOK_ASSETS"), {})
def source_text(value):
    # D-SIZE2 (REQ-298): a source the agent reads from a pinned notebook asset (inspire_notebook_asset("result_history")) is that file.
    if isinstance(value, ast.Constant) and isinstance(value.value, str):
        return value.value
    if (isinstance(value, ast.Call) and isinstance(value.func, ast.Name) and value.func.id == "inspire_notebook_asset" and value.args
            and isinstance(value.args[0], ast.Constant) and value.args[0].value in pins):
        return open(os.path.join(sys.argv[3], pins[value.args[0].value]["repo"]), encoding="utf-8").read()
    return None
for node in list(tree):
    if (isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name)
            and node.targets[0].id in executed and source_text(node.value) is not None):
        inner = ast.parse(source_text(node.value))
        ast.increment_lineno(inner, node.lineno - 1)
        tree.extend(inner.body)
top = {}
for node in tree:
    if isinstance(node, ast.FunctionDef):
        top[node.name] = node
    elif isinstance(node, ast.Assign) and len(node.targets) == 1 and isinstance(node.targets[0], ast.Name):
        top[node.targets[0].id] = node
def free(node):
    loaded = {n.id for n in ast.walk(node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Load)}
    if not isinstance(node, ast.FunctionDef):
        return loaded
    local = {a.arg for a in node.args.args + node.args.kwonlyargs}
    local |= {n.id for n in ast.walk(node) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)}
    return loaded - local
seen, chosen = set(), []
def need(name):
    if name in seen or name not in top:
        return
    seen.add(name)
    for sub in sorted(free(top[name])):
        need(sub)
    chosen.append(top[name])
cases = json.loads(sys.argv[2])
missing = [name for name in cases["names"] if name not in top]
if missing:
    print(json.dumps({"missing": missing}))
    sys.exit(0)
for name in cases["names"]:
    need(name)
ns = {}
for node in tree:
    if isinstance(node, (ast.Import, ast.ImportFrom)):
        modules = [a.name for a in node.names] if isinstance(node, ast.Import) else [node.module or ""]
        if all(m.split(".")[0] in sys.stdlib_module_names for m in modules):
            exec(compile(ast.Module(body=[node], type_ignores=[]), "agent", "exec"), ns)
exec(compile(ast.Module(body=sorted(chosen, key=lambda n: n.lineno), type_ignores=[]), "agent", "exec"), ns)
`;

function pythonReady() {
  return spawnSync('python3', ['--version']).status === 0;
}

function agentProbe(notebook, cases, body) {
  const run = spawnSync('python3', ['-c', `${LOADER}${body}`, notebook, JSON.stringify(cases), AGENT_ROOT], { encoding: 'utf8', maxBuffer: 1 << 24 });
  if (run.status !== 0) throw new Error(run.stderr || run.stdout);
  return JSON.parse(run.stdout.trim().split('\n').pop());
}

module.exports = { agentProbe, pythonReady };
