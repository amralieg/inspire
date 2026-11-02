"""The KPI's impact kind decides money everywhere: the App shell reads the kind the run summary carries and never takes a unit
spelled in three capitals (FTE, SKU, KWH) for a currency; a summary with no kind falls back in one place, where only an ISO 4217
code from one closed list is money; the agent classifies and formats currencies from the same list; and every text about what a
fix saved names the KPI's own unit, offline."""
import json
import os
import re

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import ALERT, _output_context
from v149_impact_test import COLUMNS, DIGEST_SCHEMA, TABLE as DESK, TYPES, Workspace, _digest_inspire
from v147_app_ai_test import RUN, AiWorkspace, shell
from v141_app_shell_test import call

import shell_core  # noqa: E402
import shell_sql  # noqa: E402

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
NB = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
WEB = os.path.join(ROOT, "agent", "app_shell", "web", "src")
FTE = {"impact_kind": "number", "impact_unit": "FTE", "currency": ""}
SKU = {"impact_kind": "count", "impact_unit": "SKU", "currency": ""}
SAVED_MONEY = re.compile(r"money (?:it|a fix|the fix) saved|money formula|weekly savings|money shown", re.I)


def test_the_kind_the_summary_carries_decides_money_and_a_summary_with_no_kind_falls_back_to_iso_codes_only():
    of = shell_sql.impact_of
    assert of(FTE) == {"kind": "number", "unit": "FTE"} and of(SKU) == {"kind": "count", "unit": "SKU"}
    assert of({"impact_kind": "number", "impact_unit": "KWH"}) == {"kind": "number", "unit": "KWH"}
    assert [of({"impact_kind": "money", "currency": c}) for c in ("USD", "EUR", "AED")] == [
        {"kind": "money", "unit": "USD"}, {"kind": "money", "unit": "EUR"}, {"kind": "money", "unit": "AED"}]
    assert of({"impact_kind": "money", "currency": "FTE"}) == {"kind": "money", "unit": ""}, "money names no made-up currency"
    assert of({"impact_kind": "count", "impact_unit": "TOP", "currency": ""}) == {"kind": "count", "unit": "TOP"}, \
        "a stored kind wins even over a unit spelled like a currency code"
    assert of({"currency": "USD"}) == {"kind": "money", "unit": "USD"}, "an old summary with an ISO code is money"
    assert of({"currency": "FTE"}) == {"kind": "number", "unit": "FTE"}, "an old summary with FTE is not money"
    assert of({"currency": "SKU", "impact_kind": "shares"}) == {"kind": "number", "unit": "SKU"}, "an unknown kind is no kind"
    assert of({}) == of(None) == {"kind": "money", "unit": ""}, "an old summary with no unit at all is money, as every one was"
    for code in ("FTE", "SKU", "KWH", "MWH", "CPU", "NPS"):
        assert code not in shell_sql.MONEY_CODES, code
    for code in ("USD", "EUR", "AED", "SAR", "JPY", "XOF"):
        assert code in shell_sql.MONEY_CODES, code


