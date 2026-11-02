"""v1.2.0 LAUNCHER-FIX: marker-first recursion breaker, concurrency parity and an hourly launch cap.

Context. In v0.7 to v0.9 a generated notebook re-fired run_now on its own persistent job every
~30s because the only recursion breaker was getContext().jobId().isDefined() with except -> False;
on Serverless that probe is unreliable, so tens of thousands of runs accumulated. v1.2.0's generated
path is already safe (inspire_execution_gate checks the INSPIRE_CHILD_MARKER run parameter first and
launches with max_concurrent_runs=1, queue=True). The residual was the agent notebook's OWN Job
Launch Gate in main(), which broke recursion only through jobId() and whose launch set neither
max_concurrent_runs nor queue.

The fix, tested here:
  * _should_fire_launcher_gate is marker-first: INSPIRE_CHILD_MARKER=="1" means this IS the job run,
    so the gate never fires regardless of what jobId() reports (fails before, passes after: the
    pre-fix two-argument function raises TypeError on child_marker=).
  * main() reads the marker and the agent's child launch passes the marker plus
    max_concurrent_runs=1, queue=True, matching the generated path.
  * JobLauncher.launch carries an hourly cap backstop (default 20, overridable) around the single
    run_now chokepoint, shared by the agent and every generated notebook that embeds the class.

Runtime paths (dbutils.notebook.entry_point, jobId()) cannot be mocked cleanly, so the pure decision
function is exercised directly, the cap is exercised against a fake WorkspaceClient, and the wiring
is grep-verified against the compiled source.
"""
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import agent_source, load_agent_namespace
from v120_artifacts_support import RunNowApiClient
from v120_modes_main_test import FakeDbutils, widget_values

MARKER = "dbx_inspire_ai_child_run"


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def test_marker_present_never_fires_even_when_jobid_detection_fails(ns):
    f = ns["_should_fire_launcher_gate"]
    assert f(False, "", child_marker="1") is False
    assert f(False, "4242", child_marker="1") is False
    assert f(True, "", child_marker="1") is False
    assert f(False, "", child_marker=" 1 ") is False


def test_genuinely_interactive_context_still_fires_once(ns):
    f = ns["_should_fire_launcher_gate"]
    assert f(False, "", child_marker="") is True
    assert f(False, "4242", child_marker="") is True
    assert f(False, "", child_marker=None) is True
    assert f(False, "", child_marker="0") is True


def test_marker_must_be_exactly_one_to_break_recursion(ns):
    f = ns["_should_fire_launcher_gate"]
    assert f(False, "", child_marker="0") is True
    assert f(False, "", child_marker="true") is True
    assert f(False, "", child_marker="   ") is True
    assert f(False, "4242", child_marker="1") is False


def test_decision_stays_backward_compatible_without_the_marker(ns):
    f = ns["_should_fire_launcher_gate"]
    assert f(True, "4242") is False
    assert f(True, "") is True
    assert f(False, "4242") is True


class _CapJobs:
    def __init__(self, existing_job_id=77, recent_runs=0, list_runs_raises=False):
        self.existing_job_id = existing_job_id
        self.recent_runs = recent_runs
        self.list_runs_raises = list_runs_raises
        self.calls = []

    def list(self, name=None):
        self.calls.append("list")
        if not self.existing_job_id:
            return []
        return [types.SimpleNamespace(job_id=self.existing_job_id,
                                      settings=types.SimpleNamespace(name=name))]

    def get(self, job_id=None):
        return types.SimpleNamespace(settings=types.SimpleNamespace(schedule=None))

    def update(self, job_id=None, new_settings=None):
        self.calls.append("update")

    def create(self, **kwargs):
        self.calls.append("create")
        return types.SimpleNamespace(job_id=501)

    def list_runs(self, job_id=None, start_time_from=None):
        self.calls.append(("list_runs", job_id, start_time_from))
        if self.list_runs_raises:
            raise RuntimeError("list_runs API error")
        return [types.SimpleNamespace(run_id=i) for i in range(self.recent_runs)]

    def run_now(self, **kwargs):
        self.calls.append("run_now")
        return types.SimpleNamespace(run_id=9001)


