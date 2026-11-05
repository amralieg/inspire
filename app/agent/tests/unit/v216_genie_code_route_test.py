"""Genie Code finds a Unity Gateway route before a build: the Codex route's models first, then the Claude models the Anthropic
route lists, called through the MLflow responses path with web search off and the reply schema in the prompt. With no route
it stops before Genie starts, with the choices that change the outcome. Only a route that answered is reused, and a route
Genie Code refuses during a build is dropped for the next round."""
import json
import tomllib
import types

import pytest

from v120_artifacts_support import FakeSpark, make_inspire

REFUSED = RuntimeError("RESOURCE_DOES_NOT_EXIST: model is not served by Unity Gateway for this workspace")
NOT_ENABLED = RuntimeError("BAD_REQUEST: responses API is not enabled for model system.ai.claude-sonnet-4-6")
BUSY = TimeoutError("timed out")
CODEX, MLFLOW = "/ai-gateway/codex/v1", "/ai-gateway/mlflow/v1"


class Gateway:
    def __init__(self, codex=(), claude=(), answers=None, list_error=None):
        self.codex, self.claude, self.answers, self.list_error, self.calls = list(codex), list(claude), dict(answers or {}), list_error, []

    def __call__(self, method, path, body=None):
        self.calls.append((method, path, (body or {}).get("model")))
        if method == "GET":
            if self.list_error:
                raise self.list_error
            if path == "/ai-gateway/anthropic/v1/models":
                return {"object": "list", "data": [{"id": s, "type": "model"} for s in self.claude]}
            return {"models": [{"slug": s} for s in self.codex]}
        answer = self.answers.get((path, body["model"]), REFUSED)
        if isinstance(answer, BaseException):
            raise answer
        return {"object": "response", "model": body["model"]}

    def do(self, method, path, body=None, query=None):
        return self(method, path, body)

    def probes(self):
        return [(path, model) for method, path, model in self.calls if method == "POST"]


class Log:
    def __init__(self):
        self.lines = []

    def info(self, text):
        self.lines.append(text)

    warning = error = info


def _discover(ns, gateway, skip=()):
    return ns["genie_code_route_discovery"](gateway, Log(), skip=skip)


def test_the_codex_route_wins_when_one_of_its_listed_models_answers_and_the_hardcoded_model_is_only_probed(agent_ns):
    first = agent_ns["GENIE_CODE_MODEL"]
    gateway = Gateway(codex=["system.ai.kimi-k3", "system.ai.glm-5-3"],
                      answers={(f"{CODEX}/responses", "system.ai.glm-5-3"): "ok", (f"{CODEX}/responses", "system.ai.kimi-k3"): "ok"})
    found = _discover(agent_ns, gateway)
    route = found["route"]
    assert (route.model, route.base, route.web_search, route.schema_in_prompt) == ("system.ai.kimi-k3", CODEX, True, False)
    assert gateway.probes() == [(f"{CODEX}/responses", first), (f"{CODEX}/responses", "system.ai.kimi-k3")]
    assert not any(path.startswith("/ai-gateway/anthropic") for _m, path, _b in gateway.calls), "the Anthropic route is not listed"
    assert agent_ns["genie_code_route_note"](found).startswith(f"Genie Code built this with system.ai.kimi-k3, because {first}")


def test_an_empty_codex_list_falls_through_to_the_newest_claude_on_the_mlflow_path(agent_ns):
    gateway = Gateway(codex=[], claude=["system.ai.claude-haiku-4-5", "system.ai.claude-sonnet-4-5", "system.ai.claude-sonnet-4-6"],
                      answers={(f"{MLFLOW}/responses", "system.ai.claude-sonnet-4-6"): "ok",
                               (f"{MLFLOW}/responses", "system.ai.claude-sonnet-4-5"): "ok"})
    found = _discover(agent_ns, gateway)
    route = found["route"]
    assert (route.model, route.base, route.web_search, route.schema_in_prompt) == ("system.ai.claude-sonnet-4-6", MLFLOW, False, True)
    assert gateway.probes() == [(f"{CODEX}/responses", agent_ns["GENIE_CODE_MODEL"]), (f"{MLFLOW}/responses", "system.ai.claude-sonnet-4-6")]
    verdict = agent_ns["genie_code_route_verdict"](found)
    assert verdict["available"] is True and verdict["route"] == "Anthropic route" and verdict["model"] == "system.ai.claude-sonnet-4-6"
    assert "system.ai.claude-sonnet-4-6 through the Anthropic route" in verdict["reason"]


