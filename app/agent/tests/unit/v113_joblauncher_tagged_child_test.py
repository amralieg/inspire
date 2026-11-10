"""v1.1.3 tagged child job, carried into the v1.2.0 GENIE-REDESIGN launcher.

The v1.1.3 contract that stays: the dbx_inspire_ai_child_run marker breaks recursion, the six
dbx_inspire_ai_* tag keys land on the job at launch time (run tags are immutable after start), no
launch or verify error is swallowed, and the broken "retag the running run" API surface is gone.

What v1.2.0 GENIE-REDESIGN changes, and why these tests changed with it (review GX-1, GX-2, GX-3,
GX-20, GX-21): the child used to receive only the marker, so every widget (run mode, both data
sources) fell back to its default and "Inference" retrained; the child deleted its own job in a
finally block, erasing the run history; the parent pinged ten times and printed "launched" as if it
were a result; and a failed child was re-run in place by the parent. The launcher is now one
function of the shared Inspire harness (`inspire_execution_gate`) driving a persistent per-notebook
job, so the round trips below exercise that function with fakes for dbutils and JobLauncher.
"""
import os
import re
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import agent_source, agent_version, load_agent_namespace
from v120_artifacts_support import RunNowApiClient
from v120_genie_support import build_inspire, make_uc

SENTINEL_WIDGET = "dbx_inspire_ai_child_run"

EXPECTED_TAG_KEYS = (
    "dbx_inspire_ai_business",
    "dbx_inspire_ai_run_type",
    "dbx_inspire_ai_usecase",
    "dbx_inspire_ai_notebook",
    "dbx_inspire_ai_session_id",
    "dbx_inspire_ai_launcher_source",
)

NB_PATH = "/Users/someone@example.com/inspire/notebooks/Sales/Retention/N01-U01 - churn"
FILLED_SOURCE = ("# Databricks notebook source\n# COMMAND ----------\n# DBTITLE 1,3a. GENIE SLOT: readiness queries\n"
                 "# GENIE SLOT: readiness queries.\ndef measure_readiness(ctx):\n    return {}\n")
UNFILLED_SOURCE = FILLED_SOURCE + ("# COMMAND ----------\n# DBTITLE 1,4. GENIE SLOT: inputs and outcome\n# GENIE SLOT: inputs and outcome.\n"
                                   "def build_inputs(ctx, as_of_dates, scoring=False):\n    raise InspireSlotNotFilled(\"build_inputs\")\n"
                                   "# COMMAND ----------\n# DBTITLE 1,Inspire harness (do not edit)\n"
                                   "def collect_slots(namespace, family):\n    raise InspireSlotNotFilled(\"fit_candidates\")\n")


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


class _Exit(Exception):
    pass


class FakeDbutils:
    def __init__(self, values):
        values = dict(values)
        exits = self.exits = []

        class _Widgets:
            @staticmethod
            def get(name):
                if name not in values:
                    raise ValueError(f"InputWidgetNotDefined: {name}")
                return values[name]

        class _Notebook:
            @staticmethod
            def exit(message):
                exits.append(message)
                raise _Exit(message)

        self.widgets = _Widgets()
        self.notebook = _Notebook()


def fake_launcher(ns, ledger, launch_result=None, outcome=None, nb_path=NB_PATH):
    real = ns["JobLauncher"]

    class FakeLauncher:
        def __init__(self, notebook_path, widget_key_values, job_tags=None):
            ledger.setdefault("constructed", []).append({"path": notebook_path, "base": dict(widget_key_values), "tags": dict(job_tags or {})})
            self.base, self.tags = dict(widget_key_values), dict(job_tags or {})

        get_current_notebook_path = staticmethod(lambda: nb_path)
        _sanitize_tag = staticmethod(real._sanitize_tag)
        persistent_job_name = staticmethod(real.persistent_job_name)

        def launch(self, **kwargs):
            ledger.setdefault("launches", []).append(dict(kwargs, base=self.base, tags=self.tags))
            return dict(launch_result or {"success": True, "job_id": 11, "run_id": 42, "job_url": "https://host/jobs/11/runs/42"})

        def wait_for_run(self, run_id, timeout_s=1800, poll_s=15, out=print):
            ledger.setdefault("waits", []).append({"run_id": run_id, "timeout_s": timeout_s})
            return dict(outcome or {"status": "SUCCESS", "output": '{"contract": "PASSED"}'})

    return FakeLauncher


def _ctx(ns, technique="Classification", widgets=None):
    inst = build_inspire(ns)
    spec = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": technique}))
    values = {w[1]: w[2] for w in spec["widgets"]}
    values.update(widgets or {})
    return ns["build_run_context"](spec, values), values