def test_the_server_names_an_fte_kpi_in_fte_in_its_money_model_run_rows_and_weekly_email():
    fields = [{"name": "units", "kind": "integer"}, {"name": "value_at_stake", "kind": "decimal"}]
    model = shell_sql.money_model(FTE, fields)
    assert (model["unit"], model["impact_kind"], model["problem"]) == ("FTE", "number", "the FTE at stake formula of this use case names no assumption")
    money = shell_sql.money_model({"currency": "USD"}, fields)
    assert (money["unit"], money["impact_kind"]) == ("USD", "money")
    view = shell_core.run_view(shell_core.blank_run("u1"), dict(FTE, value_at_stake=12.0), {})
    assert (view["unit"], view["impact_kind"], view["could_save"]) == ("FTE", "number", 12.0)
    old = shell_core.run_view(shell_core.blank_run("u1"), {"value_at_stake": 12.0, "currency": "FTE"}, {})
    assert (old["unit"], old["impact_kind"]) == ("FTE", "number")
    rows = shell_core.run_view(shell_core.blank_run("u1"), {"value_at_stake": 12.0, "currency": "USD"}, {})
    assert (rows["unit"], rows["impact_kind"]) == ("USD", "money")
    fields = shell_sql.change_fields([{"name": c, "type": TYPES.get(c, "STRING")} for c in COLUMNS])
    week = shell_sql.digest_query(DESK, fields, label="entity_label", use_case="N01-U05", impact=shell_sql.impact_of(FTE),
                                  since="CAST('2026-10-06' AS DATE)")
    found = Workspace().run_sql("wh1", week, [])["rows"]
    assert [(r["figure"], r["amount"]) for r in found][:2] == [("FTE at stake now (estimated)", "1,550 FTE"), ("Acted on this week", "1,250 FTE")]
    assert not any("Money" in str(r["how"]) for r in found)


@pytest.mark.parametrize("summary,unit,kind", [
    (dict(RUN, **FTE), "FTE", "number"), (dict(RUN, **SKU), "SKU", "count"),
    (dict(RUN, impact_kind=None, impact_unit=None, currency="USD"), "USD", "money"),
    (dict(RUN, impact_kind=None, impact_unit=None, currency="FTE"), "FTE", "number"),
    (dict(RUN, impact_kind="money", impact_unit="", currency="EUR"), "EUR", "money"),
])
def test_the_run_summary_hands_the_app_the_resolved_kind(tmp_path, summary, unit, kind):
    s, _ws, _made = shell(tmp_path, ws=AiWorkspace(summary=summary))
    status, out = call(s, "GET", "summary", query={"page": "n01_u05"})
    assert status == 200 and (out["run"]["unit"], out["run"]["impact_kind"]) == (unit, kind)


def test_a_page_format_takes_only_an_iso_code_and_an_ask_never_reads_fte_as_a_currency():
    assert shell_sql._format_problems("the Loss column", {"format": "currency", "currency": "FTE"}) == [
        "the Loss column is money, so it needs an ISO 4217 currency code such as USD"]
    assert shell_sql._format_problems("the Loss column", {"format": "currency", "currency": "AED"}) == []
    assert [shell_core.currency_code(c) for c in ("FTE", "USD", " EUR ", "usd")] == ["", "USD", "EUR", ""]


def test_the_server_says_amount_for_what_a_fix_saved_before_it_reads_the_kpi():
    with pytest.raises(ValueError, match=r"^the amount a fix saved goes only with the Done status: send action_status Done with "
                                         r"realized_value and realized_note$"):
        shell_sql.action_values({"realized_value": 5})
    with pytest.raises(ValueError, match=r"^realized_value takes the amount the fix saved, as a number$"):
        shell_sql.realized_amount("ten")


def test_the_agent_reads_currencies_from_one_closed_list(agent_ns):
    currency, guess = agent_ns["_kpi_impact_currency"], agent_ns["_kpi_impact_guess"]
    assert [currency(u) for u in ("FTE", "SKU", "KWH", "USD", "EUR", "$", "€", "usd", "fte")] == ["", "", "", "USD", "EUR", "USD", "EUR", "", ""]
    assert guess("Analyst FTE on manual review", "FTE") != "money" and guess("Stock keeping units out of stock", "SKU") != "money"
    assert guess("Retained revenue", "USD") == "money" and guess("Retained revenue", "") == "money"
    assert agent_ns["kpi_impact"]({"name": "Analyst FTE on manual review", "unit": "FTE"})["kind"] == "number"
    fmt = agent_ns["implement_dashboard_format"]
    assert fmt({"format": "currency", "currency": "FTE"})["type"] == "number", "a unit spelled like a currency is no currency"
    assert fmt({"format": "currency", "currency": "AED"})["type"] == "number-currency"
    problems = agent_ns["inspire_value_problems"]
    value = {"basis": "predicted", "currency": "FTE", "kind": "money", "unit": "FTE", "amounts": {}}
    assert any(p.startswith("the currency widget is 'FTE'") for p in problems(value)), "a money run needs a real currency"
    assert not problems(dict(value, currency="USD", unit="USD"))
    codes = agent_ns["INSPIRE_CURRENCY_CODES"]
    assert codes == shell_sql.MONEY_CODES and "INSPIRE_CURRENCY_CODES = frozenset((" in agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"]
    web = open(os.path.join(WEB, "format.js"), encoding="utf-8").read()
    listed = re.search(r"const MONEY_CODES = new Set\(\((.*?)\)\.split\(' '\)\);", web, re.S).group(1)
    assert set(" ".join(re.findall(r"'([A-Z ]+)'", listed)).split()) == set(codes), "the App shell web holds the same closed list"


