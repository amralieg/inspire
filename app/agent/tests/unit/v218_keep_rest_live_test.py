import json

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire

ASSET = "app"
LABEL = "App"
ADD = "Add a chart of expected faults by component type"
REMOVE = "Remove the 'Response hours' KPI"
KEEP = "Keep everything else exactly as it is"
VIBE = f"{ADD}. {REMOVE}. {KEEP}."
SPLIT = [{"ask": ADD, "check": None, "keep": False, "where": "", "draws": "chart"},
         {"ask": REMOVE, "check": None, "keep": False, "where": "the 'Response hours' KPI"},
         {"ask": KEEP, "check": None, "keep": True, "where": ""}]
RECORDS_SQL = ("SELECT o.record_key, o.entity_label, o.priority_tier, o.`rank`, o.value * 100 AS value, o.value_at_stake, o.as_of_date, "
               "o.region, o.district, o.component_type FROM main.demo.n02_u01_out AS o WHERE o.is_current")
FAULTS_SQL = ("SELECT f.fault_id, c.as_of_date, CAST(f.detected_ts AS DATE) AS event_date, date_trunc('MONTH', f.detected_ts) AS event_month, "
              "f.region, f.district, f.component_type, f.response_hours, f.parts_cost FROM main.demo.faults AS f JOIN main.demo.n02_u01_out AS c "
              "ON c.entity_id = f.zone_id WHERE c.is_current")
Y_FAULTS = {"expression": "COUNT(DISTINCT fault_id)", "format": "integer", "label": "Confirmed faults"}
Y_HOURS = {"expression": "SUM(response_hours)", "format": "number", "label": "Response hours"}
Y_COST = {"expression": "SUM(parts_cost)", "format": "number", "label": "Parts cost"}
Y_EXPECTED = {"expression": "SUM(value_at_stake)", "format": "number", "label": "Expected faults"}
HISTORY = {"dataset": "faults", "hint": "Confirmed faults by month, with the burden they created.", "id": "fault_history", "span": 2,
           "title": "Fault history and impact", "type": "line", "x": {"column": "event_month", "kind": "time", "label": "Month"},
           "y": [Y_FAULTS, Y_HOURS, Y_COST]}
REGIONAL = {"dataset": "records", "hint": "Expected faults next month across operating regions.", "id": "regional_exposure",
            "title": "Expected faults by region", "type": "horizontal_bar", "x": {"column": "region", "kind": "category", "label": "Region"},
            "y": [Y_EXPECTED]}
BY_COMPONENT = {"dataset": "records", "hint": "Expected faults next month across component types.", "id": "expected_faults_by_component",
                "title": "Expected faults by component type", "type": "horizontal_bar",
                "x": {"column": "component_type", "kind": "category", "label": "Component type"}, "y": [Y_EXPECTED]}
DRIVERS = {"dataset": "records", "driver": True, "hint": "Model drivers for the zones in the current queue.", "id": "risk_drivers",
           "title": "What drives zone risk", "type": "bar", "x": {"column": "ai_cat_driver", "kind": "category", "label": "Main risk driver"},
           "y": [Y_EXPECTED]}
CONCENTRATION = {"dataset": "records", "hint": "Component types ordered by their share of expected fault exposure.",
                 "id": "component_concentration", "limit": 12, "title": "Exposure concentration by component type", "type": "pareto",
                 "x": {"column": "component_type", "kind": "category", "label": "Component type"}, "y": [Y_EXPECTED]}
CONFIRMED = {"dataset": "faults", "expression": "COUNT(DISTINCT fault_id)", "format": "integer", "good": "down", "id": "confirmed_faults",
             "label": "Confirmed faults"}
HOURS = {"dataset": "faults", "expression": "SUM(response_hours)", "format": "number", "good": "down", "id": "response_hours",
         "label": "Response hours"}
COST = {"dataset": "faults", "expression": "SUM(parts_cost)", "format": "number", "good": "down", "id": "parts_cost", "label": "Parts cost"}
EXPECTED = {"compare": True, "dataset": "records", "expression": "SUM(value_at_stake)", "format": "number", "good": "down",
            "id": "expected_faults", "label": "Expected faults next month"}


def _filter(ident, label, kind, faults, records, **extra):
    return dict({"columns": {"faults": faults, "records": records}, "id": ident, "label": label, "type": kind}, **extra)


