import json

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire
from v142_dash_test import RESULT, _canvas, _chart, _page, _parts, _shell
from v168_vibe_audit_scope_test import _dashboard_round, _round
from v169_dashboard_chart_kinds_test import CHANNEL, MONTH, _ask, _both_views, _kind, app_types

PAGE_KINDS = {"bar": {}, "horizontal_bar": {}, "stacked_bar": {"series": CHANNEL}, "line": {"x": MONTH}, "area": {"x": MONTH},
              "stacked_area": {"x": MONTH, "series": CHANNEL}, "pareto": {}, "donut": {}, "heatmap": {"series": {"column": "channel"}},
              "scatter": {"group": "category", "x": {"expression": "SUM(revenue)", "label": "Revenue", "format": "currency",
                                                     "currency": "USD"}}}
PIE = _ask("Make the Loss chart a pie chart", {"kind": "chart_type", "value": "pie"})
DONUT = _ask("Make the Loss chart a donut chart", {"kind": "chart_type", "value": "donut"})


def _every_kind(agent_ns, tmp_path):
    charts = [dict(_kind(kind, **more), id=f"c_{kind}") for kind, more in PAGE_KINDS.items()]
    page = _page(agent_ns, charts=charts)
    return page, agent_ns["implement_dashboard_from_page"](page, _shell(agent_ns, tmp_path), RESULT, {})


@pytest.mark.parametrize("parts", [6, 9, 25])
def test_a_donut_is_the_dashboards_own_pie_over_the_page_dataset_so_every_part_is_drawn(agent_ns, tmp_path, parts):
    widget, doc = _chart(agent_ns, tmp_path, _kind("donut"), _parts(parts))
    spec = widget["spec"]
    assert (spec["widgetType"], spec["version"]) == ("pie", 3)
    assert spec["encodings"] == {
        "angle": {"fieldName": "measure(chart_0_m0)", "displayName": "Loss", "scale": {"type": "quantitative"},
                  "format": {"type": "number-currency", "currencyCode": "USD", "abbreviation": "compact",
                             "decimalPlaces": {"type": "max", "places": 2}}},
        "color": {"fieldName": "category", "displayName": "Category", "scale": {"type": "categorical"}},
        "label": {"show": True}}
    assert widget["queries"][0]["query"] == {"datasetName": "trend", "disaggregated": False, "fields": [
        {"name": "category", "expression": "`category`"}, {"name": "measure(chart_0_m0)", "expression": "MEASURE(`chart_0_m0`)"}]}, \
        "the pie groups the page dataset itself, with no part dataset and no limit on its parts"
    assert not any(d["name"].endswith("_parts") for d in doc["datasets"])


def test_no_dashboard_the_builder_draws_carries_a_custom_visualization(agent_ns, tmp_path):
    page, doc = _every_kind(agent_ns, tmp_path)
    types = {w["widget"]["name"]: (w["widget"].get("spec") or {}).get("widgetType") for w in _canvas(doc)[0]["layout"]}
    assert [types[f"chart_{i}"] for i in range(len(page["charts"]))] == [
        "bar", "bar", "bar", "line", "area", "area", "combo", "pie", "heatmap", "scatter"]
    assert "custom-vega-viz" not in json.dumps(doc) and "vega-lite" not in json.dumps(doc)


@pytest.mark.parametrize("ask", [PIE, DONUT], ids=["pie", "donut"])
def test_a_pie_or_a_donut_ask_is_met_by_the_dashboards_pie_and_not_by_another_chart(agent_ns, tmp_path, ask):
    met = _both_views(agent_ns, tmp_path, ask, _kind("donut"))
    assert [(c["status"], c["evidence"]) for c in met] == [("done", "chart t: type pie")] * 2, met
    missed = _both_views(agent_ns, tmp_path, ask, _kind("bar"))
    assert [c["status"] for c in missed] == ["missing", "missing"], missed
    assert all("has no" in c["evidence"] and "cannot draw" not in c["evidence"] for c in missed), missed


