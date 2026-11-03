import ast
import glob
import json
import os
import re
import subprocess
import tempfile

import pytest

import _agentload
from _nbload import AGENT_NB, ROOT, notebook_assets, notebook_cells, packed_text

PYTHON_310 = "/opt/homebrew/bin/python3.10"
SHIPPED_FILES = ("agent/**/*.py", "demos/**/*.py", "inspire_installer.py", "app/installer/**/*.py", "release/**/*.py")
SHELL_MODULES = ("shell_redact", "shell_sql", "shell_facts", "shell_db", "shell_pg", "shell_alerts", "shell_core")
BASE64 = re.compile(r"^[A-Za-z0-9+/=\s]{400,}$")
MARKER = re.compile(r"@@[A-Z_]+@@")
CODE = (ast.Import, ast.ImportFrom, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef, ast.Assign, ast.AugAssign,
        ast.AnnAssign, ast.If, ast.For, ast.While, ast.With, ast.Try, ast.Return)
RE_FLAG_AT = {"compile": 1, "search": 2, "match": 2, "fullmatch": 2, "findall": 2, "finditer": 2, "split": 3, "sub": 4, "subn": 4}
RE_FLAGS = {"I": 2, "IGNORECASE": 2, "L": 4, "LOCALE": 4, "M": 8, "MULTILINE": 8, "S": 16, "DOTALL": 16, "U": 32,
            "UNICODE": 32, "X": 64, "VERBOSE": 64, "A": 256, "ASCII": 256}
NEWER_API = {"datetime": {"UTC"}, "tomllib": set(), "contextlib": {"chdir"}, "hashlib": {"file_digest"},
             "operator": {"call"}, "math": {"cbrt", "exp2", "sumprod"}, "itertools": {"batched"},
             "logging": {"getLevelNamesMapping"}, "inspect": {"getmembers_static", "markcoroutinefunction"},
             "copy": {"replace"}, "warnings": {"deprecated"},
             "asyncio": {"TaskGroup", "timeout", "timeout_at", "Runner", "Barrier"},
             "enum": {"StrEnum", "ReprEnum", "EnumCheck", "FlagBoundary", "verify", "member", "nonmember", "global_enum"},
             "typing": {"Self", "LiteralString", "Never", "assert_never", "assert_type", "reveal_type", "Required",
                        "NotRequired", "TypeVarTuple", "Unpack", "dataclass_transform", "override", "TypeAliasType",
                        "get_overloads", "clear_overloads", "ReadOnly", "TypeIs"}}
NEWER_NAMES = {"ExceptionGroup", "BaseExceptionGroup"}
NEWER_METHODS = {"add_note"}
CHECKER = ("import json, re, sys\n"
           "jobs = json.load(open(sys.argv[1], encoding='utf-8'))\n"
           "out = {}\n"
           "for key, job in jobs.items():\n"
           "    try:\n"
           "        if 'path' in job:\n"
           "            compile(open(job['path'], encoding='utf-8').read(), job['label'], 'exec', dont_inherit=True)\n"
           "        else:\n"
           "            re.compile(job['pattern'], job['flags'])\n"
           "    except SyntaxError as error:\n"
           "        out[key] = [error.lineno or 0, error.msg]\n"
           "    except (re.error, ValueError, TypeError) as error:\n"
           "        out[key] = [0, str(error)]\n"
           "print(json.dumps(out))\n")

needs_310 = pytest.mark.skipif(not os.access(PYTHON_310, os.X_OK),
                               reason=f"no Python 3.10 interpreter at {PYTHON_310}, so the Python 3.10 compile cannot run")


def _parsable(src: str) -> str:
    return "\n".join("" if line.startswith(("%", "!")) and not line.startswith("!=") else line for line in src.split("\n"))


def _neutral(text: str) -> str:
    return MARKER.sub("None", re.sub(r"(?m)^@@[A-Z_]+@@$", "", text))


def _tree(text: str):
    try:
        return ast.parse(text)
    except (SyntaxError, ValueError):
        return None


def _is_python(text: str) -> bool:
    tree = "\n" in text and _tree(_neutral(text))
    return bool(tree) and any(isinstance(node, CODE) for node in tree.body)


