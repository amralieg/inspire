import json
import os
import re
import sys
import threading
import types

import pytest

from v120_artifacts_support import CapturingLogger, FakeDataFrame, FakeSpark, make_inspire, make_uc

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
RELEASED = json.load(open(os.path.join(ROOT, "tests", "fixtures", "main_tracking_ddl.json"), encoding="utf-8"))
NAMES = {"session": "c.s.__inspire_session", "step": "c.s.__inspire_step", "usecases": "c.s.__inspire_usecases",
         "implement": "c.s.__inspire_implement"}
CREATE = re.compile(r"^CREATE TABLE IF NOT EXISTS (\S+) \((.*)\) USING DELTA", re.S)
STEP = {"session_id": 5150, "step_id": 1, "stage_name": "s", "step_name": "t", "sub_step_name": "", "progress_increment": 1.0,
        "message": "m", "status": "ended_success", "result_json": {}, "event_id": "e1"}


def _key(name):
    return name.replace("`", "").lower()


def _parts(body):
    parts, depth, quoted, start = [], 0, False, 0
    for at, ch in enumerate(body):
        if ch == "'" and body[at - 1:at] != "\\":
            quoted = not quoted
        elif not quoted and ch in "(<":
            depth += 1
        elif not quoted and ch in ")>":
            depth -= 1
        elif not quoted and depth == 0 and ch == ",":
            parts.append(body[start:at])
            start = at + 1
    return [p.strip() for p in parts + [body[start:]] if p.strip()]


def _columns(ddl):
    match = CREATE.match(" ".join(ddl.split()))
    assert match, ddl[:120]
    return _key(match.group(1)), [p.split()[0].strip("`").lower() for p in _parts(match.group(2))]


class _View(FakeDataFrame):
    def __init__(self, spark, rows=None, source=None, columns=()):
        super().__init__(spark, rows=rows, source=source)
        self.columns = list(columns)

    def createOrReplaceTempView(self, name):
        self.spark.views[name] = self


class _Tables(FakeSpark):
    def __init__(self, ddls):
        super().__init__()
        self.tables, self.views = {}, {}
        self.catalog = types.SimpleNamespace(dropTempView=lambda name: self.views.pop(name, None))
        for ddl in ddls:
            name, columns = _columns(ddl)
            self.tables[name] = columns

    def sql(self, statement, *args, **kwargs):
        text = " ".join(str(statement).split())
        self.statements.append(text)
        created = CREATE.match(text)
        if created and _key(created.group(1)) not in self.tables:
            self.tables[_key(created.group(1))] = _columns(text)[1]
        described = re.match(r"^DESCRIBE TABLE (\S+)$", text)
        if described:
            return _View(self, rows=[{"col_name": c} for c in self.tables.get(_key(described.group(1)), [])])
        added = re.match(r"^ALTER TABLE (\S+) ADD COLUMN `?(\w+)`? ", text)
        if added:
            self.tables[_key(added.group(1))].append(added.group(2).lower())
        renamed = re.match(r"^ALTER TABLE (\S+) RENAME COLUMN (\w+) TO (\w+)$", text)
        if renamed:
            columns = self.tables[_key(renamed.group(1))]
            columns[columns.index(renamed.group(2).lower())] = renamed.group(3).lower()
        picked = re.match(r"^SELECT (.*) FROM (\S+)$", text)
        if picked:
            return _View(self, source=picked.group(2), columns=[c.strip().strip("`").lower() for c in picked.group(1).split(",")])
        return _View(self)

    def createDataFrame(self, rows, schema=None):
        rows = list(rows)
        self.created.append((rows, schema))
        return _View(self, rows=rows, columns=[f.name for f in getattr(schema, "fields", [])])

    def altered(self):
        return [s for s in self.statements if s.startswith("ALTER TABLE")]

    def missing(self, table, columns):
        return sorted(set(c.lower() for c in columns) - set(self.tables[NAMES[table]]))


def _write_each_kind(ns, spark, tmp_path, monkeypatch):
    monkeypatch.setattr(ns["tempfile"], "tempdir", str(tmp_path), raising=False)
    writer = ns["AtomicWriter"](spark, CapturingLogger(), "c.s", 5150, widget_values={"business": "Acme", "operation": "Discover Use Cases"})
    writer._session_writer.stop(drain_timeout=5.0)
    writer._session_writer = None
    writer.initialize_session()
    writer._insert_steps_chunk([STEP], "2026-11-01 01:00:00")
    tracker = make_inspire(ns, spark=spark, inspire_database="c.s", session_id=5150, _tracking_table_name="c.s.__inspire_usecases",
                           _tracking_table_created=False)
    tracker._tracking_lock = threading.Lock()
    tracker._build_code_structure_mandate = lambda spec: "mandate"
    tracker._create_tracking_table()
    tracker._tracking_replace_session([make_uc("N01-U01", elite_status="ELITE")])
    builder = make_inspire(ns, spark=spark, inspire_database="c.s")
    builder._implement_update((5150, "N01-U01", 1), status="ready", status_message="built", asset_snapshots="{}")
    return writer, tracker