def test_the_app_draws_its_own_donut_so_a_donut_ask_is_met_there_and_a_pie_ask_is_not(agent_ns, app_types):
    page = _page(agent_ns, charts=[_kind("donut")])
    donut, _judged = _round(agent_ns, "app:page:n01_u01", "k", [DONUT], page, chart_types=app_types)
    pie, _judged = _round(agent_ns, "app:page:n01_u01", "k", [PIE], page, chart_types=app_types)
    assert donut[0]["status"] == "done", donut
    assert (pie[0]["status"], pie[0]["evidence"]) == ("missing", "the App page n01_u01 cannot draw a pie chart: it draws "
                                                                 + ", ".join(app_types) + " charts"), pie


def test_the_split_prompt_names_pie_among_the_chart_types_a_reader_can_find(agent_ns):
    split = agent_ns["implement_vibes_split_prompt"]("dashboard", "Show the share as a pie").replace('"\n            "', "")
    assert "pareto, scatter, donut, pie or heatmap" in split


def _dated(agent_ns, tmp_path):
    page = _page(agent_ns)
    page["filters"].insert(1, {"id": "sold", "type": "date_range", "label": "Sale date", "grain": "day", "columns": {"trend": "month"}})
    doc = agent_ns["implement_dashboard_from_page"](page, _shell(agent_ns, tmp_path), RESULT, {})
    return page, doc, next(d for d in doc["datasets"] if d["name"].endswith("_parts"))


def test_no_dashboard_definition_shows_a_made_up_date_in_a_default_a_parameter_or_a_filter(agent_ns, tmp_path):
    _page_, doc, parts = _dated(agent_ns, tmp_path)
    text = json.dumps(doc)
    assert "1900" not in text and "9999" not in text
    ranges = [p for p in parts["parameters"] if p["complexType"] == "RANGE"]
    assert [p["keyword"] for p in ranges] == ["filter_0", "filter_1"]
    assert all("defaultSelection" not in p for p in ranges), "a date filter with no default shows no range"
    _every_page, every = _every_kind(agent_ns, tmp_path)
    assert "1900" not in json.dumps(every) and "9999" not in json.dumps(every)


def test_a_part_dataset_keeps_every_row_for_all_and_for_an_open_ended_range(agent_ns, tmp_path):
    _page_, _doc_, parts = _dated(agent_ns, tmp_path)
    sql = "".join(parts["queryLines"])
    assert ("(:filter_0 IS NULL OR ((:filter_0.min IS NULL OR CAST(`as_of_date` AS DATE) >= :filter_0.min) AND "
            "(:filter_0.max IS NULL OR CAST(`as_of_date` AS DATE) <= :filter_0.max)))") in sql
    assert "BETWEEN :filter_" not in sql, "BETWEEN a date and no date drops every row, which a range with one end left open sends"


def test_the_dataset_check_binds_a_range_with_no_default_as_all_and_a_chosen_range_as_chosen(agent_ns, tmp_path):
    check = agent_ns["implement_dashboard_check_sql"]
    _page_, _doc_, parts = _dated(agent_ns, tmp_path)
    bound = check(parts)
    assert ":filter_" not in bound
    assert ("(CAST(NULL AS STRUCT<min: DATE, max: DATE>) IS NULL OR ((CAST(NULL AS DATE) IS NULL OR CAST(`as_of_date` AS DATE) >= "
            "CAST(NULL AS DATE)) AND (CAST(NULL AS DATE) IS NULL OR CAST(`as_of_date` AS DATE) <= CAST(NULL AS DATE))))") in bound
    stored = dict(parts, parameters=[dict(p, defaultSelection={}) if p["complexType"] == "RANGE" else p for p in parts["parameters"]])
    assert check(stored) == bound, "Lakeview stores a range with no default as an empty selection"
    chosen = dict(parts, parameters=[dict(p, defaultSelection={"range": {"dataType": "DATE", "min": {"value": "2026-08-01"},
                                                                          "max": {"value": "2026-09-30"}}})
                                     if p["keyword"] == "filter_0" else p for p in parts["parameters"]])
    picked = check(chosen)
    assert ("(named_struct('min', DATE'2026-08-01', 'max', DATE'2026-09-30') IS NULL OR ((DATE'2026-08-01' IS NULL OR "
            "CAST(`as_of_date` AS DATE) >= DATE'2026-08-01') AND (DATE'2026-09-30' IS NULL OR CAST(`as_of_date` AS DATE) <= "
            "DATE'2026-09-30')))") in picked
    assert picked.count("CAST(NULL AS STRUCT<min: DATE, max: DATE>)") == bound.count("CAST(NULL AS STRUCT<min: DATE, max: DATE>)") - 1


