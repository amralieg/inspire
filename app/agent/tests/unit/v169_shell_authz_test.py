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
import shell_sql  # noqa: E402
from v141_app_shell_test import call  # noqa: E402
from v142_edits_test import EDITOR as EDIT_EDITOR, edit_body, shell as edit_shell  # noqa: E402
from v144_app_data_test import DECIDE, EDITOR, OTHER, PERSON  # noqa: E402
from v168_usable_server_test import UsableWorkspace, post, usable_shell  # noqa: E402

OWNER = "@".join(["dana.ops", "example.com"])
FORGED = "@".join(["forged.actor", "example.com"])
FORGERY = {"changed_by": FORGED, "editor": FORGED, "actor": FORGED, "author": FORGED, "user": FORGED, "x-forwarded-email": FORGED}
OWNED = dict(DECIDE, use_case_owners={"n01_u05": [OWNER]})
BATCH = "a" * 32
RESTORED = [{"record_key": "k1", "change_source": "action", "changed_by": PERSON, "valid_from": "2026-10-27T09:25:00.000Z",
             "_inspire_done": 1, "_inspire_n": 1}]


def made_by(author):
    return [{"batch_id": BATCH, "editor": author, "at": "2026-10-27T09:10:00.000Z", "n": 1,
             "batch_values": json.dumps({"action_status": "Done"}), "note": None, "undone": 0}]


def undo_shell(tmp_path, author, settings=None):
    ws = UsableWorkspace(batches=made_by(author) if author else [], batch_records=RESTORED, inserted=1)
    return usable_shell(tmp_path, ws, settings=settings), ws


def written_by(ws):
    return [{p["value"] for p in params} for _sql, params in ws.queries("MERGE INTO")]


def test_the_person_who_made_an_act_undoes_it_in_one_write(tmp_path):
    s, ws = undo_shell(tmp_path, PERSON)
    status, out = post(s, "records/undo", {"batch_id": BATCH})
    assert status == 200, out
    assert out["restored"] == 1 and len(ws.queries("MERGE INTO")) == 1


def test_someone_else_cannot_undo_an_act_when_the_use_case_names_no_owner_and_nothing_is_written(tmp_path):
    s, ws = undo_shell(tmp_path, PERSON)
    status, out = post(s, "records/undo", {"batch_id": BATCH}, headers={"x-forwarded-email": OTHER})
    assert status == 403, out
    assert out["error"] == f"{shell_core.UNDO_WORDS[1]}; {PERSON} made it"
    assert ws.queries("MERGE INTO") == []


def test_an_owner_of_the_use_case_undoes_anyone_s_act_and_a_non_owner_is_refused(tmp_path):
    s, ws = undo_shell(tmp_path, PERSON, settings=OWNED)
    status, out = post(s, "records/undo", {"batch_id": BATCH}, headers={"x-forwarded-email": OWNER})
    assert status == 200, out
    (tmp_path / "other").mkdir()
    s, ws = undo_shell(tmp_path / "other", PERSON, settings=OWNED)
    status, out = post(s, "records/undo", {"batch_id": BATCH}, headers={"x-forwarded-email": OTHER})
    assert status == 403 and out["error"] == f"{shell_core.UNDO_WORDS[2]}; {PERSON} made it", out
    assert ws.queries("MERGE INTO") == []


def test_the_author_check_ignores_case_and_reads_only_the_named_batch(tmp_path):
    s, ws = undo_shell(tmp_path, PERSON.upper())
    status, out = post(s, "records/undo", {"batch_id": BATCH})
    assert status == 200, out
    (sql, params), = [(q, p) for q, p in ws.queries("AS `batch_id`")]
    assert "b.`action_batch` = :p" in sql and BATCH in {p["value"] for p in params}


def test_an_act_nobody_made_on_this_page_is_404_before_any_write(tmp_path):
    s, ws = undo_shell(tmp_path, None)
    status, out = post(s, "records/undo", {"batch_id": BATCH})
    assert status == 404 and out["error"] == f"no act with batch_id {BATCH} changed a record of this page"
    assert ws.queries("MERGE INTO") == []


def test_undo_writes_the_proxy_identity_and_never_an_actor_sent_in_the_body(tmp_path):
    s, ws = undo_shell(tmp_path, PERSON)
    status, out = post(s, "records/undo", dict({"batch_id": BATCH}, **FORGERY))
    assert status == 200, out
    (values,) = written_by(ws)
    assert PERSON in values and FORGED not in values


def test_a_forged_actor_in_the_body_cannot_undo_someone_else_s_act(tmp_path):
    s, ws = undo_shell(tmp_path, FORGED)
    status, out = post(s, "records/undo", dict({"batch_id": BATCH}, **FORGERY), headers={"x-forwarded-email": OTHER})
    assert status == 403, out
    assert ws.queries("MERGE INTO") == []


def test_an_act_writes_the_proxy_identity_and_never_an_actor_sent_in_the_body(tmp_path):
    ws = UsableWorkspace(inserted=1)
    s = usable_shell(tmp_path, ws)
    status, out = post(s, "records/act", dict({"record_keys": ["k1"], "seen": {"k1": "101"}, "values": {"action_status": "Done"}}, **FORGERY))
    assert status == 200, out
    (values,) = written_by(ws)
    assert PERSON in values and FORGED not in values


