"""v1.2.0: static guard for the metadata-only contract, v1.3.0: Discovery Type boundary.

The agent may read information_schema, run SHOW / DESCRIBE, read system.access.table_lineage, and
read or write its own tracking objects (session, step, lock, feedback, ailogs and use-case tables,
the temp views it creates). Outside the DeepEvidence class it must never read row data from user
tables. This test extracts every SQL statement the agent can execute through `spark.sql` /
`_spark.sql` / `spark_session.sql` / `execute_sql` / `inspire_sql` and checks every FROM / JOIN /
MERGE USING target and every write target. Prompt text (PROMPT_TEMPLATES, including the Genie Code
SQL examples that Genie runs later in user notebooks) is not executed by the agent and is excluded.
DeepEvidence is the only class allowed to read customer data (aggregates only, Deep mode only); its
reads are collected separately and must stay inside that class. The Implement Use Cases operation
(functions named implement_* / _implement_*) may also read and write the result table it builds,
and probe source tables with zero-row reads (LIMIT 0); nowhere else.
"""
import ast
import base64
import json
import re
import zlib

import pytest

import _agentload
from _agentload import agent_source

SQL_START = re.compile(r"^\s*\(?\s*(SELECT|WITH|INSERT|UPDATE|DELETE|MERGE|CREATE|ALTER|DROP|DESCRIBE|DESC|SHOW|"
                       r"TRUNCATE|OPTIMIZE|VACUUM|REFRESH|ANALYZE|COPY\s+INTO)\b", re.I)
METADATA_STATEMENT = re.compile(r"^\s*(DESCRIBE|DESC|SHOW)\b", re.I)
PERMISSION_STATEMENT = re.compile(r"^\s*(GRANT|REVOKE|DENY)\b", re.I)
IDENT = r"(?:`[^`]+`|\{[^{}]+\}|[A-Za-z_][\w$]*)"
TARGET = rf"{IDENT}(?:\s*\.\s*{IDENT})*"
READ_CLAUSES = [re.compile(rf"\bFROM\s+({TARGET})", re.I), re.compile(rf"\bJOIN\s+({TARGET})", re.I)]
MERGE_SOURCE = re.compile(rf"\bUSING\s+({TARGET})", re.I)
WRITE_CLAUSES = [
    re.compile(rf"\bINTO\s+({TARGET})", re.I),
    re.compile(rf"^\s*UPDATE\s+({TARGET})", re.I),
    re.compile(rf"\b(?:CREATE|ALTER|DROP)\s+(?:OR\s+REPLACE\s+)?(?:TEMP(?:ORARY)?\s+)?(?:TABLE|VIEW)\s+"
               rf"(?:IF\s+(?:NOT\s+)?EXISTS\s+)?({TARGET})", re.I),
]
FUNCTION_FROM = re.compile(r"\b(EXTRACT|TRIM|SUBSTRING|OVERLAY|POSITION)\s*\($", re.I)
OWNED_PLACEHOLDER = re.compile(
    r"\{[^}]*(tracking_table|session_table|steps?_table|lock_table|feedback_table|ailogs_table|implement_table|owned_table|view_name|"
    r"_view\b|temp_view|tmp_view)[^}]*\}")
IMPLEMENT_FUNCTION = re.compile(r"^_?implement_")
OWNED_TABLE_GATES = {"add_missing_columns"}
IMPLEMENT_RESULT_PLACEHOLDER = re.compile(r"^\{[^{}]*\bresult_table\b[^{}]*\}$")
ZERO_ROW_PROBE = re.compile(r"\bLIMIT\s+0\s*$", re.I)
CTE_NAME = re.compile(r"(?:^\s*\(?\s*WITH\s+(?:RECURSIVE\s+)?|\)\s*,\s*)([A-Za-z_]\w*)\s+AS\s*\(", re.I)
DATA_READER_CLASS = "DeepEvidence"
DEEP_ONLY_SOURCES = ("system.query.history",)
EXECUTORS = {"execute_sql": 1, "inspire_sql": 0}
SQL_RECEIVER_METHOD = "sql"
LOG_METHODS = {"debug", "info", "warning", "error", "critical", "exception"}
LOG_FUNCTIONS = {"log_print", "print"}
QUEUED_SQL_WORKERS = {"_drain_loop", "_worker_loop", "_run", "_writer_loop"}
RUNTIME_RUNNERS = ("exec", "compile", "eval")
EMBEDDED_SOURCES = {"files['shell_facts.py']": ("app_shell", "shell_facts.py")}
SHARED_SOURCES = ("REDACT_SOURCE", "app_shell:shell_facts.py")
MODULE_LEVEL = "<module>"


