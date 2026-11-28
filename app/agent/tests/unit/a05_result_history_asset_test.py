"""D-SIZE2 (REQ-298): the run-side result-history source is the pinned result_history asset, not text in the notebook.

The notebook reads it with the asset loader before it execs it, so the loader runs before inspire_widget (which that source defines)
exists; its assets-folder read then takes the job parameter itself."""
import ast
import importlib.util
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
NOTEBOOK = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
ASSET = os.path.join(ROOT, "agent", "app_shell", "result_history.txt")


def _raw_bindings():
    cell = "".join(json.load(open(NOTEBOOK, encoding="utf-8"))["cells"][1]["source"])
    return [ast.unparse(n.value) for n in ast.parse(cell).body
            if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == "IMPLEMENT_RESULT_HISTORY_SOURCE"]


def test_the_notebook_reads_the_source_from_the_pinned_asset_and_holds_no_copy_of_it(agent_ns):
    assert _raw_bindings() == ["''", "inspire_notebook_asset('result_history')"]
    text = open(ASSET, encoding="utf-8", newline="").read()
    assert agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"] == text == agent_ns["inspire_notebook_asset"]("result_history")
    assert "def inspire_widget(" in text and "def inspire_widget(" not in open(NOTEBOOK, encoding="utf-8").read()
    assert agent_ns["INSPIRE_NOTEBOOK_ASSETS"]["result_history"]["file"] == "notebook/result_history.txt"


def test_no_message_of_the_asset_source_uses_an_em_or_en_dash():
    spec = importlib.util.spec_from_file_location("v201_for_a05", os.path.join(os.path.dirname(__file__), "v201_plain_punctuation_test.py"))
    v201 = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(v201)
    text = open(ASSET, encoding="utf-8").read()
    assert v201.dash_messages(text, "result_history") == []
    assert v201.dash_messages(text + "\nraise ValueError('a — b')\n", "result_history"), "the scan must flag a planted dash"


class _Widgets:
    def __init__(self, values):
        self.values = values

    def get(self, name):
        if name not in self.values:
            raise ValueError(f"no widget {name}")
        return self.values[name]


def test_before_inspire_widget_exists_the_assets_folder_is_the_job_parameter_and_after_it_an_applied_setting_wins(fresh_ns):
    setting = fresh_ns["inspire_assets_path_setting"]
    reader = fresh_ns.pop("inspire_widget")
    fresh_ns["dbutils"] = type("D", (), {"widgets": _Widgets({"inspire_assets_path": " /Workspace/assets/x "})})()
    assert setting() == "/Workspace/assets/x"
    assert fresh_ns["InspireAssets"]().root == "/Workspace/assets/x"
    fresh_ns["dbutils"] = type("D", (), {"widgets": _Widgets({})})()
    assert setting() == ""
    del fresh_ns["dbutils"]
    assert setting() == ""
    fresh_ns["inspire_widget"] = reader
    fresh_ns["dbutils"] = type("D", (), {"widgets": _Widgets({"inspire_assets_path": "/Workspace/assets/job"})})()
    fresh_ns["INSPIRE_SETTINGS_APPLIED"] = {"inspire_assets_path": "/Workspace/assets/applied"}
    assert setting() == "/Workspace/assets/applied"
