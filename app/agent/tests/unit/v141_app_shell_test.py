"""The prebuilt Inspire App shell: page-spec validation, the dashboard quality gates, SQL composition, the REST client and the
request core, offline."""
import copy
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_db  # noqa: E402
import shell_sql  # noqa: E402

with open(os.path.join(ROOT, "agent", "app_shell", "example_page.json"), encoding="utf-8") as _handle:
    PAGE = json.load(_handle)

SETTINGS = {"version": 2, "title": "Pricing desk", "subtitle": "Built by Inspire", "style": "a", "layout": "sidebar", "auth": "sp",
            "theme": "light", "palette": "default", "options": {"modify": False, "replace_edits": False, "decisions": False},
            "genie": {"space_id": "01f0aa11bb22cc33", "title": "Pricing desk"}, "pages": ["n01_u05"], "built_at": "2026-10-26T10:00:00Z",
            "admin": "@".join(("owner", "example.com")), "jobs": {}}


def page(**changes):
    out = copy.deepcopy(PAGE)
    out.update(changes)
    return out


def chart(ident):
    return next(c for c in PAGE["charts"] if c["id"] == ident)


def with_chart(ident, **changes):
    out = page()
    for c in out["charts"]:
        if c["id"] == ident:
            c.update(changes)
    return out


def test_fixture_page_passes_spec_and_quality():
    assert shell_sql.spec_problems(PAGE) == []
    assert shell_sql.quality_problems(PAGE) == []


@pytest.mark.parametrize("sql, fragment", [
    ("DELETE FROM main.s.t", "start with SELECT"),
    ("SELECT * FROM main.s.t; DROP TABLE main.s.t", "more than one statement"),
    ("WITH x AS (SELECT 1) MERGE INTO t USING x ON 1=1", "uses MERGE"),
    ("SELECT * FROM t WHERE 1=1 /* ; */ UNION SELECT * FROM u; UPDATE t SET a = 1", "more than one statement"),
    ("", "has no SQL"),
])
def test_dataset_sql_rejects_writes_and_stacked_statements(sql, fragment):
    problems = shell_sql.dataset_sql_problems("trend", sql)
    assert any(fragment in p for p in problems), problems


def test_dataset_sql_ignores_keywords_inside_text_and_names():
    assert shell_sql.dataset_sql_problems("t", "SELECT 'delete; drop' AS note, `update` FROM main.s.t -- merge later") == []


@pytest.mark.parametrize("expression, fragment", [
    ("SUM(loss); DROP TABLE t", "separator"),
    ("(SELECT MAX(loss) FROM main.s.t)", "uses SELECT"),
    ("SUM(loss) -- hide", "comment"),
    ("SUM((loss)", "unbalanced"),
    ("", "no expression"),
])
def test_expression_problems(expression, fragment):
    assert any(fragment in p for p in shell_sql.expression_problems("KPI x", expression))


def test_additive_detection():
    assert shell_sql.is_additive("SUM(loss)")
    assert shell_sql.is_additive("count(DISTINCT item)")
    assert not shell_sql.is_additive("SUM(loss) / SUM(revenue)")
    assert not shell_sql.is_additive("AVG(loss)")


def test_summed_ratio_is_caught_with_and_without_backticks():
    assert shell_sql.summed_ratio_columns("SUM(margin_pct)") == ["margin_pct"]
    assert shell_sql.summed_ratio_columns("SUM(`avg_price`)") == ["avg_price"]
    assert shell_sql.summed_ratio_columns("SUM(loss) / SUM(revenue)") == []
    bad = page()
    bad["kpis"][0]["expression"] = "SUM(`loss_rate`)"
    assert any("sums loss_rate" in p for p in shell_sql.quality_problems(bad))


def test_quality_gates_fire_on_bad_shapes():
    assert any("must be one SUM or COUNT" in p for p in shell_sql.quality_problems(
        with_chart("channel_mix", y=[{"label": "Avg", "expression": "AVG(loss)", "format": "number"}])))
    line_on_categories = with_chart("loss_trend", x={"column": "category", "kind": "category"})
    assert any("its x must be time" in p for p in shell_sql.quality_problems(line_on_categories))
    assert any("largest first" in p for p in shell_sql.quality_problems(with_chart("pareto", sort="value_asc")))
    assert any("natural order" in p for p in shell_sql.quality_problems(with_chart("by_category", sort="x_asc")))
    ordered = with_chart("by_category", sort="x_asc", x={"column": "category", "kind": "category", "ordered": True})
    assert not any("natural order" in p for p in shell_sql.quality_problems(ordered))


def test_quality_needs_run_date_three_segments_and_full_coverage():
    two_segments = page(filters=[f for f in PAGE["filters"] if f["id"] != "region"])
    assert any("2 segment filters" in p for p in shell_sql.quality_problems(two_segments))
    no_run_date = page()
    no_run_date["filters"][0]["columns"] = {"trend": "month", "records": "month"}
    assert any("as_of_date" in p for p in shell_sql.quality_problems(no_run_date))
    assert any("second date range" in p for p in shell_sql.quality_problems(PAGE, event_date=True))
    uncovered = page()
    uncovered["datasets"].append({"name": "extra", "sql": "SELECT 1 AS n"})
    uncovered["kpis"].append({"id": "extra_n", "label": "Extra", "dataset": "extra", "expression": "SUM(n)"})
    assert any("no filter reaches KPI extra_n" in p for p in shell_sql.quality_problems(uncovered))