def render(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        parts = []
        for value in node.values:
            if isinstance(value, ast.Constant):
                parts.append(str(value.value))
            elif isinstance(value, ast.FormattedValue):
                parts.append("{" + ast.unparse(value.value) + "}")
        return "".join(parts)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = render(node.left), render(node.right)
        if left is not None and right is not None:
            return left + right
    return None


class SqlIndex:
    def __init__(self, tree):
        self.tree = tree
        self.parent = {}
        for node in ast.walk(tree):
            for child in ast.iter_child_nodes(node):
                self.parent[child] = node
        self.functions = {}
        for node in ast.walk(tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self.functions.setdefault(node.name, []).append(node)
        self.prompt_nodes = set()
        for node in ast.walk(tree):
            if isinstance(node, ast.Assign) and any(
                    isinstance(t, ast.Subscript) and isinstance(t.value, ast.Name) and t.value.id == "PROMPT_TEMPLATES"
                    for t in node.targets):
                self.prompt_nodes.update(ast.walk(node.value))

    def enclosing_function(self, node):
        cur = self.parent.get(node)
        while cur is not None and not isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef)):
            cur = self.parent.get(cur)
        return cur

    def enclosing_class(self, node):
        cur = self.parent.get(node)
        while cur is not None and not isinstance(cur, ast.ClassDef):
            cur = self.parent.get(cur)
        return cur.name if cur is not None else None

    def sql_calls(self):
        for node in ast.walk(self.tree):
            if not isinstance(node, ast.Call):
                continue
            func = node.func
            if isinstance(func, ast.Attribute) and func.attr == SQL_RECEIVER_METHOD and node.args:
                yield node, node.args[0]
            elif isinstance(func, ast.Name) and func.id in EXECUTORS:
                idx = EXECUTORS[func.id]
                kw = {k.arg: k.value for k in node.keywords}
                arg = node.args[idx] if len(node.args) > idx else kw.get("query")
                if arg is not None:
                    yield node, arg

    def resolve(self, expr, scope, depth=0):
        """Return (templates, unresolved_reasons) for a SQL expression inside function `scope`."""
        text = render(expr)
        if text is not None:
            return [text], []
        if depth > 4:
            return [], [f"resolution depth exceeded at {ast.unparse(expr)[:60]}"]
        if isinstance(expr, ast.Call) and isinstance(expr.func, ast.Name) and expr.func.id == "str" and expr.args:
            return self.resolve(expr.args[0], scope, depth + 1)
        if isinstance(expr, ast.BoolOp):
            templates, reasons = [], []
            for value in expr.values:
                t, r = self.resolve(value, scope, depth + 1)
                templates += t
                reasons += r
            return templates, ([] if templates else reasons)
        if isinstance(expr, ast.Name) and scope is not None:
            return self.resolve_name(expr.id, scope, depth + 1)
        if isinstance(expr, ast.Call):
            callee = expr.func.attr if isinstance(expr.func, ast.Attribute) else \
                expr.func.id if isinstance(expr.func, ast.Name) else None
            builders = self.functions.get(callee) or []
            templates, reasons = [], []
            for builder in builders:
                for node in ast.walk(builder):
                    if isinstance(node, ast.Return) and node.value is not None:
                        t, r = self.resolve(node.value, builder, depth + 1)
                        templates += t
                        reasons += r
            if builders:
                return templates, ([] if templates else reasons or [f"builder {callee} returns no SQL literal"])
        return [], [f"unresolvable expression {ast.unparse(expr)[:80]}"]

    def resolve_name(self, name, scope, depth):
        templates, reasons, found = [], [], False
        for node in ast.walk(scope):
            if isinstance(node, ast.Assign):
                for target in node.targets:
                    if isinstance(target, ast.Name) and target.id == name:
                        found = True
                        t, r = self.resolve(node.value, scope, depth)
                        templates += t
                        reasons += r
            elif isinstance(node, ast.AugAssign) and isinstance(node.target, ast.Name) and node.target.id == name:
                found = True
                t, r = self.resolve(node.value, scope, depth)
                templates += t
                reasons += r
            elif isinstance(node, ast.For) and isinstance(node.target, ast.Tuple):
                names = [e.id if isinstance(e, ast.Name) else None for e in node.target.elts]
                if name in names:
                    found = True
                    position = names.index(name)
                    seq = node.iter
                    if isinstance(seq, ast.Name):
                        seq = next((a.value for a in ast.walk(scope) if isinstance(a, ast.Assign)
                                    and any(isinstance(t, ast.Name) and t.id == seq.id for t in a.targets)), None)
                    if isinstance(seq, (ast.List, ast.Tuple)):
                        for element in seq.elts:
                            if isinstance(element, ast.Tuple) and len(element.elts) > position:
                                t, r = self.resolve(element.elts[position], scope, depth)
                                templates += t
                                reasons += r
                    else:
                        reasons.append(f"loop variable {name} over a non-literal sequence")
            elif isinstance(node, ast.For) and isinstance(node.target, ast.Name) and node.target.id == name:
                found = True
                t, r = self.resolve_items(node.iter, scope, depth)
                templates += t
                reasons += r
        if found:
            return templates, reasons
        params = [a.arg for a in scope.args.args]
        if name in params:
            position = params.index(name)
            templates, reasons = self.resolve_from_callers(scope, name, position, depth)
            defaults = dict(zip(params[len(params) - len(scope.args.defaults):], scope.args.defaults))
            if name in defaults:
                t, r = self.resolve(defaults[name], self.enclosing_function(scope), depth)
                templates += t
                reasons = [] if templates else reasons + r
            return templates, reasons
        return [], [f"name {name} not bound in {scope.name}"]

    def resolve_items(self, expr, scope, depth):
        if depth > 4:
            return [], [f"resolution depth exceeded at {ast.unparse(expr)[:60]}"]
        if isinstance(expr, (ast.List, ast.Tuple)):
            templates, reasons = [], []
            for element in expr.elts:
                t, r = self.resolve(element, scope, depth + 1)
                templates += t
                reasons += r
            return templates, reasons
        if isinstance(expr, (ast.ListComp, ast.GeneratorExp)):
            return self.resolve(expr.elt, scope, depth + 1)
        if isinstance(expr, ast.BinOp) and isinstance(expr.op, ast.Add):
            left, right = self.resolve_items(expr.left, scope, depth + 1), self.resolve_items(expr.right, scope, depth + 1)
            return left[0] + right[0], left[1] + right[1]
        if isinstance(expr, ast.Name) and scope is not None:
            templates, reasons, found = [], [], False
            for node in ast.walk(scope):
                value = None
                if isinstance(node, ast.Assign) and any(isinstance(t, ast.Name) and t.id == expr.id for t in node.targets):
                    value = node.value
                elif isinstance(node, ast.AugAssign) and isinstance(node.target, ast.Name) and node.target.id == expr.id:
                    value = node.value
                if value is not None:
                    found = True
                    t, r = self.resolve_items(value, scope, depth + 1)
                    templates += t
                    reasons += r
            return (templates, reasons) if found else ([], [f"sequence {expr.id} not bound in {scope.name}"])
        if isinstance(expr, ast.Call):
            callee = expr.func.attr if isinstance(expr.func, ast.Attribute) else \
                expr.func.id if isinstance(expr.func, ast.Name) else None
            builders = self.functions.get(callee) or []
            templates, reasons = [], []
            for builder in builders:
                for node in ast.walk(builder):
                    if isinstance(node, ast.Return) and node.value is not None:
                        t, r = self.resolve_items(node.value, builder, depth + 1)
                        templates += t
                        reasons += r
            if builders:
                return templates, ([] if templates else reasons or [f"builder {callee} returns no SQL literal"])
        return [], [f"loop over a non-literal sequence {ast.unparse(expr)[:80]}"]

    def resolve_from_callers(self, func, name, position, depth):
        is_method = bool(func.args.args) and func.args.args[0].arg == "self"
        templates, reasons, callers = [], [], 0
        for node in ast.walk(self.tree):
            if not isinstance(node, ast.Call):
                continue
            callee = node.func
            called = callee.attr if isinstance(callee, ast.Attribute) else callee.id if isinstance(callee, ast.Name) else None
            if called != func.name:
                continue
            kw = {k.arg: k.value for k in node.keywords}
            arg_pos = position - 1 if is_method and isinstance(callee, ast.Attribute) else position
            arg = kw.get(name) if name in kw else (node.args[arg_pos] if 0 <= arg_pos < len(node.args) else None)
            if arg is None:
                continue
            callers += 1
            t, r = self.resolve(arg, self.enclosing_function(node), depth)
            templates += t
            reasons += r
        return templates, reasons

    def is_log_text(self, node):
        cur = self.parent.get(node)
        while cur is not None and not isinstance(cur, ast.stmt):
            if isinstance(cur, ast.Call):
                func = cur.func
                if (isinstance(func, ast.Attribute) and func.attr in LOG_METHODS) or \
                        (isinstance(func, ast.Name) and func.id in LOG_FUNCTIONS):
                    return True
            cur = self.parent.get(cur)
        return False

    def sql_literals(self):
        """Every SQL-shaped string the module builds outside prompt templates, docstrings and log text."""
        out = []
        for node in ast.walk(self.tree):
            if node in self.prompt_nodes or not isinstance(node, (ast.Constant, ast.JoinedStr, ast.BinOp)):
                continue
            if isinstance(self.parent.get(node), (ast.BinOp, ast.JoinedStr, ast.FormattedValue, ast.Expr)):
                continue
            if self.is_log_text(node):
                continue
            text = render(node)
            if text and SQL_START.match(text):
                scope = self.enclosing_function(node)
                out.append((getattr(node, "lineno", 0), text, self.enclosing_class(node), scope.name if scope else ""))
        return out


