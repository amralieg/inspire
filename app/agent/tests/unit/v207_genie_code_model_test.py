"""Genie Code builds with the first model Unity Gateway serves to the run, checked up front, tells the user when that is not
its first choice, and stops with a plain reason when no model answers; a run with no callable model stops right after the
model check."""
import ast
import logging
import types

import pytest

from _agentload import method_node
from v120_artifacts_support import FakeSpark, make_inspire

REFUSED = RuntimeError("RESOURCE_DOES_NOT_EXIST: model is not served by Unity Gateway for this workspace")
BUSY = TimeoutError("timed out")


class Gateway:
    def __init__(self, slugs, answers):
        self.slugs, self.answers, self.calls = slugs, answers, []

    def do(self, method, path, body=None, query=None):
        self.calls.append((method, path, (body or {}).get("model")))
        if method == "GET":
            return {"models": [{"slug": s} for s in self.slugs]}
        answer = self.answers.get(body["model"], REFUSED)
        if isinstance(answer, BaseException):
            raise answer
        return {"object": "response", "model": body["model"]}

    def checked(self):
        return [model for method, _path, model in self.calls if method == "POST"]


def _inspire(ns, gateway, monkeypatch):
    inst = make_inspire(ns, spark=FakeSpark(), session_id=5150, inspire_database="main.inspire")
    inst.w_client = types.SimpleNamespace(api_client=gateway)
    inst.emitted = []
    inst._emit_pipeline_status = lambda **kw: inst.emitted.append(kw) or len(inst.emitted)
    context = types.SimpleNamespace(apiUrl=lambda: types.SimpleNamespace(get=lambda: "https://ws.example"),
                                    apiToken=lambda: types.SimpleNamespace(get=lambda: "tok"))
    inst.dbutils = types.SimpleNamespace(notebook=types.SimpleNamespace(entry_point=types.SimpleNamespace(
        getDbutils=lambda: types.SimpleNamespace(notebook=lambda: types.SimpleNamespace(getContext=lambda: context)))))
    monkeypatch.setattr(ns["GenieCodeRunner"], "install", lambda self: {"genie": "/g/bin/genie", "machine": "aarch64"})
    return inst


def _genie_steps(inst):
    return [(e["status"], e["message"]) for e in inst.emitted if e["step_name"] == "Genie Code" and e["status"] != "started"]


def test_a_gateway_without_the_first_model_builds_with_the_next_served_model_and_says_so(agent_ns, monkeypatch):
    assert not agent_ns["implement_transient"](REFUSED)
    gateway = Gateway(["system.ai.glm-5-3", "system.ai.kimi-k3"], {"system.ai.glm-5-3": "ok", "system.ai.kimi-k3": "ok"})
    inst = _inspire(agent_ns, gateway, monkeypatch)
    runner = inst._implement_runner("N01-U01")
    first = agent_ns["GENIE_CODE_MODEL"]
    assert runner.model == "system.ai.glm-5-3" and gateway.checked() == [first, "system.ai.glm-5-3"]
    assert 'model = "system.ai.glm-5-3"' in runner.config_toml()
    note = (f"Genie Code built this with system.ai.glm-5-3, because {first}, its first choice, is not served to this run through "
            f"Unity Gateway (")
    assert runner.model_note.startswith(note)
    [(status, message)] = _genie_steps(inst)
    assert status == "ended_warning" and "using the model system.ai.glm-5-3" in message and note in message


def test_the_first_model_is_kept_when_the_gateway_serves_it(agent_ns, monkeypatch):
    first = agent_ns["GENIE_CODE_MODEL"]
    gateway = Gateway(["system.ai.glm-5-3"], {first: "ok", "system.ai.glm-5-3": "ok"})
    inst = _inspire(agent_ns, gateway, monkeypatch)
    runner = inst._implement_runner("N01-U01")
    assert runner.model == first and runner.model_note == "" and gateway.checked() == [first]
    [(status, message)] = _genie_steps(inst)
    assert status == "ended_success" and message.endswith(f"using the model {first}")
    inst._implement_runner("N01-U02")
    assert gateway.checked() == [first]


