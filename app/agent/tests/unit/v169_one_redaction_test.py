import ast
import os
import re
import types

import pytest

from _agentload import agent_source
from v120_metadata_only_guard_test import runtime_sources
from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire, _python_popen, _runner

ROUTE_NOTEBOOK = os.environ.get("INSPIRE_ROUTE_NOTEBOOK") or None
SINKS = ("inspire_redact_text", "redact_error")
CONVERTERS = {"get_clean_error_message", "str", "repr", "format_exception", "format_exc", "format_tb", "join", "sub", "format"}
TEXT_ATTRS = {"args", "message", "lower", "upper", "strip", "split", "splitlines", "replace"}
QUIET = {"isinstance", "type", "getattr", "hasattr", "id", "len", "bool", "issubclass", "search", "match", "fullmatch", "findall",
         "finditer", "startswith", "endswith", "loads", "retry_if"}
LOGGER = {"debug", "info", "warning", "error", "exception", "critical", "log"}
GROW = {"append", "extend", "add", "insert", "appendleft"}
FOREIGN = {"stderr", "stdout", "state_message", "error_trace", "build_problems", "ai_problems", "gate_problems"}
STREAMS = {"sys", "_sys", "_sys_mod", "_inspire_sys"}
ERROR_CLASSES = {"Exception", "BaseException"}
BUILTIN_METHODS = {name for kind in (list, dict, set, str, bytes, tuple, frozenset) for name in dir(kind)}
PASS_THROUGH = (ast.FormattedValue, ast.JoinedStr, ast.BinOp, ast.Subscript, ast.Slice, ast.IfExp, ast.BoolOp, ast.keyword, ast.Starred)
REVIEWED_MASKS = {
    "inspire_redact_secrets": "the one secret stage of the one redaction: exact secrets, token shapes, hosts and emails",
    "_implement_redact_notebook_secret": "takes only the exact access token out of the notebook Genie wrote, so its code still runs",
    "scrub": "takes only the exact access token out of the files Genie wrote, so their code still runs",
}

SENTINEL = "ZQV9101QZ"
TOKEN = "dapi" + "cd" * 16
HOST = "adb-zqv.example.net"
EMAIL = "ana.lopez@example.com"
CAST = (f"[CAST_INVALID_INPUT] The value '{SENTINEL}' of the type \"STRING\" cannot be cast to \"INT\" because it is malformed. "
        "SQLSTATE: 22018")
ANCHOR = "    def _describe_table_columns(self, catalog, schema, table):\n"
LAUNCHER_ANCHOR = "    def describe_run_failure(self, w, run):\n"
TEMPLATE_ANCHOR = "def inspire_outcome_text(outcome, sample=None):\n"
MARKER = re.compile(r"@@([A-Z_]+)@@")


def _name(func):
    return func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else ""


