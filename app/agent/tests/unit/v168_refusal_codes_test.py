"""Every refusal the App's web tells apart carries a machine code next to its plain message, so the web branches on the code and never
on the wording: a list that changed since it was loaded, a copy that never said when it caught up, filters that match nothing any more or
too much, a record someone else changed, and a window asked of a list that keeps no actions. A refusal the web does not tell apart sends
no code. A failed run says what kind of failure it was the same way."""
import copy
import json
import os
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
for folder in (SERVER, os.path.dirname(os.path.abspath(__file__))):
    if folder not in sys.path:
        sys.path.insert(0, folder)

import shell_core  # noqa: E402
import shell_db  # noqa: E402
from v141_app_shell_test import SETTINGS, call  # noqa: E402
from v142_edits_test import TableWorkspace, V1, edit_body, version  # noqa: E402
from v142_edits_test import shell as edits_shell  # noqa: E402
from v144_app_data_test import DataWorkspace, act, current, records  # noqa: E402
from v144_app_data_test import shell as data_shell  # noqa: E402
from v168_usable_server_test import CONTRACT, NOW, UsableWorkspace, match_body, post, usable_shell, us  # noqa: E402

ERRORS = CONTRACT["errors"]


def test_a_list_that_changed_or_came_from_an_unknown_copy_says_so_in_its_code(tmp_path):
    stale = UsableWorkspace(history=[{"version": 7, "timestamp": "2026-10-27T09:00:00Z"}, {"version": 6, "timestamp": "2026-10-27T08:00:00Z"}])
    got, out = post(usable_shell(tmp_path, stale), "records/act", match_body())
    assert (got, out) == (ERRORS["stale_list"]["status"], ERRORS["stale_list"]["body"])
    (tmp_path / "copy").mkdir()
    s = usable_shell(tmp_path / "copy", UsableWorkspace())
    got, out = post(s, "records/act", match_body(match=dict(match_body()["match"], as_of_us="0")))
    assert (got, out) == (ERRORS["unknown_copy"]["status"], ERRORS["unknown_copy"]["body"])


def test_filters_that_match_nothing_or_too_much_say_so_in_their_code(tmp_path):
    s = usable_shell(tmp_path, UsableWorkspace(matched=0))
    got, out = post(s, "records/act", match_body())
    assert (got, out) == (ERRORS["no_match"]["status"], ERRORS["no_match"]["body"])
    (tmp_path / "big").mkdir()
    got, out = post(usable_shell(tmp_path / "big", UsableWorkspace(matched=100001)), "records/act", match_body())
    assert (got, out) == (CONTRACT["act_match"]["over_cap"]["status"], CONTRACT["act_match"]["over_cap"]["body"])


def test_a_match_that_changed_nothing_names_whether_records_changed_or_the_list_did(tmp_path):
    class Nothing(UsableWorkspace):
        def answer(self, sql, params):
            if sql.startswith("MERGE INTO"):
                return {"columns": [], "rows": [{"num_inserted_rows": 0, "num_affected_rows": 0}], "truncated": False}
            return super().answer(sql, params)

    taken = {"record_key": "k3", "change_source": "edit", "changed_by": "dana", "valid_from": "2026-10-27T09:10:00.000Z", "_inspire_n": 3}
    got, out = post(usable_shell(tmp_path, Nothing(conflicts=[taken])), "records/act", match_body())
    assert got == 409 and out["code"] == "stale_record" and out["conflicts_count"] == 3, out
    assert out["error"].startswith("none of the 3 records changed: dana changed this record")
    (tmp_path / "raced").mkdir()
    got, out = post(usable_shell(tmp_path / "raced", Nothing()), "records/act", match_body())
    assert got == 409 and out["code"] == "stale_list", out
    assert out["error"] == "none of the 3 records changed: another change landed at the same time; reload the list and try again"
    (tmp_path / "one").mkdir()
    got, out = post(usable_shell(tmp_path / "one", Nothing(matched=1)), "records/act", match_body())
    assert got == 409 and out["code"] == "stale_list", out
    assert out["error"] == "another change landed at the same time; reload the list and try again", \
        "one matched record is named by its reason alone, as an act on one picked record is"


