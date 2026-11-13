"""Start Use Case MVP with Genie: one page spec drives the App and the AI/BI dashboard. The dashboard step obtains the page spec
with the App's prompt and validators, converts it to a Lakeview dashboard, runs every dataset before it publishes, and the App
reuses the same spec without a second Genie round, offline."""
import copy
import datetime
import importlib.util
import json
import os
import types

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import TRUTH, _FileRunner, _app_shell, _churn_page, _contract, _inspire, _output_context

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PALETTES = os.path.join(ROOT, "agent", "app_shell", "web", "src", "palettes.json")
RESULT = "main.inspire.churn_out"
ROWS = [dict(t, x="Books", y0=5.0) for t in TRUTH]


def _shell(ns, tmp_path):
    return _app_shell(ns, tmp_path)[1]["shell_sql"]


def _page(ns, **changes):
    return ns["implement_app_page"](_churn_page(ns, **changes), "N01-U01", {})


def _canvas(doc):
    return [p for p in doc["pages"] if p["pageType"] == "PAGE_TYPE_CANVAS"]


def _widgets(page, kind=None):
    return [item for item in page["layout"] if kind is None or ((item["widget"].get("spec") or {}).get("widgetType") == kind)]


def _dataset(doc, name):
    return next(d for d in doc["datasets"] if d["name"] == name)


def _flow(ns, tmp_path, outputs=None, assets=None, asset_status=None, fail=None, rows=None, **stubs):
    inst = _inspire(ns, FakeSpark())
    inst._genie_decision_contract = _contract
    inst.local_log_output_dir = str(tmp_path)
    inst._implement_input_has_dates = lambda context: False
    inst._implement_latest_run_rows = lambda table: list(TRUTH)
    inst._implement_notebook_paths = lambda uc, key: ("/W/acme_implemented/Sales", "/W/acme_implemented/Sales/N01-U01")
    inst.w_client = types.SimpleNamespace(workspace=types.SimpleNamespace(mkdirs=lambda p: None),
                                          config=types.SimpleNamespace(host="https://h/"))
    seen = {"queries": [], "calls": [], "checked": [], "deployed": []}

    def query(sql, require_rows=False, limit=20):
        seen["queries"].append((sql, limit, len(seen["calls"])))
        if fail and fail in sql:
            raise RuntimeError("UNRESOLVED_COLUMN: boom")
        return [dict(r) for r in (rows if rows is not None else ROWS)]

    def api(method, path, body=None, query=None):
        seen["calls"].append((method, path, body))
        return {"dashboard_id": "d9"} if (method, path) == ("POST", "/api/2.0/lakeview/dashboards") else {}

    inst._implement_run_query_check = query
    inst._implement_api = api
    inst._implement_app_check = lambda work, files, modules, warehouse: setattr(inst, "_implement_app_speeds", {}) or seen["checked"].append((files, warehouse)) or []
    inst._implement_app_name = lambda context, name: name
    inst._implement_deploy_app = (lambda context, name, files, reads, space_id="", lakebase=None, page_tables=():
                                  seen["deployed"].append((name, files, reads, space_id)) or {"app_name": name})
    for name, value in stubs.items():
        setattr(inst, name, value)
    context = _output_context(ns, **(outputs or {}))
    context.update(assets=assets or {}, asset_status=asset_status or {})
    return inst, context, seen


def _runner(*pages):
    return _FileRunner([{"exit": 0} for _ in pages], [{"page.json": p if isinstance(p, str) else json.dumps(p)} for p in pages])


def _published(seen):
    return [c for c in seen["calls"] if c[0] in ("POST", "PATCH") and "/lakeview/dashboards" in c[1]]


def _doc(seen):
    body = next(c[2] for c in seen["calls"] if c[:2] in (("POST", "/api/2.0/lakeview/dashboards"),)
                or (c[0] == "PATCH" and "/lakeview/dashboards/" in c[1]))
    return json.loads(body["serialized_dashboard"])


