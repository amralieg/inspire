import ast
import glob
import os
import re

from _agentload import agent_source
from _nbload import AGENT_NB, notebook_cells

DASH = re.compile("[\u2013\u2014]|&[mn]dash;|&#821[12];")
SHELL_SERVER = os.path.join(os.path.dirname(os.path.abspath(AGENT_NB)), "app_shell", "server")
APP = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(AGENT_NB))))
REPO = os.path.dirname(APP)
AGENT_INSTRUCTION_FILES = {"app/docs/CLAUDE.md"}
INSTALLER_SOURCES = ["inspire_installer.py", "app/installer/inspire_setup.py", "app/installer/release.py"]


def _docs():
    found = ["README.md", "app/README.md", "app/agent/readme.md"]
    for folder in ("app/docs", "app/agent/docs"):
        found += sorted(os.path.relpath(p, REPO) for p in glob.glob(os.path.join(REPO, folder, "*.md")))
    return [rel for rel in found if rel not in AGENT_INSTRUCTION_FILES]


def heading_slug(text):
    text = re.sub(r"<[^>]+>", "", text).strip().lower()
    return re.sub(r"[^\w\- ]", "", text).replace(" ", "-")


def heading_anchors(markdown):
    anchors, seen, fence = set(), {}, False
    for line in markdown.split("\n"):
        if line.lstrip().startswith("```"):
            fence = not fence
            continue
        match = re.match(r"^#{1,6} (.*)$", line)
        if match and not fence:
            base = heading_slug(match.group(1))
            anchors.add(base if base not in seen else f"{base}-{seen[base]}")
            seen[base] = seen.get(base, 0) + 1
    return anchors
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


def test_the_installer_output_and_its_offline_page_use_no_em_or_en_dash():
    hits = {rel: dash_strings(open(os.path.join(REPO, rel), encoding="utf-8").read()) for rel in INSTALLER_SOURCES}
    assert {rel: found for rel, found in hits.items() if found} == {}


def test_the_readmes_and_docs_people_read_use_no_em_or_en_dash():
    docs = _docs()
    assert {"app/agent/docs/design-guide.md", "app/agent/docs/integration-guide.md", "app/docs/AUTH_AND_UC_ARCHITECTURE.md"} <= set(docs)
    assert all(os.path.isfile(os.path.join(REPO, rel)) for rel in AGENT_INSTRUCTION_FILES)
    hits = []
    for rel in docs:
        for n, line in enumerate(open(os.path.join(REPO, rel), encoding="utf-8").read().split("\n"), 1):
            if DASH.search(line):
                hits.append(f"{rel}:{n}: {line.strip()[:120]}")
    assert hits == []


def test_every_in_page_link_in_the_docs_lands_on_a_heading():
    assert heading_anchors("# Release Notes: v0.7.3\n```\n# not a heading\n```\n## Tier 1: Grounding (D1-D11)\n## Tier 1: Grounding (D1-D11)") == {
        "release-notes-v073", "tier-1-grounding-d1-d11", "tier-1-grounding-d1-d11-1"}
    broken = []
    for rel in _docs():
        text = open(os.path.join(REPO, rel), encoding="utf-8").read()
        anchors = heading_anchors(text)
        broken += [f"{rel}: #{link}" for link in re.findall(r"\]\(#([^)\s]+)\)", text) if link not in anchors]
    assert broken == []