@pytest.mark.parametrize("column", ["changed_by", "change_source", "valid_from"])
def test_an_act_cannot_name_the_actor_or_the_history_through_its_values(tmp_path, column):
    ws = UsableWorkspace(inserted=1)
    s = usable_shell(tmp_path, ws)
    status, out = post(s, "records/act", {"record_keys": ["k1"], "seen": {"k1": "101"}, "values": {column: FORGED}})
    assert status == 400 and out["error"].startswith(f"{column} cannot be changed by an action"), out
    assert ws.queries("MERGE INTO") == []


@pytest.mark.parametrize("path, body", [
    ("records/edit", edit_body()),
    ("records/add", {"page": "n01_u05", "values": {"entity_id": "9"}}),
    ("records/delete", edit_body(values=None)),
])
def test_edit_add_and_delete_write_the_proxy_identity_and_never_an_actor_sent_in_the_body(tmp_path, path, body):
    s, ws, _made = edit_shell(tmp_path)
    status, out = call(s, "POST", path, headers=EDIT_EDITOR, body=dict(body, **FORGERY))
    assert status == 200, (path, out)
    (_sql, params), = ws.merges()
    values = {p["value"] for p in params}
    assert EDIT_EDITOR["x-forwarded-email"] in values and FORGED not in values


def test_without_a_signed_in_person_no_write_happens_whatever_the_body_says(tmp_path):
    s, ws, _made = edit_shell(tmp_path)
    status, out = call(s, "POST", "records/edit", headers={}, body=dict(edit_body(), **FORGERY))
    assert status == 401 and ws.merges() == [], out
    (tmp_path / "undo").mkdir()
    s, ws = undo_shell(tmp_path / "undo", PERSON)
    status, out = post(s, "records/undo", dict({"batch_id": BATCH}, **FORGERY), headers={})
    assert status == 401 and ws.queries("MERGE INTO") == [], out


@pytest.mark.parametrize("viewer, settings, can", [
    (PERSON, None, True),
    (PERSON.upper(), None, True),
    (OTHER, None, False),
    (OWNER, OWNED, True),
    (OTHER, OWNED, False),
])
def test_recent_changes_says_for_each_act_whether_the_signed_in_person_may_undo_it(tmp_path, viewer, settings, can):
    s, _ws = undo_shell(tmp_path, PERSON, settings=settings)
    status, out = call(s, "GET", "records/batches", headers={"x-forwarded-email": viewer}, query={"page": "n01_u05"})
    assert status == 200, out
    assert [(b["batch_id"], b["can_undo"]) for b in out["batches"]] == [(BATCH, can)]
    status, undone = post(s, "records/undo", {"batch_id": BATCH}, headers={"x-forwarded-email": viewer})
    assert (status == 200) is can, undone


def test_an_act_with_no_recorded_author_is_undoable_only_by_an_owner(tmp_path):
    s, _ws = undo_shell(tmp_path, PERSON, settings=OWNED)
    assert s.undo_refusal({"x-forwarded-email": OTHER}, s.page("n01_u05"), "") == f"{shell_core.UNDO_WORDS[2]}; someone else made it"
    assert s.undo_refusal({"x-forwarded-email": OWNER}, s.page("n01_u05"), "") == ""
    assert s.undo_refusal({}, s.page("n01_u05"), PERSON) == f"{shell_core.UNDO_WORDS[0]}; {PERSON} made it"


def test_a_closed_record_says_whether_the_signed_in_person_may_undo_its_close(tmp_path):
    pytest.importorskip("sqlglot")
    from v148_app_hub_test import SqliteWorkspace, hub_shell
    from v168_everything_list_test import DECIDE as LIST_DECIDE, ROWS, SAM

    def flags(folder, viewer, settings):
        folder.mkdir()
        s, _ws, _made = hub_shell(folder, settings=settings, ws=SqliteWorkspace(tables={"loss_desk_out": ROWS}))
        status, out = call(s, "POST", "records", headers={"x-forwarded-email": viewer}, body={"page": "n01_u05", "limit": 25})
        assert status == 200, out
        return {r["record_key"]: r["_inspire_closed_can_undo"] for r in out["rows"]}

    assert flags(tmp_path / "author", SAM, LIST_DECIDE) == {"r1": True, "r2": False, "r3": False, "r4": False, "r5": False}
    assert flags(tmp_path / "other", FORGED, LIST_DECIDE) == {"r1": False, "r2": False, "r3": False, "r4": False, "r5": False}
    owned = dict(LIST_DECIDE, use_case_owners={"n01_u05": [OWNER]})
    assert flags(tmp_path / "owner", OWNER, owned) == {"r1": True, "r2": True, "r3": False, "r4": True, "r5": False}


def test_batches_query_filters_one_batch_only_when_asked():
    page = {"result_table": "main.pricing.loss_desk_out", "use_case_id": "N01-U05"}
    every, _ = shell_sql.batches_query(page)
    one, params = shell_sql.batches_query(page, 1, batch_id=BATCH)
    assert "b.`action_batch` = :p" not in every
    assert "b.`action_batch` = :p" in one and one.endswith("LIMIT 1") and BATCH in {p["value"] for p in params}
