"""Every text about what a record puts at stake names the KPI's own unit kind through one helper in each runtime: the notebook
helper (also the agent's), the App shell server and the App shell web. Money is said only for a money KPI, the KPI's unit for any
other, and amount when the unit is not known, offline."""
import ast
import json
import os
import re

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import ALERT, READS, SHELL_FILES, VALID, _deploy_inspire, _output_context, sdk_stub  # noqa: F401
from v149_impact_test import DIGEST_SCHEMA, _digest_inspire
from v149_money_assumptions_test import EDITS, SCHEMA, _latest, _value
from v150_app_owners_access_test import CREATE, NEW_APP, Catalog
from v162_target_kpi_test import HOURS, _spec_for

import shell_core  # noqa: E402
import shell_sql  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
NB = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
WEB = os.path.join(ROOT, "agent", "app_shell", "web", "src")
HOURS_IMPACT = {"kind": "hours", "unit": "hours", "kpi": "Analyst hours"}
MONEY_IMPACT = {"kind": "money", "unit": "USD", "kpi": "Retained revenue"}
MWH_IMPACT = {"kind": "number", "unit": "MWh", "kpi": "Energy lost"}
SAID = re.compile(r"money\s+at\s+stake|money_at_stake", re.I)


def _hours_value(expression, **constants):
    return dict(_value(expression, **constants), kind="hours", unit="hours", currency="")


def test_one_helper_in_the_notebook_names_what_is_at_stake(agent_ns):
    noun, words, label = agent_ns["inspire_stake_noun"], agent_ns["inspire_stake_words"], agent_ns["inspire_stake_label"]
    cases = [(None, "amount"), ("hours", "amount"), (MONEY_IMPACT, "money"), ({"kind": "money", "unit": ""}, "money"),
             ({"unit": "EUR"}, "money"), (HOURS_IMPACT, "hours"), ({"kind": "count", "unit": " late  shipments "}, "late shipments"),
             ({"kind": "hours", "unit": ""}, "hours"), ({"kind": "percent"}, "percent"), (MWH_IMPACT, "MWh"),
             ({"kind": "shares", "unit": "x"}, "amount")]
    assert [noun(impact) for impact, _ in cases] == [said for _, said in cases]
    assert [words(None), words(MONEY_IMPACT), words(HOURS_IMPACT), words(MWH_IMPACT)] == [
        "amount at stake", "money at stake", "hours at stake", "MWh at stake"]
    assert [label(None), label(MONEY_IMPACT), label(MWH_IMPACT), label({"kind": "count", "unit": "late shipments"})] == [
        "Amount at stake", "Money at stake", "MWh at stake", "Late shipments at stake"], "only the first letter changes"
    assert "def inspire_stake_noun(" in agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"], "generated notebooks carry the same helper"
    assert "implement_stake_words" not in agent_ns, "the agent has no second copy"


