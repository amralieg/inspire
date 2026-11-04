import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import load_agent_namespace  # noqa: E402
from v120_artifacts_support import FakeSpark, make_inspire  # noqa: E402
from v120_genie_support import build_inspire, make_uc  # noqa: E402
from v120_launcher_fix_test import cap_sdk  # noqa: E402,F401
from v120_modes_main_test import FakeDbutils, widget_values  # noqa: E402
from v192_job_asset_tags_test import _launch, _TagJobs  # noqa: E402

TEST_KEY = "dbx_inspire_ai_test"


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _with_test_widget(ns, monkeypatch, value):
    extra = {} if value is None else {TEST_KEY: value}
    monkeypatch.setitem(ns, "dbutils", FakeDbutils(widget_values(**{"14_session_id": ""}, **extra)))


def _launch_gate(ns, monkeypatch, launcher):
    seen = []

    class Recorder(launcher):
        def __init__(self, notebook_path, widget_key_values, job_tags=None):
            seen.append((dict(widget_key_values or {}), dict(job_tags or {})))

        @staticmethod
        def get_current_notebook_path():
            return "/Users/someone/agent/dbx_inspire_ai_agent"

        def launch(self, **kwargs):
            return {"success": False, "error": "offline test: launch disabled"}

    class Stub:
        def __init__(self, **kw):
            self.final_inspire_results_json = {}

        def run(self):
            return None

        def raise_if_empty_discovery(self):
            return None

        def finalize_atomic_writer(self, success=True, error_message=None, failure_kind="error"):
            return None

        def run_exit_value(self):
            return ""

    monkeypatch.setitem(ns, "_detect_is_job_context", lambda: False)
    monkeypatch.setitem(ns, "JobLauncher", Recorder)
    monkeypatch.setitem(ns, "DatabricksInspire", Stub)
    ns["main"]()
    assert len(seen) == 1
    return seen[0]


def test_a_test_run_tags_the_discovery_job_and_passes_the_tag_to_it(ns, monkeypatch):
    launcher = ns["JobLauncher"]
    _with_test_widget(ns, monkeypatch, " inspire rc0 ")
    assert ns["INSPIRE_TEST_TAG"] == TEST_KEY
    assert ns["inspire_run_tags"]() == dict(ns["INSPIRE_VERSION_TAGS"], **{TEST_KEY: "inspire_rc0"})
    widgets, tags = _launch_gate(ns, monkeypatch, launcher)
    assert tags[TEST_KEY] == "inspire_rc0" and tags["dbx_inspire_ai_run_type"] == "discovery"
    assert widgets[TEST_KEY] == "inspire_rc0", "the inner run reads it so the jobs it starts carry it too"


def test_a_test_run_tags_every_implement_job_and_app_through_the_spec_tags(ns, monkeypatch):
    _with_test_widget(ns, monkeypatch, "inspire-rc0")
    spec = build_inspire(ns)._genie_notebook_spec(make_uc())
    assert spec["job_tags"][TEST_KEY] == "inspire-rc0"
    tagger = make_inspire(ns, spark=FakeSpark(), session_id=5150)
    tags = tagger._implement_tags(tagger._genie_notebook_spec(make_uc()), (5150, "N01-U01", 2), "/W/nb")
    assert tags[TEST_KEY] == "inspire-rc0" and tags["dbx_inspire_ai_run_type"] == "implement"
    assert ns["JobLauncher"]("/W/nb", {}, tags).job_tags[TEST_KEY] == "inspire-rc0"


@pytest.mark.parametrize("value", [None, "", "   ", "__"])
def test_a_production_run_carries_no_test_tag(ns, monkeypatch, value):
    launcher = ns["JobLauncher"]
    _with_test_widget(ns, monkeypatch, value)
    assert ns["inspire_run_tags"]() == ns["INSPIRE_VERSION_TAGS"]
    spec = build_inspire(ns)._genie_notebook_spec(make_uc())
    assert TEST_KEY not in spec["job_tags"]
    tagger = make_inspire(ns, spark=FakeSpark(), session_id=5150)
    assert TEST_KEY not in tagger._implement_tags(tagger._genie_notebook_spec(make_uc()), (5150, "N01-U01", 2), "/W/nb")
    widgets, tags = _launch_gate(ns, monkeypatch, launcher)
    assert TEST_KEY not in tags and TEST_KEY not in widgets


