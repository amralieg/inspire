"""The value ledger table, its grant and its SQL, shared by the MVP job and the App server: one schema, one set of builders."""
import os
import sys
import types

import pytest

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_facts as F  # noqa: E402

TABLE = "`main`.`inspire`.`__inspire_value_ledger`"
VALUE_NAMES = [name for name in F.LEDGER_NAMES if name != "recorded_at"]


def _rows(sql):
    body = sql.split(" VALUES ", 1)[1]
    tuples = [t.split(", ") for t in body[1:-1].split("), (")]
    return [dict(zip(VALUE_NAMES, t[:-1])) for t in tuples]


def test_the_ledger_table_is_named_once_in_the_inspire_database():
    assert F.ledger_table("main.inspire") == TABLE
    with pytest.raises(ValueError):
        F.ledger_table("main.inspire`; DROP")


def test_the_create_statement_carries_every_column_once_with_its_type():
    sql = F.ledger_create_sql(TABLE)
    assert sql.startswith(f"CREATE TABLE IF NOT EXISTS {TABLE} (")
    for name, kind in F.LEDGER_COLUMNS:
        assert sql.count(f"`{name}` {kind}") == 1, name
    assert "`at_stake` DOUBLE" in sql and "`saved` DOUBLE" in sql and "`kind` STRING" in sql


def test_the_grants_are_select_and_modify_on_that_one_table_and_never_catalog_or_schema():
    statements = F.ledger_grant_sqls(TABLE, "app-sp-123")
    assert statements == [f"GRANT SELECT ON TABLE {TABLE} TO `app-sp-123`", f"GRANT MODIFY ON TABLE {TABLE} TO `app-sp-123`"]
    for sql in statements:
        assert "CATALOG" not in sql and "SCHEMA" not in sql
    assert F.ledger_grant_sqls(TABLE, "a`b")[1] == f"GRANT MODIFY ON TABLE {TABLE} TO `a``b`"
    with pytest.raises(ValueError):
        F.ledger_grant_sqls(TABLE, "   ")


def test_a_not_measured_amount_is_written_as_NULL_never_as_zero():
    row = F.ledger_stake_row("42", "main.out.queue", "N01-U01", "9001", "money", "EUR", None, None, "owner@x")
    values = _rows(F.ledger_insert_sql(TABLE, [row]))[0]
    assert values["at_stake"] == "NULL" and values["saved"] == "NULL"
    assert F.ledger_insert_sql(TABLE, [row]).endswith("current_timestamp())")


def test_a_stake_row_and_a_saved_row_carry_their_own_kind_measure_and_currency_or_unit():
    stake = _rows(F.ledger_insert_sql(TABLE, [F.ledger_stake_row("42", "t", "N01-U01", "9001", "money", "EUR", "", 1250.5)]))[0]
    assert stake["kind"] == "'money'" and stake["currency"] == "'EUR'" and stake["unit"] == "NULL" and stake["at_stake"] == "1250.5"
    hours = _rows(F.ledger_insert_sql(TABLE, [F.ledger_stake_row("42", "t", "N02-U01", "9001", "time", "", "hours", 7.0)]))[0]
    assert hours["kind"] == "'time'" and hours["unit"] == "'hours'" and hours["currency"] == "NULL" and hours["at_stake"] == "7.0"
    saved = _rows(F.ledger_insert_sql(TABLE, [F.ledger_saved_row("42", "t", "N01-U01", "9001", "rec-1", "money", "EUR", "", 300.0,
                                                                  "owner@x")]))[0]
    assert saved["record_key"] == "'rec-1'" and saved["saved"] == "300.0" and saved["at_stake"] == "NULL"


def test_many_rows_go_in_one_insert_statement_in_column_order():
    rows = [F.ledger_saved_row("42", "t", "N01-U01", "9001", f"rec-{i}", "money", "EUR", "", float(i)) for i in range(3)]
    sql = F.ledger_insert_sql(TABLE, rows)
    assert sql.count("INSERT INTO") == 1 and sql.count("current_timestamp()") == 3
    assert [r["record_key"] for r in _rows(sql)] == ["'rec-0'", "'rec-1'", "'rec-2'"]
    with pytest.raises(ValueError):
        F.ledger_insert_sql(TABLE, [])