V4 = {"charts": [HISTORY, REGIONAL, DRIVERS, CONCENTRATION],
      "datasets": [{"name": "records", "sql": RECORDS_SQL}, {"name": "faults", "sql": FAULTS_SQL}],
      "domain": "Field Service",
      "filters": [_filter("run_date", "Run date", "date_range", "as_of_date", "as_of_date", default="all", grain="month"),
                  _filter("event_date", "Fault date", "date_range", "event_date", "last_fault_date", default="12m", grain="day"),
                  _filter("region", "Region", "multi_select", "region", "region"),
                  _filter("district", "District", "multi_select", "district", "district"),
                  _filter("component", "Component type", "multi_select", "component_type", "component_type")],
      "hue": "blue", "icon": "trend", "id": "n02_u01",
      "kpis": [CONFIRMED, HOURS, COST, EXPECTED],
      "layout": "decision_queue",
      "question": "Which service zones should receive inspection and standby capacity first next month?",
      "questions": ["Show the current inspection queue with confidence and driver.",
                    "Which service zones should we act on now for next month's inspections?"],
      "records": {"action": "recommended_action",
                  "column_filters": [{"column": c} for c in ("rank", "entity_label", "region", "priority_tier", "value", "value_at_stake")],
                  "columns": [{"column": "value", "format": "percent", "label": "Chance of a fault"},
                              {"column": "value_at_stake", "format": "number", "label": "Expected faults"}],
                  "detail": [{"column": "district", "format": "text", "label": "District"},
                             {"column": "component_type", "format": "text", "label": "Component type"}],
                  "hint": "Service zones from the latest decision state, ranked for next month's inspection planning.",
                  "key": "record_key", "label": "entity_label", "rank": "rank", "reasons": "top_reasons", "sublabel": "region",
                  "tier": "priority_tier", "title": "Monthly inspection priority queue"}}
V5 = dict(json.loads(json.dumps(V4)), kpis=[CONFIRMED, COST, EXPECTED], charts=[HISTORY, REGIONAL, BY_COMPONENT, DRIVERS, CONCENTRATION])
GENIE = {"genie": {"space_id": "s1", "title": "Ask about the inspection queue"}, "genie_note": ""}
GONE = "The Response hours KPI (element response_hours) was shown in the earlier version and is gone now, and no other ask removes it."


def _copy(value):
    return json.loads(json.dumps(value))


def _shell():
    import shell_sql
    return shell_sql


def _asks(split=SPLIT):
    return [(ASSET, a) for a in split]


def _judge(inst, split, keep_evidence=GONE, keep_where=""):
    calls = []

    def llm(kind, prompt, schema):
        calls.append((kind, prompt))
        if kind == "split":
            return {"asks": _copy(split)}
        asks = prompt.split("The asks:\n", 1)[1].split("\n\n", 1)[0].splitlines()
        return {"checks": [{"n": n, "status": "missing", "evidence": keep_evidence, "where": keep_where}
                           if "[asks to keep it as it is]" in line and "[names" not in line else
                           {"n": n, "status": "done", "evidence": "Expected faults by component type", "where": "expected_faults_by_component"}
                           for n, line in enumerate(asks, 1)]}

    inst._implement_vibes_llm = llm
    return calls


def _round(agent_ns, new, before=V4, split=SPLIT, **judge):
    inst = _inspire(agent_ns, FakeSpark())
    calls = _judge(inst, split, **judge)
    item = {"asset": ASSET, "text": VIBE, "artifact": dict(_copy(new), **GENIE),
            "built_before": dict(_copy(before), **GENIE) if before is not None else None, "tools": {"shell_sql": _shell()}}
    found = inst._implement_vibes_round({}, [item], "N02-U01 App round 1/3")
    judged = [prompt for kind, prompt in calls if kind == "judge"]
    return {c["ask"]: c for c in found["checks"][ASSET]}, judged, found, inst


def _asks_of(prompt):
    return prompt.split("The asks:\n", 1)[1].split("\n\n", 1)[0]


def test_the_live_split_resolves_the_remove_ask_to_its_kpi_and_the_unnamed_add_ask_to_a_new_element(agent_ns):
    targets = agent_ns["implement_untargeted_targets"](ASSET, _asks(), V4, V5, "records", _shell())
    assert targets == {"keys": {"kpis:response_hours"}, "adds": True, "groups": set()}
    assert agent_ns["implement_untargeted_changes"](ASSET, V4, V5, targets, "records") == []
    assert agent_ns["implement_vibes_rest_kept"](ASSET, _asks(), V4, V5, LABEL, _shell()) == (
        "done", f"nothing on the built {LABEL} that the other asks did not name changed from the version before")


def test_the_live_round_settles_keep_the_rest_without_the_judge(agent_ns):
    checks, judged, found, inst = _round(agent_ns, V5)
    assert [checks[a]["status"] for a in (ADD, REMOVE, KEEP)] == ["done", "done", "done"]
    assert all(KEEP not in _asks_of(prompt) for prompt in judged)
    assert found["resend"] == {}
    assert inst.logger.matching("[IMPLEMENT-VIBES-KEEP-REST FIRED] N02-U01 App round 1/3")


