"""The value ledger table, its grant and its SQL, shared by the MVP job and the App server: one schema, one set of builders."""
import os
import sys

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_facts as F  # noqa: E402

TABLE = "`main`.`inspire`.`__inspire_value_ledger`"


def test_the_ledger_table_is_named_once_in_the_inspire_database():
    assert F.ledger_table("main.inspire") == TABLE
    with pytest.raises(ValueError):
        F.ledger_table("main.inspire`; DROP")


def test_the_create_statement_carries_every_column_once_with_its_type():
    sql = F.ledger_create_sql(TABLE)
    assert sql.startswith(f"CREATE TABLE IF NOT EXISTS {TABLE} (")
    for name, kind in F.LEDGER_COLUMNS:
        assert sql.count(f"`{name}` {kind}") == 1, name
    assert "`at_stake` DOUBLE" in sql and "`saved` DOUBLE" in sql


def test_the_grant_is_modify_on_that_one_table_and_never_catalog_or_schema():
    sql = F.ledger_grant_sql(TABLE, "app-sp-123")
    assert sql == f"GRANT MODIFY ON TABLE {TABLE} TO `app-sp-123`"
    assert "CATALOG" not in sql and "SCHEMA" not in sql
    assert F.ledger_grant_sql(TABLE, "a`b") == f"GRANT MODIFY ON TABLE {TABLE} TO `a``b`"
    with pytest.raises(ValueError):
        F.ledger_grant_sql(TABLE, "   ")


def test_a_not_measured_amount_is_written_as_NULL_never_as_zero():
    row = F.ledger_stake_row("42", "main.out.queue", "N01-U01", "9001", "USD", "", None, "owner@x")
    sql = F.ledger_insert_sql(TABLE, row)
    assert "NULL" in sql.split("VALUES")[1].split(",")[7]
    assert sql.endswith("current_timestamp())")
    assert "`saved`" in sql and "`record_key`" in sql


def test_a_stake_row_and_a_saved_row_carry_their_own_measure_and_currency_and_unit():
    stake = F.ledger_insert_sql(TABLE, F.ledger_stake_row("42", "t", "N01-U01", "9001", "EUR", "", 1250.5))
    assert "1250.5" in stake and "'EUR'" in stake
    hours = F.ledger_insert_sql(TABLE, F.ledger_stake_row("42", "t", "N02-U01", "9001", "", "hours", 7.0))
    assert "'hours'" in hours and "'EUR'" not in hours
    saved = F.ledger_insert_sql(TABLE, F.ledger_saved_row("42", "t", "N01-U01", "9001", "rec-1", "EUR", "", 300.0, "owner@x"))
    assert "'rec-1'" in saved and "300.0" in saved and "1250.5" not in saved


def test_an_unknown_column_is_refused_before_any_SQL_is_built():
    with pytest.raises(ValueError):
        F.ledger_insert_sql(TABLE, {"session_id": "1", "bogus": 1})


def test_a_text_value_is_escaped_so_it_cannot_end_the_literal():
    row = F.ledger_saved_row("1", "t", "N'01", "9", "r'1", "USD", "", 1.0, "o")
    sql = F.ledger_insert_sql(TABLE, row)
    assert "'N\\'01'" in sql and "'r\\'1'" in sql


def test_the_stake_lookup_reads_only_the_latest_run_row_of_one_use_case():
    sql = F.ledger_latest_stake_sql(TABLE, "main.out.queue", "N01-U01")
    assert "record_key IS NULL" in sql and "ORDER BY recorded_at DESC LIMIT 1" in sql
    assert "result_table = 'main.out.queue'" in sql and "use_case_id = 'N01-U01'" in sql


def test_the_totals_take_the_latest_stake_per_use_case_and_the_latest_save_per_record_then_sum_by_currency_and_unit():
    sql = F.ledger_totals_sql(TABLE, ["42", "41"])
    assert "PARTITION BY session_id, result_table, use_case_id ORDER BY recorded_at DESC" in sql
    assert "PARTITION BY session_id, result_table, use_case_id, record_key ORDER BY recorded_at DESC" in sql
    assert "SUM(saved)" in sql and "GROUP BY session_id, use_case_id, currency, unit" in sql
    assert "session_id IN ('42', '41')" in sql
    assert "saved IS NOT NULL" in sql


class _Spark:
    def __init__(self, fail=False):
        self.statements, self.fail = [], fail

    def sql(self, text):
        if self.fail:
            raise RuntimeError("PERMISSION_DENIED: no MODIFY on __inspire_value_ledger")
        self.statements.append(text)
        return []


def _widgets(monkeypatch, agent_ns, values):
    monkeypatch.setitem(agent_ns, "inspire_widget", lambda name, default="": values.get(name, default))


def test_a_finished_run_writes_its_money_stake_and_its_hours_stake_apart_in_the_ledger(agent_ns, monkeypatch):
    _widgets(monkeypatch, agent_ns, {"02_inspire_database": "main.inspire", "14_session_id": "42"})
    spark, record = _Spark(), agent_ns["inspire_record_stake"]
    record(spark, "main.out.queue", "N01-U01", "9001", {"value_at_stake": 1250.5}, {"kind": "money", "currency": "EUR"})
    record(spark, "main.out.hours", "N02-U01", "9001", {"value_at_stake": 7}, {"kind": "time", "unit": "hours"})
    record(spark, "main.out.hours2", "N03-U01", "9001", {"value_at_stake": None}, {"kind": "time", "unit": "days"})
    created = [s for s in spark.statements if s.startswith("CREATE TABLE IF NOT EXISTS `main`.`inspire`.`__inspire_value_ledger`")]
    inserts = [s for s in spark.statements if s.startswith("INSERT INTO `main`.`inspire`.`__inspire_value_ledger`")]
    assert len(created) == 3 and len(inserts) == 3
    money, hours, days = inserts
    assert "'EUR'" in money and "1250.5" in money and "'hours'" not in money
    assert "'hours'" in hours and "'EUR'" not in hours and ", 7.0," in hours
    assert "'days', NULL, NULL, NULL, current_timestamp()" in days, "a not measured stake is NULL in at_stake, never 0"


def test_a_run_with_no_inspire_database_says_so_and_does_not_break_the_run(agent_ns, monkeypatch):
    _widgets(monkeypatch, agent_ns, {})
    said, spark = [], _Spark()
    agent_ns["inspire_record_stake"](spark, "main.out.queue", "N01-U01", "9001", {"value_at_stake": 1.0}, {"kind": "money", "currency": "EUR"},
                                    out=said.append)
    assert spark.statements == [] and "not recorded" in said[0]


def test_a_refused_ledger_write_is_reported_and_the_run_carries_on(agent_ns, monkeypatch):
    _widgets(monkeypatch, agent_ns, {"02_inspire_database": "main.inspire", "14_session_id": "42"})
    said = []
    agent_ns["inspire_record_stake"](_Spark(fail=True), "main.out.queue", "N01-U01", "9001", {"value_at_stake": 1.0},
                                    {"kind": "money", "currency": "EUR"}, out=said.append)
    assert "Value ledger: run 9001 is not recorded" in said[0] and "PERMISSION_DENIED" in said[0]