def statement_targets(sql):
    if PERMISSION_STATEMENT.match(sql):
        return []
    ctes = {m.group(1).lower() for m in CTE_NAME.finditer(sql)} if re.match(r"^\s*\(?\s*WITH\b", sql, re.I) else set()
    targets = []
    for regex in READ_CLAUSES:
        for match in regex.finditer(sql):
            if match.group(1).strip("`").lower() in ctes:
                continue
            prefix = sql[:match.start()]
            depth, opener = 0, None
            for idx in range(len(prefix) - 1, -1, -1):
                ch = prefix[idx]
                if ch == ")":
                    depth += 1
                elif ch == "(":
                    if depth == 0:
                        opener = idx
                        break
                    depth -= 1
            if opener is not None and FUNCTION_FROM.search(prefix[:opener + 1]):
                continue
            targets.append(("read", match.group(1)))
    if re.match(r"^\s*MERGE\b", sql, re.I):
        targets += [("read", m.group(1)) for m in MERGE_SOURCE.finditer(sql)]
    for regex in WRITE_CLAUSES:
        targets += [("write", m.group(1)) for m in regex.finditer(sql)]
    return targets


def classify_target(target):
    plain = re.sub(r"\s+", "", target.replace("`", ""))
    if re.search(r"(^|\.)information_schema\.", plain, re.I):
        return "information_schema"
    if re.search(r"(^|\.)system\.access\.table_lineage$", plain, re.I):
        return "system_lineage"
    if OWNED_PLACEHOLDER.search(target):
        return "inspire_owned"
    if re.match(r"^(_{1,2}inspire_|_ailogs$)", plain.split(".")[-1], re.I):
        return "inspire_owned"
    return None


def violations_in(sql):
    if METADATA_STATEMENT.match(sql) or PERMISSION_STATEMENT.match(sql):
        return []
    return [(kind, target) for kind, target in statement_targets(sql) if classify_target(target) is None]


def implement_permits(function, kind, target, sql, implement=None):
    if not (IMPLEMENT_FUNCTION.match(function or "") if implement is None else implement):
        return False
    return bool(IMPLEMENT_RESULT_PLACEHOLDER.match(target)) or (kind == "read" and bool(ZERO_ROW_PROBE.search(sql)))


def add_global_builders(index, source):
    for text, space in runtime_sources(source)[0].values():
        if space != "globals()":
            continue
        for node in ast.walk(ast.parse(text)):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                index.functions.setdefault(node.name, []).append(node)


def audit(source, with_deep_reads=False, with_implement_reads=False, scope=None):
    index = SqlIndex(ast.parse(source))
    add_global_builders(index, source)
    runs = (lambda lineno: True) if scope is None else (lambda lineno: scope(lineno)[0])
    implement = (lambda lineno: None) if scope is None else (lambda lineno: scope(lineno)[1])
    executed, unresolved, owned = [], [], []
    for call, arg in index.sql_calls():
        if not runs(call.lineno):
            continue
        scope_node = index.enclosing_function(call)
        templates, reasons = index.resolve(arg, scope_node)
        for template in templates:
            executed.append((call.lineno, template))
            owned.append((call.lineno, template, index.enclosing_class(call), scope_node.name if scope_node else ""))
        if reasons and not templates:
            unresolved.append((call.lineno, scope_node.name if scope_node else "<module>", ast.unparse(call)[:120], reasons))
    bad, deep_reads, implement_reads = [], [], []
    literals = [entry for entry in index.sql_literals() if runs(entry[0])]
    for lineno, sql, owner, function in owned + literals:
        for kind, target in violations_in(sql):
            entry = (lineno, kind, target, " ".join(sql.split())[:160])
            if implement_permits(function, kind, target, sql, implement(lineno)):
                implement_reads.append(entry + (function,))
                continue
            (deep_reads if owner == DATA_READER_CLASS and kind == "read" else bad).append(entry)
    for node in ast.walk(index.tree):
        if node in index.prompt_nodes or not (isinstance(node, ast.Constant) and isinstance(node.value, str)):
            continue
        if index.enclosing_class(node) == DATA_READER_CLASS or index.is_log_text(node) or \
                isinstance(index.parent.get(node), ast.Expr) or not runs(node.lineno):
            continue
        for source_name in DEEP_ONLY_SOURCES:
            if source_name in node.value.lower() and SQL_START.match(node.value):
                bad.append((node.lineno, "read", source_name, " ".join(node.value.split())[:160]))
    dataframe_reads = []
    for node in ast.walk(index.tree):
        if isinstance(node, ast.Attribute) and node.attr in ("table", "read", "readStream") and node not in index.prompt_nodes \
                and runs(node.lineno):
            receiver = ast.unparse(node.value)
            if re.search(r"(^|\.)(spark|_spark|spark_session)$", receiver):
                dataframe_reads.append((node.lineno, ast.unparse(node)[:120]))
    if with_implement_reads:
        return executed, unresolved, bad, dataframe_reads, implement_reads
    if with_deep_reads:
        return executed, unresolved, bad, dataframe_reads, deep_reads
    return executed, unresolved, bad, dataframe_reads


