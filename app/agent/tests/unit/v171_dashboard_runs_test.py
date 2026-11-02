"""Decision 26A gaps on the use case's AI/BI dashboard: a KPI counter over the business output table compares with the previous run
through the App's definition of a run, the main page has a code-built reasons bar and a Trend page draws the decision list over
runs from the result history, and the dashboard's Drivers heading and reading guide come from the one page spec the App shares,
offline."""
import json
import os
import re
import sqlite3
import sys

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
for folder in (SERVER, TESTS):
    if folder not in sys.path:
        sys.path.insert(0, folder)

import shell_sql  # noqa: E402
from v142_dash_test import RESULT, _canvas, _page, _palettes  # noqa: E402

ALLOWED = [RESULT, "main.s.orders"]
HISTORY = [("record_key", "string"), ("valid_from", "timestamp"), ("valid_to", "timestamp"), ("is_current", "boolean"),
           ("change_source", "string"), ("changed_by", "string")]


def _schema(ns, drop=(), **kinds):
    core = [(name, kinds.get(name, kind)) for name, kind in ns["INSPIRE_CORE_COLUMNS"] if name not in drop]
    return core + HISTORY


def _runs_page(ns):
    page = _page(ns)
    kpis = [dict(k, compare=k["dataset"] == shell_sql.RECORDS_DATASET) for k in page["kpis"]]
    plain = next(k for k in kpis if k["compare"])
    return dict(page, kpis=kpis + [dict(plain, id="loss_listed", label="Loss on the list", expression="SUM(value)", format="currency",
                                        currency="USD", compare=False)])


def _doc(ns, schema, page=None):
    return ns["implement_dashboard_from_page"](page or _runs_page(ns), shell_sql, RESULT, {},
                                               theme=ns["implement_dashboard_theme"](_palettes(), None, "coral"), result_schema=schema)


def _check(ns, doc):
    return ns["check_dashboard_definition"](json.loads(json.dumps(doc)), ALLOWED, shell_sql.RECORDS_DATASET)[1]


def _db(runs):
    db = sqlite3.connect(":memory:")
    db.create_function("IF", 3, lambda c, a, b: a if c else b)
    db.create_function("format_string", 2, lambda pattern, value: pattern % value)
    db.create_function("concat", -1, lambda *parts: None if None in parts else "".join(parts))
    db.create_function("date_format", 2, lambda value, pattern: value)
    db.execute("CREATE TABLE churn_out (record_key TEXT, valid_from TEXT, valid_to TEXT, is_current INT, change_source TEXT, run_id TEXT, "
               "value REAL, bonus REAL)")
    rows = {1: [("a", "10:00", "11:00" if runs > 1 else None, int(runs == 1), "run", "r1", 1.0, None),
                ("b", "10:00", None, 1, "run", "r1", 2.0, None)],
            2: [("a", "11:00", None, 1, "run", "r2", 5.0, 4.0), ("c", "11:05", None, 1, "run", "r2", 7.0, 6.0)]}
    for run in range(1, runs + 1):
        db.executemany("INSERT INTO churn_out VALUES (?, ?, ?, ?, ?, ?, ?, ?)", rows[run])
    return db


def _local(sql):
    return sql.replace("`main`.`inspire`.`churn_out`", "churn_out").replace("main.inspire.churn_out", "churn_out").replace(" AS STRING)", " AS TEXT)")


def _part_sets(ns):
    return {f"chart_{i}_parts" for i, c in enumerate(_page(ns)["charts"]) if c.get("type") in ns["IMPLEMENT_DASHBOARD_PART_CHARTS"]}


def _history(ns, schema):
    return ns["implement_dashboard_history"](_runs_page(ns), shell_sql, RESULT, schema)


def _runs_sql():
    columns = ["record_key", "valid_from", "valid_to", "is_current", "change_source", "run_id", "value", "bonus"]
    now = f"SELECT o.record_key, o.value, o.bonus FROM {RESULT} AS o WHERE o.is_current AND o.change_source <> 'delete'"
    return shell_sql.runs_compare_sql(now, RESULT, columns)


