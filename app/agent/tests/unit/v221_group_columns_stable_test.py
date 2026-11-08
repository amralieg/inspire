"""v2.2.1 the records a run gets back from the grouping helper have the same columns under every Grouping.

1. A Grouping by a column of another table joins that table only to build the groups: the records come back with the
   columns the step passed plus inspire_group and inspire_group_level, the same as under Grouping all, for pandas and Spark.
2. The Genie build rule says so, and says how to read the other table when a step needs its column as a feature.
"""
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))

ITEM = "main.s.item"
JOIN = {"table": ITEM, "key": "item_sk", "ref_column": "item_sk"}
GROUP_KEYS = {"inspire_group", "inspire_group_level"}


class _Column:
    def __init__(self, name="expr"):
        self.name = name

    def alias(self, name):
        return _Column(name)

    def cast(self, _kind):
        return self

    def isNull(self):
        return self

    def isNotNull(self):
        return self

    def otherwise(self, _value):
        return self

    def __eq__(self, _other):
        return _Column()

    def __ge__(self, _other):
        return _Column()

    def __or__(self, _other):
        return _Column()

    def __and__(self, _other):
        return _Column()

    __hash__ = object.__hash__


def _functions():
    module = types.ModuleType("pyspark.sql.functions")
    module.col = lambda name: _Column(name)
    module.lit = lambda _value: _Column()
    module.trim = lambda column: column
    module.when = lambda _cond, _value: _Column()
    module.coalesce = lambda *_columns: _Column()
    module.concat_ws = lambda _sep, *_columns: _Column()
    module.countDistinct = lambda *_columns: _Column()
    module.count = lambda _column: _Column()
    return module


class _Grouped:
    def __init__(self, keys, level):
        self.keys, self.level = list(keys), level

    def agg(self, *columns):
        names = list(columns[0]) if columns and isinstance(columns[0], dict) else [c.name for c in columns]
        return _Frame(self.keys + names, self.level)


class _Frame:
    def __init__(self, columns, level="all"):
        self.columns, self.level = list(columns), level

    def __getitem__(self, name):
        assert name in self.columns, f"{name} is not a column of {self.columns}"
        return _Column(name)

    def withColumn(self, name, _column):
        return _Frame(self.columns + ([name] if name not in self.columns else []), self.level)

    def drop(self, *names):
        return _Frame([c for c in self.columns if c not in names], self.level)

    def filter(self, _cond):
        return self

    where = filter

    def limit(self, _n):
        return self

    def count(self):
        return 1

    def groupBy(self, *keys):
        return _Grouped(keys, self.level)

    def select(self, *columns):
        return _Frame([c if isinstance(c, str) else c.name for c in columns], self.level)

    def selectExpr(self, *exprs):
        return _Frame([e.rsplit(" AS ", 1)[-1].strip("`") for e in exprs], self.level)

    def toDF(self, *names):
        return _Frame(names, self.level)

    def join(self, other, on=None, how="inner"):
        shared = [on] if isinstance(on, str) else []
        return _Frame(self.columns + [c for c in other.columns if c not in shared], self.level)

    def collect(self):
        return [{"inspire_group_level": self.level, "groups": 1, "records": 80}]


class _Session:
    def __init__(self, columns):
        self.columns, self.tables = columns, []

    def table(self, name):
        self.tables.append(name)
        return _Frame(self.columns)


def _run(ns, joins):
    ns["INSPIRE_RUN"] = {"use_case_id": "N01-U01", "grouping": {"link": "https://inspire.example.com/?review=7&uc=N01-U01",
                                                                "joins": joins}}
    ns["INSPIRE_RUN_LOG"] = {}


def _pandas_records():
    pd = pytest.importorskip("pandas")
    records = pd.DataFrame({"item_sk": list(range(80)), "net_paid": [float(i) for i in range(80)]})
    item = pd.DataFrame({"item_sk": [str(i) for i in range(80)], "category": [f"c{i % 2}" for i in range(80)]})
    return records, item


