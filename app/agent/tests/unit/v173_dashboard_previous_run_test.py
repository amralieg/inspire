"""Decision 1B on the AI/BI dashboard: a compared KPI counter reads the previous run the way the App tile does, through one definition.
Rows outside a run never enter an aggregate, for every aggregate class and every constant a formula holds, a first run and a filter
the previous run cannot answer give no earlier value, only a KPI the page spec compares is compared, and the dashboard and the App
say the same words from shell_sql, offline."""
import json
import os
import re
import sqlite3
import statistics
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.dirname(os.path.dirname(TESTS))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
WEB = os.path.join(ROOT, "agent", "app_shell", "web")
for folder in (SERVER, TESTS):
    if folder not in sys.path:
        sys.path.insert(0, folder)

import shell_sql  # noqa: E402
from v142_dash_test import RESULT, _canvas, _embed, _page, _palettes  # noqa: E402

QUOTED = "`main`.`inspire`.`churn_out`"
COLUMNS = ["record_key", "valid_from", "valid_to", "is_current", "change_source", "changed_by", "run_id", "value", "bonus", "category"]
SCHEMA = [(c, "timestamp" if c.startswith("valid_") else "boolean" if c == "is_current" else "double" if c in ("value", "bonus")
           else "string") for c in COLUMNS]
ROWS_SQL = f"SELECT o.record_key, o.value, o.bonus, o.category FROM {RESULT} AS o WHERE o.is_current AND o.change_source <> 'delete'"
WRONG = "the old column rewrite gave a wrong number here"


class _Median:
    def __init__(self):
        self.values = []

    def step(self, value):
        if value is not None:
            self.values.append(value)

    def finalize(self):
        return statistics.median(self.values) if self.values else None


class _Percentile(_Median):
    def step(self, value, share):
        if value is not None:
            self.values.append(value)
            self.share = share

    def finalize(self):
        if not self.values:
            return None
        ordered, at = sorted(self.values), (len(self.values) - 1) * self.share
        low = int(at)
        return ordered[low] + (ordered[min(low + 1, len(ordered) - 1)] - ordered[low]) * (at - low)


class _CountIf:
    def __init__(self):
        self.n = 0

    def step(self, value):
        self.n += bool(value)

    def finalize(self):
        return self.n


def _db(runs):
    db = sqlite3.connect(":memory:")
    db.create_function("IF", 3, lambda c, a, b: a if c else b)
    db.create_aggregate("median", 1, _Median)
    db.create_aggregate("percentile", 2, _Percentile)
    db.create_aggregate("COUNT_IF", 1, _CountIf)
    db.execute("CREATE TABLE churn_out (record_key TEXT, valid_from TEXT, valid_to TEXT, is_current INT, change_source TEXT, changed_by TEXT, "
               "run_id TEXT, value REAL, bonus REAL, category TEXT)")
    closed = "11:00" if runs > 1 else None
    rows = [("a", "10:00", closed, int(runs == 1), "run", "job", "r1", 1.0, None, "Books"),
            ("b", "10:00", closed, int(runs == 1), "run", "job", "r1", 4.0, 2.0, "Toys"),
            ("c", "10:00", closed, int(runs == 1), "run", "job", "r1", None, 1.0, "Books")]
    if runs > 1:
        rows += [("a", "11:00", None, 1, "run", "job", "r2", 5.0, 4.0, "Books"),
                 ("d", "11:00", None, 1, "run", "job", "r2", 3.0, 6.0, "Garden")]
    db.executemany("INSERT INTO churn_out VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)", rows)
    return db


def _local(sql):
    return sql.replace(QUOTED, "churn_out").replace(RESULT, "churn_out").replace(" AS STRING)", " AS TEXT)")


def _kpi(expression, ident="k", **more):
    return dict({"id": ident, "label": f"KPI {ident}", "dataset": "rows", "expression": expression, "format": "number", "good": "up",
                 "compare": True}, **more)


def _dash_page(ns, kpis):
    page = _page(ns)
    page["datasets"] = page["datasets"] + [{"name": "rows", "sql": ROWS_SQL}]
    for f in page["filters"]:
        if f["id"] == "category":
            f["columns"]["rows"] = "category"
    page["kpis"] = kpis
    return page


def _build(ns, page, schema=SCHEMA):
    return ns["implement_dashboard_from_page"](page, shell_sql, RESULT, {}, theme=ns["implement_dashboard_theme"](_palettes(), None, "coral"),
                                               result_schema=schema)