def _compare(ns, runs, expression):
    query = (f"SELECT {shell_sql.run_measure(expression, shell_sql.RUN_LATEST)}, {shell_sql.previous_run_measure(expression)} "
             f"FROM ({_runs_sql()}) AS q")
    return _db(runs).execute(_local(query)).fetchone()


def _change(runs, expression):
    text = shell_sql.change_text_sql(shell_sql.run_measure(expression, shell_sql.RUN_LATEST), shell_sql.previous_run_measure(expression))
    return _db(runs).execute(_local(f"SELECT {text} FROM ({_runs_sql()}) AS q")).fetchone()[0]


def test_the_counter_s_change_reads_like_the_app_tile_and_is_empty_until_a_previous_run_exists(agent_ns):
    assert _change(2, "SUM(value)") == f"\u25b2 366.7% {shell_sql.COMPARE_RUN}", "14 against 3, as the App tile writes it"
    assert _change(2, "0 - SUM(value)") == f"\u25bc 366.7% {shell_sql.COMPARE_RUN}"
    unchanged = f"\u25a0 unchanged {shell_sql.COMPARE_RUN}"
    assert _change(2, "COUNT(CASE WHEN record_key = 'b' THEN 1 END)") == unchanged
    assert _change(2, "COUNT(CASE WHEN record_key = 'b' THEN 1 END) + 0.0000000001 * COUNT(*)") == unchanged, \
        "a change too small to show, such as two sums of one run added in another order, reads as unchanged, never as a rise of 0.0%"
    assert _change(1, "SUM(value)") == "", "a first run shows the value alone, never null"
    assert _change(2, "SUM(bonus)") == "", "no previous value, no change"
    assert _change(2, "SUM(value) * 0") == unchanged, "0 against 0 is unchanged"
    assert _change(2, "SUM(CASE WHEN record_key = 'c' THEN value ELSE 0 END)") == f"\u25b2 from 0 {shell_sql.COMPARE_RUN}", \
        "a previous value of 0 is an earlier run, so the change reads from 0, as on the App tile"
    assert shell_sql.CHANGE_MARKS == {"up": "\u25b2", "down": "\u25bc", "same": "\u25a0"}
    assert shell_sql.CHANGE_WORDS == WORDS


WORDS = {"same": "unchanged", "from_zero": "from 0", "none": "No earlier run to compare", "story_none": "with no earlier run to compare"}


def _case_text(case):
    if case["way"] is None:
        return ""
    shown = WORDS["same"] if case["way"] == "same" else WORDS["from_zero"] if case["size"] is None else f"{case['size']}%"
    return f"{shell_sql.CHANGE_MARKS[case['way']]} {shown} {shell_sql.COMPARE_RUN}"


def test_the_counter_and_the_app_tile_write_each_shared_case_alike_and_a_change_that_rounds_to_zero_reads_unchanged(agent_ns):
    with open(os.path.join(SERVER, "..", "web", "test", "change_cases.json"), encoding="utf-8") as handle:
        cases = json.load(handle)
    literal = lambda value: "NULL" if value is None else repr(float(value))  # noqa: E731
    shown = {json.dumps(c): _db(1).execute(f"SELECT {shell_sql.change_text_sql(literal(c['now']), literal(c['before']))}").fetchone()[0]
             for c in cases}
    assert shown == {json.dumps(c): _case_text(c) for c in cases}
    assert shown[json.dumps({"now": 100.00000001, "before": 100, "way": "same"})] == f"\u25a0 unchanged {shell_sql.COMPARE_RUN}", \
        "float noise reads as unchanged"
    assert shown[json.dumps({"now": 100.1, "before": 100, "way": "up", "size": "0.1"})] == f"\u25b2 0.1% {shell_sql.COMPARE_RUN}", \
        "a real 0.1% change keeps its mark and number"
    assert shown[json.dumps({"now": 48, "before": None, "way": None})] == "", "a NULL previous stays empty"
    assert shown[json.dumps({"now": 5, "before": 0, "way": "up", "size": None})] == f"\u25b2 from 0 {shell_sql.COMPARE_RUN}"
    sql = shell_sql.change_text_sql("a", "b")
    assert "NULLIF(abs(CAST((b) AS DOUBLE)), 0)" in sql, "a zero previous never divides by zero on a warehouse that fails on it"


