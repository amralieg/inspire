"""v1.3.1 CONCURRENT MIGRATION: two runs on one Inspire database migrate its shared tables at once.

Live run 2026-11-03 (two Discover runs started together on one database): both added table_joins to
__inspire_usecases in the same second, the second ALTER failed with DELTA_METADATA_CHANGED, and that
run wrote all its use cases without table_joins although the column was there. Every table the agent
migrates goes through AtomicWriter.add_missing_columns, which re-reads the columns after a failed
ALTER, keeps a column another run added, tries a concurrent-update conflict again and reports only a
column that is still missing.
"""
import ast
import pathlib
import re
import time

import pytest

import _agentload
from v120_artifacts_support import FakeSpark
from v120_artifacts_tracking_test import _tracking_obj
from v130_ailogs_test import _writer

CONFLICT = ("[DELTA_METADATA_CHANGED] MetadataChangedException: The metadata of the Delta table has been changed by a "
            "concurrent update. Please try the operation again.")


class Table:
    """A shared table: `other_run_adds` is True when the concurrent run's ALTER adds the column itself."""

    def __init__(self, columns, column, errors, other_run_adds):
        self.columns = set(columns)
        self.column = column
        self.errors = list(errors)
        self.other_run_adds = other_run_adds
        self.alters = []

    def __call__(self, statement):
        if statement.startswith("DESCRIBE TABLE"):
            return [{"col_name": c} for c in sorted(self.columns)]
        match = re.search(r"ADD COLUMN `?(\w+)`? ", statement)
        if match:
            name = match.group(1)
            self.alters.append(name)
            if name == self.column and self.errors:
                if self.other_run_adds:
                    self.columns.add(name)
                raise RuntimeError(self.errors.pop(0))
            self.columns.add(name)
        return []


@pytest.fixture
def sleeps(monkeypatch):
    waited = []
    monkeypatch.setattr(time, "sleep", waited.append)
    return waited


def _tracking(agent_ns, table):
    return _tracking_obj(agent_ns, FakeSpark(responder=table))


def _all_but(agent_ns, column):
    return ["session_id", "id"] + [c for c, _ in agent_ns["DatabricksInspire"]._TRACKING_MIGRATION_COLUMNS if c != column]


def test_a_column_another_run_added_is_kept_and_the_rows_carry_it(agent_ns, sleeps):
    table = Table(_all_but(agent_ns, "table_joins"), "table_joins", [CONFLICT], other_run_adds=True)
    obj = _tracking(agent_ns, table)
    obj._tracking_table_created = False
    obj._create_tracking_table()
    assert obj._tracking_table_created is True
    assert getattr(obj, "failed_steps", []) == [], "a column the other run added is no failure"
    assert "table_joins" in obj._tracking_table_columns, "the session's rows are written with table_joins"
    assert not obj.logger.matching("could not be fully migrated", level="ERROR")
    assert table.alters == ["table_joins"] and sleeps == []


def test_a_concurrent_conflict_is_tried_again_until_the_column_is_added(agent_ns, sleeps):
    table = Table(_all_but(agent_ns, "table_joins"), "table_joins", [CONFLICT], other_run_adds=False)
    obj = _tracking(agent_ns, table)
    assert obj._migrate_tracking_table_schema() == ["table_joins"]
    assert table.alters == ["table_joins", "table_joins"] and len(sleeps) == 1 and 0.5 <= sleeps[0] <= 1.0
    assert "table_joins" in obj._tracking_table_columns


def test_a_conflict_that_never_clears_is_reported_after_the_retry_window(agent_ns, sleeps):
    attempts = agent_ns["inspire_write_conflict_attempts"]()
    table = Table(_all_but(agent_ns, "table_joins"), "table_joins", [CONFLICT] * 100, other_run_adds=False)
    obj = _tracking(agent_ns, table)
    with pytest.raises(RuntimeError, match="1 column: \\['table_joins: \\[DELTA_METADATA_CHANGED\\]"):
        obj._migrate_tracking_table_schema()
    assert table.alters == ["table_joins"] * attempts and len(sleeps) == attempts - 1 and 0.5 <= sleeps[0] <= 1.0 and 1.0 <= sleeps[1] <= 2.0
    assert "table_joins" not in obj._tracking_table_columns, "a column that is not there is never written"


def test_a_refused_alter_is_reported_at_once_and_never_tried_again(agent_ns, sleeps):
    table = Table(_all_but(agent_ns, "table_joins"), "table_joins", ["PERMISSION_DENIED: MODIFY on table"] * 3,
                  other_run_adds=False)
    obj = _tracking(agent_ns, table)
    with pytest.raises(RuntimeError, match="table_joins: PERMISSION_DENIED"):
        obj._migrate_tracking_table_schema()
    assert table.alters == ["table_joins"] and sleeps == []
    assert "table_joins" not in obj._tracking_table_columns


