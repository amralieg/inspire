import hashlib
import json
import os

import pytest

from v120_artifacts_support import FakeSpark, make_inspire
from v120_genie_support import build_inspire, make_uc
from v140_implement_test import ALERT, _FileRunner, _alert_inspire, _calls_to, _inspire, _output_context
from v142_dash_test import RESULT, _canvas, _page, _palettes, _shell
from v142_genie_test import _definition, _deploy_inspire, _posted_space
from v197_genie_question_rows_test import _DirRunner, _answers, _build, _space, REASONS, REASONS_SQL

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIXTURE = os.path.join(ROOT, "tests", "fixtures", "implement_vibe_audit_round10.json")
KINDS = os.path.join(ROOT, "agent", "app_shell", "kinds.json")
TEXT = ("_id", "label", "lever", "driver", "segment", "name", "tier", "reason", "from", "to", "group", "lane", "kind", "status",
        "code", "entity", "member", "action", "item", "scenario", "flag", "dimension", "source", "target", "stage", "peer", "step")
DATES = ("period", "date", "as_of", "start", "end", "week", "ts", "time")
QUEUE_DASHBOARD_SHA = "2a8274feb37e528ecdaec89a10f4ded3723e63f955b948ada79657fedaa6aa28"
QUEUE_ABOUT_DASHBOARD_SHA = "2b04126ed53861b20898e2d813271989aea2ff080834d339f5ab3af02bd7bce0"
QUEUE_ALERT_SHA = "8262a3ba5d680bb374ee662b08b718eb405ea702b45e3c6b5ddf99f75ceb54fd"
QUEUE_GENIE_SHA = "e7f6dc6c4e423941bf068c51de2d22d9ab8c2af11af8ccd6a8f22a0616512909"
QUEUE_USE_CASE = {"Name": "Predict churn", "Statement": "Customers leave", "use_case_kind": "risk_propensity",
                  "Analytics Technique": "Classification"}
LAYOUT_KINDS = sorted({(k.get("decision_layout") or k["layout"]): k["id"] for k in json.load(open(KINDS, encoding="utf-8"))["kinds"]
                       if k["contract"] not in (None, "decision_queue")}.values())


def _type(column):
    name = column.lower()
    if name.endswith(TEXT) or name in TEXT or name.startswith(("segment", "entity", "reason", "lever", "driver")):
        return "string"
    if any(part in name.split("_") for part in DATES) or name.endswith("_at"):
        return "date"
    return "double"


def _registry(ns):
    return ns["_inspire_kinds"]()


def _kinds(ns):
    return [k for k in _registry(ns)["kinds"] if k["contract"] not in (None, "decision_queue")]


def _schemas(ns, kind, result=RESULT, drop=()):
    suffixes = _registry(ns)["contracts"][kind["contract"]]["suffixes"]
    return {f"{result}{suffix}": [(c, _type(c)) for c in columns] for suffix, columns in suffixes.items() if suffix not in drop}


def _spec(ns, kind_id, result=RESULT, drop=(), **use_case):
    kind = ns["_inspire_kind"](kind_id)
    schemas = _schemas(ns, kind, result, drop)
    return ns["implement_kind_spec"](dict({"use_case_kind": kind_id}, **use_case), result, lambda table: schemas.get(table))


def _sha(value):
    return hashlib.sha256(json.dumps(value, sort_keys=True).encode()).hexdigest()


def _kind_context(ns, spec, **outputs):
    context = _output_context(ns, **outputs)
    context.update(kind_spec=spec, allowed=context["allowed"] + [info["table"] for info in spec["tables"].values()])
    return context


def _allowed(spec):
    return [RESULT, "main.s.orders"] + [info["table"] for info in spec["tables"].values()]


def _theme(ns):
    return ns["implement_dashboard_theme"](_palettes())


def _doc(ns, tmp_path, spec, **extra):
    return ns["implement_dashboard_from_page"](_page(ns), _shell(ns, tmp_path), RESULT, {}, theme=_theme(ns), kind_spec=spec, **extra)


def _kind_page(doc, spec):
    return next(p for p in _canvas(doc) if p["name"] == spec["layout"])


def test_the_kind_and_layout_come_from_the_use_case_then_the_technique(agent_ns):
    pick = agent_ns["implement_kind_layout"]
    assert pick({"use_case_kind": "forecast"})[0]["id"] == "forecast"
    assert pick({"use_case_kind": "forecast"})[1] == "forecast_cockpit"
    assert pick({"use_case_kind": "forecast", "app_layout": "planner"})[1] == "planner"
    assert pick({"use_case_kind": "forecast", "app_layout": "no_such_layout"})[1] == "forecast_cockpit"
    by_technique = pick({"Analytics Technique": next(iter(_registry(agent_ns)["technique_kind"]))})
    assert by_technique[0] is not None and by_technique[1] == by_technique[0]["layout"]
    assert pick({"Name": "No technique"}) == (None, "")
    assert agent_ns["implement_kind_tags"]({"Name": "No technique"}) == {}
    assert agent_ns["implement_kind_tags"]({"use_case_kind": "anomaly"}) == {"dbx_inspire_ai_kind": "anomaly",
                                                                             "dbx_inspire_ai_layout": "monitor_triage"}