def test_a_kpi_over_the_result_table_compares_the_latest_run_with_the_state_the_previous_run_ended_with(agent_ns):
    assert _compare(agent_ns, 2, "SUM(value)") == (14.0, 3.0)
    assert _compare(agent_ns, 2, "COUNT(*)") == (3, 2)
    assert _compare(agent_ns, 2, "COUNT(DISTINCT record_key)") == (3, 2)


def test_a_first_run_has_no_previous_value_and_never_a_fake_zero(agent_ns):
    assert _compare(agent_ns, 1, "SUM(value)") == (3.0, None)
    assert _compare(agent_ns, 1, "COUNT(*)") == (2, None), "no run before the first one, so the counter shows the value only"


def test_a_kpi_whose_previous_value_is_null_stays_null(agent_ns):
    assert _compare(agent_ns, 2, "SUM(bonus)") == (10.0, None)


def test_the_previous_run_is_the_app_s_second_newest_run_by_its_first_write(agent_ns):
    columns = ["record_key", "valid_from", "valid_to", "is_current", "change_source", "run_id", "value", "bonus"]
    sql = shell_sql.runs_compare_sql(f"SELECT o.record_key, o.value FROM {RESULT} AS o WHERE o.is_current", RESULT, columns, (1,))
    assert "ROW_NUMBER() OVER (ORDER BY `_inspire_ran` DESC)" in sql and "WHERE `_inspire_nth` IN (2))" in sql
    assert sorted(_db(2).execute(_local(sql)).fetchall()) == [("a", 1.0, "previous"), ("b", 2.0, "previous")]
    assert _db(1).execute(_local(sql)).fetchall() == [], "no run before the first one, so no previous rows"


def test_the_result_table_is_read_through_the_one_runs_read_wherever_a_dataset_names_it(agent_ns):
    columns = ["record_key", "is_current", "valid_from", "valid_to", "change_source", "run_id"]
    joined = shell_sql.runs_compare_sql(f"SELECT o.x FROM `main`.`inspire`.`churn_out` o JOIN main.s.orders AS s ON s.id = o.id WHERE o.is_current",
                                        RESULT, columns)
    assert joined.endswith(f"SELECT o.x , o.`_inspire_run` FROM {shell_sql.RUNS_CTE} o JOIN main.s.orders AS s ON s.id = o.id WHERE o.is_current")
    bare = shell_sql.runs_compare_sql(f"SELECT x FROM {RESULT} WHERE is_current", RESULT, columns)
    assert bare.endswith(f"SELECT x , `churn_out`.`_inspire_run` FROM {shell_sql.RUNS_CTE} AS `churn_out` WHERE is_current"), \
        "a table read with no alias keeps its name"
    other = "SELECT * FROM main.s.orders WHERE note = 'main.inspire.churn_out'"
    assert shell_sql.runs_problem(other, RESULT).startswith("it does not read the result table")