def test_the_session_table_keeps_a_column_another_run_added(agent_ns, tmp_path, monkeypatch, sleeps):
    table = Table(["session_id", "enriched_business_context"], "discovery_type", [CONFLICT], other_run_adds=True)
    writer = _writer(agent_ns, FakeSpark(responder=table), tmp_path, monkeypatch)
    writer._migrate_session_table_schema()
    assert "discovery_type" in table.columns and table.alters.count("discovery_type") == 1
    assert writer._session_missing_columns == set()


def test_the_session_table_still_reports_a_refused_column(agent_ns, tmp_path, monkeypatch, sleeps):
    table = Table(["session_id"], "discovery_type", ["PERMISSION_DENIED: MODIFY"], other_run_adds=False)
    writer = _writer(agent_ns, FakeSpark(responder=table), tmp_path, monkeypatch)
    writer._migrate_session_table_schema()
    assert writer._session_missing_columns == {"discovery_type"}


def test_the_step_table_keeps_an_event_id_another_run_added(agent_ns, tmp_path, monkeypatch, sleeps):
    table = Table(["session_id", "step_id"], "event_id", [CONFLICT], other_run_adds=True)
    writer = _writer(agent_ns, FakeSpark(responder=table), tmp_path, monkeypatch)
    assert writer._ensure_steps_event_id() is True
    assert table.alters == ["event_id"]


def test_the_step_table_without_event_id_says_so(agent_ns, tmp_path, monkeypatch, sleeps):
    table = Table(["session_id", "step_id"], "event_id", ["PERMISSION_DENIED: MODIFY"], other_run_adds=False)
    writer = _writer(agent_ns, FakeSpark(responder=table), tmp_path, monkeypatch)
    assert writer._ensure_steps_event_id() is False
    assert writer.logger.matching("Step table has no event_id column (PERMISSION_DENIED", level="WARNING")


def test_the_implement_table_keeps_a_column_another_run_added(agent_ns, tmp_path, monkeypatch, sleeps):
    names = [n for n, _k in agent_ns["IMPLEMENT_COLUMNS"] if n != "asset_snapshots"]
    table = Table(names, "asset_snapshots", [CONFLICT], other_run_adds=True)
    spark = FakeSpark(responder=table)
    writer = _writer(agent_ns, spark, tmp_path, monkeypatch)
    writer._ensure_implement_table()
    assert table.alters == ["asset_snapshots"]
    assert [s for s in spark.statements if " ADD COLUMN " in s] == [
        f"ALTER TABLE {agent_ns['inspire_table_name'](writer.implement_table)} ADD COLUMN `asset_snapshots` STRING"]


def test_the_implement_table_raises_on_a_refused_column(agent_ns, tmp_path, monkeypatch, sleeps):
    names = [n for n, _k in agent_ns["IMPLEMENT_COLUMNS"] if n != "asset_snapshots"]
    table = Table(names, "asset_snapshots", ["PERMISSION_DENIED: MODIFY"], other_run_adds=False)
    writer = _writer(agent_ns, FakeSpark(responder=table), tmp_path, monkeypatch)
    with pytest.raises(RuntimeError, match="asset_snapshots: PERMISSION_DENIED"):
        writer._ensure_implement_table()


@pytest.mark.parametrize("table", ["`samples`.`tpcds_sf1`.`store_sales`", "main.sales.orders", "`c`.`s`.inspire_usecases"])
def test_a_table_inspire_does_not_own_is_never_altered(agent_ns, table):
    spark = FakeSpark(responder=Table(["id"], "x", [], other_run_adds=False))
    with pytest.raises(ValueError, match="only adds columns to its own tables"):
        agent_ns["AtomicWriter"].add_missing_columns(spark, table, [("x", "STRING")])
    assert spark.statements == []


ADD_STATEMENT = re.compile(r"^\s*(?:ALTER\s+TABLE\b.*\bADD\b|ADD\s+COLUMNS?\s+\S)", re.I | re.S)
HELPER_SITE = ("inspire_add_missing_columns", "ALTER TABLE {inspire_table_name(result_table)} ADD COLUMN {column} {kind}")
SHELL_SERVER = pathlib.Path(_agentload.__file__).resolve().parents[1] / "agent" / "app_shell" / "server"


def _text(node):
    if isinstance(node, ast.Constant) and isinstance(node.value, str):
        return node.value
    if isinstance(node, ast.JoinedStr):
        return "".join(part.value if isinstance(part, ast.Constant) else "{" + ast.unparse(part.value) + "}" for part in node.values)
    if isinstance(node, ast.BinOp) and isinstance(node.op, ast.Add):
        left, right = _text(node.left), _text(node.right)
        return None if left is None and right is None else (left or "{}") + (right or "{}")
    return None


