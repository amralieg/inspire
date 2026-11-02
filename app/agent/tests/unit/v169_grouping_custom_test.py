import json

import pytest

SQL = ("SELECT m.order_id, c.region AS group_name -- region of the store\n"
       "FROM main.sales.orders m LEFT JOIN main.geo.stores c ON m.store_id = c.store_id;")
LINK = "https://inspire.example.com/?review=7&uc=N01-U01"


class _Frame:
    def __init__(self, table):
        self.table = table
        self.columns = list(table.columns)

    def toPandas(self):
        return self.table.copy()


class _Spark:
    def __init__(self, saved, groups=None, fail=None):
        self.saved, self.groups, self.fail, self.statements = saved, groups, fail, []

    def sql(self, statement, *args, **kwargs):
        self.statements.append(statement)
        if statement.startswith("CREATE TABLE IF NOT EXISTS") or statement.startswith("DESCRIBE TABLE"):
            return _Rows([])
        if statement.startswith("SELECT name, value, changed_by, changed_at, text_value"):
            return _Rows([{"name": k, "value": None, "changed_by": "ana", "changed_at": None, "text_value": v} for k, v in self.saved.items()])
        if self.fail:
            raise RuntimeError(self.fail)
        return _Frame(self.groups)


class _Rows:
    def __init__(self, rows):
        self.rows = rows

    def collect(self):
        return list(self.rows)


def _saved(ns, sql=SQL, **changes):
    check = ns["inspire_grouping_sql_check"](sql)
    saved = {"group_sql": sql, "group_sql_tables": json.dumps(check["tables"]), "group_sql_hash": check["hash"],
             "group_sql_checked_by": "ana", "group_sql_checked_at": "2026-11-01T09:00:00Z"}
    saved.update(changes)
    return saved


def _records(pd):
    keys = [f"o{i}" for i in range(100)]
    return pd.DataFrame({"order_id": keys, "amount": range(100)})


def _groups(pd, sizes):
    ids, names = [], []
    at = 0
    for name, size in sizes:
        for _ in range(size):
            ids.append(f"o{at}")
            names.append(name)
            at += 1
    return pd.DataFrame({"order_id": ids, "group_name": names})


def _run(ns, spark):
    ns["INSPIRE_RUN"] = {"use_case_id": "N01-U01", "result_table": "main.inspire.n01_out", "grouping": {"link": LINK}}
    ns["spark"] = spark
    ns["INSPIRE_SETTINGS_APPLIED"] = {"group_by": "custom"}


def test_a_custom_grouping_runs_the_saved_sql_wrapped_joins_it_by_key_and_merges_small_groups(fresh_ns):
    pd = pytest.importorskip("pandas")
    spark = _Spark(_saved(fresh_ns), _groups(pd, [("North", 40), ("South", 30), ("East", 20), ("West", 5)]))
    _run(fresh_ns, spark)
    printed = []
    out = fresh_ns["inspire_group_records"](_records(pd), out=printed.append)
    ran = [s for s in spark.statements if "_inspire_custom_groups" in s]
    assert ran == ["SELECT * FROM (\nSELECT m.order_id, c.region AS group_name  \nFROM main.sales.orders m LEFT JOIN main.geo.stores c "
                   "ON m.store_id = c.store_id\n) AS _inspire_custom_groups"], "exactly the saved SQL, comments out, wrapped"
    assert len(out) == 100 and list(out["order_id"]) == [f"o{i}" for i in range(100)]
    counts = out["inspire_group"].value_counts().to_dict()
    assert counts == {"North": 40, "South": 30, "Other groups": 30}, "East (20), West (5) and the 5 records with no row join Other groups"
    assert set(out["inspire_group_level"]) == {"custom"} and "group_name" not in out.columns
    record = fresh_ns["INSPIRE_RUN_GROUPING"]
    assert (record["mode"], record["groups"], record["other_groups"], record["sql_tables"]) == (
        "custom", 3, 3, ["main.geo.stores", "main.sales.orders"])
    assert record["hash"] == _saved(fresh_ns)["group_sql_hash"]
    assert printed == ["Grouping: 3 groups from the saved custom grouping SQL over main.geo.stores, main.sales.orders; 3 groups under "
                       "30 records joined Other groups"]


@pytest.mark.parametrize("change,why", [
    ({"group_sql": ""}, "no grouping SQL is saved for this use case"),
    ({"group_sql_hash": "0" * 64}, "is not the SQL that was checked when it was saved"),
    ({"group_sql_tables": json.dumps(["main.sales.orders"])}, "reads main.geo.stores, main.sales.orders, but the check that saved it saw main.sales.orders"),
    ({"group_sql": "SELECT order_id, region AS group_name FROM main.sales.orders; DROP TABLE main.sales.orders"}, "no longer passes Inspire's check"),
])
def test_a_custom_grouping_that_no_longer_matches_what_was_saved_stops_the_run_before_scoring(fresh_ns, change, why):
    pd = pytest.importorskip("pandas")
    spark = _Spark(_saved(fresh_ns, **change), _groups(pd, [("North", 50), ("South", 50)]))
    _run(fresh_ns, spark)
    with pytest.raises(fresh_ns["InspireRunStop"]) as stop:
        fresh_ns["inspire_group_records"](_records(pd), out=lambda *_a: None)
    assert why in str(stop.value) and str(stop.value).startswith("Grouping: ")
    assert str(stop.value).endswith(f"so this run stopped before it scored any record; change the grouping on the Run page: {LINK}")
    assert not [s for s in spark.statements if "_inspire_custom_groups" in s], "nothing that does not match runs"
    assert "INSPIRE_RUN_GROUPING" not in fresh_ns