class Routes:
    def __init__(self, source, label="agent", sinks=SINKS, quiet=QUIET):
        self.label, self.sinks, self.quiet = label, sinks, quiet
        self.tree = ast.parse(source)
        self.parents, self.owner, self.defs, self.methods = {}, {}, {}, {}
        for node in ast.walk(self.tree):
            for child in ast.iter_child_nodes(node):
                self.parents[child] = node
        self.own = {n.name for n in ast.walk(self.tree) if isinstance(n, ast.ClassDef)}
        for fn in [n for n in ast.walk(self.tree) if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))]:
            self.defs.setdefault(fn.name, []).append(fn)
            if isinstance(self.parents.get(fn), ast.ClassDef):
                self.methods.setdefault(fn.name, []).append(fn)
            for inner in ast.walk(fn):
                self.owner[inner] = fn

    def _callee(self, call):
        func = call.func
        if isinstance(func, ast.Name):
            return func.id
        if isinstance(func, ast.Attribute) and isinstance(func.value, ast.Name) and func.value.id in ("self", "cls"):
            return func.attr
        if isinstance(func, ast.Attribute) and len(self.methods.get(func.attr, ())) == 1 and func.attr not in BUILTIN_METHODS:
            return func.attr
        return ""

    def _where(self, node, via):
        while not hasattr(node, "lineno") and node in self.parents:
            node = self.parents[node]
        fn = self.owner.get(node)
        return (self.label, node.lineno, fn.name if fn else "<module>", via)

    def _inside_sink(self, node):
        while node in self.parents:
            node = self.parents[node]
            if isinstance(node, ast.Call) and _name(node.func) in self.sinks:
                return True
            if isinstance(node, ast.stmt):
                return False
        return False

    def _own_only(self, handler):
        caught = [] if handler.type is None else handler.type.elts if isinstance(handler.type, ast.Tuple) else [handler.type]
        return bool(caught) and all((isinstance(c, ast.Name) and c.id in self.own) or (isinstance(c, ast.Attribute) and c.attr in self.own)
                                    for c in caught)

    def sites(self):
        found = []
        for node in ast.walk(self.tree):
            if isinstance(node, ast.Try):
                for handler in node.handlers:
                    if self._own_only(handler):
                        continue
                    body = [n for stmt in handler.body for n in ast.walk(stmt)]
                    if handler.name:
                        found += self._leaks(body, handler.name, set(), "", True)
                    found += self._traceback(body)
            elif isinstance(node, ast.If) and self._error_check(node.test):
                found += self._leaks([n for stmt in node.body for n in ast.walk(stmt)], node.test.args[0].id, set(), "", True)
        found += self._foreign()
        return sorted(set(found))

    def _error_check(self, test):
        if not (isinstance(test, ast.Call) and _name(test.func) == "isinstance" and len(test.args) == 2
                and isinstance(test.args[0], ast.Name)):
            return False
        kinds = test.args[1].elts if isinstance(test.args[1], ast.Tuple) else [test.args[1]]
        return any(isinstance(k, ast.Name) and (k.id in ERROR_CLASSES or k.id.endswith(("Error", "Exception"))) for k in kinds)

    def _traceback(self, nodes):
        out = []
        for node in nodes:
            if not isinstance(node, ast.Call) or self._inside_sink(node):
                continue
            name = _name(node.func)
            printed = name in ("print_exc", "print_exception", "print_stack") or (name == "exception" and node.args)
            shown = any(k.arg == "exc_info" and not (isinstance(k.value, ast.Constant) and not k.value.value) for k in node.keywords)
            if printed or shown:
                out.append(self._where(node, ""))
            elif name in ("format_exc", "format_stack", "exc_info"):
                out += self._use(node, set(), "", False)
        return out

    def _foreign(self):
        out = []
        for node in ast.walk(self.tree):
            read = (isinstance(node, ast.Attribute) and isinstance(node.ctx, ast.Load) and node.attr in FOREIGN
                    and not (isinstance(node.value, ast.Name) and node.value.id in STREAMS)
                    and not isinstance(self.parents.get(node), ast.Attribute))
            read = read or (isinstance(node, ast.Call) and _name(node.func) == "getattr" and len(node.args) >= 2
                            and isinstance(node.args[1], ast.Constant) and node.args[1].value in FOREIGN)
            read = read or (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "exception"
                            and not node.args)
            read = read or (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get"
                            and node.args and isinstance(node.args[0], ast.Constant) and node.args[0].value in FOREIGN)
            read = read or (isinstance(node, ast.Subscript) and isinstance(node.ctx, ast.Load) and isinstance(node.slice, ast.Constant)
                            and node.slice.value in FOREIGN)
            if read and not self._inside_sink(node):
                out += self._use(node, set(), "", False)
        return out

    def _leaks(self, nodes, var, seen, via, raw):
        out = []
        for node in nodes:
            if isinstance(node, ast.Name) and node.id == var and isinstance(node.ctx, ast.Load) and node not in seen:
                seen.add(node)
                if not (raw and self._text_here(node)):
                    out += self._use(node, seen, via, raw)
        return out

    def _text_here(self, node):
        child = node
        while child in self.parents:
            parent = self.parents[child]
            if isinstance(parent, ast.If) and isinstance(parent.test, ast.Call) and _name(parent.test.func) == "isinstance" \
                    and parent.test.args and isinstance(parent.test.args[0], ast.Name) and parent.test.args[0].id == node.id:
                kinds = parent.test.args[1].elts if isinstance(parent.test.args[1], ast.Tuple) else [parent.test.args[1]]
                if child in parent.body and all(isinstance(k, ast.Name) and k.id == "str" for k in kinds):
                    return True
                if child in parent.orelse and self._error_check(parent.test):
                    return True
            child = parent
        return False

    def _after(self, statement, name):
        fn = self.owner.get(statement)
        position = (statement.end_lineno, statement.end_col_offset)
        return [n for stmt in (fn.body if fn else self.tree.body) for n in ast.walk(stmt)
                if isinstance(n, ast.Name) and n.id == name and (n.lineno, n.col_offset) > position]

    def _binder(self, node, name):
        fn = self.owner.get(node)
        while fn is not None:
            for inner in ast.walk(fn):
                if isinstance(inner, ast.With):
                    targets = [item.optional_vars for item in inner.items if item.optional_vars is not None]
                elif isinstance(inner, ast.Assign):
                    targets = inner.targets
                elif isinstance(inner, (ast.AnnAssign, ast.For)):
                    targets = [inner.target]
                else:
                    continue
                if any(isinstance(t, ast.Name) and t.id == name for target in targets for t in ast.walk(target)):
                    return fn
            up = self.parents.get(fn)
            while up is not None and not isinstance(up, (ast.FunctionDef, ast.AsyncFunctionDef)):
                up = self.parents.get(up)
            fn = up
        return None

    def _use(self, node, seen, via, raw):
        child = node
        while True:
            parent = self.parents[child]
            kept = raw and child is node
            if isinstance(parent, ast.Call) and _name(parent.func) in self.sinks and child is not parent.func:
                return []
            if isinstance(parent, ast.Compare) or (isinstance(parent, ast.Raise) and child in (parent.cause, parent.exc)):
                return []
            if isinstance(parent, ast.UnaryOp) and isinstance(parent.op, ast.Not):
                return []
            if isinstance(parent, (ast.If, ast.While, ast.Assert, ast.IfExp)) and child is parent.test or isinstance(parent, ast.Expr):
                return []
            if isinstance(parent, ast.For) and child is parent.iter:
                if isinstance(parent.target, ast.Name):
                    return self._leaks([n for stmt in parent.body for n in ast.walk(stmt)], parent.target.id, seen, via, False)
                return [self._where(parent, via)]
            if isinstance(parent, ast.comprehension) and child is parent.iter:
                made = self.parents[parent]
                if isinstance(parent.target, ast.Name):
                    parts = [made.key, made.value] if isinstance(made, ast.DictComp) else [made.elt]
                    return self._leaks([n for part in parts + parent.ifs for n in ast.walk(part)], parent.target.id, seen, via, False)
                return [self._where(parent, via)]
            if isinstance(parent, ast.Attribute):
                if parent.attr not in TEXT_ATTRS:
                    return []
            elif isinstance(parent, ast.Call):
                name = _name(parent.func)
                if child is not parent.func:
                    if name in self.quiet:
                        return []
                    if name in LOGGER:
                        return [self._where(parent, via)]
                    binder = self._binder(parent, parent.func.value.id) if name in GROW and isinstance(parent.func, ast.Attribute) \
                        and isinstance(parent.func.value, ast.Name) else None
                    if binder is not None:
                        grown, position = parent.func.value.id, (parent.end_lineno, parent.end_col_offset)
                        later = [n for n in ast.walk(binder) if isinstance(n, ast.Name) and n.id == grown and (n.lineno, n.col_offset) > position]
                        return self._leaks(later, grown, seen, via, False)
                    if name not in CONVERTERS:
                        callee = self._callee(parent)
                        return self._into(parent, child, callee, seen, via, kept) if callee in self.defs else [self._where(parent, via)]
            elif isinstance(parent, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                targets = parent.targets if isinstance(parent, ast.Assign) else [parent.target]
                if len(targets) == 1 and isinstance(targets[0], ast.Name):
                    return self._leaks(self._after(parent, targets[0].id), targets[0].id, seen, via, kept)
                if len(targets) == 1 and isinstance(targets[0], ast.Tuple) and isinstance(parent.value, ast.Tuple):
                    for target, value in zip(targets[0].elts, parent.value.elts):
                        if (value is child or child in ast.walk(value)) and isinstance(target, ast.Name):
                            return self._leaks(self._after(parent, target.id), target.id, seen, via, raw and value is node)
                if kept and len(targets) == 1 and isinstance(targets[0], ast.Subscript):
                    return []
                return [self._where(parent, via)]
            elif isinstance(parent, (ast.Tuple, ast.List)):
                holder = self.parents.get(parent)
                if kept and isinstance(holder, ast.Call) and _name(holder.func) in GROW:
                    return []
                if not isinstance(holder, ast.Assign):
                    return [self._where(parent, via)]
            elif not isinstance(parent, PASS_THROUGH):
                return [self._where(parent, via)]
            child = parent

    def _into(self, call, child, callee, seen, via, raw):
        here = via or f"{self.owner[call].name if call in self.owner else '<module>'}:{call.lineno}"
        out = []
        for fn in self.defs[callee]:
            params = [a.arg for a in fn.args.posonlyargs + fn.args.args]
            if params and params[0] in ("self", "cls") and isinstance(call.func, ast.Attribute):
                params = params[1:]
            target = next((params[i] for i, arg in enumerate(call.args) if arg is child and i < len(params)), None)
            target = target or next((k.arg for k in call.keywords if child in (k, k.value)), None)
            if target:
                out += self._leaks([n for stmt in fn.body for n in ast.walk(stmt)], target, seen, here, raw)
            else:
                out.append(self._where(call, here))
        return out


def pasted_sources(source):
    found = {}
    for node in ast.walk(ast.parse(source)):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str) \
                and MARKER.search(node.value.value):
            text = MARKER.sub(lambda marker: "__" + marker.group(1) + "__", node.value.value)
            try:
                ast.parse(text)
            except SyntaxError:
                continue
            found.update({target.id: text for target in node.targets if isinstance(target, ast.Name)})
    return found