def test_no_served_model_is_a_plain_stop_that_names_every_model_tried(agent_ns, monkeypatch):
    gateway = Gateway(["system.ai.glm-5-3"], {})
    inst = _inspire(agent_ns, gateway, monkeypatch)
    with pytest.raises(agent_ns["ImplementStopped"]) as stop:
        inst._implement_runner("N01-U01")
    message = str(stop.value)
    assert message.startswith("Genie Code is not available in this workspace: Unity Gateway serves it no AI model this run can call, "
                              "so the build stopped before Genie started and did not retry. Tried 2 models: ")
    assert agent_ns["GENIE_CODE_MODEL"] in message and "system.ai.glm-5-3" in message and message.endswith("then Rebuild.")
    assert agent_ns["implement_known_repair"](stop.value, message) == {"kind": "stop", "why": ""}
    assert _genie_steps(inst) == [("ended_error", message)]
    with pytest.raises(agent_ns["ImplementStopped"]):
        inst._implement_runner("N01-U02")
    assert len(gateway.checked()) == 2


class NotFound(Exception):
    def __init__(self, message, error_code):
        super().__init__(message)
        self.error_code = error_code


ENDPOINT_NOT_FOUND = NotFound("The given endpoint does not exist, please retry after checking the specified model and version "
                              "deployment exists.", "ENDPOINT_NOT_FOUND")


def test_a_workspace_whose_genie_code_endpoint_answers_404_stops_before_genie_with_a_plain_sentence_and_no_retry(agent_ns, monkeypatch):
    assert not agent_ns["implement_transient"](ENDPOINT_NOT_FOUND)
    gateway = Gateway([], {agent_ns["GENIE_CODE_MODEL"]: ENDPOINT_NOT_FOUND})
    inst = _inspire(agent_ns, gateway, monkeypatch)
    monkeypatch.setattr(agent_ns["GenieCodeRunner"], "install", lambda self: pytest.fail("Genie Code never starts"))
    with pytest.raises(agent_ns["ImplementStopped"]) as stop:
        inst._implement_runner("N02-U01")
    assert str(stop.value) == (
        "Genie Code is not available in this workspace: Unity Gateway serves it no AI model this run can call, so the build "
        f"stopped before Genie started and did not retry. Tried 1 model: {agent_ns['GENIE_CODE_MODEL']}: Unity Gateway has no such "
        "model or endpoint here. Ask a workspace admin to serve a model through Unity Gateway and give this run's identity "
        "permission to query it, then Rebuild.")
    assert agent_ns["implement_known_repair"](stop.value, str(stop.value)) == {"kind": "stop", "why": ""}
    assert gateway.checked() == [agent_ns["GENIE_CODE_MODEL"]] and "please retry" not in str(stop.value)


def test_an_output_built_without_a_notebook_rebuild_carries_the_plain_stop_not_an_install_failure():
    source = ast.unparse(method_node("DatabricksInspire", "_implement_one_locked"))
    assert "except ImplementStopped as stop: runner_error = str(stop) except Exception as error: runner_error = " in " ".join(source.split())


def test_a_model_that_only_timed_out_is_used_rather_than_stopping(agent_ns, monkeypatch):
    assert agent_ns["implement_transient"](BUSY)
    first = agent_ns["GENIE_CODE_MODEL"]
    inst = _inspire(agent_ns, Gateway([], {first: BUSY}), monkeypatch)
    assert inst._implement_genie_model() == (first, "")


