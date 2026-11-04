"""First run (decisions 5B and 6A): a use case whose main table holds more than 1,000 records runs first on a scope, chosen with
run settings that need no rebuild, one read helper in the Run controls cell narrows every source read to that scope, the build
refuses code that reads a source table any other way, each run records its scope and the records it read per table, and
schedules keep the scope until someone chooses all, offline."""
import json
import os
import re

import pytest

from _agentload import agent_source
from v120_artifacts_support import FakeSpark, make_inspire

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FIXTURE = json.load(open(os.path.join(ROOT, "tests", "fixtures", "implement_grouping_cases.json"), encoding="utf-8"))["first_run"]
ORDERS, STORES = "main.sales.orders", "main.sales.stores"


class Frame:
    def __init__(self, table, columns, steps=()):
        self.table, self.columns, self.steps = table, list(columns), list(steps)

    def where(self, condition):
        return Frame(self.table, self.columns, self.steps + [("where", condition)])

    def orderBy(self, column):
        return Frame(self.table, self.columns, self.steps + [("orderBy", column)])

    def limit(self, n):
        return Frame(self.table, self.columns, self.steps + [("limit", n)])


class Session(FakeSpark):
    def __init__(self, columns, responder=None):
        super().__init__(responder=responder)
        self.tables, self.columns_of = [], columns

    def table(self, name):
        self.tables.append(name)
        return Frame(name, self.columns_of.get(name, []))


def _scope(ns, **values):
    group_by = values.pop("group_by", None)
    held = {"INSPIRE_RUN": {"scope": dict(FIXTURE["spec"])}, "INSPIRE_SCOPE_VALUES": values}
    if group_by is not None:
        held["group_by"] = group_by
    return held


def test_the_four_first_run_settings_follow_the_contract_and_reach_the_run(agent_ns):
    settings = agent_ns["inspire_scope_settings"](dict(FIXTURE["spec"], default="groups"))
    assert [(s["name"], s["label"], s["kind"]) for s in settings] == [tuple(x) for x in FIXTURE["settings"]]
    assert all(s["group"] == "scope" and s["source"] == "widget" and s["applies"] == "run" for s in settings)
    run_scope, groups, days, records = settings
    assert run_scope["choices"] == ["all", "groups", "recent", "records", "custom"] and run_scope["default"] == "groups"
    assert groups["many"] and groups["optional"] and days["default"] == "30" and records["default"] == "1000"
    model = agent_ns["inspire_settings_model"]({"family": "B", "decision_basis": "measured", "first_run": dict(FIXTURE["spec"])}, [])
    assert [s["name"] for s in model] == ["run_scope", "scope_groups", "scope_days", "scope_records"]
    run = agent_ns["inspire_run_settings_model"](model)
    assert [s["name"] for s in run] == ["run_scope", "scope_groups", "scope_days", "scope_records"] and run[1]["optional"] is True
    assert agent_ns["inspire_settings_model"]({"family": "B", "decision_basis": "measured"}, []) == [], "no main table, no First run"


def test_an_empty_scope_groups_is_allowed_and_any_other_empty_choice_is_not(agent_ns):
    problem = agent_ns["inspire_setting_problem"]
    groups = agent_ns["inspire_scope_settings"](dict(FIXTURE["spec"]))[1]
    assert problem(groups, "") == "" and problem(groups, "EMEA, AMER") == ""
    assert problem(dict(groups, optional=False), "") == "scope_groups is ''; allowed: any text"
    assert problem(agent_ns["inspire_scope_settings"](dict(FIXTURE["spec"]))[0], "some") == (
        "run_scope is 'some'; allowed: all, groups, recent, records, custom")


@pytest.mark.parametrize("case", FIXTURE["default"], ids=[c["name"] for c in FIXTURE["default"]])
def test_the_default_runs_first_on_a_scope_only_above_1000_records(agent_ns, case):
    assert agent_ns["inspire_default_scope"](case["records"]) == case["expected"]
    assert case["expected"] not in ("recent", "groups", "") and (case["records"] is not None and case["records"] <= 1000 or case["expected"] != "all")


