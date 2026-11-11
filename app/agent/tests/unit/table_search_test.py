"""A table on an App searches every row the server holds: the search runs in the table's own SQL, over all of its shown columns,
so a capped table still finds a row past its first page, and a bad search is refused with a plain message."""
from v161_app_column_filters_test import EDITOR, column_shell, returns_page, with_table  # noqa: E402
from v141_app_shell_test import call  # noqa: E402


def worst_table_sql(ws):
    return [sql for sql, _p, _l in ws.sql if sql.startswith("SELECT `category`, `loss_amount`, `event_date`")]


def test_a_table_search_runs_in_the_table_sql_over_its_shown_columns(tmp_path):
    s, ws, _made = column_shell(tmp_path, pages=[with_table(returns_page())])
    status, out = call(s, "POST", "page", body={"page": "n09_u03", "table_search": {"worst": "bo"}}, headers=EDITOR)
    assert status == 200 and out["errors"] == {}
    tables = worst_table_sql(ws)
    assert len(tables) == 1 and " ILIKE " in tables[0] and " OR " in tables[0]
    assert "CAST(d.`category` AS STRING) ILIKE" in tables[0] and "CAST(d.`loss_amount` AS STRING) ILIKE" in tables[0]
    assert any(p and p[0]["value"] == "%bo%" for sql, p, _l in ws.sql if sql.startswith("SELECT `category`, `loss_amount`, `event_date`"))


def test_a_page_without_a_table_search_adds_no_search_condition(tmp_path):
    s, ws, _made = column_shell(tmp_path, pages=[with_table(returns_page())])
    status, _out = call(s, "POST", "page", body={"page": "n09_u03"}, headers=EDITOR)
    assert status == 200
    assert all(" ILIKE " not in sql for sql in worst_table_sql(ws))


def test_a_search_for_an_unknown_table_or_a_non_text_search_is_refused(tmp_path):
    s, _ws, _made = column_shell(tmp_path, pages=[with_table(returns_page())])
    for searches, needle in (({"nope": "x"}, "the page has no table 'nope'"), ({"worst": 5}, "table worst search takes text")):
        status, out = call(s, "POST", "page", body={"page": "n09_u03", "table_search": searches}, headers=EDITOR)
        assert status == 400 and needle in out["error"], out
