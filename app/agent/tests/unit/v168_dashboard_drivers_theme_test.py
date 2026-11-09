"""Decisions 26A, 29A and 48A on the use case's AI/BI dashboard. 26A: code builds the dashboard skeleton and Genie designs the
use case's Drivers tiles, charts of the page spec marked "driver" that read the business output table; the dashboard always carries
a Drivers section, and a page spec without one, or with a Drivers chart off the result table, goes back to Genie. 29A: the dashboard
takes the Databricks palette (or the App palette the user chose) with separate light and dark values, chart colors that read on
both widget backgrounds and no fixed color anywhere else. 48A: semunity's dashboard rules are deterministic checks of
check_dashboard_definition, and a failed one goes back to Genie before anything publishes, offline."""
import json
import os
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
for folder in (SERVER, TESTS):
    if folder not in sys.path:
        sys.path.insert(0, folder)

from v140_implement_test import _churn_page  # noqa: E402
from v142_dash_test import RESULT, _canvas, _doc, _flow, _page, _palettes, _runner, _shell  # noqa: E402

ALLOWED = [RESULT, "main.s.orders"]


def _wcag(first, second):
    def luminance(color):
        text = color.lstrip("#")
        text = "".join(c * 2 for c in text) if len(text) == 3 else text
        parts = [int(text[i:i + 2], 16) / 255 for i in (0, 2, 4)]
        parts = [p / 12.92 if p <= 0.04045 else ((p + 0.055) / 1.055) ** 2.4 for p in parts]
        return 0.2126 * parts[0] + 0.7152 * parts[1] + 0.0722 * parts[2]

    high, low = sorted((luminance(first), luminance(second)), reverse=True)
    return (high + 0.05) / (low + 0.05)


def _named(page, name):
    return next(item for item in page["layout"] if item["widget"]["name"] == name)


def _clean(ns, tmp_path, page=None):
    shell_sql = _shell(ns, tmp_path)
    doc = ns["implement_dashboard_from_page"](page or _page(ns), shell_sql, RESULT, {},
                                             theme=ns["implement_dashboard_theme"](_palettes(), None, "coral"))
    return doc, shell_sql


def _check(ns, doc, shell_sql):
    return ns["check_dashboard_definition"](json.loads(json.dumps(doc)), ALLOWED, shell_sql.RECORDS_DATASET)[1]


def _hex_strings(node, path=""):
    if isinstance(node, dict):
        for key, value in node.items():
            if (path, key) != ("uiSettings", "theme") and key not in ("queryLines", "lines"):
                yield from _hex_strings(value, f"{path}.{key}" if path else key)
    elif isinstance(node, list):
        for value in node:
            yield from _hex_strings(value, path)
    elif isinstance(node, str) and node.startswith("#") and len(node) in (4, 7, 9):
        yield path, node