def test_a_dataset_filtered_by_the_run_date_and_the_event_date_passes_and_both_ranges_apply():
    sale_date = {"id": "sale_date", "type": "date_range", "label": "Sale date", "grain": "month", "default": "12m",
                 "columns": {"trend": "month", "records": "sale_date"}}
    two = page(filters=PAGE["filters"] + [sale_date])
    assert shell_sql.spec_problems(two) == []
    assert shell_sql.quality_problems(two, event_date=True) == []
    values = {"run_date": {"from": "2026-01-01", "to": "2026-06-30"}, "sale_date": {"from": "2025-01-01", "to": "2025-12-31"}}
    sql, params = shell_sql.records_query(two, values)
    assert sql.count("BETWEEN") == 2
    assert [p["value"] for p in params] == ["2026-01-01", "2026-06-30", "2025-01-01", "2025-12-31"]
    kpi, kpi_params = shell_sql.kpi_query(two, "items", values, "SELECT * FROM main.pricing.loss_desk_out")
    now, before = kpi.split(" UNION ALL ")
    assert (now.count("BETWEEN"), before.count("BETWEEN"), len(kpi_params)) == (2, 2, 4), "the previous run reads both ranges as they are"
    event_first = page(filters=[sale_date] + PAGE["filters"])
    assert any("first date range" in p for p in shell_sql.quality_problems(event_first, event_date=True))


def test_the_scatter_heatmap_and_donut_shapes_the_app_prompt_describes_pass_the_shell():
    money = {"format": "currency", "currency": "USD"}
    shapes = [
        {"id": "loss_vs_items", "type": "scatter", "title": "Loss against items", "hint": "Where the loss sits", "dataset": "trend", "group": "category",
         "x": {"label": "Items", "expression": "COUNT(*)"}, "y": [dict(money, label="Loss", expression="SUM(loss)")]},
        {"id": "loss_grid", "type": "heatmap", "title": "Loss by category and channel", "hint": "Where the loss sits", "dataset": "trend",
         "x": {"column": "category", "kind": "category", "label": "Category"}, "series": {"column": "channel", "top": 4},
         "y": [dict(money, label="Loss", expression="SUM(loss)")]},
        {"id": "loss_share", "type": "donut", "title": "Loss share by channel", "hint": "Where the loss sits", "dataset": "trend",
         "x": {"column": "channel", "kind": "category", "label": "Channel"}, "y": [dict(money, label="Loss", expression="SUM(loss)")]},
    ]
    shaped = page(charts=PAGE["charts"][:2] + shapes)
    assert shell_sql.spec_problems(shaped) == []
    assert shell_sql.quality_problems(shaped) == []
    guessed = copy.deepcopy(shaped)
    guessed["charts"][2]["group"] = {"column": "category"}
    assert any("needs a group column" in p for p in shell_sql.spec_problems(guessed))


TABLE = {"id": "worst", "title": "Worst categories", "dataset": "trend", "columns": [{"column": "category", "label": "Category"}]}


NOT_WHOLE = ["ten", "4", 4.5, True, [4], None, 0]


@pytest.mark.parametrize("value,ok", [(4, True), (1, True), (8, True), (9, False), (10, False)] + [(v, False) for v in NOT_WHOLE])
def test_a_series_top_must_be_a_whole_number_from_1_to_8(value, ok):
    top = shell_sql.spec_problems(with_chart("channel_mix", series={"column": "channel", "top": value}))
    assert any("series top must be a whole number from 1 to 8" in p for p in top) is not ok


@pytest.mark.parametrize("value,ok", [(1, True), (10, True), (500, True), (501, False)] + [(v, False) for v in NOT_WHOLE])
def test_a_chart_limit_must_be_a_whole_number_from_1_to_500(value, ok):
    charted = shell_sql.spec_problems(with_chart("by_category", limit=value))
    assert any("chart by_category limit must be a whole number from 1 to 500" in p for p in charted) is not ok


@pytest.mark.parametrize("value,ok", [(1, True), (50, True), (5000, True), (5001, False)] + [(v, False) for v in NOT_WHOLE])
def test_a_table_limit_must_be_a_whole_number_from_1_to_5000(value, ok):
    assert shell_sql.spec_problems(page(tables=[TABLE])) == []
    tabled = shell_sql.spec_problems(page(tables=[dict(TABLE, limit=value)]))
    assert any("table worst limit must be a whole number from 1 to 5,000" in p for p in tabled) is not ok


def test_spec_problems_catch_structure_errors():
    assert any("3 to 6" in p for p in shell_sql.spec_problems(page(kpis=PAGE["kpis"][:2])))
    assert not any("date range" in p for p in shell_sql.spec_problems(page(filters=PAGE["filters"] + [
        {"id": "event", "type": "date_range", "label": "Event", "columns": {"trend": "month"}}])))
    assert any("needs a series column" in p for p in shell_sql.spec_problems(with_chart("channel_mix", series=None)))
    assert any("cannot split into series" in p for p in shell_sql.spec_problems(with_chart("pareto", series={"column": "channel"})))
    assert any("ISO 4217 currency code" in p for p in shell_sql.spec_problems(with_chart("loss_trend", y=[
        {"label": "Loss", "expression": "SUM(loss)", "format": "currency"}])))
    assert any("records section" in p for p in shell_sql.spec_problems(page(records=None)))
    no_records = page(records=PAGE["records"], datasets=PAGE["datasets"][:1])
    assert any("no dataset named records" in p for p in shell_sql.spec_problems(no_records))
    assert any("icon must be" in p for p in shell_sql.spec_problems(page(icon="rocket")))
    assert shell_sql.spec_problems("not a page") == ["the page spec is not a JSON object"]


def test_quote_rejects_injection():
    assert shell_sql.quote("loss") == "`loss`"
    with pytest.raises(ValueError):
        shell_sql.quote("loss` FROM t; --")


def test_filter_values_problems():
    assert shell_sql.filter_values_problems(PAGE, {"nope": ["x"]}) == ["the page has no filter 'nope'"]
    assert any("YYYY-MM-DD" in p for p in shell_sql.filter_values_problems(PAGE, {"run_date": {"from": "2026-13", "to": "2026-10-01"}}))
    assert any("at most 200" in p for p in shell_sql.filter_values_problems(PAGE, {"category": [str(i) for i in range(201)]}))
    assert any("text of at most" in p for p in shell_sql.filter_values_problems(PAGE, {"category": [1]}))
    assert shell_sql.filter_values_problems(PAGE, {"category": [], "run_date": {"from": "2026-01-01", "to": "2026-10-01"}}) == []


