import json

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire

PAGE = "app:page:n05_u02"
LABEL = "App page n05_u02"
ADD = "Add a chart of expected late orders by carrier"
REMOVE = "Remove the 'Idle minutes' KPI"
KEEP = "Keep everything else exactly as it is"
VIBE = f"{ADD}. {REMOVE}. {KEEP}."
RECORDS_SQL = "SELECT * FROM main.inspire.n05_u02_out WHERE run_id = (SELECT MAX(run_id) FROM main.inspire.n05_u02_out)"
CARRIER_SQL = "SELECT carrier, SUM(late_orders) AS late_orders FROM main.inspire.n05_u02_out GROUP BY 1"
REGION_CHART = {"id": "region_risk", "title": "Region risk", "type": "bar", "dataset": "records",
                "x": {"column": "region", "label": "Region"}, "y": [{"expression": "SUM(value_at_stake)", "label": "Value at stake"}]}
CARRIER_CHART = {"id": "late_orders_by_carrier", "title": "Expected late orders by carrier", "type": "bar", "dataset": "carrier",
                 "x": {"column": "carrier", "label": "Carrier"}, "y": [{"expression": "SUM(late_orders)", "label": "Expected late orders"}]}
IDLE = {"id": "idle_minutes", "label": "Idle minutes", "dataset": "records", "expression": "SUM(idle_minutes)", "format": "integer"}
AT_STAKE = {"id": "value_at_stake", "label": "Value at stake", "dataset": "records", "expression": "SUM(value_at_stake)",
            "format": "currency", "currency": "USD"}
V1 = {"id": "n05_u02", "title": "Late order outlook", "question": "Which orders will arrive late?",
      "datasets": [{"name": "records", "sql": RECORDS_SQL}],
      "kpis": [AT_STAKE, IDLE], "charts": [REGION_CHART],
      "records": {"title": "Order plan", "key": "record_key", "label": "entity_label", "rank": "rank", "tier": "priority_tier",
                  "columns": [{"column": "carrier", "label": "Carrier"}]}}
V2 = dict(json.loads(json.dumps(V1)), kpis=[AT_STAKE], charts=[REGION_CHART, CARRIER_CHART],
          datasets=V1["datasets"] + [{"name": "carrier", "sql": CARRIER_SQL}])
SPLIT = [{"ask": ADD, "check": None, "keep": False, "where": "the expected late orders by carrier chart"},
         {"ask": REMOVE, "check": None, "keep": False, "where": "the Idle minutes KPI"},
         {"ask": KEEP, "check": None, "keep": True, "where": ""}]
GONE = "The Idle minutes KPI shown in the version before is no longer shown, so not everything else was kept as it was."


def _copy(value):
    return json.loads(json.dumps(value))


def _judge(inst, split):
    calls = []

    def llm(kind, prompt, schema):
        calls.append((kind, prompt))
        if kind == "split":
            return {"asks": _copy(split)}
        asks = prompt.split("The asks:\n", 1)[1].split("\n\n", 1)[0].splitlines()
        return {"checks": [{"n": n, "status": "missing", "evidence": GONE, "where": ""} if KEEP in line else
                           {"n": n, "status": "done", "evidence": "Expected late orders by carrier", "where": "late_orders_by_carrier"}
                           for n, line in enumerate(asks, 1)]}

    inst._implement_vibes_llm = llm
    return calls


def _round(agent_ns, new, before=V1, split=SPLIT):
    import shell_sql
    inst = _inspire(agent_ns, FakeSpark())
    calls = _judge(inst, split)
    item = {"asset": PAGE, "text": VIBE, "artifact": _copy(new), "built_before": _copy(before) if before is not None else None,
            "tools": {"shell_sql": shell_sql}}
    found = inst._implement_vibes_round({}, [item], "N05-U02 round 1/3")
    judged = [prompt for kind, prompt in calls if kind == "judge"]
    return {c["ask"]: c for c in found["checks"][PAGE]}, judged, found


def _asks_of(prompt):
    return prompt.split("The asks:\n", 1)[1].split("\n\n", 1)[0]


def test_a_keep_the_rest_ask_is_done_from_the_untargeted_check_and_never_asks_the_judge(agent_ns):
    checks, judged, found = _round(agent_ns, V2)
    assert (checks[KEEP]["status"], checks[KEEP]["evidence"]) == (
        "done", f"nothing on the built {LABEL} that the other asks did not name changed from the version before")
    assert checks[REMOVE]["status"] == "done"
    assert checks[ADD]["status"] == "done"
    assert all(KEEP not in _asks_of(prompt) for prompt in judged), "the judge is never asked about the keep-the-rest ask"
    assert found["resend"] == {}


def test_the_before_save_gate_publishes_a_vibe_that_kept_the_rest(agent_ns):
    import shell_sql
    inst = _inspire(agent_ns, FakeSpark())
    calls = _judge(inst, SPLIT)
    inst._implement_snapshot = lambda key, name, version: {"artifact": _copy(V1)}
    inst._implement_app_shell = lambda: ({}, {"shell_sql": shell_sql})
    context = {"uc_id": "N05-U02", "key": (5150, "N05-U02", 3), "spec": {"outputs": {f"{PAGE}_vibes": VIBE}},
               "asset_status": {"app": {"state": "ready", "spec_version": 2, "snapshot": True}},
               "genie_round": {"name": "app", "round": 1, "rounds": 3}}
    inst._implement_output_vibes_gate(context, "app", _copy(V2))
    found = context["round_vibes"]["app"]
    assert [c["status"] for c in found["checks"][PAGE]] == ["done", "done", "done"]
    assert found["resend"] == {}
    assert all(KEEP not in _asks_of(prompt) for kind, prompt in calls if kind == "judge")


