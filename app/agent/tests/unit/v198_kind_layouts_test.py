"""Use-case kind layouts in the App shell: page spec version 2, the per-layout sections, minimum items and companion tables, the
layout chart types, the plan decision and the scenario evaluation, offline."""
import copy
import datetime
import json
import os
import re
import sys
import time

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SHELL = os.path.join(ROOT, "agent", "app_shell")
SERVER = os.path.join(SHELL, "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_sql  # noqa: E402
from v141_app_shell_test import PAGE, SETTINGS, app_dir, call  # noqa: E402
from v144_app_data_test import DECIDE, EDITOR, DataWorkspace, shell  # noqa: E402
import v142_edits_test as edits  # noqa: E402

with open(os.path.join(SHELL, "examples", "forecast_cockpit.json"), encoding="utf-8") as _handle:
    FORECAST = json.load(_handle)
with open(os.path.join(SHELL, "examples", "planner.json"), encoding="utf-8") as _handle:
    PLANNER = json.load(_handle)
with open(os.path.join(SHELL, "examples", "scenario_lab.json"), encoding="utf-8") as _handle:
    SCENARIO = json.load(_handle)
with open(os.path.join(SHELL, "kinds.json"), encoding="utf-8") as _handle:
    KINDS = json.load(_handle)
with open(os.path.join(SHELL, "examples", "monitor_triage.json"), encoding="utf-8") as _handle:
    MONITOR = json.load(_handle)
with open(os.path.join(SHELL, "examples", "performance_explainer.json"), encoding="utf-8") as _handle:
    EXPLAINER = json.load(_handle)
with open(os.path.join(SHELL, "examples", "dashboard.json"), encoding="utf-8") as _handle:
    DASHBOARD = json.load(_handle)


def forecast(**changes):
    out = copy.deepcopy(FORECAST)
    out.update(changes)
    return out


def problems(page):
    return shell_sql.spec_problems(page) or shell_sql.quality_problems(page)


def layout(ident):
    return next(l for l in KINDS["layouts"] if l["id"] == ident)


def test_the_kinds_registry_lists_every_layout_with_sections_minimum_items_and_a_known_contract():
    ids = [l["id"] for l in KINDS["layouts"]]
    assert len(ids) == len(set(ids)) and shell_sql.DEFAULT_LAYOUT in ids
    for l in KINDS["layouts"]:
        assert set(l["min_items"]) <= set(l["sections"]), l["id"]
        assert l["contract"] is None or l["contract"] in KINDS["contracts"], l["id"]
    for ident in set(shell_sql.enabled_layouts()) - {shell_sql.DEFAULT_LAYOUT}:
        sections = layout(ident)["sections"]
        assert sections[0] == "todo", f"{ident} opens with What to do now"
        assert set(layout(ident)["min_items"]) <= set(shell_sql.SECTIONS), f"{ident} needs items in a section the shell does not draw"
        assert len(set(sections) & set(shell_sql.SECTIONS)) >= len(sections) - 2, f"{ident} leaves more than 2 sections undrawn"
        suffixes = (KINDS["contracts"].get(layout(ident)["contract"]) or {}).get("suffixes") or {}
        assert {(shell_sql.SECTIONS.get(s) or {}).get("suffix") for s in layout(ident)["min_items"]} - {None} <= set(suffixes), ident
    assert set(shell_sql.enabled_layouts()) >= {"decision_queue", "forecast_cockpit", "planner", "scenario_lab"}


def test_the_layout_examples_pass_the_spec_and_quality_checks_and_each_names_an_enabled_layout():
    folder = os.path.join(SHELL, "examples")
    names = sorted(n[:-5] for n in os.listdir(folder) if n.endswith(".json"))
    assert names and "decision_queue" not in names
    for name in names:
        with open(os.path.join(folder, f"{name}.json"), encoding="utf-8") as handle:
            page = json.load(handle)
        assert page["layout"] == name and page["version"] == shell_sql.SPEC_VERSION
        assert problems(page) == [], name
        assert layout(name)["enabled"] is True, name
    assert set(names) <= set(shell_sql.enabled_layouts())


def test_a_version_1_page_loads_as_a_decision_queue_and_a_version_2_page_must_name_its_layout():
    old = dict(copy.deepcopy(PAGE), version=1)
    old.pop("layout")
    assert problems(old) == []
    assert shell_sql.page_layout(old) == "decision_queue"
    bare = copy.deepcopy(PAGE)
    bare.pop("layout")
    assert any("names its layout" in p for p in shell_sql.spec_problems(bare))
    assert any("version must be" in p or "version" in p for p in shell_sql.spec_problems(dict(PAGE, version=3)))


@pytest.mark.parametrize("name, fragment", [("nowhere", "is not one of"), ("monitor_triage", "is not served yet")])
def test_an_unknown_or_unserved_layout_is_refused(name, fragment, monkeypatch):
    registry = copy.deepcopy(shell_sql.kinds_registry())
    for item in registry["layouts"]:
        if item["id"] == "monitor_triage":
            item["enabled"] = False
    monkeypatch.setitem(shell_sql._REGISTRY, "data", registry)
    assert any(fragment in p for p in shell_sql.spec_problems(forecast(layout=name)))
    assert "monitor_triage" not in shell_sql.enabled_layouts()


def test_a_decision_queue_page_still_needs_a_drivers_chart_and_a_forecast_page_does_not():
    plain = copy.deepcopy(PAGE)
    for c in plain["charts"]:
        c.pop(shell_sql.DRIVER, None)
    assert any("Drivers chart" in p for p in shell_sql.quality_problems(plain))
    assert not any("Drivers chart" in p for p in shell_sql.quality_problems(FORECAST))


def test_a_forecast_page_without_its_fan_chart_is_refused_with_the_section_it_misses():
    page = forecast(charts=[c for c in FORECAST["charts"] if c["section"] != "fan_chart"])
    assert any("needs 1 item in its fan_chart section" in p for p in shell_sql.spec_problems(page))


def test_a_forecast_page_without_its_decision_list_is_refused():
    page = forecast()
    page.pop("records")
    page.pop("plan")
    assert any("at_risk_series section" in p for p in shell_sql.spec_problems(page))


def forecast_count_problems(page, kinds):
    kpi = next(k for k in page["kpis"] if k["id"] == "at_risk_n")
    sql = next(d["sql"] for d in page["datasets"] if d["name"] == kpi["dataset"])
    having = sql.split(" HAVING ", 1)[1] if " HAVING " in sql else ""
    problems = []
    if not re.fullmatch(r"MAX\(\s*(?:\w+\.)?backtest_mase\s*\)\s*>\s*1", having.strip()):
        problems.append(f"the count selects {having!r}, not only the series whose forecast is worse than naive")
    table = next(t for t in page["tables"] if t["dataset"] == kpi["dataset"])
    story = next((s for s in re.split(r"(?<=[.;])\s+", page["story"]) if "{at_risk_n}" in s), "")
    for where, text in (("KPI label", kpi["label"]), ("table title", table["title"]), ("table hint", table["hint"]), ("story", story)):
        if "naive" not in text.lower():
            problems.append(f"the {where} {text!r} does not say it counts the series worse than naive")
    for kind in kinds["kinds"]:
        if kind["layout"] != "forecast_cockpit":
            continue
        texts = [kind["question"], kind["serving_template"]] + [w["title"] for w in kind["dashboard"]["widgets"]]
        problems += [f"kind {kind['id']} says {text!r}" for text in texts if re.search(r"at[ -]risk", text, re.I)]
    return problems


def test_the_forecast_at_risk_count_has_one_meaning_and_every_label_says_what_it_counts():
    assert forecast_count_problems(FORECAST, KINDS) == []
    old = copy.deepcopy(FORECAST)
    at_risk = next(d for d in old["datasets"] if d["name"] == "at_risk")
    at_risk["sql"] += " OR SUM(CASE WHEN s.is_future THEN s.upper - s.forecast END) > 0"
    next(k for k in old["kpis"] if k["id"] == "at_risk_n")["label"] = "Items at risk"
    table = next(t for t in old["tables"] if t["id"] == "at_risk")
    table.update(title="Items at risk", hint="Items whose forecast is weak or whose range runs high.")
    old_kinds = copy.deepcopy(KINDS)
    forecast = next(k for k in old_kinds["kinds"] if k["id"] == "forecast")
    forecast["dashboard"]["widgets"][2]["title"] = "At-risk series"
    found = forecast_count_problems(old, old_kinds)
    assert found == ["the count selects 'MAX(s.backtest_mase) > 1 OR SUM(CASE WHEN s.is_future THEN s.upper - s.forecast END) > 0', "
                     "not only the series whose forecast is worse than naive",
                     "the KPI label 'Items at risk' does not say it counts the series worse than naive",
                     "the table title 'Items at risk' does not say it counts the series worse than naive",
                     "the table hint 'Items whose forecast is weak or whose range runs high.' does not say it counts the series worse than naive",
                     "kind forecast says 'At-risk series'"]


@pytest.mark.parametrize("change, fragment", [
    ({"y": FORECAST["charts"][0]["y"][:3]}, "4 measures"),
    ({"series": {"column": "category", "top": 3}}, "cannot split into series"),
    ({"x": {"column": "series_label", "kind": "category", "label": "Item"}}, "x kind must be time"),
    ({"section": "accuracy_by_series"}, "goes in one of: fan_chart, forecast_vs_capacity"),
])
def test_a_band_chart_needs_time_on_x_four_measures_no_series_and_the_right_section(change, fragment):
    page = forecast()
    page["charts"][0].update(change)
    assert any(fragment in p for p in shell_sql.spec_problems(page)), shell_sql.spec_problems(page)


def test_a_table_cannot_sit_in_a_chart_only_section():
    page = forecast()
    page["tables"][0]["section"] = "fan_chart"
    assert any("table at_risk names section 'fan_chart'" in p and "accuracy_by_series" in p for p in shell_sql.spec_problems(page))


def test_the_fan_chart_must_read_the_series_companion_table():
    page = forecast()
    page["datasets"][1]["sql"] = page["datasets"][1]["sql"].replace("demand_out__series", "demand_history")
    found = shell_sql.quality_problems(page)
    assert any("reads main.supply.demand_out__series" in p for p in found), found
    assert shell_sql.quality_problems(FORECAST) == []


@pytest.mark.parametrize("change, fragment", [
    ({"recommended": None}, "recommended column"),
    ({"title": ""}, "has no title"),
    ({"delta": "not a column"}, "delta must be a column"),
])
def test_the_plan_needs_its_title_and_its_current_and_recommended_columns(change, fragment):
    page = forecast()
    page["plan"].update(change)
    assert any(fragment in p for p in shell_sql.spec_problems(page))


def test_a_plan_on_a_page_without_a_decision_list_section_is_refused():
    page = forecast(layout="decision_queue")
    assert shell_sql.layout_problems(page, set()) == []
    assert shell_sql.plan_problems(FORECAST["plan"], False, False) == ["only a page with a decision list has a plan section"]
    assert shell_sql.plan_problems(FORECAST["plan"], False, True) == []


def test_a_dashboard_tile_needs_its_so_what_line_and_other_layouts_take_it_as_optional():
    assert "dashboard" in shell_sql.SO_WHAT_LAYOUTS
    page = forecast()
    page["charts"][0].pop("so_what")
    assert problems(page) == []
    page["charts"][0]["so_what"] = "x" * 161
    assert any("so_what is longer than 160 characters" in p for p in shell_sql.spec_problems(page))


def test_the_bridge_chart_reads_its_steps_in_their_order():
    page = forecast()
    page["charts"].append({"id": "walk", "title": "Walk", "type": "bridge", "dataset": "series",
                           "x": {"column": "series_label", "kind": "category", "order": "period"}, "y": [{"label": "Change", "expression": "SUM(forecast)"}]})
    sql, _params = shell_sql.chart_query(page, "walk", {})
    assert "MIN(`period`) AS o" in sql and sql.index("ORDER BY o ASC") > sql.index("GROUP BY")
    page["charts"][-1]["x"].pop("order")
    assert any("bridge" in p and "order" in p for p in shell_sql._chart_problems(page["charts"][-1], {"series"}))


def test_the_public_page_carries_the_layout_its_sections_the_plan_and_each_so_what_line():
    public = shell_core.public_page(FORECAST)
    assert public["layout"] == {"id": "forecast_cockpit", "label": "Forecast cockpit", "tab_label": "Forecast",
                                "contract": "forecast", "sections": layout("forecast_cockpit")["sections"], "decides": True, "informational": False,
                                "holds": {"todo": "todo", "kpis": "kpis", "horizon_selector": "horizon", "at_risk_series": "plan"}}
    assert public["plan"]["recommended"] == "recommended_order" and public["scenario"] is None
    fan = next(c for c in public["charts"] if c["id"] == "fan")
    assert fan["section"] == "fan_chart" and fan["type"] == "band" and fan["so_what"].startswith("Order to the forecast")
    assert public["tables"][0]["section"] == "accuracy_by_series"
    assert shell_core.public_page(PAGE)["layout"]["id"] == "decision_queue"


@pytest.mark.parametrize("decision, reason, value, fragment", [
    ("maybe", "", None, "accept or override"),
    ("override", "", 90, "needs a reason"),
    ("override", "Supplier is short", None, "override value is a number"),
    ("override", "x" * 501, 90, "at most 500"),
])
def test_a_plan_decision_refuses_a_bad_choice_an_override_without_a_reason_or_a_value(decision, reason, value, fragment):
    with pytest.raises(ValueError, match=fragment):
        shell_sql.plan_decision(FORECAST["plan"], decision, reason, value, 120)


def test_a_plan_decision_writes_the_status_and_a_note_saying_what_was_chosen():
    assert shell_sql.plan_decision(FORECAST["plan"], "accept", "", None, 120) == {
        "action_status": "Done", "note": "Accepted the recommended 120"}
    assert shell_sql.plan_decision(FORECAST["plan"], "override", " Supplier  is short ", 90, 120) == {
        "action_status": "Done", "note": "Override to 90 instead of 120: Supplier is short"}


def plan_shell(tmp_path, settings=DECIDE, ws=None):
    page = forecast(id="n01_u05")
    return shell(tmp_path, settings=settings, pages=[page], ws=ws)


def test_post_plan_decide_records_the_decision_through_the_record_act_path(tmp_path, capsys):
    s, ws, _made = plan_shell(tmp_path)
    status, out = call(s, "POST", "plan/decide", headers=EDITOR, body={"page": "n01_u05", "record_key": "k1", "seen": "101",
                                                                         "decision": "override", "value": 90, "reason": "Supplier is short",
                                                                         "recommended": 120})
    assert status == 200, out
    assert out["written"] == ["k1"] and out["decision"] == "override" and out["edited"] is False
    (_sql, params), = ws.queries("MERGE INTO")
    assert "Override to 90 instead of 120: Supplier is short" in {p["value"] for p in params}
    assert "[PLAN-DECIDE FIRED] page=n01_u05 decision=override edited=False" in capsys.readouterr().out


@pytest.mark.parametrize("body, fragment", [
    ({"record_key": "", "seen": "101", "decision": "accept", "recommended": 1}, "record_key"),
    ({"record_key": "k1", "seen": "soon", "decision": "accept", "recommended": 1}, "valid_from_us"),
    ({"record_key": "k1", "seen": "101", "decision": "override", "value": 3, "recommended": 1}, "needs a reason"),
])
def test_post_plan_decide_refuses_bad_input_before_any_write(tmp_path, body, fragment):
    s, ws, _made = plan_shell(tmp_path)
    status, out = call(s, "POST", "plan/decide", headers=EDITOR, body=dict({"page": "n01_u05"}, **body))
    assert status == 400 and fragment in out["error"]
    assert ws.queries("MERGE INTO") == []


def test_post_plan_decide_needs_decisions_on_and_a_page_with_a_plan(tmp_path, capsys):
    s, _ws, _made = plan_shell(tmp_path, settings=SETTINGS)
    status, out = call(s, "POST", "plan/decide", headers=EDITOR, body={"page": "n01_u05", "record_key": "k1", "seen": "101",
                                                                         "decision": "accept", "recommended": 1})
    assert status == 403 and "record decisions" in out["error"]
    assert "PLAN-DECIDE FIRED" not in capsys.readouterr().out
    (tmp_path / "plain").mkdir()
    s, _ws, _made = shell(tmp_path / "plain", settings=DECIDE, pages=[dict(copy.deepcopy(PAGE), result_table="main.pricing.loss_desk_out")])
    status, out = call(s, "POST", "plan/decide", headers=EDITOR, body={"page": "n01_u05", "record_key": "k1", "seen": "101", "decision": "accept"})
    assert status == 404 and "no plan" in out["error"]


def test_a_plan_with_an_override_column_and_decisions_off_writes_the_chosen_value_through_the_edit_path(tmp_path, capsys):
    page = edits.edit_page(plan={"title": "Order plan", "current": "rank", "recommended": "value", "override": "value"})
    assert shell_sql.spec_problems(page) == []
    s, ws, _made = edits.shell(tmp_path, pages=[page])
    status, out = call(s, "POST", "plan/decide", headers=edits.EDITOR, body={"page": "n01_u05", "record_key": "42", "seen": edits.V2[edits.VERSION],
                                                                           "decision": "accept", "recommended": 120})
    assert status == 200, out
    assert out["edited"] is True and out["written"] == ["42"] and out["batch_id"] is None
    (_sql, params), = ws.merges()
    assert "120" in json.dumps(params) and "action_status" not in json.dumps(params)
    assert "[PLAN-DECIDE FIRED] page=n01_u05 decision=accept edited=True" in capsys.readouterr().out
    page["plan"].pop("override")
    (tmp_path / "plain").mkdir()
    s, ws, _made = edits.shell(tmp_path / "plain", pages=[page])
    status, out = call(s, "POST", "plan/decide", headers=edits.EDITOR, body={"page": "n01_u05", "record_key": "42", "seen": edits.V2[edits.VERSION],
                                                                           "decision": "accept", "recommended": 120})
    assert status == 403 and ws.merges() == []


def test_the_planner_example_reads_its_plan_and_constraints_companions_and_refuses_a_plan_that_does_not():
    assert problems(PLANNER) == []
    assert [c["type"] for c in PLANNER["charts"] if c["section"] == "constraint_bars"] == ["bullet"]
    broken = copy.deepcopy(PLANNER)
    broken["datasets"][0]["sql"] = broken["datasets"][0]["sql"].replace("production_out__plan", "production_plan")
    found = shell_sql.quality_problems(broken)
    assert any("reads main.supply.production_out__plan" in p for p in found), found
    gone = copy.deepcopy(PLANNER)
    gone["charts"] = [c for c in gone["charts"] if c["section"] != "constraint_bars"]
    assert any("constraint_bars section" in p for p in shell_sql.spec_problems(gone)), shell_sql.spec_problems(gone)
    public = shell_core.public_page(PLANNER)
    assert public["layout"]["tab_label"] == "Plan" and public["plan"]["recommended"] == "recommended_value"


def test_the_monitor_example_draws_its_signal_from_the_signal_companion_and_needs_twenty_rows_in_its_triage_queue(capsys):
    assert problems(MONITOR) == []
    assert shell_sql.row_minimums(MONITOR) == [("triage_queue", 20, ("records", "records"))]
    assert shell_sql.row_problems(MONITOR, {("records", "records"): 19})
    assert shell_sql.row_problems(MONITOR, {("records", "records"): 20}) == []
    capsys.readouterr()
    moved = copy.deepcopy(MONITOR)
    signal = next(d for d in moved["datasets"] if d["name"] == "signal")
    signal["sql"] = signal["sql"].replace("billing_out__signal", "billing_signal")
    found = shell_sql.quality_problems(moved)
    assert any("signal_band section" in p and "reads main.finance.billing_out__signal" in p for p in found), found
    listless = copy.deepcopy(MONITOR)
    listless.pop("records")
    assert any("triage_queue section" in p for p in shell_sql.spec_problems(listless))
    public = shell_core.public_page(MONITOR)
    assert public["layout"]["tab_label"] == "Triage" and public["layout"]["decides"] is True


def test_the_explainer_reads_its_variance_bridge_and_peer_companions_and_refuses_a_variance_list_that_does_not():
    assert problems(EXPLAINER) == []
    assert shell_sql.row_minimums(EXPLAINER) == [("variance_table", 10, ("records", "records")), ("bridge", 3, ("chart", "walk"))]
    for name, table in (("records", "unit_perf_out__variance"), ("walk", "unit_perf_out__bridge"), ("peers", "unit_perf_out__peers")):
        broken = copy.deepcopy(EXPLAINER)
        dataset = next(d for d in broken["datasets"] if d["name"] == name)
        dataset["sql"] = dataset["sql"].replace(table, table.replace("__", "_old_"))
        found = shell_sql.quality_problems(broken)
        assert any(f"reads main.finance.{table}" in p for p in found), (name, found)
    walkless = copy.deepcopy(EXPLAINER)
    walkless["charts"] = [c for c in walkless["charts"] if c["section"] != "bridge"]
    assert any("bridge section" in p for p in shell_sql.spec_problems(walkless))


def test_the_bridge_is_one_walk_per_run_so_no_filter_needs_to_reach_it_but_every_other_dataset_still_does():
    assert shell_sql.run_level_datasets(EXPLAINER) == {"walk"}
    assert shell_sql.run_level_datasets(MONITOR) == set() and shell_sql.run_level_datasets(DASHBOARD) == set()
    loose = copy.deepcopy(EXPLAINER)
    for f in loose["filters"]:
        f["columns"].pop("peers", None)
    found = shell_sql.quality_problems(loose)
    assert any("no filter reaches chart vs_peers" in p for p in found) and not any("dataset walk" in p for p in found), found
    thin = copy.deepcopy(EXPLAINER)
    thin["filters"] = [f for f in thin["filters"] if f["type"] == "date_range"]
    assert any("segment filter" in p for p in shell_sql.quality_problems(thin)), "a bridge does not excuse the page from its segment filters"


def test_the_dashboard_records_no_decisions_and_each_chart_and_table_needs_its_so_what_line():
    assert problems(DASHBOARD) == [] and "records" not in DASHBOARD
    public = shell_core.public_page(DASHBOARD)
    assert public["layout"]["decides"] is False and public["layout"]["tab_label"] == "Overview"
    assert all(item["so_what"] for group in ("charts", "tables") for item in public[group])
    for group in ("charts", "tables"):
        bare = copy.deepcopy(DASHBOARD)
        bare[group][0].pop("so_what")
        assert any(f"{group[:-1]} {DASHBOARD[group][0]['id']} has no so_what" in p for p in shell_sql.spec_problems(bare)), shell_sql.spec_problems(bare)
    one = copy.deepcopy(DASHBOARD)
    one["charts"] = one["charts"][:1]
    assert any("needs 2 items in its charts section" in p for p in shell_sql.spec_problems(one)), shell_sql.spec_problems(one)


def test_the_funnel_takes_bars_and_the_quote_cards_take_a_table():
    page = copy.deepcopy(EXPLAINER)
    page["tables"][1]["section"] = "funnel"
    assert any("table said names section 'funnel'" in p for p in shell_sql.spec_problems(page))
    page = copy.deepcopy(EXPLAINER)
    page["charts"].append({"id": "steps", "section": "funnel", "title": "From lead to order", "hint": "Units at each step.", "type": "horizontal_bar", "dataset": "peers",
                           "x": {"column": "metric", "kind": "category"}, "y": [{"label": "Units", "expression": "COUNT(*)", "format": "integer"}]})
    assert shell_sql.spec_problems(page) == []
    page["charts"][-1]["section"] = "quote_cards"
    assert any("chart steps names section 'quote_cards'" in p for p in shell_sql.spec_problems(page))


def test_a_section_counted_in_rows_needs_its_minimum_rows_at_the_default_filters(capsys):
    assert shell_sql.row_minimums(FORECAST) == [("at_risk_series", 5, ("records", "records"))]
    found = shell_sql.row_problems(FORECAST, {("records", "records"): 3})
    assert found == ["the at_risk_series section of a forecast_cockpit page shows at least 5 rows; the decision list returned 3 at the default "
                     "filters, so widen what it selects: the order for each series, to accept or override"]
    assert "[LAYOUT-ROWS FIRED] page=n02_u03 short=1" in capsys.readouterr().out
    assert shell_sql.row_problems(FORECAST, {("records", "records"): 5}) == []
    assert shell_sql.row_problems(PAGE, {("records", "records"): 1}) == []
    assert "LAYOUT-ROWS FIRED" not in capsys.readouterr().out


def test_a_kpi_goes_in_the_objective_section_only_on_a_page_that_has_one():
    assert shell_core.public_page(PLANNER)["kpis"][0]["section"] == "objective_kpi"
    page = forecast()
    page["kpis"][0]["section"] = "objective_kpi"
    assert any("KPI next_forecast names section 'objective_kpi'" in p for p in shell_sql.spec_problems(page))


MODEL = [{"driver": "price", "coefficient": 400000}, {"driver": "volume", "coefficient": 9}, {"driver": "unit_cost", "coefficient": -400000}]
BASE = {"scenario_id": "base", "lever_values": json.dumps({"price": 12, "volume": 400000, "unit_cost": 7}), "outcome": 5000000,
        "p10": 4600000, "p50": 5000000, "p90": 5400000, "prob_target": 0.31}


def test_a_scenario_moves_the_p50_by_each_lever_coefficient_keeps_the_base_range_and_clamps_a_lever_to_ten_percent():
    out = shell_sql.scenario_outcome(MODEL, BASE, {"price": 13, "unit_cost": 6.5}, 5200000)
    assert out["outcome"]["p50"] == pytest.approx(5000000 + 400000 + 200000)
    assert out["outcome"]["p90"] - out["outcome"]["p10"] == pytest.approx(800000)
    assert 0.5 < out["outcome"]["prob_target"] < 1 and out["clamped"] == []
    far = shell_sql.scenario_outcome(MODEL, BASE, {"price": 40}, 5200000)
    assert far["clamped"] == ["price"] and far["levers"][0]["value"] == pytest.approx(13.2)
    assert far["outcome"]["p50"] == pytest.approx(5000000 + 400000 * 1.2)
    same = shell_sql.scenario_outcome(MODEL, BASE, {}, None)
    assert same["outcome"]["p50"] == 5000000 and same["outcome"]["prob_target"] is None
    pairs = dict(BASE, lever_values=[{"key": "price", "value": 12}, {"key": "volume", "value": 400000}, {"key": "unit_cost", "value": 7}])
    assert shell_sql.scenario_outcome(MODEL, pairs, {"price": 13})["outcome"]["p50"] == pytest.approx(5400000)


@pytest.mark.parametrize("values, base, fragment", [
    ({"discount": 3}, BASE, "no lever discount"),
    ({"price": "a lot"}, BASE, "lever price"),
    ([1, 2], BASE, "object of lever to number"),
    ({}, dict(BASE, lever_values="not json"), "map of lever to value"),
    ({}, dict(BASE, lever_values=json.dumps({"price": 12})), "no value for lever volume"),
])
def test_a_scenario_refuses_an_unknown_lever_a_word_for_a_number_and_a_base_without_lever_values(values, base, fragment):
    with pytest.raises(ValueError, match=fragment):
        shell_sql.scenario_outcome(MODEL, base, values)


def test_a_scenario_evaluates_in_under_300_ms_with_the_most_levers():
    model = [{"driver": f"l{i}", "coefficient": i + 1} for i in range(shell_sql.SCENARIO_LEVERS[1])]
    base = {"p10": 90, "p50": 100, "p90": 110, "lever_values": {f"l{i}": 10 for i in range(len(model))}}
    start = time.perf_counter()
    for _ in range(100):
        shell_sql.scenario_outcome(model, base, {f"l{i}": 10.5 for i in range(len(model))}, 105)
    assert (time.perf_counter() - start) / 100 < 0.3


class ScenarioWorkspace(DataWorkspace):
    def answer(self, sql, params):
        if "__scenario_model" in sql and "LIMIT 0" not in sql:
            return {"columns": [], "rows": MODEL, "truncated": False}
        if "__scenarios" in sql and "LIMIT 0" not in sql:
            return {"columns": [], "rows": [BASE, dict(BASE, scenario_id="upside", p50=5600000)], "truncated": False}
        return super().answer(sql, params)


def test_post_scenario_evaluate_reads_the_model_and_the_base_case_and_logs_the_evaluation(tmp_path, capsys):
    s, _ws, _made = shell(tmp_path, settings=SETTINGS, pages=[dict(copy.deepcopy(SCENARIO), id="n01_u05")], ws=ScenarioWorkspace())
    status, out = call(s, "POST", "scenario/evaluate", headers=EDITOR, body={"page": "n01_u05", "values": {"price": 13}})
    assert status == 200, out
    assert out["outcome"]["p50"] == pytest.approx(5400000) and out["outcome"]["target"] == 5200000
    assert [l["lever"] for l in out["levers"]] == ["price", "volume", "unit_cost"]
    assert "[SCENARIO-EVAL FIRED] page=n01_u05 levers=3 clamped=0 p50=5,400,000" in capsys.readouterr().out
    status, out = call(s, "POST", "scenario/evaluate", headers=EDITOR, body={"page": "n01_u05", "values": {"discount": 1}})
    assert status == 400 and "no lever discount" in out["error"]
    assert "SCENARIO-EVAL FIRED" not in capsys.readouterr().out


def test_the_scenario_lab_example_passes_with_one_chart_because_the_layout_draws_its_outcome_and_gauge():
    assert problems(SCENARIO) == []
    assert shell_sql.drawn_charts(SCENARIO) == 3 and shell_sql.drawn_charts(FORECAST) == 0
    no_target = copy.deepcopy(SCENARIO)
    no_target["scenario"]["outcome"].pop("target")
    assert shell_sql.drawn_charts(no_target) == 2 and shell_sql.spec_problems(no_target) == []
    bare = forecast()
    bare["charts"] = [c for c in bare["charts"] if c["section"] == "fan_chart"]
    assert any("charts; it needs 3 to" in p for p in shell_sql.spec_problems(bare)), shell_sql.spec_problems(bare)


def test_the_scenario_lab_needs_no_segment_filters_on_its_run_level_tables_but_other_layouts_still_do():
    assert shell_sql.run_level_datasets(SCENARIO) == {"model", "scenarios", "sensitivity"}
    assert shell_sql.run_level_datasets(FORECAST) == set()
    thin = forecast()
    thin["filters"] = [f for f in thin["filters"] if f["type"] == "date_range"]
    assert any("segment filter" in p for p in shell_sql.quality_problems(thin))
    loose = copy.deepcopy(SCENARIO)
    loose["kpis"].append({"id": "extra", "label": "Rows read", "dataset": "outside", "expression": "COUNT(*)", "format": "integer", "good": "neutral"})
    loose["datasets"].append({"name": "outside", "sql": "SELECT region FROM main.finance.targets"})
    assert any("no filter reaches KPI extra" in p for p in shell_sql.quality_problems(loose))


@pytest.mark.parametrize("save, ok", [
    ({"name": "scenario_name", "levers": "lever_values", "outcome": "expected_outcome"}, True),
    ({"name": "scenario_name", "levers": "lever_values"}, False),
    ({"name": "scenario name", "levers": "lever_values", "outcome": "expected_outcome"}, False),
    ("scenario_name", False),
])
def test_the_scenario_save_names_three_result_table_columns(save, ok):
    page = copy.deepcopy(SCENARIO)
    page["scenario"]["save"] = save
    found = [p for p in shell_sql.spec_problems(page) if "scenario save" in p]
    assert (found == []) is ok, found
    if ok:
        assert shell_core.public_page(page)["scenario"]["save"] == save


def _modules(ns, tmp_path):
    payload = ns["implement_app_shell_payload"](ns["inspire_notebook_asset"]("app_shell"))
    return payload, ns["implement_app_shell_modules"](str(tmp_path / "_shell"), payload["files"])


def test_the_notebook_ships_the_kind_registry_with_the_app_its_modules_and_the_page_checker(agent_ns, tmp_path):
    payload, modules = _modules(agent_ns, tmp_path)
    assert json.loads(payload["files"]["kinds.json"]) == agent_ns["_inspire_kinds"]()
    assert set(modules["shell_sql"].enabled_layouts()) == {l["id"] for l in agent_ns["_inspire_kinds"]()["layouts"] if l["enabled"]}
    assert (tmp_path / "_shell" / "kinds.json").is_file()
    tools = agent_ns["implement_app_check_files"](payload["files"], False)
    assert tools[".inspire_check/kinds.json"] == payload["files"]["kinds.json"]
    assert sorted(payload["examples"]) == sorted(n[:-5] for n in os.listdir(os.path.join(SHELL, "examples")))


@pytest.mark.parametrize("use_case, asks, layout", [
    ({"Analytics Technique": "Forecasting"}, "", "forecast_cockpit"),
    ({"Analytics Technique": "Classification"}, "", "decision_queue"),
    ({"use_case_kind": "driver_scenarios", "Analytics Technique": "Classification"}, "", "scenario_lab"),
    ({"use_case_kind": "allocation"}, "", "planner"),
    ({"app_layout": "dashboard", "use_case_kind": "allocation"}, "", "dashboard"),
    ({"app_layout": "kanban", "use_case_kind": "allocation"}, "", "planner"),
    ({"use_case_kind": "segmentation"}, "", "segment_explorer"),
    ({"use_case_kind": "anomaly"}, "", "monitor_triage"),
    ({"Analytics Technique": "Anomaly Detection"}, "", "monitor_triage"),
    ({"use_case_kind": "variance_to_plan"}, "", "performance_explainer"),
    ({"use_case_kind": "driver_breakdown"}, "", "dashboard"),
    ({"use_case_kind": "anomaly"}, "Use the dashboard layout, we only read it", "dashboard"),
    ({"use_case_kind": "anomaly"}, "also build a dashboard for the billing team", "monitor_triage"),
    ({"Analytics Technique": "Forecasting"}, "Use the planner layout for the buyers", "planner"),
    ({"Analytics Technique": "Forecasting"}, "for the planner team to read", "forecast_cockpit"),
    ({"use_case_kind": "allocation"}, "show it as a decision_queue", "decision_queue"),
])
def test_the_app_layout_follows_the_users_ask_then_the_use_case_then_its_kind_and_only_a_served_layout(agent_ns, tmp_path, use_case, asks,
                                                                                                        layout):
    assert agent_ns["implement_app_layout"](use_case, asks)[0] == layout


def test_a_layout_needs_every_companion_table_and_column_of_its_contract(agent_ns, tmp_path):
    shell_sql = _modules(agent_ns, tmp_path)[1]["shell_sql"]
    tables = agent_ns["implement_layout_tables"]("main.s.margin_out", "scenario_lab")
    assert tables == {"main.s.margin_out__scenarios": ["scenario_id", "lever_values", "outcome", "p10", "p50", "p90", "prob_target"],
                      "main.s.margin_out__sensitivity": ["lever", "low", "high", "delta"],
                      "main.s.margin_out__scenario_model": ["driver", "coefficient"]}
    assert sorted(agent_ns["implement_layout_tables"]("main.s.margin_out", "decision_queue")) == [
        "main.s.margin_out__lift", "main.s.margin_out__score_bins"]
    assert agent_ns["implement_layout_tables"]("", "scenario_lab") == {} and agent_ns["implement_layout_tables"]("t", "no_such") == {}
    assert agent_ns["INSPIRE_DEFAULT_LAYOUT"] == shell_sql.DEFAULT_LAYOUT
    for ident in shell_sql.layouts():
        assert agent_ns["implement_layout_tables"]("t", ident) == {
            f"t{suffix}": list(columns) for suffix, columns in shell_sql.layout_contract({"layout": ident}).items()}
    full = {t: [(c, "string") for c in cols] for t, cols in tables.items()}
    assert agent_ns["implement_layout_missing"](tables, full) == {}
    short = dict(full, **{"main.s.margin_out__sensitivity": [("lever", "string"), ("low", "double")]})
    short["main.s.margin_out__scenario_model"] = None
    short["main.s.margin_out__scenarios"] = "PERMISSION_DENIED"
    assert agent_ns["implement_layout_missing"](tables, short) == {
        "main.s.margin_out__scenarios": "cannot be read: PERMISSION_DENIED",
        "main.s.margin_out__sensitivity": "has no column high, delta",
        "main.s.margin_out__scenario_model": "does not exist"}


def _layout_inspire(ns, tmp_path, described):
    from v120_artifacts_support import FakeSpark, make_inspire

    def answer(statement):
        table = statement.split("DESCRIBE TABLE ", 1)[1].replace("`", "")
        if table not in described:
            raise RuntimeError(f"[TABLE_OR_VIEW_NOT_FOUND] {table}")
        return [{"col_name": c, "data_type": "string"} for c in described[table]]

    inst = make_inspire(ns, spark=FakeSpark(responder=answer), session_id=5150)
    inst.local_log_output_dir = str(tmp_path)
    return inst


def test_the_app_uses_a_layout_only_when_the_run_wrote_its_companion_tables_and_says_why_otherwise(agent_ns, tmp_path, capsys):
    contract = {"main.s.margin_out__scenarios": ["scenario_id", "lever_values", "outcome", "p10", "p50", "p90", "prob_target"],
                "main.s.margin_out__sensitivity": ["lever", "low", "high", "delta"],
                "main.s.margin_out__scenario_model": ["driver", "coefficient"]}
    warnings = []
    inst = _layout_inspire(agent_ns, tmp_path, contract)
    got = inst._implement_app_layout("N04-U01", {"use_case_kind": "driver_scenarios"}, {}, "main.s.margin_out", warnings, inst._implement_schema_reader())
    assert got == ("scenario_lab", contract) and warnings == []
    assert "[APP-LAYOUT FIRED] N04-U01: scenario_lab (the Driver-based scenarios kind draws it), companion tables=3" in capsys.readouterr().out
    inst = _layout_inspire(agent_ns, tmp_path / "b", {k: v for k, v in contract.items() if "sensitivity" not in k})
    got = inst._implement_app_layout("N04-U01", {"use_case_kind": "driver_scenarios"}, {}, "main.s.margin_out", warnings, inst._implement_schema_reader())
    assert got == ("decision_queue", {})
    assert warnings == ["App: the Scenario lab layout reads tables the run has not written yet (main.s.margin_out__sensitivity does not "
                        "exist), so the App page shows only the decision list, without the Scenario lab view, until a run writes "
                        "them"]
    assert "[APP-LAYOUT FIRED] N04-U01: scenario_lab -> decision_queue, missing=1" in capsys.readouterr().out
    warnings = []
    inst = _layout_inspire(agent_ns, tmp_path / "c", {"main.s.risk_out__score_bins": ["bin", "count", "cutoff"]})
    got = inst._implement_app_layout("N01-U01", {"Analytics Technique": "Classification"}, {}, "main.s.risk_out", warnings, inst._implement_schema_reader())
    assert got == ("decision_queue", {"main.s.risk_out__score_bins": ["bin", "count", "cutoff"]}) and warnings == []
    assert "[APP-LAYOUT FIRED] N01-U01: decision_queue (" in capsys.readouterr().out


def test_the_page_takes_its_layout_and_only_a_deciding_layout_needs_the_decision_list(agent_ns, tmp_path):
    shell_sql = _modules(agent_ns, tmp_path)[1]["shell_sql"]
    page = agent_ns["implement_app_page"](copy.deepcopy(SCENARIO), "N04-U01", {}, SCENARIO["result_table"], layout="scenario_lab")
    assert page["layout"] == "scenario_lab" and page["id"] == "n04_u01"
    allowed = [SCENARIO["result_table"]] + [f"{SCENARIO['result_table']}{s}" for s in ("__scenarios", "__sensitivity", "__scenario_model")]
    assert agent_ns["implement_app_page_problems"](page, shell_sql, allowed, False) == []
    stray = agent_ns["implement_app_page"](copy.deepcopy(SCENARIO), "N04-U01", {}, SCENARIO["result_table"], layout="decision_queue")
    stray["datasets"] = [d for d in stray["datasets"] if d["name"] != "records"]
    assert any("no dataset named records" in p for p in agent_ns["implement_app_page_problems"](stray, shell_sql, allowed, False))
    planner = agent_ns["implement_app_page"](copy.deepcopy(PLANNER), "N03-U02", {}, PLANNER["result_table"], layout="planner")
    planner["datasets"] = [d for d in planner["datasets"] if d["name"] != "records"]
    assert any("no dataset named records" in p for p in agent_ns["implement_app_page_problems"](planner, shell_sql, allowed, False))
    assert agent_ns["implement_app_page"](copy.deepcopy(PAGE), "N01-U01", {})["layout"] == PAGE.get("layout")


def test_a_deciding_layout_that_drops_its_whole_decision_list_is_sent_back_and_an_informational_one_is_not(agent_ns, tmp_path):
    shell_sql = _modules(agent_ns, tmp_path)[1]["shell_sql"]
    for layout in ("decision_queue", "planner", "scenario_lab"):
        page = {"layout": layout, "datasets": [{"name": "trend", "sql": "SELECT 1"}]}
        assert agent_ns["implement_page_decision_problems"](page, shell_sql), layout
    for layout in ("dashboard", "agent_chat"):
        page = {"layout": layout, "datasets": [{"name": "trend", "sql": "SELECT 1"}]}
        assert agent_ns["implement_page_decision_problems"](page, shell_sql) == [], layout


def test_the_layout_brief_names_its_sections_minimums_and_companion_tables_and_drops_the_list_only_for_a_layout_without_one(agent_ns, tmp_path):
    shell_sql = _modules(agent_ns, tmp_path)[1]["shell_sql"]
    brief = agent_ns["implement_layout_brief"]
    assert brief("decision_queue", {}, shell_sql) == "" and brief("", {}, shell_sql) == ""
    lab = brief("scenario_lab", {"main.s.m__scenarios": ["scenario_id", "p50"]}, shell_sql)
    assert 'Inspire sets layout to "scenario_lab"' in lab and "`main.s.m__scenarios` (scenario_id, p50)" in lab
    assert "scenario_table (a table of the base, upside and downside scenarios; put tables here, at least 3 rows at the default filters)" in lab
    assert "lever_sliders (the levers people move, at least 2 items)" in lab
    assert "leave out the records dataset" not in lab and "the user's asks win over both" in lab
    board = brief("dashboard", {}, shell_sql)
    assert "This layout has no decision list, so leave out the records dataset" in board
    cockpit = brief("forecast_cockpit", {}, shell_sql)
    assert "fan_chart (a band chart of actuals, forecast and its range; put charts of type band here, at least 1 items)" in cockpit
    assert "leave out the records dataset" not in cockpit


def test_the_page_checker_genie_runs_passes_each_layout_example_and_refuses_a_broken_one(agent_ns, tmp_path):
    import subprocess
    payload, _modules_ = _modules(agent_ns, tmp_path)
    for name, page in payload["examples"].items():
        work = tmp_path / f"work_{name}"
        agent_ns["implement_write_files"](str(work), agent_ns["implement_app_check_files"](payload["files"], False))
        (work / "page.json").write_text(json.dumps(page))
        done = subprocess.run([sys.executable, str(work / ".inspire_check" / "check_page.py")], cwd=str(tmp_path), capture_output=True,
                              text=True, timeout=60)
        assert (done.returncode, done.stdout.strip()) == (0, "no problems"), (name, done.stdout)
    broken = copy.deepcopy(payload["examples"]["scenario_lab"])
    broken["scenario"]["levers"] = broken["scenario"]["levers"][:1]
    (work / "page.json").write_text(json.dumps(broken))
    done = subprocess.run([sys.executable, str(work / ".inspire_check" / "check_page.py")], cwd=str(tmp_path), capture_output=True,
                          text=True, timeout=60)
    assert done.returncode == 1 and "levers" in done.stdout


def test_the_dashboard_draws_each_layout_chart_type_as_a_dashboard_chart(agent_ns):
    widgets = agent_ns["IMPLEMENT_DASHBOARD_CHART_WIDGETS"]
    assert {t: widgets[t] for t in ("band", "control", "tornado", "bridge", "bullet")} == {
        "band": "line", "control": "line", "tornado": "bar", "bridge": "bar", "bullet": "bar"}
    assert set(shell_sql.CHART_TYPES) <= set(widgets)


def test_genie_gets_the_example_and_the_brief_of_the_use_cases_layout_and_the_default_page_keeps_its_prompt(agent_ns, tmp_path):
    from v140_implement_test import _app_flow
    inst, context, seen = _app_flow(agent_ns, tmp_path / "a", assets={"genie_space": "g1"})
    inst._implement_app(context, None)
    plain = seen["prompt"]
    assert "Inspire sets layout to" not in plain and '"layout": "forecast_cockpit"' not in plain
    inst, context, seen = _app_flow(agent_ns, tmp_path / "b", assets={"genie_space": "g1"})
    context.update(app_layout="forecast_cockpit", layout_tables={"main.inspire.churn_out__series": ["series_id", "period", "actual"]})
    inst._implement_app(context, None)
    assert '"layout": "forecast_cockpit"' in seen["prompt"] and 'Inspire sets layout to "forecast_cockpit"' in seen["prompt"]
    assert "`main.inspire.churn_out__series` (series_id, period, actual)" in seen["prompt"]
    assert seen["prompt"].index("Inspire sets layout to") < seen["prompt"].index("The page follows this example")


def test_the_use_case_brief_names_the_kind_technique_layout_companion_tables_and_value_formula(agent_ns, tmp_path):
    from v140_implement_test import _output_inspire, _output_context
    inst, _calls = _output_inspire(agent_ns, tmp_path)
    context = _output_context(agent_ns)
    context["use_case"]["Analytics Technique"] = "Simulation"
    context.update(app_layout="scenario_lab", layout_tables={"main.inspire.churn_out__scenarios": ["scenario_id", "p50"]})
    brief = inst._implement_use_case_brief(context)
    kind = agent_ns["_inspire_kind_for_technique"]("Simulation")
    assert kind and f"\nKind: {kind['label']} ({kind['id']}), the question it answers: {kind['question']}\n" in brief
    about = agent_ns["inspire_kind_about"](context["use_case"])
    assert len(about) == 3 and all(f"\n{line}\n" in brief for line in about), "the value formula reaches Genie through the 3 plain lines"
    assert "\nTechnique: Simulation; App layout: scenario_lab\n" in brief
    assert "\nCompanion table `main.inspire.churn_out__scenarios`, with the columns scenario_id, p50\nDecision: " in brief
    assert brief.endswith("Input tables: `main.s.orders`\n")
    plain = inst._implement_use_case_brief(_output_context(agent_ns))
    assert "Kind:" not in plain and "Companion table" not in plain and "Technique:" not in plain, "a use case with no kind keeps its brief"
    bare = _output_context(agent_ns)
    bare.update(app_layout="decision_queue", layout_tables={"main.inspire.churn_out__lift": ["decile", "captured_share"]})
    assert "\nTechnique: not set; App layout: decision_queue\nCompanion table `main.inspire.churn_out__lift`, with the columns " \
           "decile, captured_share\nDecision: " in inst._implement_use_case_brief(bare)


def test_shell_files_without_kinds_json_still_get_the_registry_and_a_shipped_copy_wins(agent_ns, tmp_path):
    payload = agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))
    bare = {k: v for k, v in payload["files"].items() if k != "kinds.json"}
    registry = json.dumps(agent_ns["_inspire_kinds"](), indent=1, ensure_ascii=False) + "\n"
    assert agent_ns["implement_kinds_text"](bare) == registry
    assert agent_ns["implement_app_check_files"](bare, False)[".inspire_check/kinds.json"] == registry
    agent_ns["implement_app_shell_modules"](str(tmp_path / "s"), bare)
    assert (tmp_path / "s" / "kinds.json").read_text(encoding="utf-8") == registry
    assert agent_ns["implement_kinds_text"](dict(bare, **{"kinds.json": "{}"})) == "{}"