def test_the_record_count_comes_from_table_metadata_and_never_from_a_scan_of_a_non_delta_table(agent_ns):
    stats = FakeSpark(responder=lambda s: [{"col_name": "Statistics", "data_type": "88231 bytes, 1840 rows"}] if s.startswith("DESCRIBE TABLE") else [])
    assert agent_ns["inspire_metadata_rows"](stats, ORDERS) == 1840 and stats.statements == ["DESCRIBE TABLE EXTENDED `main`.`sales`.`orders`"]

    write = lambda op, mode, n: {"operation": op, "operationParameters": {"mode": mode} if mode else {},
                                 "operationMetrics": {} if n is None else {"numOutputRows": str(n)}}
    history = [write("WRITE", "Append", 300), write("OPTIMIZE", "", None), write("WRITE", "Append", 200),
               write("CREATE OR REPLACE TABLE AS SELECT", "", 501)]
    logged = FakeSpark(responder=lambda s: history if s.startswith("DESCRIBE HISTORY") else [])
    assert agent_ns["inspire_metadata_rows"](logged, ORDERS) == 1001
    assert logged.statements == ["DESCRIBE TABLE EXTENDED `main`.`sales`.`orders`", "DESCRIBE HISTORY `main`.`sales`.`orders` LIMIT 100"]
    counted = agent_ns["inspire_history_rows"]
    assert counted([write("WRITE", "Append", 40), {"operation": "CREATE TABLE"}]) == 40
    assert counted([write("WRITE", "Overwrite", 2000), write("WRITE", "Append", 9)]) == 2000
    assert counted([write("MERGE", "", 12), write("CREATE TABLE AS SELECT", "", 900)]) is None, "a merge leaves the count unknown"
    assert counted([write("WRITE", "Append", 5)]) is None, "history cut before the table was made leaves the count unknown"
    assert counted([write("CREATE TABLE AS SELECT", "", None)]) is None
    assert [counted([write(op, "", 77)]) for op in ("CREATE TABLE AS SELECT", "REPLACE TABLE AS SELECT", "CREATE OR REPLACE TABLE AS SELECT")] == [77, 77, 77]
    assert counted([write("RESTORE", "", 5), {"operation": "CREATE TABLE"}]) is None, "only a table built from a query replaces the count"
    for answer in ([], [write("DELETE", "", None)]):
        unknown = FakeSpark(responder=lambda s, answer=answer: answer if s.startswith("DESCRIBE HISTORY") else [])
        assert agent_ns["inspire_metadata_rows"](unknown, ORDERS) is None
        assert all(s.startswith("DESCRIBE") for s in unknown.statements), "a table whose metadata holds no count is never scanned"

    def broken(statement):
        raise RuntimeError("TABLE_OR_VIEW_NOT_FOUND")
    assert agent_ns["inspire_metadata_rows"](FakeSpark(responder=broken), ORDERS) is None


def test_the_build_reads_the_main_table_s_count_once_and_writes_the_scope_into_the_run(agent_ns):
    inst = make_inspire(agent_ns, spark=FakeSpark(responder=lambda s: [{"col_name": "Statistics", "data_type": "1 bytes, 5000 rows"}]
                                                   if s.startswith("DESCRIBE TABLE") else []))
    use_case = {"Primary Table": ORDERS, "Tables Involved": f"{ORDERS}, {STORES}",
                "elite_assessment": {"time_column": "orders.order_date", "entity_key_column": "orders.order_id"},
                "_implement_data": {"filters": [{"table": ORDERS, "column": "region", "values": []}]}}
    first = inst._genie_first_run(use_case, "E", "Time Series Forecasting", "monthly")
    assert first == {"table": ORDERS, "records": 5000, "technique": "Time Series Forecasting", "time_series": True,
                     "time_column": "order_date", "group_column": "region", "key_column": "order_id", "period": "month", "default": "records"}
    inst._genie_first_run(use_case, "E", "Time Series Forecasting", "monthly")
    assert len([s for s in inst.spark.statements if s.startswith("DESCRIBE TABLE")]) == 1, "the count is read once per table"
    template = agent_ns["GENIE_RUN_CONTROLS_TEMPLATE"]
    assert 'INSPIRE_SCOPE_VALUES = {"run_scope": (INSPIRE_RUN.get("scope") or {}).get("default", INSPIRE_SCOPES[0]) or ""' in template
    assert not re.search(r"^(run_scope|scope_groups|scope_days|scope_records) =", template, re.M), \
        "the Run controls bind no generic name Genie Code could also bind"
    assert template.index("inspire_check_settings_read(run") < template.index("inspire_scope_start(") < template.index("outcome = use_case()")