@pytest.fixture
def cap_sdk(monkeypatch):
    import databricks.sdk as sdk
    import databricks.sdk.service.jobs as jobs_mod
    holder = {}

    class Client:
        def __init__(self, **kw):
            self.jobs = holder["jobs"]
            self.api_client = holder.get("api_client") or RunNowApiClient(holder["jobs"])
            self.config = types.SimpleNamespace(host="https://host.example")

    monkeypatch.setattr(sdk, "WorkspaceClient", Client)
    monkeypatch.setattr(jobs_mod, "CronSchedule", lambda **kw: dict(kw), raising=False)
    monkeypatch.setattr(jobs_mod, "PauseStatus", types.SimpleNamespace(PAUSED="PAUSED"), raising=False)
    monkeypatch.setattr(jobs_mod, "QueueSettings", lambda **kw: dict(kw), raising=False)
    return holder


def _launch(ns, **kw):
    return ns["JobLauncher"]("/Users/a/agent", {"14_session_id": "1"}, {}).launch(
        job_name="dbx_inspire_ai_acme", run_name="dbx_inspire_ai_acme", **kw)


def test_cap_refuses_the_21st_start_within_an_hour(ns, cap_sdk, capsys):
    cap_sdk["jobs"] = jobs = _CapJobs(existing_job_id=77, recent_runs=20)
    result = _launch(ns, run_parameters={MARKER: "1"}, max_concurrent_runs=1, queue=True)
    assert result["success"] is False
    assert "launch cap reached" in result["error"] and "cap 20" in result["error"]
    assert "run_now" not in jobs.calls
    assert "[LAUNCH-CAP FIRED]" in capsys.readouterr().out


def test_cap_allows_the_20th_start(ns, cap_sdk):
    cap_sdk["jobs"] = jobs = _CapJobs(existing_job_id=77, recent_runs=19)
    result = _launch(ns, run_parameters={MARKER: "1"}, max_concurrent_runs=1, queue=True)
    assert result["success"] is True and result["run_id"] == 9001
    assert "run_now" in jobs.calls


@pytest.mark.parametrize("recent", [0, 1, 2, 5])
def test_cap_allows_normal_use_and_a_queued_second_launch(ns, cap_sdk, recent):
    cap_sdk["jobs"] = jobs = _CapJobs(existing_job_id=77, recent_runs=recent)
    result = _launch(ns, run_parameters={MARKER: "1"}, max_concurrent_runs=1, queue=True)
    assert result["success"] is True, recent
    assert "run_now" in jobs.calls


def test_cap_is_overridable_by_an_explicit_launcher_argument(ns, cap_sdk):
    cap_sdk["jobs"] = _CapJobs(existing_job_id=77, recent_runs=5)
    refused = _launch(ns, launch_cap=5)
    assert refused["success"] is False and "cap 5" in refused["error"]
    cap_sdk["jobs"] = jobs = _CapJobs(existing_job_id=77, recent_runs=20)
    allowed = _launch(ns, launch_cap=100)
    assert allowed["success"] is True and "run_now" in jobs.calls


def test_cap_fails_open_when_list_runs_errors(ns, cap_sdk):
    cap_sdk["jobs"] = jobs = _CapJobs(existing_job_id=77, recent_runs=999, list_runs_raises=True)
    result = _launch(ns)
    assert result["success"] is True and "run_now" in jobs.calls


def test_a_brand_new_job_is_never_subjected_to_the_cap(ns, cap_sdk):
    cap_sdk["jobs"] = jobs = _CapJobs(existing_job_id=None, recent_runs=999)
    result = _launch(ns)
    assert result["success"] is True
    assert not any(isinstance(c, tuple) and c[0] == "list_runs" for c in jobs.calls)
    assert "create" in jobs.calls and "run_now" in jobs.calls