def test_a_write_conflict_is_still_read_as_transient_from_the_redacted_text_and_a_refusal_is_not(agent_ns):
    transient = agent_ns["implement_transient"]
    ConcurrentAppendException = type("ConcurrentAppendException", (RuntimeError,), {})
    token = "dapi" + "cd" * 16
    assert transient(ConcurrentAppendException(f"Files were added to the root of the table by a concurrent update ({token})"))
    assert transient(RuntimeError(f"[DELTA_CONCURRENT_APPEND] files were added with {token} at https://adb-zqv.example.net"))
    assert transient(RuntimeError("429 Too Many Requests")) and transient(BUSY)
    assert not transient(RuntimeError(f"PERMISSION_DENIED: {token} may not call the model"))
    assert not transient(agent_ns["ImplementBlocked"]("Files were added by a concurrent update"))


def test_served_models_follow_the_roster_family_order_after_the_first_model(agent_ns):
    first = agent_ns["GENIE_CODE_MODEL"]
    slugs = ["system.ai.glm-5-3", "system.ai.gpt-5-6-sol", "system.ai.claude-haiku-4-5", "system.ai.claude-sonnet-4-6",
             "system.ai.claude-sonnet-4-5", "system.ai.glm-5-3"]
    assert agent_ns["genie_code_model_candidates"](slugs) == [
        first, "system.ai.claude-sonnet-4-6", "system.ai.claude-sonnet-4-5", "system.ai.claude-haiku-4-5", "system.ai.glm-5-3"]
    assert agent_ns["genie_code_model_candidates"]([]) == [first]


def test_the_model_note_reaches_the_build_summary_once():
    source = ast.unparse(method_node("DatabricksInspire", "_implement_one_locked"))
    assert "runner = self._implement_runner(uc_id)\n" in source
    assert "model_note = f'Notebook: {runner.model_note}'" in source
    assert "warnings += [model_note] if model_note and model_note not in warnings else []" in source


def _stopping(ns, inspire_database):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    calls = []
    obj.logger = logging.getLogger("v207_stop")
    obj.generate_choices, obj.operation_mode, obj.session_id = ["PDF Catalog"], "Discover Use Cases", 4242
    obj.inspire_database = inspire_database
    obj.no_usable_model = "No AI model can be called from this workspace, so the run stopped before it used any. Tried 1 model"
    for name in ("_ensure_inspire_database_exists", "_create_tracking_table", "_load_feedback", "_attach_ailogs",
                 "_start_live_log_flush_thread"):
        setattr(obj, name, lambda name=name: calls.append(name))
    obj.atomic_writer = types.SimpleNamespace(initialize_session=lambda: calls.append("initialize_session"))
    obj._emit_pipeline_status = lambda **kw: calls.append((kw["step_name"], kw["status"]))
    return obj, calls


def test_a_run_with_no_callable_model_records_the_session_and_stops_before_the_tracking_and_feedback_tables(fresh_ns):
    obj, calls = _stopping(fresh_ns, "main.inspire")
    with pytest.raises(fresh_ns["NoUsableModelError"]):
        obj.run()
    assert calls == ["_ensure_inspire_database_exists", "_attach_ailogs", "_start_live_log_flush_thread", "initialize_session",
                     ("Execution", "started"), ("AI model check", "ended_error")]


def test_a_run_with_a_callable_model_still_sets_up_the_tracking_and_feedback_tables(fresh_ns):
    obj, calls = _stopping(fresh_ns, "main.inspire")
    obj.no_usable_model = ""
    obj._calculate_dynamic_parallelism = lambda *a: pytest.fail("reached past setup")
    obj.auto_parallelism = False
    obj.translation_service = types.SimpleNamespace(get_translations=lambda language: (_ for _ in ()).throw(StopIteration))
    with pytest.raises(Exception):
        obj.run()
    assert calls[:3] == ["_ensure_inspire_database_exists", "_create_tracking_table", "_load_feedback"]


def test_init_skips_the_table_loader_when_no_model_can_be_called():
    source = ast.unparse(method_node("DatabricksInspire", "__init__"))
    probe = source.index("self.no_usable_model = no_usable_model_message()")
    assert probe < source.index("if not self.json_file_path and (not self.no_usable_model):") < source.index("self.data_loader = DataLoader(")