def _targets(spark):
    session = next(s for s in spark.statements if s.startswith("MERGE INTO `c`.`s`.__inspire_session"))
    inserted = re.search(r"WHEN NOT MATCHED THEN INSERT \( (.*?) \) VALUES", session).group(1)
    updated = re.findall(r"target\.(\w+) = source", session)
    step = next(s for s in spark.statements if s.startswith("INSERT INTO `c`.`s`.__inspire_step"))
    swap = next(s for s in spark.statements if s.startswith("SELECT ") and "__inspire_usecases_stage_" in s)
    assert [w["mode"] for w in spark.writes if _key(w["table"]) == NAMES["usecases"]] == ["overwrite"]
    implement = next(s for s in spark.statements if s.startswith("UPDATE `c`.`s`.__inspire_implement SET"))
    return {"session": [c.strip() for c in inserted.split(",")] + updated,
            "step": [c.strip() for c in re.search(r"__inspire_step \((.*?)\) SELECT", step).group(1).split(",")],
            "usecases": [c.strip().strip("`") for c in re.match(r"^SELECT (.*) FROM ", swap).group(1).split(",")],
            "implement": re.findall(r"`(\w+)` = ", implement.split(" WHERE ")[0])}


@pytest.fixture
def functions_stub(monkeypatch):
    monkeypatch.setattr(sys.modules["pyspark.sql.functions"], "current_timestamp", lambda: "now", raising=False)


def test_the_fixture_is_the_released_setup_of_the_four_tracking_tables():
    assert RELEASED["source"].startswith("origin/main 4407364")
    assert {_columns(ddl)[0] for ddl in RELEASED["tables"].values()} == set(NAMES.values())
    assert "event_id" not in _columns(RELEASED["tables"]["__inspire_step"])[1], "the released step table has no event_id"


def test_tables_a_released_build_made_are_brought_to_the_current_columns_and_every_write_targets_existing_columns(
        agent_ns, tmp_path, monkeypatch, functions_stub):
    spark = _Tables(RELEASED["tables"].values())
    released = {kind: list(spark.tables[name]) for kind, name in NAMES.items()}
    current = _Tables([])
    _write_each_kind(agent_ns, current, tmp_path / "current", monkeypatch)
    _write_each_kind(agent_ns, spark, tmp_path, monkeypatch)
    for kind, name in NAMES.items():
        assert spark.tables[name][:len(released[kind])] == released[kind], f"{kind}: the released columns stay as they were"
        assert sorted(spark.tables[name]) == sorted(current.tables[name]), f"{kind}: it ends with the columns this version creates"
    assert spark.tables[NAMES["step"]][-1] == "event_id" and "ALTER TABLE `c`.`s`.`__inspire_step` ADD COLUMN event_id STRING" in spark.altered()
    assert "asset_snapshots" in spark.tables[NAMES["implement"]], "a released implement table gains the columns this version writes"
    for kind, columns in _targets(spark).items():
        assert columns and spark.missing(kind, columns) == [], kind
    step = next(s for s in spark.statements if s.startswith("INSERT INTO `c`.`s`.__inspire_step"))
    assert step.split(") SELECT")[0].endswith("result_json, event_id"), "once the released step table has event_id, every step row carries it"


def test_tables_already_at_the_current_shape_get_no_alter(agent_ns, tmp_path, monkeypatch, functions_stub):
    spark = _Tables([])
    _write_each_kind(agent_ns, spark, tmp_path / "first", monkeypatch)
    assert spark.altered() == [], "the tables this version creates already hold every column"
    create = next(s for s in spark.statements if s.startswith("CREATE TABLE IF NOT EXISTS `c`.`s`.__inspire_step"))
    assert "result_json VARIANT, event_id STRING )" in create
    del spark.statements[:]
    _write_each_kind(agent_ns, spark, tmp_path / "again", monkeypatch)
    assert spark.altered() == [] and not any("RENAME COLUMN" in s for s in spark.statements)