def _run_gate(ns, ctx, values, ledger, **kw):
    dbu = FakeDbutils(values)
    out = []
    try:
        result = ns["inspire_execution_gate"](ctx, resolver=kw.pop("resolver", lambda c: {"action": "score", "reason": "test"}),
                                              dbutils_obj=dbu, launcher_cls=fake_launcher(ns, ledger, **kw), out=out.append,
                                              source_fn=lambda: FILLED_SOURCE)
    except _Exit:
        result = "exited"
    return result, dbu, out


def test_D_update_job_tags_method_deleted():
    src = agent_source()
    assert "def update_job_tags" not in src
    assert "_w.jobs.update(" not in src
    assert "JobLauncher.update_job_tags(" not in src
    assert "/api/2.1/jobs/update" not in src


def test_D_jobs_update_only_updates_the_persistent_job_never_the_running_run(ns):
    cls_src = ns["DatabricksInspire"]._JOB_LAUNCHER_CLASS_SOURCE
    assert re.search(r"w\.jobs\.update\(\s*job_id\s*=\s*_existing_job_id", cls_src)
    methods = re.split(r"\n    def ", cls_src)
    updating = sorted(m.split("(")[0] for m in methods[1:] if "jobs.update(" in m)
    assert updating == ["launch", "plan_next_scheduled_run"]
    assert "jobs.delete" not in agent_source() and "def cleanup_job" not in cls_src


def test_D_agent_version_at_least_v120():
    version = agent_version()
    parts = tuple(int(p) for p in version[1:].split("."))
    assert len(parts) == 3 and all(0 <= p <= 9 for p in parts), version
    assert parts >= (1, 2, 0), version
    assert '__AGENT_VERSION__ = "v1.1.3"' not in agent_source()


def test_J_two_notebook_paths_with_the_same_use_case_name_get_different_jobs(ns):
    name = ns["JobLauncher"].persistent_job_name
    a = name("churn risk", "/Users/a@x.com/out/N01-U01 - churn risk")
    b = name("churn risk", "/Users/b@x.com/out/N01-U01 - churn risk")
    assert a != b and a.startswith("dbx_inspire_ai_churn_risk_") and b.startswith("dbx_inspire_ai_churn_risk_")
    assert a == name("churn risk", "/Users/a@x.com/out/N01-U01 - churn risk")


class _Jobs:
    def __init__(self, existing=None, states=None, output=None, schedule=None):
        self.calls = []
        self.existing = existing
        self.states = list(states or [])
        self.output = output or types.SimpleNamespace(notebook_output=types.SimpleNamespace(result="done"), error=None, error_trace=None)
        self.schedule = schedule

    def list(self, name=None):
        self.calls.append(("list", {"name": name}))
        return [types.SimpleNamespace(job_id=self.existing, settings=types.SimpleNamespace(name=name))] if self.existing else []

    def get(self, job_id=None):
        self.calls.append(("get", {"job_id": job_id}))
        return types.SimpleNamespace(settings=types.SimpleNamespace(schedule=self.schedule))

    def update(self, job_id=None, new_settings=None, fields_to_remove=None):
        self.calls.append(("update", {"job_id": job_id, "settings": vars(new_settings)}))

    def create(self, **kwargs):
        self.calls.append(("create", kwargs))
        return types.SimpleNamespace(job_id=501)

    def run_now(self, **kwargs):
        self.calls.append(("run_now", kwargs))
        return types.SimpleNamespace(run_id=9001)

    def get_run(self, run_id=None):
        life, result, message = self.states.pop(0) if len(self.states) > 1 else self.states[0]
        return types.SimpleNamespace(state=types.SimpleNamespace(life_cycle_state=life, result_state=result, state_message=message),
                                     tasks=[types.SimpleNamespace(run_id=run_id + 1)], run_id=run_id)

    def get_run_output(self, run_id=None):
        self.calls.append(("get_run_output", {"run_id": run_id}))
        return self.output


@pytest.fixture
def fake_sdk(monkeypatch):
    import databricks.sdk as sdk
    import databricks.sdk.service.jobs as jobs_mod
    holder = {}

    class Client:
        def __init__(self, **kw):
            self.jobs = holder["jobs"]
            self.api_client = RunNowApiClient(holder["jobs"])
            self.config = types.SimpleNamespace(host="https://host.example")

    monkeypatch.setattr(sdk, "WorkspaceClient", Client)
    monkeypatch.setattr(jobs_mod, "CronSchedule", lambda **kw: dict(kw), raising=False)
    monkeypatch.setattr(jobs_mod, "PauseStatus", types.SimpleNamespace(PAUSED="PAUSED"), raising=False)
    monkeypatch.setattr(jobs_mod, "QueueSettings", lambda **kw: dict(kw), raising=False)
    return holder