def _counters(doc):
    return {item["widget"]["name"]: item["widget"] for item in _canvas(doc)[0]["layout"]
            if (item["widget"].get("spec") or {}).get("widgetType") == "counter"}


def _measures(doc, dataset):
    found = next(d for d in doc["datasets"] if d["name"] == dataset)
    return "".join(found["queryLines"]), {c["displayName"]: c["expression"] for c in found.get("columns") or []}


def _dashboard(ns, kpi, runs, category=None):
    doc = _build(ns, _dash_page(ns, [kpi]))
    widget = _counters(doc)["kpi_0"]
    query = widget["queries"][0]["query"]
    sql, measures = _measures(doc, query["datasetName"])
    now, change = [measures[re.fullmatch(r"MEASURE\(`([^`]+)`\)", f["expression"]).group(1)] for f in query["fields"]]
    before = shell_sql.previous_run_measure(kpi["expression"])
    assert change == shell_sql.change_text_sql(now, before), "the counter's change reads the previous run through the one builder"
    shown = [now, before]
    where = " WHERE category IN (?)" if category else ""
    row = _db(runs).execute(_local(f"SELECT {', '.join(shown)} FROM ({sql}) AS q{where}"), [category] if category else []).fetchone()
    return tuple(row) + (None,) * (2 - len(row))


def _tile(ns, kpi, runs, category=None):
    page = _dash_page(ns, [kpi])
    previous = shell_sql.previous_rows(dict(page, result_table=RESULT), "rows", COLUMNS)
    sql, params = shell_sql.kpi_query(page, kpi["id"], {"category": [category]} if category else {}, previous)
    out = dict(_db(runs).execute(_local(sql), {p["name"]: p["value"] for p in params}).fetchall())
    return out.get("now"), out.get("before")


def _close(got, want):
    return all((g is None and w is None) or (g is not None and w is not None and abs(g - w) < 1e-9) for g, w in zip(got, want))


CASES = [
    ("sum", "SUM(value)", None, 2, (8.0, 5.0), False),
    ("sum_counting_empty_values", "SUM(CASE WHEN value IS NULL THEN 1 ELSE 0 END)", None, 2, (0, 1), True),
    ("avg", "AVG(value)", None, 2, (4.0, 2.5), False),
    ("avg_case_else_0", "100 * AVG(CASE WHEN value > 2 THEN 1 ELSE 0 END)", None, 2, (100.0, 100 / 3), True),
    ("count_star", "COUNT(*)", None, 2, (2, 3), False),
    ("count_column", "COUNT(value)", None, 2, (2, 2), False),
    ("count_of_a_constant_else", "COUNT(CASE WHEN value > 2 THEN 1 ELSE 0 END)", None, 2, (2, 3), True),
    ("count_distinct", "COUNT(DISTINCT bonus)", None, 2, (2, 2), False),
    ("count_distinct_coalesce", "COUNT(DISTINCT COALESCE(bonus, -1))", None, 2, (2, 3), True),
    ("count_if_null", "COUNT_IF(value IS NULL)", None, 2, (0, 1), True),
    ("min", "MIN(value)", None, 2, (3.0, 1.0), False),
    ("min_coalesce", "MIN(COALESCE(value, 0))", None, 2, (3.0, 0.0), True),
    ("max", "MAX(value)", None, 2, (5.0, 4.0), False),
    ("max_case_else_constant", "MAX(CASE WHEN category = 'Books' THEN value ELSE 99 END)", None, 2, (99.0, 99.0), False),
    ("max_coalesce", "MAX(COALESCE(value, 99))", None, 2, (5.0, 99.0), True),
    ("ratio_of_sums", "SUM(value) / NULLIF(SUM(bonus), 0)", None, 2, (0.8, 5 / 3), False),
    ("ratio_counting_empty_values", "SUM(CASE WHEN value IS NULL THEN 1 ELSE 0 END) * 1.0 / COUNT(*)", None, 2, (0.0, 1 / 3), True),
    ("median", "median(value)", None, 2, (4.0, 2.5), False),
    ("median_coalesce", "median(COALESCE(value, 0))", None, 2, (4.0, 1.0), True),
    ("percentile", "percentile(value, 0.5)", None, 2, (4.0, 2.5), False),
    ("percentile_coalesce", "percentile(COALESCE(value, 0), 0.5)", None, 2, (4.0, 1.0), True),
    ("nested_case_else_0", "AVG(CASE WHEN category = 'Books' THEN CASE WHEN value > 2 THEN 1 ELSE 0 END ELSE 0 END)", None, 2, (0.5, 0.0), True),
    ("nested_case_else_null", "AVG(CASE WHEN category = 'Books' THEN CASE WHEN value > 2 THEN 1 ELSE 0 END ELSE NULL END)", None, 2,
     (1.0, 0.0), False),
    ("formula_with_a_condition", "AVG(CASE WHEN category = 'Books' THEN value ELSE 0 END)", None, 2, (2.5, 0.5), True),
    ("formula_under_a_filter", "100 * AVG(CASE WHEN value > 2 THEN 1 ELSE 0 END)", "Books", 2, (100.0, 0.0), True),
    ("sum_under_a_filter", "SUM(value)", "Books", 2, (5.0, 1.0), False),
    ("first_run_sum", "SUM(value)", None, 1, (5.0, None), False),
    ("first_run_count", "COUNT(*)", None, 1, (3, None), False),
    ("first_run_avg_case", "100 * AVG(CASE WHEN value > 2 THEN 1 ELSE 0 END)", None, 1, (100 / 3, None), False),
    ("previous_run_filtered_empty_count", "COUNT(*)", "Garden", 2, (1, None), False),
    ("previous_run_filtered_empty_avg_case", "100 * AVG(CASE WHEN value > 2 THEN 1 ELSE 0 END)", "Garden", 2, (100.0, None), False),
]