def add_sites(source):
    tree = ast.parse(source)
    owners = {}
    for function in ast.walk(tree):
        if isinstance(function, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for node in ast.walk(function):
                owners.setdefault(id(node), function.name)
    found, inner = [], set()
    for node in ast.walk(tree):
        if isinstance(node, ast.BinOp):
            inner.update(id(part) for part in (node.left, node.right))
        if isinstance(node, ast.JoinedStr):
            inner.update(id(part) for part in node.values)
    for node in ast.walk(tree):
        text = None if id(node) in inner else _text(node)
        if text is None:
            continue
        if "\n" in text and ("def " in text or "import " in text):
            try:
                found += add_sites(re.sub(r"@@\w+@@", "None", text))
                continue
            except SyntaxError:
                pass
        if ADD_STATEMENT.match(text):
            found.append((owners.get(id(node), "<module>"), text))
    return found


@pytest.mark.parametrize("planted", [
    'def f(spark, t):\n    spark.sql(f"ALTER TABLE {t} ADD COLUMNS (x STRING)")\n',
    'def f(spark, t):\n    spark.sql("ALTER TABLE " + t + " ADD COLUMN x STRING")\n',
    'def f(spark, t):\n    sql = f"alter table {t} add columns (a INT, b INT)"\n    spark.sql(sql)\n',
    'def f(t):\n    return " ADD COLUMN x STRING"\n',
    'SOURCE = r"""\nimport re\ndef g(spark, t):\n    spark.sql(f\'ALTER TABLE {t} ADD COLUMN y INT\')\n"""\n',
])
def test_the_sweep_catches_a_raw_add_written_any_way(planted):
    assert add_sites(planted), planted


@pytest.mark.parametrize("clean", [
    'KEEPS = ("OPTIMIZE", "ADD COLUMNS", "SET TBLPROPERTIES")\n',
    'def f(n):\n    return f"Session schema migrate: {n} ALTER TABLE ADD COLUMN failed"\n',
    'def f(t):\n    return f"ALTER TABLE {t} SET TBLPROPERTIES (a = 1)"\n',
])
def test_the_sweep_leaves_text_that_adds_no_column(clean):
    assert add_sites(clean) == [], clean


def test_every_column_inspire_adds_goes_through_the_one_helper():
    assert add_sites(_agentload.agent_source()) == [HELPER_SITE]
    shell = {path.name: add_sites(path.read_text()) for path in sorted(SHELL_SERVER.glob("*.py"))}
    assert shell and all(sites == [] for sites in shell.values()), shell


def test_every_table_inspire_migrates_calls_the_one_helper():
    src = _agentload.agent_source()
    for cls, method in (("AtomicWriter", "_migrate_session_table_schema"), ("AtomicWriter", "_ensure_steps_event_id"),
                        ("AtomicWriter", "_ensure_implement_table"), ("DatabricksInspire", "_migrate_tracking_table_schema")):
        body = ast.get_source_segment(src, _agentload.method_node(cls, method))
        assert "add_missing_columns(" in body, (cls, method)
    gate = ast.get_source_segment(src, _agentload.method_node("AtomicWriter", "add_missing_columns"))
    assert "return inspire_add_missing_columns(" in gate
    history = ast.parse(_history_source())
    bodies = {n.name: ast.unparse(n) for n in history.body if isinstance(n, ast.FunctionDef)}
    for function in ("inspire_ensure_ai", "inspire_ensure_sibling", "inspire_merge_run"):
        assert "inspire_add_required_columns(" in bodies[function], function
    for function in ("inspire_ensure_assumptions", "inspire_ensure_feedback"):
        assert "inspire_ensure_sibling(" in bodies[function] and "spark.sql(" not in bodies[function], function
    assert "inspire_add_missing_columns(" in bodies["inspire_add_required_columns"]


def _history_source():
    tree = ast.parse(_agentload.agent_source())
    for node in tree.body:
        if isinstance(node, ast.Assign) and [ast.unparse(t) for t in node.targets] == ["IMPLEMENT_RESULT_HISTORY_SOURCE"]:
            return node.value.value
    raise AssertionError("no IMPLEMENT_RESULT_HISTORY_SOURCE in the agent")


def test_a_result_table_keeps_a_column_another_run_added(agent_ns, sleeps):
    table = Table(["entity_id"], "lift", [CONFLICT], other_run_adds=True)
    spark = FakeSpark(responder=table)
    assert agent_ns["inspire_add_required_columns"](spark, "main.inspire.churn_out", [("lift", "DOUBLE")]) == []
    assert table.alters == ["lift"] and sleeps == []


def test_a_result_table_column_that_cannot_be_added_stops_the_run(agent_ns, sleeps):
    table = Table(["entity_id"], "lift", ["PERMISSION_DENIED: MODIFY"], other_run_adds=False)
    spark = FakeSpark(responder=table)
    with pytest.raises(RuntimeError, match=r"Inspire could not add 1 column to `main`.`inspire`.`churn_out`: lift \(PERMISSION_DENIED"):
        agent_ns["inspire_add_required_columns"](spark, "main.inspire.churn_out", [("lift", "DOUBLE")])
