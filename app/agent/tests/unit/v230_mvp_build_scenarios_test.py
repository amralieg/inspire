"""v2.3.0 MVP build scenarios across use case kinds and data shapes, run offline against the checks the build runs.

1. The page check told the builder to add a missing kind of chart "of type bar or horizontal_bar or stacked_bar in the
   sensitivity_tornado section", but that section holds only tornado and horizontal_bar charts. A builder that took the first type
   had its bar moved to the asked charts section, where no ask names it, so the next round told it to leave the bar out, and the
   round after asked for the bar again. Each section named now lists only the types it holds.
2. A scenario kind kept its kind when its tables held two numeric columns, even when one was a key such as customer_id, while
   the data check and the scenario lab page both need two levers and an outcome: three numeric measures. The kind check, the
   data check and the page now count the same measures through one rule.
3. A page that named a column such as "Order Date" or one written in Arabic was told only that the column "is not a column
   name" or "needs a column", which reads as if no column were named. Every column check now says the name is not a plain one
   and how to select it AS a plain name.
4. inspire_write_result and inspire_write_companion wrote columns of any name, but the App reads and edits the result table by
   plain column names only, so every edit a person made failed at run time. The writers now refuse such a frame with the fix.
5. A page.json whose charts, tables, filters, KPIs or datasets held an entry that was not a JSON object, such as null, crashed the
   page check with "'NoneType' object has no attribute 'get'", in Inspire's check, in the check Genie runs and in the App. One shape
   check now says which entries are wrong before any other check reads them. The Genie Agent and dashboard checks had the same
   crash for a file that was a list, a section that was a list instead of an object, or a null page or tile, and now run the same
   shape check first.
6. The check Genie runs before it hands a page back skipped the chart kind check whenever fewer_charts held any text, and never
   checked the fewer_charts, fewer_rows and reason_charts quotes, the filters the user asked the dashboard for, html blocks on a
   dashboard or the decision list dataset. Inspire then sent the page back for problems Genie's check had passed, costing a round
   each. Both now run one shared set of page rules.
7. A dashboard page or widget with no name was named in the check as "page None" or "widgets  name no dataset", and two unnamed
   widgets read as "two widgets share the name". Each check now says which page holds the widget and that it has no name.
8. A grant to a principal whose name holds a backtick was dropped with no gap and no message, so nobody was granted and the run did
   not say why. Every GRANT and REVOKE now quotes the principal, doubling a backtick, and the plan keeps the grant.
"""
import copy
import glob
import io
import json
import os
import re
import subprocess
import sys
import types
from contextlib import redirect_stdout

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(TESTS))
SHELL = os.path.join(ROOT, "agent", "app_shell")
SERVER = os.path.join(SHELL, "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402

EXAMPLES = {os.path.basename(path)[:-5]: path for path in glob.glob(os.path.join(SHELL, "examples", "*.json"))}
ADVICE = re.compile(r"of type ((?:[a-z_]+)(?: or [a-z_]+)*) in the ([a-z_]+) section")


def _example(layout):
    with open(EXAMPLES[layout], encoding="utf-8") as handle:
        return json.load(handle)


def _quiet(call, *args):
    with redirect_stdout(io.StringIO()):
        return call(*args)


def _kind_cases():
    for layout in sorted(EXAMPLES):
        page = _example(layout)
        for kind, types in shell_sql.CHART_KIND_TYPES.items():
            if shell_sql.native_homes(page, "charts", types):
                yield layout, kind


@pytest.mark.parametrize("layout,kind", list(_kind_cases()))
def test_every_section_the_kind_advice_names_holds_every_type_it_names(layout, kind):
    page = _example(layout)
    page["charts"] = [c for c in page.get("charts") or [] if c.get("type") not in shell_sql.CHART_KIND_TYPES[kind]]
    [said] = _quiet(shell_sql.kind_problems, page, [kind])[0]
    pairs = [(t, section) for types, section in ADVICE.findall(said) for t in types.split(" or ")]
    assert pairs, said
    for chart_type, section in pairs:
        tried = copy.deepcopy(page)
        tried["charts"].append({"id": "asked_kind", "type": chart_type, "section": section, "so_what": "Act on the largest first."})
        moved = _quiet(shell_sql.place_items, tried)
        assert not moved, f"{said!r}: a {chart_type} in {section} was moved: {moved}"
        assert not shell_sql.asked_section_items(tried), said
        assert not _quiet(shell_sql.kind_problems, tried, [kind])[0], said
        assert not [p for p in shell_sql.layout_problems(tried, set()) if "asked_kind" in p], said


def test_the_planner_bars_advice_names_only_the_type_its_section_holds():
    page = _example("planner")
    page["charts"] = [c for c in page["charts"] if c.get("type") not in shell_sql.BARS]
    [said] = _quiet(shell_sql.kind_problems, page, ["bars"])[0]
    assert said == ("the page draws no bars by segment chart: add one of type horizontal_bar in the sensitivity_tornado section")


def test_a_kind_with_homes_of_different_types_names_each_home_with_its_own_types():
    page = _example("performance_explainer")
    page["charts"] = [c for c in page["charts"] if c.get("type") not in shell_sql.BARS]
    [said] = _quiet(shell_sql.kind_problems, page, ["bars"])[0]
    assert said == ("the page draws no bars by segment chart: add one of type horizontal_bar in the driver_tornado section, or of type "
                    "bar or horizontal_bar in the funnel section")


def test_the_default_layout_still_names_every_type_with_no_section():
    page = {"layout": shell_sql.DEFAULT_LAYOUT, "charts": []}
    assert _quiet(shell_sql.kind_problems, page, ["bars"])[0] == [
        "the page draws no bars by segment chart: add one of type bar or horizontal_bar or stacked_bar"]


SCENARIO_KIND = "driver_scenarios"


def _signals(ns, columns):
    return ns["DatabricksInspire"]._column_signals(columns)


def test_a_scenario_kind_whose_only_numbers_are_a_key_and_one_measure_lacks_its_levers(agent_ns):
    gap = agent_ns["DatabricksInspire"]._kind_companion_gap(SCENARIO_KIND, _signals(agent_ns, {"customer_id": "BIGINT", "amount": "DOUBLE",
                                                                                               "region": "STRING"}))
    assert gap == ("its __scenario_model table needs 3 numeric measure columns, 2 levers to change and an outcome they move, which its "
                   "tables do not hold")


def test_two_measures_are_one_lever_short_and_three_fill_the_scenario(agent_ns):
    gap = agent_ns["DatabricksInspire"]._kind_companion_gap
    assert gap(SCENARIO_KIND, _signals(agent_ns, {"price": "DOUBLE", "units": "INT"})).startswith("its __scenario_model table needs 3")
    assert gap(SCENARIO_KIND, _signals(agent_ns, {"price": "DOUBLE", "discount": "DOUBLE", "units": "INT", "order_id": "BIGINT"})) == ""


def test_the_kind_check_and_the_data_check_need_the_same_measures(agent_ns, monkeypatch):
    runtime = agent_ns["TECHNICAL_CONTEXT"]["runtime"]
    for levers, needed in ((1, 3), (2, 3), (4, 5)):
        monkeypatch.setitem(runtime, "signal_min_levers", levers)
        assert agent_ns["inspire_scenario_measures_needed"]() == needed
        assert agent_ns["inspire_companion_data_text"]("levers").startswith(f"{needed} numeric measure columns, {needed - 1} levers")


def test_the_notebook_scenario_lever_floor_is_the_page_floor(agent_ns):
    assert agent_ns["INSPIRE_SCENARIO_PAGE_LEVERS"] == shell_sql.SCENARIO_LEVERS[0]
    page = _example("scenario_lab")
    page["scenario"]["levers"] = page["scenario"]["levers"][:1]
    assert [p for p in shell_sql.layout_problems(page, {d["name"] for d in page["datasets"]}) if "levers; it has 1" in p]


ARABIC = "\u0627\u0644\u0645\u0646\u0637\u0642\u0629"
PLAIN_HINT = "is not a plain column name: in the dataset SQL select it AS a name of letters A to Z"


def _mutate(layout, change):
    page = _example(layout)
    change(page)
    return [p for p in shell_sql.spec_problems(page) + shell_sql.layout_problems(page, {d["name"] for d in page["datasets"]})]


@pytest.mark.parametrize("name", [ARABIC, "Order Date", "1st_region", "net-sales"])
@pytest.mark.parametrize("where,change", [
    ("filter category", lambda page, name: page["filters"][1]["columns"].__setitem__("records", name)),
    ("x needs a column", lambda page, name: next(c for c in page["charts"] if c["type"] != "scatter")["x"].__setitem__("column", name)),
    ("sort needs a column", lambda page, name: page["tables"][0].__setitem__("sort", {"column": name, "dir": "desc"})),
    ("needs a label column", lambda page, name: page["records"].__setitem__("label", name)),
    ("tier must be a column name", lambda page, name: page["records"].__setitem__("tier", name)),
])
def test_an_odd_column_name_is_named_with_how_to_make_it_plain(where, change, name):
    problems = _mutate("forecast_cockpit", lambda page: change(page, name))
    hit = [p for p in problems if where in p and repr(name) in p]
    assert hit and all(PLAIN_HINT in p for p in hit), problems


def test_a_missing_column_keeps_its_short_text_and_a_plain_one_passes():
    missing = _mutate("forecast_cockpit", lambda page: page["records"].pop("label"))
    assert "the records list needs a label column" in missing
    assert not [p for p in missing if PLAIN_HINT in p]
    assert not [p for p in _mutate("forecast_cockpit", lambda page: None) if PLAIN_HINT in p]
    assert shell_sql.column_problem("order_date", "x") == []
    assert shell_sql.column_problem(None, "x") == shell_sql.column_problem(" ", "x") == shell_sql.column_problem(7, "x") == ["x"]


class _Frame:
    def __init__(self, names):
        self.schema = types.SimpleNamespace(fields=[types.SimpleNamespace(name=n, dataType=types.SimpleNamespace(typeName=lambda: "string"))
                                                    for n in names])
        self.write = None


class _NoSpark:
    def sql(self, *_):
        raise AssertionError("a refused frame runs no SQL")


@pytest.mark.parametrize("names,odd", [
    (["entity_id", ARABIC, "rank"], [ARABIC]),
    (["entity_id", "Order Date", "net-sales"], ["Order Date", "net-sales"]),
])
def test_the_writers_refuse_a_frame_whose_columns_the_app_cannot_name(agent_ns, names, odd):
    for call in (lambda: agent_ns["inspire_write_result"](_Frame(names), "main.sales.churn_out", spark_session=_NoSpark()),
                 lambda: agent_ns["inspire_write_companion"](_Frame(names), "main.sales.churn_out", "__cases", ["entity_id"],
                                                             spark_session=_NoSpark())):
        with pytest.raises(ValueError) as refused:
            call()
        text = str(refused.value)
        assert all(repr(n) in text for n in odd) and "Select each one with AS" in text
        assert f"{len(odd)} column" in text


def test_the_writers_accept_plain_columns_and_the_builder_is_told_the_rule(agent_ns):
    agent_ns["inspire_require_plain_columns"](_Frame(["entity_id", "Region_2", "_score"]), "the result frame")
    assert "inspire_write_result refuses any other" in agent_ns["GENIE_RESULT_HISTORY_RULE"]
    assert agent_ns["inspire_shell_facts"].IDENT.pattern == shell_sql.IDENT.pattern


@pytest.mark.parametrize("layout", sorted(EXAMPLES))
@pytest.mark.parametrize("key", shell_sql.PAGE_OBJECT_LISTS)
@pytest.mark.parametrize("bad", [None, "chart", 3, []])
def test_an_entry_that_is_not_an_object_is_named_and_never_crashes_the_check(layout, key, bad):
    page = _example(layout)
    page[key] = (page.get(key) or [])[:1] + [bad]
    entry = str(len(page[key]))
    assert shell_sql.spec_problems(page) == [f"the page {key} must each be a JSON object, and entry {entry} is not"]


@pytest.mark.parametrize("key", shell_sql.PAGE_OBJECT_LISTS)
def test_a_section_that_is_one_object_instead_of_a_list_is_named(key):
    page = _example("forecast_cockpit")
    page[key] = {"id": "one"}
    assert shell_sql.spec_problems(page) == [f"the page {key} must be a list of JSON objects"]


def test_every_example_has_the_shape_the_check_wants():
    assert all(shell_sql.shape_problems(_example(layout)) == [] for layout in EXAMPLES)
    assert shell_sql.shape_problems([]) == ["the page spec is not a JSON object"]


def _check_files(agent_ns, tmp_path, layout, rules=None):
    files = agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))["files"]
    work = tmp_path / "work"
    agent_ns["implement_write_files"](str(work), agent_ns["implement_app_check_files"](files, False, ["trend"], ["main.sales.orders"],
                                                                                       layout, True, rules))
    return work