def _bundle_files(value: str, depth: int = 0) -> list:
    text = packed_text(value)
    try:
        data = json.loads(text) if text is not None else None
    except ValueError:
        data = None
    if data is None:
        return []
    out, stack = [], [data]
    while stack:
        item = stack.pop()
        pairs = item.items() if isinstance(item, dict) else enumerate(item) if isinstance(item, list) else ()
        for key, child in pairs:
            if isinstance(child, str) and str(key).endswith(".py"):
                out.append((str(key), child))
            elif isinstance(child, str) and depth < 3 and BASE64.match(child):
                out += _bundle_files(child, depth + 1)
            elif isinstance(child, (dict, list)):
                stack.append(child)
    return out


def _held_sources(label: str, text: str, depth: int = 0) -> list:
    tree = _tree(text)
    out = []
    for node in ast.walk(tree) if tree else ():
        if not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
            continue
        if BASE64.match(node.value):
            held = [(f"{label} line {node.lineno} bundle {name}", body) for name, body in _bundle_files(node.value)]
        elif _is_python(node.value):
            held = [(f"{label} line {node.lineno} string", _neutral(node.value))]
        else:
            continue
        out += held
        if depth < 2:
            for inner_label, body in held:
                out += _held_sources(inner_label, body, depth + 1)
    return out


def _file_sources() -> list:
    paths = sorted({path for pattern in SHIPPED_FILES for path in glob.glob(os.path.join(ROOT, pattern), recursive=True)})
    out = []
    for path in paths:
        with open(path, encoding="utf-8") as handle:
            out.append((os.path.relpath(path, ROOT), handle.read()))
    return out


def shipped_sources() -> list:
    top = [(f"agent cell {index}", _parsable(src)) for index, (kind, src) in enumerate(notebook_cells(AGENT_NB))
           if kind == "code"] + _file_sources()
    bundled = [(f"{repo} bundle {name}", body) for repo, text in notebook_assets() if BASE64.match(text)
               for name, body in _bundle_files(text)]
    return top + bundled + [held for label, text in top + bundled for held in _held_sources(label, text)]


def _run_310(jobs: dict) -> dict:
    with tempfile.TemporaryDirectory() as folder:
        manifest = {}
        for key, job in jobs.items():
            if "text" in job:
                path = os.path.join(folder, f"{key}.py")
                with open(path, "w", encoding="utf-8") as handle:
                    handle.write(job["text"])
                manifest[key] = {"label": job["label"], "path": path}
            else:
                manifest[key] = job
        with open(os.path.join(folder, "jobs.json"), "w", encoding="utf-8") as handle:
            json.dump(manifest, handle)
        done = subprocess.run([PYTHON_310, "-I", "-c", CHECKER, os.path.join(folder, "jobs.json")],
                              capture_output=True, text=True, timeout=900, check=False)
    assert done.returncode == 0, done.stderr[-3000:]
    return json.loads(done.stdout)


def _without_statement(text: str, lineno: int):
    tree = _tree(text)
    inner = None
    for node in ast.walk(tree) if tree else ():
        if isinstance(node, ast.stmt) and node.lineno <= lineno <= node.end_lineno and \
                (inner is None or node.end_lineno - node.lineno < inner.end_lineno - inner.lineno):
            inner = node
    if inner is None:
        return None
    lines = text.split("\n")
    first = lines[inner.lineno - 1]
    lines[inner.lineno - 1:inner.end_lineno] = [first[:len(first) - len(first.lstrip())] + "pass"] + \
        [""] * (inner.end_lineno - inner.lineno)
    masked = "\n".join(lines)
    return masked if masked != text else None


def compile_failures(sources: list) -> list:
    failures, pending = [], {str(index): (label, text) for index, (label, text) in enumerate(sources)}
    while pending:
        found = _run_310({key: {"label": label, "text": text} for key, (label, text) in pending.items()})
        following = {}
        for key, (lineno, message) in sorted(found.items(), key=lambda item: int(item[0])):
            label, text = pending[key]
            lines = text.split("\n")
            line = lines[lineno - 1].strip() if 0 < lineno <= len(lines) else ""
            failures.append(f"{label} line {lineno}: {message}: {line[:160]}")
            masked = _without_statement(text, lineno) if lineno else None
            if masked is not None:
                following[key] = (label, masked)
        pending = following
    return failures


def _flags(node) -> int:
    if isinstance(node, ast.Constant) and isinstance(node.value, int):
        return node.value
    if isinstance(node, ast.Attribute) and node.attr in RE_FLAGS:
        return RE_FLAGS[node.attr]
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.BitOr):
        return _flags(node.left) | _flags(node.right)
    return 0


