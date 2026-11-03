import json

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _churn_page, _inspire
from v142_dash_test import DATES, LOSS, RESULT, _canvas, _chart, _dataset, _doc, _flow, _page, _parts, _runner, _shell
from v168_vibe_audit_scope_test import _dashboard_round, _round

CATEGORY = {"column": "category", "kind": "category", "label": "Category"}
MONTH = {"column": "month", "kind": "time", "label": "Month"}
CHANNEL = {"column": "channel", "top": 4}
REVENUE = {"label": "Revenue", "expression": "SUM(revenue)", "format": "currency", "currency": "USD"}


@pytest.fixture(scope="module")
def app_types(agent_ns, tmp_path_factory):
    return _inspire(agent_ns, FakeSpark(), local_log_output_dir=str(tmp_path_factory.mktemp("types")))._implement_vibe_chart_types("app")


def _kind(kind, **more):
    return dict({"id": "t", "type": kind, "title": "Loss", "hint": "Each part is one category.", "dataset": "trend", "x": CATEGORY,
                 "y": LOSS}, **more)


def _ask(text, check):
    return {"ask": text, "check": check, "keep": False, "where": "the Loss chart"}


def _published(agent_ns, tmp_path, page):
    doc = agent_ns["implement_dashboard_from_page"](page, _shell(agent_ns, tmp_path), RESULT, {})
    return doc, {"dashboard": (agent_ns["implement_vibes_text"](page), agent_ns["implement_dashboard_drawn"](page, doc))}


def _both_views(agent_ns, tmp_path, ask, chart):
    page = _page(agent_ns, charts=[chart])
    _doc_, published = _published(agent_ns, tmp_path, page)
    rules, _judged = _dashboard_round(agent_ns, "k", [ask], page, [])
    stored, _judged = _dashboard_round(agent_ns, "k", [ask], page, [], published)
    return rules[0], stored[0]


def test_a_horizontal_bar_draws_the_measure_across_and_the_largest_bar_first(agent_ns, tmp_path):
    widget, _doc_ = _chart(agent_ns, tmp_path, _kind("horizontal_bar"), _parts(9))
    spec = widget["spec"]
    assert (spec["widgetType"], spec["version"]) == ("bar", 3)
    x, y = spec["encodings"]["x"], spec["encodings"]["y"]
    assert (x["fieldName"], x["scale"]) == ("measure(chart_0_m0)", {"type": "quantitative"})
    assert (y["fieldName"], y["scale"]) == ("category", {"type": "categorical", "sort": {"by": "x-reversed"}})
    ascending, _doc_ = _chart(agent_ns, tmp_path, _kind("horizontal_bar", sort="value_asc"), _parts(9))
    assert ascending["spec"]["encodings"]["y"]["scale"]["sort"] == {"by": "x"}


def test_a_pareto_is_bars_largest_first_with_a_running_share_line_drawn_from_the_filtered_data(agent_ns, tmp_path):
    page = _page(agent_ns)
    index = next(i for i, c in enumerate(page["charts"]) if c["type"] == "pareto")
    page["filters"][3]["columns"] = {"records": page["filters"][3]["columns"]["records"]}
    doc = agent_ns["implement_dashboard_from_page"](page, _shell(agent_ns, tmp_path), RESULT, {})
    widget = next(w["widget"] for w in _canvas(doc)[0]["layout"] if w["widget"]["name"] == f"chart_{index}")
    spec, encodings = widget["spec"], widget["spec"]["encodings"]
    assert (spec["widgetType"], spec["version"]) == ("combo", 1)
    assert encodings["x"] == {"fieldName": "x", "displayName": "Category", "scale": {"type": "categorical"}}
    assert [f["fieldName"] for f in encodings["y"]["primary"]["fields"]] == ["sum(y0)"]
    assert encodings["y"]["secondary"]["fields"] == [{"fieldName": "max(share)", "displayName": "Running share"}]
    assert widget["queries"][0]["query"] == {"datasetName": f"chart_{index}_parts", "disaggregated": False, "fields": [
        {"name": "x", "expression": "`x`"}, {"name": "sum(y0)", "expression": "SUM(`y0`)"}, {"name": "max(share)", "expression": "MAX(`share`)"}]}
    parts = _dataset(doc, f"chart_{index}_parts")
    sql = "".join(parts["queryLines"])
    assert ("SUM(y0) OVER (ORDER BY y0 DESC NULLS LAST, part ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) / NULLIF(SUM(y0) OVER (), 0) "
            "AS share") in sql and "SUM(loss) AS y0" in sql
    assert sql.endswith(f"ORDER BY y0 DESC NULLS LAST, part\nLIMIT {page['charts'][index].get('limit', 25)}"), "the App's pareto limit"
    assert [(p["keyword"], p["complexType"]) for p in parts["parameters"]] == [("filter_0", "RANGE"), ("filter_1", "MULTI"),
                                                                              ("filter_2", "MULTI")]
    assert ":filter_3" not in sql, "the region filter covers only the decision list, so the pareto never reads it"
    assert ("(:filter_0 IS NULL OR ((:filter_0.min IS NULL OR CAST(`as_of_date` AS DATE) >= :filter_0.min) AND "
            "(:filter_0.max IS NULL OR CAST(`as_of_date` AS DATE) <= :filter_0.max)))") in sql, \
        "a viewer who picks All sends no range, and every row stays"
    assert "(:filter_1 IS NULL OR size(:filter_1) = 0 OR array_contains(:filter_1, CAST(`category` AS STRING)))" in sql, \
        "a viewer who picks All sends no list, and every row stays"
    filters = {w["widget"]["name"]: w["widget"] for w in _canvas(doc)[0]["layout"] if w["widget"]["name"].startswith("filter_")}
    for i in range(3):
        assert {"parameterName": f"filter_{i}", "queryName": f"filter_{i}_p0"} in filters[f"filter_{i}"]["spec"]["encodings"]["fields"]
        assert {"datasetName": f"chart_{index}_parts", "parameters": [{"name": f"filter_{i}", "keyword": f"filter_{i}"}],
                "disaggregated": False} in [q["query"] for q in filters[f"filter_{i}"]["queries"]]
    assert not any("parameterName" in f for f in filters["filter_3"]["spec"]["encodings"]["fields"])


