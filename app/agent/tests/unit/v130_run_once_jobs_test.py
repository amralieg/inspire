"""v1.3.0 run once: every serverless job task Inspire creates sets disable_auto_optimization, so the platform does not
rerun a failed Inspire or Genie run.

Serverless jobs retry a failed task by default, up to 3 attempts in all, even with max_retries unset. In the 21 days of
v1.3.0 live runs the platform retried 5 failed Inspire runs and rescued none of them: a Generate failed 3 times under one
session, and a Discover retry ran 48.7 minutes until it was canceled. JobLauncher (the agent's inner job and the Run
controls "As job" path of every Genie notebook) builds its serverless task from a Task subclass whose as_dict adds the
flag, because the SDK of serverless environment 1 (0.20.0, where App runs execute) has no such field. A task on a cluster
keeps the plain SDK Task and the platform's own retry setting.

The real SDK is imported only in a child interpreter. The suite stubs databricks.sdk once per process, and a real SDK left
in sys.modules makes every later test in that worker build real clients and real JobSettings.
"""
import ast
import dataclasses
import json
import os
import subprocess
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import load_agent_namespace
from _nbload import ROOT
from v130_genie_run_controls_test import _notebook, _text

FLAG = "disable_auto_optimization"
AGENT_PATH = "/Workspace/Shared/inspire/dbx_inspire_ai_agent"
GENIE_PATH = "/Workspace/Shared/demos/biz/notebooks/N01-U01 - churn"
JOB = "dbx_inspire_ai_churn_1234abcd"
SERVERLESS = {"serverless": [True, None], "serverless_blank_cluster": [True, ""], "no_compute": [False, ""],
              "no_compute_none": [False, None], "serverless_with_cluster": [True, "0101-abc"]}
CLASSIC = [False, "0101-abc"]

REAL_SDK_SCRIPT = r'''
import contextlib, io, json, sys, types
import databricks.sdk
import databricks.sdk.version
from databricks.sdk.service import jobs as sdk_jobs

payload = json.loads(sys.stdin.read())
computes = payload["computes"]


def load(source, name):
    scope = {"__name__": name}
    exec(compile(source, name, "exec"), scope)
    return scope["JobLauncher"]


def launcher(cls, path, compute):
    inst = cls(path, {"14_session_id": "42", "15_operation": "Discover Use Cases"})
    inst._detect_compute_type = lambda: tuple(compute)
    return inst


class Api:
    def __init__(self, existing=None):
        self.existing, self.calls = existing, []
        self._cfg = types.SimpleNamespace(workspace_id=None)

    def do(self, method, path=None, url=None, query=None, headers=None, body=None, **kwargs):
        self.calls.append([method, path, body])
        if path.endswith("/jobs/list"):
            return {"jobs": [{"job_id": 5, "settings": {"name": self.existing}}] if self.existing else []}
        if path.endswith("/jobs/runs/list"):
            return {"runs": []}
        if path.endswith("/jobs/create"):
            return {"job_id": 5}
        if path.endswith("/jobs/run-now"):
            return {"run_id": 9}
        return {}

    def bodies(self):
        return [[path.rsplit("/", 1)[-1], body] for _m, path, body in self.calls if path.endswith(("/jobs/create", "/jobs/update"))]


def use(api):
    class Client:
        def __init__(self, *a, **k):
            self.api_client = api
            self.jobs = sdk_jobs.JobsAPI(api)
            self.config = types.SimpleNamespace(host="https://host")
    databricks.sdk.WorkspaceClient = Client
    return api


def task(cls, path, compute, params):
    built = launcher(cls, path, compute)._task(params)
    return {"body": built.as_dict(), "sdk_task": isinstance(built, sdk_jobs.Task), "plain_sdk_task": type(built) is sdk_jobs.Task}


out = {"sdk": databricks.sdk.version.__version__}
with contextlib.redirect_stdout(io.StringIO()):
    agent = load(payload["launcher"], "job_launcher")
    out["tasks"] = {name: task(agent, payload["agent_path"], compute, {"14_session_id": "42"}) for name, compute in computes.items()}
    out["launch"] = {}
    for name, existing, compute in (("create", None, computes["serverless"]), ("update", payload["job"], computes["serverless"]),
                                    ("classic", None, computes["classic"])):
        api = use(Api(existing))
        result = launcher(agent, payload["agent_path"], compute).launch(job_name=payload["job"], run_name="churn", max_concurrent_runs=1, queue=True)
        out["launch"][name] = {"success": result.get("success"), "run_id": result.get("run_id"), "error": result.get("error"), "bodies": api.bodies()}
    api = use(Api(payload["job"]))
    out["plan"] = {"job_id": launcher(agent, payload["agent_path"], computes["serverless"]).plan_next_scheduled_run(payload["job"]),
                   "bodies": api.bodies()}
    controls = load(payload["controls"], "run_controls")
    out["controls"] = {name: task(controls, payload["genie_path"], computes[name], {"result_table": "main.inspire.out"})
                       for name in ("serverless", "classic")}
print(json.dumps(out))
'''


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