def test_a_decision_queue_kind_or_no_kind_builds_no_kind_spec_and_reads_no_table(agent_ns):
    read = lambda table: pytest.fail(f"read {table}")
    for kind in _registry(agent_ns)["kinds"]:
        if kind["contract"] in (None, "decision_queue"):
            assert agent_ns["implement_kind_spec"]({"use_case_kind": kind["id"]}, RESULT, read) is None
    assert agent_ns["implement_kind_spec"]({"Name": "x"}, RESULT, read) is None
    assert agent_ns["implement_kind_spec"]({"use_case_kind": "forecast"}, "", read) is None


def test_a_companion_table_that_is_missing_or_lacks_a_contract_column_is_left_out(agent_ns):
    kind = agent_ns["_inspire_kind"]("driver_scenarios")
    schemas = _schemas(agent_ns, kind)
    schemas[f"{RESULT}__sensitivity"] = schemas[f"{RESULT}__sensitivity"][1:]
    del schemas[f"{RESULT}__scenarios"]

    def read(table):
        if table.endswith("__scenario_model"):
            raise RuntimeError("PERMISSION_DENIED")
        return schemas.get(table)

    spec = agent_ns["implement_kind_spec"]({"use_case_kind": "driver_scenarios"}, RESULT, agent_ns["implement_schema_once"](read))
    assert spec["tables"] == {} and spec["layout"] == "scenario_lab"
    assert spec["missing"][f"{RESULT}__scenarios"] == "does not exist"
    assert spec["missing"][f"{RESULT}__sensitivity"] == "has no column lever"
    assert spec["missing"][f"{RESULT}__scenario_model"].startswith("cannot be read: ")
    whole = _spec(agent_ns, "driver_scenarios")
    assert set(whole["tables"]) == {"__scenarios", "__sensitivity", "__scenario_model"} and whole["missing"] == {}
    assert whole["tables"]["__sensitivity"]["columns"] == {"lever": "string", "low": "double", "high": "double", "delta": "double"}


def test_every_widget_binding_names_only_contract_columns_and_every_recipe_widget_has_one(agent_ns):
    registry = _registry(agent_ns)
    contracts = {s: cols for c in registry["contracts"].values() for s, cols in c["suffixes"].items()}
    contracts["decision"] = [name for name, _data_type in agent_ns["INSPIRE_CORE_COLUMNS"]]
    columns_of = agent_ns["implement_kind_columns"]

    def named(binding):
        names = [binding[k] for k in ("x", "series", "group", "lat", "lon") if isinstance(binding.get(k), str)]
        names += list(binding.get("columns") or []) + ([binding["order"][0]] if binding.get("order") else [])
        expressions = [y[0] for y in binding.get("y") or []] + ([binding["x"][0]] if isinstance(binding.get("x"), list) else [])
        return names + [c for e in expressions for c in columns_of(e)]

    for source, widgets in registry["widget_fields"].items():
        known = set(contracts[source]) | set(widgets.get("derived") or {})
        for widget, binding in widgets.items():
            if widget == "derived":
                for sql in binding.values():
                    assert set(columns_of(sql)) - {"STRING"} <= set(contracts[source]), (source, sql)
                continue
            assert set(named(binding)) <= known, (source, widget, set(named(binding)) - known)
    missing = [(k["id"], w["source"], w["widget"]) for k in _kinds(agent_ns) for w in k["dashboard"]["widgets"]
               if not ({w["widget"], w["title"]} & set(registry["widget_fields"].get(w["source"], {})))]
    assert missing == []


def test_the_column_check_rejects_a_name_outside_the_contract_and_keeps_one_inside(agent_ns):
    columns_of = agent_ns["implement_kind_columns"]
    assert columns_of("sum(on_hand)") == ["on_hand"]
    assert columns_of("count_if(priority_tier = 'Act now')") == ["priority_tier"]
    assert columns_of("avg(CASE WHEN delta > 0 THEN 1 ELSE 0 END)") == ["delta"]


