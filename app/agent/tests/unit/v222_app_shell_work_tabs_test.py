import os
import re
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_pg
import shell_sql
from v142_edits_test import TABLE, edit_page
from v144_app_data_test import ACTION_COLUMNS, EDITOR, DataWorkspace, records, shell
from v147_app_ai_test import _sqlite_run, _version
from v148_app_hub_test import HISTORY_TYPES

COUNTED = "AS m FROM f GROUP BY"


def _page():
    return edit_page(datasets=[{"name": "records", "sql": f"SELECT * FROM {TABLE} WHERE is_current AND change_source <> 'delete'"}],
                     filters=[], kpis=[], charts=[], records=dict(edit_page()["records"], columns=[]))


def _context(page):
    fields = shell_sql.change_fields([{"name": n, "type": HISTORY_TYPES.get(n, "STRING")} for n in (
        "record_key", "entity_id", "entity_label", "priority_tier", "rank", "run_id", "valid_from", "valid_to", "is_current", "change_source",
        "changed_by")] + ACTION_COLUMNS)
    return shell_sql.list_context(page, {"record_key", "entity_id", "entity_label", "priority_tier", "rank"}, fields, True)


def _tables():
    owned = lambda key, who, status, **kw: dict(_version(key, None, **kw), action_owner=who, action_status=status, valid_to=None,
                                                changed_by="run", run_id="r1")
    return {"loss_desk_out": [owned("k1", "pat", "In progress"), owned("k2", "sam", "Done"), owned("k3", None, None),
                              owned("k4", "pat", "Done", current=False), owned("k4", "PAT", "New"), owned("k5", "pat", "New", source="delete"),
                              owned("k6", "sam", "Dismissed")]}


def _counts(page, context, body, editor=""):
    request = shell_sql.list_request(page, body, context)
    return shell_sql.status_counts_of(_sqlite_run(*shell_sql.status_counts_query(page, {}, request, context, editor), _tables()))


def test_the_status_counts_count_every_current_record_by_status_and_owner_on_a_sql_engine():
    page = _page()
    context = _context(page)
    got = _counts(page, context, {}, "pat")
    assert got == {"statuses": {"New": 2, "In progress": 1, "Done": 1, "Dismissed": 1, "Could not fix": 0},
                   "choices": {"new": 2, "in-progress": 1, "done": 1, "not-an-issue": 1, "could-not-fix": 0}, "open": 3, "mine": 2, "all": 5}, \
        "an old version or a deleted record is never counted, a record without a status is New, and the owner match ignores case"
    assert _counts(page, context, {}, "")["mine"] == 0, "nobody signed in owns nothing"


def test_the_status_counts_ignore_the_tab_filter_and_mine_but_keep_every_other_filter():
    page = _page()
    context = _context(page)
    whole = _counts(page, context, {}, "pat")
    tab = _counts(page, context, {"column_filters": {"action_status": ["Done"]}, "mine": True}, "pat")
    assert tab == whole, "the tab a person is on never changes the counts on the other tabs"
    owner = _counts(page, context, {"column_filters": {"action_owner": ["sam"]}}, "pat")
    assert owner["statuses"]["Done"] == 1 and owner["statuses"]["In progress"] == 0 and owner["all"] == 2, \
        "a row filter narrows every tab count"
    listed = shell_sql.list_queries(page, {}, shell_sql.list_request(page, {"column_filters": {"action_status": ["New"]}}, context), context)
    assert _sqlite_run(*listed["total"], _tables()) == [{"total": whole["statuses"]["New"]}], \
        "a tab shows exactly the records its count says"


def test_the_status_counts_parse_as_databricks_sql_and_render_for_lakebase():
    sqlglot = pytest.importorskip("sqlglot")
    page = _page()
    context = _context(page)
    sql, params = shell_sql.status_counts_query(page, {}, shell_sql.list_request(page, {}, context), context, "pat")
    sqlglot.parse_one(re.sub(r":p\d+", "'x'", sql), read="databricks")
    held = {TABLE: {"pg": "app.loss_desk_out", "columns": [{"name": n} for n in (
        "record_key", "entity_id", "entity_label", "priority_tier", "rank", "is_current", "change_source", "valid_from", "valid_to",
        "changed_by", "run_id", *[c["name"] for c in ACTION_COLUMNS])]}}
    text, _values, read = shell_pg.render(sql, params, held)
    assert "COALESCE(" in text and TABLE in read


@pytest.mark.parametrize("value", ["yes", 1, None])
def test_status_counts_takes_true_or_false(value):
    page = _page()
    with pytest.raises(ValueError, match="status_counts takes true or false"):
        shell_sql.list_request(page, {"status_counts": value}, _context(page))


class Counting(DataWorkspace):
    def answer(self, sql, params):
        if COUNTED in sql:
            return {"columns": [], "rows": [{"v": None, "n": 3, "m": 1}, {"v": "Done", "n": 2, "m": 0}], "truncated": False}
        return super().answer(sql, params)


def test_the_list_returns_status_counts_only_when_asked(tmp_path):
    s, ws, _made = shell(tmp_path, ws=Counting())
    status, out = records(s, status_counts=True)
    assert status == 200 and out["status_counts"] == {
        "statuses": {"New": 3, "In progress": 0, "Done": 2, "Dismissed": 0, "Could not fix": 0},
        "choices": {"new": 0, "in-progress": 0, "done": 0, "not-an-issue": 0, "could-not-fix": 0}, "open": 3, "mine": 1, "all": 5}
    (_sql, params), = ws.queries(COUNTED)
    assert any(p["value"] == EDITOR["x-forwarded-email"] for p in params), "Mine counts the signed-in person"
    status, out = records(s)
    assert status == 200 and "status_counts" not in out and len(ws.queries(COUNTED)) == 1, "the counts cost nothing unless asked"