def regex_patterns(sources: list) -> list:
    out = []
    for label, text in sources:
        tree = _tree(text)
        for node in ast.walk(tree) if tree else ():
            func = getattr(node, "func", None)
            if not (isinstance(node, ast.Call) and isinstance(func, ast.Attribute) and func.attr in RE_FLAG_AT
                    and isinstance(func.value, ast.Name) and re.search(r"(^|_)re$", func.value.id)
                    and node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str)):
                continue
            at = RE_FLAG_AT[func.attr]
            flags = node.args[at] if len(node.args) > at else next(
                (word.value for word in node.keywords if word.arg == "flags"), None)
            out.append((f"{label} line {node.lineno}", node.args[0].value, _flags(flags) if flags is not None else 0))
    return out


def regex_failures(patterns: list) -> list:
    found = _run_310({str(index): {"pattern": pattern, "flags": flags} for index, (_label, pattern, flags) in enumerate(patterns)})
    return [f"{patterns[int(key)][0]}: {message}: {patterns[int(key)][1][:120]!r}"
            for key, (_lineno, message) in sorted(found.items(), key=lambda item: int(item[0]))]


def newer_api_uses(sources: list) -> list:
    out = []
    for label, text in sources:
        tree = _tree(text)
        aliases = {}
        for node in ast.walk(tree) if tree else ():
            if isinstance(node, ast.Import):
                for alias in node.names:
                    if alias.name == "tomllib":
                        out.append(f"{label} line {node.lineno}: import tomllib")
                    aliases[alias.asname or alias.name] = alias.name
            elif isinstance(node, ast.ImportFrom) and node.module in NEWER_API:
                out += [f"{label} line {node.lineno}: from {node.module} import {alias.name}" for alias in node.names
                        if alias.name in NEWER_API[node.module]]
        for node in ast.walk(tree) if tree else ():
            if isinstance(node, ast.Attribute) and isinstance(node.value, ast.Name) and \
                    node.attr in NEWER_API.get(aliases.get(node.value.id, ""), ()):
                out.append(f"{label} line {node.lineno}: {aliases[node.value.id]}.{node.attr}")
            elif isinstance(node, ast.Name) and node.id in NEWER_NAMES:
                out.append(f"{label} line {node.lineno}: {node.id}")
            elif isinstance(node, ast.Attribute) and node.attr in NEWER_METHODS:
                out.append(f"{label} line {node.lineno}: .{node.attr}()")
    return out


def _embedded_shell_files() -> dict:
    return dict(_bundle_files(_agentload.load_agent_namespace()["inspire_notebook_asset"]("app_shell")))


@pytest.fixture(scope="module")
def sources():
    return shipped_sources()


@pytest.fixture(scope="module")
def rendered(agent_ns):
    from v120_genie_support import build_inspire, make_uc
    from v130_genie_run_controls_test import INSTRUCTION
    inst, writes = build_inspire(agent_ns), []
    inst._write_notebook_to_workspace = lambda _d, path, notebook, _uid: writes.append(notebook) or path
    inst._assemble_genie_code_notebook(make_uc(genie_instruction=INSTRUCTION, genie_instruction_status="success"), {})
    cells = [(f"generated use-case notebook cell {index}", "".join(cell["source"]))
             for index, cell in enumerate(writes[-1]["cells"]) if cell["cell_type"] == "code"]
    checks = agent_ns["implement_app_check_files"](_embedded_shell_files(), True, ["trend", "bars"])
    return cells + [(f"App check file {name}", body) for name, body in checks.items() if name.endswith(".py")]


def test_the_sweep_reaches_every_kind_of_shipped_python(sources, rendered):
    labels = [label for label, _text in sources + rendered]
    assert sum(label.startswith("agent cell ") and " line " not in label for label in labels) >= 2
    assert {f"agent/app_shell/server/{name}.py" for name in SHELL_MODULES} <= set(labels)
    assert {name for name in _embedded_shell_files() if name.endswith(".py")} >= {f"{name}.py" for name in SHELL_MODULES}
    assert sum(" bundle " in label for label in labels) >= len(SHELL_MODULES), "the embedded App shell's Python files are swept"
    assert sum(label.endswith(" string") for label in labels) >= 4, "REDACT_SOURCE and the other held sources are swept"
    assert any(label.startswith("generated use-case notebook") for label in labels)
    assert any(label.startswith("App check file") for label in labels)