def identifier(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def embedded_file(texts, given):
    held = EMBEDDED_SOURCES.get(ast.unparse(given)) if given is not None else None
    if held is None:
        return None
    try:
        text = _agentload.load_agent_namespace()["inspire_notebook_asset"](held[0])
        files = json.loads(zlib.decompress(base64.b64decode(text)).decode("utf-8")).get("files") or {}
    except (ValueError, zlib.error):
        return None
    return (f"{held[0]}:{held[1]}", files[held[1]]) if isinstance(files.get(held[1]), str) else None


def runtime_sources(source):
    tree = ast.parse(source)
    texts = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign) and isinstance(node.value, ast.Constant) and isinstance(node.value.value, str):
            for target in node.targets:
                texts.setdefault(identifier(target), []).append(node.value.value)
    found, unreadable, wrapped = {}, [], set()
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Call) and isinstance(node.func, ast.Name) and node.func.id in RUNTIME_RUNNERS) \
                or id(node) in wrapped:
            continue
        given = node.args[0] if node.args else None
        if isinstance(given, ast.Call) and isinstance(given.func, ast.Name) and given.func.id == "compile":
            wrapped.add(id(given))
            given = given.args[0] if given.args else None
        name = identifier(given)
        space = node.args[1] if node.func.id != "compile" and len(node.args) > 1 else None
        embedded = embedded_file(texts, given) if name is None else None
        if embedded:
            found[embedded[0]] = (embedded[1], ast.unparse(space) if space is not None else "globals()")
            continue
        if name is None or len(texts.get(name, ())) != 1:
            unreadable.append((node.lineno, ast.unparse(node)[:120]))
            continue
        found[name] = (texts[name][0], ast.unparse(space) if space is not None else "globals()")
    return found, unreadable


def runtime_definitions(tree):
    members, lines = {}, {}
    for node in tree.body:
        if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
            lines.update({line: MODULE_LEVEL for line in range(node.lineno, node.end_lineno + 1)})
            continue
        nested = [item for item in node.body if isinstance(item, (ast.FunctionDef, ast.AsyncFunctionDef))] \
            if isinstance(node, ast.ClassDef) else []
        for member in [node] + nested:
            members.setdefault(member.name, []).append(member)
            start = min([member.lineno] + [decorator.lineno for decorator in member.decorator_list])
            lines.update({line: member.name for line in range(start, member.end_lineno + 1)})
    return members, lines


def lookup_is_called(index, node):
    holder = index.parent.get(node)
    if isinstance(holder, ast.Call) and holder.func is node:
        return True
    if isinstance(holder, ast.Assign):
        names = {target.id for target in holder.targets if isinstance(target, ast.Name)}
        scope = index.enclosing_function(node) or index.tree
        return any(isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id in names for n in ast.walk(scope))
    return True


def runtime_lookups(index, spaces):
    for node in ast.walk(index.tree):
        if isinstance(node, ast.Subscript):
            space, key = ast.unparse(node.value), node.slice
        elif isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get" and node.args:
            space, key = ast.unparse(node.func.value), node.args[0]
        else:
            continue
        if space not in spaces:
            continue
        function = index.enclosing_function(node)
        literal = key.value if isinstance(key, ast.Constant) and isinstance(key.value, str) else None
        if literal is not None or space != "globals()" or lookup_is_called(index, node):
            yield space, literal, function.name if function else MODULE_LEVEL


def runtime_audit(source):
    index = SqlIndex(ast.parse(source))
    found, unreadable = runtime_sources(source)
    spaces = {space for _text, space in found.values()}
    references = {}
    for node in ast.walk(index.tree):
        name = identifier(node)
        if name is not None:
            function = index.enclosing_function(node)
            references.setdefault(name, set()).add(function.name if function else MODULE_LEVEL)
    everything = {}
    for space, literal, function in runtime_lookups(index, spaces):
        if literal is None:
            everything.setdefault(space, set()).add(function)
        else:
            references.setdefault(literal, set()).add(function)
    trees = {name: ast.parse(text) for name, (text, _space) in found.items()}
    definitions = {name: runtime_definitions(tree) for name, tree in trees.items()}
    report = {"sources": {name: text for name, (text, _space) in found.items()}, "unreadable": unreadable, "checked": {},
              "crossed": [], "bad": [], "unresolved": [], "dataframe": [], "implement": [], "deep": []}
    for name, tree in sorted(trees.items()):
        members, lines = definitions[name]
        named = {identifier(node) for node in ast.walk(tree)} - {None}
        for other, (other_members, _lines) in definitions.items():
            if other != name and named & set(other_members):
                report["crossed"].append((name, other, sorted(named & set(other_members))))
        callers = {member: set(references.get(member, ())) | everything.get(found[name][1], set()) for member in members}
        for node in tree.body:
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                for used in {identifier(sub) for sub in ast.walk(node)} & set(members):
                    callers[used].add(MODULE_LEVEL)
        edges = {member: ({identifier(sub) for node in nodes for sub in ast.walk(node)} & set(members)) - {member}
                 for member, nodes in members.items()}
        changed = True
        while changed:
            changed = False
            for member, reached in edges.items():
                for callee in reached:
                    if not callers[member] <= callers[callee]:
                        callers[callee] |= callers[member]
                        changed = True

        def scope(lineno, lines=lines, callers=callers):
            owner = lines.get(lineno)
            if owner == MODULE_LEVEL:
                return True, False
            reach = callers.get(owner) or set()
            return bool(reach), bool(reach) and all(IMPLEMENT_FUNCTION.match(caller) or caller in OWNED_TABLE_GATES
                                                    for caller in reach)

        executed, unresolved, bad, frames, implement = audit(report["sources"][name], with_implement_reads=True, scope=scope)
        deep = audit(report["sources"][name], with_deep_reads=True, scope=scope)[4]
        report["checked"][name] = len(executed)
        for key, entries in (("bad", bad), ("unresolved", unresolved), ("dataframe", frames), ("implement", implement),
                             ("deep", deep)):
            report[key] += [(name,) + tuple(entry) for entry in entries]
    return report


@pytest.fixture(scope="module")
def notebook_audit():
    return audit(agent_source())


