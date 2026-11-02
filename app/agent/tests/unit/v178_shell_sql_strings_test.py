import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402


@pytest.mark.parametrize("sql, word", [
    ("SELECT '-- x' AS a; DROP TABLE main.s.t", "DROP"),
    ("SELECT r'\\' AS a, 1 AS b; DELETE FROM main.s.t WHERE x = '1'", "DELETE"),
    ("SELECT '/*' AS a; DROP TABLE main.s.t; SELECT '*/' AS b", "DROP"),
    ('SELECT "-- x" AS a; UPDATE main.s.t SET a = 1', "UPDATE"),
])
def test_a_string_that_looks_like_a_comment_start_hides_no_second_statement_or_write(sql, word):
    problems = shell_sql.dataset_sql_problems("d", sql)
    assert any("more than one statement" in p for p in problems), problems
    assert any(f"uses {word}" in p for p in problems), problems


def test_a_nested_comment_is_removed_whole_as_spark_reads_it():
    assert shell_sql.dataset_sql_problems("d", "SELECT 1 AS a /* x /* y */ ; DROP TABLE t */") == []
    assert shell_sql.strip_sql_text("SELECT 1 /* a /* b */ c */ AS x") == "SELECT 1   AS x"


def test_strings_names_and_comments_become_the_same_placeholders_as_before():
    assert shell_sql.strip_sql_text("SELECT 'delete; drop' AS note, `update` FROM main.s.t -- merge later") == "SELECT '' AS note, `` FROM main.s.t  "
    assert shell_sql.strip_sql_text('SELECT "x" AS a, r\'y\' AS b, `c``d` FROM t', keep_names=True) == 'SELECT "" AS a, \'\' AS b, `c``d` FROM t'
    assert shell_sql.strip_sql_text("SELECT bar'x' AS y") == "SELECT bar'' AS y", "an r ending a name starts no raw string"


def test_an_unterminated_string_or_comment_stays_in_the_text_so_the_checks_still_see_it():
    assert shell_sql.strip_sql_text("SELECT 'abc; DROP TABLE t") == "SELECT 'abc; DROP TABLE t"
    assert shell_sql.strip_sql_text("SELECT 1 /* ; DROP TABLE t") == "SELECT 1 /* ; DROP TABLE t"
    assert any("more than one statement" in p for p in shell_sql.dataset_sql_problems("d", "SELECT 'abc; DROP TABLE t"))