def notebook_sites(source):
    found = Routes(source).sites()
    runtimes = sorted(runtime_sources(source)[0].items())
    for name, (text, _space) in runtimes:
        found += Routes(text, name).sites()
    library, spans = "", []
    for name, (text, _space) in runtimes:
        block = text.rstrip("\n") + "\n\n\n"
        start = library.count("\n")
        library += block
        spans.append((start, library.count("\n"), name))
    shared = library.count("\n")
    for name, text in sorted(pasted_sources(source).items()):
        for label, line, fn, via in Routes(library + text, name).sites():
            home = next(((owner, line - start) for start, end, owner in spans if start < line <= end), (label, line - shared))
            found.append((home[0], home[1], fn, via))
    return sorted(set(found))


@pytest.mark.parametrize("library,expected", [
    ("def told(error=None):\n    return f'it stopped: {error}'\n", [("LIB", 2, "told")]),
    ("def told(error=None):\n    return inspire_redact_text(str(error), set(), '')\n", []),
], ids=["raw_in_the_library", "routed_in_the_library"])
def test_an_error_the_pasted_code_passes_by_keyword_into_the_code_it_runs_is_followed_to_where_it_becomes_text(library, expected):
    pasted = "def main():\n    try:\n        run()\n    except Exception as caught:\n        told(error=caught)\n\n\nmain()\n@@RUN@@\n"
    source = f"LIB = {library!r}\nexec(LIB, globals())\nTEMPLATE = {pasted!r}\n"
    assert set(pasted_sources(source)) == {"TEMPLATE"} and set(runtime_sources(source)[0]) == {"LIB"}
    assert [(where, line, fn) for where, line, fn, _via in notebook_sites(source)] == expected


def _report(found):
    return "\n".join(f"{label} line {line} in {fn}" + (f" (reached from {via})" if via else "") for label, line, fn, via in found)


def _probe(method):
    return Routes("class ImplementBlocked(RuntimeError):\n    pass\n\n\nclass Probe:\n" + method).sites()