@needs_310
def test_every_shipped_python_source_compiles_on_python_310(sources, rendered):
    failures = compile_failures(sources + rendered)
    assert failures == [], f"{len(failures)} line(s) do not compile on Python 3.10, which the App's jobs run on:\n" + \
        "\n".join(failures[:60])


@needs_310
def test_every_regular_expression_in_shipped_python_compiles_on_python_310(sources, rendered):
    patterns = regex_patterns(sources + rendered)
    assert len(patterns) > 100
    failures = regex_failures(patterns)
    assert failures == [], f"{len(failures)} pattern(s) need Python 3.11 or later:\n" + "\n".join(failures[:40])


def fromisoformat_calls(sources: list) -> list:
    out = []
    for label, text in sources:
        tree = _tree(text)
        out += [f"{label} line {node.lineno}: {ast.unparse(node)[:120]}" for node in (ast.walk(tree) if tree else ())
                if isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "fromisoformat"]
    return out


def test_shipped_python_reads_dates_and_times_only_through_the_one_helper(sources, rendered):
    found = fromisoformat_calls([(label, text) for label, text in sources + rendered if not label.startswith("demos/")])
    assert found == [], f"{len(found)} fromisoformat call(s), which read a trailing Z, an offset without a colon or a fraction " \
        "of other than 3 or 6 digits on Python 3.11 and later but not on 3.10; use inspire_parse_time:\n" + "\n".join(found[:40])
    assert fromisoformat_calls([("p", "import datetime\nday = datetime.date.fromisoformat(text)\n")]) == \
        ["p line 2: datetime.date.fromisoformat(text)"]


def test_shipped_python_uses_no_standard_library_name_added_after_python_310(sources, rendered):
    found = newer_api_uses(sources + rendered)
    assert found == [], f"{len(found)} use(s) of a name Python 3.10 does not have:\n" + "\n".join(found[:40])


@needs_310
def test_the_embedded_app_shell_imports_on_python_310():
    files = _embedded_shell_files()
    with tempfile.TemporaryDirectory() as folder:
        for name, body in files.items():
            with open(os.path.join(folder, name), "w", encoding="utf-8") as handle:
                handle.write(body)
        done = subprocess.run([PYTHON_310, "-I", "-c", f"import sys\nsys.path.insert(0, {folder!r})\nimport " +
                               ", ".join(SHELL_MODULES)], capture_output=True, text=True, timeout=300, check=False)
    assert done.returncode == 0, done.stderr[-3000:]


@needs_310
def test_the_gate_names_each_newer_syntax_and_every_line_of_it():
    newer = {"nested quotes": 'x = 1\ny = f"{dict(a=1)["a"]}"\nz = f"{str("b")}"\n',
             "exception groups": "try:\n    pass\nexcept* ValueError:\n    pass\n",
             "type parameters": "def first[T](items: list[T]) -> T:\n    return items[0]\n",
             "type alias": "type Pair = tuple[int, int]\n",
             "star in a subscript": "def f(*args: *tuple[int, ...]):\n    pass\n"}
    failures = compile_failures(list(newer.items()) + [("plain", "x = f'{1!r}'\nclass A:\n    pass\n")])
    assert {line.split(" line ")[0] for line in failures} == set(newer)
    assert [line.split(":")[0] for line in failures if line.startswith("nested quotes")] == \
        ["nested quotes line 2", "nested quotes line 3"]
    assert [label for label, _pattern, _flags in regex_patterns([("r", "import re\nre.compile(r'(?>a)b')\nre.search('a*+', s)\n"
                                                                  "re.sub('a', 'b', s, 0, re.I)\n")])] == \
        ["r line 2", "r line 3", "r line 4"]
    assert len(regex_failures([("atomic", "(?>a)b", 0), ("possessive", "a*+", 0), ("fine", "a+", 2)])) == 2
    assert newer_api_uses([("n", "import datetime as d\nfrom typing import Self\nd.UTC\ntry:\n    pass\n"
                                 "except ExceptionGroup:\n    pass\n")]) == \
        ["n line 2: from typing import Self", "n line 3: datetime.UTC", "n line 6: ExceptionGroup"]
    held = _held_sources("c", "SOURCE = '''import os\n@@PART@@\nRUN = @@RUN@@\n'''\nTEXT = 'a prompt\\nwith lines'\n")
    assert held == [("c line 1 string", "import os\n\nRUN = None\n")]
