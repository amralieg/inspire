import json

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire

PAGE = "app:page:n03_u01"
NAME = "Refund mismatch orders"
ASK = f"Add a KPI named '{NAME}' that counts the current orders whose reason category is Refund mismatch"
WHERE = f"the {NAME} KPI"
CHECKS = [{"kind": "text", "value": NAME}, {"kind": "column", "value": "reason category"},
          {"kind": "text", "value": "Refund mismatch"}]
RECORDS_SQL = ("SELECT o.order_key AS record_key, o.ai_reason AS reason_category, o.amount FROM main.inspire.n03_u01_out o "
               "WHERE o.run_id = (SELECT MAX(run_id) FROM main.inspire.n03_u01_out)")
COUNTED = {"id": "refund_mismatch", "label": NAME, "dataset": "records", "format": "integer",
           "expression": "SUM(CASE WHEN reason_category = 'Refund mismatch' THEN 1 ELSE 0 END)"}
TOTAL = {"id": "orders", "label": "Orders", "dataset": "records", "expression": "COUNT(*)", "format": "integer"}
REGION = {"id": "region_value", "title": "Value by region", "type": "bar", "dataset": "records",
          "x": {"column": "region", "label": "Region"}, "y": [{"expression": "SUM(amount)", "label": "Value"}]}
V1 = {"id": "n03_u01", "title": "Order review", "question": "Which orders need a second look?",
      "datasets": [{"name": "records", "sql": RECORDS_SQL}], "kpis": [TOTAL], "charts": [REGION],
      "records": {"title": "Order list", "key": "record_key", "label": "entity_label", "rank": "rank", "tier": "priority_tier",
                  "columns": [{"column": "amount", "label": "Amount"}]}}


def _copy(value):
    return json.loads(json.dumps(value))


def _page(**changes):
    return dict(_copy(V1), **changes)


def _round(agent_ns, new, ask=ASK, where=WHERE, checks=CHECKS):
    import shell_sql
    inst = _inspire(agent_ns, FakeSpark())
    judged = []

    def llm(kind, prompt, schema):
        if kind == "split":
            return {"asks": [{"ask": ask, "check": _copy(checks), "keep": False, "where": where}]}
        judged.append(prompt)
        return {"checks": [{"n": 1, "status": "missing", "evidence": "judge", "where": ""}]}

    inst._implement_vibes_llm = llm
    item = {"asset": PAGE, "text": ask, "artifact": _copy(new), "built_before": _copy(V1), "tools": {"shell_sql": shell_sql}}
    found = inst._implement_vibes_round({}, [item], "N03-U01 round 1/3")
    return found["checks"][PAGE][0], judged


def test_a_kpi_whose_expression_reads_the_asked_column_meets_the_column_check(agent_ns):
    check, judged = _round(agent_ns, _page(kpis=[TOTAL, COUNTED]))
    assert check["status"] == "done", check
    assert [(c["name"], c["passed"]) for c in check["checks"]] == [
        (f"text: {NAME}", True), ("column: reason category", True), ("text: Refund mismatch", True)]
    assert f"the {NAME} KPI works out its number from the column reason_category" in check["evidence"]
    assert judged == []


def test_a_kpi_that_never_reads_the_asked_column_still_fails_the_column_check(agent_ns):
    plain = dict(COUNTED, expression="SUM(CASE WHEN amount > 100 THEN 1 ELSE 0 END)", caption="Refund mismatch")
    check, judged = _round(agent_ns, _page(kpis=[TOTAL, plain]))
    assert check["status"] == "missing"
    assert check["evidence"] == f"the built {NAME} KPI on the App page n03_u01 names no column reason category"
    assert ("column: reason category", False) in [(c["name"], c["passed"]) for c in check["checks"]]