@pytest.mark.parametrize("ident,expression,category,runs,want,old_wrong", CASES, ids=[c[0] for c in CASES])
def test_every_aggregate_class_reads_each_run_with_no_row_of_the_other_run(agent_ns, ident, expression, category, runs, want, old_wrong):
    kpi = _kpi(expression)
    dashboard = _dashboard(agent_ns, kpi, runs, category)
    assert _close(dashboard, want), (f"{ident}: the dashboard reads (now, before) {dashboard}, the runs hold {want}"
                                     + (f"; {WRONG}" if old_wrong else ""))
    tile = _tile(agent_ns, kpi, runs, category)
    assert _close(tile, want), f"{ident}: the App tile reads {tile}, the runs hold {want}"


def test_the_dashboard_and_the_tile_build_the_previous_rows_through_one_definition(agent_ns):
    doc = _build(agent_ns, _dash_page(agent_ns, [_kpi("SUM(value)")]))
    sql, measures = _measures(doc, "rows_runs")
    page = _dash_page(agent_ns, [_kpi("SUM(value)")])
    rows = agent_ns["implement_dashboard_dataset_sql"](page, "rows", shell_sql)
    assert sql == shell_sql.runs_compare_sql(rows, RESULT, COLUMNS)
    assert sql.count(f"FROM {shell_sql.RUNS_CTE} AS o") == 1 and sql.count("ROW_NUMBER() OVER (ORDER BY `_inspire_ran` DESC)") == 1
    assert shell_sql.previous_rows(dict(page, result_table=RESULT), "rows", COLUMNS) == shell_sql.runs_compare_sql(ROWS_SQL, RESULT, COLUMNS, (1,))
    now = shell_sql.run_measure("SUM(value)", shell_sql.RUN_LATEST)
    assert measures == {"kpi_0_m0": now, "kpi_0_m1": shell_sql.change_text_sql(now, shell_sql.previous_run_measure("SUM(value)"))}
    assert shell_sql.previous_run_measure("SUM(value)") == shell_sql.previous_value(shell_sql.run_measure("SUM(value)", shell_sql.RUN_PREVIOUS),
                                                            shell_sql.run_measure("COUNT(*)", shell_sql.RUN_PREVIOUS))
    assert not hasattr(shell_sql, "run_expression") and not hasattr(shell_sql, "previous_run_expression"), "the column rewrite is gone"


