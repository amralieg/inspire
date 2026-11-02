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
    assert run_scope["choices"] == ["all", "groups", "recent", "records"] and run_scope["default"] == "groups"
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
        "run_scope is 'some'; allowed: all, groups, recent, records")


@pytest.mark.parametrize("case", FIXTURE["default"], ids=[c["name"] for c in FIXTURE["default"]])
def test_the_default_runs_first_on_a_scope_only_above_1000_records(agent_ns, case):
    got = agent_ns["inspire_default_scope"](case["records"], case["technique"], case["time_series"], case["time_column"],
                                           case["group_column"])
    assert got == case["expected"]


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
                     "time_column": "order_date", "group_column": "region", "key_column": "order_id", "period": "month", "default": "recent"}
    inst._genie_first_run(use_case, "E", "Time Series Forecasting", "monthly")
    assert len([s for s in inst.spark.statements if s.startswith("DESCRIBE TABLE")]) == 1, "the count is read once per table"
    template = agent_ns["GENIE_RUN_CONTROLS_TEMPLATE"]
    assert 'INSPIRE_SCOPE_VALUES = {"run_scope": (INSPIRE_RUN.get("scope") or {}).get("default") or INSPIRE_SCOPES[0]' in template
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