@pytest.fixture(scope="module")
def real_sdk(agent_ns):
    _inst, _uc, nb = _notebook(agent_ns)
    definitions = _text(nb["cells"][-1]).rstrip().rsplit("\n", 1)[0]
    payload = {"launcher": agent_ns["DatabricksInspire"]._JOB_LAUNCHER_CLASS_SOURCE, "controls": definitions,
               "agent_path": AGENT_PATH, "genie_path": GENIE_PATH, "job": JOB, "computes": {**SERVERLESS, "classic": CLASSIC}}
    done = subprocess.run([sys.executable, "-c", REAL_SDK_SCRIPT], input=json.dumps(payload), capture_output=True, text=True, timeout=300)
    assert done.returncode == 0, done.stderr[-4000:]
    return json.loads(done.stdout)


def _launcher(ns, compute):
    launcher = ns["JobLauncher"](AGENT_PATH, {"14_session_id": "42", "15_operation": "Discover Use Cases"})
    launcher._detect_compute_type = lambda: compute
    return launcher


def test_a_serverless_task_runs_once_and_keeps_every_other_setting(real_sdk):
    for name in SERVERLESS:
        task = real_sdk["tasks"][name]
        assert task["sdk_task"] and not task["plain_sdk_task"], (name, real_sdk["sdk"])
        assert task["body"] == {"task_key": "inspire_task", "timeout_seconds": 14400, FLAG: True,
                                "notebook_task": {"notebook_path": AGENT_PATH, "base_parameters": {"14_session_id": "42"}}}, name


def test_a_task_on_a_cluster_keeps_the_cluster_and_the_platform_default(real_sdk):
    task = real_sdk["tasks"]["classic"]
    assert task["plain_sdk_task"], real_sdk["sdk"]
    assert task["body"] == {"task_key": "inspire_task", "timeout_seconds": 14400, "existing_cluster_id": "0101-abc",
                            "notebook_task": {"notebook_path": AGENT_PATH, "base_parameters": {"14_session_id": "42"}}}


def test_the_jobs_api_create_and_update_bodies_carry_the_flag_on_serverless(real_sdk):
    launch = real_sdk["launch"]
    for name in ("create", "update", "classic"):
        assert launch[name]["success"] is True and launch[name]["run_id"] == 9, (name, launch[name]["error"])
    [[kind, create]] = launch["create"]["bodies"]
    assert kind == "create" and create["tasks"][0][FLAG] is True
    assert create["max_concurrent_runs"] == 1 and create["queue"] == {"enabled": True}
    [[kind, update]] = launch["update"]["bodies"]
    assert kind == "update" and update["job_id"] == 5
    assert update["new_settings"]["tasks"][0][FLAG] is True
    [[kind, classic]] = launch["classic"]["bodies"]
    assert kind == "create" and FLAG not in classic["tasks"][0]
    assert classic["tasks"][0]["existing_cluster_id"] == "0101-abc"


def test_the_scheduled_run_plan_keeps_the_task_running_once(real_sdk):
    assert real_sdk["plan"]["job_id"] == 5
    [[kind, update]] = real_sdk["plan"]["bodies"]
    assert kind == "update" and update["new_settings"]["tasks"][0][FLAG] is True


@dataclasses.dataclass
class _Sdk020NotebookTask:
    notebook_path: str
    base_parameters: dict = None

    def as_dict(self):
        body = {"notebook_path": self.notebook_path}
        if self.base_parameters:
            body["base_parameters"] = self.base_parameters
        return body


@dataclasses.dataclass
class _Sdk020Task:
    task_key: str
    existing_cluster_id: str = None
    notebook_task: _Sdk020NotebookTask = None
    timeout_seconds: int = None

    def as_dict(self):
        body = {"task_key": self.task_key}
        if self.existing_cluster_id is not None:
            body["existing_cluster_id"] = self.existing_cluster_id
        if self.notebook_task:
            body["notebook_task"] = self.notebook_task.as_dict()
        if self.timeout_seconds is not None:
            body["timeout_seconds"] = self.timeout_seconds
        return body