@pytest.mark.parametrize("kind_id", LAYOUT_KINDS)
def test_each_layout_adds_a_dashboard_page_that_passes_every_dashboard_check(agent_ns, tmp_path, kind_id):
    spec = _spec(agent_ns, kind_id)
    doc = _doc(agent_ns, tmp_path, spec)
    shell_sql = _shell(agent_ns, tmp_path)
    assert agent_ns["check_dashboard_definition"](doc, _allowed(spec), shell_sql.RECORDS_DATASET)[1] == []
    page = _kind_page(doc, spec)
    canvas = _canvas(doc)
    assert canvas[0]["name"] != spec["layout"] and canvas[1] is page, "the decision list stays the first page"
    header = "".join(page["layout"][0]["widget"]["multilineTextboxSpec"]["lines"])
    assert header.startswith(f"## {spec['label']}") and "How to read:" in header
    widgets = [item["widget"] for item in page["layout"][1:]]
    assert widgets and all(w["spec"]["widgetType"] in ("counter", "table", "bar", "line", "scatter", "heatmap", "symbol-map")
                           for w in widgets)
    kind_sets = [d for d in doc["datasets"] if d["name"].startswith("kind__")]
    sources = dict(spec["tables"], decision={"table": RESULT, "columns": dict(agent_ns["INSPIRE_CORE_COLUMNS"])})
    tables = {info["table"]: info for info in sources.values()}
    for dataset in kind_sets:
        sql = "".join(dataset["queryLines"])
        read = [t for t in tables if f"FROM {agent_ns['inspire_table_name'](t)}\n" in sql + "\n"]
        assert len(read) == 1, sql
        suffix = next(s for s, info in sources.items() if info["table"] == read[0])
        derived = set((_registry(agent_ns)["widget_fields"][suffix].get("derived") or {}))
        selected = sql.split("\nFROM ")[0][len("SELECT "):]
        for column in agent_ns["implement_kind_columns"](selected):
            assert column in tables[read[0]]["columns"] or column in derived or column == "STRING", (kind_id, column)
    used = {q["query"]["datasetName"] for w in widgets for q in w.get("queries") or []}
    assert used <= {d["name"] for d in kind_sets}


def test_every_non_queue_kind_gets_a_valid_dashboard(agent_ns, tmp_path):
    shell_sql = _shell(agent_ns, tmp_path)
    for kind in _kinds(agent_ns):
        spec = _spec(agent_ns, kind["id"])
        doc = agent_ns["implement_dashboard_from_page"](_page(agent_ns), shell_sql, RESULT, {}, theme=_theme(agent_ns), kind_spec=spec)
        assert agent_ns["check_dashboard_definition"](doc, _allowed(spec), shell_sql.RECORDS_DATASET)[1] == [], kind["id"]
        assert len(_kind_page(doc, spec)["layout"]) >= 2, kind["id"]


def test_an_informational_kind_gets_a_full_read_only_dashboard(agent_ns, tmp_path):
    for kind_id in ("driver_breakdown", "leading_indicators", "journey_path", "location_intelligence", "reason_codes"):
        kind = agent_ns["_inspire_kind"](kind_id)
        assert kind["informational"] is True
        spec = _spec(agent_ns, kind_id)
        page = _kind_page(_doc(agent_ns, tmp_path, spec), spec)
        assert len(page["layout"]) - 1 >= min(len(kind["dashboard"]["widgets"]), 3), kind_id
        assert not any(q["query"].get("datasetName") == "records" for item in page["layout"][1:]
                       for q in item["widget"].get("queries") or [])


def test_the_reason_codes_page_reads_the_current_rows_and_its_trend_reads_every_run(agent_ns, tmp_path):
    spec = _spec(agent_ns, "reason_codes")
    doc = _doc(agent_ns, tmp_path, spec)
    sql = {d["name"]: "".join(d["queryLines"]) for d in doc["datasets"] if d["name"].startswith("kind__decision")}
    current = agent_ns["INSPIRE_CURRENT_ROWS"]
    assert sql["kind__decision"].endswith(f"WHERE {current}") and current not in sql["kind__decision_all"]
    assert "coalesce(element_at(`top_reasons`, 1), 'No reason given') AS `top_reason`" in sql["kind__decision"]
    assert "`top_reasons`," not in sql["kind__decision"].split(" AS ")[0], "no raw array column in a dashboard dataset"


def test_a_location_kind_draws_its_points_on_a_symbol_map(agent_ns, tmp_path):
    spec = _spec(agent_ns, "site_territory")
    maps = [item["widget"] for item in _kind_page(_doc(agent_ns, tmp_path, spec), spec)["layout"]
            if (item["widget"].get("spec") or {}).get("widgetType") == "symbol-map"]
    assert maps, "the location layout shows a map"
    encodings = maps[0]["spec"]["encodings"]
    fields = {f["name"] for f in maps[0]["queries"][0]["query"]["fields"]}
    assert {encodings["coordinates"]["latitude"]["fieldName"], encodings["coordinates"]["longitude"]["fieldName"]} <= fields
    assert encodings["size"]["fieldName"] in fields and maps[0]["spec"]["version"] == 2