def test_the_notebook_helper_problems_name_the_kpi_s_unit(agent_ns):
    formula, expression = agent_ns["inspire_value_formula"], agent_ns["inspire_value_expression"]
    assert formula(dict(_hours_value(None), formula=None), SCHEMA)[1][0].startswith(
        "the notebook has no VALUE_AT_STAKE_FORMULA, so the App cannot show how each record's hours at stake is worked out")
    assert formula(dict(_value(None), formula=None), SCHEMA)[1][0].startswith(
        "the notebook has no VALUE_AT_STAKE_FORMULA, so the App cannot show how each record's money at stake is worked out")
    hours = _hours_value(None)
    parsed, problems = formula(hours, SCHEMA)
    assert problems == []
    assert expression(hours, SCHEMA, parsed)[1][0].startswith(
        "the notebook has no VALUE_AT_STAKE_EXPRESSION, so the App cannot work out the hours at stake again when someone changes")
    assert expression(_hours_value("WEEKS_LEFT * KEEP_RATE * 10"), SCHEMA, parsed)[1] == [
        "VALUE_AT_STAKE_EXPRESSION names no column of the rows, so every record would have the same hours at stake"]
    assert "the App shows every assumption that changes the hours: only the formula names KEEP_RATE" in expression(
        _hours_value("margin_lost_week * WEEKS_LEFT"), SCHEMA, parsed)[1][0]
    problems = agent_ns["inspire_run_problems"]({"negative_stake": 2, "off_expression": 1}, hours)
    assert problems[0] == "2 rows have a value_at_stake below 0; it holds the hours the record puts at stake, 0 when nothing is at stake"
    assert "so the App would show other hours when someone changes an assumption" in problems[1]
    money = agent_ns["inspire_run_problems"]({"negative_stake": 2, "off_expression": 1}, _value(None))
    assert "it holds the money the record puts at stake" in money[0] and "the App would show other money" in money[1]
    for text in problems + expression(_hours_value("WEEKS_LEFT * KEEP_RATE * 10"), SCHEMA, parsed)[1]:
        assert "money" not in text, text


def test_the_notebook_helper_prints_name_the_kpi_s_unit(agent_ns):
    scope = {"WEEKS_LEFT": 12, "KEEP_RATE": 0.5, "VALUE_AT_STAKE_FORMULA": "{margin_lost_week:money} x {WEEKS_LEFT:number} x {KEEP_RATE:percent}",
             "INSPIRE_RUN": {"impact": HOURS_IMPACT}}
    printed = []
    agent_ns["inspire_apply_assumptions"](_latest(EDITS), "main.inspire.churn_out", "N01-U01", dict(scope), printed.append)
    assert printed and all(line.startswith("Hours at stake: ") for line in printed), printed
    broken = []
    agent_ns["inspire_apply_assumptions"](_latest(EDITS, fail="SELECT name"), "main.inspire.churn_out", "N01-U01", dict(scope),
                                          broken.append)
    assert broken[0].startswith("Hours at stake: Inspire could not read the assumptions people changed in the App")
    plain = []
    agent_ns["inspire_apply_assumptions"](_latest(EDITS), "main.inspire.churn_out", "N01-U01", dict(scope, INSPIRE_RUN={}), plain.append)
    assert plain and all(line.startswith("Money at stake: ") for line in plain), "a notebook built before the impact unit is money"


def test_the_run_names_the_kpi_s_unit_when_it_leaves_out_the_formula_column(agent_ns):
    from v148_record_ai_fields_test import MEASURED, PRICED, STAGE, TABLE as RESULT, _Tables
    printed = []
    tables = _Tables(agent_ns, stage=PRICED + [("value_at_stake_formula", "string")], target=None)
    agent_ns["inspire_merge_run"](tables.spark, RESULT, STAGE, out=printed.append, value=dict(MEASURED, kind="hours", unit="hours"))
    assert ("Hours at stake: left out value_at_stake_formula from the run's rows: Inspire writes it from VALUE_AT_STAKE_FORMULA and "
            "each row's numbers") in printed


def test_the_genie_widgets_name_the_kpi_s_unit_with_its_own_capitals(agent_ns):
    inst, spec = _spec_for(agent_ns, [HOURS])
    for impact, act_now, review in ((dict(MWH_IMPACT), "MWh at stake to act now", "MWh at stake to review"),
                                    ({"kind": "count", "unit": "", "kpi": "Late shipments"}, "Count at stake to act now",
                                     "Count at stake to review"),
                                    (dict(HOURS_IMPACT), "Hours at stake to act now", "Hours at stake to review")):
        widgets = {w["name"]: w["label"] for w in inst._genie_core_widgets(dict(spec, impact=impact))}
        assert (widgets["act_now_amount"], widgets["review_amount"]) == (act_now, review) and "currency" not in widgets
    money = {w["name"]: w["label"] for w in inst._genie_core_widgets(dict(spec, impact=dict(MONEY_IMPACT)))}
    assert (money["currency"], money["act_now_amount"], money["review_amount"]) == (
        "Currency of the money at stake (ISO code)", "Money at stake to act now", "Money at stake to review"), "money stays word for word"
    assert "the MWh each record puts at stake" in inst._genie_platform_rules(dict(spec, impact=dict(MWH_IMPACT)))


