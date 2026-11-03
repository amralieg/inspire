import ast
import glob
import os
import re

from _agentload import agent_source
from _nbload import AGENT_NB, notebook_cells

DASH = re.compile("[\u2013\u2014]")
SHELL_SERVER = os.path.join(os.path.dirname(os.path.abspath(AGENT_NB)), "app_shell", "server")
PROMPT_TEMPLATE_PREFIX = "PROMPT_TEMPLATES["
PROMPT_TEXT = {
    ("<module>", "QUALITY_GATE_SCORING_BLOCK"),
    ("_merge_small_domains", "status"),
    ("_merge_small_domains", "protected_block"),
    ("_merge_duplicate_subdomains", "merge_prompt"),
    ("_canonicalize_sponsor_beneficiary_roles", "prompt"),
    ("_build_dedup_markdown", "technique"),
    ("_build_dedup_markdown", "statement"),
    ("_compact_tables", "return"),
}
DASH_AS_DATA = {
    ("inspire_no_em_dash", "if"),
    ("sanitize_llm_special_chars", "replacements"),
}


def _target(node):
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    if isinstance(node, ast.Subscript):
        key = node.slice.value if isinstance(node.slice, ast.Constant) else ""
        return f"{_target(node.value)}[{key}]"
    return ""


def dash_strings(src):
    tree = ast.parse(src)
    parents = {child: node for node in ast.walk(tree) for child in ast.iter_child_nodes(node)}
    docstrings = set()
    for node in ast.walk(tree):
        if isinstance(node, (ast.Module, ast.ClassDef, ast.FunctionDef, ast.AsyncFunctionDef)) and node.body:
            first = node.body[0]
            if isinstance(first, ast.Expr) and isinstance(first.value, ast.Constant):
                docstrings.add(first.value)
    hits = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Constant) and isinstance(node.value, str)) or node in docstrings or not DASH.search(node.value):
            continue
        cur, statement = node, None
        while cur in parents and not isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef)):
            cur = parents[cur]
            if statement is None and isinstance(cur, ast.stmt):
                statement = cur
        function = cur.name if isinstance(cur, (ast.FunctionDef, ast.AsyncFunctionDef)) else "<module>"
        if isinstance(statement, ast.Assign):
            target = ",".join(_target(t) for t in statement.targets)
        elif isinstance(statement, (ast.AnnAssign, ast.AugAssign)):
            target = _target(statement.target)
        elif isinstance(statement, ast.Return):
            target = "return"
        else:
            target = type(statement).__name__.lower()
        for line in node.value.split("\n"):
            if DASH.search(line):
                hits.append((function, target, node.lineno, line.strip()))
    return hits


def _allowed(hit):
    function, target = hit[0], hit[1]
    return target.startswith(PROMPT_TEMPLATE_PREFIX) or (function, target) in PROMPT_TEXT | DASH_AS_DATA


def test_the_scanner_flags_a_shown_line_and_skips_prompts_docstrings_and_comments():
    src = (
        'PROMPT_TEMPLATES["X_PROMPT"] = """Score it \u2014 strictly"""\n'
        "def run():\n"
        '    """Doc \u2014 not shown."""\n'
        "    # comment \u2014 not shown\n"
        '    log_print(f"Phase done \u2014 {1} left")\n'
        '    label = "1\u20132 days"\n'
    )
    hits = dash_strings(src)
    assert sorted((h[0], h[1]) for h in hits if not _allowed(h)) == [("run", "expr"), ("run", "label")]
    assert [h[1] for h in hits if _allowed(h)] == ['PROMPT_TEMPLATES[X_PROMPT]']


def test_no_agent_message_log_line_or_artifact_text_uses_an_em_or_en_dash():
    hits = dash_strings(agent_source())
    shown = [f"line {h[2]} in {h[0]} ({h[1]}): {h[3][:120]}" for h in hits if not _allowed(h)]
    assert shown == []
    used = {(h[0], h[1]) for h in hits}
    assert PROMPT_TEXT | DASH_AS_DATA <= used, sorted((PROMPT_TEXT | DASH_AS_DATA) - used)
    assert any(h[1].startswith(PROMPT_TEMPLATE_PREFIX) for h in hits)


def test_the_notebook_introduction_uses_no_em_or_en_dash():
    cell_type, text = notebook_cells(AGENT_NB)[0]
    assert cell_type == "markdown"
    assert [line for line in text.split("\n") if DASH.search(line)] == []


def test_the_app_shell_server_strings_use_no_em_or_en_dash():
    files = sorted(glob.glob(os.path.join(SHELL_SERVER, "*.py")))
    assert files
    hits = {os.path.basename(path): dash_strings(open(path, encoding="utf-8").read()) for path in files}
    assert {name: found for name, found in hits.items() if found} == {}