def test_the_row_minimum_skips_itself_only_when_the_page_quotes_the_user_asking_for_fewer_rows(capsys):
    short = {("records", "records"): 5}
    assert shell_sql.row_problems(MONITOR, short), "without an ask the minimum must still fire"
    for blank in ("", "   ", None, ["only the top 5"]):
        page = dict(MONITOR, fewer_rows=blank)
        assert shell_sql.row_problems(page, short), f"{blank!r} is no ask, so the minimum must still fire"
    capsys.readouterr()
    asked = dict(MONITOR, fewer_rows="show only the top 5 exceptions")
    assert shell_sql.row_problems(asked, short) == []
    assert "[LAYOUT-ROWS SKIPPED] page=" in capsys.readouterr().out
    assert shell_sql.row_problems(dict(PAGE, fewer_rows="only 5"), {("records", "records"): 1}) == []
    assert "[LAYOUT-ROWS SKIPPED]" not in capsys.readouterr().out, "a layout without row minimums has nothing to skip"
    assert shell_sql.spec_problems(asked) == shell_sql.spec_problems(MONITOR)


@pytest.mark.parametrize("quote,vibes,needle", [
    ("Show ONLY the top 5", "Keep it short: show only the top 5 exceptions each morning.", ""),
    (None, "show only the top 5", ""),
    ("", "", ""),
    ("only the top 10", "Keep it short: show only the top 5 exceptions each morning.",
     "which is not in the customer's asks for this App word for word: quote the words that ask for fewer rows"),
    ("show only the top 5", "", "but the customer gave no asks for this App: fill each section to its minimum rows"),
    (5, "show only the top 5", "fewer_rows must be text"),
])
def test_a_fewer_rows_quote_must_be_the_users_words_word_for_word(agent_ns, quote, vibes, needle):
    page = {} if quote is None else {"fewer_rows": quote}
    problems = agent_ns["implement_fewer_problems"](page, "fewer_rows", vibes, "App", "fewer rows than the layout's sections show",
                                                    "fill each section to its minimum rows")
    assert (problems == []) if not needle else (len(problems) == 1 and needle in problems[0]), problems