def test_presets():
    presets = {p["id"]: p for p in shell_sql.preset_ranges("month", "2024-02-10", "2026-10-15")}
    assert presets["3m"] == {"id": "3m", "label": "Last 3 months", "from": "2026-08-01", "to": "2026-10-15"}
    assert presets["all"]["from"] == "2024-02-10"
    assert shell_sql.preset_ranges("month", "2026-09-20", "2026-10-15")[1]["from"] == "2026-09-20"
    days = {p["id"]: p for p in shell_sql.preset_ranges("day", "2020-01-01", "2026-10-15")}
    assert days["3m"]["from"] == "2026-07-16"
    assert shell_sql.add_months(shell_sql._date("2026-03-31"), -1).isoformat() == "2026-02-28"
    assert shell_sql.preset_ranges("month", None, "2026-10-15") == []


def test_values_never_reach_sql_text():
    hostile = "x') OR 1=1 --"
    values = {"category": [hostile], "run_date": {"from": "2026-01-01", "to": "2026-06-30"}}
    for _kind, _ident, sql, params in shell_sql.page_queries(PAGE, values):
        assert hostile not in sql
        assert ":p0" in sql
    sql, params = shell_sql.kpi_query(PAGE, "items", values, "SELECT * FROM main.pricing.loss_desk_out")
    assert "UNION ALL SELECT 'before'" in sql and hostile not in sql
    assert [p["value"] for p in params] == ["2026-01-01", "2026-06-30", hostile], "both sides share the filters' parameters"
    assert {p["type"] for p in params[:2]} == {"DATE"}


def test_kpi_without_a_previous_run_has_no_compare():
    sql, params = shell_sql.kpi_query(PAGE, "items", {})
    assert "'before'" not in sql and params == []
    sql, params = shell_sql.kpi_query(PAGE, "total_loss", {}, "SELECT * FROM main.pricing.loss_trend")
    assert "'before'" not in sql, "a KPI that does not compare never gets a previous value"


def test_chart_queries_group_by_real_columns():
    sql, _ = shell_sql.chart_query(PAGE, "channel_mix", {})
    assert "GROUP BY `month`, `channel`" in sql and "ORDER BY 1 ASC LIMIT 5000" in sql
    sql, _ = shell_sql.chart_query(PAGE, "by_category", {})
    assert "GROUP BY `category` ORDER BY 2 DESC NULLS LAST LIMIT 10" in sql
    sql, _ = shell_sql.chart_query(PAGE, "pareto", {})
    assert "SUM(y0) OVER () AS total" in sql and sql.endswith("ORDER BY y0 DESC NULLS LAST LIMIT 20")


def test_records_options_bounds_and_defaults():
    sql, _ = shell_sql.records_query(PAGE, {})
    assert sql.endswith("ORDER BY `rank` ASC NULLS LAST LIMIT 5000")
    sql, _ = shell_sql.options_query(PAGE, "category")
    assert " UNION " not in sql and "main.pricing.loss_trend" not in sql and "LIMIT 500" in sql
    sql, _ = shell_sql.bounds_query(PAGE, "run_date")
    assert "low_0 AS low" in sql and "MIN(CAST(`as_of_date` AS DATE))" in sql
    assert shell_sql.default_values(PAGE, {"run_date": ("2024-01-05", "2026-10-15")}) == {
        "run_date": {"from": "2025-11-01", "to": "2026-10-15"}}
    assert shell_sql.default_values(PAGE, {}) == {}
    kinds = [q[0] for q in shell_sql.page_queries(PAGE, {})]
    assert kinds.count("kpi") == 3 and kinds.count("chart") == 4 and "records" not in kinds


class FakeResponse:
    def __init__(self, status=200, payload=None, text=None):
        self.status_code = status
        self._payload = payload
        self.text = text if text is not None else json.dumps(payload or {})
        self.content = self.text.encode()

    def json(self):
        if self._payload is None:
            raise ValueError("not json")
        return self._payload


class FakeSession:
    def __init__(self, answers):
        self.answers, self.calls = list(answers), []

    def request(self, method, url, headers=None, params=None, data=None, timeout=None):
        self.calls.append({"method": method, "url": url, "headers": headers, "body": json.loads(data) if data else None})
        answer = self.answers.pop(0)
        if isinstance(answer, Exception):
            raise answer
        return answer


def workspace(answers, clock=None):
    session = FakeSession(answers)
    ws = shell_db.Workspace("dbc-1.example.com", lambda: {"Authorization": "Bearer t"}, session=session, sleep=lambda s: None,
                            clock=clock or (lambda: 0))
    return ws, session


MANIFEST = {"schema": {"columns": [{"name": "x", "type_name": "DATE"}, {"name": "y0", "type_name": "DECIMAL"},
                                   {"name": "n", "type_name": "LONG"}, {"name": "tags", "type_name": "ARRAY"},
                                   {"name": "ok", "type_name": "BOOLEAN"}]}, "total_row_count": 2}


def test_run_sql_polls_parses_and_follows_chunks():
    ws, session = workspace([
        FakeResponse(payload={"statement_id": "s1", "status": {"state": "PENDING"}}),
        FakeResponse(payload={"statement_id": "s1", "status": {"state": "SUCCEEDED"}, "manifest": MANIFEST,
                              "result": {"data_array": [["2026-01-01", "12.5", "3", "[\"a\"]", "true"]], "next_chunk_internal_link": "/next"}}),
        FakeResponse(payload={"data_array": [["2026-02-01", None, "4", "[]", "false"]]}),
    ])
    out = ws.run_sql("wh", "SELECT 1", [{"name": "p0", "value": "a", "type": "STRING"}], limit=10)
    assert session.calls[0]["url"] == "https://dbc-1.example.com/api/2.0/sql/statements"
    assert session.calls[0]["body"]["row_limit"] == 11 and session.calls[0]["body"]["parameters"][0]["name"] == "p0"
    assert out["rows"] == [{"x": "2026-01-01", "y0": 12.5, "n": 3, "tags": ["a"], "ok": True},
                           {"x": "2026-02-01", "y0": None, "n": 4, "tags": [], "ok": False}]
    assert out["truncated"] is False