def _unreadable(statement):
    if statement.startswith("DESCRIBE TABLE `main`.`inspire`.`churn_out`"):
        return DIGEST_SCHEMA
    if "churn_out_summary" in statement:
        raise RuntimeError("PERMISSION_DENIED: summary")
    return []


def test_the_weekly_email_of_an_fte_kpi_counts_fte_and_never_money(agent_ns, tmp_path):
    inst, calls, _queries = _digest_inspire(agent_ns, tmp_path, {("POST", "/api/2.0/alerts"): {"id": "al-1"}}, summary=dict(FTE))
    inst._implement_alert(_output_context(agent_ns, **ALERT, alert_destinations=[{"id": "dest-0001", "name": "Slack"}]), None)
    digest = [b for m, p, b, _q in calls if (m, p) == ("POST", "/api/2.0/alerts")][-1]
    assert "Estimated: the FTE at stake on the records still open" in digest["custom_description"]
    assert "Reported: the FTE people entered when they marked a record fixed." in digest["custom_description"]
    assert "'FTE at stake now (estimated)'" in digest["query_text"] and "Money at stake" not in digest["query_text"]
    inst, calls, _queries = _digest_inspire(agent_ns, tmp_path, {("POST", "/api/2.0/alerts"): {"id": "al-1"}})
    inst.spark = FakeSpark(responder=_unreadable)
    context = _output_context(agent_ns, **ALERT, alert_destinations=[{"id": "dest-0001", "name": "Slack"}])
    context["use_case"] = dict(context["use_case"], _implement_impact={"kind": "number", "unit": "FTE", "kpi": "Analyst FTE"})
    inst._implement_alert(context, None)
    digest = [b for m, p, b, _q in calls if (m, p) == ("POST", "/api/2.0/alerts")][-1]
    assert "'FTE at stake now (estimated)'" in digest["query_text"], "the use case's kind holds when the summary cannot be read"


def test_no_text_about_what_a_fix_saved_says_money_for_every_kpi():
    cell = "".join(json.load(open(NB, encoding="utf-8"))["cells"][1]["source"])
    sources = {"notebook": cell}
    for folder, ends in ((SERVER, (".py",)), (WEB, (".js", ".jsx"))):
        for name in sorted(os.listdir(folder)):
            if name.endswith(ends):
                sources[name] = open(os.path.join(folder, name), encoding="utf-8").read()
    joined = {name: re.sub(r"[\"'`]\s*\n\s*f?[\"'`]", "", text) for name, text in sources.items()}
    found = {name: SAVED_MONEY.findall(text) for name, text in joined.items() if SAVED_MONEY.search(text)}
    assert found == {}, found
    assert "Money it saved" not in sources["records.js"] and "Money it saved" not in sources["Records.jsx"]
    assert not re.search(r"\[A-Z\]\{3\}|\[A-Za-z\]\{3\}", "".join(sources.values())), "no three-capitals currency pattern is left"