def test_the_layout_brief_tells_genie_how_to_keep_the_users_fewer_rows_only_on_a_layout_with_row_minimums(agent_ns, tmp_path):
    shell_sql_nb = _modules(agent_ns, tmp_path)[1]["shell_sql"]
    brief = agent_ns["implement_layout_brief"]
    assert "set the top-level field fewer_rows to the words of those asks" in brief("monitor_triage", {}, shell_sql_nb)
    assert "fewer_rows" not in brief("dashboard", {}, shell_sql_nb)


def planned():
    page = copy.deepcopy(PLANNER)
    page["datasets"] += [
        {"name": "schedule", "sql": "SELECT p.entity, p.start_date, p.end_date FROM main.supply.production_out__plan AS p"},
        {"name": "flows", "sql": "SELECT p.entity, p.decision, p.recommended_value FROM main.supply.production_out__plan AS p"},
    ]
    page["filters"].append({"id": "line", "type": "multi_select", "label": "Line", "columns": {"schedule": "entity", "flows": "entity"}})
    page["charts"] += [
        {"id": "when", "section": "gantt", "title": "When each line runs", "hint": "Each bar runs from the first to the last day of a line.", "type": "gantt", "dataset": "schedule",
         "x": {"column": "entity", "kind": "category", "label": "Line"},
         "y": [{"label": "Start", "expression": "MIN(start_date)", "format": "date"},
               {"label": "End", "expression": "MAX(end_date)", "format": "date"}]},
        {"id": "moves", "section": "allocation_flow", "title": "Where the plan sends the volume",
         "hint": "Each band is the volume the plan sends from a source to a target.", "type": "sankey", "dataset": "flows",
         "x": {"column": "entity", "kind": "category", "label": "From"}, "series": {"column": "decision", "top": 8},
         "y": [{"label": "Volume", "expression": "SUM(recommended_value)", "format": "number"}]},
    ]
    return page


