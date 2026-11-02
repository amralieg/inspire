"""v1.2.0 MODES lane: main() widget validation and launch-gate bookkeeping.

main() runs for real against a fake dbutils, a capturing JobLauncher and a capturing
DatabricksInspire. Covered: canonical and legacy quality values (the canonical value reaches
widget_values, D1-13 source side), the error text for an unknown value (H-18), the launcher_source
tag computed before the session-id widget is cleared (H-10), the single technical exclusion
strategy (H-16), and _running_in_job_context taken from _detect_is_job_context (H-17).
"""
import pytest

from v120_modes_widgets_test import FakeWidgets

LEGACY = {
    "Coverage Mode (All)": "Good",
    "Balanced": "Good",
    "Good Quality": "Good",
    "High Quality": "Good",
    "Strict Quality": "High",
    "Very High Quality": "High",
}


class NotebookExit(Exception):
    pass


class FakeNotebook:
    def exit(self, message):
        raise NotebookExit(message)


class FakeDbutils:
    def __init__(self, values):
        self.widgets = FakeWidgets({name: ("text", value, None) for name, value in values.items()})
        self.notebook = FakeNotebook()


def widget_values(**over):
    values = {
        "15_operation": "Discover Use Cases",
        "00_business_name": "Acme",
        "01_uc_metadata": "main.sales",
        "02_inspire_database": "",
        "04_table_election": "Let Inspire Decides",
        "05_use_cases_quality": "Good",
        "06_business_domains": "",
        "07_business_priorities": "",
        "08_generation_instructions": "",
        "09_generation_options": "PDF Catalog",
        "11_generation_path": "/Workspace/Users/someone/inspire_out",
        "12_documents_languages": "English",
        "13_generate_genie_code_for": "5",
        "14_session_id": "4242",
    }
    values.update(over)
    return values


def run_main(agent_ns, monkeypatch, is_job, **over):
    captured = {"launchers": [], "inspire": []}

    class CapturingLauncher:
        def __init__(self, notebook_path, widget_key_values, job_tags=None):
            captured["launchers"].append({"path": notebook_path, "widgets": dict(widget_key_values),
                                          "tags": dict(job_tags or {})})

        @staticmethod
        def get_current_notebook_path():
            return "/Users/someone/agent/dbx_inspire_ai_agent"

        def launch(self, job_name=None, run_name=None, **kwargs):
            return {"success": False, "error": "offline test: launch disabled"}

    class CapturingInspire:
        def __init__(self, **kwargs):
            captured["inspire"].append(dict(kwargs))
            self.final_inspire_results_json = {}

        def run(self):
            return None

        def finalize_atomic_writer(self, success=True, error_message=None):
            return None

    monkeypatch.setitem(agent_ns, "dbutils", FakeDbutils(widget_values(**over)))
    monkeypatch.setitem(agent_ns, "_detect_is_job_context", lambda: is_job)
    monkeypatch.setitem(agent_ns, "JobLauncher", CapturingLauncher)
    monkeypatch.setitem(agent_ns, "DatabricksInspire", CapturingInspire)
    agent_ns["main"]()
    return captured


@pytest.mark.parametrize("legacy,mapped", sorted(LEGACY.items()))
def test_main_passes_the_canonical_value_for_legacy_labels(agent_ns, monkeypatch, legacy, mapped):
    captured = run_main(agent_ns, monkeypatch, True, **{"05_use_cases_quality": legacy})
    assert captured["inspire"][0]["use_cases_quality"] == mapped


@pytest.mark.parametrize("mode", ["Good", "High", "Ultra High", "ultra high"])
def test_main_accepts_canonical_values(agent_ns, monkeypatch, mode):
    expected = {"Good": "Good", "High": "High", "Ultra High": "Ultra High", "ultra high": "Ultra High"}[mode]
    captured = run_main(agent_ns, monkeypatch, True, **{"05_use_cases_quality": mode})
    assert captured["inspire"][0]["use_cases_quality"] == expected


def test_main_blank_quality_runs_the_default_and_says_so(agent_ns, monkeypatch, capsys):
    captured = run_main(agent_ns, monkeypatch, True, **{"05_use_cases_quality": ""})
    assert captured["inspire"][0]["use_cases_quality"] == "Good"
    assert "Use Cases Quality: Not provided, using the default 'Good'" in capsys.readouterr().out


@pytest.mark.parametrize("value,expected", [("", "0"), ("   ", "0"), ("5", "5"), ("all", "all")])
def test_blank_genie_code_widget_writes_no_instruction_and_an_explicit_value_wins(agent_ns, monkeypatch, value, expected):
    captured = run_main(agent_ns, monkeypatch, True, **{"13_generate_genie_code_for": value})
    assert captured["inspire"][0]["generate_genie_code_for"] == expected


def test_main_unknown_quality_fails_with_valid_options_and_legacy_labels(agent_ns, monkeypatch):
    with pytest.raises(NotebookExit) as exc:
        run_main(agent_ns, monkeypatch, True, **{"05_use_cases_quality": "Premium"})
    message = str(exc.value)
    assert "05_use_cases_quality" in message and "'Premium'" in message
    for mode in ("Good", "High", "Ultra High"):
        assert repr(mode) in message
    for legacy in LEGACY:
        assert repr(legacy) in message


def test_main_passes_the_single_technical_exclusion_strategy(agent_ns, monkeypatch):
    captured = run_main(agent_ns, monkeypatch, True)
    assert captured["inspire"][0]["technical_exclusion_strategy"] == "Aggressive"
    assert captured["inspire"][0]["technical_exclusion_strategy"] == agent_ns["TECHNICAL_EXCLUSION_STRATEGY"]


@pytest.mark.parametrize("is_job,sid,expect_job,expect_user_sid", [
    (True, "4242", True, True),
    (True, "", True, False),
    (False, "", False, False),
    (False, "4242", False, False),
])
def test_running_in_job_context_comes_from_detection_not_sid(agent_ns, monkeypatch, is_job, sid, expect_job,
                                                             expect_user_sid):
    captured = run_main(agent_ns, monkeypatch, is_job, **{"14_session_id": sid})
    kwargs = captured["inspire"][0]
    assert kwargs["_running_in_job_context"] is expect_job
    assert kwargs["_user_provided_session_id"] is expect_user_sid


@pytest.mark.parametrize("sid,source", [("777", "Inspire App"), ("", "Inspire Notebook")])
def test_launcher_source_tag_is_computed_before_the_sid_is_cleared(agent_ns, monkeypatch, sid, source):
    captured = run_main(agent_ns, monkeypatch, False, **{"14_session_id": sid})
    assert len(captured["launchers"]) == 1, "an interactive run fires the launch gate"
    launch = captured["launchers"][0]
    assert launch["tags"]["dbx_inspire_ai_launcher_source"] == source
    assert launch["widgets"]["14_session_id"] == launch["tags"]["dbx_inspire_ai_session_id"] != sid


def test_inner_job_skips_the_gate_and_keeps_the_caller_sid(agent_ns, monkeypatch):
    captured = run_main(agent_ns, monkeypatch, True, **{"14_session_id": "4242"})
    assert captured["launchers"] == []
    assert captured["inspire"][0]["session_id"] == "4242"
