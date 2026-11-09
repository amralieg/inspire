"""v2.3.0 A build whose App was never published, rebuilt from that run's own widgets, Genie changes and page settings.

1. Inspire wrote the App's settings itself, with a name two settings shared, and sent the failure back to Genie three rounds
   running. Genie cannot change that part of the page, so a part Inspire writes that fails its own check now stops at once.
2. The settings check asked a notebook step to read act_now_capacity, a setting the Run controls apply themselves, so Genie had
   to add a widget for it. Inspire's checks then refused its empty default, which means no cap, and Genie set the cap to 1.
3. The changes Genie made to follow Inspire's own rules were shown to the user as if Genie had moved away from the design.
"""
import json
import os
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

from v140_implement_test import TRUTH, _app_shell, _output_context, _output_inspire  # noqa: E402
from v206_genie_self_repair_test import _fill  # noqa: E402

RUN_WIDGETS = [
    ("result_table", "main.inspire.supply_out", "Business output table"),
    ("ai_endpoint", "databricks-model", "AI endpoint for explanations"),
    ("as_of_date", "latest", "As-of date (latest = last period complete in every source table)"),
    ("currency", "USD", "Currency of the money at stake (ISO code)"),
    ("act_now_share", "0.05", "Share of rows to act on now"),
    ("review_share", "0.2", "Share of rows to review next"),
    ("min_rows", "1", "Minimum usable rows"),
    ("min_join_coverage", "0.8", "Minimum join coverage"),
    ("min_simulation_draws", "1000", "Minimum simulation draws"),
    ("lookback_days", "365", "Demand window: the most recent full year before the as-of date"),
    ("max_supplier_shift", "0.25", "Assumed maximum change per supplier, as a share of the part's demand"),
    ("simulation_seed", "42", "Fixed seed for the simulation"),
    ("min_line_move", "1", "Smallest quantity change that counts as a planned change"),
    ("act_now_capacity", "1", "Maximum Act now records"),
    ("run_scope", "records", "Records written by this run"),
]
RUN_SCOPE = {"table": "main.s.lineitem", "default": "records", "records": 1000}
RUN_CHANGES = [
    {"method_was": "Direct Spark table and SQL reads", "method_now": "Literal inspire_read_source calls reused by every step",
     "why": "MVP scope must narrow the primary table consistently"},
    {"method_was": "No declared formula", "method_now": "Part saving multiplied by the supplier line's saving share",
     "why": "The output contract requires a human-readable formula"},
    {"method_was": "Reported a combined numeric-or-empty range", "method_now": "Reports the numeric constraint only",
     "why": "Use an Inspire-supported range form"},
    {"method_was": "Named the limit identifier column constraint", "method_now": "Names the limit identifier column name",
     "why": "The companion table requires the specified column name"},
    {"method_was": "Empty default representing no cap", "method_now": "Valid minimum capacity",
     "why": "Its default must satisfy the allowed range"},
]
FIELDS = ("what", "why", "method_was", "method_now", "setting", "value_was", "value_now")


class _Log:
    def __init__(self):
        self.lines = []

    def __getattr__(self, level):
        return lambda message, *a, **k: self.lines.append((level, str(message)))

    def matching(self, needle):
        return [line for line in self.lines if needle in line[1]]


def _run_widgets():
    return [{"name": name, "type": "text", "default": default, "allowed": "", "label": label} for name, default, label in RUN_WIDGETS]


def _run_model(ns):
    spec = {"family": "H", "decision_basis": "predicted", "first_run": RUN_SCOPE, "act_now_capacity": None}
    return ns["inspire_settings_model"](spec, _run_widgets(), [], {}, {})


def _rc7_model(ns):
    model = _run_model(ns)
    capacity = next(s for s in model if s["name"] == ns["INSPIRE_CAPACITY_SETTING"])
    at = model.index(capacity)
    return model[:at] + [dict(capacity, default="1", source="widget"), capacity] + model[at + 1:]