def test_the_planner_draws_a_gantt_and_an_allocation_flow_in_their_own_sections():
    page = planned()
    assert problems(page) == []
    assert {"gantt", "allocation_flow"} <= set(layout("planner")["sections"])
    text, _params = shell_sql.chart_query(page, "when", {})
    assert "MIN(start_date) AS y0, MAX(end_date) AS y1" in text and "ORDER BY 2 ASC NULLS LAST, 3 ASC NULLS LAST" in text, text
    text, _params = shell_sql.chart_query(page, "moves", {})
    assert "CAST(`decision` AS STRING) AS s" in text and "GROUP BY `entity`, `decision`" in text, text


@pytest.mark.parametrize("change,needle", [
    (lambda c: c.pop("series"), "is a sankey, so it needs a series column"),
    (lambda c: c.update(type="gantt", y=c["y"][:1], series=None), "is a gantt, so y holds exactly 2 measures in this order: start, end"),
    (lambda c: c.update(section="sensitivity_tornado"), "names section 'sensitivity_tornado'; on a planner page a sankey goes in one of: allocation_flow"),
    (lambda c: c.update(type="bar"), "chart moves names section 'allocation_flow'; on a planner page a bar goes in one of: charts"),
    (lambda c: c.update(type="radar"), "chart moves is a radar, which no section of a planner page draws, and Inspire sets the planner layout"),
])
def test_a_gantt_or_a_sankey_must_have_its_shape_and_its_section(change, needle):
    page = planned()
    change(page["charts"][-1])
    if page["charts"][-1].get("series") is None:
        page["charts"][-1].pop("series", None)
    found = problems(page)
    assert any(needle in f for f in found), found