@pytest.mark.parametrize("case", FIXTURE["refused"], ids=[c["name"] for c in FIXTURE["refused"]])
def test_a_scope_the_use_case_cannot_run_is_refused_with_the_reason(agent_ns, case):
    held = _scope(agent_ns, **case["settings"])
    held["INSPIRE_RUN"]["scope"].update(case.get("spec") or {})
    with pytest.raises(ValueError) as caught:
        agent_ns["inspire_scope_choice"](scope=held)
    assert str(caught.value).startswith(case["reason"]), str(caught.value)
    assert "; choose" in str(caught.value), "every refusal says what to choose instead"


@pytest.mark.parametrize("case", FIXTURE["scope_column"], ids=[c["name"] for c in FIXTURE["scope_column"]])
def test_groups_run_on_the_finest_column_of_the_grouping(agent_ns, case):
    held = _scope(agent_ns, run_scope="groups", scope_groups="EMEA", group_by=case["group_by"])
    if case.get("refused"):
        with pytest.raises(ValueError) as caught:
            agent_ns["inspire_scope_choice"](scope=held)
        assert str(caught.value).startswith(case["refused"]) and "; choose" in str(caught.value)
    else:
        assert agent_ns["inspire_scope_choice"](scope=held)["column"] == case["expected"]


def test_the_scope_key_carries_the_grouping_hash_so_runs_grouped_another_way_are_never_compared(fresh_ns):
    key = fresh_ns["inspire_scope_key"]
    groups = {"scope": "groups", "table": ORDERS, "column": "region", "values": ["EMEA"]}
    assert key(groups, "a" * 64) == key(groups, "a" * 64) and key(groups, "a" * 64) != key(groups, "b" * 64) != key(groups)
    assert key(groups, "a" * 64).endswith("|grouping:" + "a" * 16) and key({"scope": "all"}, "c" * 64) == "all|grouping:" + "c" * 16
    assert key({"scope": "all"}) == "all", "a run that grouped nothing keeps its plain key"
    fresh_ns["INSPIRE_RUN"] = {"source_tables": [], "segments": [], "scope": dict(FIXTURE["spec"])}
    fresh_ns["INSPIRE_RUN_LOG"] = {"started_us": None, "trigger": "schedule", "written": [], "scope": {"scope": "all", "table": ORDERS}}
    fresh_ns["INSPIRE_RUN_GROUPING"] = {"mode": "columns", "group_by": ["region"], "hash": "d" * 64, "groups": 3}
    values = fresh_ns["inspire_save_run_log"](FakeSpark(), "main.inspire.churn_out", "N01-U01", "r-9", lambda m: None)
    assert json.loads(values["run_segments"][1:-1].replace("''", "'"))[0]["key"] == "all|grouping:" + "d" * 16