def test_a_recorded_kpi_with_no_unit_still_names_its_kind_never_money(agent_ns):
    record = agent_ns["implement_record_impact"]
    assert record({"name": "Analyst hours", "impact_kind": "hours", "impact_unit": ""})["unit"] == "hours"
    assert record({"name": "Late shipments", "impact_kind": "count", "impact_unit": None})["unit"] == "late shipments"
    assert record({"name": "Retained revenue", "impact_kind": "money", "impact_unit": ""})["unit"] == "", "money keeps no made-up currency"
    assert record({"name": "Analyst hours", "impact_kind": "hours", "impact_unit": "analyst hours"})["unit"] == "analyst hours"


def test_the_implement_texts_name_the_kpi_s_unit_and_amount_when_an_app_spans_use_cases(agent_ns):
    owners = [f"p{i:02d}@example.com" for i in range(agent_ns["IMPLEMENT_APP_OWNERS_MAX"] + 1)]
    outputs = {**VALID["outputs"], "app": True, "app_owners": owners}
    for impact, named in ((HOURS_IMPACT, "hours"), (MONEY_IMPACT, "money"), (None, "amount")):
        errors = agent_ns["validate_implement_spec"](dict(VALID, outputs=outputs), impact=impact)[1]
        assert f"an App can name at most 50 owners, the people who may change its {named} at stake assumptions" in errors, (impact, errors)
    refused = agent_ns["implement_assumptions_refused"]
    assert [refused(HOURS_IMPACT), refused(MONEY_IMPACT), refused()] == [
        "the owners of this use case cannot change its hours at stake assumptions in the App",
        "the owners of this use case cannot change its money at stake assumptions in the App",
        "the owners of this use case cannot change its amount at stake assumptions in the App"]


def test_the_app_grant_warning_names_the_use_case_s_unit(agent_ns, sdk_stub):
    inst, context, _calls, _imported = _deploy_inspire(agent_ns, list(NEW_APP))
    inst.spark = Catalog(fail={CREATE: RuntimeError("PERMISSION_DENIED: no CREATE TABLE")})
    context["use_case"] = dict(context["use_case"], _implement_impact=dict(HOURS_IMPACT))
    fields = inst._implement_deploy_app(context, "churn-desk", SHELL_FILES, READS, poll_s=0)
    assert [w for w in fields["_warnings"] if "assumptions" in w] == [
        "App: the owners of this use case cannot change its hours at stake assumptions in the App until its service principal sp-1 "
        "can read and change main.inspire.churn_out_assumptions. Inspire could not create it: PERMISSION_DENIED: no CREATE TABLE"]


class _Log:
    def __init__(self):
        self.lines = []

    def __getattr__(self, name):
        return lambda text, *args, **kwargs: self.lines.append((name, text))