def test_a_generic_chart_section_refuses_a_gantt_and_a_sankey(agent_ns):
    for kind in ("gantt", "sankey"):
        assert not shell_sql._section_fits("charts", "charts", kind)
        assert shell_sql._section_fits("gantt" if kind == "gantt" else "allocation_flow", "charts", kind)
    assert "gantt" in shell_sql.LAZY_CHARTS


def _gantt_board(agent_ns, tmp_path, change=None):
    nb_sql = _modules(agent_ns, tmp_path)[1]["shell_sql"]
    page = planned()
    if change:
        change(page["charts"][-2])
    doc = agent_ns["implement_dashboard_from_page"](page, nb_sql, "main.supply.production_out__plan", {})
    index = next(i for i, c in enumerate(page["charts"]) if c["id"] == "when")
    widget = next(item["widget"] for board in doc["pages"] for item in board["layout"] if item["widget"].get("name") == f"chart_{index}")
    datasets = {d["name"]: d for d in doc["datasets"]}
    return doc, widget, datasets, index


def test_the_dashboard_draws_the_planner_gantt_as_a_table_of_each_line_its_start_end_and_days_never_dates_as_bars(agent_ns, tmp_path):
    doc, widget, datasets, index = _gantt_board(agent_ns, tmp_path)
    spec = widget["spec"]
    assert spec["widgetType"] == "table", spec
    assert [(c["fieldName"], c["displayName"]) for c in spec["encodings"]["columns"]] == [
        ("x", "Line"), ("y0", "Start"), ("y1", "End"), ("length", "Days")]
    query = widget["queries"][0]["query"]
    assert query["datasetName"] == f"chart_{index}_parts" and query["disaggregated"] is True
    assert query["orders"] == [{"direction": "ASC", "expression": "`y0`"}]
    sql = " ".join("".join(datasets[f"chart_{index}_parts"]["queryLines"]).split())
    assert "MIN(start_date) AS y0, MAX(end_date) AS y1" in sql and "GROUP BY `entity`" in sql, sql
    assert "DATEDIFF(CAST(y1 AS DATE), CAST(y0 AS DATE)) AS length" in sql, sql
    assert "ORDER BY y0 ASC NULLS LAST, y1 ASC NULLS LAST, x LIMIT 25" in sql, sql
    assert "array_contains(:filter_" in sql, "the page's Line filter still narrows the gantt rows"
    line = next(item["widget"] for item in doc["pages"][0]["layout"] if (item["widget"].get("spec") or {}).get("frame", {}).get("title") == "Line")
    parts = [q for q in line["queries"] if q["query"]["datasetName"] == f"chart_{index}_parts"]
    assert len(parts) == 1 and parts[0]["query"]["parameters"][0]["keyword"] in sql, "the Line filter is bound to the gantt's own dataset"
    drawn = [item["widget"] for board in doc["pages"] for item in board["layout"]
             if (item["widget"].get("spec") or {}).get("widgetType") in ("bar", "line", "area")
             and item["widget"]["queries"][0]["query"]["datasetName"] == "schedule"]
    assert drawn == [], "no bar, line or area draws the start and end dates as values"
    assert agent_ns["implement_dashboard_problems"](doc) == []
    assert agent_ns["implement_dashboard_drawn"](planned(), doc)["charts"][index]["type"] == "table"


