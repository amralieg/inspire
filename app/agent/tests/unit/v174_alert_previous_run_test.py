"""Decision 1B for alerts: an alert reads each run's value the way the App tile and the dashboard counter do, from the KPI's own
dataset as that run left the result table, each aggregate cut to that one run. Its value equals the tile's and the counter's for
every aggregate class, its usual range reads every earlier run the same way, a first run gives no earlier value and says so in the
tile's words, a formula no run can split is refused with the page check's fix-it text, and no raw-table baseline is left, offline."""
import ast
import json
import os
import re
import sqlite3
import statistics

import pytest

from v173_dashboard_previous_run_test import CASES, COLUMNS, RESULT, ROOT, WEB, _close, _dash_page, _dashboard, _db, _kpi, _local, _tile
import shell_alerts  # noqa: E402
import shell_sql  # noqa: E402

AGENT = os.path.join(ROOT, "agent")
OLD_BASELINE = ("PARTITION BY as_of_date ORDER BY MAX(valid_from)", "no_rows AS (", "measured AS (SELECT as_of_date, run_id",
                "as_of_date NOT IN (SELECT as_of_date")


class _StddevSamp:
    def __init__(self):
        self.values = []

    def step(self, value):
        if value is not None:
            self.values.append(float(value))

    def finalize(self):
        return statistics.stdev(self.values) if len(self.values) > 1 else None


def _run(db, query):
    db.create_aggregate("STDDEV_SAMP", 1, _StddevSamp)
    cursor = db.execute(_local(query["query"]))
    return dict(zip([c[0] for c in cursor.description], cursor.fetchone()))


def _watch(kpi, category=None, operator=">", threshold=1000):
    return {"what": kpi["id"], "filters": {"category": [category]} if category else {}, "operator": operator, "threshold": threshold,
            "basis": "baseline"}


def _alert(ns, kpi, runs, category=None, **watch):
    page = dict(_dash_page(ns, [kpi]), result_table=RESULT)
    row = _run(_db(runs), shell_sql.watch_query(page, _watch(kpi, category, **watch), COLUMNS))
    return row[shell_sql.ALERT_WATCHED], row[shell_sql.ALERT_PREVIOUS], row


@pytest.mark.parametrize("ident,expression,category,runs,want,old_wrong", CASES, ids=[c[0] for c in CASES])
def test_the_alert_the_tile_and_the_counter_read_the_same_value_for_every_aggregate_class(agent_ns, ident, expression, category, runs, want,
                                                                                         old_wrong):
    kpi = _kpi(expression)
    now, before, _row = _alert(agent_ns, kpi, runs, category)
    tile, counter = _tile(agent_ns, kpi, runs, category), _dashboard(agent_ns, kpi, runs, category)
    assert _close((now, before), want), f"{ident}: the alert reads (now, previous run) {(now, before)}, the runs hold {want}"
    assert _close((now, before), tile) and _close((now, before), counter), f"{ident}: alert {(now, before)}, tile {tile}, counter {counter}"