def _run_check(work, tmp_path, page):
    (work / "page.json").write_text(json.dumps(page))
    return subprocess.run([sys.executable, str(work / ".inspire_check" / "check_page.py")], cwd=str(tmp_path), capture_output=True,
                          text=True, timeout=60)


def _decides():
    return next(layout for layout in sorted(EXAMPLES) if shell_sql.layout_decides(layout))


@pytest.mark.parametrize("case,outputs,name,said", [
    ("fewer_charts", {}, "app", "fewer_charts quotes 'show only two charts', but the customer gave no asks for this App"),
    ("fewer_charts_asked", {"app_vibes": "please show only two charts"}, "app", ""),
    ("fewer_rows", {}, "app", "fewer_rows quotes 'just five rows', but the customer gave no asks for this App"),
    ("filter", {"dashboard_filters": ["loyalty_region"]}, "dashboard",
     "the user asked the dashboard to filter on loyalty_region, which no filter of the page covers: add a filter on it"),
    ("html", {}, "dashboard", "block note_html is html, which a dashboard text widget cannot draw"),
    ("html_on_app", {}, "app", ""),
    ("decision", {}, "app", "the page has no dataset named records: it is the decision list"),
])
def test_the_check_genie_runs_holds_the_page_rules_inspire_holds(agent_ns, tmp_path, case, outputs, name, said):
    layout = _decides() if case == "decision" else "forecast_cockpit"
    page = _example(layout)
    if case.startswith("fewer_charts"):
        page["fewer_charts"] = "show only two charts"
    if case == "fewer_rows":
        page["fewer_rows"] = "just five rows"
    if case.startswith("html"):
        page["blocks"] = (page.get("blocks") or []) + [{"id": "note_html", "kind": "html", "content": "<b>Note</b>", "place": {"where": "top"}}]
    if case == "decision":
        page["datasets"] = [d for d in page["datasets"] if d.get("name") != shell_sql.RECORDS_DATASET]
    label = "Dashboard" if name == "dashboard" else "App"
    rules = agent_ns["implement_page_rules"](outputs, name, label, dashboard=name == "dashboard")
    done = _run_check(_check_files(agent_ns, tmp_path, layout, rules), tmp_path, page)
    assert "Traceback" not in done.stderr, done.stderr
    if said:
        assert done.returncode == 1 and said in done.stdout, done.stdout
    else:
        assert done.returncode == 0 and done.stdout.strip() == "no problems", done.stdout