def test_a_claude_model_the_codex_route_lists_but_refuses_is_still_reached_through_the_mlflow_path(agent_ns):
    gateway = Gateway(codex=["system.ai.claude-sonnet-4-6"], claude=["system.ai.claude-sonnet-4-6"],
                      answers={(f"{CODEX}/responses", "system.ai.claude-sonnet-4-6"): NOT_ENABLED,
                               (f"{MLFLOW}/responses", "system.ai.claude-sonnet-4-6"): "ok"})
    route = _discover(agent_ns, gateway)["route"]
    assert (route.model, route.base) == ("system.ai.claude-sonnet-4-6", MLFLOW)


def test_both_routes_empty_is_no_route_with_the_plain_reason_the_admin_fix_and_the_choices(agent_ns):
    found = _discover(agent_ns, Gateway())
    assert found["route"] is None
    verdict = agent_ns["genie_code_route_verdict"](found)
    assert verdict["available"] is False and verdict["model"] == ""
    assert "Tried 1 model: " + agent_ns["GENIE_CODE_MODEL"] + " through the Codex route" in verdict["reason"]
    assert "the Codex route and the Anthropic route list no model" in verdict["reason"]
    assert "choose Notebook only and run the notebook yourself" in verdict["reason"]
    assert verdict["fix"].startswith("Ask a workspace admin to serve a model to Genie Code through Unity Gateway")
    assert "ticket" not in verdict["reason"].lower() and "contact" not in verdict["reason"].lower()


def test_every_probe_refused_is_no_route_and_names_each_model_on_its_route(agent_ns):
    gateway = Gateway(codex=["system.ai.glm-5-3"], claude=["system.ai.claude-opus-4-7"])
    found = _discover(agent_ns, gateway)
    assert found["route"] is None and len(gateway.probes()) == 3
    tried = agent_ns["genie_code_route_tried"](found)
    assert tried.startswith("3 models: ") and "system.ai.glm-5-3 through the Codex route" in tried
    assert "system.ai.claude-opus-4-7 through the Anthropic route" in tried and "lists no model" not in tried


def test_a_list_that_cannot_be_read_counts_as_empty_and_a_probe_that_only_timed_out_is_the_last_resort(agent_ns):
    first = agent_ns["GENIE_CODE_MODEL"]
    gateway = Gateway(list_error=RuntimeError("PERMISSION_DENIED"), answers={(f"{CODEX}/responses", first): BUSY})
    found = _discover(agent_ns, gateway)
    assert (found["route"].model, found["route"].base) == (first, CODEX) and found["waiting"]


def test_a_timed_out_codex_model_does_not_beat_a_claude_model_that_answered(agent_ns):
    first = agent_ns["GENIE_CODE_MODEL"]
    gateway = Gateway(claude=["system.ai.claude-sonnet-4-6"], answers={(f"{CODEX}/responses", first): BUSY,
                                                                       (f"{MLFLOW}/responses", "system.ai.claude-sonnet-4-6"): "ok"})
    assert _discover(agent_ns, gateway)["route"].base == MLFLOW


def test_a_skipped_route_is_not_probed_again(agent_ns):
    first = agent_ns["GENIE_CODE_MODEL"]
    ok = {(f"{CODEX}/responses", first): "ok", (f"{MLFLOW}/responses", "system.ai.claude-sonnet-4-6"): "ok"}
    gateway = Gateway(claude=["system.ai.claude-sonnet-4-6"], answers=ok)
    found = _discover(agent_ns, gateway, skip={agent_ns["GENIE_CODE_DEFAULT_ROUTE"]})
    assert found["route"].base == MLFLOW and (f"{CODEX}/responses", first) not in gateway.probes()


def test_the_anthropic_list_shape_and_the_codex_list_shape_both_read(agent_ns):
    read = agent_ns["unity_gateway_listed_models"]
    assert read({"data": [{"id": "system.ai.claude-sonnet-4-6"}, {"id": ""}, "x"]}) == ["system.ai.claude-sonnet-4-6"]
    assert read({"models": [{"slug": "a"}, {"slug": "a"}, {"slug": "b"}]}) == ["a", "b"]
    assert read(None) == [] and read({"models": None}) == []