def test_every_site_in_the_notebook_and_the_code_it_runs_turns_errors_into_text_only_through_the_one_redaction():
    source = agent_source(ROUTE_NOTEBOOK)
    assert {"REDACT_SOURCE", "IMPLEMENT_RESULT_HISTORY_SOURCE", "_JOB_LAUNCHER_CLASS_SOURCE"} <= set(runtime_sources(source)[0])
    assert set(pasted_sources(source)) == {"GENIE_RUN_CONTROLS_TEMPLATE"}
    found = notebook_sites(source)
    assert found == [], _report(found)


SHELL_SINKS = SINKS + ("error_text",)
SHELL_QUIET = QUIET | {"set_exception"}
SHELL_FILES = ("shell_redact.py", "shell_sql.py", "shell_db.py", "shell_pg.py", "shell_alerts.py", "shell_core.py", "app.py")


def shell_library(files=None):
    from _nbload import ROOT
    library, spans = "", []
    for name in SHELL_FILES:
        if files is None:
            with open(os.path.join(ROOT, "agent", "app_shell", "server", name), encoding="utf-8") as handle:
                text = handle.read()
        else:
            text = files[name]
        start = library.count("\n")
        library += text.rstrip("\n") + "\n\n\n"
        spans.append((start, library.count("\n"), name))
    return library, spans


def shell_sites(files=None):
    library, spans = shell_library(files)
    found = []
    for _label, line, fn, via in Routes(library, "shell", SHELL_SINKS, SHELL_QUIET).sites():
        home = next(((name, line - start) for start, end, name in spans if start < line <= end), ("shell", line))
        found.append((home[0], home[1], fn, via))
    return sorted(set(found))


def test_every_site_in_the_app_shell_turns_errors_into_text_only_through_the_one_redaction():
    found = shell_sites()
    assert found == [], _report(found)


@pytest.mark.parametrize("name,old,new,flagged", [
    ("shell_db.py", "did not answer: {error_text(error, self.secrets)}", "did not answer: {error}", ("shell_db.py", "call")),
    ("shell_pg.py", "could not connect to Lakebase: {error_text(error, self.secrets())}", "could not connect to Lakebase: {error}",
     ("shell_pg.py", "_psycopg")),
    ("shell_core.py", "            return 400, error_body(shell_sql.error_text(error), getattr(error, \"code\", \"\"))",
     "            return 400, error_body(str(error), getattr(error, \"code\", \"\"))", ("shell_db.py", "error_body")),
    ("shell_alerts.py", "\"error\": shell_sql.error_text(error)}", "\"error\": str(error)}", ("shell_alerts.py", "cli")),
], ids=["platform_reply", "driver_error", "builtin_error_in_a_response", "builtin_error_in_cli_output"])
def test_an_unrouted_site_in_the_app_shell_fails_the_suite(name, old, new, flagged):
    from _nbload import ROOT
    files = {}
    for file in SHELL_FILES:
        with open(os.path.join(ROOT, "agent", "app_shell", "server", file), encoding="utf-8") as handle:
            files[file] = handle.read()
    assert files[name].count(old) == 1
    files[name] = files[name].replace(old, new)
    assert [(label, fn) for label, _line, fn, _via in shell_sites(files)] == [flagged]


@pytest.mark.parametrize("anchor,method,label,flagged", [
    (ANCHOR, '    def _discover_probe_columns(self, table):\n        try:\n            return self.spark.sql(f"DESCRIBE {table}").collect()\n'
             '        except Exception as e:\n            self.logger.warning(f"Column metadata unavailable for {table}: {e}")\n',
     "agent", "_discover_probe_columns"),
    (LAUNCHER_ANCHOR, '    def probe_run(self, w, run_id):\n        try:\n            return w.jobs.get_run(run_id=run_id)\n'
                      '        except Exception as _probe_err:\n            print(f"  could not read job run {run_id} ({_probe_err})")\n',
     "_JOB_LAUNCHER_CLASS_SOURCE", "probe_run"),
    (TEMPLATE_ANCHOR, 'def inspire_probe_tags(run, out=print):\n    try:\n        return dict(run["job_tags"])\n'
                      '    except Exception as error:\n        out(f"Run controls could not read the job tags: {error}")\n\n\n',
     "GENIE_RUN_CONTROLS_TEMPLATE", "inspire_probe_tags"),
])
def test_an_unrouted_site_added_outside_implement_or_in_code_inspire_runs_fails_the_suite(anchor, method, label, flagged):
    source = agent_source(ROUTE_NOTEBOOK)
    assert source.count(anchor) == 1
    found = notebook_sites(source.replace(anchor, method + anchor))
    assert [(where, fn) for where, _line, fn, _via in found] == [(label, flagged)], _report(found)


