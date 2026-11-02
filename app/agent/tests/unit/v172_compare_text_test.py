"""Decision 1B: one comparison everywhere, against the previous run. The App KPI tile and the dashboard counter both say what they
compare with in the one shell_sql text, and no source of the App shell or the notebook carries a period comparison or a second
comparison text, offline."""
import ast
import glob
import os
import re
import sys

TESTS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(TESTS))
SHELL = os.path.join(ROOT, "agent", "app_shell")
SERVER = os.path.join(SHELL, "server")
NOTEBOOK = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_sql  # noqa: E402
from _nbload import code_cells  # noqa: E402

PERIOD = re.compile(r"\b(?:previous|earlier|preceding)\s+period\b|\bthe\s+period\s+before\b", re.I)
SECOND = re.compile(r"\b(?:vs\.?|versus)\s+(?:the\s+)?(?:previous|prior|last|earlier|preceding)\b(?:\s+\w+)?", re.I)


def _shell_sources():
    out = {}
    for pattern in ("server/*.py", "web/src/**/*.js", "web/src/**/*.jsx", "web/src/**/*.json", "*.json"):
        for path in glob.glob(os.path.join(SHELL, pattern), recursive=True):
            with open(path, encoding="utf-8") as handle:
                out[os.path.relpath(path, ROOT)] = handle.read()
    return out


def _notebook_code():
    return "".join(code_cells(NOTEBOOK, strip_magics=False))


def _sources():
    return dict(_shell_sources(), notebook=_notebook_code())


def _python_sources():
    out = {name: text for name, text in _shell_sources().items() if name.endswith(".py")}
    out.update({f"notebook code cell {index}": text for index, text in enumerate(code_cells(NOTEBOOK))})
    return out


def _definitions(sources):
    found = {}
    for name, text in sources.items():
        for node in ast.walk(ast.parse(text)):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                found.setdefault(node.name, []).append(name)
    return found


BUILDERS = ("runs_compare_sql", "run_measure", "previous_run_measure", "change_text_sql", "compare_words")
GONE = ("run_expression", "previous_run_expression", "dataset_at_previous_run", "implement_dataset_at_previous_run",
        "implement_compare_words")


def _hits(pattern, sources):
    return sorted((name, m.group(0)) for name, text in sources.items() for m in pattern.finditer(text))


def test_there_is_one_comparison_text_and_it_names_the_previous_run():
    assert shell_sql.COMPARE_RUN == "vs previous run"
    assert not [name for name in vars(shell_sql) if name.startswith("COMPARE") and name != "COMPARE_RUN"], \
        "shell_sql holds one comparison text"


def test_no_source_says_previous_period_or_names_a_second_comparison():
    sources = _sources()
    assert len(sources) > 10 and "agent/app_shell/server/shell_sql.py" in sources and "agent/app_shell/web/src/Kpis.jsx" in sources
    assert _hits(PERIOD, sources) == [], "the KPI compares with the previous run, never with a period"
    assert _hits(SECOND, sources) == [("agent/app_shell/server/shell_sql.py", shell_sql.COMPARE_RUN)], \
        "the comparison text is written once, in shell_sql, and everyone reads it from there"


def test_the_guard_catches_each_text_it_is_for():
    for text in ("vs previous period", "vs the period before", "on the previous period", "No earlier period to compare",
                 "up 12% on the period before"):
        assert _hits(PERIOD, {"x": text}), text
    for text in ("vs the previous run", "vs previous run", "vs. prior run", "versus the last run", "vs earlier runs"):
        assert _hits(SECOND, {"x": text}), text
    for text in ("No earlier run to compare", "to the entity and period before joining it", "business vs technical",
                 "Forecast Churn' vs 'Predict"):
        assert not _hits(PERIOD, {"x": text}) and not _hits(SECOND, {"x": text}), text


def test_the_app_tile_carries_the_shell_sql_text():
    page = {"kpis": [{"id": "a", "label": "A", "compare": True}, {"id": "b", "label": "B"}], "filters": [], "charts": [], "tables": []}
    assert [k["vs"] for k in shell_core.public_page(page)["kpis"]] == [shell_sql.COMPARE_RUN] * 2
    assert [k["marks"] for k in shell_core.public_page(page)["kpis"]] == [shell_sql.CHANGE_MARKS] * 2, "the tile's marks come from shell_sql too"
    assert [k["words"] for k in shell_core.public_page(page)["kpis"]] == [shell_sql.CHANGE_WORDS] * 2, "and so do its words for no change"
    texts = {}
    for name in ("Kpis.jsx", "format.js", "alerts.js"):
        with open(os.path.join(SHELL, "web", "src", name), encoding="utf-8") as handle:
            texts[name] = handle.read()
    tile = texts["Kpis.jsx"]
    assert "{kpi.vs}" in tile and shell_sql.COMPARE_RUN not in tile, "the tile reads the text the server sends, never its own copy"
    assert not [mark for mark in shell_sql.CHANGE_MARKS.values() if mark in tile] and "kpi.marks[way]" in tile
    assert "changeParts(d, kpi.words)" in tile and "changeParts(d, kpi.words)" in texts["format.js"], "the tile and the story decide a change in one place"
    assert "changeText(d, preview.words)" in texts["alerts.js"] and "{preview.vs}" in texts["alerts.js"], "so does the alert preview"
    assert not [(name, word) for name, text in texts.items() for word in shell_sql.CHANGE_WORDS.values() if f"'{word}'" in text], \
        "the words for no change and a change from 0 come from shell_sql, never a copy in the web"


def test_one_builder_reads_every_run_and_writes_every_change():
    found = _definitions(_python_sources())
    assert {name: found.get(name) for name in BUILDERS} == {name: ["agent/app_shell/server/shell_sql.py"] for name in BUILDERS}, \
        "the previous run is read, and its change written, by one definition each, in shell_sql"
    assert {name: found[name] for name in GONE if name in found} == {}, "no second way to read the previous run is left"
    web = {name: text for name, text in _shell_sources().items() if name.endswith((".js", ".jsx"))}
    for name in ("change", "changeParts", "changeText"):
        defined = [n for n, text in web.items() for _m in re.finditer(rf"\b(?:function\s+{name}\s*\(|const\s+{name}\s*=)", text)]
        assert defined == ["agent/app_shell/web/src/format.js"], (name, defined)


def test_the_builder_guard_catches_a_second_copy():
    second = {"a.py": "def runs_compare_sql(sql, previous_sql):\n    return sql\n",
              "b.py": "def runs_compare_sql(sql, table, columns):\n    return sql\n"}
    assert _definitions(second)["runs_compare_sql"] == ["a.py", "b.py"]
    assert "run_expression" in _definitions({"c.py": "class C:\n    def run_expression(self, e):\n        return e\n"})