def test_a_counter_over_the_decision_list_shows_its_value_and_the_previous_run_and_follows_the_filters(agent_ns):
    doc = _doc(agent_ns, _schema(agent_ns))
    assert _check(agent_ns, doc) == []
    overview = _canvas(doc)[0]["layout"]
    counters = {item["widget"]["name"]: item["widget"] for item in overview if item["widget"].get("spec", {}).get("widgetType") == "counter"}
    page = _runs_page(agent_ns)
    over_result = [i for i, k in enumerate(page["kpis"]) if k["dataset"] == shell_sql.RECORDS_DATASET and k["compare"]]
    assert over_result and [i for i, k in enumerate(page["kpis"]) if k["dataset"] == shell_sql.RECORDS_DATASET and not k["compare"]]
    for index, kpi in enumerate(page["kpis"]):
        widget = counters[f"kpi_{index}"]
        encodings = widget["spec"]["encodings"]
        if index in over_result:
            dataset = widget["queries"][0]["query"]["datasetName"]
            assert dataset == f"{shell_sql.RECORDS_DATASET}_runs" and set(encodings) == {"value", "target"}
            fields = [f["expression"] for f in widget["queries"][0]["query"]["fields"]]
            assert fields == [f"MEASURE(`kpi_{index}_m0`)", f"MEASURE(`kpi_{index}_m1`)"], "value and target come from one dataset"
            defined = {c["displayName"]: c["expression"] for c in next(d for d in doc["datasets"] if d["name"] == dataset)["columns"]}
            now = shell_sql.run_measure(kpi["expression"], shell_sql.RUN_LATEST)
            assert defined[f"kpi_{index}_m0"] == now
            assert defined[f"kpi_{index}_m1"] == shell_sql.change_text_sql(now, shell_sql.previous_run_measure(kpi["expression"]))
            assert "format" not in encodings["target"], "the target is the change text, empty until a previous run exists"
            assert shell_sql.COMPARE_RUN not in widget["spec"]["frame"].get("description", ""), \
                "the counter names the previous run only in its change, so a first run never claims a comparison"
            assert "IMPLEMENT_DASHBOARD_COMPARED" not in agent_ns, "the words come from shell_sql, the one place both comparisons read"
            sql = "".join(next(d for d in doc["datasets"] if d["name"] == dataset)["queryLines"])
            assert "UNION ALL" in sql and f"'{shell_sql.RUN_PREVIOUS}' ELSE" in sql and "WHERE `_inspire_nth` IN (2))" in sql
            filters = [w for item in overview for w in [item["widget"]] if w["name"].startswith("filter_")]
            assert any(q["query"]["datasetName"] == dataset for f in filters for q in f["queries"]), "the page filters reach both runs"
        else:
            assert set(encodings) == {"value"}, "a KPI the page does not compare, or one over another table, shows its value alone"


def test_without_the_result_table_s_columns_the_dashboard_is_built_as_before(agent_ns):
    doc = _doc(agent_ns, None)
    assert _check(agent_ns, doc) == []
    assert [p["name"] for p in _canvas(doc)] == ["overview", "run_health"]
    page_sets = {d["name"] for d in _page(agent_ns)["datasets"]}
    assert set(_history(agent_ns, _schema(agent_ns))["datasets"]).isdisjoint(page_sets), "Inspire's datasets never take a page's name"
    assert {d["name"] for d in doc["datasets"]} == page_sets | _part_sets(agent_ns) | {"run_health"}
    assert not [item for item in _canvas(doc)[0]["layout"] if set((item["widget"].get("spec") or {}).get("encodings") or {}) == {"value", "target"}]


def test_the_main_page_has_a_reasons_bar_over_the_result_table_s_reasons(agent_ns):
    doc = _doc(agent_ns, _schema(agent_ns))
    overview = _canvas(doc)[0]["layout"]
    names = [item["widget"]["name"] for item in overview]
    assert names.index("reasons_bar") < names.index(agent_ns["IMPLEMENT_DASHBOARD_LIST"]), "the bar sits right above the decision list"
    bar = next(item["widget"] for item in overview if item["widget"]["name"] == "reasons_bar")
    assert (bar["spec"]["widgetType"], bar["spec"]["frame"]["title"], bar["queries"][0]["query"]["datasetName"]) == (
        "bar", "Records by reason", "reasons")
    assert bar["spec"]["encodings"]["x"]["scale"]["sort"] == {"by": "y-reversed"}
    sql = "".join(next(d for d in doc["datasets"] if d["name"] == "reasons")["queryLines"])
    assert "LATERAL VIEW EXPLODE(t.`top_reasons`) r AS `reason`" in sql and "t.`is_current`" in sql


def test_a_result_table_with_no_reason_list_has_no_reasons_bar(agent_ns):
    for schema in (_schema(agent_ns, drop=("top_reasons",)), _schema(agent_ns, top_reasons="string")):
        doc = _doc(agent_ns, schema)
        assert _check(agent_ns, doc) == []
        assert "reasons_bar" not in [item["widget"]["name"] for item in _canvas(doc)[0]["layout"]]
        assert "reasons" not in [d["name"] for d in doc["datasets"]]