@pytest.mark.parametrize("new, gone", [
    (dict(_copy(V5), kpis=[CONFIRMED, EXPECTED]), "removed the Parts cost KPI"),
    (dict(_copy(V5), kpis=[CONFIRMED, COST, dict(EXPECTED, label="Expected faults")]), "changed the Expected faults next month KPI"),
    (dict(_copy(V5), charts=[dict(HISTORY, y=[Y_FAULTS, Y_COST]), REGIONAL, BY_COMPONENT, DRIVERS, CONCENTRATION]),
     "changed the Fault history and impact chart"),
    (dict(_copy(V5), charts=[HISTORY, dict(REGIONAL, type="line"), BY_COMPONENT, DRIVERS, CONCENTRATION]),
     "changed the Expected faults by region chart"),
    (dict(_copy(V5), filters=V4["filters"][:4]), "removed the Component type filter"),
    (dict(_copy(V5), title="Inspection queue"), "changed the page header"),
], ids=["other_kpi_dropped", "kpi_sharing_words_with_the_add_changed", "chart_axis_of_the_removed_measure_dropped",
        "untargeted_chart_changed", "filter_dropped", "page_header_changed"])
def test_a_change_no_ask_names_still_leaves_keep_the_rest_missing(agent_ns, new, gone):
    checks, judged, found, _inst = _round(agent_ns, new)
    assert checks[KEEP]["status"] == "missing" and gone in checks[KEEP]["evidence"], checks[KEEP]
    assert all(KEEP not in _asks_of(prompt) for prompt in judged)
    assert [c["ask"] for c in found["resend"][ASSET]] == [KEEP]


@pytest.mark.parametrize("ask, where", [
    (REMOVE, "the 'Response hours' KPI"), (REMOVE, "the Response hours KPI"), (REMOVE, "response_hours"), (REMOVE, "Response hours"),
    (REMOVE, "the “Response hours” tile"), (REMOVE, ""), ("Remove 'Response hours'", ""), ("Drop response_hours", ""),
    ("Remove the Response hours KPI", ""), ("Take out the “Response hours” tile", ""), ("Please hide the Response hours tile", ""),
])
def test_every_way_of_naming_the_removed_kpi_targets_it(agent_ns, ask, where):
    split = [SPLIT[0], dict(SPLIT[1], ask=ask, where=where), SPLIT[2]]
    targets = agent_ns["implement_untargeted_targets"](ASSET, _asks(split), V4, V5, "records", _shell())
    assert targets is not None and targets["keys"] == {"kpis:response_hours"}, targets
    assert agent_ns["implement_vibes_rest_kept"](ASSET, _asks(split), V4, V5, LABEL, _shell())[0] == "done"


@pytest.mark.parametrize("ask", [ADD, "Please add a horizontal bar chart of expected faults by component type",
                                 "Also add a new chart showing expected faults per component", "Add 1 more table of faults by component",
                                 "Add a KPI tile for expected faults by component"])
def test_an_ask_that_adds_a_new_element_and_names_none_lets_only_new_elements_come(agent_ns, ask):
    split = [dict(SPLIT[0], ask=ask), SPLIT[1], SPLIT[2]]
    targets = agent_ns["implement_untargeted_targets"](ASSET, _asks(split), V4, V5, "records", _shell())
    assert targets is not None and targets["adds"] is True and targets["keys"] == {"kpis:response_hours"}, targets
    changed = dict(_copy(V5), kpis=[CONFIRMED, COST, dict(EXPECTED, good="up")])
    assert agent_ns["implement_vibes_rest_kept"](ASSET, _asks(split), V4, changed, LABEL, _shell())[0] == "missing"


@pytest.mark.parametrize("ask", ["Make it calmer", "Show more detail", "Add a column for district", "Add a list of reasons to it"])
def test_an_ask_that_names_nothing_and_adds_no_element_leaves_the_decision_to_the_judge(agent_ns, ask):
    split = [dict(SPLIT[0], ask=ask, draws=""), SPLIT[1], SPLIT[2]]
    assert agent_ns["implement_untargeted_targets"](ASSET, _asks(split), V4, V5, "records", _shell()) is None
    assert agent_ns["implement_vibes_rest_kept"](ASSET, _asks(split), V4, V5, LABEL, _shell()) is None


def test_an_add_that_names_a_new_chart_never_targets_an_older_kpi_sharing_its_words(agent_ns):
    split = [dict(SPLIT[0], where="the expected faults by component type chart"), SPLIT[1], SPLIT[2]]
    targets = agent_ns["implement_untargeted_targets"](ASSET, _asks(split), V4, V5, "records", _shell())
    assert targets["keys"] == {"kpis:response_hours", "charts:expected_faults_by_component"}
    changed = dict(_copy(V5), kpis=[CONFIRMED, COST, dict(EXPECTED, label="Expected faults")])
    assert agent_ns["implement_vibes_rest_kept"](ASSET, _asks(split), V4, changed, LABEL, _shell())[0] == "missing"


