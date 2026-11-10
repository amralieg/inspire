"""A money KPI over rows in several currencies is never one summed number: the App reads each currency's total, offline."""
import os
import datetime
import re
import sqlite3
import sys

import sqlglot

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402

CLOSED = "2025-01-01"
ROWS = [
    {"value_at_stake": 100.0, "currency_code": "AED", "channel": "web", "event_month": CLOSED},
    {"value_at_stake": 25.0, "currency_code": "AED", "channel": "web", "event_month": CLOSED},
    {"value_at_stake": 50.0, "currency_code": "USD", "channel": "web", "event_month": CLOSED},
    {"value_at_stake": 10.0, "currency_code": "AED", "channel": "agent", "event_month": CLOSED},
]

PAGE = {
    "id": "n04_u05",
    "datasets": [{"name": "rows", "sql": "SELECT value_at_stake, currency_code, channel, event_month, fx_rate FROM stake_rows"}],
    "filters": [{"id": "currency", "label": "Currency", "type": "multi_select", "columns": {"rows": "currency_code"}},
                {"id": "channel", "label": "Sales channel", "type": "multi_select", "columns": {"rows": "channel"}},
                {"id": "ticket_month", "label": "Ticket month", "type": "date_range", "grain": "month", "default": "12m",
                 "columns": {"rows": "event_month"}}],
    "charts": [
        {"id": "monthly", "dataset": "rows", "type": "line", "x": {"column": "event_month", "kind": "time"},
         "y": [{"expression": "SUM(value_at_stake)", "format": "currency", "currency": "USD"}]},
        {"id": "by_channel", "dataset": "rows", "type": "horizontal_bar", "x": {"column": "channel", "kind": "category"},
         "y": [{"expression": "SUM(value_at_stake)", "format": "currency", "currency": "USD"}]},
    ],
    "kpis": [
        {"id": "exposure", "label": "Revenue at stake", "dataset": "rows", "expression": "SUM(value_at_stake)",
         "format": "currency", "currency": "USD", "good": "down"},
        {"id": "results", "label": "Results", "dataset": "rows", "expression": "COUNT(*)", "format": "integer", "good": "down"},
    ],
}