def test_guard_extracts_the_agents_sql_surface(notebook_audit):
    executed, _, _, _ = notebook_audit
    assert len(executed) >= 45, f"only {len(executed)} executed SQL statements extracted; the extractor regressed"
    joined = "\n".join(sql for _, sql in executed)
    for expected in ("`information_schema`.`columns`", "`information_schema`.`table_constraints`",
                     "DESCRIBE TABLE", "SHOW SCHEMAS", "SHOW TABLES", "ai_query("):
        assert expected in joined, f"extractor did not resolve the statement containing {expected!r}"


def test_every_executed_sql_call_site_is_resolved(notebook_audit):
    _, unresolved, _, _ = notebook_audit
    leftovers = [u for u in unresolved if not (u[1] in QUEUED_SQL_WORKERS and u[2] == "self.spark.sql(sql)")]
    assert not leftovers, "SQL call sites whose statement cannot be traced to a literal:\n" + "\n".join(
        f"line {line} in {func}: {call} -> {reasons}" for line, func, call, reasons in leftovers)
    assert len(unresolved) - len(leftovers) <= 1, "only the single-writer queue worker may execute queued SQL"


def test_agent_never_reads_user_table_rows(notebook_audit):
    _, _, bad, _ = notebook_audit
    assert not bad, "SQL that reads or writes a non-metadata, non-Inspire object:\n" + "\n".join(
        f"line {line}: {kind} {target!r} in: {sql}" for line, kind, target, sql in bad)


def test_agent_uses_no_dataframe_reads(notebook_audit):
    _, _, _, dataframe_reads = notebook_audit
    assert not dataframe_reads, f"DataFrame API reads found: {dataframe_reads}"


LEAKY_SOURCE = '''
PROMPT_TEMPLATES = {}
PROMPT_TEMPLATES["GENIE"] = """Run spark.sql("SELECT * FROM {result_table}") in your notebook."""

def leak_f_string(spark, catalog, schema, table):
    return spark.sql(f"SELECT * FROM {catalog}.{schema}.{table} LIMIT 10").collect()

def leak_literal(self):
    query = "SELECT amount FROM main.sales.orders"
    return self.spark.sql(query).collect()

def leak_execute_sql(self, fqn):
    return execute_sql(self.spark, f"SELECT COUNT(*) AS n FROM {fqn}", self.logger)

def leak_join(self, cat):
    return self.spark.sql(f"""
        SELECT c.column_name FROM {cat}.information_schema.columns c
        JOIN {cat}.sales.orders o ON o.id = c.ordinal_position
    """)

def leak_through_parameter(self, table_fqn):
    return self._run(f"SELECT * FROM {table_fqn}")

def _run(self, sql):
    return self.spark.sql(sql)

def leak_dataframe(self):
    return self.spark.table("main.sales.orders").collect()

def leak_subquery(self, cat):
    return self.spark.sql(f"SELECT * FROM (SELECT id FROM {cat}.s.t) x")
'''

CLEAN_SOURCE = '''
def ok(self, cat, view_name):
    self.spark.sql(f"SELECT table_name FROM {quote_identifier(cat)}.`information_schema`.`tables` WHERE table_schema = :s", args={"s": "x"})
    self.spark.sql(f"DESCRIBE TABLE {build_fqn(cat, 's', 't')}")
    self.spark.sql(f"SHOW TABLES IN `{cat}`.`s`")
    self.spark.sql(f"DELETE FROM {self._tracking_table_name} WHERE session_id = 1")
    self.spark.sql(f"INSERT INTO {self.steps_table} SELECT * FROM {view_name}")
    self.spark.sql(f"SELECT EXTRACT(YEAR FROM created_at) AS y FROM {self.session_table}")
    self.spark.sql(f"CREATE TABLE IF NOT EXISTS {self.lock_table} (a STRING) USING DELTA")
'''


def test_guard_catches_business_table_reads():
    executed, unresolved, bad, dataframe_reads = audit(LEAKY_SOURCE)
    flagged_lines = sorted({line for line, _, _, _ in bad})
    flagged_targets = {target for _, _, target, _ in bad}
    assert "{catalog}.{schema}.{table}" in flagged_targets
    assert "main.sales.orders" in flagged_targets
    assert "{fqn}" in flagged_targets
    assert "{cat}.sales.orders" in flagged_targets
    assert "{table_fqn}" in flagged_targets
    assert "{cat}.s.t" in flagged_targets
    assert "{result_table}" not in flagged_targets, "prompt text must not be treated as executed SQL"
    assert dataframe_reads and "spark.table" in dataframe_reads[0][1]
    assert len(flagged_lines) >= 6


GLOBAL_BUILDER_SOURCE = '''
SHARED_SOURCE = """
def shared_names_sql(count):
    return "SELECT lower(table_name) AS t FROM system.information_schema.tables WHERE table_catalog = lower(:c) AND table_schema = lower(:s)"

def shared_rows_sql(table):
    return f"SELECT * FROM {table}"
"""
exec(compile(SHARED_SOURCE, "<shared>", "exec"), globals())

def names(self):
    return self.spark.sql(shared_names_sql(2), args={"c": "main", "s": "sales"}).collect()

def rows(self):
    return self.spark.sql(shared_rows_sql("main.sales.orders")).collect()
'''


def test_guard_follows_a_sql_builder_the_agent_compiles_into_its_globals():
    executed, unresolved, bad, _frames = audit(GLOBAL_BUILDER_SOURCE)
    assert not unresolved, unresolved
    assert any("system.information_schema.tables" in sql for _line, sql in executed)
    assert {(kind, target) for _line, kind, target, _sql in bad} == {("read", "{table}")}, bad
    kept = GLOBAL_BUILDER_SOURCE.replace('exec(compile(SHARED_SOURCE, "<shared>", "exec"), globals())', "")
    assert len(audit(kept)[1]) == 2, "a builder the agent never compiles into its globals stays unresolved"


LOOP_BUILDER_SOURCE = '''
def plan_statements(table, readers):
    out = []
    out += [f"GRANT SELECT ON TABLE {table} TO `{p}`" for p in readers]
    return out


def share(spark, table, readers):
    plan = plan_statements(table, readers)
    for statement in plan:
        spark.sql(statement)


def share_direct(spark, table, readers):
    for statement in plan_statements(table, readers):
        spark.sql(statement)
'''


def _call_lines(source):
    return sorted(n.lineno for n in ast.walk(ast.parse(source))
                  if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute) and n.func.attr == "sql")