def test_a_missing_companion_table_drops_only_its_widgets(agent_ns, tmp_path):
    full, partial = _spec(agent_ns, "driver_scenarios"), _spec(agent_ns, "driver_scenarios", drop=("__sensitivity",))
    shown = lambda spec: len(_kind_page(_doc(agent_ns, tmp_path, spec), spec)["layout"])
    assert 1 < shown(partial) < shown(full)
    none = _spec(agent_ns, "forecast", drop=tuple(_registry(agent_ns)["contracts"]["forecast"]["suffixes"]))
    assert none["tables"] == {}
    assert [p["name"] for p in _canvas(_doc(agent_ns, tmp_path, none))] == [p["name"] for p in _canvas(_doc(agent_ns, tmp_path, None))]


def test_kind_widgets_use_the_same_spec_versions_and_shapes_as_published_dashboards(agent_ns, tmp_path):
    published = [case["published"] for case in json.load(open(FIXTURE, encoding="utf-8")).values()
                 if isinstance(case.get("published"), dict)]
    assert published
    versions, keys = {}, {}
    pages = [page for doc in published for page in doc["pages"]] + _canvas(_doc(agent_ns, tmp_path, None))
    for page in pages:
        assert {"name", "displayName", "layout"} <= set(page)
        for item in page["layout"]:
            assert set(item) == {"widget", "position"} and set(item["position"]) == {"x", "y", "width", "height"}
            spec = item["widget"].get("spec")
            if spec:
                versions.setdefault(spec["widgetType"], set()).add(spec["version"])
                keys.setdefault(spec["widgetType"], set()).update(spec)
    assert agent_ns["IMPLEMENT_DASHBOARD_WIDGETS"]["symbol-map"][0] == 2
    for kind in _kinds(agent_ns):
        spec = _spec(agent_ns, kind["id"])
        doc = _doc(agent_ns, tmp_path, spec)
        assert set(doc) == set(published[0]), "same top-level schema"
        page = _kind_page(doc, spec)
        assert {"name", "displayName", "layout", "pageType"} <= set(page)
        for item in page["layout"]:
            assert set(item) == {"widget", "position"} and set(item["position"]) == {"x", "y", "width", "height"}
            widget = item["widget"].get("spec")
            if widget and widget["widgetType"] in versions:
                assert widget["version"] in versions[widget["widgetType"]], (kind["id"], widget["widgetType"])
                assert set(widget) <= keys[widget["widgetType"]], (kind["id"], widget["widgetType"])
            if widget:
                assert widget["version"] == agent_ns["IMPLEMENT_DASHBOARD_WIDGETS"][widget["widgetType"]][0]


def test_a_decision_queue_dashboard_is_unchanged_byte_for_byte(agent_ns, tmp_path):
    shell_sql = _shell(agent_ns, tmp_path)
    plain = agent_ns["implement_dashboard_from_page"](_page(agent_ns), shell_sql, RESULT, {}, theme=_theme(agent_ns))
    queue = agent_ns["implement_dashboard_from_page"](_page(agent_ns), shell_sql, RESULT, {}, theme=_theme(agent_ns), kind_spec=None)
    assert _sha(plain) == _sha(queue) == QUEUE_DASHBOARD_SHA
    about = agent_ns["inspire_kind_about"](QUEUE_USE_CASE)
    spec = agent_ns["implement_kind_spec"](QUEUE_USE_CASE, RESULT, lambda table: pytest.fail(table))
    told = agent_ns["implement_dashboard_from_page"](_page(agent_ns), shell_sql, RESULT, {}, theme=_theme(agent_ns), about=about,
                                                     kind_spec=spec)
    assert len(about) == 3 and spec is None and _sha(told) == QUEUE_ABOUT_DASHBOARD_SHA


def test_every_kind_measure_binds_to_contract_columns_and_none_is_dropped(agent_ns):
    aliases_of = agent_ns["implement_genie_aliases"]
    for kind in _kinds(agent_ns):
        spec = _spec(agent_ns, kind["id"])
        kept, dropped = agent_ns["implement_kind_measures"](spec, aliases_of(_allowed(spec)))
        assert dropped == [] and len(kept) == len(set(kind["genie"]["measures"])), kind["id"]
        for measure, expression in zip(kept, dict.fromkeys(kind["genie"]["measures"])):
            sql = measure["sql"][0]
            columns = agent_ns["implement_kind_columns"](expression)
            assert all(f"`.`{c}`" in sql for c in columns) and measure["display_name"].startswith(kind["label"]), (kind["id"], sql)