def test_the_dashboard_runs_every_part_dataset_with_its_filters_at_their_defaults_before_it_publishes(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    inst._implement_dashboard(context, _runner(_churn_page(agent_ns)))
    doc, ran = _doc(seen), [sql for sql, _limit, _calls in seen["queries"]]
    parts = [d for d in doc["datasets"] if d.get("parameters")]
    assert [d["name"] for d in parts] == ["chart_3_parts"], "the example page's pareto reads its own dataset"
    bound = agent_ns["implement_dashboard_check_sql"](parts[0])
    assert bound in ran and ":filter_" not in bound
    assert ("(CAST(NULL AS STRUCT<min: DATE, max: DATE>) IS NULL OR ((CAST(NULL AS DATE) IS NULL OR CAST(`as_of_date` AS DATE) >= "
            "CAST(NULL AS DATE)) AND (CAST(NULL AS DATE) IS NULL OR CAST(`as_of_date` AS DATE) <= CAST(NULL AS DATE))))") in bound
    assert ("(CAST(array() AS ARRAY<STRING>) IS NULL OR size(CAST(array() AS ARRAY<STRING>)) = 0 OR "
            "array_contains(CAST(array() AS ARRAY<STRING>), CAST(`category` AS STRING)))") in bound
    stored = dict(parts[0], parameters=[dict(p, defaultSelection={"values": {"dataType": "STRING"}}) if p["complexType"] == "MULTI" else p
                                       for p in parts[0]["parameters"]])
    assert agent_ns["implement_dashboard_check_sql"](stored) == bound, "Lakeview drops an empty value list when it stores the dashboard"


@pytest.mark.parametrize("kind", ["line", "area"])
def test_a_line_or_an_area_on_a_category_axis_stays_a_line_or_an_area_in_its_order(agent_ns, tmp_path, kind):
    widget, _doc_ = _chart(agent_ns, tmp_path, _kind(kind, x=dict(CATEGORY, ordered=True), sort="x_asc"), _parts(4))
    assert (widget["spec"]["widgetType"], widget["spec"]["version"]) == (kind, 3)
    assert widget["spec"]["encodings"]["x"]["scale"] == {"type": "categorical", "sort": {"by": "natural-order"}}


@pytest.mark.parametrize("sort,by", [("value_desc", "y-reversed"), ("value_asc", "y"), ("x_asc", "natural-order"), (None, "y-reversed")])
def test_every_bar_sort_is_drawn_on_the_category_axis(agent_ns, tmp_path, sort, by):
    widget, _doc_ = _chart(agent_ns, tmp_path, _kind("bar", **({"sort": sort} if sort else {})), _parts(9))
    assert widget["spec"]["encodings"]["x"]["scale"] == {"type": "categorical", "sort": {"by": by}}


@pytest.mark.parametrize("kind,more,layout", [
    ("bar", {}, None), ("stacked_bar", {"series": CHANNEL}, "stack"), ("line", {}, None),
    ("area", {"series": CHANNEL}, "stack"), ("stacked_area", {"series": CHANNEL}, "stack")])
def test_a_chart_over_time_keeps_its_type_on_a_time_axis_with_no_category_sort(agent_ns, tmp_path, kind, more, layout):
    widget, _doc_ = _chart(agent_ns, tmp_path, _kind(kind, x=MONTH, **more), DATES)
    spec = widget["spec"]
    assert spec["widgetType"] == {"stacked_bar": "bar", "stacked_area": "area"}.get(kind, kind)
    assert spec["encodings"]["x"]["scale"] == {"type": "temporal"}, "time is drawn in time order"
    assert spec.get("mark") == ({"layout": layout} if layout else None)


@pytest.mark.parametrize("kind,more,layout,drawn", [
    ("stacked_bar", {"series": CHANNEL}, "stack", "stacked_bar"),
    ("bar", {"series": CHANNEL}, "group", "bar"),
    ("bar", {"y": LOSS + [REVENUE]}, "group", "bar"),
    ("horizontal_bar", {"y": LOSS + [REVENUE]}, "group", "horizontal_bar"),
    ("area", {"series": CHANNEL}, "stack", "stacked_area"),
    ("bar", {}, None, "bar")])
def test_stacked_charts_are_drawn_stacked_and_grouped_bars_side_by_side(agent_ns, tmp_path, kind, more, layout, drawn):
    page = _page(agent_ns, charts=[_kind(kind, **more)])
    doc, _published_ = _published(agent_ns, tmp_path, page)
    widget = next(w["widget"] for w in _canvas(doc)[0]["layout"] if w["widget"]["name"] == "chart_0")
    assert widget["spec"].get("mark") == ({"layout": layout} if layout else None)
    assert agent_ns["implement_dashboard_drawn"](page, doc)["charts"][0]["type"] == drawn
    assert agent_ns["implement_dashboard_drawn"](page)["charts"][0]["type"] == drawn, "the view rebuilt from the page agrees"
    legacy = json.loads(json.dumps(doc))
    for item in _canvas(legacy)[0]["layout"]:
        item["widget"].get("spec", {}).pop("mark", None)
    many = bool(more)
    assert agent_ns["implement_dashboard_drawn"](page, legacy)["charts"][0]["type"] == (
        {"bar": "stacked_bar", "area": "stacked_area"}.get(kind, drawn) if many and kind in ("bar", "area") else drawn), \
        "a bar or area with a series and no layout is drawn stacked, the dashboard's default"


GROUPED = _ask("Show the channels side by side as grouped bars", {"kind": "chart_type", "value": "grouped bar"})
STACKED = _ask("Stack the channels in each bar", {"kind": "chart_type", "value": "stacked bar"})
PLAIN_BAR = _ask("Make the Loss chart a bar chart", {"kind": "chart_type", "value": "bar"})
ACROSS = _ask("Make the Loss chart a horizontal bar chart", {"kind": "chart_type", "value": "horizontal bar"})


@pytest.mark.parametrize("ask,kind,more,status", [
    (GROUPED, "bar", {"series": CHANNEL}, "done"), (GROUPED, "bar", {"y": LOSS + [REVENUE]}, "done"),
    (GROUPED, "stacked_bar", {"series": CHANNEL}, "missing"), (GROUPED, "bar", {}, "missing"),
    (STACKED, "stacked_bar", {"series": CHANNEL}, "done"), (STACKED, "bar", {"series": CHANNEL}, "missing"),
    (PLAIN_BAR, "stacked_bar", {"series": CHANNEL}, "done"), (PLAIN_BAR, "horizontal_bar", {}, "missing"),
    (ACROSS, "bar", {}, "missing")])
def test_stacked_and_grouped_asks_are_met_only_by_the_layout_they_name(agent_ns, tmp_path, app_types, ask, kind, more, status):
    rules, stored = _both_views(agent_ns, tmp_path, ask, _kind(kind, **more))
    assert (rules["status"], stored["status"]) == (status, status), (rules, stored)
    app, _judged = _round(agent_ns, "app:page:n01_u01", "k", [ask], _page(agent_ns, charts=[_kind(kind, **more)]), chart_types=app_types)
    assert app[0]["status"] == status, app


def test_the_app_and_the_dashboard_both_draw_grouped_bars(agent_ns, app_types):
    assert app_types == ("bar", "horizontal_bar", "stacked_bar", "grouped_bar", "line", "area", "stacked_area", "pareto", "scatter",
                         "donut", "heatmap", "band", "control", "tornado", "bridge", "bullet", "treemap", "radar", "sankey")
    assert "grouped_bar" in agent_ns["IMPLEMENT_DASHBOARD_RENDERED_KINDS"]
    assert agent_ns["implement_chart_type_name"]("clustered column chart") == "grouped_bar"
    split = agent_ns["implement_vibes_split_prompt"]("dashboard", "Show grouped bars")
    assert "stacked_bar, grouped_bar, line" in split.replace('"\n            "', "")


BAR = _kind("bar")
KINDS = [
    ("horizontal bar", _kind("horizontal_bar"), BAR),
    ("pareto", _kind("pareto"), BAR),
    ("donut", _kind("donut"), BAR),
    ("line", _kind("line", x=dict(CATEGORY, ordered=True), sort="x_asc"), BAR),
    ("area", _kind("area", x=dict(CATEGORY, ordered=True), sort="x_asc"), BAR),
    ("bar", _kind("bar", x=MONTH), _kind("line", x=MONTH)),
    ("grouped bar", _kind("bar", series=CHANNEL), _kind("stacked_bar", series=CHANNEL)),
    ("stacked bar", _kind("stacked_bar", series=CHANNEL), _kind("bar", series=CHANNEL)),
]


@pytest.mark.parametrize("asked,drawn,other", KINDS, ids=[k[0] for k in KINDS])
def test_a_chart_kind_ask_is_met_when_the_dashboard_draws_that_kind_and_not_met_when_it_draws_another(agent_ns, tmp_path, asked, drawn,
                                                                                                       other):
    ask = _ask(f"Make the Loss chart a {asked} chart", {"kind": "chart_type", "value": asked})
    met = _both_views(agent_ns, tmp_path, ask, drawn)
    assert [c["status"] for c in met] == ["done", "done"], met
    missed = _both_views(agent_ns, tmp_path, ask, other)
    assert [c["status"] for c in missed] == ["missing", "missing"], missed
    assert all("has no" in c["evidence"] and "cannot draw" not in c["evidence"] for c in missed), missed


SORTS = [
    ("value_asc", "value", "asc", "value_desc"),
    ("value_desc", "loss", "desc", "value_asc"),
    ("x_asc", "category", "asc", "value_asc"),
]


@pytest.mark.parametrize("sort,value,direction,other", SORTS, ids=[s[0] for s in SORTS])
def test_a_sort_ask_is_met_when_the_dashboard_orders_the_chart_that_way_and_not_met_otherwise(agent_ns, tmp_path, sort, value, direction,
                                                                                               other):
    ask = _ask("Sort the Loss chart", {"kind": "sort", "value": value, "direction": direction})
    met = _both_views(agent_ns, tmp_path, ask, _kind("bar", sort=sort, x=dict(CATEGORY, ordered=True)))
    assert [c["status"] for c in met] == ["done", "done"] and met[0]["evidence"].startswith(f"sort: {sort} by"), met
    missed = _both_views(agent_ns, tmp_path, ask, _kind("bar", sort=other, x=dict(CATEGORY, ordered=True)))
    assert [c["status"] for c in missed] == ["missing", "missing"], missed


def test_a_published_bar_with_no_sort_of_its_own_meets_no_sort_ask(agent_ns, tmp_path):
    page = _page(agent_ns, charts=[_kind("bar", sort="value_asc")])
    doc, _published_ = _published(agent_ns, tmp_path, page)
    for item in _canvas(doc)[0]["layout"]:
        (item["widget"].get("spec", {}).get("encodings", {}).get("x") or {}).get("scale", {}).pop("sort", None)
    view = agent_ns["implement_dashboard_drawn"](page, doc)
    assert view["charts"][0].get("sort") == "none", view["charts"][0]
    ask = _ask("Sort the Loss chart from the smallest loss up", {"kind": "sort", "value": "value", "direction": "asc"})
    checks, _judged = _dashboard_round(agent_ns, "k", [ask], page, [], {"dashboard": (agent_ns["implement_vibes_text"](page), view)})
    assert checks[0]["status"] == "missing", checks


def test_an_app_chart_with_no_sort_is_ranked_largest_first_as_the_app_draws_it(agent_ns):
    page = _page(agent_ns, charts=[_kind("bar")])
    largest = _ask("Rank the Loss chart largest first", {"kind": "sort", "value": "value", "direction": "desc"})
    smallest = _ask("Rank the Loss chart smallest first", {"kind": "sort", "value": "value", "direction": "asc"})
    met, _judged = _round(agent_ns, "app:page:n01_u01", "k", [largest], page)
    missed, _judged = _round(agent_ns, "app:page:n01_u01", "k", [smallest], page)
    assert (met[0]["status"], missed[0]["status"]) == ("done", "missing"), (met, missed)
    assert met[0]["evidence"] == "sort: value_desc by Loss"


def test_the_dashboard_prompt_says_each_chart_is_drawn_as_its_own_type(agent_ns, tmp_path):
    inst, context, _seen = _flow(agent_ns, tmp_path)
    runner = _runner(_churn_page(agent_ns))
    inst._implement_dashboard(context, runner)
    prompt = runner.prompts[0]
    assert "each chart a dashboard chart of the same type, sort and series" in prompt and "drawn as a bar" not in prompt
    assert "A bar with a series {\"column\", \"top\"} or more than one measure draws its bars side by side, grouped" in prompt
