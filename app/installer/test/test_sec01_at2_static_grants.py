"""SEC-01 AT2: no elevated GRANT template on a customer object, anywhere in the shipped code.

Static scan of the non-test .py and .js files under app/backend, app/agent/agent/app_shell/server and app/installer.
A GRANT (or a Unity Catalog permissions PATCH "add") whose privilege is MANAGE, MODIFY or ALL PRIVILEGES is a finding,
unless its target is the Inspire catalog or schema (bound to ctx["CATALOG"] / ctx["SCHEMA"] in the enclosing function)
or it sits in one of the allowlisted functions section 4 names: `_grant_plan`, the value-ledger grants
(`_value_ledger_grants`, `ledger_grant_sqls`) and the Lakebase catalog grant (`_lakebase_grant`).
A privilege written as a placeholder counts when it resolves to a literal or constant holding an elevated privilege.
"""
import ast
import pathlib
import re

APP = pathlib.Path(__file__).resolve().parents[2]
ROOTS = [APP / "backend", APP / "agent" / "agent" / "app_shell" / "server", APP / "installer"]
ALLOWLIST = {"_grant_plan", "_value_ledger_grants", "ledger_grant_sqls", "_lakebase_grant"}
ELEVATED = re.compile(r"\b(MANAGE|MODIFY|ALL[ _]PRIVILEGES)\b")
LITERAL_GRANT = re.compile(r"\bGRANT\s+((?:[A-Z_]+(?:\s*,\s*|\s+))+?)ON\b")
PLACEHOLDER_GRANT = re.compile(r"\bGRANT\s+(?:\$\{\s*([A-Za-z_][\w.]*)\s*\}|\{\s*([A-Za-z_][\w.]*)\s*\})\s+ON\b")
PATCH_ADD = re.compile(r"""["']add["']\s*:\s*\[[^\]]*\b(MANAGE|MODIFY|ALL_PRIVILEGES)\b""")
INSPIRE_KEYS = {"CATALOG", "SCHEMA"}


def _is_test(path):
    parts = set(path.parts)
    name = path.name
    return bool(parts & {"test", "tests", "node_modules", "__pycache__"}) or name.startswith("test_") or ".test." in name


def shipped_files():
    for root in ROOTS:
        for path in sorted(root.rglob("*")):
            if path.suffix in (".py", ".js") and path.is_file() and not _is_test(path.relative_to(APP)):
                yield path


def _constant_text(lines, name):
    """The source of a module- or function-level assignment `name = ...` (Python) or `const name = ...` (JS)."""
    pat = re.compile(rf"^\s*(?:(?:const|let|var)\s+)?{re.escape(name)}\s*=\s*(.+)$")
    for line in lines:
        m = pat.match(line)
        if m:
            return m.group(1)
    return ""


def _resolve_privilege(lines, index, var, func_lines):
    """Text the placeholder privilege `var` stands for: its for-loop iterable or its assignment, constants followed."""
    var = var.split(".")[-1]
    window = func_lines if func_lines else lines[max(0, index - 30): index + 1]
    text = ""
    for line in window:
        m = re.search(rf"\bfor\s+(?:const\s+|let\s+)?{re.escape(var)}\s+(?:in|of)\s+(.+)", line)
        if m:
            text += " " + m.group(1)
    text += " " + (_constant_text(window, var) or _constant_text(lines, var))
    for ident in set(re.findall(r"\b[A-Z][A-Z0-9_]{2,}\b", text)) - {"MANAGE", "MODIFY", "SELECT", "ALL", "PRIVILEGES"}:
        text += " " + _constant_text(lines, ident)
    return text


def _python_functions(source):
    """(start, end, name, node) for every function, innermost last when sorted by start."""
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return []
    return sorted(((n.lineno, n.end_lineno, n.name, n) for n in ast.walk(tree)
                   if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef))), key=lambda t: t[0])


def _enclosing(funcs, lineno):
    found = [f for f in funcs if f[0] <= lineno <= f[1]]
    return found


def _is_inspire_value(node):
    """ctx["CATALOG"], ctx["SCHEMA"], ctx.get("CATALOG", ...)"""
    if isinstance(node, ast.Subscript) and isinstance(node.slice, ast.Constant):
        return node.slice.value in INSPIRE_KEYS
    if (isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute) and node.func.attr == "get"
            and node.args and isinstance(node.args[0], ast.Constant)):
        return node.args[0].value in INSPIRE_KEYS
    return False


def _inspire_names(func_node):
    names = set()
    for node in ast.walk(func_node):
        if not isinstance(node, ast.Assign):
            continue
        for target in node.targets:
            if isinstance(target, ast.Name) and _is_inspire_value(node.value):
                names.add(target.id)
            elif isinstance(target, ast.Tuple) and isinstance(node.value, ast.Tuple):
                for t, v in zip(target.elts, node.value.elts):
                    if isinstance(t, ast.Name) and _is_inspire_value(v):
                        names.add(t.id)
    return names