def test_the_test_tag_is_never_the_tag_the_job_cap_leaves_off(ns):
    many = {f"dbx_inspire_ai_extra_{n:02d}": "x" for n in range(30)}
    kept = ns["JobLauncher"].merged_tags(dict(many, team="a"), {TEST_KEY: "inspire-rc0", "dbx_inspire_ai_version": "v"})
    assert kept[TEST_KEY] == "inspire-rc0" and len(kept) == ns["JobLauncher"].TAG_LIMIT
    assert ns["JobLauncher"].TAG_PRIORITY[0] == TEST_KEY


def test_asset_tagging_keeps_the_test_tag_a_job_already_has(ns):
    live = {TEST_KEY: "inspire-rc0", "dbx_inspire_ai_assets": "app", "dbx_inspire_ai_app_name": "old"}
    merged = ns["JobLauncher"].merged_tags(live, {"dbx_inspire_ai_assets": "genie"}, replaced=ns["JobLauncher"].ASSET_TAG_KEYS)
    assert merged == {TEST_KEY: "inspire-rc0", "dbx_inspire_ai_assets": "genie"}


def test_a_relaunch_takes_a_test_tag_a_test_run_left_on_the_job_off_it(ns, cap_sdk):
    live = {TEST_KEY: "inspire-rc0", "team": "growth"}
    cap_sdk["jobs"] = jobs = _TagJobs(live)
    assert _launch(ns, {"dbx_inspire_ai_run_type": "discovery"})["success"] is True
    assert jobs.settings[0].tags == {"team": "growth", "dbx_inspire_ai_run_type": "discovery"}
    assert jobs.removed == [["tags"]], "jobs/update merges tags, so the stale tag only goes with fields_to_remove"
    cap_sdk["jobs"] = jobs = _TagJobs(live)
    assert _launch(ns, {"dbx_inspire_ai_run_type": "discovery", TEST_KEY: "inspire-rc1"})["success"] is True
    assert jobs.settings[0].tags == {"team": "growth", "dbx_inspire_ai_run_type": "discovery", TEST_KEY: "inspire-rc1"}
    assert jobs.removed == [None], "nothing is dropped, so the update only adds and changes tags"


def test_the_scheduled_plan_takes_a_stale_test_tag_off_too(ns, cap_sdk):
    cap_sdk["jobs"] = jobs = _TagJobs({TEST_KEY: "inspire-rc0", "dbx_inspire_ai_dashboard_id": "d1"})
    launcher = ns["JobLauncher"]("/Users/a/agent", {"14_session_id": "1"}, {"dbx_inspire_ai_run_type": "analysis"})
    launcher._detect_compute_type = lambda: (True, None)
    assert launcher.plan_next_scheduled_run("dbx_inspire_ai_churn_1a2b3c4d") == 77
    assert jobs.settings[0].tags == {"dbx_inspire_ai_dashboard_id": "d1", "dbx_inspire_ai_run_type": "analysis"}
    assert jobs.removed == [["tags"]]


def test_a_dropped_tag_is_removed_only_through_fields_to_remove(ns):
    drop = ns["JobLauncher"].tag_fields_to_remove
    assert drop({"a": "1", TEST_KEY: "x"}, {"a": "2"}) == ["tags"]
    assert drop({"a": "1"}, {"a": "2", "b": "3"}) is None
    assert drop(None, {"a": "1"}) is None and drop({}, {}) is None
    assert drop({"a": "1"}, {}) == ["tags"]


def test_the_launcher_generated_notebooks_embed_needs_no_agent_helper(ns):
    source = ns["DatabricksInspire"]._JOB_LAUNCHER_CLASS_SOURCE
    assert "inspire_test_tags" not in source and "inspire_run_tags" not in source and f'"{TEST_KEY}"' in source