def test_a_measure_naming_a_column_outside_every_table_is_dropped_and_a_core_column_binds(agent_ns):
    spec = _spec(agent_ns, "forecast")
    spec["kind"] = dict(spec["kind"], genie=dict(spec["kind"]["genie"], measures=["sum(on_hand)", "sum(value)", "avg(backtest_mase)"]))
    aliases = agent_ns["implement_genie_aliases"](_allowed(spec))
    kept, dropped = agent_ns["implement_kind_measures"](spec, aliases)
    assert dropped == ["sum(on_hand)"]
    plain = agent_ns["_implement_plain_table"]
    assert kept[0]["sql"] == [f"sum(`{aliases[plain(RESULT).lower()]}`.`value`)"]
    assert kept[1]["sql"] == [f"avg(`{aliases[plain(RESULT + '__series').lower()]}`.`backtest_mase`)"]


def test_the_genie_space_gets_the_companion_tables_and_measures_and_keeps_its_own(agent_ns):
    spec = _spec(agent_ns, "forecast")
    space = {"data_sources": {"tables": [{"identifier": RESULT}]},
             "instructions": {"sql_snippets": {"measures": [{"alias": "own", "sql": ["count(*)"]}]}}}
    data, added, bound, dropped = agent_ns["implement_genie_kind_space"]({"serialized_space": json.dumps(space)}, spec, [RESULT])
    tables = [t["identifier"] for t in data["serialized_space"]["data_sources"]["tables"]]
    assert tables[0] == RESULT and set(tables[1:]) == {info["table"] for info in spec["tables"].values()} == set(added)
    measures = data["serialized_space"]["instructions"]["sql_snippets"]["measures"]
    assert measures[0] == {"alias": "own", "sql": ["count(*)"]} and [m["alias"] for m in measures[1:]] == bound and dropped == []
    again = agent_ns["implement_genie_kind_space"](data, spec, [RESULT] + added)
    assert again[1] == [] and again[2] == [], "a second pass adds nothing"


def test_the_genie_prompt_carries_the_kind_questions_only_for_a_kind(agent_ns):
    brief = agent_ns["implement_kind_genie_brief"]
    empty = _spec(agent_ns, "forecast", drop=tuple(_registry(agent_ns)["contracts"]["forecast"]["suffixes"]))
    assert brief(None) == "" and brief(empty) == ""
    text = brief(_spec(agent_ns, "forecast"))
    kind = agent_ns["_inspire_kind"]("forecast")
    assert all(q in text for q in kind["genie"]["questions"]) and f"{RESULT}__series" in text
    assert "the sample questions the user did not word" in text


def test_companion_tables_need_no_join_spec_but_an_input_table_still_does(agent_ns):
    grounding = agent_ns["implement_genie_space_grounding"]
    series = f"{RESULT}__series"
    columns = {RESULT.lower(): [(c, t, "") for c, t in agent_ns["INSPIRE_CORE_COLUMNS"]],
               series.lower(): [(c, _type(c), "") for c in _registry(agent_ns)["contracts"]["forecast"]["suffixes"]["__series"]],
               "main.s.orders": [("order_id", "string", "")]}

    def joins(*identifiers):
        space = {"data_sources": {"tables": [{"identifier": t} for t in identifiers]}, "instructions": {}}
        return [p for p in grounding(space, columns, RESULT, [RESULT, series, "main.s.orders"]) if "joins no other table" in p
                or "join no other table" in p]

    assert joins(RESULT, series) == []
    assert any("main.s.orders" in p for p in joins(RESULT, series, "main.s.orders"))


def _genie_build(ns, tmp_path, context):
    inst, calls, ran = _deploy_inspire(ns, tmp_path)
    plain = inst._implement_space_columns
    spec = context.get("kind_spec") or {"tables": {}}
    extra = {info["table"].lower(): [(c, t, "") for c, t in info["columns"].items()] for info in spec["tables"].values()}
    inst._implement_space_columns = lambda tables: {k: extra.get(k) or v for k, v in plain(tables).items()}
    _answers(inst, ran)
    runner = _DirRunner([{"exit": 0}], [{"genie_space.json": _definition(_space((REASONS, REASONS_SQL)))}])
    return inst, calls, ran, runner, inst._implement_genie_space(context, runner)