def test_the_dashboard_always_has_a_drivers_section_whose_tiles_are_the_driver_charts_of_the_page_spec(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    inst._implement_dashboard(context, _runner(_churn_page(agent_ns)))
    overview = _canvas(_doc(seen))[0]
    header = _named(overview, "drivers_header")
    assert header["widget"]["multilineTextboxSpec"]["lines"][0] == "## Drivers\n"
    assert "What drives the result: Where the loss sits." in header["widget"]["multilineTextboxSpec"]["lines"][-1]
    assert header["position"]["width"] == 12
    drivers = [item for item in overview["layout"] if item["widget"]["name"].startswith("driver_")]
    assert [d["widget"]["name"] for d in drivers] == ["driver_1"]
    tile = drivers[0]["widget"]
    assert tile["spec"]["widgetType"] == "bar" and tile["spec"]["frame"]["title"] == "Where the loss sits"
    assert tile["queries"][0]["query"]["datasetName"] == "records", "a Drivers tile reads the decision list of the result table"
    assert drivers[0]["position"]["y"] >= header["position"]["y"] + header["position"]["height"]
    charts = [item["widget"]["name"] for item in overview["layout"] if item["widget"]["name"].startswith("chart_")]
    assert charts == ["chart_0", "chart_2", "chart_3"], "the other charts stay above the Drivers section"
    assert max(_named(overview, c)["position"]["y"] for c in charts) < header["position"]["y"]
    assert _named(overview, "records")["position"]["y"] > drivers[0]["position"]["y"]


def test_a_page_spec_without_a_drivers_chart_goes_back_to_genie_and_publishes_once_it_has_one(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    bare = _churn_page(agent_ns)
    for chart in bare["charts"]:
        chart.pop("driver", None)
    runner = _runner(bare, _churn_page(agent_ns))
    inst._implement_dashboard(context, runner)
    assert len(runner.prompts) == 2
    assert "the page has no Drivers chart: set \"driver\": true on at least 1 chart" in runner.prompts[1]
    assert [c[:2] for c in seen["calls"]] == [("POST", "/api/2.0/lakeview/dashboards"), ("POST", "/api/2.0/lakeview/dashboards/d9/published")]


def test_a_drivers_chart_that_does_not_read_the_result_table_goes_back_to_genie(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    off = _churn_page(agent_ns)
    for chart in off["charts"]:
        chart["driver"] = chart["id"] == "pareto"
    runner = _runner(off, _churn_page(agent_ns))
    inst._implement_dashboard(context, runner)
    assert len(runner.prompts) == 2
    assert ("Drivers chart pareto reads dataset trend, which does not read the business output table `main.inspire.churn_out`"
            in runner.prompts[1])
    page = context["page_spec"]
    assert [c["id"] for c in page["charts"] if c.get("driver")] == ["by_category"]


def test_a_drivers_chart_must_name_a_dataset_and_a_drivers_tile_without_one_is_rejected(agent_ns, tmp_path):
    import shell_sql
    page = _churn_page(agent_ns)
    broken = json.loads(json.dumps(page))
    driver = next(c for c in broken["charts"] if c.get("driver"))
    driver.pop("dataset")
    assert "chart by_category reads dataset None, which the page does not define" in shell_sql.spec_problems(broken)
    driver["dataset"], driver["driver"] = "records", "yes"
    assert "chart by_category driver must be true or false" in shell_sql.spec_problems(broken)
    assert any("no Drivers chart" in p for p in shell_sql.quality_problems(broken)), "a driver that is not true is no driver"
    doc, sql = _clean(agent_ns, tmp_path)
    assert _check(agent_ns, doc, sql) == []
    _named(_canvas(doc)[0], "driver_1")["widget"]["queries"] = []
    errors = _check(agent_ns, doc, sql)
    assert any(e.endswith("widget driver_1 names no dataset: every tile that is not text reads a dataset of the dashboard")
               for e in errors), errors


@pytest.mark.parametrize("change,needle", [
    (lambda page: page["layout"].remove(_named(page, "drivers_header")), "has no Drivers section"),
    (lambda page: [page["layout"].remove(i) for i in list(page["layout"]) if i["widget"]["name"].startswith("driver_")],
     "the Drivers section of page Price-loss decision desk has no tile"),
    (lambda page: _named(page, "driver_1")["position"].update(y=0), "tile driver_1 in the Drivers section sits above the Drivers header"),
    (lambda page: _named(page, "drivers_header")["widget"]["multilineTextboxSpec"].update(lines=["## Other\n"]), "has no Drivers section"),
])
def test_the_drivers_rule_rejects_a_missing_header_an_empty_section_and_a_tile_above_it(agent_ns, tmp_path, change, needle):
    doc, sql = _clean(agent_ns, tmp_path)
    change(_canvas(doc)[0])
    assert any(needle in e for e in _check(agent_ns, doc, sql)), _check(agent_ns, doc, sql)


def test_a_page_whose_charts_are_all_drivers_keeps_its_chart_blocks_around_the_drivers_section(agent_ns, tmp_path):
    page = _page(agent_ns)
    for chart in page["charts"]:
        chart["driver"] = True
    page["blocks"] = [{"id": "note", "kind": "text", "place": {"where": "after", "of": "charts"}, "width": "half", "align": "left",
                       "content": "A note on the charts."}]
    doc, sql = _clean(agent_ns, tmp_path, page)
    overview = _canvas(doc)[0]
    assert not [i for i in overview["layout"] if i["widget"]["name"].startswith("chart_")]
    drivers = [i for i in overview["layout"] if i["widget"]["name"].startswith("driver_")]
    assert len(drivers) == 4 and min(d["position"]["y"] for d in drivers) >= _named(overview, "drivers_header")["position"]["y"] + 2
    note = _named(overview, "block_note")
    assert note["position"]["y"] >= max(d["position"]["y"] + d["position"]["height"] for d in drivers)
    assert note["position"]["width"] == 6
    assert _check(agent_ns, doc, sql) == [], "a narrow block the user placed is not a gap in the grid"


def test_the_genie_prompt_asks_for_drivers_charts_and_names_the_dashboard_section(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    runner = _runner(_churn_page(agent_ns))
    inst._implement_dashboard(context, runner)
    prompt = runner.prompts[0]
    assert "- Drivers: set \"driver\": true on at least 1 chart that shows what drives this use case's result" in prompt
    assert "A Drivers chart reads a dataset over `main.inspire.churn_out`" in prompt
    assert "the dashboard draws the Drivers charts in its own Drivers section below the other charts" in prompt
    assert '"driver": true' in prompt, "the example page Genie follows carries a Drivers chart"


def test_every_page_header_states_its_decision_and_how_to_read_its_tiles(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    inst._implement_dashboard(context, _runner(_churn_page(agent_ns)))
    overview, health = _canvas(_doc(seen))
    lines = _named(overview, "header")["widget"]["multilineTextboxSpec"]["lines"]
    assert lines[0] == "## Price-loss decision desk\n"
    assert lines[-1] == ("Which items lose the most margin to discounts, and what should we do about each one? How to read: start with "
                         "Loss to discounts and Loss rate and the tiles beside them, then read Loss to discounts by month and Loss "
                         "by channel over time and the tiles beside them, see what drives the result in Where the loss sits, then act "
                         "on the rows of Decision list.")
    guide = _named(health, "run_health_header")["widget"]["multilineTextboxSpec"]["lines"][-1]
    assert guide.startswith("Check that each run of the use case wrote its rows before you act on its list") and \
        guide.endswith("How to read: read Runs, newest first.")


def test_every_palette_gives_a_dashboard_theme_that_reads_in_light_and_dark(agent_ns):
    palettes = _palettes()
    assert len(palettes) == 13
    for name, palette in palettes.items():
        theme = agent_ns["implement_dashboard_theme"](palettes, name, "blue")
        for key in ("canvasBackgroundColor", "widgetBackgroundColor", "fontColor"):
            assert theme[key]["light"] != theme[key]["dark"], (name, key)
        for mode in ("light", "dark"):
            assert _wcag(theme["fontColor"][mode], theme["widgetBackgroundColor"][mode]) >= 4.5, (name, mode)
            assert _wcag(theme["fontColor"][mode], theme["canvasBackgroundColor"][mode]) >= 4.5, (name, mode)
            for color in theme["visualizationColors"]:
                assert _wcag(color, theme["widgetBackgroundColor"][mode]) >= 3, (name, mode, color)
        assert agent_ns["implement_dashboard_theme_problems"]({"uiSettings": {"theme": theme}}) == [], name


def test_the_serialized_dashboard_carries_the_databricks_light_and_dark_theme_and_no_fixed_color(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    inst._implement_dashboard(context, _runner(_churn_page(agent_ns)))
    body = next(c[2] for c in seen["calls"] if c[:2] == ("POST", "/api/2.0/lakeview/dashboards"))
    doc = json.loads(body["serialized_dashboard"])
    theme = doc["uiSettings"]["theme"]
    default = _palettes()["default"]
    assert theme["selectionColor"] == {"light": default["light"]["base"]["brand"], "dark": default["dark"]["base"]["brand"]}
    assert theme["canvasBackgroundColor"] == {"light": default["light"]["base"]["bg"], "dark": default["dark"]["base"]["bg"]}
    assert theme["widgetBackgroundColor"] == {"light": "#ffffff", "dark": default["dark"]["base"]["card"]}
    for mode in ("light", "dark"):
        assert all(_wcag(c, theme["widgetBackgroundColor"][mode]) >= 3 for c in theme["visualizationColors"]), mode
    assert list(_hex_strings(doc)) == [], "every color outside the theme is a theme reference, so dark mode recolors it"
    tier = next(c for c in _named(_canvas(doc)[0], "records")["widget"]["spec"]["encodings"]["columns"] if c["fieldName"] == "priority_tier")
    assert tier["style"]["rules"] == [{"condition": {"operator": "=", "operand": {"type": "data-value", "value": "Act now"}},
                                       "foregroundColor": {"themeColorType": "visualizationColors",
                                                           "position": len(theme["visualizationColors"]) - 1}}]
    assert theme["visualizationColors"][-1] == agent_ns["implement_dashboard_series_color"](
        default["light"]["base"]["brand"], default["dark"]["base"]["brand"], default["light"]["base"]["card"], default["dark"]["base"]["card"])


def _tier(doc):
    return next(c for c in _named(_canvas(doc)[0], "records")["widget"]["spec"]["encodings"]["columns"] if c["fieldName"] == "priority_tier")


@pytest.mark.parametrize("change,needle", [
    (lambda doc: _tier(doc)["style"]["rules"][0].update(foregroundColor="#ff0000"),
     "the dashboard sets the color #ff0000 at pages[0].layout"),
    (lambda doc: _named(_canvas(doc)[0], "chart_0")["widget"]["spec"].update(frame={"title": "x", "color": "rgb(255, 0, 0)"}),
     "the dashboard sets the color rgb(255, 0, 0)"),
    (lambda doc: doc["uiSettings"]["theme"].update(canvasBackgroundColor={"light": "#0b1020", "dark": "#0b1020"}),
     "the theme canvasBackgroundColor is #0b1020 in light and in dark mode"),
    (lambda doc: doc["uiSettings"]["theme"].update(fontColor={"light": "#cccccc", "dark": "#e7edf3"}),
     "in light mode the text color is"),
    (lambda doc: doc["uiSettings"]["theme"]["visualizationColors"].append("#eeeeee"),
     "the chart color #eeeeee is 1.16:1 on the light mode widget background, under 3.0:1"),
    (lambda doc: doc["uiSettings"]["theme"].update(widgetBorderColor="#e3e7ec"),
     "the theme widgetBorderColor is not one #rrggbb color for light mode and one for dark mode"),
    (lambda doc: doc["uiSettings"].pop("theme"), "the dashboard carries no theme"),
])
def test_a_light_only_or_fixed_color_is_caught(agent_ns, tmp_path, change, needle):
    doc, sql = _clean(agent_ns, tmp_path)
    assert _check(agent_ns, doc, sql) == []
    change(doc)
    errors = _check(agent_ns, doc, sql)
    assert any(needle in e for e in errors), errors


def _copy(doc, name, new, y=None):
    item = json.loads(json.dumps(_named(_canvas(doc)[0], name)))
    item["widget"]["name"] = new
    bottom = max(i["position"]["y"] + i["position"]["height"] for i in _canvas(doc)[0]["layout"])
    item["position"] = {"x": 0, "y": bottom if y is None else y, "width": 12, "height": item["position"]["height"]}
    _canvas(doc)[0]["layout"].append(item)


@pytest.mark.parametrize("change,needle", [
    (lambda doc: _named(_canvas(doc)[0], "chart_0")["widget"]["spec"].update(version=2), "widget chart_0 carries spec version 2; a line is version 3"),
    (lambda doc: _named(_canvas(doc)[0], "chart_0")["widget"]["spec"]["encodings"].pop("y"), "widget chart_0 lacks the y channel a line needs"),
    (lambda doc: _named(_canvas(doc)[0], "chart_0")["widget"]["spec"]["encodings"].update(size={"fieldName": "x"}),
     "widget chart_0 carries the channel size, which a line does not take"),
    (lambda doc: _named(_canvas(doc)[0], "chart_0")["widget"]["spec"].update(widgetType="choropleth-map"),
     "widget chart_0 is a choropleth-map widget, which Inspire does not draw"),
    (lambda doc: _named(_canvas(doc)[0], "filter_1")["widget"]["spec"]["encodings"]["fields"][0].update(queryName="nope"),
     "widget filter_1 is a filter whose fields do not use its queries one for one"),
    (lambda doc: _named(_canvas(doc)[0], "kpi_0")["widget"]["queries"][0].update(name="other"), "widget kpi_0 does not read a main_query"),
    (lambda doc: _named(_canvas(doc)[0], "header")["widget"]["multilineTextboxSpec"].update(lines=["## Price-loss decision desk\n", "\n", "Read it."]),
     "page Price-loss decision desk has no header line that states the decision it supports and how to read its tiles"),
    (lambda doc: _named(_canvas(doc)[0], "header")["widget"]["multilineTextboxSpec"].update(lines=["Price-loss decision desk"]),
     "page Price-loss decision desk does not open with a header"),
    (lambda doc: _canvas(doc)[1].update(layout=[i for i in _canvas(doc)[1]["layout"] if i["widget"]["name"] != "run_health_table"]),
     "page Run health shows no KPI, chart or table"),
    (lambda doc: _copy(doc, "chart_0", "chart_9"), "line chart_9 repeats chart_0: the same dataset and fields, whatever the widget type"),
    (lambda doc: _copy(doc, "kpi_2", "kpi_9"), "counter kpi_9 repeats kpi_2"),
    (lambda doc: _named(_canvas(doc)[0], "chart_0")["position"].update(width=6), "covers 6 of 12 columns, leaving a gap"),
    (lambda doc: _named(_canvas(doc)[0], "chart_2")["position"].update(x=3), "grid cells two widgets cover"),
    (lambda doc: _named(_canvas(doc)[0], "chart_2")["position"].update(width=13), "widget chart_2 has no place on the 12-column grid"),
    (lambda doc: _tier(doc).pop("style"), "the decision list of page Price-loss decision desk does not color its Act now rows"),
    (lambda doc: _tier(doc)["style"]["rules"][0]["foregroundColor"].update(position=0), "does not color its Act now rows"),
    (lambda doc: _named(_canvas(doc)[0], "kpi_1")["widget"].update(queries=[]), "widget kpi_1 names no dataset"),
    (lambda doc: doc["datasets"][0]["queryLines"].append("-- " + "x" * (16 * 1024 * 1024)), "over the 16777216-byte Lakeview limit"),
])
def test_each_adopted_semunity_rule_rejects_its_defect(agent_ns, tmp_path, change, needle):
    doc, sql = _clean(agent_ns, tmp_path)
    assert _check(agent_ns, doc, sql) == []
    change(doc)
    errors = _check(agent_ns, doc, sql)
    assert any(needle in e for e in errors), errors


def test_a_dashboard_rule_that_fails_goes_back_to_genie_and_nothing_publishes_until_it_passes(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    twice = _churn_page(agent_ns)
    twice["charts"].append(dict(twice["charts"][0], id="loss_area", title="Loss over the months", type="area"))
    runner = _runner(twice, _churn_page(agent_ns))
    inst._implement_dashboard(context, runner)
    assert len(runner.prompts) == 2
    assert "Inspire tried to use what you wrote and it failed:" in runner.prompts[1]
    assert "chart_4 repeats chart_0: the same dataset and fields, whatever the widget type" in runner.prompts[1]
    assert [c[:2] for c in seen["calls"]] == [("POST", "/api/2.0/lakeview/dashboards"), ("POST", "/api/2.0/lakeview/dashboards/d9/published")]