def test_the_trend_page_draws_the_decision_list_over_runs_from_the_result_history(agent_ns):
    doc = _doc(agent_ns, _schema(agent_ns))
    pages = _canvas(doc)
    assert [p["name"] for p in pages] == ["overview", "trend", "run_health"]
    layout = pages[1]["layout"]
    header = "".join(layout[0]["widget"]["multilineTextboxSpec"]["lines"])
    assert header.startswith("## Trend") and shell_sql.GUIDE_PREFIX in header and "Records on the list" in header
    named = _history(agent_ns, _schema(agent_ns))
    status = next(item["widget"] for item in layout if item["widget"]["name"] == "trend_runs")
    assert (status["spec"]["widgetType"], status["spec"]["frame"]["title"], status["queries"][0]["query"]["datasetName"]) == (
        "counter", "Runs so far", named["trend"]), "the run count reads the Trend dataset, so the page runs one query"
    assert "with one run each chart has one bar" in status["spec"]["frame"]["description"]
    charts = [item["widget"] for item in layout if item["widget"].get("spec", {}).get("widgetType") == "bar"]
    assert [c["spec"]["frame"]["title"] for c in charts] == ["Records on the list", "Act now", "Value at stake"]
    assert [(c["spec"]["encodings"]["x"]["scale"], c["queries"][0]["query"]["datasetName"]) for c in charts] == [
        ({"type": "categorical", "sort": {"by": "natural-order"}}, named["trend"])] * 3, "one even bar per run, oldest first"
    assert {c["spec"]["encodings"]["x"]["fieldName"] for c in charts} == {shell_sql.TREND_RUN_LABEL}


def test_the_trend_reads_each_run_as_it_stood_when_it_ended(agent_ns):
    sql = shell_sql.trend_sql("`main`.`inspire`.`churn_out`", {"records": "COUNT(DISTINCT t.`record_key`)", "at_stake": "SUM(t.`value`)"})
    rows = _db(2).execute(_local(sql) + " ORDER BY ran_at").fetchall()
    assert rows == [("r1", "10:00", "10:00", 2, 3.0), ("r2", "11:00", "11:00", 3, 14.0)]
    assert f"date_format(r.`_inspire_ran`, 'yyyy-MM-dd HH:mm:ss') AS `{shell_sql.TREND_RUN_LABEL}`" in sql, "labels sort in run order"


def test_the_trend_page_counts_one_run_and_draws_no_empty_chart(agent_ns):
    trend = _local(shell_sql.trend_sql("`main`.`inspire`.`churn_out`", {"records": "COUNT(DISTINCT t.`record_key`)"}))
    for runs in (1, 2):
        assert _db(runs).execute(f"SELECT COUNT(DISTINCT `run_id`) FROM ({trend}) AS d").fetchone() == (runs,), "the Runs so far counter"
    assert _db(1).execute(trend).fetchall() == [("r1", "10:00", "10:00", 2)], "one run is one bar, never an empty chart"


def test_counters_over_one_dataset_share_one_run_dataset_and_the_trend_runs_one_query(agent_ns):
    doc = _doc(agent_ns, _schema(agent_ns))
    names = [d["name"] for d in doc["datasets"]]
    page_sets = [d["name"] for d in _page(agent_ns)["datasets"]]
    compared = {k["dataset"] for k in _runs_page(agent_ns)["kpis"] if k["compare"]} & {shell_sql.RECORDS_DATASET}
    assert compared
    added = [n for n in names if n not in page_sets and n not in _part_sets(agent_ns) and n not in ("run_health", "run_status")]
    assert sorted(added) == sorted([f"{d}_runs" for d in compared] + ["reasons", _history(agent_ns, _schema(agent_ns))["trend"]])
    assert len(added) == len(compared) + 2, "one run dataset per KPI dataset, one reasons dataset and one Trend dataset"


def _read_measures(doc):
    defined = {d["name"]: {c["displayName"] for c in d.get("columns") or []} for d in doc["datasets"]}
    for page in doc["pages"]:
        for item in page["layout"]:
            widget = item["widget"]
            for query in widget.get("queries") or []:
                for field in query["query"].get("fields") or []:
                    found = re.fullmatch(r"MEASURE\(`([^`]+)`\)", field.get("expression") or "")
                    if found:
                        yield widget["name"], query["query"]["datasetName"], found.group(1), found.group(1) in defined[query["query"]["datasetName"]]