def test_the_read_helper_narrows_every_source_read_to_the_scope(fresh_ns):
    fresh_ns["INSPIRE_SCOPE"] = {"scope": "groups", "table": ORDERS, "column": "region", "values": ["EMEA", "APAC"]}
    fresh_ns["INSPIRE_RUN_LOG"] = {}
    session = Session({"`main`.`sales`.`orders`": ["order_id", "Region", "amount"], "`main`.`sales`.`stores`": ["store_id", "city"]})
    orders = fresh_ns["inspire_read_source"](ORDERS, spark=session)
    stores = fresh_ns["inspire_read_source"]("`main`.`sales`.`stores`", spark=session)
    assert orders.steps == [("where", "CAST(`Region` AS STRING) IN ('EMEA', 'APAC')")]
    assert stores.steps == [], "a table without the grouping column is read whole, and the join narrows it"
    assert fresh_ns["INSPIRE_RUN_LOG"]["reads"] == {"main.sales.orders": {"where": "CAST(`Region` AS STRING) IN ('EMEA', 'APAC')", "limit": None},
                                                    "main.sales.stores": {"where": "", "limit": None}}
    fresh_ns["INSPIRE_SCOPE"] = {"scope": "recent", "table": ORDERS, "column": "order_date", "since": "2026-10-02"}
    assert fresh_ns["inspire_read_source"](ORDERS, spark=Session({"`main`.`sales`.`orders`": ["order_date"]})).steps == [
        ("where", "CAST(`order_date` AS DATE) >= DATE '2026-10-02'")]
    fresh_ns["INSPIRE_SCOPE"] = {"scope": "records", "table": ORDERS, "records": 1000, "key": "order_id"}
    columns = {"`main`.`sales`.`orders`": ["order_id"], "`main`.`sales`.`stores`": ["order_id"]}
    assert fresh_ns["inspire_read_source"](ORDERS, spark=Session(columns)).steps == [("orderBy", "order_id"), ("limit", 1000)]
    assert fresh_ns["inspire_read_source"](STORES, spark=Session(columns)).steps == [], "only the main table is cut to N records"
    fresh_ns.pop("INSPIRE_SCOPE")
    assert fresh_ns["inspire_read_source"](ORDERS, spark=Session(columns)).steps == [], "with no scope the helper reads everything"


def test_the_recent_period_keeps_at_least_30_periods_of_a_time_series(agent_ns):
    chosen = {"scope": "recent", "table": ORDERS, "column": "order_date", "days": 30, "period": "month", "time_series": True}
    sql = agent_ns["inspire_scope_recent_sql"](ORDERS, chosen)
    assert "DATE_SUB(MAX(d), 29) AS by_days" in sql and "DATE_TRUNC('MONTH', d)" in sql and "ORDER BY p DESC LIMIT 30" in sql
    answer = lambda rows: FakeSpark(responder=lambda s: rows if s.startswith("WITH dated AS") else [])
    widened = agent_ns["inspire_scope_resolve"](answer([{"by_days": "2026-10-03", "by_periods": "2024-05-01"}]), chosen)
    assert (widened["since"], widened["widened"]) == ("2024-05-01", True), "30 days of a monthly series widen to 30 months"
    kept = agent_ns["inspire_scope_resolve"](answer([{"by_days": "2026-10-03", "by_periods": "2026-10-20"}]), chosen)
    assert (kept["since"], kept["widened"]) == ("2026-10-03", False)
    flat = agent_ns["inspire_scope_resolve"](answer([{"by_days": "2026-10-03", "by_periods": "2024-05-01"}]), dict(chosen, time_series=False))
    assert flat["since"] == "2026-10-03", "a technique that is not a time series keeps the days it was given"
    with pytest.raises(ValueError, match="found no date in order_date"):
        agent_ns["inspire_scope_resolve"](answer([{"by_days": None, "by_periods": None}]), chosen)


def test_groups_left_empty_run_on_the_three_largest(agent_ns):
    asked = []

    def respond(statement):
        asked.append(statement)
        return [{"g": "EMEA", "n": 900}, {"g": "AMER", "n": 400}, {"g": "APAC", "n": 90}]
    chosen = agent_ns["inspire_scope_resolve"](FakeSpark(responder=respond), {"scope": "groups", "table": ORDERS, "column": "region",
                                                                              "values": []})
    assert chosen["values"] == ["EMEA", "AMER", "APAC"] and chosen["suggested"] is True
    assert asked == ["SELECT CAST(`region` AS STRING) AS g, COUNT(*) AS n FROM `main`.`sales`.`orders` WHERE `region` IS NOT NULL GROUP BY "
                     "CAST(`region` AS STRING) ORDER BY n DESC, g LIMIT 3"]