def test_a_keep_the_rest_ask_is_missing_when_an_element_no_ask_names_changed(agent_ns):
    changed = dict(_copy(V2), title="Late order outlook this week")
    checks, judged, found = _round(agent_ns, changed)
    assert checks[KEEP]["status"] == "missing"
    assert checks[KEEP]["evidence"] == ("the page header is not as the version before built it, and no other ask names it: Genie "
                                        "changed the page header: its title from Late order outlook to Late order outlook this week")
    assert all(KEEP not in _asks_of(prompt) for prompt in judged)
    assert [c["ask"] for c in found["resend"][PAGE]] == [KEEP]


def test_a_keep_the_rest_ask_names_how_many_more_changes_no_ask_names(agent_ns):
    changed = dict(_copy(V2), title="Late order outlook this week", charts=[dict(REGION_CHART, type="line"), CARRIER_CHART])
    checks, _judged, _found = _round(agent_ns, changed)
    assert checks[KEEP]["status"] == "missing"
    assert checks[KEEP]["evidence"].endswith(", and 1 other change no ask names")


def test_the_judge_prompt_says_a_keep_the_rest_ask_never_covers_what_another_ask_changes(agent_ns):
    prompt = agent_ns["implement_vibes_judge_prompt"](PAGE, SPLIT, {}, earlier={})
    sentence = agent_ns["IMPLEMENT_VIBES_KEEP_REST"]
    assert sentence in prompt
    assert "covers only what no other ask of that part adds, removes or changes" in sentence
    assert "never makes the ask to keep the rest missing" in sentence
    assert "explicit user directives" in prompt
    named = [dict(SPLIT[2], ask="Keep the region risk chart as it is", where="the region risk chart")]
    assert sentence not in agent_ns["implement_vibes_judge_prompt"](PAGE, SPLIT[:2] + named, {}, earlier={})


def test_a_keep_ask_that_names_an_element_still_goes_to_the_judge(agent_ns):
    named = "Keep the region risk chart as it is"
    split = SPLIT[:2] + [{"ask": named, "check": None, "keep": True, "where": "the region risk chart"}]
    checks, judged, _found = _round(agent_ns, V2, split=split)
    assert len(judged) == 1 and f"{named} [asks to keep it as it is] [names the region risk chart]" in _asks_of(judged[0])
    assert agent_ns["IMPLEMENT_VIBES_KEEP_REST"] not in judged[0]


def test_a_keep_ask_that_names_an_element_another_ask_removes_is_never_settled_as_done(agent_ns):
    named = "Keep the Idle minutes KPI as it is"
    split = SPLIT[:2] + [{"ask": named, "check": None, "keep": True, "where": "the Idle minutes KPI"}]
    checks, judged, _found = _round(agent_ns, V2, split=split)
    assert len(judged) == 1 and named in _asks_of(judged[0]), "a named keep ask keeps going to the judge"
    assert checks[named]["status"] == "missing", checks[named]


@pytest.mark.parametrize("before", [None], ids=["no_version_before"])
def test_with_no_version_before_the_keep_the_rest_ask_falls_back_to_the_judge(agent_ns, before):
    checks, judged, _found = _round(agent_ns, V2, before=before)
    assert len(judged) == 1 and KEEP in _asks_of(judged[0])
    assert (checks[KEEP]["status"], checks[KEEP]["evidence"]) == ("missing", GONE)


def test_when_the_other_asks_name_nothing_the_untargeted_check_reads_the_keep_the_rest_ask_falls_back_to_the_judge(agent_ns):
    loose = [dict(SPLIT[0], where=""), SPLIT[1], SPLIT[2]]
    assert agent_ns["implement_untargeted_targets"]("app", [(PAGE, a) for a in loose], V1, V2, "records") is None
    checks, judged, _found = _round(agent_ns, V2, split=loose)
    assert any(KEEP in _asks_of(prompt) for prompt in judged)
    assert agent_ns["IMPLEMENT_VIBES_KEEP_REST"] in judged[0]


def test_the_rest_kept_check_reads_the_same_untargeted_diff_the_restore_uses(agent_ns):
    import shell_sql
    kept = agent_ns["implement_vibes_rest_kept"]
    asks = [(PAGE, a) for a in SPLIT]
    assert kept("app", asks, V1, V2, LABEL, shell_sql)[0] == "done"
    assert kept("app", asks, V1, V2, LABEL, None) is None, "a page with no App shell to read its records falls back to the judge"
    assert kept("alert", asks, V1, V2, LABEL, shell_sql) is None
    assert kept("app", asks, None, V2, LABEL, shell_sql) is None
    keeps = agent_ns["implement_vibes_keeps_rest"]
    assert keeps(SPLIT[2]) and not keeps(SPLIT[0]) and not keeps(dict(SPLIT[2], where="the region risk chart"))
    assert not keeps(dict(SPLIT[2], keep=None)) and not keeps(None)