def test_the_dashboard_is_built_from_the_page_spec_and_the_app_reuses_it_without_a_second_genie_round(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    runner = _runner(_churn_page(agent_ns))
    fields = inst._implement_dashboard(context, runner)
    assert fields == {"dashboard_id": "d9", "dashboard_url": "https://h/dashboardsv3/d9/published"}
    assert len(runner.prompts) == 1 and runner.prompts[0].startswith("Write the file page.json in your working folder")
    assert "Inspire draws it as the use case's App and the use case's AI/BI dashboard" in runner.prompts[0]
    assert "each KPI is a counter" in runner.prompts[0] and "each chart a dashboard chart of the same type, sort and series" in runner.prompts[0]
    page = context["page_spec"]
    assert page["id"] == "n01_u01" and page["use_case_id"] == "N01-U01"
    assert [c[:2] for c in seen["calls"]] == [("POST", "/api/2.0/lakeview/dashboards"),
                                              ("POST", "/api/2.0/lakeview/dashboards/d9/published")]
    assert seen["calls"][0][2]["parent_path"] == "/W/acme_implemented/Sales" and seen["calls"][0][2]["warehouse_id"] == "wh1"
    assert seen["calls"][1][2] == {"warehouse_id": "wh1", "embed_credentials": False}
    assert [json.loads(files["pages/n01_u01.json"]) for files, _w in seen["checked"]] == [page], "the page ran through the App's check"
    doc = _doc(seen)
    assert {d["name"] for d in doc["datasets"]} >= {d["name"] for d in page["datasets"]}
    assert _canvas(doc)[0]["displayName"] == page["title"]
    never = _FileRunner([], [])
    assert inst._implement_app(context, never)["app_name"] == "churn-desk"
    assert never.prompts == [], "the App reuses the dashboard's page spec; Genie is not asked again"
    name, files, reads, _space = seen["deployed"][0]
    deployed = json.loads(files["pages/n01_u01.json"])
    app_only = ("genie", "genie_note", "tour", "value_ledger")
    assert {k: v for k, v in deployed.items() if k not in app_only} == {k: v for k, v in page.items() if k not in app_only} and name == "churn-desk"
    assert deployed["value_ledger"] == "`main`.`inspire`.`__inspire_value_ledger`", "the App counts its values in the value ledger (lane E); the dashboard spec never names it"
    assert deployed["tour"]["steps"] and set(deployed["tour"]["steps"]) == {"English"}, "the App writes its own tour, the dashboard spec has none"
    assert "genie" not in page and "genie_note" not in page, "the dashboard's page spec never carries the App's Genie Agent"
    assert deployed["genie"] is None
    assert deployed["genie_note"] == "The Genie Agent is not ready: it was not built", \
        "the App page says why Ask Genie is off when this use case has no Genie Agent"
    assert len(seen["checked"]) == 2, "the App still runs its own files at the default filters before it deploys"
    steps = [(e["step_name"], e["status"]) for e in inst.emitted if e["step_name"] == "App"]
    assert steps == [("App", "started"), ("App", "ended_success")]
    assert "no second Genie round" in next(e["message"] for e in inst.emitted if e["step_name"] == "App")


def test_a_patch_on_an_existing_dashboard_keeps_its_id_and_never_moves_it(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path, assets={"dashboard": "d9"})
    inst._implement_dashboard(context, _runner(_churn_page(agent_ns)))
    assert seen["calls"][0][:2] == ("GET", "/api/2.0/lakeview/dashboards/d9"), "Inspire reads the dashboard first so it can put it back"
    assert seen["calls"][1][:2] == ("PATCH", "/api/2.0/lakeview/dashboards/d9") and "parent_path" not in seen["calls"][1][2]
    assert not any(c[0] == "POST" and c[1] == "/api/2.0/lakeview/dashboards" for c in seen["calls"]), "the dashboard is never moved or copied"


def test_only_the_app_still_asks_genie_for_the_page_spec_and_keeps_it(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path, outputs={"dashboard": False})
    runner = _runner(_churn_page(agent_ns))
    assert inst._implement_app(context, runner)["app_name"] == "churn-desk"
    assert len(runner.prompts) == 1 and "AI/BI dashboard" not in runner.prompts[0] and "on the dashboard" not in runner.prompts[0].lower()
    assert "Inspire draws it as the use case's App and runs its queries on the SQL warehouse; the App answers Ask Genie" in runner.prompts[0]
    assert context["page_spec"]["id"] == "n01_u01"


def test_a_dashboard_only_prompt_names_the_dashboard_and_the_user_filters_win(agent_ns, tmp_path):
    inst, context, _seen = _flow(agent_ns, tmp_path, outputs={"app": False, "dashboard_filters": ["channel", "region"]})
    runner = _runner(_churn_page(agent_ns))
    inst._implement_dashboard(context, runner)
    prompt = runner.prompts[0]
    assert "Inspire draws it as the use case's AI/BI dashboard and runs its queries on the SQL warehouse; you choose" in prompt
    assert "Ask Genie;" not in prompt.split("\n")[0]
    assert ("What the user asked the dashboard to filter on (this wins over every rule below): channel, region; add a filter on each."
            in prompt)


def test_a_reused_page_spec_that_fails_the_app_check_fails_the_app_step_and_says_so(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    inst._implement_dashboard(context, _runner(_churn_page(agent_ns)))
    inst._implement_app_check = lambda work, files, modules, warehouse: ["page n01_u01: chart:by_category failed: warehouse stopped"]
    with pytest.raises(RuntimeError, match="the App was run at its default filters and page n01_u01: chart:by_category failed"):
        inst._implement_app(context, _FileRunner([], []))
    last = [e for e in inst.emitted if e["step_name"] == "App"][-1]
    assert last["status"] == "ended_error" and "warehouse stopped" in last["message"]
    assert seen["deployed"] == []


def _two_segments(ns):
    page = _churn_page(ns)
    page["filters"] = [f for f in page["filters"] if f["id"] != "region"]
    return page


def _no_dates(ns):
    page = _churn_page(ns)
    page["filters"] = [f for f in page["filters"] if f["type"] != "date_range"]
    for kpi in page["kpis"]:
        kpi.pop("compare", None)
    return page


def _no_records(ns):
    page = _churn_page(ns)
    for dataset in page["datasets"]:
        if dataset["name"] == "records":
            dataset["name"] = "listed"
    for item in (page.get("charts") or []) + (page.get("tables") or []):
        if item.get("dataset") == "records":
            item["dataset"] = "listed"
    page.pop("records")
    for f in page["filters"]:
        f["columns"].pop("records", None)
    page["kpis"] = [k for k in page["kpis"] if k["dataset"] != "records"] + [
        {"id": "rows", "label": "Rows", "dataset": "trend", "expression": "COUNT(*)", "format": "integer"}]
    return page


@pytest.mark.parametrize("make,needle", [
    (_two_segments, "the page has 2 segment filters; add at least 3 people can slice by"),
    (_no_dates, "the page has no date range filter; add one on the run date (as_of_date)"),
    (_no_records, "the page has no dataset named records: it is the decision list"),
])
def test_a_page_spec_that_breaks_a_dashboard_rule_goes_back_to_genie_and_nothing_publishes(agent_ns, tmp_path, make, needle):
    inst, context, seen = _flow(agent_ns, tmp_path)
    with pytest.raises(RuntimeError, match="still failed after 3 Genie rounds"):
        inst._implement_dashboard(context, _runner(make(agent_ns), make(agent_ns), make(agent_ns)))
    assert _published(seen) == [] and "page_spec" not in context
    errors = [e["message"] for e in inst.emitted if e["step_name"] == "Dashboard" and "failed" in e["message"]]
    assert errors and all("page.json does not fit the Dashboard: " in m and needle in m for m in errors), errors


def test_a_page_spec_without_the_user_filter_goes_back_to_genie_then_publishes(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path, outputs={"dashboard_filters": ["loyalty_tier"]})
    fixed = _churn_page(agent_ns)
    fixed["filters"].append({"id": "loyalty_tier", "type": "multi_select", "label": "Loyalty tier",
                             "columns": {"trend": "loyalty_tier", "records": "loyalty_tier"}})
    runner = _runner(_churn_page(agent_ns), fixed)
    assert inst._implement_dashboard(context, runner)["dashboard_id"] == "d9"
    assert "the user asked the dashboard to filter on loyalty_tier, which no filter of the page covers" in runner.prompts[1]
    assert [c[:2] for c in seen["calls"]] == [("POST", "/api/2.0/lakeview/dashboards"),
                                              ("POST", "/api/2.0/lakeview/dashboards/d9/published")]
    assert _shell(agent_ns, tmp_path).request_problems(fixed, ["Loyalty Tier", "loyalty-tier"]) == []


def test_a_failing_dataset_query_blocks_publish_and_goes_back_to_genie(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path, fail="concat_ws")
    with pytest.raises(RuntimeError, match="still failed after 3 Genie rounds"):
        inst._implement_dashboard(context, _runner(*[_churn_page(agent_ns)] * 3))
    assert _published(seen) == []
    messages = [e["message"] for e in inst.emitted if e["step_name"] == "Dashboard"]
    assert any("dataset records failed: UNRESOLVED_COLUMN: boom" in m for m in messages), messages


def test_every_dashboard_dataset_and_chart_query_runs_before_publish(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    inst._implement_dashboard(context, _runner(_churn_page(agent_ns)))
    doc = _doc(seen)
    ran = [sql for sql, _limit, calls_before in seen["queries"] if calls_before == 0]
    assert all(calls == 0 for _sql, _limit, calls in seen["queries"]), "no query runs after the dashboard is saved"
    for dataset in doc["datasets"]:
        assert agent_ns["implement_dashboard_check_sql"](dataset) in ran, dataset["name"]
    shell_sql = _shell(agent_ns, tmp_path)
    for chart in context["page_spec"]["charts"]:
        assert shell_sql.chart_query(context["page_spec"], chart["id"], {})[0] in ran, chart["id"]
    limits = {sql: limit for sql, limit, _c in seen["queries"]}
    assert limits["".join(_dataset(doc, "records")["queryLines"])] == 1000


def test_a_shown_column_that_is_a_list_goes_back_to_genie_and_a_hidden_one_does_not(agent_ns, tmp_path):
    listed = [dict(r, category=["Books", "Music"], raw_extra=["x"]) for r in ROWS]
    inst, context, seen = _flow(agent_ns, tmp_path, rows=listed)
    with pytest.raises(RuntimeError, match="still failed after 3 Genie rounds"):
        inst._implement_dashboard(context, _runner(*[_churn_page(agent_ns)] * 3))
    messages = [e["message"] for e in inst.emitted if e["step_name"] == "Dashboard"]
    assert any("dataset records returns category as a list, which people would read as raw JSON" in m for m in messages)
    assert not any("raw_extra" in m for m in messages), "a column no table shows is never read as raw JSON"
    assert _published(seen) == []


def test_the_kpis_become_one_counter_row_over_dataset_measures_with_formats(agent_ns, tmp_path):
    shell_sql = _shell(agent_ns, tmp_path)
    page = _page(agent_ns)
    doc = agent_ns["implement_dashboard_from_page"](page, shell_sql, RESULT, {})
    counters = _widgets(_canvas(doc)[0], "counter")
    assert len(counters) == len(page["kpis"]) == 3
    assert len({c["position"]["y"] for c in counters}) == 1, "the KPIs sit in one row"
    assert sum(c["position"]["width"] for c in counters) == 12 and all(c["position"]["height"] >= 3 for c in counters)
    loss, rate, items = (c["widget"] for c in counters)
    value = loss["spec"]["encodings"]["value"]
    assert loss["spec"]["version"] == 2 and loss["queries"][0]["query"]["fields"] == [
        {"name": "measure(kpi_0_m0)", "expression": "MEASURE(`kpi_0_m0`)"}]
    assert value == {"fieldName": "measure(kpi_0_m0)", "displayName": "Loss to discounts",
                     "format": {"type": "number-currency", "currencyCode": "USD", "abbreviation": "compact",
                                "decimalPlaces": {"type": "max", "places": 2}}}
    trend = _dataset(doc, "trend")["columns"]
    assert {"displayName": "kpi_0_m0", "expression": "SUM(loss)"} in trend
    assert {"displayName": "kpi_1_m0", "expression": "(SUM(loss) / NULLIF(SUM(revenue), 0) * 100) / 100"} in trend, \
        "the App writes a percent as 0 to 100; the dashboard's percent format reads 0 to 1"
    assert rate["spec"]["encodings"]["value"]["format"] == {"type": "number-percent", "decimalPlaces": {"type": "max", "places": 1}}
    assert items["spec"]["encodings"]["value"]["format"] == {"type": "number", "decimalPlaces": {"type": "max", "places": 0}}
    assert items["spec"]["frame"] == {"showTitle": True, "title": "Items on the list", "showDescription": True,
                                      "description": "from the latest run"}


@pytest.mark.parametrize("kpis,widths", [(3, [4, 4, 4]), (4, [3, 3, 3, 3]), (5, [3, 3, 2, 2, 2]), (6, [2] * 6)])
def test_every_row_of_the_grid_fills_twelve_columns(agent_ns, tmp_path, kpis, widths):
    shell_sql = _shell(agent_ns, tmp_path)
    page = _page(agent_ns)
    page["kpis"] = [dict(page["kpis"][0], id=f"k{i}", label=f"Loss {i}") for i in range(kpis)]
    doc = agent_ns["implement_dashboard_from_page"](page, shell_sql, RESULT, {})
    assert [c["position"]["width"] for c in _widgets(_canvas(doc)[0], "counter")] == widths
    for canvas in _canvas(doc):
        rows = {}
        for item in canvas["layout"]:
            p = item["position"]
            assert 0 <= p["x"] and p["x"] + p["width"] <= 12 and p["width"] >= 1, item["widget"]["name"]
            rows.setdefault(p["y"], []).append(p)
        for y, row in rows.items():
            assert sum(p["width"] for p in row) == 12, (canvas["name"], y, row)
            assert sorted(p["x"] for p in row) == [sum(q["width"] for q in sorted(row, key=lambda r: r["x"])[:i]) for i in range(len(row))]


def test_every_page_has_a_date_range_and_the_overview_has_the_event_date_and_three_segments(agent_ns, tmp_path):
    shell_sql = _shell(agent_ns, tmp_path)
    page = _page(agent_ns)
    page["filters"][0]["columns"] = {"records": "as_of_date"}
    page["filters"].insert(1, {"id": "sold", "type": "date_range", "label": "Sale date", "grain": "day", "columns": {"trend": "month"}})
    assert agent_ns["implement_app_page_problems"](page, shell_sql, [RESULT, "main.s.orders"], True) == []
    doc = agent_ns["implement_dashboard_from_page"](page, shell_sql, RESULT, {})
    canvases = _canvas(doc)
    assert [c["name"] for c in canvases] == ["overview", "run_health"]
    for canvas in canvases:
        dates = _widgets(canvas, "filter-date-range-picker")
        assert dates and any(f["fieldName"] == "as_of_date" for d in dates for f in d["widget"]["spec"]["encodings"]["fields"]), \
            canvas["name"]
    overview = canvases[0]
    dates = _widgets(overview, "filter-date-range-picker")
    assert [d["widget"]["spec"]["frame"]["title"] for d in dates] == ["Run date", "Sale date"]
    run_date, sold = dates[0]["widget"], dates[1]["widget"]
    assert [(q["query"]["datasetName"], q["query"]["fields"]) for q in run_date["queries"]] == [
        ("records", [{"name": "as_of_date", "expression": "`as_of_date`"}])]
    assert [(q["query"]["datasetName"], q["query"].get("fields") or q["query"]["parameters"]) for q in sold["queries"]] == [
        ("trend", [{"name": "month", "expression": "`month`"}]), ("chart_3_parts", [{"name": "filter_1", "keyword": "filter_1"}])], \
        "the pareto reads its own dataset, so the sale date reaches it as a parameter"
    assert [f["queryName"] for f in run_date["spec"]["encodings"]["fields"]] == [q["name"] for q in run_date["queries"]]
    segments = _widgets(overview, "filter-multi-select")
    assert [s["widget"]["spec"]["frame"]["title"] for s in segments] == ["Category", "Channel", "Region"]
    assert all(q["query"]["disaggregated"] is False for s in segments + dates for q in s["widget"]["queries"])
    assert "".join(_dataset(doc, "trend")["queryLines"]).startswith(
        "SELECT * FROM (SELECT * EXCEPT (`month`), CAST(`month` AS DATE) AS `month`\nFROM (SELECT "), \
        "a date filter reads a DATE whatever the column type, and the choice filters narrow the trend by parameter around it"
    assert all({q["query"]["datasetName"] for q in s["widget"]["queries"] if "fields" in q["query"]} == {"records"} for s in segments), \
        "a choice filter that names the decision list lists its values from it alone"
    health = _widgets(canvases[1], "filter-date-range-picker")[0]["widget"]
    assert health["spec"]["frame"]["title"] == "Run date" and health["queries"][0]["query"]["datasetName"] == "run_health"


def test_a_page_with_fewer_than_three_segments_or_no_run_date_never_reaches_the_converter(agent_ns, tmp_path):
    shell_sql = _shell(agent_ns, tmp_path)
    allowed = [RESULT, "main.s.orders"]
    problems = agent_ns["implement_app_page_problems"]
    assert problems(_page(agent_ns), shell_sql, allowed, False) == []
    two = _page(agent_ns)
    two["filters"] = [f for f in two["filters"] if f["id"] != "region"]
    two["similar_by"] = [b for b in two["similar_by"] if b != "region"]
    assert "the page has 2 segment filters; add at least 3 people can slice by" in problems(two, shell_sql, allowed, False)
    undated = _page(agent_ns)
    undated["filters"][0]["columns"] = {"trend": "month"}
    assert "no date range filters the run date (as_of_date) of the business output table" in problems(undated, shell_sql, allowed, False)
    assert "an input table has a date column, so add a second date range on that event date" in problems(
        _page(agent_ns), shell_sql, allowed, True)


def _chart(ns, tmp_path, chart, rows):
    shell_sql = _shell(ns, tmp_path)
    page = _page(ns, charts=[chart])
    doc = ns["implement_dashboard_from_page"](page, shell_sql, RESULT, {chart["id"]: rows})
    return next(w["widget"] for w in _canvas(doc)[0]["layout"] if w["widget"]["name"] == "chart_0"), doc


LOSS = [{"label": "Loss", "expression": "SUM(loss)", "format": "currency", "currency": "USD"}]
DATES = [{"x": datetime.date(2026, 9, 1), "y0": 1.0}, {"x": datetime.date(2026, 10, 1), "y0": 2.0}]


def _parts(n):
    return [{"x": f"c{i}", "y0": float(i)} for i in range(n)]


@pytest.mark.parametrize("chart,rows,kind,x_scale", [
    ({"id": "t", "type": "line", "x": {"column": "month", "kind": "time", "label": "Month"}}, DATES, "line", "temporal"),
    ({"id": "t", "type": "bar", "x": {"column": "month", "kind": "time", "label": "Month"}}, DATES, "bar", "temporal"),
    ({"id": "t", "type": "area", "x": {"column": "month", "kind": "time", "label": "Month"}}, [{"x": "2026-09", "y0": 1.0}], "area",
     "categorical"),
    ({"id": "t", "type": "stacked_bar", "x": {"column": "month", "kind": "time", "label": "Month"}, "series": {"column": "channel"}},
     DATES, "bar", "temporal"),
    ({"id": "t", "type": "bar", "x": {"column": "category", "kind": "category", "label": "Category"}}, _parts(9), "bar", "categorical"),
    ({"id": "t", "type": "line", "x": {"column": "category", "kind": "category", "label": "Category"}}, _parts(9), "line",
     "categorical"),
])
def test_charts_keep_the_type_the_page_gives_them_on_the_axis_their_data_has(agent_ns, tmp_path, chart, rows, kind, x_scale):
    chart = dict(chart, title="Loss", hint="Each bar is one part.", dataset="trend", y=LOSS)
    widget, doc = _chart(agent_ns, tmp_path, chart, rows)
    spec = widget["spec"]
    assert (spec["widgetType"], spec["version"]) == (kind, 3)
    encodings = spec["encodings"]
    x = encodings["x"]
    assert x["fieldName"] == chart["x"]["column"] and x["scale"]["type"] == x_scale
    measure = encodings["y"]
    assert measure["fieldName"] == "measure(chart_0_m0)" and measure["format"]["type"] == "number-currency"
    assert {"displayName": "chart_0_m0", "expression": "SUM(loss)"} in _dataset(doc, "trend")["columns"]
    if x_scale == "categorical":
        assert x["scale"]["sort"] == {"by": "natural-order" if chart["x"]["kind"] == "time" else "y-reversed"}, \
            "a category axis is drawn largest first, the page's default sort, and time in its own order"
    if chart.get("series"):
        assert encodings["color"]["fieldName"] == "channel"
    assert spec["frame"] == {"showTitle": True, "title": "Loss", "showDescription": True, "description": "Each bar is one part."}


def test_a_time_axis_a_date_filter_casts_to_a_date_is_temporal_even_when_the_page_wrote_text(agent_ns, tmp_path):
    shell_sql = _shell(agent_ns, tmp_path)
    page = _page(agent_ns, charts=[{"id": "t", "type": "line", "title": "Loss", "hint": "By month.", "dataset": "trend", "y": LOSS,
                                    "x": {"column": "month", "kind": "time", "label": "Month"}}])
    text_rows = {"t": [{"x": "2026-09", "y0": 1.0}]}
    plain = agent_ns["implement_dashboard_from_page"](page, shell_sql, RESULT, text_rows)
    chart = next(w["widget"] for w in _canvas(plain)[0]["layout"] if w["widget"]["name"] == "chart_0")
    assert chart["spec"]["encodings"]["x"]["scale"]["type"] == "categorical"
    page["filters"][0]["columns"] = {"records": "as_of_date"}
    page["filters"].insert(1, {"id": "sold", "type": "date_range", "label": "Sale date", "columns": {"trend": "month"}})
    dated = agent_ns["implement_dashboard_from_page"](page, shell_sql, RESULT, text_rows)
    chart = next(w["widget"] for w in _canvas(dated)[0]["layout"] if w["widget"]["name"] == "chart_0")
    assert chart["spec"]["encodings"]["x"]["scale"]["type"] == "temporal"


def test_a_donut_with_more_than_six_parts_is_the_dashboards_pie_of_every_part(agent_ns, tmp_path):
    chart = {"id": "share", "type": "donut", "title": "Share", "hint": "Share of loss.", "dataset": "trend", "y": LOSS,
             "x": {"column": "category", "kind": "category", "label": "Category"}}
    assert agent_ns["implement_dashboard_chart_type"](chart) == "pie"
    widget, _doc = _chart(agent_ns, tmp_path, chart, _parts(25))
    assert widget["spec"]["widgetType"] == "pie" and widget["queries"][0]["query"]["datasetName"] == "trend"


def test_two_measures_are_a_scatter_and_two_categories_a_heatmap(agent_ns, tmp_path):
    scatter = {"id": "s", "type": "scatter", "title": "Loss against revenue", "hint": "One point per category.", "dataset": "trend",
               "group": "category", "x": {"expression": "SUM(revenue)", "label": "Revenue", "format": "currency", "currency": "USD"},
               "y": LOSS}
    widget, doc = _chart(agent_ns, tmp_path, scatter, [])
    encodings = widget["spec"]["encodings"]
    assert widget["spec"]["widgetType"] == "scatter"
    assert widget["queries"][0]["query"]["fields"] == [{"name": "category", "expression": "`category`"},
                                                       {"name": "measure(chart_0_x)", "expression": "MEASURE(`chart_0_x`)"},
                                                       {"name": "measure(chart_0_m0)", "expression": "MEASURE(`chart_0_m0`)"}]
    assert encodings["x"]["scale"]["type"] == encodings["y"]["scale"]["type"] == "quantitative"
    assert encodings["color"] == {"fieldName": "category", "displayName": "Category", "scale": {"type": "categorical"}}
    assert {"displayName": "chart_0_x", "expression": "SUM(revenue)"} in _dataset(doc, "trend")["columns"]
    heat = {"id": "h", "type": "heatmap", "title": "Loss by category and channel", "hint": "Darker is more loss.", "dataset": "trend",
            "x": {"column": "category", "kind": "category", "label": "Category"}, "series": {"column": "channel"}, "y": LOSS}
    widget, _doc = _chart(agent_ns, tmp_path, heat, _parts(3))
    encodings = widget["spec"]["encodings"]
    assert widget["spec"]["widgetType"] == "heatmap"
    assert (encodings["x"]["fieldName"], encodings["y"]["fieldName"], encodings["color"]["fieldName"]) == (
        "category", "channel", "measure(chart_0_m0)")


def test_the_records_are_a_table_ranked_with_reasons_as_text(agent_ns, tmp_path):
    shell_sql = _shell(agent_ns, tmp_path)
    page = _page(agent_ns)
    doc = agent_ns["implement_dashboard_from_page"](page, shell_sql, RESULT, {}, theme=agent_ns["implement_dashboard_theme"](_palettes()))
    tables = _widgets(_canvas(doc)[0], "table")
    records = tables[-1]["widget"]
    assert records["queries"][0]["query"]["datasetName"] == "records" and records["queries"][0]["query"]["disaggregated"] is True
    assert records["queries"][0]["query"]["orders"] == [{"direction": "ASC", "expression": "`rank`"}]
    columns = [(c["fieldName"], c["displayName"]) for c in records["spec"]["encodings"]["columns"]]
    assert columns == [("rank", "Rank"), ("entity_label", "Name"), ("priority_tier", "Priority tier"), ("top_reasons", "Reasons"),
                       ("recommended_action", "Recommended action"), ("category", "Category"), ("value", "Loss"),
                       ("channel", "Channel"), ("region", "Region")]
    assert tables[-1]["position"] == {"x": 0, "y": tables[-1]["position"]["y"], "width": 12, "height": 9}
    sql = "".join(_dataset(doc, "records")["queryLines"])
    assert sql.startswith("SELECT * EXCEPT (`as_of_date`, `top_reasons`), CAST(`as_of_date` AS DATE) AS `as_of_date`, "
                          "concat_ws(' · ', `top_reasons`) AS `top_reasons`\nFROM (SELECT o.record_key, o.entity_id")
    assert agent_ns["check_dashboard_definition"](doc, [RESULT, "main.s.orders"], shell_sql.RECORDS_DATASET)[1] == []


def test_a_table_shows_a_percent_column_as_written_and_names_the_unit(agent_ns, tmp_path):
    shell_sql = _shell(agent_ns, tmp_path)
    page = _page(agent_ns, tables=[{"id": "worst", "title": "Worst items", "dataset": "trend", "sort": {"column": "loss"},
                                    "columns": [{"column": "category", "label": "Category", "format": "text"},
                                                {"column": "loss_rate", "label": "Loss rate", "format": "percent"}]}])
    doc = agent_ns["implement_dashboard_from_page"](page, shell_sql, RESULT, {})
    table = next(w["widget"] for w in _canvas(doc)[0]["layout"] if w["widget"]["name"] == "table_0")
    assert table["spec"]["encodings"]["columns"] == [
        {"fieldName": "category", "displayName": "Category"},
        {"fieldName": "loss_rate", "displayName": "Loss rate (%)", "format": {"type": "number", "decimalPlaces": {"type": "max", "places": 1}}}]
    assert table["queries"][0]["query"]["orders"] == [{"direction": "DESC", "expression": "`loss`"}]
    fmt = agent_ns["implement_dashboard_format"]
    assert fmt({"format": "currency", "currency": "usd"}) == {"type": "number", "abbreviation": "compact",
                                                             "decimalPlaces": {"type": "max", "places": 2}}
    assert fmt({"format": "text"}) is None and fmt({"format": "date"}) is None and fmt({"format": "month"}) is None


def test_the_run_health_page_counts_flags_against_ok_per_run(agent_ns, tmp_path):
    shell_sql = _shell(agent_ns, tmp_path)
    doc = agent_ns["implement_dashboard_from_page"](_page(agent_ns), shell_sql, RESULT, {})
    sql = "".join(_dataset(doc, "run_health")["queryLines"])
    assert "100.0 * COUNT_IF(data_quality_flag <> 'ok') / COUNT(*) AS flagged_share" in sql
    assert "FROM `main`.`inspire`.`churn_out`" in sql and sql.endswith("WHERE change_source = 'run'\nGROUP BY run_id, as_of_date\nORDER BY as_of_date DESC"), \
        "people's edits, adds and deletes are versions of the table too, so only the rows runs wrote count as a run's rows"
    assert agent_ns["_implement_flag_count_problems"]([sql], "a dashboard dataset") == []
    health = _canvas(doc)[1]
    table = _widgets(health, "table")[0]["widget"]
    assert [c["fieldName"] for c in table["spec"]["encodings"]["columns"]] == ["run_id", "as_of_date", "row_count", "model_version",
                                                                               "flagged_share"]
    page = _page(agent_ns)
    page["datasets"].append({"name": "run_health", "sql": "SELECT as_of_date, category FROM main.s.orders"})
    page["filters"][1]["columns"]["run_health"] = "category"
    doc = agent_ns["implement_dashboard_from_page"](page, shell_sql, RESULT, {})
    names = [d["name"] for d in doc["datasets"]]
    assert names[names.index("run_health"):names.index("run_health_") + 1] == ["run_health", "run_health_"], \
        "Inspire's dataset never replaces Genie's"


def test_the_dashboard_links_a_ready_genie_agent_and_the_agent_is_built_first(agent_ns, tmp_path):
    assert list(agent_ns["IMPLEMENT_OUTPUTS"]).index("genie_space") < list(agent_ns["IMPLEMENT_OUTPUTS"]).index("dashboard")
    inst, context, seen = _flow(agent_ns, tmp_path, outputs={"genie_space_name": "Churn [desk]"}, assets={"genie_space": "g1"})
    inst._implement_dashboard(context, _runner(_churn_page(agent_ns)))
    doc = _doc(seen)
    overview = _canvas(doc)[0]
    link = next(w for w in overview["layout"] if w["widget"]["name"] == "genie_link")
    assert link["widget"]["multilineTextboxSpec"]["lines"] == [
        "Ask the Genie Agent [Churn desk](https://h/genie/rooms/g1) about these results in plain language."]
    assert link["position"] == {"x": 0, "y": 2, "width": 12, "height": 1}
    assert doc["uiSettings"]["genieSpace"] == {"isEnabled": True, "enablementMode": "ENABLED", "overrideId": "g1"}
    for outputs, assets in (({}, {}), ({"genie_space": False, "app": False}, {"genie_space": "g1"})):
        inst, context, seen = _flow(agent_ns, tmp_path / f"off{len(outputs)}", outputs=outputs, assets=assets)
        inst._implement_dashboard(context, _runner(_churn_page(agent_ns)))
        doc = _doc(seen)
        assert "genie_link" not in [w["widget"]["name"] for w in _canvas(doc)[0]["layout"]]
        assert "genieSpace" not in doc.get("uiSettings", {})


def _palettes():
    with open(PALETTES, encoding="utf-8") as handle:
        return json.load(handle)


def test_the_dashboard_theme_follows_the_app_palette_when_the_user_set_one(agent_ns, tmp_path):
    palettes, hexed = _palettes(), agent_ns["implement_hex_color"]
    theme = agent_ns["implement_dashboard_theme"](palettes, "ocean", "coral")
    light, dark = palettes["ocean"]["light"]["base"], palettes["ocean"]["dark"]["base"]
    for key, color in (("canvasBackgroundColor", "bg"), ("widgetBackgroundColor", "card"), ("widgetBorderColor", "line"),
                       ("fontColor", "ink"), ("selectionColor", "brand")):
        assert theme[key] == {"light": hexed(light[color]), "dark": hexed(dark[color])}, key
    hues = palettes["ocean"]["light"]["hues"]
    series = agent_ns["implement_dashboard_series_color"]
    darks = palettes["ocean"]["dark"]["hues"]
    assert theme["visualizationColors"][0] == series(hues["coral"]["line"], darks["coral"]["line"], light["card"], dark["card"])
    assert len(theme["visualizationColors"]) == len(hues) + 1
    assert theme["visualizationColors"][-1] == series(light["brand"], dark["brand"], light["card"], dark["card"])
    assert agent_ns["implement_dashboard_highlight"](theme) == {"themeColorType": "visualizationColors", "position": len(hues)}
    default = agent_ns["implement_dashboard_theme"](palettes, "default")
    assert default["selectionColor"] == {"light": "#ff3621", "dark": "#ff5c47"}, "the default palette is the Databricks palette"
    assert default["widgetBackgroundColor"] == {"light": "#ffffff", "dark": "#161b22"}
    for palette in (None, "no-such-palette"):
        assert agent_ns["implement_dashboard_theme"](palettes, palette) == default
    assert agent_ns["implement_dashboard_theme"](None, "ocean") is None
    payload, modules = _app_shell(agent_ns, tmp_path)
    inst, context, seen = _flow(agent_ns, tmp_path, _implement_app_shell=lambda: (dict(payload, palettes=palettes), modules))
    context["spec"]["outputs"]["app_look"] = {"palette": "ocean", "theme": "dark"}
    inst._implement_dashboard(context, _runner(_churn_page(agent_ns)))
    assert _doc(seen)["uiSettings"]["theme"] == agent_ns["implement_dashboard_theme"](palettes, "ocean", "coral")
    inst, context, seen = _flow(agent_ns, tmp_path / "plain", _implement_app_shell=lambda: (dict(payload, palettes=palettes), modules))
    inst._implement_dashboard(context, _runner(_churn_page(agent_ns)))
    assert _doc(seen)["uiSettings"]["theme"] == agent_ns["implement_dashboard_theme"](palettes, "default", "coral"), \
        "no palette was chosen, so the dashboard takes the Databricks palette in light and dark"


def _embed():
    spec = importlib.util.spec_from_file_location("inspire_app_shell_embed_dash", os.path.join(ROOT, "agent", "app_shell", "embed.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_notebook_carries_the_app_palettes_and_the_embed_gate_names_their_drift(agent_ns):
    payload = agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))
    assert payload["palettes"] == _palettes()
    embed = _embed()
    expected = embed.payload(static=False)
    drifted = copy.deepcopy(payload)
    drifted["palettes"]["ocean"]["light"]["base"]["bg"] = "#000000"
    assert "palettes.json differs" in embed.differences(expected, drifted, static=False)
    assert "palettes.json differs" not in embed.differences(expected, payload, static=False)


def test_the_shown_columns_are_the_table_fields_of_each_dataset(agent_ns, tmp_path):
    shell_sql = _shell(agent_ns, tmp_path)
    doc = agent_ns["implement_dashboard_from_page"](_page(agent_ns), shell_sql, RESULT, {})
    shown = agent_ns["implement_dashboard_shown_columns"](doc)
    assert shown["records"] == {"rank", "entity_label", "priority_tier", "top_reasons", "recommended_action", "category", "value",
                                "channel", "region"}
    assert shown["run_health"] == {"run_id", "as_of_date", "row_count", "model_version", "flagged_share"}
    assert "trend" not in shown, "a dataset only charts and counters read shows no raw column"


def test_the_dashboard_definition_check_flags_repeated_names_and_reads_of_datasets_it_does_not_define(agent_ns, tmp_path):
    check = agent_ns["check_dashboard_definition"]
    board = {"datasets": [{"name": "decision_list", "queryLines": [f"SELECT * FROM {RESULT}"]}],
             "pages": [{"name": "p", "displayName": "p", "layout": [
                 {"widget": {"name": "w", "queries": [{"name": "q", "query": {"datasetName": "decision_list"}}]}},
                 {"widget": {"name": "w", "queries": [{"name": "q", "query": {"datasetName": "gone"}}]}}]}]}
    errors = check(json.dumps(board), [RESULT])[1]
    assert "two widgets share the name w" in errors
    assert "widgets read datasets the dashboard does not define: gone" in errors
    shell_sql = _shell(agent_ns, tmp_path)
    doc = agent_ns["implement_dashboard_from_page"](_page(agent_ns), shell_sql, RESULT, {}, theme=agent_ns["implement_dashboard_theme"](_palettes()))
    assert check(json.dumps(doc), [RESULT, "main.s.orders"], shell_sql.RECORDS_DATASET)[1] == []
    doc["pages"][0]["layout"].append(json.loads(json.dumps(doc["pages"][0]["layout"][-1])))
    assert "two widgets share the name records" in check(json.dumps(doc), [RESULT, "main.s.orders"], shell_sql.RECORDS_DATASET)[1]


def test_the_decision_list_of_a_use_case_that_holds_records_back_explains_held_back(agent_ns):
    from v140_implement_test import SHELL_SQL
    with open(os.path.join(ROOT, "agent", "app_shell", "example_page.json"), encoding="utf-8") as handle:
        page = agent_ns["implement_app_page"](json.load(handle), "N01-U01", {})
    records = lambda held: next(w["widget"] for w in _canvas(agent_ns["implement_dashboard_from_page"](page, SHELL_SQL, RESULT, {}, held=held))[0]
                                ["layout"] if w["widget"]["name"] == "records")
    shown, plain = records(True)["spec"]["frame"], records(False)["spec"]["frame"]
    assert shown["description"].endswith(SHELL_SQL.HELD_MEANING) and shown["showDescription"] is True
    assert SHELL_SQL.HELD_MEANING not in plain.get("description", ""), "a use case that holds nothing back says nothing about it"
    bare = dict(page, records={k: v for k, v in page["records"].items() if k != "hint"})
    frame = next(w["widget"] for w in _canvas(agent_ns["implement_dashboard_from_page"](bare, SHELL_SQL, RESULT, {}, held=True))[0]["layout"]
                 if w["widget"]["name"] == "records")["spec"]["frame"]
    assert frame["description"] == SHELL_SQL.HELD_MEANING
