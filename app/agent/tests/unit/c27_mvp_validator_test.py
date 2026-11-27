"""c27: the page check's repeated-key message names the real cause when the decision list already selects record_key
(a join to a companion table repeats each record), and the zero-fix-request class stays out of the problems a page is sent back with."""
from v141_app_shell_test import ShapedWorkspace, app_dir, shell_core as core, shell_sql  # noqa: F401


class KeyedWorkspace(ShapedWorkspace):
    """The decision list dataset selects record_key (the columns probe reports it)."""

    def run_sql(self, warehouse, sql, params, limit=5000):
        out = super().run_sql(warehouse, sql, params, limit)
        if sql.endswith("LIMIT 0") and "ORDER BY" not in sql:
            out = dict(out, columns=list(out.get("columns") or []) + [{"name": "record_key", "type": "STRING"}])
        return out


def checked_with(tmp_path, workspace_class, counted):
    rows = [{"entity_id": f"A{i % 7}", "entity_label": f"Item {i}", "rank": i} for i in range(13)]
    shape = lambda sql: [counted] if "COUNT(DISTINCT" in sql else rows if "ORDER BY `rank`" in sql else None
    ws = workspace_class(shape)
    shell = core.Shell(app_dir(tmp_path), env={"DATABRICKS_WAREHOUSE_ID": "wh1"}, sp_factory=lambda: ws, user_factory=lambda h, t: ws)
    return [p for p in shell.check({}) if "repeats keys" in p]


def test_repeated_keys_with_record_key_selected_name_the_join_not_a_missing_column(tmp_path):
    problems = checked_with(tmp_path, KeyedWorkspace, {"n": 13, "k": 7})
    assert len(problems) == 1
    assert "13 rows carry 7 distinct keys" in problems[0]
    assert "already selects record_key" in problems[0] and "one row per record_key" in problems[0]
    assert "select record_key, the result table's key" not in problems[0], "asking for a column the list already has cannot be acted on"


def test_repeated_keys_without_record_key_still_ask_for_it(tmp_path):
    problems = checked_with(tmp_path, ShapedWorkspace, {"n": 13, "k": 7})
    assert len(problems) == 1 and "select record_key, the result table's key for one record" in problems[0]


def test_unique_keys_pass_in_both_shapes(tmp_path):
    assert checked_with(tmp_path, KeyedWorkspace, {"n": 13, "k": 13}) == []
    (tmp_path / "plain").mkdir()
    assert checked_with(tmp_path / "plain", ShapedWorkspace, {"n": 13, "k": 13}) == []


def test_a_row_count_note_is_never_a_problem_to_fix():
    page = {"id": "p", "layout": "decide", "records": {}}
    notes_only = shell_sql.row_shortfalls(page, {("table", "t"): 7}, {("table", "t"): 7})
    assert notes_only[0] == [] or all("nothing is missing" not in p for p in notes_only[0])
    assert not any("nothing is missing" in p for p in shell_sql.row_problems(page, {("table", "t"): 7}, {("table", "t"): 7}))