def _runner(ns, tmp_path, route):
    runner = ns["GenieCodeRunner"]("https://ws.example/", "tok-1", Log(), root=str(tmp_path), route=route)
    runner.genie_path, runner.cli_dir = "/bin/genie", str(tmp_path / "cli")
    return runner


def _claude(ns):
    return ns["GenieCodeRoute"]("system.ai.claude-sonnet-4-6", ns["GENIE_CODE_GATEWAYS"][1])


def test_the_mlflow_route_config_turns_web_search_off_and_points_at_the_mlflow_path(agent_ns, tmp_path):
    config = tomllib.loads(_runner(agent_ns, tmp_path, _claude(agent_ns)).config_toml())
    provider = config["model_providers"]["databricks"]
    assert config["model"] == "system.ai.claude-sonnet-4-6" and config["web_search"] == "disabled"
    assert provider["base_url"] == "https://ws.example/ai-gateway/mlflow/v1" and provider["wire_api"] == "responses"
    assert provider["auth"]["command"] == "sh"
    codex = tomllib.loads(_runner(agent_ns, tmp_path, agent_ns["GENIE_CODE_DEFAULT_ROUTE"]).config_toml())
    assert "web_search" not in codex and codex["model_providers"]["databricks"]["base_url"].endswith("/ai-gateway/codex/v1")


class _Proc:
    def __init__(self, command, reply, code=0, stderr=""):
        self.command, self.pid, self.reply, self.code = command, 999999, reply, code
        self.stdout, self.stderr = iter([json.dumps({"type": "turn.completed"}) + "\n"]), iter([stderr])
        last = command[command.index("-o") + 1]
        with open(last, "w", encoding="utf-8") as f:
            f.write(reply)

    def wait(self):
        return self.code

    def kill(self):
        pass


SCHEMA = {"type": "object", "required": ["status"], "properties": {"status": {"type": "string"}}}


def _run(ns, tmp_path, route, reply, code=0, stderr=""):
    seen = []

    def popen(command, **_kw):
        seen.append(command)
        return _Proc(command, reply, code, stderr)

    runner = _runner(ns, tmp_path, route)
    runner._popen = popen
    return runner, runner.run("Build it.", str(tmp_path / "work"), SCHEMA, label="build"), seen[0]


def test_the_mlflow_route_asks_for_the_schema_in_the_prompt_and_reads_the_json_reply_without_output_schema(agent_ns, tmp_path):
    reply = 'Done. Here is a sketch {not json}.\n```json\n{"status": "written", "notes": {"rows": 3}}\n```'
    _runner_, result, command = _run(agent_ns, tmp_path, _claude(agent_ns), reply)
    assert "--output-schema" not in command
    assert command[-1].endswith(agent_ns["GENIE_SCHEMA_IN_PROMPT"].format(schema=json.dumps(SCHEMA)))
    assert result["final"] == {"status": "written", "notes": {"rows": 3}}


def test_the_codex_route_keeps_output_schema_and_no_schema_sentence(agent_ns, tmp_path):
    _runner_, result, command = _run(agent_ns, tmp_path, agent_ns["GENIE_CODE_DEFAULT_ROUTE"], '{"status": "written"}')
    assert "--output-schema" in command and "JSON schema" not in command[-1]
    assert result["final"] == {"status": "written"}


def test_a_reply_with_no_json_object_reads_as_none(agent_ns):
    read = agent_ns["genie_reply_json"]
    assert read("no object here") is None and read("{broken") is None and read('["list"]') is None
    assert read('first {"a": 1} then {"b": {"c": 2}}') == {"b": {"c": 2}}


def test_a_route_genie_code_refuses_mid_build_calls_back_and_an_ordinary_failure_does_not(agent_ns, tmp_path):
    refused = []
    runner, result, _c = _run(agent_ns, tmp_path, _claude(agent_ns), "", code=1,
                              stderr="Error: responses API is not enabled for model system.ai.claude-sonnet-4-6\n")
    assert "route_refused" in result
    runner.on_route_refused = refused.append
    runner._popen = lambda command, **_kw: _Proc(command, "", 1, "Error: the notebook cell failed with a syntax error\n")
    plain = runner.run("Build it.", str(tmp_path / "work2"), SCHEMA, label="build")
    assert "route_refused" not in plain and refused == []


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