def test_an_unknown_column_is_refused_before_any_SQL_is_built():
    with pytest.raises(ValueError):
        F.ledger_insert_sql(TABLE, [{"session_id": "1", "bogus": 1}])


def test_a_text_value_is_escaped_so_it_cannot_end_the_literal():
    row = F.ledger_saved_row("1", "t", "N'01", "9", "r'1", "money", "USD", "", 1.0, "o")
    sql = F.ledger_insert_sql(TABLE, [row])
    assert "'N\\'01'" in sql and "'r\\'1'" in sql


def test_the_stake_lookup_reads_only_the_latest_run_row_of_one_use_case_with_its_kind_and_currency():
    sql = F.ledger_latest_stake_sql(TABLE, "main.out.queue", "N01-U01")
    assert sql.startswith("SELECT session_id, run_id, kind, currency, unit FROM")
    assert "record_key IS NULL" in sql and "ORDER BY recorded_at DESC LIMIT 1" in sql
    assert "result_table = 'main.out.queue'" in sql and "use_case_id = 'N01-U01'" in sql


class _Spark:
    def __init__(self, fail=None):
        self.statements, self.fail = [], fail

    def sql(self, text):
        if self.fail and text.startswith(self.fail[0]):
            raise RuntimeError(self.fail[1])
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
    money, hours, days = (_rows(s)[0] for s in inserts)
    assert money["kind"] == "'money'" and money["currency"] == "'EUR'" and money["at_stake"] == "1250.5" and money["unit"] == "NULL"
    assert hours["kind"] == "'time'" and hours["unit"] == "'hours'" and hours["currency"] == "NULL" and hours["at_stake"] == "7.0"
    assert days["unit"] == "'days'" and days["at_stake"] == "NULL", "a not measured stake is NULL in at_stake, never 0"


def test_a_run_with_no_inspire_database_says_so_and_does_not_break_the_run(agent_ns, monkeypatch):
    _widgets(monkeypatch, agent_ns, {})
    said, spark = [], _Spark()
    agent_ns["inspire_record_stake"](spark, "main.out.queue", "N01-U01", "9001", {"value_at_stake": 1.0}, {"kind": "money", "currency": "EUR"},
                                    out=said.append)
    assert spark.statements == [] and "not recorded" in said[0]


def test_a_refused_ledger_write_is_reported_and_the_run_carries_on(agent_ns, monkeypatch):
    _widgets(monkeypatch, agent_ns, {"02_inspire_database": "main.inspire", "14_session_id": "42"})
    said = []
    agent_ns["inspire_record_stake"](_Spark(fail=("INSERT INTO", "PERMISSION_DENIED: no MODIFY on __inspire_value_ledger")), "main.out.queue",
                                    "N01-U01", "9001", {"value_at_stake": 1.0}, {"kind": "money", "currency": "EUR"}, out=said.append)
    assert "Value ledger: run 9001 is not recorded" in said[0] and "PERMISSION_DENIED" in said[0]


def test_the_app_deploy_creates_the_ledger_and_grants_its_service_principal_MODIFY_on_that_table_only(agent_ns):
    spark = _Spark()
    agent_ns["DatabricksInspire"]._implement_ledger_access(types.SimpleNamespace(spark=spark), "main.inspire", "sp-123")
    assert spark.statements == [F.ledger_create_sql(TABLE), f"GRANT SELECT ON TABLE {TABLE} TO `sp-123`",
                                f"GRANT MODIFY ON TABLE {TABLE} TO `sp-123`"]


def test_a_failed_ledger_grant_blocks_the_deploy_instead_of_leaving_a_live_App_that_cannot_count(agent_ns):
    spark = _Spark(fail=("GRANT SELECT", "PERMISSION_DENIED: only the owner can grant"))
    with pytest.raises(agent_ns["ImplementBlocked"], match="could not get MODIFY on the value ledger `main`.`inspire`.`__inspire_value_ledger`"):
        agent_ns["DatabricksInspire"]._implement_ledger_access(types.SimpleNamespace(spark=spark), "main.inspire", "sp-123")