def test_guard_follows_a_loop_variable_over_a_builder_that_returns_permission_statements():
    executed, unresolved, bad, _frames = audit(LOOP_BUILDER_SOURCE)
    assert not unresolved, unresolved
    assert sorted(line for line, sql in executed if sql.startswith("GRANT SELECT ON TABLE")) == _call_lines(LOOP_BUILDER_SOURCE)
    assert not bad, bad


def test_guard_flags_a_loop_variable_over_a_builder_that_returns_row_reads():
    leaky = LOOP_BUILDER_SOURCE.replace("f\"GRANT SELECT ON TABLE {table} TO `{p}`\"", "f\"SELECT * FROM {table}\"")
    executed, unresolved, bad, _frames = audit(leaky)
    assert not unresolved, unresolved
    flagged = {line for line, kind, target, _sql in bad if (kind, target) == ("read", "{table}")}
    assert set(_call_lines(leaky)) <= flagged, (bad, _call_lines(leaky))


def test_guard_leaves_a_loop_over_an_unknown_sequence_unresolved():
    unknown = LOOP_BUILDER_SOURCE.replace("plan = plan_statements(table, readers)", "plan = fetch_statements(table)").replace(
        "for statement in plan_statements(table, readers):", "for statement in fetch_statements(table):")
    unresolved = audit(unknown)[1]
    assert [u[1] for u in unresolved] == ["share", "share_direct"], unresolved


def test_guard_reads_copy_only_as_a_copy_into_statement():
    prose = 'COPY_LINE = "Copy the cell below into Genie Code without the surrounding quotes, and let Genie Code implement it."\n'
    assert audit(prose)[2] == [], "a sentence that starts with Copy is not a COPY INTO statement"
    literal = "COPY_SQL = \"COPY INTO main.sales.orders FROM '/Volumes/main/raw/files' FILEFORMAT = CSV\"\n"
    assert {(kind, target) for _, kind, target, _ in audit(literal)[2]} == {("write", "main.sales.orders")}
    executed = ("def load(self):\n"
                "    self.spark.sql(\"copy into main.sales.orders from '/Volumes/main/raw/files' fileformat = csv\")\n")
    assert {(kind, target) for _, kind, target, _ in audit(executed)[2]} == {("write", "main.sales.orders")}


def test_guard_accepts_metadata_and_inspire_owned_statements():
    executed, unresolved, bad, dataframe_reads = audit(CLEAN_SOURCE)
    assert len(executed) == 7
    assert not unresolved
    assert not bad, bad
    assert not dataframe_reads


def test_guard_reads_no_rows_in_a_grant_or_a_revoke_and_still_flags_a_read_beside_them():
    source = ('def share(self, principal):\n'
              '    self.spark.sql(f"GRANT SELECT ON TABLE `c`.`s`.`t` TO `{principal}`")\n'
              '    self.spark.sql(f"REVOKE SELECT ON TABLE `c`.`s`.`t` FROM `{principal}`")\n'
              '    self.spark.sql("SELECT amount FROM main.sales.orders")\n')
    executed, unresolved, bad, _frames = audit(source)
    assert len(executed) == 3 and not unresolved
    assert {(kind, target) for _line, kind, target, _sql in bad} == {("read", "main.sales.orders")}
    assert violations_in("REVOKE MODIFY ON SCHEMA `c`.`s` FROM `team`") == []
    assert violations_in("SELECT * FROM `c`.`s`.`t` WHERE x IN (SELECT y FROM `c`.`s`.`u`)") == [
        ("read", "`c`.`s`.`t`"), ("read", "`c`.`s`.`u`")]


def deep_read_calls_outside_the_reader(source):
    tree = ast.parse(source)
    index = SqlIndex(tree)
    calls = [node for node in ast.walk(tree) if isinstance(node, ast.Call)
             and isinstance(node.func, ast.Attribute) and node.func.attr == "_read"]
    return calls, [node.lineno for node in calls if index.enclosing_class(node) != DATA_READER_CLASS]


def test_customer_data_reads_live_only_in_deep_evidence():
    source = agent_source()
    _, _, bad, _, deep_reads = audit(source, with_deep_reads=True)
    assert not bad
    targets = {target for _, _, target, _ in deep_reads}
    assert {"{table_sql}", "{source}", "{child_sql}", "{parent_sql}", "{view_sql}"} <= targets, targets
    calls, outside = deep_read_calls_outside_the_reader(source)
    assert len(calls) >= 7 and not outside, f"DeepEvidence._read called outside the class at lines {outside}"


def test_guard_flags_deep_reads_moved_outside_deep_evidence():
    source = agent_source()
    anchor = "    def _evidence_join_candidates(self, tables) -> list:\n"
    assert source.count(anchor) == 1
    injected = source.replace(anchor, anchor
                              + '        self.spark.sql(f"SELECT COUNT(*) AS n FROM {build_fqn(*tables[0])}").collect()\n'
                              + '        self.spark.sql("SELECT statement_text FROM system.query.history").collect()\n'
                              + '        self.deep_evidence._read("row_count", "t", "SELECT 1")\n')
    _, _, bad, _ = audit(injected)
    targets = {target for _, _, target, _ in bad}
    assert "{build_fqn(*tables[0])}" in targets and "system.query.history" in targets, targets
    _, outside = deep_read_calls_outside_the_reader(injected)
    assert len(outside) == 1


def test_guard_classifies_lineage_and_owned_tables():
    assert classify_target("system.access.table_lineage") == "system_lineage"
    assert classify_target("`main`.`inspire`.`_ailogs`") == "inspire_owned"
    assert classify_target("{self._feedback_table}") == "inspire_owned"
    assert classify_target("system.query.history") is None
    assert classify_target("main.sales._ailogs_copy") is None
    assert classify_target("{self.implement_table}") == "inspire_owned"
    assert classify_target("{implement_table}") == "inspire_owned"
    assert classify_target("{inspire_table_name(result_table)}") is None


def test_guard_flags_a_row_read_injected_into_the_real_loader():
    source = agent_source()
    anchor = '    def _describe_table_columns(self, catalog, schema, table):\n'
    assert source.count(anchor) == 1
    injected = source.replace(anchor, anchor + '        self.spark.sql(f"SELECT * FROM {build_fqn(catalog, schema, table)} LIMIT 5").collect()\n')
    _, _, bad, _ = audit(injected)
    assert bad and {target for _, _, target, _ in bad} == {"{build_fqn(catalog, schema, table)}"}