def _three_runs():
    db = sqlite3.connect(":memory:")
    db.create_aggregate("STDDEV_SAMP", 1, _StddevSamp)
    db.execute("CREATE TABLE churn_out (record_key TEXT, valid_from TEXT, valid_to TEXT, is_current INT, change_source TEXT, changed_by TEXT, "
               "run_id TEXT, as_of_date TEXT, value REAL, bonus REAL, category TEXT)")
    rows = [("a", "10:00", "11:00", 0, "run", "job", "r1", "2026-10-01", 1.0, None, "Books"),
            ("b", "10:00", "12:00", 0, "run", "job", "r1", "2026-10-01", 4.0, 2.0, "Toys"),
            ("c", "10:00", "11:00", 0, "run", "job", "r1", "2026-10-01", None, 1.0, "Books"),
            ("a", "11:00", "12:00", 0, "run", "job", "r2", "2026-10-02", 2.0, 1.0, "Books"),
            ("c", "11:00", None, 1, "run", "job", "r2", "2026-10-02", 6.0, 1.0, "Books"),
            ("a", "12:00", None, 1, "run", "job", "r3", "2026-10-03", 5.0, 4.0, "Books"),
            ("b", "12:00", None, 1, "run", "job", "r3", "2026-10-03", 7.0, 2.0, "Toys"),
            ("d", "12:00", None, 1, "run", "job", "r3", "2026-10-03", 3.0, 6.0, "Garden")]
    db.executemany("INSERT INTO churn_out VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    return db


THREE_COLUMNS = ["record_key", "valid_from", "valid_to", "is_current", "change_source", "changed_by", "run_id", "as_of_date", "value", "bonus",
                 "category"]
PRICED = (f"SELECT o.record_key, o.value, o.category FROM {RESULT} AS o WHERE o.is_current AND o.change_source <> 'delete' "
          f"AND o.value > 3")
RAW_DIFFERS = [
    ("sum_on_current_rows", "SUM(value)", "rows", None, (21.0, 2, 8.5)),
    ("count_on_current_rows", "COUNT(*)", "rows", None, (4, 2, 3.0)),
    ("avg_case_else_0", "100 * AVG(CASE WHEN value > 2 THEN 1 ELSE 0 END)", "rows", None, (100.0, 2, 50.0)),
    ("count_under_a_page_filter", "COUNT(*)", "rows", "Toys", (1, 2, 1.0)),
    ("count_of_a_dataset_with_its_own_filter", "COUNT(*)", "priced", None, (3, 2, 1.5)),
]


@pytest.mark.parametrize("ident,expression,dataset,category,want", RAW_DIFFERS, ids=[c[0] for c in RAW_DIFFERS])
def test_the_usual_range_reads_each_earlier_run_as_it_left_the_kpi_dataset_never_the_rows_that_run_wrote(agent_ns, ident, expression, dataset,
                                                                                                        category, want):
    page = _dash_page(agent_ns, [_kpi(expression, dataset=dataset)])
    page["datasets"].append({"name": "priced", "sql": PRICED})
    for f in page["filters"]:
        if f["id"] == "category":
            f["columns"]["priced"] = "category"
    row = _run(_three_runs(), shell_sql.watch_query(dict(page, result_table=RESULT), _watch(page["kpis"][0], category), THREE_COLUMNS))
    got = (row[shell_sql.ALERT_WATCHED], row["history_runs"], row["baseline_mean"])
    assert got[1] == want[1] and _close((got[0], got[2]), (want[0], want[2])), \
        f"{ident}: the alert reads (now, earlier runs, mean) {got}; the KPI's dataset at each run holds {want}"


def test_a_first_run_has_no_earlier_value_never_fires_on_a_missing_baseline_and_says_so_in_the_tile_s_words(agent_ns):
    kpi = _kpi("SUM(value)")
    now, before, row = _alert(agent_ns, kpi, 1, threshold=1000)
    assert (now, before, row["history_runs"], row["threshold_basis"], row[shell_sql.ALERT_FIRED]) == (5.0, None, 0, "fixed", 0)
    _n, _b, low = _alert(agent_ns, kpi, 1, threshold=1)
    assert low[shell_sql.ALERT_FIRED] == 1, "with no earlier run the number the person set decides, as the rule says"
    preview = shell_alerts.preview_view(_watch(kpi), row)
    assert preview["previous"] is None and preview["history_runs"] == 0 and preview["fires"] is False
    words = shell_sql.CHANGE_WORDS
    assert {k: preview[k] for k in ("vs", "marks", "words")} == shell_sql.compare_words(), "the preview carries the tile's words from shell_sql"
    fixed = shell_alerts.preview_view(dict(_watch(kpi), basis="fixed", operator=">=", threshold=1), row)
    assert fixed["words"] == words and fixed["vs"] == shell_sql.COMPARE_RUN
    assert agent_ns["implement_alert_previous_text"]({"previous": None}, shell_sql) == words["none"]
    assert agent_ns["implement_alert_previous_text"]({"previous": 73.5}, shell_sql) == "73.5 in the previous run"
    alerts_js = open(os.path.join(WEB, "src", "alerts.js"), encoding="utf-8").read()
    assert "import { change, changeText } from './format.js';" in alerts_js and "preview.words.none" in alerts_js and "{preview.vs}" in alerts_js
    assert not [w for w in list(words.values()) + [shell_sql.COMPARE_RUN] if w in alerts_js], "the words come from shell_sql only"


SHAPE_FIX = "so it gives a value for every row; write one aggregate expression over the dataset's columns"
UNSPLIT = [("value + SUM(bonus)", "the column value sits outside an aggregate", f"KPI k expression reads value outside an aggregate, {SHAPE_FIX}"),
           ("SUM(value) OVER (PARTITION BY category)", "SUM( ) OVER is a window or a filter it cannot split by run",
            f"KPI k expression is a window function (OVER), {SHAPE_FIX}"),
           ("first(value)", "first( ) is not an aggregate it can split by run",
            "KPI k compares with the previous run, but first( ) is not an aggregate it can split by run; write it so every column sits "
            "inside an aggregate such as SUM, COUNT, AVG, MIN or MAX, or set no compare")]


@pytest.mark.parametrize("expression,said,page_said", UNSPLIT, ids=[u[1].split()[0] for u in UNSPLIT])
def test_a_formula_no_run_can_split_is_refused_with_the_page_check_s_fix_it_text_never_read_from_raw_rows(agent_ns, expression, said,
                                                                                                         page_said):
    kpi = _kpi(expression)
    page = dict(_dash_page(agent_ns, [kpi]), result_table=RESULT)
    fix = "write it so every column sits inside an aggregate such as SUM, COUNT, AVG, MIN or MAX"
    with pytest.raises(ValueError, match=re.escape(f"KPI k is compared with earlier runs, but {said}; {fix}, or use a fixed number")):
        shell_sql.watch_query(page, _watch(kpi), COLUMNS)
    with pytest.raises(ValueError, match=re.escape(f"{said}; {fix}, or use a fixed number")):
        shell_sql.alert_query(expression, ">", 1, "baseline", source=shell_sql.records_sql(RESULT), table=RESULT, columns=COLUMNS)
    checked = [p for p in shell_sql.spec_problems(page) if p.startswith(("KPI k compares", "KPI k expression"))]
    assert checked == [page_said], "the page check refuses the formula once: as no single value when it is not one aggregate, else as no run split"
    [listed] = [m for m in shell_alerts.measure_list(page, COLUMNS) if m["id"] == "k"]
    assert (listed["baseline"], listed["baseline_filters"]) == (False, []) and fix in listed["baseline_note"]
    fixed = shell_sql.watch_query(page, dict(_watch(kpi), basis="fixed"), COLUMNS)
    assert shell_sql.RUNS_CTE not in fixed["query"], "a fixed number reads only the latest value, so it needs no split"


def test_the_build_time_alert_reads_the_decision_list_the_same_way(agent_ns):
    db = _db(2)
    db.execute("ALTER TABLE churn_out ADD COLUMN priority_tier TEXT")
    db.execute("ALTER TABLE churn_out ADD COLUMN as_of_date TEXT")
    db.execute("UPDATE churn_out SET priority_tier = CASE WHEN value > 2 THEN 'Act now' ELSE 'Monitor' END, as_of_date = run_id")
    outputs = {"alert_tiers": "act_now", "alert_operator": ">=", "alert_threshold": 1, "alert_threshold_basis": "baseline"}
    columns = COLUMNS + ["priority_tier", "as_of_date"]
    row = _run(db, agent_ns["implement_alert_query"](shell_sql, RESULT, outputs, columns=columns))
    page = {"datasets": [{"name": "records", "sql": shell_sql.records_sql(RESULT)}], "result_table": RESULT, "filters": [],
            "kpis": [{"id": "act", "dataset": "records", "expression": "COUNT_IF(priority_tier IN ('Act now'))", "compare": True}]}
    sql, params = shell_sql.kpi_query(page, "act", {}, shell_sql.previous_rows(page, "records", columns))
    tile = dict(db.execute(_local(sql)).fetchall())
    assert (row["tier_rows"], row[shell_sql.ALERT_PREVIOUS], row["history_runs"]) == (tile["now"], tile["before"], 1) == (2, 1, 1)
    with pytest.raises(ValueError, match="whose columns Inspire must read"):
        agent_ns["implement_alert_query"](shell_sql, RESULT, outputs)


def _notebook_code():
    notebook = json.load(open(os.path.join(AGENT, "dbx_inspire_ai_agent.ipynb"), encoding="utf-8"))
    for cell in notebook["cells"]:
        if cell["cell_type"] == "code":
            source = "".join(cell["source"])
            yield "\n".join(line for line in source.split("\n") if not line.startswith(("%", "!")))


def _agent_sources():
    for folder, _dirs, files in os.walk(AGENT):
        if "node_modules" in folder or os.sep + "dist" in folder:
            continue
        for name in files:
            if name.endswith(".py"):
                yield os.path.join(folder, name), open(os.path.join(folder, name), encoding="utf-8").read()
    for index, code in enumerate(_notebook_code()):
        yield f"notebook cell {index}", code


def raw_baseline_sites(tree) -> list:
    found = []
    for node in ast.walk(tree):
        text = node.value if isinstance(node, ast.Constant) and isinstance(node.value, str) else ""
        if any(marker in text for marker in OLD_BASELINE):
            found.append(f"line {node.lineno}: {text[:60]!r}")
        if isinstance(node, ast.FunctionDef) and node.name == "alert_query" and "current" in [a.arg for a in node.args.args]:
            found.append(f"line {node.lineno}: alert_query takes a current-rows filter of the raw table")
        if isinstance(node, ast.Call) and getattr(node.func, "attr", getattr(node.func, "id", "")) == "alert_query":
            if "source" not in {k.arg for k in node.keywords}:
                found.append(f"line {node.lineno}: alert_query called with no dataset")
    return found


def test_no_raw_table_baseline_is_left_anywhere_in_the_agent():
    planted = ast.parse("def alert_query(measure, current='x'):\n    return f\"runs AS (SELECT ROW_NUMBER() OVER (PARTITION BY as_of_date ORDER BY "
                        "MAX(valid_from) DESC) {measure}\"\nalert_query('COUNT(*)', table='t')\n")
    assert len(raw_baseline_sites(planted)) == 3, "the sweep catches the old baseline's SQL, its current-rows filter and a call with no dataset"
    left = {where: sites for where, text in _agent_sources() for sites in [raw_baseline_sites(ast.parse(text))] if sites}
    assert left == {}, left
    calls = [where for where, text in _agent_sources() if "alert_query(" in text]
    assert len(calls) >= 2, calls