@pytest.mark.parametrize("change,label,length", [
    (lambda c: [y.update(format="month") for y in c["y"]], "Months",
     "CAST(months_between(CAST(y1 AS DATE), CAST(y0 AS DATE)) AS INT) AS length"),
    (lambda c: [y.update(format="number") for y in c["y"]], "Length", "y1 - y0 AS length"),
])
def test_the_gantt_table_measures_its_length_in_the_unit_of_its_start_and_end(agent_ns, tmp_path, change, label, length):
    _doc, widget, datasets, index = _gantt_board(agent_ns, tmp_path, change)
    assert widget["spec"]["encodings"]["columns"][-1]["displayName"] == label
    sql = " ".join("".join(datasets[f"chart_{index}_parts"]["queryLines"]).split())
    assert length in sql and "DATEDIFF" not in sql, sql


def test_a_pareto_keeps_its_ranked_combo_beside_the_gantt_table(agent_ns, tmp_path):
    def pareto(c):
        c.update(type="pareto", y=c["y"][:1], section="charts")
    _doc, widget, datasets, index = _gantt_board(agent_ns, tmp_path, pareto)
    assert widget["spec"]["widgetType"] == "combo"
    assert agent_ns["implement_dashboard_ranked_parts"]("".join(datasets[f"chart_{index}_parts"]["queryLines"]))