def test_inspire_and_the_check_genie_runs_call_one_set_of_page_rules(agent_ns, tmp_path):
    files = agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))["files"]
    script = agent_ns["implement_app_check_files"](files, False)[".inspire_check/check_page.py"]
    assert "shell_sql.rule_problems(page, rules)" in script and "shell_sql.decision_problems(page)" in script
    from _agentload import agent_source
    assert "shell_sql.rule_problems(page, implement_page_rules(" in agent_source()
    for gone in ("implement_fewer_problems", "implement_page_request_problems", "implement_dashboard_html_problems",
                 "implement_page_decision_problems", "implement_chart_kind_problems"):
        assert gone not in agent_ns, gone


def test_the_page_rules_carry_the_users_asks_and_filters(agent_ns):
    rules = agent_ns["implement_page_rules"]({"dashboard_filters": ["Region", 7]}, "dashboard", "Dashboard", ["trend"],
                                             {"trend": "no dates"}, True)
    assert rules == {"vibes": "", "label": "Dashboard", "kinds": ["trend"], "not_drawn": {"trend": "no dates"},
                     "requested": ["Region", "7"], "dashboard": True}
    assert agent_ns["implement_page_rules"](None, "app", "App")["requested"] == []


@pytest.mark.parametrize("page,said", [
    ({"charts": [None]}, "must each be a JSON object, and entry"),
    ([], "the page spec is not a JSON object"),
])
def test_the_check_genie_runs_names_a_bad_shape_without_a_traceback(agent_ns, tmp_path, page, said):
    work = _check_files(agent_ns, tmp_path, "forecast_cockpit")
    if isinstance(page, dict):
        page = dict(_example("forecast_cockpit"), **{k: (_example("forecast_cockpit").get(k) or []) + v for k, v in page.items()})
    (work / "page.json").write_text(json.dumps(page))
    done = subprocess.run([sys.executable, str(work / ".inspire_check" / "check_page.py")], cwd=str(tmp_path), capture_output=True,
                          text=True, timeout=60)
    assert done.returncode == 1 and said in done.stdout and "Traceback" not in done.stderr, (done.stdout, done.stderr)