def test_each_run_records_its_scope_and_the_records_it_read_per_table(fresh_ns):
    fresh_ns["INSPIRE_RUN"] = {"source_tables": [ORDERS, STORES], "segments": [], "scope": dict(FIXTURE["spec"])}
    log = {"started_us": None, "trigger": "schedule", "written": [], "reads": {
        "main.sales.orders": {"where": "CAST(`region` AS STRING) IN ('EMEA')", "limit": None}, "main.sales.stores": {"where": "", "limit": None}},
        "scope": {"scope": "groups", "table": ORDERS, "column": "region", "values": ["EMEA"], "suggested": True}}
    fresh_ns["INSPIRE_RUN_LOG"] = log

    def respond(statement):
        if statement.startswith("SELECT COUNT(*) AS n FROM `main`.`sales`.`orders` WHERE"):
            return [{"n": 900}]
        if statement.startswith("SELECT COUNT(*) AS n FROM `main`.`sales`.`orders`"):
            return [{"n": 48000}]
        return [{"n": 12}] if statement.startswith("SELECT COUNT(*)") else []
    spark, printed = FakeSpark(responder=respond), []
    values = fresh_ns["inspire_save_run_log"](spark, "main.inspire.churn_out", "N01-U01", "r-9", printed.append)
    tables = json.loads(json.loads(json.dumps(values["run_tables"]))[1:-1].replace("''", "'"))
    assert tables[0] == {"table": ORDERS, "rows": 900, "rows_total": 48000, "scoped": True, "read_by_helper": True, "updated_at": None}
    assert tables[1] == {"table": STORES, "rows": 12, "rows_total": 12, "scoped": False, "read_by_helper": True, "updated_at": None}
    segments = json.loads(values["run_segments"][1:-1].replace("''", "'"))
    assert segments == [{"scope": "groups", "key": fresh_ns["inspire_scope_key"](log["scope"]), "text": "the 1 group EMEA of region",
                         "table": ORDERS, "column": "region", "values": ["EMEA"], "suggested": True}]
    assert segments[0]["key"].startswith("groups:") and len(segments[0]["key"]) == len("groups:") + 16
    keys = {fresh_ns["inspire_scope_key"](dict(log["scope"], **change)) for change in ({}, {"values": ["AMER"]}, {"column": "country"})}
    assert len(keys) == 3 and fresh_ns["inspire_scope_key"]({"scope": "all"}) == "all"
    recent = {"scope": "recent", "table": ORDERS, "column": "order_date", "days": 30}
    assert fresh_ns["inspire_scope_key"](dict(recent, since="2026-10-01")) == fresh_ns["inspire_scope_key"](dict(recent, since="2026-10-08")), \
        "a recent period keeps its scope as its dates move on"
    assert printed[-1].endswith("its First run covering the 1 group EMEA of region")
    log["reads"] = {"main.sales.orders": {"where": "", "limit": 1000}}
    capped = FakeSpark(responder=respond)
    first = fresh_ns["inspire_run_tables"](capped, fresh_ns["INSPIRE_RUN"])[0]
    assert (first["rows"], first["rows_total"], first["scoped"]) == (1000, 48000, True), "N records read is capped at N, counted with no row read"
    assert all(s.startswith("SELECT COUNT(*) AS n FROM") for s in capped.statements if s.startswith("SELECT"))