def _page(ns):
    page = json.loads(json.dumps(ns["implement_app_shell_payload"](ns["inspire_notebook_asset"]("app_shell"))["example"]))
    for dataset in page["datasets"]:
        for old, new in {"main.pricing.loss_desk_out": "main.inspire.churn_out", "main.pricing.items": "main.s.orders",
                         "main.pricing.loss_trend": "main.s.orders"}.items():
            dataset["sql"] = dataset["sql"].replace(old, new)
    return page


def _page_file(ns, tmp_path, settings):
    inst, _calls = _output_inspire(ns, tmp_path)
    inst.logger = _Log()
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [dict(t) for t in TRUTH]
    inst._implement_latest_run_rows = lambda table: list(TRUTH)
    shell_sql = _app_shell(ns, tmp_path)[1]["shell_sql"]
    context = dict(_output_context(ns), asset_status={"settings": settings})
    context["genie_round"] = {"name": "app", "round": 1, "rounds": 3}
    work = tmp_path / "work"
    work.mkdir()
    (work / ns["IMPLEMENT_APP_PAGE_FILE"]).write_text(json.dumps(_page(ns)))
    return inst, shell_sql, lambda: inst._implement_page_file(context, "app", str(work), shell_sql, False)


def test_the_run_s_repeated_setting_name_stops_the_app_at_once_and_never_goes_back_to_genie(agent_ns, tmp_path):
    inst, shell_sql, build = _page_file(agent_ns, tmp_path, _rc7_model(agent_ns))
    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        build()
    message = str(raised.value)
    assert message.startswith("Inspire wrote its own part of the App page wrong, and Genie cannot change that part")
    assert "repeats the name act_now_capacity of an earlier setting" in message
    assert inst.logger.matching("[INSPIRE-PAGE-PART FIRED] N01-U01")
    assert agent_ns["implement_known_repair"](raised.value, message)["kind"] == "stop", "no attempt repeats the same failure"
    assert agent_ns["implement_failure_origin"](raised.value) == "refusal"


def test_the_run_s_own_settings_without_the_repeat_build_the_page(agent_ns, tmp_path):
    inst, shell_sql, build = _page_file(agent_ns, tmp_path, _run_model(agent_ns))
    assert shell_sql.page_settings_problems(agent_ns["implement_page_settings"]({"settings": _run_model(agent_ns)}, {})) == []
    try:
        build()
    except agent_ns["ImplementBlocked"] as error:
        pytest.fail(f"a page whose own parts pass is never stopped as Inspire's fault: {error}")
    except RuntimeError:
        pass
    assert not inst.logger.matching("[INSPIRE-PAGE-PART FIRED]")


@pytest.mark.parametrize("part,value,found", [
    ("review", "https://elsewhere.example/x", "the page review must be the link"),
    ("result_table", "not a table", "the page result_table: "),
])
def test_every_page_part_inspire_writes_is_checked_on_its_own(agent_ns, tmp_path, part, value, found):
    shell_sql = _app_shell(agent_ns, tmp_path)[1]["shell_sql"]
    page = dict(_page(agent_ns), use_case_id="N01-U01", **{part: value})
    owned = shell_sql.inspire_part_problems(page)
    assert any(p.startswith(found) for p in owned)
    assert all(p in shell_sql.spec_problems(page) for p in owned), "the page check and the own-part check say the same"
    assert shell_sql.inspire_part_problems(dict(_page(agent_ns))) == []


def test_the_run_controls_never_ask_a_step_to_read_the_team_capacity_inspire_applies_itself(agent_ns):
    run = {"settings_read": True, "settings": agent_ns["inspire_run_settings_model"](_run_model(agent_ns))}
    assert "act_now_capacity" in [s["name"] for s in run["settings"]], "the App still saves the capacity for the run to apply"
    read = {name for name, _d, _l in RUN_WIDGETS} - {"act_now_capacity"}
    scope = {"__name__": "__main__"}
    exec(compile("def run_use_case():\n    return (" + ", ".join(sorted(read)) + ")\n", "cell", "exec"), scope)
    assert agent_ns["inspire_unread_settings"](scope, run) == []
    exec(compile("def run_use_case():\n    return (" + ", ".join(sorted(read - {"max_supplier_shift"})) + ")\n", "cell", "exec"), scope)
    assert agent_ns["inspire_unread_settings"](scope, run) == ["max_supplier_shift"], "a setting no step reads is still named"