def test_run_sql_marks_truncation_and_raises_on_failure_and_deadline():
    ws, _ = workspace([FakeResponse(payload={"status": {"state": "SUCCEEDED"}, "manifest": MANIFEST,
                                             "result": {"data_array": [["2026-01-01", "1", "1", "[]", "true"]] * 3}})])
    assert ws.run_sql("wh", "SELECT 1", limit=2)["truncated"] is True
    ws, _ = workspace([FakeResponse(payload={"status": {"state": "FAILED", "error": {"message": "TABLE_OR_VIEW_NOT_FOUND"}}})])
    with pytest.raises(shell_db.QueryError, match="TABLE_OR_VIEW_NOT_FOUND"):
        ws.run_sql("wh", "SELECT 1")
    ticks = iter([0, 300, 300])
    ws, session = workspace([FakeResponse(payload={"statement_id": "s9", "status": {"state": "RUNNING"}}), FakeResponse(payload={})],
                            clock=lambda: next(ticks))
    with pytest.raises(shell_db.QueryError, match="longer than 240 seconds"):
        ws.run_sql("wh", "SELECT 1")
    assert session.calls[-1]["url"].endswith("/statements/s9/cancel")


CONFLICT = "[DELTA_CONCURRENT_APPEND.WITH_PARTITION_HINT] ConcurrentAppendException: Files were added by a concurrent update."


def test_run_sql_sends_a_write_again_when_delta_rejects_it_for_a_concurrent_change():
    waits = []
    session = FakeSession([FakeResponse(payload={"status": {"state": "FAILED", "error": {"message": CONFLICT}}}),
                           FakeResponse(payload={"status": {"state": "FAILED", "error": {"message": CONFLICT}}}),
                           FakeResponse(payload={"status": {"state": "SUCCEEDED"}, "manifest": {"schema": {"columns": [
                               {"name": "num_affected_rows", "type_name": "LONG"}]}}, "result": {"data_array": [["1"]]}})])
    ws = shell_db.Workspace("dbc-1.example.com", lambda: {}, session=session, sleep=waits.append, clock=lambda: 0)
    sql = "UPDATE `c`.`s`.`alerts` SET acknowledged_by = :p0 WHERE alert_id = :p1"
    assert ws.run_sql("wh", sql)["rows"] == [{"num_affected_rows": 1}]
    assert [c["body"]["statement"] for c in session.calls] == [sql, sql, sql]
    assert len(waits) == 2 and waits[0] < waits[1]
    stuck = FakeSession([FakeResponse(payload={"status": {"state": "FAILED", "error": {"message": CONFLICT}}})] * 9)
    with pytest.raises(shell_db.QueryError, match="DELTA_CONCURRENT_APPEND"):
        shell_db.Workspace("dbc-1.example.com", lambda: {}, session=stuck, sleep=lambda s: None, clock=lambda: 0).run_sql("wh", sql)
    assert len(stuck.calls) == shell_db.CONFLICT_ATTEMPTS == 8
    waits = []
    stuck = FakeSession([FakeResponse(payload={"status": {"state": "FAILED", "error": {"message": CONFLICT}}})] * 9)
    with pytest.raises(shell_db.QueryError, match="DELTA_CONCURRENT_APPEND"):
        shell_db.Workspace("dbc-1.example.com", lambda: {}, session=stuck, sleep=waits.append, clock=lambda: 0).run_sql("wh", sql)
    for attempt, wait in enumerate(waits, start=1):
        ceiling = min(shell_db.CONFLICT_MAX_DELAY_S, shell_db.CONFLICT_BASE_DELAY_S * 2 ** (attempt - 1))
        assert ceiling <= wait <= 2 * ceiling
    assert 30 <= sum(waits) <= 2 * shell_db.CONFLICT_WINDOW_S
    other = FakeSession([FakeResponse(payload={"status": {"state": "FAILED", "error": {"message": "MAXIMUM_CONCURRENT_RUNS_REACHED"}}})])
    with pytest.raises(shell_db.QueryError, match="MAXIMUM_CONCURRENT_RUNS_REACHED"):
        shell_db.Workspace("dbc-1.example.com", lambda: {}, session=other, sleep=lambda s: None, clock=lambda: 0).run_sql("wh", sql)
    assert len(other.calls) == 1
    assert not hasattr(shell_sql, "CONCURRENT")


def test_call_wraps_http_network_and_non_json_errors():
    ws, _ = workspace([FakeResponse(403, {"message": "no access"})])
    with pytest.raises(shell_db.QueryError, match="HTTP 403: no access"):
        ws.call("GET", "/api/x")
    ws, _ = workspace([ConnectionError("reset")])
    with pytest.raises(shell_db.QueryError, match="did not answer"):
        ws.call("GET", "/api/x")
    ws, _ = workspace([FakeResponse(200, None, text="<html>")])
    with pytest.raises(shell_db.QueryError, match="other than JSON"):
        ws.call("GET", "/api/x")