def test_inspire_names_a_bad_page_shape_before_reading_it(agent_ns, tmp_path):
    page = _example("forecast_cockpit")
    page["charts"] = page["charts"] + [None]
    (tmp_path / "page.json").write_text(json.dumps(page))
    context = {"spec": {"outputs": {}}, "uc_id": "N01-U01", "use_case": "Forecast demand", "result_table": "main.sales.out"}
    with pytest.raises(RuntimeError) as refused:
        agent_ns["DatabricksInspire"]._implement_page_file(None, context, "app", str(tmp_path), shell_sql, False)
    assert str(refused.value).endswith(f"the page charts must each be a JSON object, and entry {len(page['charts'])} is not")


TABLES = {"tables": [{"identifier": "main.sales.out"}]}


@pytest.mark.parametrize("definition,said", [
    ([], "genie_space.json is not a JSON object"),
    ("space", "genie_space.json is not a JSON object"),
    ({"title": "T", "serialized_space": "[]"}, "the serialized_space of genie_space.json is not a JSON object"),
    ({"title": "T", "config": [], "data_sources": TABLES}, "genie_space.json config must be a JSON object"),
    ({"title": "T", "instructions": [], "data_sources": TABLES}, "genie_space.json instructions must be a JSON object"),
    ({"title": "T", "data_sources": []}, "genie_space.json data_sources must be a JSON object"),
    ({"title": "T", "benchmarks": [], "data_sources": TABLES}, "genie_space.json benchmarks must be a JSON object"),
    ({"title": "T", "instructions": {"sql_snippets": []}, "data_sources": TABLES},
     "genie_space.json instructions sql_snippets must be a JSON object"),
    ({"title": "T", "serialized_space": {"config": "q", "data_sources": TABLES}},
     "the serialized_space of genie_space.json config must be a JSON object"),
])
def test_a_genie_space_of_the_wrong_shape_is_named_and_never_crashes(agent_ns, definition, said):
    _title, _description, space, errors = agent_ns["normalize_genie_space"](json.dumps(definition), ["main.sales.out"])
    assert errors == [said] and space == {}


