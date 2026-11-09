import json
import os
import shutil
import subprocess

import pytest

JOB_PARAMS_JS = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "backend", "lib", "inspireJobParams.js"))
SAMPLES = ["genie,agent_endpoint", "Acme, Inc. (R&D) #1", " lead", "trail ", "x" * 300, " " * 10 + "y" * 300,
           "caf\u00e9 \u0645\u0631\u062d\u0628\u0627 \U0001F600", "a\nb\tc", "", "ok value/1:2@3+4=5", "dbx.inspire-ai", "_.-_x-._",
           "a__b..c--", "__", "k" * 300, "main.inspire", "N01-U01", "-lead.dot_", "a/b:c=d+e@f", "  ", "=", "/v2/", "1.5.0"]
LISTS = [["genie", "agent_endpoint"], ["a,b", "c d", "", "a,b", "e"], ["x" * 200, "y" * 60, "z" * 10], ["x" * 200, "y" * 54],
         ["a/b", "c:d", "e=f", "g+h", "i@j"], [], ["", " "], ["N01-U01", "N01-U02", "N01-U01"], ["_.-", "ok"]]
PAIRS = {"job": ("job", "job"), "app": ("app", "uc")}


def agent_side(launcher):
    out = {}
    for kind, (agent_kind, _) in PAIRS.items():
        out[kind] = {"key": [launcher.tag_key(s, agent_kind) for s in SAMPLES]}
    out["job"]["value"] = [launcher.tag_value(s, "job") for s in SAMPLES]
    out["app"]["value"] = [launcher.tag_value(s[:256], "app")[:256] for s in SAMPLES]
    out["list"] = [launcher.tag_list(items) for items in LISTS]
    return out


def backend_side(drift=""):
    script = (f"const T = require({json.dumps(JOB_PARAMS_JS)});{drift}"
              f"const S = {json.dumps(SAMPLES)}; const L = {json.dumps(LISTS)}; const P = {json.dumps(PAIRS)};"
              "const out = {};"
              "for (const [kind, [, backendKind]] of Object.entries(P)) out[kind] = {key: S.map((s) => T.resourceTagKey(backendKind, s))};"
              "out.job.value = S.map((s) => T.resourceTagValue('job', s));"
              "out.app.value = S.map((s) => T.resourceTagValue('uc', [...s].slice(0, 256).join('')).slice(0, 256));"
              "out.list = L.map((items) => T.inspireTagList(items));"
              "console.log(JSON.stringify(out));")
    return json.loads(subprocess.run(["node", "-e", script], capture_output=True, text=True, check=True).stdout)


def drifts(agent, backend):
    found = []
    for kind in agent:
        for part in (agent[kind] if isinstance(agent[kind], dict) else {"": agent[kind]}):
            mine = agent[kind][part] if part else agent[kind]
            theirs = backend[kind][part] if part else backend[kind]
            found += [(kind, part, i, a, b) for i, (a, b) in enumerate(zip(mine, theirs)) if a != b]
    return found


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_agent_and_the_app_clean_every_tag_the_same_way_for_each_resource_kind(agent_ns):
    assert drifts(agent_side(agent_ns["JobLauncher"]), backend_side()) == []


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
@pytest.mark.parametrize("drift", ["T.RESOURCE_TAG_RULES.job.keyMax = 128;", "T.RESOURCE_TAG_RULES.job.valueBad = /[^A-Za-z0-9 +=.:/@_,-]/g;",
                                   "T.RESOURCE_TAG_RULES.job.value = /^[\\d \\w+\\-=.:/@,]*$/;", "T.RESOURCE_TAG_RULES.uc.keyBad = /[^A-Za-z0-9_.]/g;",
                                   "T.RESOURCE_TAG_RULES.uc.valueMax = 200;"])
def test_the_parity_check_catches_a_backend_rule_that_drifts(agent_ns, drift):
    assert drifts(agent_side(agent_ns["JobLauncher"]), backend_side(drift)), drift


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
@pytest.mark.parametrize("kind,field,value", [("job", "key_max", 126), ("app", "key_chars", "A-Za-z0-9_."), ("job", "value_chars", "A-Za-z0-9 +=.:/@_,-")])
def test_the_parity_check_catches_a_notebook_rule_that_drifts(agent_ns, monkeypatch, kind, field, value):
    launcher = agent_ns["JobLauncher"]
    backend = backend_side()
    rules = {k: dict(v) for k, v in launcher.TAG_RULES.items()}
    rules[kind][field] = value
    monkeypatch.setattr(launcher, "TAG_RULES", rules)
    assert drifts(agent_side(launcher), backend), (kind, field, value)


@pytest.mark.skipif(shutil.which("node") is None, reason="node is not installed")
def test_the_parity_check_catches_a_list_separator_that_drifts(agent_ns, monkeypatch):
    backend = backend_side()
    monkeypatch.setattr(agent_ns["JobLauncher"], "TAG_LIST_SEP", "+")
    assert drifts(agent_side(agent_ns["JobLauncher"]), backend)