def test_a_record_someone_else_changed_says_so_in_its_code_for_an_act_and_for_an_edit(tmp_path):
    rows = [current("k1", "edit", "sam.roe")]
    s, _ws, _made = data_shell(tmp_path, ws=DataWorkspace(inserted=0, current=rows))
    got, out = act(s, keys=["k1"])
    assert got == 409 and out["code"] == "stale_record" and out["written"] == [] and out["error"] == out["conflicts"][0]["error"]
    expected = ERRORS["stale_record"]
    assert set(out) == set(expected["body"]) and got == expected["status"]
    newer = version(3, "edit", "sam.roe", "2026-10-27T03:01:02.123456Z", current=True)
    (tmp_path / "edit").mkdir()
    s, _ws, _made = edits_shell(tmp_path / "edit", ws=TableWorkspace(versions=[V1, newer], written=0))
    got, out = call(s, "POST", "records/edit", headers={"x-forwarded-email": "pat.lee"}, body=edit_body())
    assert got == 409 and out == {"error": "sam.roe changed this record on Oct 27, 2026 at 03:01 UTC, after you opened it. Reload it to see "
                                          "that change, then make yours again", "code": "stale_record"}


def test_a_window_asked_of_a_list_that_keeps_no_actions_says_so_in_its_code(tmp_path):
    s, _ws, _made = data_shell(tmp_path, settings=SETTINGS)
    assert records(s, window="all") == (ERRORS["no_window"]["status"], ERRORS["no_window"]["body"])
    assert records(s, window="today") == (ERRORS["no_window"]["status"], ERRORS["no_window"]["body"])
    got, out = records(s)
    assert got == 200 and out["window"] is None, "the same list without a window loads"


def test_a_refusal_the_web_does_not_tell_apart_sends_no_code(tmp_path):
    s = usable_shell(tmp_path, UsableWorkspace())
    assert post(s, "records", {"window": "year"}) == (ERRORS["bad_window"]["status"], ERRORS["bad_window"]["body"])
    assert post(s, "records/undo", {"batch_id": "nope"}) == (ERRORS["bad_batch"]["status"], ERRORS["bad_batch"]["body"])
    got, out = post(s, "records/act", match_body(match=dict(match_body()["match"], as_of_us=str(us(NOW) + 60 * 1000000))))
    assert got == 400 and "code" not in out
    assert shell_db.error_body("x") == {"error": "x"} and shell_db.error_body("x", "", {"matched": 0}) == {"matched": 0, "error": "x"}
    assert shell_db.error_body("x", "no_match", {"matched": 0}) == {"matched": 0, "error": "x", "code": "no_match"}


@pytest.mark.parametrize("message, code", [
    ("[TABLE_OR_VIEW_NOT_FOUND] The table or view `main`.`x`.`y` cannot be found.", "missing_table"),
    ("AnalysisException: Table not found: sales", "missing_table"),
    ("[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column, variable, or function parameter with name `amt` cannot be resolved.", "missing_column"),
    ("PERMISSION_DENIED: User does not have SELECT privilege on Table `main`.`x`.`y`", "not_allowed"),
    ("The user is not authorized to run this job", "not_allowed"),
    ("Run timed out after 3600 seconds", "timed_out"),
    ("TIMEDOUT", "timed_out"),
    ("Cluster terminated: CLOUD_PROVIDER_LAUNCH_FAILURE", "no_compute"),
    ("Workspace quota exceeded", "no_compute"),
    ("ZeroDivisionError: division by zero", ""),
    ("", ""),
    (None, ""),
])
def test_a_failed_run_says_what_kind_of_failure_it_was(message, code):
    assert shell_core.run_error_code(message) == code


def test_only_a_failed_run_carries_a_kind_of_failure():
    page = {"id": "n01_u05", "records": {}}
    failed = {"run_id": "r1", "job": {"result": "failed", "message": "[TABLE_OR_VIEW_NOT_FOUND] gone", "run_id": "9", "url": "", "by": "",
                                      "trigger": "", "started": "2026-10-27T09:00:00Z", "ended": "2026-10-27T09:05:00Z", "duration_s": 300}}
    assert shell_core.run_view(failed, {}, page)["error_code"] == "missing_table"
    canceled = copy.deepcopy(failed)
    canceled["job"]["result"] = "canceled"
    view = shell_core.run_view(canceled, {}, page)
    assert view["error_code"] == "" and view["error"] == "[TABLE_OR_VIEW_NOT_FOUND] gone"
    assert shell_core.run_view({"run_id": "r2"}, {"run_ended_at": "2026-10-27T09:05:00Z"}, page)["error_code"] == ""


def test_the_fixture_names_each_code_once_and_every_refusal_body_keeps_its_plain_message():
    codes = [body["body"].get("code") for body in ERRORS.values()] + [CONTRACT["act_match"]["over_cap"]["body"]["code"]]
    named = [c for c in codes if c]
    assert sorted(named) == sorted({"stale_list", "unknown_copy", "no_match", "no_window", "stale_record", "over_cap"})
    assert all(isinstance(e["body"]["error"], str) and e["body"]["error"] for e in ERRORS.values())
    assert json.dumps(CONTRACT).count('"code"') == len(named)