def _date_chart(kind, fmt="date"):
    roles = shell_sql.LAYOUT_CHARTS.get(kind, ("category", ("value",)))[1]
    chart = {"id": "c", "title": "When", "hint": "A chart of dates.", "type": kind, "dataset": "d",
             "x": {"column": "entity", "kind": shell_sql.LAYOUT_CHARTS.get(kind, ("category",))[0], "label": "Line", "order": "o"},
             "y": [{"label": f"Measure {i}", "expression": f"MAX(day_{i})", "format": fmt} for i in range(len(roles))]}
    if kind in shell_sql.SERIES_CHARTS:
        chart["series"] = {"column": "decision"}
    if kind == "scatter":
        chart.update(x={"expression": "MAX(day_x)", "label": "Day", "format": fmt}, group="entity", y=[{"label": "Units", "expression": "SUM(u)"}])
    return chart


def _dated(problems):
    return [p for p in problems if "is a date, so a" in p]


@pytest.mark.parametrize("kind", [k for k in shell_sql.CHART_TYPES if k not in shell_sql.DURATION_CHARTS])
def test_a_date_measure_is_refused_on_every_chart_type_that_draws_a_height_or_a_size_and_a_number_is_kept(kind):
    found = _dated(shell_sql._chart_problems(_date_chart(kind), {"d"}))
    assert found and all(f"chart c " in p and f"so a {kind} cannot draw it" in p for p in found), found
    assert _dated(shell_sql._chart_problems(_date_chart(kind, "number"), {"d"})) == []
    assert _dated(shell_sql._chart_problems(_date_chart(kind, "month"), {"d"}))