def test_each_aggregate_reads_only_its_own_run_never_each_column():
    previous = shell_sql.RUN_PREVIOUS
    side = "CASE WHEN `_inspire_run` = 'previous' THEN"
    assert shell_sql.run_measure("100 * AVG(CASE WHEN value > 2 THEN 1 ELSE 0 END)", previous) == \
        f"100 * AVG({side} CASE WHEN value > 2 THEN 1 ELSE 0 END END)"
    assert shell_sql.run_measure("COUNT(*)", previous) == f"COUNT({side} 1 END)"
    assert shell_sql.run_measure("count(DISTINCT a, b)", previous) == f"count(DISTINCT {side} a END, {side} b END)"
    assert shell_sql.run_measure("percentile(value, 0.9)", previous) == f"percentile({side} value END, 0.9)", "the share is not a column"
    assert shell_sql.run_measure("approx_percentile(value, 0.5, 100)", previous) == f"approx_percentile({side} value END, 0.5, 100)"
    assert shell_sql.run_measure("percentile_cont(0.5) WITHIN GROUP (ORDER BY value DESC)", previous) == \
        f"percentile_cont(0.5) WITHIN GROUP (ORDER BY {side} value END DESC)"
    assert shell_sql.run_measure("ROUND(SUM(a) / NULLIF(SUM(`b c`), 0), 2)", previous) == \
        f"ROUND(SUM({side} a END) / NULLIF(SUM({side} `b c` END), 0), 2)"
    assert shell_sql.run_measure("CASE WHEN SUM(b) = 0 THEN NULL ELSE SUM(a) END", shell_sql.RUN_LATEST) == \
        "CASE WHEN SUM(CASE WHEN `_inspire_run` = 'latest' THEN b END) = 0 THEN NULL ELSE SUM(CASE WHEN `_inspire_run` = 'latest' THEN a END) END"
    assert shell_sql.run_measure("SUM(note = 'value IS NULL, ELSE 0')", previous) == f"SUM({side} note = 'value IS NULL, ELSE 0' END)"


@pytest.mark.parametrize("expression,said", [
    ("value", "the column value sits outside an aggregate"),
    ("value + SUM(bonus)", "the column value sits outside an aggregate"),
    ("`odd` * COUNT(*)", "the column `odd` sits outside an aggregate"),
    ("SUM(value) OVER (PARTITION BY category)", "SUM( ) OVER is a window or a filter it cannot split by run"),
    ("first(value)", "first( ) is not an aggregate it can split by run"),
    ("collect_set(value)", "collect_set( ) is not an aggregate it can split by run"),
    ("SUM(MAX(value))", "it puts MAX( ) inside SUM( )"),
    ("100", "it holds no aggregate such as SUM, COUNT or AVG"),
    ("percentile_cont(0.5)", "PERCENTILE_CONT( ) reads no column it can split by run"),
    ("SUM(*)", "SUM( ) has an argument it cannot read"),
])
def test_a_formula_the_dashboard_cannot_split_by_run_is_refused_never_guessed(expression, said):
    with pytest.raises(ValueError, match=re.escape(said)):
        shell_sql.run_measure(expression, shell_sql.RUN_PREVIOUS)
    with pytest.raises(ValueError, match="a run is latest or previous"):
        shell_sql.run_measure("SUM(value)", "older")


def test_the_page_spec_refuses_compare_on_a_formula_no_run_can_split():
    from v172_app_kpi_previous_run_test import _page as tile_page
    page = tile_page()
    page["kpis"].append({"id": "firsts", "label": "Firsts", "dataset": "records", "expression": "first(value)", "format": "number",
                         "good": "up", "compare": True})
    problems = shell_sql.spec_problems(page)
    assert ("KPI firsts compares with the previous run, but first( ) is not an aggregate it can split by run; write it so every "
            "column sits inside an aggregate such as SUM, COUNT, AVG, MIN or MAX, or set no compare") in problems
    page["kpis"][-1].pop("compare")
    assert not [p for p in shell_sql.spec_problems(page) if p.startswith("KPI firsts")], "without compare the formula is the KPI's own"


@pytest.mark.parametrize("compare", [True, False])
def test_a_windowed_kpi_is_refused_once_as_a_value_for_every_row_whether_or_not_it_compares(compare):
    from v172_app_kpi_previous_run_test import _page as tile_page
    page = tile_page()
    page["kpis"].append({"id": "windowed", "label": "Windowed", "dataset": "records", "expression": "SUM(value) OVER ()", "format": "number",
                         "good": "up", **({"compare": True} if compare else {})})
    assert [p for p in shell_sql.spec_problems(page) if p.startswith("KPI windowed")] == [
        "KPI windowed expression is a window function (OVER), so it gives a value for every row; write one aggregate expression over the "
        "dataset's columns"]