class _PandasSession:
    def __init__(self, frame):
        from v120_artifacts_support import FakeDimension
        self.frame, self.tables, self.dimension = frame, [], FakeDimension

    def table(self, name):
        self.tables.append(name)
        return self.dimension(self.frame)


def test_pandas_records_come_back_with_the_same_columns_under_grouping_all_and_a_joined_grouping(fresh_ns):
    records, item = _pandas_records()
    _run(fresh_ns, {"item.category": dict(JOIN)})
    session, printed = _PandasSession(item), []
    joined = fresh_ns["inspire_group_records"](records, group_by="item.category", out=printed.append, spark_session=session)
    assert len(session.tables) == 1 and sorted(set(joined["inspire_group"])) == ["c0", "c1"], "the join still builds the groups"
    whole = fresh_ns["inspire_group_records"](records, group_by="all", out=lambda *_a: None, spark_session=_PandasSession(item))
    assert list(joined.columns) == list(whole.columns) == ["item_sk", "net_paid", "inspire_group", "inspire_group_level"]
    assert set(joined.columns) - GROUP_KEYS == set(records.columns)
    assert list(joined.index) == list(records.index) and list(joined["net_paid"]) == list(records["net_paid"])
    assert any("to build the groups only; the records come back without category" in line for line in printed)
    with pytest.raises(KeyError):
        joined[["net_paid", "category"]]
    with pytest.raises(KeyError):
        whole[["net_paid", "category"]]


def test_a_column_the_step_joined_itself_stays_a_feature_under_every_grouping(fresh_ns):
    records, item = _pandas_records()
    _run(fresh_ns, {"item.category": dict(JOIN)})
    own = records.assign(category=[f"c{i % 2}" for i in range(80)])
    for group_by in ("item.category", "all", "net_paid"):
        session = _PandasSession(item)
        out = fresh_ns["inspire_group_records"](own, group_by=group_by, out=lambda *_a: None, spark_session=session)
        assert set(out.columns) - GROUP_KEYS == {"item_sk", "net_paid", "category"} and session.tables == [], group_by


def test_spark_records_come_back_with_the_same_columns_under_grouping_all_and_a_joined_grouping(fresh_ns, monkeypatch):
    pyspark = types.ModuleType("pyspark")
    sql = types.ModuleType("pyspark.sql")
    functions = _functions()
    sql.functions = functions
    pyspark.sql = sql
    for name, module in (("pyspark", pyspark), ("pyspark.sql", sql), ("pyspark.sql.functions", functions)):
        monkeypatch.setitem(sys.modules, name, module)
    _run(fresh_ns, {"item.category": dict(JOIN)})
    records = _Frame(["item_sk", "net_paid"], level="category")
    session = _Session(["item_sk", "category", "brand"])
    joined = fresh_ns["inspire_group_records"](records, group_by="item.category", out=lambda *_a: None, spark_session=session)
    assert len(session.tables) == 1, "the Spark path still joins the dimension to build the groups"
    whole = fresh_ns["inspire_group_records"](_Frame(["item_sk", "net_paid"]), group_by="all", out=lambda *_a: None,
                                              spark_session=_Session(["item_sk", "category"]))
    assert joined.columns == whole.columns == ["item_sk", "net_paid", "inspire_group", "inspire_group_level"]
    assert fresh_ns["INSPIRE_RUN_GROUPING"]["group_by"] == "all"


def test_the_build_rule_says_a_grouping_join_is_never_a_feature_and_how_to_get_one(agent_ns):
    grouping = {"applies": True, "columns": ["item.category"], "default": "item.category", "time_column": "",
                "joins": {"item.category": dict(JOIN)}}
    rule = agent_ns["genie_grouping_rule"](grouping)
    assert "It returns exactly the columns you passed plus those two, whatever the Grouping is" in rule
    assert "then drops item.category again, so item.category is never a feature of the records it returns" in rule
    assert ("read main.s.item with inspire_read_source and join it to the records yourself before inspire_group_records, "
            "so the step has it under every Grouping, all included") in rule
    plain = agent_ns["genie_grouping_rule"]({"columns": ["region"], "joins": {}})
    assert "It returns exactly the columns you passed plus those two" in plain and "inspire_read_source" not in plain