def test_a_genie_space_of_the_right_shape_still_passes(agent_ns):
    good = {"title": "T", "serialized_space": {"config": {"sample_questions": [{"question": ["Which stores to restock?"]}]},
                                                "instructions": {"sql_snippets": {"filters": []}}, "data_sources": TABLES}}
    assert agent_ns["normalize_genie_space"](json.dumps(good), ["main.sales.out"])[3] == []


@pytest.mark.parametrize("definition,said", [
    ([], "dashboard.lvdash.json is not a JSON object"),
    ({"datasets": [None]}, "dashboard.lvdash.json datasets must each be a JSON object, and entry 1 is not"),
    ({"datasets": {"a": 1}}, "dashboard.lvdash.json datasets must be a list of JSON objects"),
    ({"datasets": [], "pages": [{}, None]}, "dashboard.lvdash.json pages must each be a JSON object, and entry 2 is not"),
    ({"datasets": [], "pages": [{"layout": [{}, None, 3]}]}, "dashboard page 1 layout must each be a JSON object, and entries 2, 3 are not"),
])
def test_a_dashboard_of_the_wrong_shape_is_named_and_never_crashes(agent_ns, definition, said):
    assert agent_ns["check_dashboard_definition"](json.dumps(definition), ["main.sales.out"]) == ({}, [said])