def test_the_dashboard_compares_only_the_kpis_the_page_spec_compares(agent_ns):
    page = _dash_page(agent_ns, [_kpi("SUM(value)", "compared"), _kpi("COUNT(*)", "plain", compare=False)])
    doc = _build(agent_ns, page)
    counters = _counters(doc)
    compared, plain = counters["kpi_0"], counters["kpi_1"]
    assert compared["queries"][0]["query"]["datasetName"] == "rows_runs" and set(compared["spec"]["encodings"]) == {"value", "target"}
    assert plain["queries"][0]["query"]["datasetName"] == "rows" and set(plain["spec"]["encodings"]) == {"value"}, \
        "a KPI the page spec does not compare gets no previous run, even over the result table"
    assert [d["name"] for d in doc["datasets"] if d["name"].endswith("_runs")] == ["rows_runs"]
    tile = shell_sql.kpi_query(page, "plain", {}, shell_sql.previous_rows(dict(page, result_table=RESULT), "rows", COLUMNS))[0]
    assert "'before'" not in tile, "the App tile does not compare it either"
    assert "'before'" in shell_sql.kpi_query(page, "compared", {}, shell_sql.previous_rows(dict(page, result_table=RESULT), "rows", COLUMNS))[0]
    assert agent_ns["check_dashboard_definition"](json.loads(json.dumps(doc)), [RESULT, "main.s.orders"], shell_sql.RECORDS_DATASET)[1] == []


def test_the_dashboard_and_the_app_say_the_same_words_from_shell_sql(agent_ns):
    words = shell_sql.CHANGE_WORDS
    assert words == {"same": "unchanged", "from_zero": "from 0", "none": "No earlier run to compare",
                     "story_none": "with no earlier run to compare"} and shell_sql.COMPARE_RUN == "vs previous run"
    assert not os.path.exists(os.path.join(WEB, "src", "compare.json")), "no second copy of the words in the web"
    page = _dash_page(agent_ns, [_kpi("SUM(value)", "compared", caption="from the latest run."), _kpi("COUNT(*)", "plain", compare=False)])
    counters = _counters(_build(agent_ns, page))
    assert counters["kpi_0"]["spec"]["frame"]["description"] == "from the latest run.", \
        "the change and its words are the counter's target, empty until a previous run exists, so the description claims nothing"
    assert "showDescription" not in counters["kpi_1"]["spec"]["frame"]
    assert _counters(_build(agent_ns, page, None))["kpi_0"]["spec"]["frame"]["description"] == "from the latest run.", \
        "a result table whose columns could not be read claims nothing about earlier runs"
    texts = {name: open(os.path.join(WEB, "src", name), encoding="utf-8").read() for name in ("Kpis.jsx", "format.js", "alerts.js")}
    assert "kpi.words.story_none" in texts["format.js"] and "kpi.words.none" in texts["Kpis.jsx"] and "preview.words.none" in texts["alerts.js"]
    for text in texts.values():
        assert "compare.json" not in text
        for said in list(words.values()) + [shell_sql.COMPARE_RUN]:
            assert f"'{said}'" not in text and f">{said}<" not in text and f"> {said}" not in text, said
    notebook = open(os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb"), encoding="utf-8").read()
    for stale in ("Against the run before the latest one", "IMPLEMENT_APP_NO_EARLIER", "run_expression(", "implement_compare_words",
                  "IMPLEMENT_COMPARE_WORDS", "IMPLEMENT_DASHBOARD_COMPARED", "compare.json"):
        assert stale not in notebook, stale


def test_a_caption_stays_as_written_and_never_gains_the_no_earlier_run_words(agent_ns):
    none = shell_sql.CHANGE_WORDS["none"]
    for caption in ("Is it up?", "Watch this!", "Wait for it...", "from the latest run.", "Slots to stage"):
        page = _dash_page(agent_ns, [_kpi("SUM(value)", "compared", caption=caption)])
        for schema in (SCHEMA, [s for s in SCHEMA if s[0] != "run_id"], [], None):
            frame = _counters(_build(agent_ns, page, schema))["kpi_0"]["spec"]["frame"]
            assert frame["description"] == caption and none not in frame["description"], (caption, schema)


def test_the_words_travel_inside_shell_sql_so_the_embed_gate_names_their_drift(agent_ns):
    embed = _embed()
    expected, actual = embed.payload(static=False), embed.embedded()
    assert "compare" not in expected and "compare" not in actual
    assert "compare" not in agent_ns["implement_app_shell_payload"](agent_ns["inspire_notebook_asset"]("app_shell"))
    assert "CHANGE_WORDS = " in actual["files"]["shell_sql.py"]
    drifted = dict(actual, files=dict(actual["files"], **{"shell_sql.py": actual["files"]["shell_sql.py"].replace(
        shell_sql.CHANGE_WORDS["none"], "Nothing earlier")}))
    assert drifted["files"]["shell_sql.py"] != actual["files"]["shell_sql.py"]
    assert "shell_sql.py differs" in embed.differences(expected, drifted, static=False)
    assert embed.differences(expected, actual, static=False) == []