def test_only_tasks_reach_run_now_so_a_preview_run_skips_the_alert_task(ns, cap_sdk):
    class Jobs(_CapJobs):
        def run_now(self, **kwargs):
            self.calls.append(("run_now", kwargs))
            return types.SimpleNamespace(run_id=9001)

    cap_sdk["jobs"] = jobs = Jobs(existing_job_id=77)
    assert _launch(ns, run_parameters={MARKER: "1"}, only_tasks=["inspire_task"])["success"] is True
    assert [c[1] for c in jobs.calls if isinstance(c, tuple) and c[0] == "run_now"] == [
        {"job_id": 77, "notebook_params": {MARKER: "1"}, "only": ["inspire_task"]}]
    cap_sdk["jobs"] = jobs = Jobs(existing_job_id=77)
    assert _launch(ns, run_parameters={MARKER: "1"})["success"] is True
    assert [c[1] for c in jobs.calls if isinstance(c, tuple) and c[0] == "run_now"] == [
        {"job_id": 77, "notebook_params": {MARKER: "1"}}]
    cap_sdk["jobs"] = jobs = Jobs(existing_job_id=77)
    assert _launch(ns, only_tasks=["inspire_task"])["success"] is True
    assert [c[1] for c in jobs.calls if isinstance(c, tuple) and c[0] == "run_now"] == [{"job_id": 77, "only": ["inspire_task"]}]
    cap_sdk["jobs"] = jobs = Jobs(existing_job_id=77)
    assert _launch(ns)["success"] is True
    assert [c[1] for c in jobs.calls if isinstance(c, tuple) and c[0] == "run_now"] == [{"job_id": 77}]


def test_a_run_starts_through_the_jobs_api_so_serverless_environment_1_with_sdk_0_20_skips_the_alert_task(ns, cap_sdk):
    class Sdk020Jobs(_CapJobs):
        def run_now(self, job_id=None, dbt_commands=None, idempotency_token=None, jar_params=None, job_parameters=None,
                    notebook_params=None, pipeline_params=None, python_named_params=None, python_params=None, queue=None,
                    spark_submit_params=None, sql_params=None):
            self.calls.append("sdk run_now")
            return types.SimpleNamespace(run_id=1)

    class Api:
        def __init__(self, answer):
            self.answer, self.calls = answer, []

        def do(self, method, path, query=None, headers=None, body=None, raw=False, files=None, data=None, response_headers=None):
            self.calls.append((method, path, body))
            return self.answer

    cap_sdk["jobs"] = jobs = Sdk020Jobs(existing_job_id=77)
    cap_sdk["api_client"] = api = Api({"run_id": 9001, "number_in_job": 9001})
    result = _launch(ns, run_parameters={MARKER: "1"}, only_tasks=["inspire_task"])
    assert result["success"] is True and result["run_id"] == 9001, result
    assert api.calls == [("POST", "/api/2.1/jobs/run-now", {"job_id": 77, "notebook_params": {MARKER: "1"}, "only": ["inspire_task"]})]
    assert "sdk run_now" not in jobs.calls
    assert not result["job_url"] or result["job_url"].split("?")[0].endswith("/jobs/77/runs/9001")
    cap_sdk["api_client"] = Api({})
    refused = _launch(ns, run_parameters={MARKER: "1"})
    assert refused["success"] is False and refused["run_id"] is None
    assert "the Jobs API started no run for job 77" in refused["error"]


def test_recent_run_count_is_bounded_by_the_ceiling(ns):
    launcher = ns["JobLauncher"]("/x", {}, {})
    counter = {"n": 0}

    class _W:
        class jobs:
            @staticmethod
            def list_runs(job_id=None, start_time_from=None):
                while True:
                    counter["n"] += 1
                    if counter["n"] > 1000:
                        raise AssertionError("unbounded scan")
                    yield counter["n"]

    assert launcher._recent_run_count(_W(), 1, window_minutes=60, ceiling=20) == 21
    assert counter["n"] == 21