def test_a_kpi_whose_dataset_filters_on_the_asked_column_meets_the_column_check(agent_ns):
    sql = ("SELECT COUNT(*) AS n FROM main.inspire.n03_u01_out WHERE LOWER(reason_category) = 'refund mismatch' "
           "AND run_id = (SELECT MAX(run_id) FROM main.inspire.n03_u01_out) GROUP BY ALL")
    kpi = dict(COUNTED, dataset="mismatch", expression="SUM(n)")
    check, _judged = _round(agent_ns, _page(kpis=[TOTAL, kpi], datasets=V1["datasets"] + [{"name": "mismatch", "sql": sql}]))
    assert check["status"] == "done", check
    assert "works out its number from the column reason_category" in check["evidence"]


def test_a_column_the_kpi_dataset_only_selects_never_meets_the_column_check(agent_ns):
    sql = "SELECT reason_category, COUNT(*) AS n FROM main.inspire.n03_u01_out WHERE amount > 0 GROUP BY reason_category"
    kpi = dict(COUNTED, dataset="mismatch", expression="SUM(n)", caption="Refund mismatch")
    check, _judged = _round(agent_ns, _page(kpis=[TOTAL, kpi], datasets=V1["datasets"] + [{"name": "mismatch", "sql": sql}]))
    assert check["status"] == "missing"
    assert "names no column reason category" in check["evidence"]


def test_the_columns_a_kpi_works_from_are_its_expression_and_its_dataset_filters(agent_ns):
    used = agent_ns["implement_vibes_value_columns"]
    queries = {"records": RECORDS_SQL, "mismatch": "SELECT a, b FROM t WHERE c = 'x' AND LOWER(d) LIKE 'y%' GROUP BY a HAVING SUM(e) > 1 "
                                                   "ORDER BY f LIMIT 5"}
    assert used(COUNTED, queries)[0] == "reason_category"
    assert "run_id" in used(COUNTED, queries) and "amount" not in used(COUNTED, queries)
    assert used(dict(COUNTED, dataset="mismatch", expression="SUM(b)"), queries) == ["b", "c", "d", "e"]
    assert used(dict(COUNTED, dataset="none", expression="COUNT(*)"), queries) == []
    seen = agent_ns["implement_page_seen"](_page(kpis=[TOTAL, COUNTED]))
    assert "reason_category" in seen["refund_mismatch"]["uses"]
    assert all("uses" not in seen[key] for key in ("region_value", "records", "page"))


def test_a_chart_check_still_needs_the_chart_to_show_the_column(agent_ns):
    drawn = dict(REGION, id="mismatch_chart", title="Refund mismatch value",
                 y=[{"expression": "SUM(CASE WHEN reason_category = 'Refund mismatch' THEN amount ELSE 0 END)", "label": "Value"}])
    ask = "Add a Refund mismatch value chart that shows the reason category"
    checks = [{"kind": "column", "value": "reason category"}]
    check, _judged = _round(agent_ns, _page(charts=[REGION, drawn]), ask=ask, where="the Refund mismatch value chart", checks=checks)
    assert check["status"] == "missing"
    assert "names no column reason category" in check["evidence"]
    shown = dict(drawn, x={"column": "reason_category", "label": "Reason category"})
    check, _judged = _round(agent_ns, _page(charts=[REGION, shown]), ask=ask, where="the Refund mismatch value chart", checks=checks)
    assert check["status"] == "done"
    assert "shows the column reason_category" in check["evidence"]


def test_a_table_check_still_needs_the_table_to_show_the_column_even_when_a_kpi_reads_it(agent_ns):
    ask = "Show the reason category in the Order list table"
    checks = [{"kind": "column", "value": "reason category"}]
    check, _judged = _round(agent_ns, _page(kpis=[TOTAL, COUNTED]), ask=ask, where="the Order list table", checks=checks)
    assert check["status"] == "missing"
    assert "names no column reason category" in check["evidence"]
    unscoped, _judged = _round(agent_ns, _page(kpis=[TOTAL, COUNTED]), ask=ask, where="", checks=checks)
    assert unscoped["status"] == "missing"
    assert "names no column reason category" in unscoped["evidence"]