@pytest.mark.parametrize("method,flagged", [
    ('    def probe(self, table):\n        try:\n            return self.spark.sql(f"SELECT 1 FROM {table}").collect()\n'
     '        except Exception as error:\n            self.logger.warning(f"[PROBE] {table}: {get_clean_error_message(error)}")\n', "probe"),
    ('    def probe(self, table):\n        try:\n            return self.tier_counts(table)\n'
     '        except Exception as error:\n            return {"error": str(error)}\n', "probe"),
    ('    def probe(self, table):\n        warnings = []\n        try:\n            self.spark.sql(f"GRANT SELECT ON TABLE {table} TO `x`")\n'
     '        except Exception as error:\n            message = get_clean_error_message(error)[:300]\n            warnings.append(f"Sharing: {message}")\n'
     '        return warnings\n', "probe"),
    ('    def probe(self, table):\n        try:\n            self.spark.sql(f"SELECT 1 FROM {table}").collect()\n'
     '        except Exception as error:\n            self.probe_note(table, error)\n\n'
     '    def probe_note(self, table, error):\n        self.logger.warning(f"[PROBE] {table}: {error}")\n', "probe_note"),
    ('    def probe(self, table):\n        try:\n            return self.spark.sql(f"SELECT 1 FROM {table}").collect()\n'
     '        except (ImplementBlocked, RuntimeError) as error:\n            raise ImplementBlocked(f"the probe of {table} failed: {error}")\n',
     "probe"),
    ('    def probe(self, results):\n        for result in results:\n            if isinstance(result, Exception):\n'
     '                self.logger.error(f"Batch failed: {result}")\n', "probe"),
    ('    def probe(self, table):\n        try:\n            self.load(table)\n        except Exception:\n'
     '            self.logger.error(f"{table} failed: {traceback.format_exc()}")\n', "probe"),
    ('    def probe(self, completed):\n        detail = (completed.stderr or "").strip()[-300:]\n        return f"pip failed: {detail}"\n', "probe"),
    ('    def probe(self, result):\n        raise RuntimeError(f"Genie exited: {str(result.get(\'stderr\'))[-500:]}")\n', "probe"),
    ('    def probe(self, table):\n        try:\n            self.load(table)\n        except Exception as error:\n'
     '            NEXT_ACTIONS.add("LOAD_FAILED", evidence=f"{table}: {redact_error(error)} and {error}")\n', "probe"),
    ('    def probe(self, table, warnings):\n        try:\n            self.load(table)\n        except Exception as error:\n'
     '            warnings.append(f"Load: {error}")\n', "probe"),
    ('    def probe(self, outcome, warnings):\n        if outcome.get("build_problems"):\n'
     '            warnings.append(f"Notebook: Genie left these unfixed: {\'; \'.join(outcome[\'build_problems\'])}"[:1500])\n', "probe"),
    ('    def probe(self, outcome):\n        return {"ai_warnings": [f"AI: {p}" for p in outcome.get("ai_problems") or []]}\n', "probe"),
    ('    def probe(self, outcome):\n        return "; ".join(outcome["gate_problems"])[:300]\n', "probe"),
])
def test_an_unrouted_shape_is_caught(method, flagged):
    assert [fn for _label, _line, fn, _via in _probe(method)] == [flagged]


@pytest.mark.parametrize("method", [
    '    def probe(self, table):\n        try:\n            return self.spark.sql(f"SELECT 1 FROM {table}").collect()\n'
    '        except Exception as error:\n            self.logger.warning(f"[PROBE] {table}: {redact_error(error, table)[:300]}")\n',
    '    def probe(self, table):\n        try:\n            return self.spark.sql(f"SELECT 1 FROM {table}").collect()\n'
    '        except Exception as error:\n            if "TABLE_OR_VIEW_NOT_FOUND" in str(error):\n                return []\n            raise\n',
    '    def probe(self, table):\n        try:\n            return self.spark.sql(f"SELECT 1 FROM {table}").collect()\n'
    '        except Exception as error:\n            raise RuntimeError(f"the probe of {table} failed: {inspire_redact_text(str(error), set(), table)}") from error\n',
    '    def probe(self, table):\n        try:\n            return self.spark.sql(f"SELECT 1 FROM {table}").collect()\n'
    '        except ImplementBlocked as error:\n            self.logger.warning(f"[PROBE] {table}: {error}")\n',
    '    def probe(self, work):\n        outcome = {}\n        try:\n            outcome["value"] = work()\n        except Exception as exc:\n'
    '            outcome["error"] = exc\n        return outcome\n',
    '    def probe(self, step):\n        try:\n            self.load(step)\n        except Exception as error:\n            self.note(step, error)\n\n'
    '    def note(self, step, error):\n        if isinstance(error, BaseException):\n            text = redact_error(error, max_chars=300)\n'
    '        else:\n            text = str(error or "")[:300]\n        self.logger.warning(f"{step}: {text}")\n',
    '    def probe(self, table):\n        try:\n            self.load(table)\n        except Exception:\n'
    '            self.logger.error(f"{table} failed: {inspire_redact_text(traceback.format_exc(), set(), table)}")\n',
    '    def probe(self, outcome, warnings):\n        if outcome.get("build_problems"):\n'
    '            warnings.append(f"Notebook: {inspire_redact_text(\'; \'.join(outcome[\'build_problems\']), set(), \'\')}"[:1500])\n',
    '    def probe(self, outcome):\n        return {"ai_warnings": [inspire_redact_text(p, set(), "") for p in outcome.get("ai_problems") or []]}\n',
])
def test_a_routed_or_text_free_shape_is_accepted(method):
    assert _probe(method) == []


def _masks(source):
    found = {}
    for tree in [ast.parse(source)] + [ast.parse(text) for text, _space in runtime_sources(source)[0].values()] + [
            ast.parse(text) for text in pasted_sources(source).values()]:
        _tree_masks(tree, found)
    return found