def test_L_inspire_main_launch_gate_makes_the_same_sdk_calls_as_v113(ns, fake_sdk):
    fake_sdk["jobs"] = _Jobs()
    result = ns["JobLauncher"]("/Users/a/agent", {"00_business_name": "acme", "14_session_id": "77"}, {"dbx_inspire_ai_business": "acme"}).launch(
        job_name="dbx_inspire_ai_acme", run_name="dbx_inspire_ai_acme")
    assert result["success"] is True and result["run_id"] == 9001
    kinds = [c[0] for c in fake_sdk["jobs"].calls]
    assert kinds == ["list", "create", "run_now"]
    create = fake_sdk["jobs"].calls[1][1]
    assert set(create) == {"name", "tags", "tasks", "timeout_seconds"} and create["tasks"][0].notebook_task.base_parameters == {"00_business_name": "acme", "14_session_id": "77"}
    assert fake_sdk["jobs"].calls[2][1] == {"job_id": 501}
    fake_sdk["jobs"] = _Jobs(existing=12)
    ns["JobLauncher"]("/Users/a/agent", {"00_business_name": "acme"}, {}).launch(job_name="dbx_inspire_ai_acme", run_name="dbx_inspire_ai_acme")
    update = next(c for c in fake_sdk["jobs"].calls if c[0] == "update")[1]
    assert set(update["settings"]) == {"name", "tags", "tasks", "timeout_seconds"} and update["job_id"] == 12
    main_src = agent_source()[agent_source().index("def main():"):]
    assert "_launcher = JobLauncher(_nb_path, _job_widgets, _job_tags)" in main_src
    assert ('_launcher.launch(job_name=_job_name, run_name=_job_name, '
            'run_parameters={INSPIRE_CHILD_MARKER: "1"}, max_concurrent_runs=1, queue=True)') in main_src
    assert "_launcher.verify_run_alive(_run_id, pings=10, interval_s=10)" in main_src


def test_M_genie_job_is_persistent_queued_paused_and_receives_per_run_parameters(ns, fake_sdk):
    fake_sdk["jobs"] = _Jobs()
    launcher = ns["JobLauncher"]("/Users/a/nb", {SENTINEL_WIDGET: "1", "run_mode": "Auto"}, {"dbx_inspire_ai_run_type": "training"})
    launcher.launch(job_name="dbx_inspire_ai_x_1234abcd", run_name="dbx_inspire_ai_x_1234abcd", run_parameters={"run_mode": "Retrain", SENTINEL_WIDGET: "1"},
                    max_concurrent_runs=1, queue=True, schedule_cron="0 0 6 ? * MON")
    create = next(c for c in fake_sdk["jobs"].calls if c[0] == "create")[1]
    assert create["max_concurrent_runs"] == 1 and create["queue"] == {"enabled": True}
    assert create["schedule"] == {"quartz_cron_expression": "0 0 6 ? * MON", "timezone_id": "UTC", "pause_status": "PAUSED"}
    run_now = next(c for c in fake_sdk["jobs"].calls if c[0] == "run_now")[1]
    assert run_now["notebook_params"] == {"run_mode": "Retrain", SENTINEL_WIDGET: "1"}
    fake_sdk["jobs"] = _Jobs(existing=33, schedule={"quartz_cron_expression": "0 0 9 * * ?", "pause_status": "UNPAUSED"})
    launcher.launch(job_name="dbx_inspire_ai_x_1234abcd", run_parameters={"run_mode": "Score"}, max_concurrent_runs=1, queue=True, schedule_cron="0 0 6 ? * MON")
    update = next(c for c in fake_sdk["jobs"].calls if c[0] == "update")[1]
    assert "schedule" not in update["settings"], "an existing (possibly unpaused) schedule chosen by the user is never overwritten"
    assert not any(c[0] in ("delete", "cancel_run") for c in fake_sdk["jobs"].calls)


def test_N_wait_for_run_reports_success_failure_and_still_running(ns, fake_sdk, monkeypatch):
    import time
    monkeypatch.setattr(time, "sleep", lambda s: None)
    launcher = ns["JobLauncher"]("/Users/a/nb", {}, {})
    fake_sdk["jobs"] = _Jobs(states=[("PENDING", None, ""), ("RUNNING", None, ""), ("TERMINATED", "SUCCESS", "")])
    lines = []
    assert launcher.wait_for_run(9001, timeout_s=60, poll_s=0, out=lines.append) == {"status": "SUCCESS", "output": "done"}
    assert len(lines) == 3
    failure = types.SimpleNamespace(notebook_output=None, error="ValueError: bad join", error_trace="Traceback ... ValueError: bad join")
    fake_sdk["jobs"] = _Jobs(states=[("TERMINATED", "FAILED", "Task failed")], output=failure)
    outcome = launcher.wait_for_run(9001, timeout_s=60, poll_s=0, out=lambda *_: None)
    assert outcome["status"] == "FAILED" and "Task failed" in outcome["error"] and "ValueError: bad join" in outcome["error"]
    fake_sdk["jobs"] = _Jobs(states=[("RUNNING", None, "")])
    assert launcher.wait_for_run(9001, timeout_s=0, poll_s=0, out=lambda *_: None)["status"] == "RUNNING"