def _run(sql):
    db = sqlite3.connect(":memory:")

    def add_months(value, months):
        year, month = (int(part) for part in str(value)[:7].split("-"))
        total = year * 12 + (month - 1) + int(months)
        return f"{total // 12:04d}-{total % 12 + 1:02d}-01"

    db.create_function("ADD_MONTHS", 2, add_months)
    db.execute("CREATE TABLE stake_rows (value_at_stake REAL, currency_code TEXT, channel TEXT, event_month TEXT, fx_rate REAL)")
    db.executemany("INSERT INTO stake_rows VALUES (?, ?, ?, ?, ?)",
                   [(r["value_at_stake"], r["currency_code"], r["channel"], r["event_month"], r.get("fx_rate")) for r in ROWS])
    text = sqlglot.transpile(sql, read="databricks", write="sqlite")[0]
    text = re.sub(r"(TIMESTAMP_TRUNC|DATE_TRUNC)\(\s*(CURRENT_DATE\s*,\s*MONTH|'?MONTH'?\s*,\s*CURRENT_DATE)\s*\)",
                  "date('now', 'start of month')", text, flags=re.I)
    cursor = db.execute(text)
    names = [c[0] for c in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def test_a_money_kpi_over_several_currencies_is_split_per_currency_in_the_query():
    sql, _ = shell_sql.kpi_query(PAGE, "exposure", {})
    rows = _run(sql)
    assert {(r["currency"], r["value"]) for r in rows if r["period"] == "now"} == {("AED", 135.0), ("USD", 50.0)}


def test_mixed_currencies_never_come_back_as_one_total():
    rows = _run(shell_sql.kpi_query(PAGE, "exposure", {})[0])
    shown = shell_sql.kpi_values(rows)
    assert shown["now"] is None, "a total of AED and USD is not a number the App may show"
    assert shown["by_currency"] == [{"currency": "AED", "now": 135.0, "before": None}, {"currency": "USD", "now": 50.0, "before": None}]


def test_a_single_currency_money_kpi_keeps_one_number():
    rows = [{"period": "now", "currency": "USD", "value": 50.0}]
    assert shell_sql.kpi_values(rows) == {"now": 50.0, "before": None, "by_currency": [
        {"currency": "USD", "now": 50.0, "before": None}]}
    assert shell_sql.kpi_values([{"period": "now", "value": 7.0}]) == {"now": 7.0, "before": None}


def test_a_money_kpi_split_by_a_filter_adds_up_one_currency_per_group():
    sql, _ = shell_sql.kpi_split_query(PAGE, "exposure", "channel", {}, 50)
    got = {(r["x"], r["s"], r["y0"]) for r in _run(sql)}
    assert got == {("web", "AED", 125.0), ("web", "USD", 50.0), ("agent", "AED", 10.0)}


def test_a_count_kpi_is_not_split_and_keeps_its_one_number():
    sql, _ = shell_sql.kpi_query(PAGE, "results", {})
    assert "GROUP BY" not in sql
    assert _run(sql) == [{"period": "now", "value": 4}]
    assert shell_sql.kpi_values(_run(sql)) == {"now": 4, "before": None}


def test_a_money_kpi_on_a_dataset_without_a_currency_filter_keeps_one_number():
    page = dict(PAGE, filters=[])
    sql, _ = shell_sql.kpi_query(page, "exposure", {})
    assert "GROUP BY" not in sql


def test_genie_is_told_never_to_add_amounts_in_different_currencies(agent_ns):
    rule = agent_ns["genie_value_at_stake_rule"]("predicted")
    assert "Amounts in different currencies are never added together" in rule
    assert "no total is given across currencies unless every row shares one currency" in rule


def _with_rows(extra):
    global ROWS
    saved = list(ROWS)
    ROWS = saved + extra
    try:
        return _run
    finally:
        ROWS = saved


def test_a_row_without_a_date_is_left_out_of_every_money_total():
    rows = [{"value_at_stake": 1000.0, "currency_code": "AED", "channel": "web", "event_month": None}]
    saved = list(ROWS)
    ROWS[:] = saved + rows
    try:
        got = _run(shell_sql.kpi_query(PAGE, "exposure", {})[0])
    finally:
        ROWS[:] = saved
    assert {(r["currency"], r["value"]) for r in got} == {("AED", 135.0), ("USD", 50.0)}


def test_the_running_period_is_not_compared_as_a_full_month_and_future_rows_never_count():
    this_month = datetime.date.today().replace(day=1).isoformat()
    saved = list(ROWS)
    ROWS[:] = saved + [
        {"value_at_stake": 700.0, "currency_code": "AED", "channel": "web", "event_month": this_month},
        {"value_at_stake": 800.0, "currency_code": "AED", "channel": "web", "event_month": "2099-01-01"},
    ]
    try:
        got = _run(shell_sql.kpi_query(PAGE, "exposure", {})[0])
    finally:
        ROWS[:] = saved
    assert {(r["currency"], r["value"]) for r in got} == {("AED", 135.0), ("USD", 50.0)}


def test_a_money_line_chart_draws_one_series_per_currency():
    got = _run(shell_sql.chart_query(PAGE, "monthly", {})[0])
    assert {(r["x"], r["s"], r["y0"]) for r in got} == {(CLOSED, "AED", 135.0), (CLOSED, "USD", 50.0)}


def test_a_money_bar_chart_names_each_currency_in_its_bars_label():
    got = _run(shell_sql.chart_query(PAGE, "by_channel", {})[0])
    assert {(r["x"], r["y0"]) for r in got} == {("web · AED", 125.0), ("web · USD", 50.0), ("agent · AED", 10.0)}


def test_genie_answers_within_the_page_window_and_says_which_window_it_used(agent_ns):
    rule = agent_ns["genie_value_at_stake_rule"]("predicted")
    assert "Answer within the page's default window, the closed periods of the last 12 months" in rule
    assert "give all-time totals only when the question asks for them, saying so" in rule


def test_the_page_writer_is_told_money_never_adds_currencies_and_windows_skip_undated_rows():
    notebook = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
    with open(notebook, encoding="utf-8") as handle:
        text = handle.read()
    assert "a currency KPI or chart never adds amounts of different currencies" in text
    assert "so filter `<date> IS NOT NULL` inside the dataset first" in text


CONVERTED_PAGE = dict(PAGE, money={"currency": "convert", "base": "USD", "rates": {"AED": 0.5, "USD": 1.0}})


def test_a_saved_money_rule_is_validated_and_per_currency_is_the_default():
    assert shell_sql.money_rule_problems(None) == []
    assert shell_sql.money_rule_problems({"currency": "per_currency"}) == []
    assert shell_sql.money_rule_problems({"currency": "convert", "base": "USD", "rates": {"AED": 0.27}}) == []
    assert shell_sql.money_rule_problems({"currency": "convert", "base": "NOPE", "rates": {"AED": 0.27}})
    assert shell_sql.money_rule_problems({"currency": "convert", "base": "USD", "rates": {}})
    assert shell_sql.money_rule_problems({"currency": "convert", "base": "USD", "rates": {"AED": -1}})
    assert shell_sql.money_rule_problems({"currency": "convert", "base": "USD", "rates": {"AED": True}})
    assert shell_sql.money_rule_problems({"currency": "sum_everything"})


def test_a_converted_money_kpi_is_one_total_in_the_base_currency_at_the_typed_rates():
    rows = _run(shell_sql.kpi_query(CONVERTED_PAGE, "exposure", {})[0])
    shown = shell_sql.kpi_values(rows)
    assert "by_currency" not in shown, "a converted total is one number"
    assert shown["now"] == 117.5, "AED 135 at 0.5 plus USD 50 at 1"


def test_the_saved_rule_changes_the_totals_only_for_the_page_that_saved_it():
    assert "CASE" not in shell_sql.kpi_query(PAGE, "exposure", {})[0]
    assert "_inspire_converted" in shell_sql.kpi_query(CONVERTED_PAGE, "exposure", {})[0]


def test_the_left_out_line_counts_undated_rows_and_the_running_period_under_the_filters():
    this_month = datetime.date.today().replace(day=1).isoformat()
    saved = list(ROWS)
    ROWS[:] = saved + [
        {"value_at_stake": 1.0, "currency_code": "AED", "channel": "web", "event_month": None},
        {"value_at_stake": 2.0, "currency_code": "AED", "channel": "web", "event_month": this_month},
    ]
    try:
        sql, _ = shell_sql.money_left_out(PAGE, PAGE["kpis"][0], {})
        shown = shell_sql.left_out_text(_run(sql))
    finally:
        ROWS[:] = saved
    assert (shown["undated"], shown["running"]) == (1, 1)
    assert shown["text"] == "1 row without a date and 1 row from the running month were left out"


def test_a_page_without_a_period_filter_has_no_left_out_count():
    assert shell_sql.money_left_out(dict(PAGE, filters=[]), PAGE["kpis"][0], {}) is None


def _money_page(result_table="inspire_kinds._inspire_x.run_results"):
    import v141_app_shell_test as shell_harness
    kpis = [dict(k, compare=False) for k in shell_harness.PAGE["kpis"]]
    return dict(shell_harness.PAGE, id="n01_u05", result_table=result_table, use_case_id="N01-U01", kpis=kpis)


def test_the_saved_money_rule_is_read_once_per_request_and_overrides_the_spec(tmp_path):
    import json as _json
    import v141_app_shell_test as shell_harness
    saved = {"name": "money_rule", "text_value": _json.dumps({"currency": "convert", "base": "USD", "rates": {"AED": 0.5, "USD": 1.0}})}
    seen = []

    def shape(sql):
        if "_assumptions" in sql:
            seen.append(sql)
            return [saved]
        return None

    ws = shell_harness.ShapedWorkspace(shape)
    pages = [_money_page()]
    s = shell_harness.shell_core.Shell(shell_harness.app_dir(tmp_path, pages=pages), env={"DATABRICKS_WAREHOUSE_ID": "wh1"},
                                       sp_factory=lambda: ws, user_factory=lambda h, t: ws)
    token = shell_harness.shell_core.REQUEST.set({"headers": {}, "rules": {}})
    try:
        first = s.page("n01_u05")
        second = s.page("n01_u05")
    finally:
        shell_harness.shell_core.REQUEST.reset(token)
    assert first["money"] == second["money"] == {"currency": "convert", "base": "USD", "rates": {"AED": 0.5, "USD": 1.0}}
    assert len(seen) == 1, "the request reads the saved rule once"


def test_without_a_request_or_a_saved_rule_the_spec_rule_stands(tmp_path):
    import v141_app_shell_test as shell_harness
    ws = shell_harness.ShapedWorkspace(lambda sql: None)
    s = shell_harness.shell_core.Shell(shell_harness.app_dir(tmp_path, pages=[_money_page()]), env={"DATABRICKS_WAREHOUSE_ID": "wh1"},
                                       sp_factory=lambda: ws, user_factory=lambda h, t: ws)
    assert "money" not in s.page("n01_u05")
    token = shell_harness.shell_core.REQUEST.set({"headers": {}, "rules": {}})
    try:
        assert "money" not in s.page("n01_u05")
    finally:
        shell_harness.shell_core.REQUEST.reset(token)


def _owned():
    import v141_app_shell_test as shell_harness
    return dict(shell_harness.SETTINGS, use_case_owners={"n01_u05": ["owner@example.com"]})


def test_the_owner_saves_a_money_rule_as_one_assumption_row_and_the_view_shows_it(tmp_path):
    import json as _json
    import v141_app_shell_test as shell_harness
    writes = []

    class Capturing(shell_harness.ShapedWorkspace):
        def run_sql(self, warehouse, sql, params, limit=5000):
            if sql.lstrip().upper().startswith("INSERT INTO") and "_assumptions" in sql:
                writes.append([p.get("value") for p in params])
            return super().run_sql(warehouse, sql, params, limit)

    ws = Capturing(lambda sql: None)
    s = shell_harness.shell_core.Shell(shell_harness.app_dir(tmp_path, settings=_owned(), pages=[_money_page()]),
                                       env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws, user_factory=lambda h, t: ws)
    headers = {"x-forwarded-email": "owner@example.com", "x-forwarded-access-token": "t"}
    status, out = shell_harness.call(s, "POST", "money/rule", headers=headers,
                                     body={"page": "n01_u05", "rule": {"currency": "convert", "base": "USD", "rates": {"AED": 0.5}}})
    assert status == 200, out
    assert len(writes) == 1 and "money_rule" in writes[0], "one assumption row names the rule"
    assert _json.loads(writes[0][-1]) == {"currency": "convert", "base": "USD", "rates": {"AED": 0.5}}, "the rule travels as its text"
    assert out["money"]["name"] == "money_rule", "the view names the saved rule"
    assert out["money"]["rule"] == {"currency": "per_currency"}, "the mock returns no saved row, so the view shows the spec rule"


def test_a_bad_money_rule_is_refused_before_anything_is_written(tmp_path):
    import v141_app_shell_test as shell_harness
    writes = []
    ws = shell_harness.ShapedWorkspace(lambda sql: writes.append(sql) if sql.lstrip().upper().startswith("INSERT") else None)
    s = shell_harness.shell_core.Shell(shell_harness.app_dir(tmp_path, settings=_owned(), pages=[_money_page()]),
                                       env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws, user_factory=lambda h, t: ws)
    headers = {"x-forwarded-email": "owner@example.com", "x-forwarded-access-token": "t"}
    status, out = shell_harness.call(s, "POST", "money/rule", headers=headers,
                                     body={"page": "n01_u05", "rule": {"currency": "convert", "base": "NOPE", "rates": {}}})
    assert status == 400 and "base currency" in out["error"]
    assert writes == []


def test_rows_with_no_rate_are_counted_in_the_left_out_line():
    rate_page = dict(PAGE, money={"currency": "convert", "base": "USD", "rates": {"AED": 0.5, "USD": 1.0}})
    saved = list(ROWS)
    ROWS[:] = saved + [{"value_at_stake": 9.0, "currency_code": "EUR", "channel": "web", "event_month": CLOSED}]
    try:
        sql, _ = shell_sql.money_left_out(rate_page, rate_page["kpis"][0], {})
        shown = shell_sql.left_out_text(_run(sql))
    finally:
        ROWS[:] = saved
    assert shown["unrated"] == 1 and shown["text"].endswith("; 1 row has no rate")
    assert shell_sql.left_out_text(_run(shell_sql.money_left_out(PAGE, PAGE["kpis"][0], {})[0]))["text"].endswith("were left out")


def _top(page, limit=3):
    sql, _ = shell_sql.money_top_query(page, page["kpis"][0], limit)
    return sorted((round(r["amount"], 2) for r in _run(sql)), reverse=True)


def test_the_preview_top_rows_are_converted_at_the_rate_the_owner_typed():
    converted = dict(PAGE, money={"currency": "convert", "base": "USD", "rates": {"AED": 0.5, "USD": 1.0}})
    assert _top(converted) == [50.0, 50.0, 12.5], "AED 100 at 0.5, USD 50 at 1, AED 25 at 0.5"


def test_the_preview_top_rows_are_per_currency_amounts_when_no_rate_is_chosen():
    assert _top(PAGE) == [100.0, 50.0, 25.0]


def test_genie_says_the_same_left_out_line_the_app_shows(agent_ns):
    rule = agent_ns["genie_value_at_stake_rule"]("predicted")
    assert "say the one line the App gives under the total" in rule


FIXTURE = os.path.join(ROOT, "..", "backend", "test", "fixtures", "money_rule_cases.json")


def _cases():
    import json
    with open(FIXTURE, encoding="utf-8") as handle:
        return json.load(handle)["cases"]


def test_the_money_rule_cases_agree_with_the_inspire_backend():
    for case in _cases():
        problems = shell_sql.money_rule_problems(case["rule"])
        assert (not problems) == case["valid"], f"{case['name']}: {problems}"
        if case["valid"]:
            assert shell_sql.money_rule_clean(case["rule"] or {}) == case["clean"], case["name"]


def test_a_rate_column_converts_each_row_at_its_own_rate():
    global ROWS
    saved = list(ROWS)
    rate_page = dict(PAGE, money={"currency": "convert", "base": "USD", "rate_column": "fx_rate"})
    ROWS = [dict(r, fx_rate=2.0) for r in saved]
    try:
        db_rows = _run(shell_sql.kpi_query(rate_page, "exposure", {})[0])
    finally:
        ROWS = saved
    assert shell_sql.kpi_values(db_rows)["now"] == 2.0 * 185.0, "each row times its own rate, summed once"


def test_the_basis_says_at_which_rates_a_converted_total_was_worked_out():
    assert shell_sql.money_basis(PAGE) == ""
    assert shell_sql.money_basis(dict(PAGE, money={"currency": "convert", "base": "USD", "rates": {"AED": 0.5}})) == \
        "converted to USD at the rates typed in"
    assert shell_sql.money_basis(dict(PAGE, money={"currency": "convert", "base": "USD", "rate_column": "fx_rate"})) == \
        "converted to USD at the rate in fx_rate"


def test_a_window_totals_only_the_last_closed_periods():
    import datetime as dt
    today = dt.date.today()
    first = today.replace(day=1)
    def month_back(n):
        y, m = first.year, first.month - n
        while m <= 0:
            m += 12
            y -= 1
        return dt.date(y, m, 1).isoformat()
    saved = list(ROWS)
    windowed = dict(PAGE, money={"currency": "per_currency", "window": {"periods": 2}})
    ROWS[:] = saved + [
        {"value_at_stake": 1000.0, "currency_code": "AED", "channel": "web", "event_month": month_back(3)},
        {"value_at_stake": 7.0, "currency_code": "AED", "channel": "web", "event_month": month_back(2)},
    ]
    try:
        sql, _ = shell_sql.kpi_query(windowed, "exposure", {})
        got = _run(sql)
    finally:
        ROWS[:] = saved
    assert {(r["currency"], r["value"]) for r in got} == {("AED", 7.0)}, \
        "the 2025 rows and the row three periods back are out; the row two periods back is in"


def test_the_build_writes_the_spec_money_rule_into_the_page_as_its_default():
    notebook = os.path.join(ROOT, "agent", "dbx_inspire_ai_agent.ipynb")
    with open(notebook, encoding="utf-8") as handle:
        text = handle.read()
    assert 'if (context.get(\\"spec\\") or {}).get(\\"money\\"):' in text
    assert 'page[\\"money\\"] = dict(context[\\"spec\\"][\\"money\\"])' in text


def test_a_rate_table_converts_each_row_at_the_rate_for_its_currency_base_and_date():
    global ROWS
    saved = list(ROWS)
    rate_page = dict(PAGE, money={"currency": "convert", "base": "USD", "rate_table": {
        "table": "main.fx.fx_rates", "currency_column": "from_code", "base_column": "to_code", "date_column": "rate_date", "rate_column": "rate", "load_column": "loaded_at"}})
    ROWS = [dict(r, event_month=CLOSED) for r in saved]
    rates_sql = ("CREATE TABLE fx_rates (from_code TEXT, to_code TEXT, rate_date TEXT, rate REAL, loaded_at TEXT);"
                 "INSERT INTO fx_rates VALUES ('AED','USD','2025-01-01',0.5,'2025-01-02'),('USD','USD','2025-01-01',1.0,'2025-01-02')")
    try:
        db_rows = _run_with(rate_page, rates_sql)
    finally:
        ROWS = saved
    assert shell_sql.kpi_values(db_rows)["now"] == 0.5 * 135.0 + 1.0 * 50.0


def test_a_row_with_no_rate_is_left_out_of_the_total_and_counted_in_the_line():
    rate_page = dict(PAGE, money={"currency": "convert", "base": "USD", "rate_table": {
        "table": "main.fx.fx_rates", "currency_column": "from_code", "base_column": "to_code", "date_column": "rate_date", "rate_column": "rate", "load_column": "loaded_at"}})
    rates_sql = "CREATE TABLE fx_rates (from_code TEXT, to_code TEXT, rate_date TEXT, rate REAL, loaded_at TEXT);INSERT INTO fx_rates VALUES ('AED','USD','2025-01-01',0.5,'2025-01-02')"
    sql, _ = shell_sql.money_left_out(rate_page, rate_page["kpis"][0], {})
    shown = shell_sql.left_out_text(_run_with(rate_page, rates_sql, sql))
    assert shown["unrated"] == 1 and shown["text"].endswith("; 1 row has no rate"), shown


def test_per_group_counts_each_group_once_with_its_largest_row():
    grouped = dict(PAGE, money={"currency": "per_currency", "per": "group", "group_column": "channel"})
    got = _run(shell_sql.kpi_query(grouped, "exposure", {})[0])
    assert {(r["currency"], r["value"]) for r in got} == {("AED", 110.0)}, "web counts its largest row (AED 100) once, agent its one row (AED 10)"


def test_off_reads_no_amount_for_the_money_totals():
    off = dict(PAGE, money={"currency": "per_currency", "off": True})
    shown = shell_sql.page_with_money(off, off["money"])
    assert not any(k["format"] == "currency" for k in shown["kpis"]), "off removes the money cards"
    assert not any(any(y.get("format") == "currency" for y in c["y"]) for c in shown["charts"]), "off removes the money charts"
    assert [k["id"] for k in shown["kpis"]] == ["results"], "the count card stays"


def test_a_dataset_that_ignores_a_status_or_the_losses_rule_fails_the_page_check():
    ignores = dict(PAGE, money={"currency": "per_currency", "statuses": ["used"], "rule": "losses"})
    problems = shell_sql.money_page_problems(ignores)
    assert any("ignores the status 'used'" in p for p in problems)
    assert any("does not count losses only" in p for p in problems)
    kept = dict(PAGE, money={"currency": "per_currency", "statuses": ["used"]},
                datasets=[{"name": "rows", "sql": "SELECT value_at_stake, currency_code, channel, event_month, fx_rate FROM stake_rows "
                                                  "WHERE status = 'used' AND GREATEST(-value_at_stake, 0) >= 0"}])
    assert shell_sql.money_page_problems(kept) == []
    off = dict(PAGE, money={"currency": "per_currency", "off": True, "statuses": ["used"]})
    assert shell_sql.money_page_problems(off) == []


def _run_with(page, setup, sql=None):
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE stake_rows (value_at_stake REAL, currency_code TEXT, channel TEXT, event_month TEXT, fx_rate REAL)")
    db.executemany("INSERT INTO stake_rows VALUES (?, ?, ?, ?, ?)",
                   [(r["value_at_stake"], r["currency_code"], r["channel"], r["event_month"], r.get("fx_rate")) for r in ROWS])
    for statement in [part for part in setup.split(";") if part.strip()]:
        db.execute(statement)
    if sql is None:
        sql, _ = shell_sql.kpi_query(page, "exposure", {})
    tree = sqlglot.parse_one(sql, read="databricks")
    for table in tree.find_all(sqlglot.exp.Table):
        table.set("catalog", None)
        table.set("db", None)
    text = re.sub(r"(TIMESTAMP_TRUNC|DATE_TRUNC)\(\s*(CURRENT_DATE\s*,\s*MONTH|'?MONTH'?\s*,\s*CURRENT_DATE)\s*\)",
                   "date('now', 'start of month')", tree.sql(dialect="sqlite"), flags=re.I)
    cursor = db.execute(text)
    names = [c[0] for c in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def test_the_genie_dataset_brief_states_the_statuses_the_losses_rule_and_the_rate_table(agent_ns):
    brief = agent_ns["implement_money_brief"]
    text = brief({"currency": "per_currency", "statuses": ["used", "exchanged"], "rule": "losses"})
    assert "'used', 'exchanged'" in text and "GREATEST(-effect, 0)" in text
    assert "net: the signed effect" in brief({"currency": "per_currency", "rule": "net"})
    assert "each group (channel) counts once" in brief({"currency": "per_currency", "per": "group", "group_column": "channel"})
    assert "rate table" in brief({"currency": "convert", "base": "USD", "rate_table": {}})
    assert brief({"currency": "per_currency", "off": True}) == "- money is off for this use case: write no money amount, KPI or chart.\n"
    assert brief(None) == ""


def test_off_gives_the_genie_split_no_money_answer_and_the_totals_no_amount(agent_ns):
    off = dict(PAGE, money={"currency": "per_currency", "off": True})
    assert not any(k["format"] == "currency" for k in shell_sql.page_with_money(off, off["money"])["kpis"])


def test_a_save_cannot_change_a_build_level_money_field_and_keeps_the_built_ones(tmp_path):
    import v141_app_shell_test as shell_harness
    spec_money = {"currency": "per_currency", "rule": "net", "per": "group", "group_column": "channel"}
    writes = []

    class Capturing(shell_harness.ShapedWorkspace):
        def run_sql(self, warehouse, sql, params, limit=5000):
            if sql.lstrip().upper().startswith("INSERT INTO") and "_assumptions" in sql:
                writes.append([p.get("value") for p in params])
            return super().run_sql(warehouse, sql, params, limit)

    ws = Capturing(lambda sql: None)
    s = shell_harness.shell_core.Shell(shell_harness.app_dir(tmp_path, settings=_owned(), pages=[dict(_money_page(), money=spec_money)]),
                                       env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws, user_factory=lambda h, t: ws)
    headers = {"x-forwarded-email": "owner@example.com", "x-forwarded-access-token": "t"}
    status, out = shell_harness.call(s, "POST", "money/rule", headers=headers,
                                     body={"page": "n01_u05", "rule": {"currency": "per_currency", "statuses": ["open"], "status_column": "status"}})
    assert status == 409 and "statuses needs a rebuild" in out["error"], out
    assert writes == []
    status, out = shell_harness.call(s, "POST", "money/rule", headers=headers,
                                     body={"page": "n01_u05", "rule": {"currency": "convert", "base": "USD", "rates": {"AED": 0.5}}})
    assert status == 200, out
    import json as _json
    saved = _json.loads(writes[0][-1])
    assert (saved["per"], saved["group_column"], saved["rule"]) == ("group", "channel", "net"), "the built fields ride along with the owner's change"


STATUS_ROWS = [
    {"value_at_stake": 100.0, "status": "used", "channel": "web"},
    {"value_at_stake": 40.0, "status": "void", "channel": "web"},
    {"value_at_stake": 7.0, "status": "exchanged", "channel": "agent"},
]


def _status_db(rows):
    db = sqlite3.connect(":memory:")
    db.execute("CREATE TABLE facts (value_at_stake REAL, status TEXT, channel TEXT)")
    db.executemany("INSERT INTO facts VALUES (?, ?, ?)", [(r["value_at_stake"], r["status"], r["channel"]) for r in rows])
    return db


def _bad_rows(page, label):
    sql = dict(shell_sql.money_check_queries(page))[label]
    tree = sqlglot.parse_one(sql, read="databricks")
    for table in tree.find_all(sqlglot.exp.Table):
        table.set("catalog", None)
        table.set("db", None)
    return _status_db(STATUS_ROWS).execute(tree.sql(dialect="sqlite")).fetchone()[0]


def _statused_page(dataset_sql, rule):
    return dict(PAGE, money=rule, datasets=[{"name": "rows", "sql": dataset_sql}])


def test_a_dataset_that_does_not_drop_a_status_is_caught_by_running_its_check_on_the_data():
    rule = {"currency": "per_currency", "statuses": ["used", "exchanged"], "status_column": "status", "rule": "net"}
    unfiltered = _statused_page("SELECT value_at_stake, status, channel FROM facts", rule)
    assert _bad_rows(unfiltered, "statuses of rows") == 1, "the void row is in the dataset"
    filtered = _statused_page("SELECT value_at_stake, status, channel FROM facts WHERE status IN ('used', 'exchanged')", rule)
    assert _bad_rows(filtered, "statuses of rows") == 0, "a dataset that drops void keeps the total right"


def test_a_losses_rule_is_caught_when_the_data_holds_a_negative_amount():
    losses = {"currency": "per_currency", "rule": "losses"}
    netted = _statused_page("SELECT value_at_stake, status, channel FROM facts", losses)
    assert _bad_rows(netted, "losses of rows") == 0, "every row is a positive loss"
    gains = _statused_page("SELECT value_at_stake - 500 AS value_at_stake, status, channel FROM facts", losses)
    assert _bad_rows(gains, "losses of rows") == 3, "a net dataset has negative rows that a losses total must not add"


def test_the_build_check_fails_the_page_when_its_dataset_breaks_the_money_rule(tmp_path, monkeypatch):
    import v141_app_shell_test as shell_harness
    monkeypatch.setattr(shell_sql, "money_page_problems", lambda page: [])
    rule = {"currency": "per_currency", "statuses": ["used"], "status_column": "status", "rule": "net"}
    page = dict(shell_harness.PAGE, id="n01_u05", result_table="inspire_kinds._inspire_x.run_results", use_case_id="N01-U01",
                money=rule, kpis=[dict(k, compare=False) for k in shell_harness.PAGE["kpis"]])
    ws = shell_harness.ShapedWorkspace(lambda sql: [{"bad": 2}] if "NOT IN" in sql else None)
    s = shell_harness.shell_core.Shell(shell_harness.app_dir(tmp_path, pages=[page]), env={"DATABRICKS_WAREHOUSE_ID": "wh1"},
                                       sp_factory=lambda: ws, user_factory=lambda h, t: ws)
    found = [text for _kind, text in s.checked({})]
    assert any("2 rows of statuses of " in text and "break the money rule" in text for text in found), found


def test_two_rates_for_one_currency_base_and_date_use_the_latest_loaded_and_the_line_says_so():
    rate_page = dict(PAGE, money={"currency": "convert", "base": "USD", "rate_table": {
        "table": "main.fx.fx_rates", "currency_column": "from_code", "base_column": "to_code", "date_column": "rate_date",
        "rate_column": "rate", "load_column": "loaded_at"}})
    rates_sql = ("CREATE TABLE fx_rates (from_code TEXT, to_code TEXT, rate_date TEXT, rate REAL, loaded_at TEXT);"
                 "INSERT INTO fx_rates VALUES ('AED','USD','2025-01-01',0.9,'2025-01-02'),('AED','USD','2025-01-01',0.5,'2025-01-09'),"
                 "('USD','USD','2025-01-01',1.0,'2025-01-02')")
    saved = list(ROWS)
    ROWS[:] = [dict(r, event_month=CLOSED) for r in saved]
    try:
        db_rows = _run_with(rate_page, rates_sql)
        sql, _ = shell_sql.money_left_out(rate_page, rate_page["kpis"][0], {})
        shown = shell_sql.left_out_text(_run_with(rate_page, rates_sql, sql))
    finally:
        ROWS[:] = saved
    assert shell_sql.kpi_values(db_rows)["now"] == 0.5 * 135.0 + 50.0, "the rate loaded last (0.5) is used, not the largest"
    assert shown["duplicated"] == 1 and shown["text"].endswith("; 1 date has more than one rate, and the latest loaded was used"), shown


def test_the_app_reads_the_money_rate_table_so_the_access_plan_grants_it(agent_ns):
    rate = {"currency": "convert", "base": "USD", "rates": {"AED": 0.5}}
    assert agent_ns["implement_money_rate_tables"]({"money": rate}) == []
    rate_table = {"currency": "convert", "base": "USD", "rate_table": {"table": "main.fx.rates", "currency_column": "a", "base_column": "b",
                                                                       "date_column": "c", "rate_column": "d", "load_column": "e"}}
    assert agent_ns["implement_money_rate_tables"]({"money": rate_table}) == ["main.fx.rates"]
    assert agent_ns["implement_money_rate_tables"]({"money": dict(rate_table, off=True)}) == []


def test_off_removes_the_money_cards_from_what_the_app_lists(tmp_path):
    import v141_app_shell_test as shell_harness
    ws = shell_harness.ShapedWorkspace(lambda sql: None)
    page = dict(shell_harness.PAGE, money={"currency": "per_currency", "off": True})
    s = shell_harness.shell_core.Shell(shell_harness.app_dir(tmp_path, pages=[page]), env={"DATABRICKS_WAREHOUSE_ID": "wh1"},
                                       sp_factory=lambda: ws, user_factory=lambda h, t: ws)
    status, out = shell_harness.call(s, "GET", "app")
    assert status == 200
    listed = [k["id"] for p in out["pages"] for k in p.get("kpis") or []]
    assert listed and not any(k["format"] == "currency" for p in out["pages"] for k in p.get("kpis") or []), listed
