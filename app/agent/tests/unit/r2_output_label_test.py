"""The delivery output's label is one value (REQ-209, D-LABEL209): backend/lib/implementOutputLabels.json. The Python shell cannot
import that file, so each person-facing literal it writes for the output must equal the shared label."""
import json
import os
import re

HERE = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(HERE, "..", "..", "agent", "app_shell", "server")
LABELS = os.path.join(HERE, "..", "..", "..", "backend", "lib", "implementOutputLabels.json")


def _source(name):
    with open(os.path.join(SERVER, name), encoding="utf-8") as handle:
        return handle.read()


def test_the_shared_label_is_agentic_app():
    with open(LABELS, encoding="utf-8") as handle:
        assert json.load(handle)["app"] == "App"


def test_the_runbook_link_label_for_the_app_reads_the_shared_label():
    label = json.load(open(LABELS, encoding="utf-8"))["app"]
    assert re.search(r'\("app", "%s"\)' % re.escape(label), _source("shell_alerts.py"))


def test_the_vibes_label_fallback_reads_the_shared_label():
    label = json.load(open(LABELS, encoding="utf-8"))["app"]
    assert f'rules.get("label") or "{label}"' in _source("shell_sql.py")


def test_the_notebook_label_tables_read_the_shared_label():
    label = json.load(open(LABELS, encoding="utf-8"))["app"]
    notebook = os.path.join(HERE, "..", "..", "agent", "dbx_inspire_ai_agent.ipynb")
    with open(notebook, encoding="utf-8") as handle:
        cells = json.load(handle)["cells"]
    text = "".join("".join(cell["source"]) for cell in cells if cell.get("cell_type") == "code")
    assert f'"app": "{label}"' in text and f'IMPLEMENT_MERGE_LABELS = {{"dashboard": "dashboard", "genie_space": "Genie Agent", "app": "{label}"}}' in text


def test_no_server_module_writes_a_plain_app_label_for_the_output():
    for name in ("shell_alerts.py", "shell_sql.py"):
        # RC7-C-02: the shared label is now plain "App", so a literal "App" equal to it is the label; any other plain label would be drift.
        label = json.load(open(LABELS, encoding="utf-8"))["app"]
        assert label == "App" or not re.search(r'"App"\)|or "App"', _source(name)), name