def test_a_genie_room_for_a_kind_ships_the_companion_tables_and_bound_measures(agent_ns, tmp_path):
    spec = _spec(agent_ns, "forecast")
    inst, calls, ran, runner, fields = _genie_build(agent_ns, tmp_path, _kind_context(agent_ns, spec))
    assert len(runner.prompts) == 1 and "This is a Forecast use case" in runner.prompts[0]
    posted = _posted_space(calls)
    assert f"{RESULT}__series" in [t["identifier"] for t in posted["data_sources"]["tables"]]
    measures = {m["alias"]: "".join(m["sql"]) for m in posted["instructions"]["sql_snippets"]["measures"]}
    kept, _dropped = agent_ns["implement_kind_measures"](spec, agent_ns["implement_genie_aliases"](_allowed(spec)))
    assert kept and all(measures.get(m["alias"]) == m["sql"][0] for m in kept), (measures, kept)
    assert any(f"SELECT {m['sql'][0]}" in sql for m in kept for sql in ran if "__series" in sql)
    assert any("[KIND-GENIE FIRED] N01-U01: forecast kind, tables added 1, measures bound" in m for _lv, m in inst.logger.records)


def test_a_genie_room_for_a_decision_queue_kind_is_unchanged(agent_ns, tmp_path):
    context = _output_context(agent_ns)
    context["use_case"]["use_case_kind"] = "risk_propensity"
    context["kind_spec"] = agent_ns["implement_kind_spec"](context["use_case"], RESULT, lambda t: pytest.fail(t))
    assert context["kind_spec"] is None
    queue = _build(agent_ns, tmp_path / "g", [_space((REASONS, REASONS_SQL))], context=context)
    assert _sha([_posted_space(queue[1]), queue[3].prompts, queue[4]]) == QUEUE_GENIE_SHA
    assert not any("[KIND-GENIE FIRED]" in m for _lv, m in queue[0].logger.records)


def test_each_kind_alert_reads_only_its_companion_tables(agent_ns):
    for kind in _kinds(agent_ns):
        spec = _spec(agent_ns, kind["id"])
        sql, text = agent_ns["implement_kind_alert"](spec)
        with_sql = [a for a in kind["alerts"] if a.get("sql")]
        if not with_sql:
            assert (sql, text) == ("", ""), kind["id"]
            continue
        assert sql.startswith("SELECT coalesce(") and sql.endswith(" AS triggered") and "{" not in sql, kind["id"]
        assert sql.count("coalesce(") == len(with_sql) and text.count(" or ") >= len(with_sql) - 1, kind["id"]
        read = set(agent_ns["_implement_unknown_tables"]([sql], []))
        assert read and read <= {RESULT} | {info["table"] for info in spec["tables"].values()}, (kind["id"], read)


def test_a_kind_alert_rule_whose_table_is_missing_is_skipped(agent_ns):
    full = agent_ns["implement_kind_alert"](_spec(agent_ns, "allocation"))
    assert full[0]
    gone = agent_ns["implement_kind_alert"](_spec(agent_ns, "allocation", drop=("__constraints",)))
    assert "__constraints" not in gone[0] and gone[0].count("coalesce(") < full[0].count("coalesce(")
    assert agent_ns["implement_kind_alert"](None) == ("", "")


def test_a_kind_alert_ors_its_rule_into_the_tier_alert(agent_ns, tmp_path):
    inst, calls, queries = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": False, "tier_rows": 0}])
    spec = _spec(agent_ns, "forecast")
    rule, text = agent_ns["implement_kind_alert"](spec)
    fields = inst._implement_alert(_kind_context(agent_ns, spec, **ALERT), None)
    assert fields["_asset"]["condition_sql"] == rule and fields["_asset"]["condition_text"] == text
    assert fields["_asset"]["trigger"].endswith(f", or {text}")
    [(alert, _q)] = _calls_to(calls, "POST", "/api/2.0/alerts")
    assert f"user_condition AS (\n{rule}\n)" in alert["query_text"] and text in alert["custom_description"]
    assert any("[KIND-ALERT FIRED] N01-U01: forecast kind adds" in m for _lv, m in inst.logger.records)


def test_a_kind_alert_rule_that_fails_falls_back_to_the_tier_alert(agent_ns, tmp_path):
    inst, calls, queries = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": None, "tier_rows": 0}])
    fields = inst._implement_alert(_kind_context(agent_ns, _spec(agent_ns, "forecast"), **ALERT), None)
    assert fields["_asset"]["condition_sql"] == "" and fields["_asset"]["trigger"] == "Act now rows in the latest run >= 1"
    assert any(lv == "WARNING" and "the kind rule did not run" in m for lv, m in inst.logger.records)


def test_the_users_alert_condition_wins_over_the_kind_rule(agent_ns, tmp_path):
    inst, calls, queries = _alert_inspire(agent_ns, tmp_path, rows=[{"triggered": True}])
    good = "SELECT COUNT(*) > 10 AS triggered FROM main.s.orders WHERE status = 'refund'"
    context = _kind_context(agent_ns, _spec(agent_ns, "forecast"), **ALERT, alert_condition_text="refunds above 10 today")
    fields = inst._implement_alert(context, _FileRunner([{"exit": 0}], [{"alert_condition.sql": good}]))
    assert fields["_asset"]["condition_sql"] == good and fields["_asset"]["condition_text"] == "refunds above 10 today"
    assert not any("__series" in q for q in queries) and not any("[KIND-ALERT FIRED]" in m for _lv, m in inst.logger.records)