def test_schedules_keep_the_scope_until_someone_chooses_all(fresh_ns):
    run = {"scope": dict(FIXTURE["spec"], default="groups"), "settings": fresh_ns["inspire_run_settings_model"](
        fresh_ns["inspire_scope_settings"](dict(FIXTURE["spec"], default="groups"))), "settings_read": False}
    for saved, expected in (([], "groups"), ([("run_scope", "groups")], "groups"), ([("run_scope", "all")], "all")):
        values = {"run_scope": "groups", "scope_groups": "", "scope_days": 30, "scope_records": 1000}
        scope = {"INSPIRE_RUN": run, "INSPIRE_SCOPE_VALUES": values}
        rows = [{"name": name, "value": None, "text_value": value, "changed_by": "ana@example.com", "changed_at": None} for name, value in saved]

        def respond(statement, rows=rows):
            return rows if "ROW_NUMBER() OVER (PARTITION BY name" in statement else []
        fresh_ns["inspire_apply_assumptions"](FakeSpark(responder=respond), "main.inspire.churn_out", "N01-U01", scope=scope, out=lambda m: None)
        assert values["run_scope"] == expected and "run_scope" not in scope, (saved, values)
        assert fresh_ns["inspire_scope_choice"](run, scope)["scope"] == expected
    assert "run_scope" not in json.dumps(agent_source().split("\"scheduled_overrides\": {", 1)[1].split("}", 1)[0]), \
        "a schedule passes no scope of its own, so it never widens one"
    assert fresh_ns["inspire_unread_settings"]({}, dict(run, settings_read=True)) == [], "the Run controls read the scope settings themselves"


@pytest.mark.parametrize("case", FIXTURE["build_check"], ids=[c["name"] for c in FIXTURE["build_check"]])
def test_the_build_refuses_code_that_reads_a_source_table_without_the_helper(agent_ns, case):
    problems = agent_ns["implement_source_read_problems"]([("cell 3", case["code"])], [ORDERS, STORES])
    if case["refused"]:
        assert len(problems) == 1 and problems[0].startswith(case["said"]), problems
        assert agent_ns["GENIE_SOURCE_READ_RULE"] in problems[0]
    else:
        assert problems == [], problems


def test_every_instruction_tells_genie_to_read_sources_through_the_helper(agent_ns):
    source = agent_source()
    assert "rules = ([GENIE_RUN_CONTROLS_RULE, GENIE_SOURCE_READ_RULE," in source
    assert "+ implement_source_read_problems(cells, sources))" in source
    assert "sources=implement_source_tables(spec, self._genie_involved_tables(use_case))," in source


WEB_SALES, DATE_DIM = "samples.tpcds_sf1.web_sales", "samples.tpcds_sf1.date_dim"
VIA = {"table": DATE_DIM, "key": "d_date_sk", "date": "d_date"}


def _rows(pairs):
    return [{"column_name": name, "data_type": kind} for name, kind in pairs]


def test_the_shared_constants_of_the_first_run_are_the_ones_the_agent_uses(agent_ns):
    constants = json.load(open(os.path.join(ROOT, "tests", "fixtures", "implement_grouping_cases.json"), encoding="utf-8"))["constants"]
    assert agent_ns["INSPIRE_SCOPE_VIA_KEYS_MAX"] == constants["scope_via_keys_max"]
    assert agent_ns["INSPIRE_FIRST_RUN_RECORDS"] == constants["first_run_records_line"]


@pytest.mark.parametrize("case", FIXTURE["time_source"], ids=[c["name"] for c in FIXTURE["time_source"]])
def test_the_time_column_is_a_dated_column_or_a_date_key_reached_through_a_dated_table(agent_ns, case):
    refs = {ref.lower(): _rows(pairs) for ref, pairs in case["ref_columns"].items()}
    assert agent_ns["inspire_time_source"](case["named"], _rows(case["columns"]), case["joins"], refs) == case["expected"]


@pytest.mark.parametrize("case", FIXTURE["named_time"], ids=[c["name"] for c in FIXTURE["named_time"]])
def test_the_named_time_column_comes_from_the_roles_then_the_judged_date_key_then_the_judged_column(agent_ns, case):
    assert agent_ns["inspire_named_time_column"](case["roles"], case["assessment"], case["table"]) == case["expected"]


@pytest.mark.parametrize("case", FIXTURE["time_refs"], ids=[c["name"] for c in FIXTURE["time_refs"]])
def test_only_the_tables_a_date_key_joins_are_asked_for_their_columns(agent_ns, case):
    assert agent_ns["inspire_time_refs"](case["named"], _rows(case["columns"]), case["joins"]) == case["expected"]


