import logging
import os
import string
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import load_agent_namespace


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def _fields(template):
    return {f.split(".")[0].split("[")[0] for _, f, _, _ in string.Formatter().parse(template) if f}


def _agent(ns, templates):
    agent = ns["AIAgent"].__new__(ns["AIAgent"])
    agent.prompt_templates = templates
    agent.logger = logging.getLogger("v120_preamble_test")
    return agent


def _vars_for(ns, key, template):
    values = {name: "<%s>" % name for name in _fields(template)}
    if key == "BASE_USE_CASE_GEN_PROMPT":
        values["quality_gate_block"] = ns["QUALITY_GATE_HIGH"]
    return values


def test_preamble_constant_declares_user_supremacy(ns):
    pre = ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"]
    assert isinstance(pre, str) and pre.strip()
    assert "the user directive WINS without exception" in pre
    assert "Generation Instructions" in pre
    assert "response format" in pre


def test_preamble_survives_sanitizer_and_format(ns):
    pre = ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"]
    agent = _agent(ns, {})
    assert "{" not in pre and "}" not in pre
    assert agent._sanitize_template_braces(pre, "preamble") == pre
    assert pre.format() == pre


def test_no_template_embeds_the_preamble_itself(ns):
    pre = ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"].strip()
    offenders = [k for k, v in ns["PROMPT_TEMPLATES"].items() if pre in v]
    assert offenders == []


def test_every_prompt_rendered_through_aiagent_starts_with_preamble_exactly_once(ns):
    pre = ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"]
    templates = ns["PROMPT_TEMPLATES"]
    agent = _agent(ns, templates)
    assert len(templates) >= 15
    for key, template in templates.items():
        rendered = agent._load_and_format_prompt(key, _vars_for(ns, key, template))
        assert rendered.startswith(pre), key
        assert rendered.count(pre) == 1, key


def test_preamble_is_not_added_twice_when_template_already_starts_with_it(ns):
    pre = ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"]
    agent = _agent(ns, {"X": pre + "Body {a}"})
    rendered = agent._load_and_format_prompt("X", {"a": "1"})
    assert rendered == pre + "Body 1"


def test_runtime_registered_prompt_with_escaped_json_gets_preamble(ns):
    pre = ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"]
    merger_style = 'Merge domains.\nStart your response with: {{"honesty_score": 90, "data": {{}}}}\n'
    agent = _agent(ns, {"DOMAINS_MERGER_PROMPT": merger_style})
    rendered = agent._load_and_format_prompt("DOMAINS_MERGER_PROMPT", {})
    assert rendered.startswith(pre)
    assert '{"honesty_score": 90, "data": {}}' in rendered


def test_run_worker_sends_the_preamble_to_the_llm(ns):
    pre = ns["USER_DIRECTIVE_SUPREMACY_PREAMBLE"]
    templates = ns["PROMPT_TEMPLATES"]
    agent = _agent(ns, templates)
    sent = []
    agent._build_started_status = lambda *a, **k: ("", {})
    agent._build_success_status = lambda *a, **k: ("", {})
    agent._emit_status = lambda **k: None
    agent._call_ai_query = lambda prompt, *a, **k: sent.append(prompt) or "ok"
    key = "GOAL_ALIGNMENT_FILTER_PROMPT"
    out = agent.run_worker(step_name="t", worker_prompt_path=key,
                           prompt_vars=_vars_for(ns, key, templates[key]), response_schema=None)
    assert out == "ok"
    assert len(sent) == 1
    assert sent[0].startswith(pre) and sent[0].count(pre) == 1


def test_missing_placeholder_still_raises_keyerror(ns):
    agent = _agent(ns, {"Y": "needs {value}"})
    with pytest.raises(KeyError):
        agent._load_and_format_prompt("Y", {})