def test_an_sdk_without_the_field_still_sends_it(ns, monkeypatch):
    old = types.ModuleType("databricks.sdk.service.jobs")
    old.Task, old.NotebookTask = _Sdk020Task, _Sdk020NotebookTask
    monkeypatch.setattr(sys.modules["databricks.sdk.service"], "jobs", old)
    monkeypatch.setitem(sys.modules, "databricks.sdk.service.jobs", old)
    assert FLAG not in {f.name for f in dataclasses.fields(_Sdk020Task)}
    serverless = _launcher(ns, (True, None))._task({"14_session_id": "42"})
    assert isinstance(serverless, _Sdk020Task)
    assert serverless.as_dict()[FLAG] is True
    assert serverless.as_dict()["timeout_seconds"] == 14400
    classic = _launcher(ns, (False, "0101-abc"))._task({"14_session_id": "42"})
    assert type(classic) is _Sdk020Task
    assert classic.as_dict() == {"task_key": "inspire_task", "existing_cluster_id": "0101-abc", "timeout_seconds": 14400,
                                 "notebook_task": {"notebook_path": AGENT_PATH, "base_parameters": {"14_session_id": "42"}}}


def test_the_run_once_class_adds_only_the_flag(ns):
    run_once = ns["JobLauncher"]._run_once_task_class(_Sdk020Task)
    assert issubclass(run_once, _Sdk020Task)
    task = run_once(task_key="k", timeout_seconds=5)
    assert task.as_dict() == {"task_key": "k", "timeout_seconds": 5, FLAG: True}
    assert _Sdk020Task(task_key="k", timeout_seconds=5).as_dict() == {"task_key": "k", "timeout_seconds": 5}


def test_every_genie_notebook_run_controls_cell_launches_its_job_run_once(real_sdk, agent_ns):
    serverless, classic = real_sdk["controls"]["serverless"], real_sdk["controls"]["classic"]
    assert serverless["sdk_task"] and serverless["body"][FLAG] is True
    assert serverless["body"]["notebook_task"] == {"notebook_path": GENIE_PATH, "base_parameters": {"result_table": "main.inspire.out"}}
    assert classic["plain_sdk_task"] and FLAG not in classic["body"]
    source = agent_ns["DatabricksInspire"]._JOB_LAUNCHER_CLASS_SOURCE
    assert source.count("def _run_once_task_class(") == 1
    assert source.count("self._task(") == 2
    assert source.count("_jl_jobs.Task(") == 0


def _import_time_sdk_imports(source):
    def names(node):
        if isinstance(node, ast.Import):
            return [alias.name for alias in node.names]
        if isinstance(node, ast.ImportFrom):
            return [node.module or ""]
        if isinstance(node, ast.Call) and node.args and isinstance(node.args[0], ast.Constant) and isinstance(node.args[0].value, str):
            func = node.func
            called = func.attr if isinstance(func, ast.Attribute) else getattr(func, "id", "")
            return [node.args[0].value] if called in ("import_module", "__import__") else []
        return []

    def walk(nodes):
        for node in nodes:
            if any(n == "databricks" or n.startswith("databricks.") for n in names(node)):
                yield node.lineno
            if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
                yield from walk(ast.iter_child_nodes(node))

    return list(walk(ast.parse(source).body))


def test_no_test_module_imports_the_databricks_sdk_when_it_is_imported():
    assert _import_time_sdk_imports("import databricks.sdk\n") == [1]
    assert _import_time_sdk_imports("import os\nfrom databricks.sdk.service import jobs\n") == [2]
    assert _import_time_sdk_imports("try:\n    import databricks\nexcept ImportError:\n    pass\n") == [2]
    assert _import_time_sdk_imports("class Fake:\n    from databricks import sdk\n") == [2]
    assert _import_time_sdk_imports("import importlib\nsdk = importlib.import_module('databricks.sdk')\n") == [2]
    assert _import_time_sdk_imports("def fixture():\n    import databricks.sdk\n") == []
    assert _import_time_sdk_imports("class Fake:\n    def make(self):\n        from databricks.sdk.service import jobs\n") == []
    assert _import_time_sdk_imports("import databricks_cli\nimport os\n") == []
    offenders = []
    for folder in (os.path.join(ROOT, "tests"), os.path.join(ROOT, "tests", "unit")):
        for name in sorted(os.listdir(folder)):
            if name.endswith(".py"):
                with open(os.path.join(folder, name), encoding="utf-8") as handle:
                    offenders += [f"{os.path.relpath(os.path.join(folder, name), ROOT)}:{line}" for line in _import_time_sdk_imports(handle.read())]
    assert offenders == []