def test_the_weekly_email_names_the_hours_people_entered_and_keeps_the_unit_when_the_summary_cannot_be_read(agent_ns, tmp_path):
    inst, calls, _queries = _digest_inspire(agent_ns, tmp_path, {("POST", "/api/2.0/alerts"): {"id": "al-1"}},
                                            summary={"impact_kind": "hours", "impact_unit": "hours", "currency": ""})
    inst._implement_alert(_output_context(agent_ns, **ALERT, alert_destinations=[{"id": "dest-0001", "name": "Slack"}]), None)
    digest = [b for m, p, b, _q in calls if (m, p) == ("POST", "/api/2.0/alerts")][-1]
    assert "Reported: the hours people entered when they marked a record fixed." in digest["custom_description"]
    inst, calls, _queries = _digest_inspire(agent_ns, tmp_path, {("POST", "/api/2.0/alerts"): {"id": "al-1"}})

    def unreadable(statement):
        if statement.startswith("DESCRIBE TABLE `main`.`inspire`.`churn_out`"):
            return DIGEST_SCHEMA
        if "churn_out_summary" in statement:
            raise RuntimeError("PERMISSION_DENIED: summary")
        return []

    inst.spark, inst.logger = FakeSpark(responder=unreadable), _Log()
    context = _output_context(agent_ns, **ALERT, alert_destinations=[{"id": "dest-0001", "name": "Slack"}])
    context["use_case"] = dict(context["use_case"], _implement_impact=dict(HOURS_IMPACT))
    inst._implement_alert(context, None)
    digest = [b for m, p, b, _q in calls if (m, p) == ("POST", "/api/2.0/alerts")][-1]
    assert "'Hours at stake now (estimated)'" in digest["query_text"] and "Money at stake" not in digest["query_text"]
    assert "Estimated: the hours at stake on the records still open" in digest["custom_description"]
    warned = [text for level, text in inst.logger.lines if level == "warning" and "run summary" in text]
    assert len(warned) == 1 and warned[0].startswith(
        "[IMPLEMENT-ALERT] N01-U01: the weekly impact email shows the hours at stake the runs wrote, because Inspire could not read "
        "the run summary: ") and "PERMISSION_DENIED" in warned[0], warned
    inst.logger = _Log()
    inst._implement_alert(_output_context(agent_ns, **ALERT, alert_destinations=[{"id": "dest-0001", "name": "Slack"}]), None)
    digest = [b for m, p, b, _q in calls if (m, p) == ("POST", "/api/2.0/alerts")][-1]
    assert "'Money at stake now (estimated)'" in digest["query_text"], "a money use case keeps its money words"
    warned = [text for level, text in inst.logger.lines if level == "warning" and "run summary" in text]
    assert len(warned) == 1 and warned[0].startswith(
        "[IMPLEMENT-ALERT] N01-U01: the weekly impact email shows the money at stake the runs wrote without a currency, because "), warned


def test_the_app_shell_server_names_the_summary_s_unit_through_one_helper():
    impacts = (None, {"kind": "money", "unit": ""}, {"kind": "money", "unit": "USD"}, {"kind": "hours", "unit": "hours"},
               {"kind": "count", "unit": " late  shipments "}, {"kind": "number", "unit": "MWh"}, {"kind": "count", "unit": ""})
    assert [shell_sql.stake_noun(i) for i in impacts] == ["amount", "money", "money", "hours", "late shipments", "MWh", "count"]
    assert [shell_sql.stake_words(impacts[3]), shell_sql.stake_label(impacts[5]), shell_sql.stake_label(impacts[1]),
            shell_sql.stake_label(None)] == ["hours at stake", "MWh at stake", "Money at stake", "Amount at stake"]
    fields = [{"name": "units", "kind": "integer"}, {"name": "value_at_stake", "kind": "decimal"}]
    hours = {"impact_kind": "hours", "impact_unit": "hours", "currency": ""}
    cases = [({}, "the hours at stake formula of this use case names no assumption"),
             ({"value_expression": None}, "the notebook was built before the App could work out the hours again; "
                                          + shell_sql.rebuild_action("its hours at stake formula")),
             ({"value_expression": "x" * 301}, "the hours at stake arithmetic is 301 characters; the App reads at most 300"),
             ({"value_expression": "units * SECRET"}, "the hours at stake arithmetic names SECRET, which is neither a number column nor an "
                                                      "assumption"),
             ({"value_expression": "units"}, "the hours at stake arithmetic leaves out PRICE, so changing it would not change the hours"),
             ({"value_expression": "PRICE * 2"}, "the hours at stake arithmetic names no column of the records, so every record would get "
                                                 "the same hours")]
    for changes, problem in cases:
        run = dict(hours, value_formula="{units:number} x {PRICE:number}", value_expression="units * PRICE",
                   value_assumptions=json.dumps([{"name": "PRICE", "value": 2.0, "kind": "number"}]))
        run.update(changes or {"value_assumptions": None})
        assert shell_sql.money_model(run, fields)["problem"] == problem, changes
    assert shell_sql.money_model(None, fields)["problem"] == "the amount at stake formula of this use case names no assumption"
    assert shell_sql.money_model({"currency": "USD"}, fields)["problem"] == "the money at stake formula of this use case names no assumption"
    assert shell_core.NO_MONEY == "this page puts no amount at stake on its records"
    owners = {"version": shell_core.SETTINGS_VERSION, "use_case_owners": {"p": ["a"] * (shell_core.USE_CASE_OWNERS_MAX + 1)}}
    problems = [p for p in shell_core.settings_problems(owners, [{"id": "p"}]) if "use_case_owners" in p]
    assert len(problems) == 1 and not SAID.search(problems[0]), problems