def test_genie_ask_and_message_states():
    ws, session = workspace([FakeResponse(payload={"conversation_id": "c1", "message_id": "m1"})])
    assert ws.genie_ask("sp1", "why?") == {"conversation_id": "c1", "message_id": "m1"}
    assert session.calls[0]["url"].endswith("/genie/spaces/sp1/start-conversation")
    ws, _ = workspace([FakeResponse(payload={"status": "ASKING_AI"})])
    assert ws.genie_message("sp1", "c1", "m1") == {"state": "running", "step": "Writing the SQL"}
    ws, _ = workspace([FakeResponse(payload={"status": "FAILED", "error": {"error": "no warehouse"}})])
    assert ws.genie_message("sp1", "c1", "m1") == {"state": "failed", "error": "no warehouse"}
    done = {"status": "COMPLETED", "attachments": [{"text": {"content": "Books lost the most."}},
                                                    {"attachment_id": "a1", "query": {"query": "SELECT 1", "description": "Loss by category"}}]}
    result = {"statement_response": {"manifest": MANIFEST, "result": {"data_array": [["2026-01-01", "2", "1", "[]", "true"]]}}}
    ws, session = workspace([FakeResponse(payload=done), FakeResponse(payload=result)])
    out = ws.genie_message("sp1", "c1", "m1")
    assert out["text"] == "Books lost the most." and out["sql"] == "SELECT 1" and out["rows"][0]["y0"] == 2.0
    assert session.calls[1]["url"].endswith("/messages/m1/attachments/a1/query-result")
    ws, _ = workspace([FakeResponse(payload=done), FakeResponse(410, {"message": "expired"})])
    out = ws.genie_message("sp1", "c1", "m1")
    assert out["state"] == "done" and "expired" in out["result_error"] and out["rows"] == []


class FakeWorkspace:
    def __init__(self):
        self.sql, self.genie = [], []

    def run_sql(self, warehouse, sql, params, limit=5000):
        self.sql.append((sql, params, limit))
        if "low_0 AS low" in sql:
            return {"columns": [], "rows": [{"low": "2024-01-05", "high": "2026-10-15"}], "truncated": False}
        if sql.startswith("SELECT v FROM"):
            return {"columns": [], "rows": [{"v": "Books"}, {"v": "Music"}], "truncated": False}
        if "'now' AS period" in sql:
            rows = [{"period": "now", "value": 120.0}] + ([{"period": "before", "value": 100.0}] if "'before'" in sql else [])
            return {"columns": [], "rows": rows, "truncated": False}
        if "ORDER BY `rank`" in sql and "boom" in json.dumps(params):
            raise shell_db.QueryError("warehouse stopped")
        if "ORDER BY `rank`" in sql:
            return {"columns": [{"name": "item", "type": "STRING"}], "rows": [{"item": "=HYPERLINK(\"x\")"}], "truncated": False}
        return {"columns": [{"name": "x", "type": "STRING"}, {"name": "y0", "type": "DOUBLE"}],
                "rows": [{"x": "Books", "y0": 5.0}, {"x": "Music", "y0": 3.0}], "truncated": False}

    def genie_ask(self, space, question, conversation=""):
        self.genie.append((space, question, conversation))
        return {"conversation_id": "c1", "message_id": "m1"}

    def genie_message(self, space, conversation, message, row_limit=50):
        self.genie.append((space, conversation, message, row_limit))
        return {"state": "done", "text": "ok", "columns": [{"name": "n", "type": "LONG"}], "rows": [{"n": 1}]}


def app_dir(tmp_path, settings=None, pages=None):
    settings = copy.deepcopy(settings or SETTINGS)
    (tmp_path / "pages").mkdir()
    for p in pages or [PAGE]:
        (tmp_path / "pages" / f"{p['id']}.json").write_text(json.dumps(p))
    (tmp_path / "inspire_app.json").write_text(json.dumps(settings))
    return str(tmp_path)


def shell(tmp_path, settings=None, pages=None):
    made = {"sp": 0, "user": []}
    sp_ws, user_ws = FakeWorkspace(), FakeWorkspace()

    def sp_factory():
        made["sp"] += 1
        return sp_ws

    def user_factory(host, token):
        made["user"].append((host, token))
        return user_ws

    s = shell_core.Shell(app_dir(tmp_path, settings, pages), env={"DATABRICKS_WAREHOUSE_ID": "wh1", "DATABRICKS_HOST": "dbc-1.example.com"},
                         sp_factory=sp_factory, user_factory=user_factory)
    return s, sp_ws, user_ws, made


def call(s, method, path, query=None, headers=None, body=None):
    return s.handle(method, path, query or {}, headers or {}, json.dumps(body).encode() if body is not None else b"")


def test_settings_problems():
    assert shell_core.settings_problems(SETTINGS, [PAGE]) == []
    user_decisions = dict(SETTINGS, auth="user", options=dict(SETTINGS["options"], decisions=True))
    assert shell_core.settings_problems(user_decisions, [PAGE]) == []
    user_alerts = dict(user_decisions, options=dict(user_decisions["options"], alerts=True), alert_folder="/Workspace/Shared/a")
    assert any("cannot send alerts" in p for p in shell_core.settings_problems(user_alerts, [PAGE]))
    assert any("genie_note" in p for p in shell_core.settings_problems(dict(SETTINGS, genie=None), [PAGE]))
    assert shell_core.settings_problems(dict(SETTINGS, genie=None, genie_note="The Genie Agent failed to build"), [PAGE]) == []
    assert any("every page id" in p for p in shell_core.settings_problems(dict(SETTINGS, pages=["other"]), [PAGE]))
    assert any("palette must be" in p for p in shell_core.settings_problems(dict(SETTINGS, palette="rainbow"), [PAGE]))
    broken = page(kpis=[])
    assert any(p.startswith("page n01_u05:") for p in shell_core.settings_problems(SETTINGS, [broken]))


def test_load_app_refuses_broken_files(tmp_path):
    with pytest.raises(ValueError, match="do not hold together"):
        shell_core.load_app(app_dir(tmp_path, dict(SETTINGS, style="z")))


def test_app_info_strips_sql_and_reports_options(tmp_path):
    s, _sp, _user, _made = shell(tmp_path)
    status, info = call(s, "GET", "app", headers={"x-forwarded-email": "a@example.com"})
    assert status == 200
    text = json.dumps(info)
    assert "SELECT" not in text and "SUM(" not in text and "main.pricing" not in text
    assert info["genie"]["url"] == "https://dbc-1.example.com/genie/rooms/01f0aa11bb22cc33"
    assert info["image_export"] is True and "download" not in info["options"]
    pg = info["pages"][0]
    assert pg["charts"][1]["click_filter"] == "category" and pg["records"]["filters"]["channel"] == "channel"
    assert pg["charts"][2]["series"] == {"top": 4}