def _tree_masks(tree, found):
    owner = {}
    for fn in ast.walk(tree):
        if isinstance(fn, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for inner in ast.walk(fn):
                owner[inner] = fn.name
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and node.value in ("<redacted>", b"<redacted>", "<host>", "<email>"):
            found.setdefault("marks", set()).add(owner.get(node, "<module>"))
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id in (
                "INSPIRE_SECRET_TOKEN_RE", "INSPIRE_SECRET_HOST_RE", "INSPIRE_SECRET_EMAIL_RE"):
            found.setdefault("patterns", set()).add(owner.get(node, "<module>"))
        if isinstance(node, ast.Name) and isinstance(node.ctx, ast.Load) and node.id == "INSPIRE_REDACTED_VALUE":
            found.setdefault("values", set()).add(owner.get(node, "<module>"))
        if isinstance(node, ast.Call) and _name(node.func) == "inspire_redact_secrets":
            found.setdefault("callers", set()).add(owner.get(node, "<module>"))


@pytest.mark.parametrize("text,expected", [
    (f"Genie's notebook failed Inspire's checks: cell 3 reads '{SENTINEL}'", "Genie's notebook failed Inspire's checks: cell 3 reads 'a data value'"),
    (f"the build reads the users' rows near \"{SENTINEL}\"", "the build reads the users' rows near \"a data value\""),
    (f"see https://{HOST}. Then https://{HOST}/api, and (https://{HOST})", "see https://<host>. Then https://<host>/api, and (https://<host>)"),
])
def test_an_apostrophe_or_the_end_of_a_sentence_is_never_taken_for_part_of_a_value(agent_ns, text, expected):
    assert agent_ns["inspire_redact_text"](text, set(), "") == expected


def test_an_error_inspire_composed_passes_and_a_foreign_one_is_redacted(agent_ns):
    hide, raised_by_inspire = agent_ns["redact_error"], agent_ns["raised_by_inspire"]
    with pytest.raises(RuntimeError) as own:
        agent_ns["implement_app_shell_payload"]("not an App shell")
    assert raised_by_inspire(own.value) and hide(own.value) == agent_ns["get_clean_error_message"](own.value)
    label = agent_ns["ImplementBlocked"]("the example SQL for 'Which customers act now?' failed: [UNRESOLVED_COLUMN] zz cannot be resolved")
    assert raised_by_inspire(label) and hide(label) == str(label)
    with pytest.raises(RuntimeError) as foreign:
        raise RuntimeError(CAST)
    with pytest.raises(ValueError) as parsed:
        float(SENTINEL)
    assert not raised_by_inspire(foreign.value) and not raised_by_inspire(parsed.value)
    assert hide(foreign.value) == CAST.replace(SENTINEL, "a data value")
    assert hide(parsed.value) == "could not convert string to float: 'a data value'"
    assert hide(KeyError("segment")) == "KeyError: 'segment'" and hide(KeyError(SENTINEL)) == "KeyError: 'a data value'"


def _caught(function, *args):
    try:
        function(*args)
    except Exception as error:
        return error
    raise AssertionError(f"{function.__name__} raised nothing")


def test_only_a_raise_statement_in_inspire_code_makes_a_builtin_error_inspire_s_own(agent_ns):
    raised_by_inspire, hide = agent_ns["raised_by_inspire"], agent_ns["redact_error"]
    probes = ("def explicit(x):\n    raise ValueError(f'the widget value {x!r} is not one of the options')\n\n\n"
              "def builtin(x):\n    return float(x)\n\n\n"
              "def lookup(d, k):\n    return d[k]\n\n\n"
              "def mutate(d):\n    for k in d:\n        d[k + 'x'] = 1\n\n\n"
              "def rows(xs):\n    return [float(x) for x in xs]\n\n\n"
              "def reraise(x):\n    try:\n        float(x)\n    except ValueError:\n        raise\n")
    agent, launcher, here = {}, {}, {}
    exec(compile(probes, raised_by_inspire.__code__.co_filename, "exec"), agent)
    exec(compile(probes, "<JobLauncher>", "exec"), launcher)
    exec(compile(probes, "a_test_file.py", "exec"), here)
    explicit = _caught(agent["explicit"], SENTINEL)
    assert raised_by_inspire(explicit) and hide(explicit) == f"the widget value '{SENTINEL}' is not one of the options"
    assert raised_by_inspire(_caught(launcher["explicit"], SENTINEL)) and not raised_by_inspire(_caught(here["explicit"], SENTINEL))
    for name, args in (("builtin", (SENTINEL,)), ("lookup", ({}, SENTINEL)), ("rows", ([SENTINEL],)), ("reraise", (SENTINEL,))):
        error = _caught(agent[name], *args)
        assert not raised_by_inspire(error), name
        assert SENTINEL not in hide(error) and "a data value" in hide(error), (name, hide(error))
    assert not raised_by_inspire(_caught(agent["mutate"], {"a": 1})), "a RuntimeError Python raises is not Inspire's"


@pytest.mark.parametrize("parse,typed,shown", [
    ("canonical_use_cases_quality", "Premium", ("'Premium'", "'Good'", "'High'", "'Ultra High'", "'Balanced'")),
    ("canonical_discovery_type", "Shallow", ("'Shallow'", "'Deep'", "'Standard'")),
    ("parse_best_of_best_count", "lots", ("'lots'", "0 to 100")),
])
def test_the_message_of_a_widget_inspire_refuses_keeps_the_value_typed_and_the_options(agent_ns, parse, typed, shown):
    error = _caught(agent_ns[parse], typed)
    text = agent_ns["redact_error"](error)
    assert agent_ns["raised_by_inspire"](error) and text == agent_ns["get_clean_error_message"](error)
    assert all(part in text for part in shown) and "a data value" not in text, text


def test_there_is_one_redaction_path():
    found = _masks(agent_source(ROUTE_NOTEBOOK))
    assert found["marks"] <= set(REVIEWED_MASKS), sorted(found["marks"] - set(REVIEWED_MASKS))
    assert found["patterns"] == {"inspire_redact_secrets"}, found["patterns"]
    assert found["callers"] == {"inspire_redact_text", "redact"}, found["callers"]
    assert found["values"] <= {"<module>", "inspire_redact_text", "spark", "quoted"}, found["values"]
    shell = {}
    _tree_masks(ast.parse(shell_library()[0]), shell)
    assert shell["marks"] == {"inspire_redact_secrets"} and shell["patterns"] == {"inspire_redact_secrets"}, shell
    assert shell["callers"] == {"inspire_redact_text"} and shell["values"] <= {"<module>", "inspire_redact_text", "spark", "quoted"}, shell


def test_a_second_redaction_helper_is_caught():
    helper = 'def implement_hide_token(text, token):\n    return str(text).replace(token, "<redacted>")\n\n\n'
    assert "implement_hide_token" in _masks(helper + agent_source(ROUTE_NOTEBOOK))["marks"]


def test_the_app_shell_ships_the_notebook_s_one_redaction_byte_for_byte(agent_ns):
    import importlib.util
    from _nbload import ROOT
    spec = importlib.util.spec_from_file_location("inspire_app_shell_embed_v169", os.path.join(ROOT, "agent", "app_shell", "embed.py"))
    embed = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(embed)
    with open(os.path.join(embed.SERVER, "shell_redact.py"), encoding="utf-8") as handle:
        shipped = handle.read()
    assert shipped == agent_ns["REDACT_SOURCE"], "agent/app_shell/server/shell_redact.py differs from the notebook's REDACT_SOURCE"
    assert embed.embedded()["files"]["shell_redact.py"] == agent_ns["REDACT_SOURCE"]
    assert agent_ns["IMPLEMENT_APP_SHELL_MODULES"][0] == "shell_redact"
    checks = agent_ns["implement_app_check_files"]({"shell_sql.py": "", "shell_facts.py": ""}, False)
    assert [text for name, text in checks.items() if name.endswith("/shell_redact.py")] == [agent_ns["REDACT_SOURCE"]]
    namespace = {}
    exec(compile(shipped, "shell_redact", "exec"), namespace)
    assert namespace["inspire_redact_text"]("could not read 'alice@example.com' from main.sales.orders", set(), "") == \
        agent_ns["inspire_redact_text"]("could not read 'alice@example.com' from main.sales.orders", set(), "")
    assert agent_ns["raised_by_inspire"].__globals__["inspire_raised_by"] is agent_ns["inspire_raised_by"]


def test_genie_stderr_loses_its_secrets_and_values_and_keeps_its_frames(agent_ns, tmp_path):
    frames = ('Traceback (most recent call last):\n'
              f'  File "/Workspace/Users/{EMAIL}/genie/run_task.py", line 41, in <module>\n'
              f'    connect("https://{HOST}/api", token="{TOKEN}")\n'
              f'  File "https://{HOST}/files/client.py", line 212, in connect\n'
              '    raise PermissionError(message)\n'
              '  File "/opt/genie/lib/runner.py", line 9, in run\n'
              '    step()\n'
              f"PermissionError: refused https://{HOST}/api for {EMAIL} with {TOKEN} and tok-123 on the value '{SENTINEL}'\n")
    script = (f"import json, sys\nsys.stderr.write({frames!r})\nsys.stderr.flush()\n"
              "print(json.dumps({'type': 'turn.completed', 'usage': {}}), flush=True)\n")
    stderr = _runner(agent_ns, tmp_path, popen=_python_popen(script), timeout_s=60).run("x", str(tmp_path / "w"))["stderr"]
    hidden = (TOKEN, HOST, EMAIL, "tok-123", SENTINEL)
    assert [s for s in hidden if s in frames] == list(hidden)
    assert [s for s in hidden if s in stderr] == [], stderr
    for frame in ('File "/Workspace/Users/<email>/genie/run_task.py", line 41, in <module>',
                  'File "https://<host>/files/client.py", line 212, in connect', 'File "/opt/genie/lib/runner.py", line 9, in run'):
        assert frame in stderr, stderr
    assert ("PermissionError: refused https://<host>/api for <email> with <redacted> and <redacted> on the value 'a data value'"
            in stderr), stderr


def test_a_build_failure_is_logged_with_its_frames_and_without_a_secret_or_a_value(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst.w_client = types.SimpleNamespace(config=types.SimpleNamespace(token=TOKEN, host=f"https://{HOST}"))

    def read_rows():
        raise RuntimeError(f"{CAST} while reading https://{HOST}/api/2.2/jobs/get for {EMAIL} with {TOKEN}")

    def carried():
        try:
            read_rows()
        except RuntimeError as error:
            raise AttributeError("'list' object has no attribute 'get'") from error

    with pytest.raises(AttributeError) as raised:
        carried()
    inst._implement_log_failure("N01-U01", "the MVP build", 1, raised.value)
    [logged] = [line for level, line in inst.logger.records if level == "ERROR" and "[IMPLEMENT-ERROR]" in line]
    assert "Traceback (most recent call last)" in logged and "in read_rows" in logged and "in carried" in logged
    assert "AttributeError: 'list' object has no attribute 'get'" in logged
    assert "The value 'a data value' of the type" in logged and "while reading <redacted>/api/2.2/jobs/get for <email> with <redacted>" in logged
    assert [s for s in (SENTINEL, TOKEN, HOST, EMAIL) if s in logged] == [], logged


def test_the_build_failure_message_and_an_inspire_crash_carry_no_value(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    message = inst._implement_failure_message(RuntimeError(CAST), "main.inspire.churn_out")
    assert message == CAST.replace(SENTINEL, "a data value")
    crashed = agent_ns["implement_internal_failure_message"](KeyError(SENTINEL))
    assert crashed.startswith("an Inspire step failed: KeyError: KeyError: 'a data value'") and SENTINEL not in crashed, crashed


def test_error_text_is_redacted_before_it_is_cut(agent_ns):
    error = RuntimeError("a" * 555 + f" [CAST_INVALID_INPUT] The value '{SENTINEL * 4}' of the type \"STRING\" cannot be cast to \"INT\"")
    text = agent_ns["redact_error"](error)
    assert len(text) == 600 and SENTINEL[:6] not in text, text[-80:]
    cut_first = agent_ns["inspire_redact_text"](agent_ns["get_clean_error_message"](error), set(), "")
    assert SENTINEL[:6] in cut_first, "a value cut before redaction loses its closing quote and is kept"


def test_a_permission_denial_keeps_its_principal_and_an_email_beside_it_does_not(agent_ns):
    text = (f"PERMISSION_DENIED: User '{EMAIL}' does not have SELECT on Table 'main.s.orders'. Asked by {EMAIL} for bob.ray@example.com "
            f"near '{SENTINEL}'")
    assert agent_ns["inspire_redact_text"](text, set(), "") == (
        f"PERMISSION_DENIED: User '{EMAIL}' does not have SELECT on Table 'main.s.orders'. Asked by {EMAIL} for <email> "
        "near 'a data value'")


def test_a_runtime_error_inspire_raises_from_foreign_text_outside_a_read_handler_carries_no_secret_or_value(agent_ns, monkeypatch):
    import subprocess
    from v120_artifacts_support import make_inspire
    stderr = f"cannot load https://{HOST}/simple/zqv-missing/ for {EMAIL} with {TOKEN}: '{SENTINEL}' is not a valid name"
    monkeypatch.setattr(subprocess, "run", lambda *a, **k: pytest.fail("no pip runs"))
    inst = make_inspire(agent_ns)
    inst._assets = type("Assets", (), {"python": staticmethod(lambda module: (_ for _ in ()).throw(OSError(stderr)))})()
    with pytest.raises(RuntimeError) as raised:
        inst._require_asset_package("zqv_missing_module", "The PDF catalog")
    assert agent_ns["raised_by_inspire"](raised.value), "the error is Inspire's own, so every handler shows it as it is"
    shown = agent_ns["redact_error"](raised.value)
    assert shown == str(raised.value) and "'zqv_missing_module' from the Inspire assets cannot be loaded" in shown, shown
    assert [s for s in (SENTINEL, TOKEN, HOST, EMAIL) if s in shown] == [], shown


def test_a_key_error_keeps_a_key_inspire_names_and_hides_a_key_from_the_data(agent_ns):
    hide = agent_ns["redact_error"]
    assert hide(KeyError("segment")) == "KeyError: 'segment'"
    assert hide(KeyError("zqv_north_region")) == "KeyError: 'a data value'"
    assert hide(KeyError("Ana Lopez")) == "KeyError: 'a data value'"
    trace = "Traceback (most recent call last):\n  File \"/x.py\", line 3, in f\n    row[key]\nKeyError: 'zqv_north_region'\n"
    assert agent_ns["inspire_redact_text"](trace, set(), "").endswith("KeyError: 'a data value'\n")


@pytest.mark.parametrize("text,expected", [
    (f"no rows near 'O'{SENTINEL}' in the table", "no rows near 'a data value' in the table"),
    (f"no rows near 'O\\'{SENTINEL}' in the table", "no rows near 'a data value' in the table"),
    (f"Genie's rows near 'Bob's {SENTINEL} order' failed Inspire's check", "Genie's rows near 'a data value' failed Inspire's check"),
])
def test_a_quoted_value_with_an_apostrophe_inside_is_hidden_whole(agent_ns, text, expected):
    assert agent_ns["inspire_redact_text"](text, set(), "") == expected


def test_the_genie_loop_keeps_the_names_genie_wrote_and_hides_a_value_it_did_not_write(agent_ns, tmp_path):
    inst = _inspire(agent_ns, FakeSpark(), local_log_output_dir=str(tmp_path))
    prompts, calls = [], []

    class Writer:
        def run(self, prompt, work, schema, label=None):
            prompts.append(prompt)
            os.makedirs(work, exist_ok=True)
            with open(os.path.join(work, "genie_space.json"), "w", encoding="utf-8") as handle:
                handle.write('{"instructions": "rank by \'churn band\' first"}')
            return {}

    def deploy(work):
        calls.append(work)
        if len(calls) == 1:
            raise ValueError(f"genie_space.json ranks by 'churn band', which main.s.orders lacks; its first row reads '{SENTINEL}'")
        return {"genie_space_id": "g1"}

    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3)}
    assert inst._implement_genie_loop(context, Writer(), "Genie Agent", "Build the Genie Agent.", deploy) == {"genie_space_id": "g1"}
    feedback = prompts[1].split("Inspire tried to use what you wrote and it failed: ", 1)[1]
    steps = [str(item.get("message")) for item in inst.emitted if "sent back to Genie" in str(item.get("message"))]
    for text in [feedback] + steps:
        assert "ranks by 'churn band'" in text and "reads 'a data value'" in text and SENTINEL not in text, text