def test_guard_skips_cte_names_but_not_the_tables_they_read():
    sql = ("WITH x AS (SELECT * FROM main.sales.orders), y AS (SELECT id FROM x) "
           "SELECT * FROM y JOIN main.sales.items i ON TRUE")
    assert violations_in(sql) == [("read", "main.sales.orders"), ("read", "main.sales.items")]
    assert violations_in("SELECT * FROM x") == [("read", "x")]
    assert violations_in("SELECT a, b AS (c) FROM main.sales.orders") == [("read", "main.sales.orders")]


def test_guard_reads_no_rows_in_a_permission_statement_but_still_flags_a_read():
    assert violations_in("REVOKE SELECT ON TABLE main.sales.orders FROM `someone`") == []
    assert violations_in("GRANT SELECT ON TABLE main.sales.orders TO `someone`") == []
    assert violations_in("SELECT * FROM main.sales.orders") == [("read", "main.sales.orders")]
    assert violations_in("WITH r AS (SELECT 1) SELECT * FROM main.sales.orders") == [("read", "main.sales.orders")]


def test_implement_reads_only_its_result_tables_and_zero_row_probes():
    _, _, bad, _, implement = audit(agent_source(), with_implement_reads=True)
    assert not bad
    assert {"{inspire_table_name(result_table)}", "{inspire_table_name(table)}"} <= {target for _, _, target, _, _ in implement}
    assert all(IMPLEMENT_FUNCTION.match(function) for *_, function in implement)
    probes = [entry for entry in implement if not IMPLEMENT_RESULT_PLACEHOLDER.match(entry[2])]
    assert probes and all(ZERO_ROW_PROBE.search(sql) for _, _, _, sql, _ in probes), probes


@pytest.mark.parametrize("anchor,line,target", [
    ("    def _describe_table_columns(self, catalog, schema, table):\n",
     '        self.spark.sql(f"SELECT * FROM {inspire_table_name(result_table)}").collect()\n', "{inspire_table_name(result_table)}"),
    ("    def _implement_missing_tables(self, tables: list) -> list:\n",
     '        self.spark.sql(f"SELECT * FROM {inspire_table_name(table)} LIMIT 5").collect()\n', "{inspire_table_name(table)}"),
    ("    def _implement_tier_counts(self, result_table: str) -> dict:\n",
     '        self.spark.sql(f"SELECT * FROM {build_fqn(catalog, schema, name)} LIMIT 0 UNION ALL SELECT 1").collect()\n',
     "{build_fqn(catalog, schema, name)}"),
    ("    def _implement_tier_counts(self, result_table: str) -> dict:\n",
     '        self.spark.sql(f"INSERT INTO {build_fqn(catalog, schema, name)} SELECT * FROM {inspire_table_name(result_table)}")\n',
     "{build_fqn(catalog, schema, name)}"),
    ("    def _implement_grouping_recommendation(self, uc_id: str, table: str, candidates) -> list:\n",
     '        self.spark.sql(f"SELECT region, COUNT(*) AS n FROM {inspire_table_name(table)} GROUP BY region").collect()\n',
     "{inspire_table_name(table)}"),
    ("    def _implement_grouping_recommendation(self, uc_id: str, table: str, candidates) -> list:\n",
     '        self.spark.sql(f"WITH s AS (SELECT region FROM {inspire_table_name(table)} LIMIT 100000) '
     'SELECT COUNT(DISTINCT region) FROM s").collect()\n',
     "{inspire_table_name(table)}"),
    ("    def _implement_drop_grouping_proof(self, uc_id: str, result_table: str, model_name: str = \"\") -> None:\n",
     '        self.spark.sql(f"DROP TABLE IF EXISTS {inspire_table_name(name)}")\n',
     "{inspire_table_name(name)}"),
])
def test_guard_flags_implement_access_outside_its_boundary(anchor, line, target):
    source = agent_source()
    assert source.count(anchor) == 1
    _, _, bad, _ = audit(source.replace(anchor, anchor + line))
    assert {t for _, _, t, _ in bad} == {target}, bad


HISTORY_ANCHOR = "def inspire_ensure_summary(spark, table):\n"
IMPLEMENT_CALLER_ANCHOR = "    def _implement_result_history(self, uc_id: str, result_table: str, spec: dict, warnings: list) -> None:\n"
PLAIN_CALLER_ANCHOR = "    def _describe_table_columns(self, catalog, schema, table):\n"
PROBE_HELPER = ('def inspire_guard_probe(spark, result_table, source_table):\n'
                '    spark.sql(f"SELECT COUNT(*) AS n FROM {inspire_table_name(result_table)}").collect()\n'
                '    spark.sql(f"SELECT * FROM {inspire_table_name(source_table)} LIMIT 0").collect()\n\n\n')
PROBE_TARGETS = {"{inspire_table_name(result_table)}", "{inspire_table_name(source_table)}"}


def _inject(source, *edits):
    for anchor, added in edits:
        assert source.count(anchor) == 1, anchor
        source = source.replace(anchor, anchor + added)
    return source


def _with_probe_helper(source):
    assert source.count(HISTORY_ANCHOR) == 1
    return source.replace(HISTORY_ANCHOR, PROBE_HELPER + HISTORY_ANCHOR)


def _bad_targets(report):
    return {entry[-2] for entry in report["bad"]}


def _own_bad(report):
    assert all(report["checked"][name] == 0 for name in SHARED_SOURCES), \
        "a source the others share only builds text, so it must run no SQL itself"
    return [entry for entry in report["bad"] if entry[0] not in SHARED_SOURCES]


@pytest.fixture(scope="module")
def runtime_report():
    return runtime_audit(agent_source())


def test_guard_reads_every_source_the_agent_compiles_at_runtime(runtime_report):
    assert not runtime_report["unreadable"], runtime_report["unreadable"]
    assert all(other in SHARED_SOURCES for _name, other, _names in runtime_report["crossed"]), \
        f"a runtime source uses another one's definitions: {runtime_report['crossed']}"
    assert {other for _name, other, _names in runtime_report["crossed"]} == set(SHARED_SOURCES), runtime_report["crossed"]
    assert {"IMPLEMENT_RESULT_HISTORY_SOURCE", "GENIE_NUMBER_TEXT_SOURCE", "_JOB_LAUNCHER_CLASS_SOURCE",
            "REDACT_SOURCE"} <= set(runtime_report["sources"]), runtime_report["sources"]
    assert runtime_report["checked"]["REDACT_SOURCE"] == 0, "the one redaction the other runtime sources share runs no SQL"
    for name, text in runtime_report["sources"].items():
        assert runtime_sources(text) == ({}, []), f"{name} compiles a source of its own, which the guard does not read"
    assert runtime_report["checked"]["IMPLEMENT_RESULT_HISTORY_SOURCE"] >= 3, runtime_report["checked"]
    reached = {entry[-1] for entry in runtime_report["implement"]}
    assert {"inspire_ensure_summary", "inspire_ensure_assumptions"} <= reached
    assert not {"inspire_ensure_history", "inspire_ensure_actions"} & reached, "the build migrates no result table"