def test_filters_and_page_data(tmp_path):
    s, sp_ws, _user, made = shell(tmp_path)
    status, out = call(s, "GET", "filters", query={"page": "n01_u05"})
    assert status == 200
    run_date = out["filters"][0]
    assert run_date["low"] == "2024-01-05" and run_date["presets"][2]["id"] == "12m"
    assert out["filters"][1]["options"] == ["Books", "Music"]
    values = {"run_date": {"from": "2026-01-01", "to": "2026-06-30"}, "category": ["Books"]}
    status, data = call(s, "POST", "page", body={"page": "n01_u05", "filters": values})
    assert status == 200 and data["errors"] == {}
    assert data["kpis"]["total_loss"] == {"now": 120.0, "before": None}, "no period before: only a compared KPI has an earlier value"
    assert data["kpis"]["items"] == {"now": 120.0, "before": None}, "a page with no result table has no previous run"
    assert data["charts"]["by_category"]["rows"] == [{"x": "Books", "y0": 5.0}, {"x": "Music", "y0": 3.0}]
    assert "records" not in data, "the decision list pages through POST /api/records, not the page data"
    assert made["sp"] == 1
    runs = len(sp_ws.sql)
    call(s, "POST", "page", body={"page": "n01_u05", "filters": values})
    assert len(sp_ws.sql) == runs


def test_page_errors_are_per_tile(tmp_path):
    s, _sp, _user, _made = shell(tmp_path)
    status, data = call(s, "POST", "page", body={"page": "n01_u05", "filters": {"category": ["boom"]}})
    assert status == 200 and data["errors"] == {}
    assert data["kpis"]["total_loss"]["now"] == 120.0
    status, out = call(s, "POST", "records", body={"page": "n01_u05", "filters": {"category": ["boom"]}})
    assert status == 502 and out == {"error": "warehouse stopped"}


def test_bad_requests(tmp_path):
    s, _sp, _user, _made = shell(tmp_path)
    assert call(s, "POST", "page", body={"page": "nope"})[0] == 404
    assert call(s, "POST", "page", body={"page": "n01_u05", "filters": {"zzz": ["a"]}})[0] == 400
    assert call(s, "GET", "secrets")[0] == 404
    assert s.handle("POST", "page", {}, {}, b"[1]")[0] == 400
    assert s.handle("POST", "page", {}, {}, b"{bad")[0] == 400
    assert s.handle("POST", "page", {}, {}, b" " * (shell_core.MAX_BODY + 1))[0] == 413


def test_user_mode_needs_a_token_and_separates_cache(tmp_path):
    settings = dict(SETTINGS, auth="user")
    s, sp_ws, user_ws, made = shell(tmp_path, settings)
    status, out = call(s, "POST", "page", body={"page": "n01_u05"})
    assert status == 401 and "sign in" in out["error"]
    body = {"page": "n01_u05", "filters": {}}
    assert call(s, "POST", "page", headers={"x-forwarded-access-token": "tok-a", "x-forwarded-email": "a@example.com"}, body=body)[0] == 200
    first = len(user_ws.sql)
    assert call(s, "POST", "page", headers={"x-forwarded-access-token": "tok-b", "x-forwarded-email": "b@example.com"}, body=body)[0] == 200
    assert len(user_ws.sql) == 2 * first
    assert made["sp"] == 0 and made["user"][0] == ("dbc-1.example.com", "tok-a")
    assert sp_ws.sql == []
    status, info = call(s, "GET", "app", headers={"x-forwarded-access-token": "tok-a"})
    assert info["image_export"] is False and "download" not in info["options"]


def test_the_server_offers_no_data_download_even_when_the_settings_are_forced(tmp_path):
    s, sp_ws, _user, _made = shell(tmp_path)
    for body in ({"page": "n01_u05", "kind": "records"}, {"page": "n01_u05", "kind": "chart", "id": "by_category"},
                 {"kind": "genie", "conversation_id": "c1", "message_id": "m1"}):
        assert call(s, "POST", "download", body=body) == (404, {"error": "no API route POST /api/download"})
    s.settings["options"] = dict(s.settings["options"], download=True)
    assert call(s, "POST", "download", body={"page": "n01_u05", "kind": "records"})[0] == 404
    assert sp_ws.sql == [] and sp_ws.genie == []


def test_lists_and_objects_read_as_text_and_no_csv_writer_is_left():
    assert shell_core.plain_text(["Late delivery", "Price rise", None]) == "Late delivery · Price rise"
    assert shell_core.plain_text({"store": "North", "units": 12}) == "store: North · units: 12"
    assert [name for name in ("csv_text", "csv_cell", "FORMULA_START") if hasattr(shell_core, name)] == []
    assert not hasattr(shell_core.Shell, "download")


def test_genie_routes_validate_ids_and_respect_off(tmp_path):
    s, sp_ws, _user, _made = shell(tmp_path)
    status, out = call(s, "POST", "genie/ask", body={"question": "Which category lost most?"})
    assert status == 200 and out == {"conversation_id": "c1", "message_id": "m1"}
    assert call(s, "POST", "genie/ask", body={"question": ""})[0] == 400
    assert call(s, "POST", "genie/ask", body={"question": "x" * 1001})[0] == 400
    assert call(s, "POST", "genie/ask", body={"question": "q", "conversation_id": "../../api/2.0/secrets"})[0] == 400
    assert call(s, "GET", "genie/message", query={"conversation_id": "c1", "message_id": "m1/../../x"})[0] == 400
    status, msg = call(s, "GET", "genie/message", query={"conversation_id": "c1", "message_id": "m1"})
    assert status == 200 and "downloadable" not in msg and sp_ws.genie[-1][-1] == shell_core.GENIE_PREVIEW_ROWS
    off = dict(SETTINGS, genie=None, genie_note="The Genie Agent did not build: the warehouse was stopped")
    (tmp_path / "off").mkdir()
    s, _sp, _user, _made = shell(tmp_path / "off", off)
    status, out = call(s, "POST", "genie/ask", body={"question": "q"})
    assert status == 409 and "warehouse was stopped" in out["error"]
    assert call(s, "GET", "app")[1]["genie"] == {"enabled": False, "title": "", "url": "", "note": off["genie_note"]}