def test_a_custom_grouping_whose_sql_fails_or_breaks_its_promise_stops_and_never_falls_back_to_global(fresh_ns):
    pd = pytest.importorskip("pandas")
    spark = _Spark(_saved(fresh_ns), fail="[TABLE_OR_VIEW_NOT_FOUND] The table main.geo.stores cannot be found")
    _run(fresh_ns, spark)
    with pytest.raises(fresh_ns["InspireRunStop"], match="failed when it ran over main.geo.stores, main.sales.orders .*TABLE_OR_VIEW_NOT_FOUND"):
        fresh_ns["inspire_group_records"](_records(pd), out=lambda *_a: None)
    doubled = _groups(pd, [("North", 50), ("South", 50)])
    doubled = pd.concat([doubled, pd.DataFrame({"order_id": ["o1"], "group_name": ["South"]})])
    _run(fresh_ns, _Spark(_saved(fresh_ns), doubled))
    with pytest.raises(fresh_ns["InspireRunStop"], match="gives some records more than one group"):
        fresh_ns["inspire_group_records"](_records(pd), out=lambda *_a: None)
    _run(fresh_ns, _Spark(_saved(fresh_ns), _groups(pd, [("North", 100)])))
    with pytest.raises(fresh_ns["InspireRunStop"], match="gives 1 group after groups under 30 records joined Other groups"):
        fresh_ns["inspire_group_records"](_records(pd), out=lambda *_a: None)
    keyed = _groups(pd, [("North", 50), ("South", 50)]).rename(columns={"order_id": "line_id"})
    _run(fresh_ns, _Spark(_saved(fresh_ns), keyed))
    with pytest.raises(fresh_ns["InspireRunStop"], match="returns line_id, but the records this run scores have no column line_id"):
        fresh_ns["inspire_group_records"](_records(pd), out=lambda *_a: None)
    assert "INSPIRE_RUN_GROUPING" not in fresh_ns


def test_a_failed_grouping_sql_stops_with_the_errors_first_line_never_the_query_plan(fresh_ns):
    pd = pytest.importorskip("pandas")
    error = ("[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column with name `s`.`store_cluster` cannot be resolved. SQLSTATE: 42703; line 2 pos 19;\n"
             "'Project [*]\n+- 'SubqueryAlias _inspire_custom_groups")
    _run(fresh_ns, _Spark(_saved(fresh_ns), fail=error))
    with pytest.raises(fresh_ns["InspireRunStop"]) as stop:
        fresh_ns["inspire_group_records"](_records(pd), out=lambda *_a: None)
    text = str(stop.value)
    assert "cannot be resolved. SQLSTATE: 42703; line 2 pos 19;)" in text and "Project" not in text and "\n" not in text
    assert fresh_ns["inspire_run_stop_reason"](RuntimeError(error)) == ("The run stopped on RuntimeError: " + error.splitlines()[0])[:300]


def test_the_saved_grouping_sql_rows_are_the_helpers_and_never_read_as_number_assumptions(fresh_ns):
    rows = [{"name": name, "value": None, "changed_by": "ana", "changed_at": None, "text_value": text}
            for name, text in _saved(fresh_ns).items()] + [{"name": "group_by", "value": None, "changed_by": "ana", "changed_at": None,
                                                             "text_value": "custom"}]
    spark = _Spark({})
    spark.saved = {row["name"]: row["text_value"] for row in rows}
    setting = {"name": "group_by", "kind": "choice", "many": True, "choices": ["region", "custom"], "solo": ["all", "custom"]}
    scope = {"INSPIRE_RUN": {"settings": [setting], "settings_read": True, "impact": {}}, "group_by": "region"}
    printed = []
    applied = fresh_ns["inspire_apply_assumptions"](spark, "main.inspire.n01_out", "N01-U01", scope=scope, out=printed.append)
    assert applied == {"group_by": "custom"} and scope["group_by"] == "custom"
    assert not any("group_sql" in line for line in printed), printed


def test_the_shared_check_name_is_the_one_check_the_run_uses(agent_ns):
    assert agent_ns["implement_grouping_sql_check"] is agent_ns["inspire_grouping_sql_check"]
    assert agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"].count("def inspire_grouping_sql_check(") == 1
    assert "implement_grouping_sql_check" not in agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"], "the Run controls cell binds only inspire_ names"