def test_a_decision_queue_alert_is_unchanged(agent_ns, tmp_path):
    inst, calls, queries = _alert_inspire(agent_ns, tmp_path)
    context = _output_context(agent_ns, **ALERT)
    context["use_case"].update(use_case_kind="risk_propensity", **{"Analytics Technique": "Classification"})
    context["kind_spec"] = agent_ns["implement_kind_spec"](context["use_case"], RESULT, lambda t: pytest.fail(t))
    fields = inst._implement_alert(context, None)
    assert _sha([fields, _calls_to(calls, "POST", "/api/2.0/alerts"), queries]) == QUEUE_ALERT_SHA
    assert not any("[KIND-ALERT FIRED]" in m for _lv, m in inst.logger.records)


def test_the_kind_tags_rank_below_every_id_so_the_cap_drops_them_first(agent_ns):
    launcher = agent_ns["JobLauncher"]
    order = launcher.TAG_PRIORITY
    kind_tags = ("dbx_inspire_ai_kind", "dbx_inspire_ai_layout")
    assert all(key in order for key in kind_tags)
    ids = [key for key in order if key.endswith(("_id", "_ids"))]
    assert ids and max(order.index(key) for key in ids) < min(order.index(key) for key in kind_tags)
    kept = launcher.merged_tags({"team": "growth"}, {key: "v" for key in order})
    assert len(kept) == 20 and set(ids) <= set(kept) and not set(kind_tags) & set(kept)
    room = launcher.merged_tags({}, dict({key: "v" for key in ids[:5]}, **{key: "v" for key in kind_tags}))
    assert set(kind_tags) <= set(room)


def test_the_use_case_job_tags_carry_the_kind_and_layout(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc()
    kind, layout = agent_ns["implement_kind_layout"](uc)
    tags = inst._genie_notebook_spec(uc)["job_tags"]
    assert kind is not None and (tags["dbx_inspire_ai_kind"], tags["dbx_inspire_ai_layout"]) == (kind["id"], layout)
    named = inst._genie_notebook_spec(make_uc(use_case_kind="forecast", app_layout="planner"))["job_tags"]
    assert (named["dbx_inspire_ai_kind"], named["dbx_inspire_ai_layout"]) == ("forecast", "planner")
    plain = inst._genie_notebook_spec(make_uc(**{"Analytics Technique": "No such technique"}))["job_tags"]
    assert "dbx_inspire_ai_kind" not in plain and "dbx_inspire_ai_layout" not in plain
    launched = make_inspire(agent_ns, spark=FakeSpark(), session_id=5150)._implement_tags(
        inst._genie_notebook_spec(make_uc(use_case_kind="anomaly")), (5150, "N01-U01", 2), "/W/nb")
    assert (launched["dbx_inspire_ai_kind"], launched["dbx_inspire_ai_layout"]) == ("anomaly", "monitor_triage")


def _describe(names, schemas):
    def answer(statement):
        for table, columns in schemas.items():
            if statement == f"DESCRIBE TABLE {names(table)}":
                return [{"col_name": c, "data_type": t} for c, t in columns]
        if statement.startswith("DESCRIBE TABLE"):
            raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] gone")
        return []
    return answer