def test_a_change_ask_naming_a_chart_by_title_may_change_only_that_chart(agent_ns):
    ask = {"ask": "Show the Expected faults by region chart as a line chart", "check": None, "keep": False, "where": ""}
    split = [ask, SPLIT[2]]
    lined = dict(_copy(V4), charts=[HISTORY, dict(REGIONAL, type="line"), DRIVERS, CONCENTRATION])
    assert agent_ns["implement_vibes_rest_kept"](ASSET, _asks(split), V4, lined, LABEL, _shell())[0] == "done"
    both = dict(lined, charts=[HISTORY, dict(REGIONAL, type="line"), dict(DRIVERS, type="line"), CONCENTRATION])
    verdict = agent_ns["implement_vibes_rest_kept"](ASSET, _asks(split), V4, both, LABEL, _shell())
    assert verdict[0] == "missing" and "What drives zone risk chart" in verdict[1]


def test_a_chart_named_only_as_the_place_of_a_new_one_is_never_a_target(agent_ns):
    for ask in ("Add a chart of expected faults by component type next to the 'Expected faults by region' chart",
                "Add a chart of expected faults by component type next to the Expected faults by region chart"):
        split = [dict(SPLIT[0], ask=ask), SPLIT[1], SPLIT[2]]
        targets = agent_ns["implement_untargeted_targets"](ASSET, _asks(split), V4, V5, "records", _shell())
        assert targets == {"keys": {"kpis:response_hours"}, "adds": True, "groups": set()}, ask
        moved = dict(_copy(V5), charts=[HISTORY, dict(REGIONAL, title="Faults by region"), BY_COMPONENT, DRIVERS, CONCENTRATION])
        assert agent_ns["implement_vibes_rest_kept"](ASSET, _asks(split), V4, moved, LABEL, _shell())[0] == "missing", ask


CALMER = {"ask": "Make the page calmer", "check": None, "keep": False, "where": "the page"}


def test_when_the_judge_decides_keep_the_rest_a_removal_another_ask_names_never_makes_it_missing(agent_ns):
    split = [CALMER, SPLIT[1], SPLIT[2]]
    assert agent_ns["implement_untargeted_targets"](ASSET, _asks(split), V4, V4, "records", _shell()) is None
    calm = dict(_copy(V4), kpis=[CONFIRMED, COST, EXPECTED])
    for where in ("", "response_hours"):
        checks, judged, found, inst = _round(agent_ns, calm, split=split, keep_where=where)
        assert any(KEEP in _asks_of(prompt) for prompt in judged), "with no deterministic decision the judge is still asked"
        assert checks[KEEP]["status"] == "done", checks[KEEP]
        assert checks[KEEP]["evidence"].startswith(f"the only change the check names on the built {LABEL} is the Response hours KPI")
        assert inst.logger.matching("the judge named only changes another ask targets")


@pytest.mark.parametrize("evidence", [
    "The Expected faults by region chart changed from a bar to a line, and no ask names it.",
    "The Response hours KPI is gone and the Parts cost KPI changed its format.",
    "Several elements look different from the version before.",
], ids=["untargeted_chart", "one_targeted_one_not", "nothing_named"])
def test_the_judge_marks_keep_the_rest_missing_when_it_names_a_change_no_other_ask_targets(agent_ns, evidence):
    split = [CALMER, SPLIT[1], SPLIT[2]]
    checks, _judged, _found, _inst = _round(agent_ns, dict(_copy(V4), kpis=[CONFIRMED, COST, EXPECTED]), split=split,
                                            keep_evidence=evidence)
    assert (checks[KEEP]["status"], checks[KEEP]["evidence"]) == ("missing", evidence)


def test_the_cited_check_covers_new_elements_of_an_add_and_widgets_of_a_dashboard_ask(agent_ns):
    cited = agent_ns["implement_vibes_rest_cited"]
    seen, earlier = (agent_ns["implement_page_seen"](page, _shell()) for page in (V5, V4))
    added = "The Expected faults by component type chart is new and was not in the version before."
    assert cited(("missing", added), "", _asks(), seen, earlier, LABEL)[0] == "done"
    assert cited(("missing", added), "", _asks([SPLIT[1], SPLIT[2]]), seen, earlier, LABEL) == ("missing", added)
    region = "The Expected faults by region chart changed."
    assert cited(("missing", region), "", [("dashboard:regional_exposure", {"ask": "Make it a line", "keep": False})], seen, earlier,
                 LABEL)[0] == "done"
    assert cited(("missing", region), "", _asks(), seen, None, LABEL) == ("missing", region)
    assert cited(("done", "x"), "", _asks(), seen, earlier, LABEL) == ("done", "x")