RENDERED = ("bar", "horizontal_bar", "stacked_bar", "grouped_bar", "line", "area", "stacked_area", "pareto", "donut", "pie", "scatter",
            "heatmap")
PARETO = _ask("Make the Loss chart a pareto chart", {"kind": "chart_type", "value": "pareto"})


def _pareto(agent_ns, tmp_path, **more):
    page = _page(agent_ns, charts=[_kind("pareto", **more)])
    doc = agent_ns["implement_dashboard_from_page"](page, _shell(agent_ns, tmp_path), RESULT, {})
    widget = next(w["widget"] for w in _canvas(doc)[0]["layout"] if w["widget"]["name"] == "chart_0")
    return page, doc, widget, "".join(next(d for d in doc["datasets"] if d["name"] == "chart_0_parts")["queryLines"])


def _checked(agent_ns, page, view, ask):
    checks, _judged = _dashboard_round(agent_ns, "k", [ask], page, [], {"dashboard": (agent_ns["implement_vibes_text"](page), view)})
    return checks[0]


def test_a_pareto_is_a_combo_shaped_as_published_dashboards_draw_one(agent_ns, tmp_path):
    _page_, _doc_, widget, sql = _pareto(agent_ns, tmp_path)
    assert widget["spec"] == {"version": 1, "widgetType": "combo", "encodings": {
        "x": {"fieldName": "x", "displayName": "Category", "scale": {"type": "categorical"}},
        "y": {"primary": {"fields": [{"fieldName": "sum(y0)", "displayName": "Loss"}], "scale": {"type": "quantitative"},
                          "format": {"type": "number-currency", "currencyCode": "USD", "abbreviation": "compact",
                                     "decimalPlaces": {"type": "max", "places": 2}}},
              "secondary": {"fields": [{"fieldName": "max(share)", "displayName": "Running share"}], "scale": {"type": "quantitative"},
                            "format": {"type": "number-percent", "decimalPlaces": {"type": "max", "places": 0}}}},
        "label": {"show": False}},
        "frame": {"showTitle": True, "title": "Loss", "showDescription": True, "description": "Each part is one category."}}, \
        "no sort on the x axis, which draws an empty combo, and each format on its axis, never inside a field"
    assert widget["queries"][0]["query"] == {"datasetName": "chart_0_parts", "disaggregated": False, "fields": [
        {"name": "x", "expression": "`x`"}, {"name": "sum(y0)", "expression": "SUM(`y0`)"}, {"name": "max(share)", "expression": "MAX(`share`)"}]}
    assert sql.startswith("SELECT concat(lpad(CAST(ROW_NUMBER() OVER (ORDER BY y0 DESC NULLS LAST, part) AS STRING), 2, '0'), '. ', "
                          "coalesce(CAST(part AS STRING), 'null')) AS x, y0,\nSUM(y0) OVER (ORDER BY y0 DESC NULLS LAST, part ROWS BETWEEN "
                          "UNBOUNDED PRECEDING AND CURRENT ROW) / NULLIF(SUM(y0) OVER (), 0) AS share\nFROM (SELECT `category` AS part, "
                          "SUM(loss) AS y0\n"), sql
    assert sql.endswith("GROUP BY `category`) AS g\nORDER BY y0 DESC NULLS LAST, part\nLIMIT 25"), sql


@pytest.mark.parametrize("limit,width", [(9, 1), (25, 2), (500, 3)])
def test_a_pareto_numbers_its_bars_by_rank_wide_enough_that_a_to_z_is_rank_order(agent_ns, tmp_path, limit, width):
    _page_, _doc_, _widget_, sql = _pareto(agent_ns, tmp_path, limit=limit)
    assert f"AS STRING), {width}, '0'), '. '" in sql and sql.endswith(f"LIMIT {limit}")
    labels = [f"{str(rank).rjust(width, '0')}. part" for rank in range(1, limit + 1)]
    assert sorted(labels) == labels, "a combo draws its categories A to Z, so the rank leads each label"