def _capacity_fill(default, allowed="a whole number, at least 1, or empty for no cap"):
    widgets = [{"name": "act_now_capacity", "type": "text", "default": default, "allowed": allowed, "label": "Maximum Act now records"},
               {"name": "run_profile", "type": "dropdown", "default": "full", "choices": ["full", "test"], "allowed": ""}]
    return dict(_fill(), widgets=widgets)


def test_an_empty_team_capacity_means_no_cap_and_is_never_refused(agent_ns):
    fill = _capacity_fill("")
    assert agent_ns["normalize_genie_fill_widgets"](fill, []) == []
    assert fill["widgets"][0]["allowed"] == "whole number, at least 1"
    assert agent_ns["validate_genie_fill_result"](fill, []) == []
    assert agent_ns["implement_widget_default_fixes"](fill, []) == [], "no default is forced onto a capacity left empty"


@pytest.mark.parametrize("default", ["0", "2.5", "many"])
def test_a_team_capacity_below_one_or_not_whole_is_still_refused(agent_ns, default):
    fill = _capacity_fill(default)
    agent_ns["normalize_genie_fill_widgets"](fill, [])
    assert [e for e in agent_ns["validate_genie_fill_result"](fill, []) if e.startswith("the default of widget act_now_capacity is")]


def test_other_widgets_still_refuse_an_empty_default_and_an_unknown_range_form(agent_ns):
    fill = dict(_fill(), widgets=[{"name": "min_line_move", "type": "text", "default": "", "allowed": "at least 1"},
                                  {"name": "max_supplier_shift", "type": "text", "default": "0.25", "allowed": "0 to 1, or empty"},
                                  {"name": "run_profile", "type": "dropdown", "default": "full", "choices": ["full"], "allowed": ""}])
    assert agent_ns["normalize_genie_fill_widgets"](fill, []) == [
        "widget max_supplier_shift has allowed '0 to 1, or empty', which is not one of Inspire's range forms "
        f"({agent_ns['GENIE_ALLOWED_FORMS_TEXT']}, or empty for any value)"]
    assert agent_ns["validate_genie_fill_result"](fill, []) == ["the default of widget min_line_move is ''; allowed: at least 1"]


def _changes(cause, items=RUN_CHANGES):
    return dict(_fill(), changes=[{**{f: "" for f in FIELDS}, **item, "cause": cause} for item in items])


def test_the_run_s_five_rule_changes_are_not_shown_as_moves_away_from_the_design(agent_ns):
    assert agent_ns["implement_genie_change_notes"](_changes("rule")) == []
    assert agent_ns["implement_genie_rule_methods"]([_changes("rule")]) == [
        f"{c['method_now']} instead of {c['method_was']}" for c in RUN_CHANGES]


def test_a_method_change_genie_chose_itself_is_still_shown(agent_ns):
    notes = agent_ns["implement_genie_change_notes"](_changes("other", RUN_CHANGES[:1]))
    assert notes == ["Genie used Literal inspire_read_source calls reused by every step instead of Direct Spark table and SQL reads: "
                     "MVP scope must narrow the primary table consistently."]


def test_a_setting_inspire_s_rules_made_genie_change_is_still_shown(agent_ns):
    fill = _changes("rule", [{"setting": "min_rows", "value_was": "0", "value_now": "1", "why": "the allowed range starts at 1"}])
    assert agent_ns["implement_genie_change_notes"](fill) == ["Genie set Minimum usable rows to 1, not 0: the allowed range starts at 1."]