def test_a_genie_table_with_no_identifier_says_so(agent_ns):
    space = {"title": "T", "config": {"sample_questions": [{"question": ["q"]}]}, "data_sources": {"tables": [{"identifier": None}]}}
    assert agent_ns["normalize_genie_space"](json.dumps(space), ["main.sales.out"])[3] == [
        "a table of the Genie Agent has no identifier: name it as catalog.schema.name"]


def _unnamed_dashboard():
    chart = {"spec": {"widgetType": "bar", "version": 3, "encodings": {}}}
    return {"datasets": [{"name": "records", "queryLines": ["SELECT 1"]}],
            "pages": [{"name": "p1", "displayName": "Desk", "layout": [{"widget": dict(chart), "position": {"x": 0, "y": 0, "width": 13,
                                                                                                          "height": 2}},
                                                                     {"widget": dict(chart), "position": {"x": 0, "y": 2, "width": 12,
                                                                                                          "height": 2}}]},
                      {"layout": [{"widget": {"name": "w9", "spec": {"widgetType": "bar", "version": 3}}}]}]}


def test_a_dashboard_widget_or_page_with_no_name_is_named_by_where_it_sits(agent_ns):
    doc = _unnamed_dashboard()
    found = (agent_ns["implement_dashboard_problems"](doc) + agent_ns["implement_dashboard_template_problems"](doc)
             + agent_ns["implement_dashboard_layout_problems"](doc) + agent_ns["implement_dashboard_page_problems"](doc))
    text = "\n".join(found)
    assert "None" not in text and "widgets  " not in text and "share the name ," not in text, found
    assert "2 widgets of the dashboard have no name: give every widget a name of its own" in found
    assert "1 page of the dashboard has no name: give every page a name of its own" in found
    assert ("page Desk widget with no name at column 0, row 0; page Desk widget with no name at column 0, row 2; a page with no name "
            "widget w9 name no dataset: every tile that is not text reads a dataset of the dashboard") in found, found
    assert "page Desk widget with no name at column 0, row 0 has no place on the 12-column grid" in found
    assert "page Desk widget with no name at column 0, row 2 lacks the x channel a bar needs" in found
    assert "a page with no name has no displayName: give every page the title its tab shows" in found
    assert not any("share the name" in f for f in found), found


def test_a_dashboard_spot_names_the_page_and_widget(agent_ns):
    spot = agent_ns["implement_dashboard_spot"]
    assert spot({"displayName": " Loss   desk ", "name": "p1"}, {"name": "chart_0"}) == "page Loss desk widget chart_0"
    assert spot({"name": "p1"}, {"name": "kpi_1"}, "counter") == "page p1 counter kpi_1"
    assert spot({}, {}) == "a page with no name widget with no name"
    assert spot({"name": "p1"}, {}, "tile", {"position": {"x": 6, "y": 4}}) == "page p1 tile with no name at column 6, row 4"
    assert spot({"name": "p1"}, {}, item={"position": {"x": 6}}) == "page p1 widget with no name"
    assert spot(None) == "a page with no name"


@pytest.mark.parametrize("who,quoted", [
    ("data`team", "`data``team`"),
    ("ana@example.com", "`ana@example.com`"),
    ("6f1c2a9e-0000-4000-8000-1234567890ab", "`6f1c2a9e-0000-4000-8000-1234567890ab`"),
])
def test_a_grant_to_any_principal_is_planned_and_quoted(agent_ns, who, quoted):
    plan = agent_ns["implement_access_plan"]("main.sales.orders", None, who)
    assert plan["grants"], plan
    statements = [agent_ns["implement_grant_sql"](need, who) for need in plan["grants"]]
    assert all(s.endswith(f" TO {quoted}") for s in statements), statements
    assert agent_ns["implement_revoke_sql"](plan["grants"][0], who).endswith(f" FROM {quoted}")
    assert agent_ns["inspire_quote_principal"](f" {who} ") == quoted


def test_no_grant_or_revoke_puts_a_principal_between_bare_backticks():
    from _agentload import agent_source
    source = agent_source()
    assert not re.findall(r"(?:TO|FROM) `\{[a-z_]+\}`", source), re.findall(r"(?:TO|FROM) `\{[a-z_]+\}`", source)