def test_a_scatter_refuses_a_date_on_its_x_measure_and_a_gantt_keeps_its_dates_as_a_duration():
    assert _dated(shell_sql._chart_problems(_date_chart("scatter"), {"d"})) == [
        "chart c x is a date, so a scatter cannot draw it as a height or a size; show the date as text in a KPI or a table column, "
        "count the rows instead, or draw a gantt of each start and end"]
    assert _dated(shell_sql._chart_problems(_date_chart("gantt"), {"d"})) == []
    assert problems(planned()) == []


def test_a_date_stays_allowed_as_text_in_a_kpi_and_a_table_column():
    assert shell_sql._format_problems("kpi k", {"format": "date"}) == []
    assert shell_sql._format_problems("table t column c", {"format": "month"}) == []


def test_the_preview_rows_refuse_a_measure_that_returns_dates_even_when_its_format_says_number():
    page = {"charts": [_date_chart("bar", "number"), dict(_date_chart("gantt"), id="g"), dict(_date_chart("scatter", "number"), id="s")]}
    day = datetime.date(2026, 3, 1)
    shapes = {"c": [{"x": "A", "y0": day}], "g": [{"x": "A", "y0": day, "y1": day}], "s": [{"x": 4, "y0": 2}]}
    assert shell_sql.chart_date_problems(page, shapes) == [
        "chart c measure 1 is a date, so a bar cannot draw it as a height or a size; show the date as text in a KPI or a table column, "
        "count the rows instead, or draw a gantt of each start and end"]
    shapes["c"] = [{"x": "A", "y0": 12.5}]
    shapes["s"] = [{"x": datetime.datetime(2026, 3, 1, 8), "y0": 2}]
    assert [p.split(" is a date")[0] for p in shell_sql.chart_date_problems(page, shapes)] == ["chart s x"]
    assert shell_sql.chart_date_problems(page, {}) == [] and shell_sql.chart_date_problems({}, None) == []


def test_an_undeclared_date_measure_is_found_from_its_column_type_and_when_the_type_is_unknown_from_its_values():
    day = "2026-03-01"
    for sql_type in ("DATE", "TIMESTAMP", "TIMESTAMP_NTZ", "date"):
        assert shell_sql.date_measure({"format": "number"}, [12.5], sql_type), sql_type
    for sql_type in ("DOUBLE", "LONG", "INT", "DECIMAL", "BOOLEAN"):
        assert not shell_sql.date_measure({"format": "number"}, [day], sql_type), sql_type
    for values in ([day, "2026-04-01"], ["2026-03-01T08:30:00.000Z"], ["2026-03-01 08:30:00"], [None, day],
                   [datetime.date(2026, 3, 1)]):
        assert shell_sql.date_measure({}, values, None), values
        assert shell_sql.date_measure({}, values, "STRING"), values
    for values in ([12.5, 3], ["20260301"], ["2026-13-01"], [day, 4], [None], [], ["Books"], ["2026-03-01 is late"]):
        assert not shell_sql.date_measure({}, values, None), values
    page = {"charts": [_date_chart("bar", "number"), dict(_date_chart("gantt", "number"), id="g")]}
    shapes = {"c": [{"x": "A", "y0": "2026-03-01"}, {"x": "B", "y0": "2026-04-01"}], "g": [{"x": "A", "y0": day, "y1": day}]}
    assert [p.split(" is a date")[0] for p in shell_sql.chart_date_problems(page, shapes)] == ["chart c measure 1"]
    assert shell_sql.chart_date_problems(page, shapes, {"c": {"y0": "DOUBLE"}}) == []
    assert [p.split(" is a date")[0] for p in shell_sql.chart_date_problems(page, {"c": [{"x": "A", "y0": 7}]},
                                                                            {"c": {"y0": "DATE"}, "g": {"y0": "DATE"}})] == ["chart c measure 1"]


def test_no_kind_dashboard_binding_draws_a_date_as_a_measure():
    for source, bindings in KINDS["widget_fields"].items():
        for title, binding in bindings.items():
            if not isinstance(binding, dict) or binding.get("type") in ("table", "counter"):
                continue
            for triple in binding.get("y") or []:
                assert not shell_sql.date_measure({"format": triple[2]}), (source, title, triple)


def test_the_app_and_the_dashboard_share_one_date_format_list_and_the_dashboard_checks_its_chart_previews(agent_ns):
    web = os.path.join(os.path.dirname(shell_sql.__file__), "..", "web", "src")
    text = open(os.path.join(web, "format.js"), encoding="utf-8").read()
    listed = re.search(r"export const DATE_FORMATS = \[([^\]]*)\]", text).group(1)
    assert tuple(re.findall(r"'([^']+)'", listed)) == shell_sql.DATE_FORMATS
    for name in ("charts.js", "DataTable.jsx"):
        code = open(os.path.join(web, name), encoding="utf-8").read()
        assert "['date', 'month']" not in code and "DATE_FORMATS.includes(" in code, name
    notebook = json.load(open(os.path.join(os.path.dirname(__file__), "..", "..", "agent", "dbx_inspire_ai_agent.ipynb"), encoding="utf-8"))
    source = "".join("".join(cell["source"]) for cell in notebook["cells"])
    assert source.count("dated = shell_sql.chart_date_problems(page, shapes)") == 1
    assert shell_sql.DATE_FORMATS == tuple(shell_sql.DATE_LENGTHS) and shell_sql.FORMATS[-len(shell_sql.DATE_FORMATS):] == shell_sql.DATE_FORMATS
    assert "IMPLEMENT_DASHBOARD_GANTT_LENGTHS" not in source and source.count("shell_sql.DATE_LENGTHS") == 3
    assert agent_ns["IMPLEMENT_DASHBOARD_GANTT_LENGTH"] not in shell_sql.DATE_LENGTHS.values()


@pytest.mark.parametrize("chart_type, section", [("line", None), ("bar", "graph"), ("pareto", "todo")])
def test_a_chart_type_a_layout_cannot_hold_is_refused_with_a_way_out_genie_can_take(chart_type, section):
    with open(os.path.join(SHELL, "examples", "network_explorer.json"), encoding="utf-8") as handle:
        page = json.load(handle)
    assert shell_sql.layout_problems(page, set()) == []
    page.setdefault("charts", []).append({"id": "fare_trend", "type": chart_type, "section": section})
    found = [p for p in shell_sql.layout_problems(page, set()) if "fare_trend" in p]
    assert found == [f"chart fare_trend names section {section!r}; on a network_explorer page a {chart_type} goes in one of: charts"]
    assert not any("leave it out" in p or "decision_queue" in p for p in shell_sql.layout_problems(page, set()))