def test_every_measure_a_widget_reads_is_defined_on_its_dataset_on_every_page(agent_ns):
    for schema in (_schema(agent_ns), None):
        read = list(_read_measures(_doc(agent_ns, schema)))
        assert read and [r for r in read if not r[3]] == [], "a Trend bar or any tile that reads a measure its dataset lacks draws nothing"
    trend = [r for r in _read_measures(_doc(agent_ns, _schema(agent_ns))) if r[0].startswith("trend_")]
    assert trend and all(defined for *_r, defined in trend)


def test_the_check_rejects_a_widget_that_reads_a_measure_its_dataset_does_not_define(agent_ns):
    doc = _doc(agent_ns, _schema(agent_ns))
    trend = next(d for d in doc["datasets"] if d["name"] == _history(agent_ns, _schema(agent_ns))["trend"])
    trend.pop("columns")
    problems = [p for p in _check(agent_ns, doc) if "does not define" in p]
    assert problems and all("measure" in p for p in problems)
    assert [p for p in _check(agent_ns, _doc(agent_ns, _schema(agent_ns))) if "does not define" in p] == []


def test_the_dashboard_s_drivers_heading_and_reading_guide_come_from_the_one_page_spec(agent_ns):
    page = _page(agent_ns)
    doc = _doc(agent_ns, _schema(agent_ns))
    header = next(item["widget"] for item in _canvas(doc)[0]["layout"] if item["widget"]["name"] == agent_ns["IMPLEMENT_DASHBOARD_DRIVERS_HEADER"])
    section = shell_sql.drivers_section(page)
    assert "".join(header["multilineTextboxSpec"]["lines"]) == f"## {section['title']}\n\n{section['guide']}"
    assert (agent_ns["IMPLEMENT_DASHBOARD_DRIVERS"], agent_ns["IMPLEMENT_DASHBOARD_GUIDE_PREFIX"]) == (shell_sql.DRIVERS_TITLE, shell_sql.GUIDE_PREFIX)
    assert shell_sql.drivers_section(dict(page, charts=[dict(c, driver=False) for c in page["charts"]])) is None
    assert "implement_dashboard_guide" not in agent_ns and not re.search(r"_implement_dashboard_and\b", " ".join(agent_ns))


def test_with_a_run_log_the_trend_and_the_previous_run_read_the_log_and_pass_the_run_version_check(agent_ns):
    schema = _schema(agent_ns) + [("run_id", "string")] if "run_id" not in {n for n, _k in _schema(agent_ns)} else _schema(agent_ns)
    log = agent_ns["inspire_run_log_table"](RESULT)
    fields = [{"name": str(name), "type": "STRING"} for name, _kind in schema]
    run_log = shell_sql.history_layout({shell_sql.RUN_LOG_PROPERTY: log}, fields)
    assert run_log, "the result table names its run log"
    versions = {"table": RESULT, "log": log, "views": []}
    plain = _doc(agent_ns, schema)
    refused = agent_ns["check_dashboard_definition"](json.loads(json.dumps(plain)), ALLOWED + [log], shell_sql.RECORDS_DATASET, run_versions=versions)[1]
    assert any("run by run" in e for e in refused), "without the run log the history datasets read the versions run by run and are refused"
    doc = agent_ns["implement_dashboard_from_page"](_runs_page(agent_ns), shell_sql, RESULT, {},
                                                 theme=agent_ns["implement_dashboard_theme"](_palettes(), None, "coral"), result_schema=schema,
                                                 run_log=run_log)
    errors = agent_ns["check_dashboard_definition"](json.loads(json.dumps(doc)), ALLOWED + [log], shell_sql.RECORDS_DATASET, run_versions=versions)[1]
    assert errors == [], errors
    page_sets = {d["name"] for d in _page(agent_ns)["datasets"]}
    built = {_history(agent_ns, schema)["trend"]} | {d["name"] for d in doc["datasets"] if d["name"].endswith("_runs") and d["name"] not in page_sets}
    history = [d for d in doc["datasets"] if d["name"] in built]
    assert len(history) == 2 and all(log.split(".")[-1] in "".join(d["queryLines"]) for d in history), [d["name"] for d in history]