def test_recent_run_count_fails_open_on_api_error(ns):
    launcher = ns["JobLauncher"]("/x", {}, {})

    class _W:
        class jobs:
            @staticmethod
            def list_runs(job_id=None, start_time_from=None):
                raise RuntimeError("API down")

    assert launcher._recent_run_count(_W(), 1, ceiling=20) is None


class _RecordingLauncher:
    calls = []

    def __init__(self, notebook_path, widget_key_values, job_tags=None):
        self.base = dict(widget_key_values)

    @staticmethod
    def get_current_notebook_path():
        return "/Users/someone/agent/dbx_inspire_ai_agent"

    def launch(self, **kwargs):
        _RecordingLauncher.calls.append({"base": self.base, "kwargs": dict(kwargs)})
        return {"success": False, "error": "offline test: launch disabled"}


def test_agent_child_launch_passes_the_marker_and_the_concurrency_settings(agent_ns, monkeypatch):
    _RecordingLauncher.calls = []

    class _StubInspire:
        def __init__(self, **kw):
            self.final_inspire_results_json = {}

        def run(self):
            return None

        def finalize_atomic_writer(self, success=True, error_message=None):
            return None

        def run_exit_value(self):
            return ""

    monkeypatch.setitem(agent_ns, "dbutils", FakeDbutils(widget_values(**{"14_session_id": ""})))
    monkeypatch.setitem(agent_ns, "_detect_is_job_context", lambda: False)
    monkeypatch.setitem(agent_ns, "JobLauncher", _RecordingLauncher)
    monkeypatch.setitem(agent_ns, "DatabricksInspire", _StubInspire)
    agent_ns["main"]()
    assert len(_RecordingLauncher.calls) == 1
    call = _RecordingLauncher.calls[0]
    assert call["kwargs"]["run_parameters"][MARKER] == "1"
    assert call["kwargs"]["max_concurrent_runs"] == 1
    assert call["kwargs"]["queue"] is True
    assert call["base"][MARKER] == "1"


def _slice(src, start_token, end_token="\ndef "):
    start = src.index(start_token)
    end = src.index(end_token, start + len(start_token))
    return src[start:end]


def test_closing_grep_every_self_launch_decision_is_marker_first_and_bounded():
    src = agent_source()

    decision = _slice(src, "def _should_fire_launcher_gate(")
    assert "child_marker" in decision
    assert decision.index("child_marker") < decision.index("_is_inner_job")
    assert 'str(child_marker or "").strip() == "1"' in decision

    detect = _slice(src, "def _detect_is_job_context():")
    assert "jobId()" in detect
    assert "environ" not in detect and "getenv" not in detect

    gate = src[src.index("def main():"):src.index("End Job Launch Gate")]
    assert "dbutils.widgets.get(INSPIRE_CHILD_MARKER)" in gate
    assert ("_should_fire_launcher_gate(_is_job_context, _raw_session_id_from_widget, "
            "_child_marker_from_widget)") in gate
    assert '_job_widgets[INSPIRE_CHILD_MARKER] = "1"' in gate
    assert ('run_parameters={INSPIRE_CHILD_MARKER: "1"}, max_concurrent_runs=1, queue=True') in gate

    assert "def inspire_execution_gate(" not in src, "the two-cell Genie notebook has no self-launching harness gate"

    assert "run_now(" not in src
    assert src.count('"/api/2.1/jobs/run-now"') == 1
    launch_src = _slice(src, "def launch(self, job_name=None", end_token="\n    def ")
    assert "[LAUNCH-CAP FIRED]" in launch_src
    assert launch_src.index("[LAUNCH-CAP FIRED]") < launch_src.index('"/api/2.1/jobs/run-now"')
    assert "launch_cap=20" in launch_src