def test_a_route_that_answered_is_reused_and_a_refused_one_is_forgotten_and_replaced_for_the_next_round(fresh_ns, monkeypatch, tmp_path):
    first = fresh_ns["GENIE_CODE_MODEL"]
    gateway = Gateway(claude=["system.ai.claude-sonnet-4-6"], answers={(f"{CODEX}/responses", first): "ok",
                                                                       (f"{MLFLOW}/responses", "system.ai.claude-sonnet-4-6"): "ok"})
    inst = _inspire(fresh_ns, gateway, monkeypatch)
    runner = inst._implement_runner("N01-U01")
    assert runner.route == fresh_ns["GENIE_CODE_DEFAULT_ROUTE"] and len(gateway.probes()) == 1
    inst._implement_runner("N01-U02")
    assert len(gateway.probes()) == 1, "a route that answered is reused within the run"
    runner.root = str(tmp_path)
    (tmp_path / "home").mkdir()
    runner.on_route_refused("responses API is not enabled for model")
    assert runner.route.base == MLFLOW and 'base_url = "https://ws.example/ai-gateway/mlflow/v1"' in (tmp_path / "home" / "config.toml").read_text()
    assert gateway.probes()[-1] == (f"{MLFLOW}/responses", "system.ai.claude-sonnet-4-6"), "the refused route is not probed again"
    assert inst._implement_runner("N01-U03").route.base == MLFLOW


def test_the_discover_start_records_the_verdict_as_a_warning_step_and_never_stops_discover(fresh_ns, monkeypatch):
    inst = _inspire(fresh_ns, Gateway(), monkeypatch)
    inst.operation_mode = "Discover Use Cases"
    verdict = inst._record_genie_code_verdict()
    assert verdict["available"] is False
    [step] = inst.emitted
    assert step["step_name"] == fresh_ns["GENIE_CODE_CHECK_STEP"] and step["status"] == "ended_warning"
    assert step["result_json"]["genie_code"] == verdict and step["message"].startswith("Genie Code is not available")


def test_the_discover_start_verdict_names_the_route_when_one_answers_and_is_skipped_for_other_operations(fresh_ns, monkeypatch):
    first = fresh_ns["GENIE_CODE_MODEL"]
    inst = _inspire(fresh_ns, Gateway(answers={(f"{CODEX}/responses", first): "ok"}), monkeypatch)
    inst.operation_mode = "Discover Use Cases"
    assert inst._record_genie_code_verdict()["available"] is True
    assert inst.emitted[-1]["status"] == "ended_success" and first in inst.emitted[-1]["message"]
    inst.emitted.clear()
    inst.operation_mode = fresh_ns["IMPLEMENT_OPERATION"]
    assert inst._record_genie_code_verdict() is None and inst.emitted == []


def test_a_check_that_crashes_is_an_unknown_verdict_not_a_stop(fresh_ns, monkeypatch):
    inst = _inspire(fresh_ns, Gateway(), monkeypatch)
    inst._implement_genie_found = lambda: (_ for _ in ()).throw(ValueError("boom"))
    verdict = inst.genie_code_verdict()
    assert verdict["available"] is None and verdict["reason"].startswith("Inspire could not check Genie Code")


def test_gpt_oss_models_are_never_probed_or_chosen_on_either_route_because_they_reject_parallel_tool_calls(agent_ns):
    oss = ["system.ai.gpt-oss-120b", "databricks-gpt-oss-20b", "GPT_OSS_large"]
    answers = {(base, m): "ok" for base in (f"{CODEX}/responses", f"{MLFLOW}/responses") for m in oss}
    gateway = Gateway(codex=oss, claude=oss + ["system.ai.claude-sonnet-4-6"],
                      answers={**answers, (f"{MLFLOW}/responses", "system.ai.claude-sonnet-4-6"): "ok"})
    found = _discover(agent_ns, gateway)
    assert found["route"].model == "system.ai.claude-sonnet-4-6"
    assert gateway.probes() == [(f"{CODEX}/responses", agent_ns["GENIE_CODE_MODEL"]), (f"{MLFLOW}/responses", "system.ai.claude-sonnet-4-6")]
    only = Gateway(codex=oss, claude=oss, answers=answers)
    assert _discover(agent_ns, only)["route"] is None
    assert not any("oss" in model.lower() for _p, model in only.probes())
    assert agent_ns["genie_code_ranked_models"](["system.ai.kimi-k3"] + oss) == ["system.ai.kimi-k3"]
    assert not agent_ns["is_genie_code_unfit_model"]("system.ai.claude-opus-4-7")
