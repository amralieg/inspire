"""The inbox lists, under Due in 3 days or overdue, the open records nobody owns that are due by then, for the owners of the use case only:
they are the people who can give such a record to someone. The list endpoint takes unowned and due_within for it, the server checks the
person against the same use case owners every other owner-only act checks, and app info tells the browser per use case whether the
signed-in person owns it, so the browser only asks when the server would answer."""
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
for folder in (SERVER, os.path.dirname(os.path.abspath(__file__))):
    if folder not in sys.path:
        sys.path.insert(0, folder)

import shell_pg  # noqa: E402
import shell_sql  # noqa: E402
from v141_app_shell_test import SETTINGS, call  # noqa: E402
from v148_app_hub_test import COLUMNS, PERSON, TABLE, SqliteWorkspace, hub_page, hub_shell, version  # noqa: E402

pytest.importorskip("sqlglot")

SAM = "@".join(["sam.roe", "example.com"])
OWNERS = dict(SETTINGS, options=dict(SETTINGS["options"], decisions=True), use_case_owners={"n01_u05": [PERSON]})
ROWS = [
    version("u1", "Act now", 900.0, action_due="2026-10-25"),
    version("u2", "Act now", 800.0, action_due="2026-10-20", action_owner="  "),
    version("u3", "Act now", 700.0, action_due="2026-10-30"),
    version("u4", "Act now", 600.0),
    version("u5", "Act now", 500.0, action_due="2026-10-26", action_owner=SAM),
    version("u6", "Act now", 400.0, action_due="2026-10-26", action_status="Done"),
    version("u7", "Act now", 300.0, action_due="2026-10-27"),
]


def ask(tmp_path, who=PERSON, settings=OWNERS, **body):
    s, ws, _made = hub_shell(tmp_path, settings=settings, ws=SqliteWorkspace(tables={"loss_desk_out": ROWS}))
    headers = {"x-forwarded-email": who} if who else {}
    status, out = call(s, "POST", "records", headers=headers, body=dict({"page": "n01_u05", "limit": 50}, **body))
    return status, out, s


def test_an_owner_sees_the_open_records_nobody_owns_that_are_due_within_three_days_or_overdue(tmp_path):
    status, out, _s = ask(tmp_path, unowned=True, window="all", due_within=3)
    assert status == 200, out
    assert sorted(r["record_key"] for r in out["rows"]) == ["u1", "u2", "u7"], \
        "u3 is due after the 27th, u4 has no due day, u5 is Sam's and u6 is done (must-exclude)"


def test_unowned_alone_lists_every_open_record_nobody_owns(tmp_path):
    status, out, _s = ask(tmp_path, unowned=True, window="all")
    assert status == 200 and sorted(r["record_key"] for r in out["rows"]) == ["u1", "u2", "u3", "u4", "u7"]


def test_someone_who_does_not_own_the_use_case_is_refused_and_so_is_a_visitor(tmp_path):
    status, out, _s = ask(tmp_path, who=SAM, unowned=True, window="all", due_within=3)
    assert (status, out) == (403, {"error": "Only the owners of this use case can see the records nobody owns"})
    assert ask(tmp_path / "v", who="", unowned=True, window="all")[0] == 401
    nobody = dict(OWNERS, use_case_owners={})
    assert ask(tmp_path / "n", settings=nobody, unowned=True, window="all")[0] == 403


def test_bad_unowned_and_due_within_values_are_refused(tmp_path):
    for body, error in (({"unowned": "yes", "window": "all"}, "unowned takes true or false"),
                        ({"unowned": True, "mine": True, "window": "all"}, "send mine or unowned, not both"),
                        ({"due_within": 3}, "due_within goes with a window"),
                        ({"due_within": -1, "window": "all"}, "due_within goes with a window"),
                        ({"due_within": 32, "window": "all"}, "due_within goes with a window"),
                        ({"due_within": True, "window": "all"}, "due_within goes with a window")):
        status, out, _s = ask(tmp_path / str(len(body)) / error[:8].replace(" ", "_") / str(body.get("due_within")), **body)
        assert status == 400 and error in out["error"], (body, out)


def test_app_info_says_per_use_case_whether_the_signed_in_person_owns_it(tmp_path):
    s, _ws, _made = hub_shell(tmp_path, settings=OWNERS)
    pages = lambda who: {p["id"]: p["is_owner"] for p in call(s, "GET", "app", headers={"x-forwarded-email": who} if who else {})[1]["pages"]}
    assert pages(PERSON.upper())["n01_u05"] is True
    assert pages(SAM)["n01_u05"] is False and pages("")["n01_u05"] is False
    assert all(v is False for k, v in pages(PERSON).items() if k != "n01_u05")


def test_the_unowned_due_statement_parses_as_databricks_sql_and_renders_for_lakebase():
    page = hub_page()
    fields = shell_sql.change_fields([{"name": c, "type": "STRING"} for c in COLUMNS])
    context = shell_sql.list_context(page, set(COLUMNS), fields, True)
    request = shell_sql.list_request(page, {"unowned": True, "window": "all", "due_within": 3}, context)
    plan = shell_sql.list_queries(page, {}, request, context, PERSON)
    sql, params = plan["rows"]
    assert "NULLIF(TRIM(c.`_inspire_owner`), '') IS NULL" in sql and "c.`_inspire_due` <=" in sql
    held = {TABLE: {"pg": "app.loss_desk_out", "columns": [{"name": c} for c in COLUMNS]}}
    _text, _values, read = shell_pg.render(sql, params, held)
    assert TABLE in read