class _ArgSpark(FakeSpark):
    def __init__(self, records, columns):
        super().__init__(responder=self._answer)
        self.records, self.columns, self.asked = records, columns, []

    def sql(self, statement, *args, **kwargs):
        self._args = kwargs.get("args") or {}
        return super().sql(statement, *args, **kwargs)

    def _answer(self, statement):
        if statement.startswith("DESCRIBE TABLE"):
            return [] if self.records is None else [{"col_name": "Statistics", "data_type": f"1 bytes, {self.records} rows"}]
        if "information_schema" in statement:
            self.asked.append(self._args.get("t"))
            return self.columns.get(self._args.get("t"), [])
        return []


WS_COLUMNS = {"web_sales": _rows([("ws_sold_date_sk", "int"), ("ws_ship_date_sk", "int"), ("ws_warehouse_sk", "int"), ("ws_quantity", "int")]),
              "date_dim": _rows([("d_date_sk", "int"), ("d_date_id", "string"), ("d_date", "date")])}
WS_JOINS = json.dumps([{"table": WEB_SALES, "column": c, "ref_table": DATE_DIM, "ref_column": "d_date_sk", "source": "inferred"}
                       for c in ("ws_sold_date_sk", "ws_ship_date_sk")])
WS_ASSESSMENT = {"time_column": f"{WEB_SALES}.ws_ship_date_sk", "entity_key_column": f"{WEB_SALES}.ws_warehouse_sk",
                 "time_via_join": {"key": f"{WEB_SALES}.ws_ship_date_sk", "table": DATE_DIM, "column": f"{DATE_DIM}.d_date",
                                   "join": f"{WEB_SALES}.ws_ship_date_sk = {DATE_DIM}.d_date_sk"}}


@pytest.mark.parametrize("records, expected", [(999, "all"), (1000, "all"), (1001, "records"), (718931, "records"), (None, "records")])
def test_a_fact_table_dated_only_through_its_date_dimension_offers_a_recent_period_and_runs_first_on_about_1000_records(agent_ns, records, expected):
    inst = make_inspire(agent_ns, spark=_ArgSpark(records, WS_COLUMNS))
    use_case = {"Primary Table": WEB_SALES, "Tables Involved": f"{WEB_SALES}, {DATE_DIM}", "table_joins": WS_JOINS, "elite_assessment": WS_ASSESSMENT}
    first = inst._genie_first_run(use_case, "G", "Optimization", "weekly")
    assert (first["records"], first["time_column"], first.get("time_via"), first["default"]) == (records, "ws_ship_date_sk", VIA, expected)
    assert inst.spark.asked == ["web_sales", "date_dim"], "the main table and the one date table are read once each"


def test_a_fact_table_with_no_date_and_no_dated_join_runs_first_on_about_1000_of_its_718931_records(agent_ns):
    inst = make_inspire(agent_ns, spark=_ArgSpark(718931, WS_COLUMNS))
    use_case = {"Primary Table": WEB_SALES, "Tables Involved": WEB_SALES, "table_joins": "[]",
                "elite_assessment": {"time_column": f"{WEB_SALES}.ws_ship_date_sk"}}
    first = inst._genie_first_run(use_case, "G", "Optimization", "weekly")
    assert (first["time_column"], "time_via" in first, first["default"]) == ("", False, "records"), \
        "an integer date key with no join to a dated table is never read as a date, and 718,931 records never default to everything (must-exclude)"


def _via_scope(ns, **values):
    held = _scope(ns, run_scope="recent", **values)
    held["INSPIRE_RUN"]["scope"].update(table=WEB_SALES, time_column="ws_ship_date_sk", time_via=dict(VIA), group_column="", default="recent")
    return held