@pytest.mark.parametrize("impact", [MONEY_IMPACT, {"kind": "money", "unit": ""}, HOURS_IMPACT, MWH_IMPACT,
                                    {"kind": "count", "unit": "late shipments"}, {"kind": "percent", "unit": "points of churn rate"},
                                    {"kind": "number", "unit": "FTE"}, {"kind": "count", "unit": "SKU"}, {"kind": "count", "unit": "TOP"}])
def test_the_notebook_and_the_app_shell_name_what_is_at_stake_alike(agent_ns, impact):
    summary = {"impact_kind": impact["kind"], "impact_unit": "" if impact["kind"] == "money" else impact["unit"],
               "currency": impact["unit"] if impact["kind"] == "money" else ""}
    assert shell_sql.stake_words(shell_sql.impact_of(summary)) == agent_ns["inspire_stake_words"](impact)
    assert shell_sql.stake_label(shell_sql.impact_of(summary)) == agent_ns["inspire_stake_label"](impact)
    assert shell_sql.stake_words(None) == agent_ns["inspire_stake_words"](None)


def _strings(tree):
    for node in ast.walk(tree):
        if isinstance(node, ast.Constant) and isinstance(node.value, str):
            yield node.value
        elif isinstance(node, ast.JoinedStr):
            yield "".join(v.value if isinstance(v, ast.Constant) else "{}" for v in node.values)


def test_no_text_says_money_at_stake_outside_the_money_only_template():
    cell = "".join(json.load(open(NB, encoding="utf-8"))["cells"][1]["source"])
    tree = ast.parse(cell)
    helper = next(n.value.value for n in tree.body if isinstance(n, ast.Assign)
                  and getattr(n.targets[0], "id", "") == "IMPLEMENT_RESULT_HISTORY_SOURCE")
    said = [s for s in list(_strings(tree)) + list(_strings(ast.parse(helper))) if SAID.search(s) and s != helper]
    basis = next(n for n in tree.body if isinstance(n, ast.Assign) and getattr(n.targets[0], "id", "") == "GENIE_VALUE_AT_STAKE_BASIS")
    assert said == [s for s in _strings(basis) if SAID.search(s)] and len(said) == 1, said
    for name in sorted(os.listdir(SERVER)):
        if name.endswith(".py"):
            found = [s for s in _strings(ast.parse(open(os.path.join(SERVER, name), encoding="utf-8").read())) if SAID.search(s)]
            assert found == [], (name, found)
    for name in sorted(os.listdir(WEB)):
        if name.endswith((".js", ".jsx")):
            text = open(os.path.join(WEB, name), encoding="utf-8").read()
            hits = [line.strip() for line in text.splitlines() if SAID.search(line)]
            assert hits == [], (name, hits)