def test_the_one_gate_into_the_shared_column_helper_refuses_every_table_inspire_does_not_own():
    gate = _agentload.method_node("AtomicWriter", "add_missing_columns")
    first = gate.body[0]
    assert isinstance(first, ast.If) and isinstance(first.body[0], ast.Raise), ast.unparse(first)
    assert ast.unparse(first.body[0].exc.func) == "ValueError" and "_{1,2}inspire_" in ast.unparse(first.test)
    assert [n.name for n in gate.body if isinstance(n, ast.FunctionDef)] == []


def test_a_caller_that_is_not_the_gate_or_build_code_cannot_reach_the_shared_column_helper():
    source = agent_source() + "\n\ndef sneaky_migration(spark):\n    inspire_add_missing_columns(spark, 'main.sales.orders', [('x', 'STRING')])\n"
    bad = [entry for entry in runtime_audit(source)["bad"] if "ADD COLUMN" in entry[-1]]
    assert bad and {entry[3] for entry in bad} == {"{inspire_table_name(result_table)}"}, bad


def test_runtime_sources_read_no_user_table_rows(runtime_report):
    own = _own_bad(runtime_report)
    assert not own, "SQL in a runtime source that reads or writes a non-metadata, non-Inspire object:\n" + "\n".join(
        f"{name} line {line}: {kind} {target!r} in: {sql}" for name, line, kind, target, sql in own)
    assert not runtime_report["unresolved"], runtime_report["unresolved"]
    assert not runtime_report["dataframe"], runtime_report["dataframe"]
    assert not runtime_report["deep"], "only the agent's own DeepEvidence class may read customer data"


def test_only_a_shared_source_that_runs_no_sql_is_spared_the_row_read_check():
    facts = "app_shell:shell_facts.py"
    bad = [(facts, 1, "read", "qk", "SELECT `_q_key` FROM qk"), ("IMPLEMENT_RESULT_HISTORY_SOURCE", 2, "read", "x", "SELECT * FROM x")]
    quiet = {name: 0 for name in SHARED_SOURCES}
    assert _own_bad({"checked": quiet, "bad": bad}) == [bad[1]]
    with pytest.raises(AssertionError, match="run no SQL"):
        _own_bad({"checked": dict(quiet, **{facts: 1}), "bad": bad})


def test_runtime_implement_reads_name_the_result_table(runtime_report):
    targets = {entry[3] for entry in runtime_report["implement"]}
    assert {"{inspire_table_name(inspire_ai_summary_table(result_table))}",
            "{inspire_table_name(inspire_assumptions_table(result_table))}"} <= targets, targets


@pytest.mark.parametrize("edits,target", [
    ([(HISTORY_ANCHOR, '    spark.sql(f"SELECT * FROM {inspire_table_name(source_table)} LIMIT 5").collect()\n')],
     "{inspire_table_name(source_table)}"),
    ([(HISTORY_ANCHOR, '    spark.sql("SELECT statement_text FROM system.query.history").collect()\n')], "system.query.history"),
    ([(PLAIN_CALLER_ANCHOR, "        inspire_run_tables(self.spark, {})\n")], "{inspire_table_name(read_table)}"),
    ([(PLAIN_CALLER_ANCHOR, "        inspire_run_log_create_sql(table, [])\n")], "{inspire_table_name(inspire_run_log_table(result_table))}"),
    ([(PLAIN_CALLER_ANCHOR, "        globals()[table](self.spark)\n")], "{inspire_table_name(read_table)}"),
], ids=["row_read_in_a_reached_source", "query_history_in_a_reached_source", "notebook_only_function_the_agent_calls",
        "result_read_reached_from_outside_implement", "called_dynamic_lookup"])
def test_guard_flags_a_row_read_injected_into_a_runtime_source(edits, target):
    report = runtime_audit(_inject(agent_source(), *edits))
    assert target in _bad_targets(report), report["bad"]


def test_guard_flags_a_runtime_source_it_cannot_read():
    report = runtime_audit(_inject(agent_source(), (PLAIN_CALLER_ANCHOR, "        exec(compile(self._loaded, '<x>', 'exec'), globals())\n")))
    assert [call for _, call in report["unreadable"]] == ["exec(compile(self._loaded, '<x>', 'exec'), globals())"], report["unreadable"]


def test_guard_reads_the_shared_facts_module_from_the_embedded_app_shell_and_flags_any_other_embedded_file(runtime_report):
    facts = runtime_report["sources"].get("app_shell:shell_facts.py")
    assert facts and "def closing_ctes(" in facts, "the run's facts module is audited from the App shell the notebook pins"
    assert runtime_sources(facts) == ({}, []), "the facts module compiles nothing of its own"
    report = runtime_audit(_inject(agent_source(), (PLAIN_CALLER_ANCHOR, "        exec(compile(files['shell_core.py'], 'x', 'exec'), globals())\n")))
    assert [call for _, call in report["unreadable"]] == ["exec(compile(files['shell_core.py'], 'x', 'exec'), globals())"], report["unreadable"]


def test_guard_accepts_a_result_read_and_a_zero_row_probe_only_implement_code_reaches():
    source = _with_probe_helper(agent_source())
    accepted = runtime_audit(_inject(source, (IMPLEMENT_CALLER_ANCHOR, "        inspire_guard_probe(self.spark, result_table, uc_id)\n")))
    assert not _own_bad(accepted), accepted["bad"]
    assert {entry[3] for entry in accepted["implement"] if entry[-1] == "inspire_guard_probe"} == PROBE_TARGETS
    refused = runtime_audit(_inject(source, (PLAIN_CALLER_ANCHOR, "        inspire_guard_probe(self.spark, table, table)\n")))
    assert PROBE_TARGETS <= _bad_targets(refused), refused["bad"]