def test_missing_warehouse_is_a_clear_error(tmp_path):
    s = shell_core.Shell(app_dir(tmp_path), env={}, sp_factory=FakeWorkspace, user_factory=lambda h, t: FakeWorkspace())
    status, out = call(s, "POST", "page", body={"page": "n01_u05"})
    assert status == 200 and all("no SQL warehouse" in m for m in out["errors"].values()) and out["errors"]


def test_cache_expires_and_evicts():
    now = [0.0]
    cache = shell_core.Cache(entries=4, clock=lambda: now[0])
    for i in range(4):
        cache.put(i, i, ttl=10)
    cache.put("new", 1, ttl=10)
    assert len(cache.items) == 4 and cache.get("new") == 1
    now[0] = 11
    assert cache.get("new") is None


class ShapedWorkspace(FakeWorkspace):
    def __init__(self, shape):
        super().__init__()
        self.shape = shape

    def run_sql(self, warehouse, sql, params, limit=5000):
        out = super().run_sql(warehouse, sql, params, limit)
        change = self.shape(sql)
        if isinstance(change, Exception):
            raise change
        return dict(out, rows=change) if change is not None else out


def checked(tmp_path, shape):
    ws = ShapedWorkspace(shape)
    s = shell_core.Shell(app_dir(tmp_path), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws,
                         user_factory=lambda h, t: ws)
    return s.check({}), ws


def test_check_runs_every_query_at_the_default_filters(tmp_path):
    problems, ws = checked(tmp_path, lambda sql: None)
    assert problems == []
    page_sql = [(sql, params) for sql, params, _ in ws.sql
                if "low_0 AS low" not in sql and not sql.startswith("SELECT v FROM") and not sql.endswith("LIMIT 0")]
    assert len(page_sql) == len(shell_sql.page_queries(PAGE, {})) + 3, "the list rows, its count and its key count run too"
    assert all("2025-11-01" in json.dumps(params) and "2026-10-15" in json.dumps(params) for _sql, params in page_sql)


def test_check_names_every_broken_or_empty_tile(tmp_path):
    def shape(sql):
        if "low_0 AS low" in sql:
            return None
        if sql.startswith("SELECT v FROM"):
            return []
        if "'now' AS period" in sql:
            return []
        if "ORDER BY `rank`" in sql:
            return shell_db.QueryError("TABLE_OR_VIEW_NOT_FOUND")
        return []

    problems, _ws = checked(tmp_path, shape)
    for f in ("category", "channel", "region"):
        assert f"page n01_u05: filter {f} found no values to pick" in problems
    for k in ("total_loss", "loss_rate", "items"):
        assert f"page n01_u05: KPI {k} has no value at the default filters" in problems
    for c in ("loss_trend", "by_category", "channel_mix", "pareto"):
        assert f"page n01_u05: chart {c} returned no rows at the default filters" in problems
    assert "page n01_u05: records:records failed: TABLE_OR_VIEW_NOT_FOUND" in problems
    assert not any("decision list returned no rows" in p for p in problems)
    assert len(problems) == 11


def test_check_sends_back_a_chart_that_draws_one_group(tmp_path):
    def shape(sql):
        if "`channel`" in sql and "GROUP BY" in sql and "low_0 AS low" not in sql:
            return [{"x": "Web", "y0": 9.0}]
        return None

    problems, _ws = checked(tmp_path, shape)
    one = [p for p in problems if "draws one group" in p]
    assert one and all(p.startswith("page n01_u05: chart ") and "chart a column with 2 or more values" in p for p in one)
    assert len(one) == len(problems)


class TypedWorkspace(ShapedWorkspace):
    def __init__(self, shape, columns):
        super().__init__(shape)
        self.columns = columns

    def run_sql(self, warehouse, sql, params, limit=5000):
        out = super().run_sql(warehouse, sql, params, limit)
        return dict(out, columns=self.columns) if self.shape(sql) is not None else out


def _by_category(sql):
    return "`category`" in sql and "GROUP BY" in sql and "low_0 AS low" not in sql and "SUM(y0) OVER" not in sql


@pytest.mark.parametrize("y0_type, values, refused", [
    ("DATE", ["2026-03-01", "2026-04-01"], True),
    ("TIMESTAMP", ["2026-03-01T08:00:00.000Z", "2026-04-01T08:00:00.000Z"], True),
    (None, ["2026-03-01", "2026-04-01"], True),
    ("DOUBLE", [5.0, 3.0], False),
    (None, [5.0, 3.0], False),
])
def test_check_sends_back_a_chart_whose_undeclared_measure_holds_dates(tmp_path, y0_type, values, refused):
    rows = [{"x": "Books", "y0": values[0]}, {"x": "Music", "y0": values[1]}]
    columns = [{"name": "x", "type": "STRING"}] + ([{"name": "y0", "type": y0_type}] if y0_type else [])
    ws = TypedWorkspace(lambda sql: rows if _by_category(sql) else None, columns)
    s = shell_core.Shell(app_dir(tmp_path), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws,
                         user_factory=lambda h, t: ws)
    dated = [p for p in s.check({}) if " is a date, so a " in p]
    assert dated == (["page n01_u05: chart by_category measure 1 is a date, so a horizontal_bar cannot draw it as a height or a size; show the "
                      "date as text in a KPI or a table column, count the rows instead, or draw a gantt of each start and end"]
                     if refused else []), dated