def _round_12_pareto(widget):
    old = json.loads(json.dumps(widget))
    old["queries"][0]["query"].update(disaggregated=True, fields=[{"name": n, "expression": f"`{n}`"} for n in ("x", "y0", "share")])
    old["spec"]["encodings"] = {
        "x": {"fieldName": "x", "displayName": "Category", "scale": {"type": "categorical", "sort": {"by": "y-reversed"}}},
        "y": {"scale": {"type": "quantitative"}, "primary": {"fields": [{"fieldName": "y0", "displayName": "Loss"}]},
              "secondary": {"fields": [{"fieldName": "share", "displayName": "Running share"}]}}}
    return old


def _plain_parts(doc):
    for dataset in doc["datasets"]:
        if dataset["name"] == "chart_0_parts":
            text = "".join(dataset["queryLines"]).replace(
                "concat(lpad(CAST(ROW_NUMBER() OVER (ORDER BY y0 DESC NULLS LAST, part) AS STRING), 2, '0'), '. ', "
                "coalesce(CAST(part AS STRING), 'null')) AS x", "part AS x")
            dataset["queryLines"] = [line + "\n" for line in text.split("\n")]
    return doc


@pytest.mark.parametrize("change", ["as_built", "round_12", "sorted", "unranked", "no_line"])
def test_a_pareto_ask_is_met_only_when_the_published_combo_draws_ranked_bars_and_a_running_share(agent_ns, tmp_path, change):
    page, doc, widget, _sql_ = _pareto(agent_ns, tmp_path)
    published = json.loads(json.dumps(doc))
    item = next(w for w in _canvas(published)[0]["layout"] if w["widget"]["name"] == "chart_0")
    if change == "round_12":
        item["widget"] = _round_12_pareto(widget)
    elif change == "sorted":
        item["widget"]["spec"]["encodings"]["x"]["scale"]["sort"] = {"by": "y-reversed"}
    elif change == "unranked":
        _plain_parts(published)
    elif change == "no_line":
        item["widget"]["spec"]["encodings"]["y"]["secondary"]["fields"] = []
    view = agent_ns["implement_dashboard_drawn"](page, published)
    checked = _checked(agent_ns, page, view, PARETO)
    if change == "as_built":
        assert (view["charts"][0]["type"], checked["status"], checked["evidence"]) == ("pareto", "done", "chart t: type pareto"), checked
    else:
        assert (view["charts"][0]["type"], checked["status"]) == ("combo", "missing"), (change, checked)
        assert checked["evidence"].endswith("has no pareto chart; its charts are combo (t)"), checked


def test_the_dashboard_counts_only_the_chart_kinds_a_published_snapshot_showed_drawn(agent_ns, tmp_path):
    assert agent_ns.get("IMPLEMENT_DASHBOARD_RENDERED_KINDS") == RENDERED
    inst = _inspire(agent_ns, FakeSpark(), local_log_output_dir=str(tmp_path))
    assert inst._implement_vibe_chart_types("dashboard") == RENDERED
    page, doc = _every_kind(agent_ns, tmp_path)
    drawn = [c["type"] for c in agent_ns["implement_dashboard_drawn"](page, doc)["charts"]]
    assert drawn == ["bar", "horizontal_bar", "stacked_bar", "line", "area", "stacked_area", "pareto", "pie", "heatmap", "scatter"]
    assert set(drawn) <= set(RENDERED), "every kind the builder draws was seen drawn on a published dashboard"


@pytest.mark.parametrize("kind", ["waterfall", "funnel", "sankey", "combo", "custom-vega-viz"])
def test_a_kind_no_snapshot_showed_drawn_is_not_met_even_when_the_published_definition_has_it(agent_ns, tmp_path, kind):
    page = _page(agent_ns, charts=[_kind("bar")])
    doc = agent_ns["implement_dashboard_from_page"](page, _shell(agent_ns, tmp_path), RESULT, {})
    item = next(w for w in _canvas(doc)[0]["layout"] if w["widget"]["name"] == "chart_0")
    item["widget"]["spec"]["widgetType"] = kind
    view = agent_ns["implement_dashboard_drawn"](page, doc)
    assert view["charts"][0]["type"] == kind
    checked = _checked(agent_ns, page, view, _ask(f"Make the Loss chart a {kind} chart", {"kind": "chart_type", "value": kind}))
    assert checked["status"] == "missing", checked
    assert checked["evidence"].endswith(f"cannot draw a {kind} chart: it draws {', '.join(RENDERED)} charts"), checked