def test_one_build_reads_each_companion_table_once_for_the_app_layout_and_the_kind(agent_ns, monkeypatch):
    from collections import Counter
    from v140_implement_test import TASK_RUN, VALID, _probe_inspire
    suffixes = _registry(agent_ns)["contracts"][agent_ns["_inspire_kind"]("driver_scenarios")["contract"]]["suffixes"]

    def answer(statement):
        suffix = next((s for s in suffixes if statement.startswith("DESCRIBE TABLE") and statement.rstrip("`").endswith(s)), None)
        return [{"col_name": c, "data_type": _type(c)} for c in suffixes[suffix]] if suffix else None

    monkeypatch.setitem(agent_ns, "current_job_run_id", lambda: TASK_RUN)
    inst = _probe_inspire(agent_ns, answer, {"notebook": {"modified_at": 1000, "spec_version": 2}})
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Name": "Plan margin", "genie_instruction": "Build",
                                                    "use_case_kind": "driver_scenarios"}
    inst._implement_notebook_paths = lambda uc, key: ("/W", "/W/nb")
    times = iter([1000, 1000, 3000])
    inst._implement_notebook_modified_at = lambda path: next(times)
    inst._implement_export_text = lambda path: "built notebook v2"
    inst._implement_runner = lambda uc: "runner"
    inst._implement_write_notebook = lambda uc, spec, previous, key, current="": "/W/nb"
    inst._implement_fill_and_preview = lambda *a: ({"status": "written", "rows_written": 12}, 77, {})
    contexts = []
    inst._implement_genie_space = lambda c, r: {"genie_space_id": "g1", "genie_space_url": "https://h/genie/rooms/g1"}
    inst._implement_app = lambda c, r: {"app_name": "margin-lab", "app_url": "https://margin-lab.example", "app_health": "running"}
    inst._implement_dashboard = lambda c, r: contexts.append(c) or {"dashboard_id": "d1", "dashboard_url": "https://h/d"}
    assert inst._implement_one_locked({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3, "spec_json": dict(VALID)},
                                      (5150, "N01-U01", 3), {}) == "ready"
    reads = Counter(s for s in inst.spark.statements if s.startswith("DESCRIBE TABLE") and any(s.rstrip("`").endswith(x) for x in suffixes))
    assert len(reads) == len(suffixes) and set(reads.values()) == {1}, reads
    context = contexts[0]
    assert context["app_layout"] == "scenario_lab" and len(context["layout_tables"]) == len(suffixes)
    assert set(context["kind_spec"]["tables"]) == set(suffixes) and not context["kind_spec"]["missing"]


def test_both_companion_readers_must_be_given_the_shared_reader(agent_ns):
    import inspect
    cls = type(_inspire(agent_ns, FakeSpark()))
    for name in ("_implement_app_layout", "_implement_kind_spec"):
        read = inspect.signature(getattr(cls, name)).parameters["read"]
        assert read.default is inspect.Parameter.empty, f"{name} reads with its own reader when a caller leaves read out"


def test_the_schema_reader_reads_each_table_once_and_gives_an_error_as_redacted_text(agent_ns):
    calls = []
    secret = "dapi" + "ab" * 16

    def read(table):
        calls.append(table)
        if table.endswith("gone"):
            raise RuntimeError(f"[INSUFFICIENT_PERMISSIONS] no SELECT for token {secret}")
        return [("a", "int")] if table.endswith("_a") else None

    once = agent_ns["implement_schema_once"](read)
    assert once("main.s.t_a") == [("a", "int")] and once("MAIN.S.T_A") == [("a", "int")]
    assert once("main.s.t_b") is None and once("main.s.t_b") is None
    text = once("main.s.gone")
    assert isinstance(text, str) and "INSUFFICIENT_PERMISSIONS" in text and secret not in text and once("main.s.gone") == text
    assert calls == ["main.s.t_a", "main.s.t_b", "main.s.gone"]
    assert agent_ns["implement_schema_once"](read)("main.s.t_a") == [("a", "int")] and calls[-1] == "main.s.t_a", \
        "each use case gets its own reader, so a new build reads again"
    assert "implement_schema_once" not in agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"], "the build's reader is not shipped in use-case notebooks"


def test_the_build_reads_each_companion_table_once_and_logs_what_it_found(agent_ns):
    names = agent_ns["inspire_table_name"]
    kind = agent_ns["_inspire_kind"]("driver_scenarios")
    spark = FakeSpark(_describe(names, _schemas(agent_ns, kind, drop=("__scenario_model",))))
    inst = _inspire(agent_ns, spark)
    spec = inst._implement_kind_spec("N01-U01", {"use_case_kind": "driver_scenarios"}, RESULT, inst._implement_schema_reader())
    assert set(spec["tables"]) == {"__scenarios", "__sensitivity"} and list(spec["missing"]) == [f"{RESULT}__scenario_model"]
    assert sorted(s for s in spark.statements if s.startswith("DESCRIBE")) == sorted(
        f"DESCRIBE TABLE {names(RESULT + s)}" for s in ("__scenarios", "__sensitivity", "__scenario_model"))
    logged = [m for _lv, m in inst.logger.records if "[KIND-ARTIFACTS FIRED]" in m]
    assert logged == [f"[KIND-ARTIFACTS FIRED] N01-U01: driver_scenarios kind, Scenario lab tables 2 of 3; not read: "
                      f"{RESULT}__scenario_model does not exist"]
    queue_spark = FakeSpark(_describe(names, {}))
    queue = _inspire(agent_ns, queue_spark)
    assert queue._implement_kind_spec("N01-U01", {"use_case_kind": "risk_propensity"}, RESULT, queue._implement_schema_reader()) is None
    assert queue_spark.statements == [] and not [m for _lv, m in queue.logger.records if "[KIND-ARTIFACTS FIRED]" in m]