def test_check_sends_back_a_ranked_chart_whose_groups_all_share_one_value(tmp_path):
    def shape(sql):
        if "`category`" in sql and "GROUP BY" in sql and "low_0 AS low" not in sql and "SUM(y0) OVER" not in sql:
            return [{"x": "Books", "y0": 10.0}, {"x": "Music", "y0": 10.0}, {"x": "Home", "y0": 10.0}]
        return None

    problems, _ws = checked(tmp_path, shape)
    flat = [p for p in problems if "ranks nothing" in p]
    assert flat == ["page n01_u05: chart by_category gives every group the same Loss (10) at the default filters, so it ranks "
                    "nothing; chart a measure that differs across the groups"], problems
    assert len(problems) == 1


def test_a_flat_measure_is_only_flagged_on_a_chart_that_compares_groups():
    rows = [{"x": "a", "y0": 4, "y1": 1.5}, {"x": "b", "y0": 4, "y1": 2.5}]
    bar = {"type": "bar", "x": {"column": "c", "kind": "category"}, "y": [{"label": "Offers", "expression": "COUNT(*)"},
                                                                           {"expression": "AVG(v)"}]}
    assert shell_core.flat_measures(bar, rows) == [("Offers", 4)]
    assert shell_core.flat_measures(dict(bar, x={"column": "d", "kind": "time"}), rows) == [], "a flat trend is a finding"
    assert shell_core.flat_measures(dict(bar, type="scatter"), rows) == []
    assert shell_core.flat_measures(bar, rows[:1]) == [], "one group is the draws-one-group check"
    assert shell_core.flat_measures(bar, [{"x": "a", "y0": None}, {"x": "b", "y0": None}]) == []
    assert shell_core.flat_measures(bar, [{"x": "a", "y0": 4}, {"x": "b", "y0": 5}]) == []


def test_check_sends_back_a_decision_list_whose_rows_share_a_key(tmp_path):
    rows = [{"entity_id": f"A{i % 3}", "entity_label": f"Offer {i}", "rank": i} for i in range(9)]

    def shape(counted):
        return lambda sql: [counted] if "COUNT(DISTINCT" in sql else rows if "ORDER BY `rank`" in sql else None

    problems, ws = checked(tmp_path, shape({"n": 9, "k": 3}))
    assert problems == ["page n01_u05: the decision list repeats keys: 9 rows carry 3 distinct keys, so the page cannot tell its "
                        "rows apart and their history and edits fail; select record_key, the result table's key for one record, in "
                        "the records dataset"]
    counted = [sql for sql, _p, _l in ws.sql if "COUNT(DISTINCT" in sql]
    assert counted == [counted[0]] and "COUNT(DISTINCT CAST(`entity_id` AS STRING)) AS k" in counted[0] and "LIMIT" not in counted[0], \
        "the key check counts every row of the list in SQL, not the first page"
    (tmp_path / "keyed").mkdir()
    assert checked(tmp_path / "keyed", shape({"n": 9, "k": 9}))[0] == []


def test_the_example_page_teaches_one_row_per_record():
    records = next(d["sql"] for d in PAGE["datasets"] if d["name"] == "records")
    assert "o.record_key" in records


def test_check_counts_only_segment_filters_that_offer_two_values(tmp_path):
    def shape(sql):
        if sql.startswith("SELECT v FROM") and "`region`" in sql:
            return [{"v": "North"}]
        return None

    problems, _ws = checked(tmp_path, shape)
    assert problems == ["page n01_u05: 2 segment filters offer 2 or more values; region (North) offer one, so they slice nothing. "
                        "Filter on columns with 2 or more values so at least 3 can slice"]


def test_check_keeps_a_one_value_filter_when_three_others_slice(tmp_path):
    page = copy.deepcopy(PAGE)
    page["filters"].append({"id": "action", "type": "multi_select", "label": "Action",
                            "columns": {"trend": "action_level", "records": "action_level"}})
    ws = ShapedWorkspace(lambda sql: [{"v": "Monitor"}] if sql.startswith("SELECT v FROM") and "`action_level`" in sql else None)
    s = shell_core.Shell(app_dir(tmp_path, pages=[page]), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws,
                         user_factory=lambda h, t: ws)
    assert s.check({}) == []
    assert any(sql.startswith("SELECT v FROM") and "`action_level`" in sql for sql, _p, _l in ws.sql)


def test_check_flags_a_date_filter_with_no_dates_and_a_failed_filter(tmp_path):
    def shape(sql):
        if "low_0 AS low" in sql:
            return [{"low": None, "high": None}]
        if sql.startswith("SELECT v FROM") and "`region`" in sql:
            return shell_db.QueryError("PERMISSION_DENIED")
        return None

    problems, _ws = checked(tmp_path, shape)
    assert "page n01_u05: date filter run_date found no dates" in problems
    assert "page n01_u05: filter region failed: PERMISSION_DENIED" in problems
    assert len(problems) == 2


def _embed():
    import importlib.util
    spec = importlib.util.spec_from_file_location("inspire_app_shell_embed", os.path.join(ROOT, "agent", "app_shell", "embed.py"))
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def test_the_notebook_embeds_this_exact_shell_and_the_gate_names_any_drift():
    embed = _embed()
    expected, actual = embed.payload(static=False), embed.embedded()
    assert embed.differences(expected, actual, static=False) == []
    assert actual["example"] == PAGE
    drifted = copy.deepcopy(actual)
    drifted["files"]["shell_core.py"] += "\n"
    drifted["example"]["title"] = "Another desk"
    del drifted["files"]["static/assets/app.js"]
    drifted["web_source"] = "0" * 64
    assert embed.differences(expected, drifted, static=False) == [
        "the web sources changed since the bundle was embedded", "example_page.json differs",
        "static/assets/app.js is missing", "shell_core.py differs"]


def test_the_shell_lockfile_resolves_every_package_from_the_public_npm_registry():
    with open(os.path.join(ROOT, "agent", "app_shell", "web", "package-lock.json"), encoding="utf-8") as handle:
        packages = json.load(handle)["packages"]
    resolved = {name: entry["resolved"] for name, entry in packages.items() if entry.get("resolved")}
    assert resolved
    assert [name for name, url in resolved.items() if not url.startswith("https://registry.npmjs.org/")] == []