def _target_is_inspire(line, start, inspire):
    """The ON target right after the match is made only of placeholders bound to the Inspire catalog or schema."""
    target = re.match(r"\s*(?:CATALOG|SCHEMA|TABLE)\s+(\S+)", line[start:])
    if not target:
        return False
    holes = re.findall(r"\{([^{}]+)\}", target.group(1))
    if not holes:
        return False
    return all(h.strip() in inspire or re.fullmatch(r"""ctx\[["'](CATALOG|SCHEMA)["']\]""", h.strip()) for h in holes)


def scan_text(path_label, source, python):
    findings = []
    lines = source.splitlines()
    funcs = _python_functions(source) if python else []
    for i, line in enumerate(lines):
        stripped = line.strip()
        if stripped.startswith(("#", "//", "*")):
            continue
        lineno = i + 1
        enclosing = _enclosing(funcs, lineno)
        if any(f[2] in ALLOWLIST for f in enclosing):
            continue
        inner = enclosing[-1] if enclosing else None
        func_lines = lines[inner[0] - 1: inner[1]] if inner else None
        inspire = _inspire_names(inner[3]) if inner else set()
        hits = []
        for m in LITERAL_GRANT.finditer(line):
            if ELEVATED.search(m.group(1)):
                hits.append((m, m.group(1).strip()))
        for m in PLACEHOLDER_GRANT.finditer(line):
            var = m.group(1) or m.group(2)
            resolved = _resolve_privilege(lines, i, var, func_lines)
            e = ELEVATED.search(resolved)
            if e:
                hits.append((m, f"{var} -> {e.group(1)}"))
        for m, why in hits:
            if python and _target_is_inspire(line, m.end(), inspire):
                continue
            findings.append(f"{path_label}:{lineno}: GRANT {why}")
        p = PATCH_ADD.search(line)
        if p:
            findings.append(f"{path_label}:{lineno}: PATCH add {p.group(1)}")
    return findings


def scan():
    findings = []
    for path in shipped_files():
        rel = path.relative_to(APP.parent).as_posix()
        findings += scan_text(rel, path.read_text(encoding="utf-8", errors="replace"), path.suffix == ".py")
    return findings


def test_AT2_scanner_flags_a_synthetic_elevated_grant():
    """The scanner itself is not tautological: each elevated form is flagged, the allowed forms are not."""
    py = (
        "LEVEL = ('SELECT', 'MANAGE')\n"
        "def bad(name, sp):\n"
        "    return f\"GRANT MANAGE ON CATALOG `{name}` TO `{sp}`\"\n"
        "def bad_loop(t, sp):\n"
        "    return [f\"GRANT {p} ON TABLE {t} TO `{sp}`\" for p in LEVEL]\n"
        "def bad_patch(api, sp, n):\n"
        "    return api('PATCH', n, {'changes': [{'principal': sp, 'add': ['MANAGE']}]})\n"
        "def read_only(t, sp):\n"
        "    return [f\"GRANT {p} ON TABLE {t} TO `{sp}`\" for p in ('SELECT',)]\n"
        "def inspire_own(ctx, sp):\n"
        "    w, catalog = ctx['w'], ctx['CATALOG']\n"
        "    return f\"GRANT MANAGE ON CATALOG `{catalog}` TO `{sp}`\"\n"
        "def _grant_plan(sp, catalog, schema):\n"
        "    return [f\"GRANT {p} ON SCHEMA `{catalog}`.`{schema}` TO `{sp}`\" for p in ('MODIFY', 'MANAGE')]\n"
    )
    js = (
        "const RIGHTS = 'USE SCHEMA, SELECT, MODIFY';\n"
        "function a(o, who) { return `GRANT ${RIGHTS} ON SCHEMA ${o} TO ${who}`; }\n"
        "function b(o, who) { return `GRANT ALL PRIVILEGES ON TABLE ${o} TO ${who}`; }\n"
        "function c(o, who) { return `GRANT SELECT ON TABLE ${o} TO ${who}`; }\n"
    )
    got_py = [f.split(": ", 1)[0] for f in scan_text("x.py", py, True)]
    got_js = [f.split(": ", 1)[0] for f in scan_text("x.js", js, False)]
    assert got_py == ["x.py:3", "x.py:5", "x.py:7"], got_py
    assert got_js == ["x.js:2", "x.js:3"], got_js


def test_AT2_no_elevated_grant_on_a_customer_object():
    findings = scan()
    assert not findings, (
        "AT2: elevated GRANT templates on objects that are not the Inspire catalog or schema "
        f"({len(findings)}):\n" + "\n".join(findings))