def test_a_recent_period_through_a_date_table_reads_the_keys_of_its_newest_days(agent_ns):
    chosen = agent_ns["inspire_scope_choice"](scope=_via_scope(agent_ns))
    assert (chosen["column"], chosen["via"], chosen["days"]) == ("ws_ship_date_sk", VIA, 30)
    asked = []

    def respond(statement):
        asked.append(statement)
        if statement.startswith("WITH dated AS"):
            return [{"by_days": "2003-01-03", "newest": "2003-02-01", "by_periods": None}]
        return [{"k": str(2452640 + i)} for i in range(30)] if statement.startswith("SELECT DISTINCT") else []
    resolved = agent_ns["inspire_scope_resolve"](FakeSpark(responder=respond), chosen)
    assert (resolved["since"], resolved["newest"], len(resolved["keys"])) == ("2003-01-03", "2003-02-01", 30)
    assert asked[0].startswith("WITH dated AS (SELECT CAST(r.`d_date` AS DATE) AS d FROM `samples`.`tpcds_sf1`.`web_sales` m JOIN "
                               "`samples`.`tpcds_sf1`.`date_dim` r ON m.`ws_ship_date_sk` = r.`d_date_sk` WHERE m.`ws_ship_date_sk` IS NOT NULL)")
    assert asked[1] == ("SELECT DISTINCT CAST(`d_date_sk` AS STRING) AS k FROM `samples`.`tpcds_sf1`.`date_dim` WHERE CAST(`d_date` AS DATE) >= "
                        "DATE '2003-01-03' AND CAST(`d_date` AS DATE) <= DATE '2003-02-01' AND `d_date_sk` IS NOT NULL ORDER BY k LIMIT 10001")
    where = agent_ns["inspire_scope_where"](resolved, ["ws_ship_date_sk", "ws_quantity"])
    assert where.startswith("CAST(`ws_ship_date_sk` AS STRING) IN ('2452640', '2452641'") and where.endswith("'2452669')")
    assert agent_ns["inspire_scope_text"](resolved) == f"the records of ws_ship_date_sk whose d_date in {DATE_DIM} is since 2003-01-03"
    assert agent_ns["inspire_scope_record"](resolved)["via"] == VIA
    assert agent_ns["inspire_scope_key"](resolved) != agent_ns["inspire_scope_key"](dict(resolved, via=None)), \
        "a period read through a date table is another scope than the same column read as a date"


@pytest.mark.parametrize("via", [{"table": DATE_DIM, "key": "d_date_sk"}, {"table": DATE_DIM, "key": " ", "date": "d_date"},
                                 {"table": "date_dim", "key": "d_date_sk", "date": "d_date"}, "date_dim"])
def test_a_date_table_named_only_in_part_is_refused_before_any_query(agent_ns, via):
    held = _via_scope(agent_ns)
    held["INSPIRE_RUN"]["scope"]["time_via"] = via
    with pytest.raises(ValueError) as caught:
        agent_ns["inspire_scope_choice"](scope=held)
    assert "names only in part" in str(caught.value) or "three-level table name" in str(caught.value)


def test_a_date_table_name_is_held_without_backticks_or_spaces(agent_ns):
    held = _via_scope(agent_ns)
    held["INSPIRE_RUN"]["scope"]["time_via"] = {"table": " `samples`.`tpcds_sf1`.`date_dim` ", "key": " d_date_sk", "date": "d_date "}
    assert agent_ns["inspire_scope_choice"](scope=held)["via"] == VIA


@pytest.mark.parametrize("keys, said", [(0, "no d_date_sk there falls since 2003-01-03"),
                                        (10001, "more than 10,000 values of d_date_sk fall since 2003-01-03")])
def test_a_recent_period_through_a_date_table_with_no_key_or_too_many_is_refused(agent_ns, keys, said):
    chosen = agent_ns["inspire_scope_choice"](scope=_via_scope(agent_ns))

    def respond(statement):
        if statement.startswith("WITH dated AS"):
            return [{"by_days": "2003-01-03", "newest": "2003-02-01", "by_periods": None}]
        return [{"k": str(i)} for i in range(keys)] if statement.startswith("SELECT DISTINCT") else []
    with pytest.raises(ValueError) as caught:
        agent_ns["inspire_scope_resolve"](FakeSpark(responder=respond), chosen)
    assert said in str(caught.value) and "; choose fewer days, groups or all on the Run page" in str(caught.value)
