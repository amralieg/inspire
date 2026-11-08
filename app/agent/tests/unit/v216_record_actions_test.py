import json
import os
import sys
import threading

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql
from v141_app_shell_test import call
from v142_edits_test import edit_page
from v144_app_data_test import EDITOR, OTHER, PERSON, SETTINGS, DataWorkspace, act, records, shell

KINDS = json.load(open(os.path.join(ROOT, "agent", "app_shell", "kinds.json"), encoding="utf-8"))
LAYOUTS = {layout["id"]: layout for layout in KINDS["layouts"]}
REQUEST = "0123456789abcdef0123456789abcdef"
INFORMATIONAL = sorted(i for i, layout in LAYOUTS.items() if layout.get("informational") is True)
DECIDING = sorted(i for i in LAYOUTS if i not in INFORMATIONAL)


class Replaying(DataWorkspace):
    def __init__(self, made=None, keys=(), **kwargs):
        super().__init__(**kwargs)
        self.made, self.keys = made, list(keys)

    def answer(self, sql, params):
        if sql.startswith("SELECT b.`action_batch` AS `batch_id`"):
            return {"columns": [], "rows": [self.made] if self.made else [], "truncated": False}
        if sql.startswith("SELECT DISTINCT `record_key` FROM"):
            return {"columns": [], "rows": [{"record_key": k} for k in self.keys], "truncated": False}
        return super().answer(sql, params)


def made(editor=PERSON, n=1, undone=0):
    return {"batch_id": REQUEST, "editor": editor, "at": "2026-11-05T10:00:00.000Z", "n": n, "batch_values": "{}", "note": None, "undone": undone}


def act_with(s, request=REQUEST, keys=("k1",), **body):
    sent = {"page": "n01_u05", "record_keys": list(keys), "values": {"action_status": "Done"}, "seen": {k: "101" for k in keys}}
    sent.update(body)
    if request is not None:
        sent["request_id"] = request
    return call(s, "POST", "records/act", headers=EDITOR, body=sent)


def test_exactly_the_dashboard_and_agent_layouts_are_informational_and_every_other_layout_decides():
    assert INFORMATIONAL == ["agent_chat", "dashboard"]
    assert len(DECIDING) == len(LAYOUTS) - 2 == 12
    for ident in LAYOUTS:
        page = {"layout": ident, "records": {"key": "entity_id"}}
        assert shell_sql.layout_decides(ident) is (ident in DECIDING), ident
        assert shell_sql.page_decides(page) is (ident in DECIDING), ident
        assert shell_sql.page_decides(dict(page, records=None)) is False, f"{ident}: a page with no records list decides nothing"


def test_every_kind_decides_exactly_when_it_is_not_informational():
    assert len(KINDS["kinds"]) == 40
    for kind in KINDS["kinds"]:
        layout = kind["layout"]
        assert shell_sql.layout_decides(layout) is (kind.get("informational") is not True), (
            f"{kind['id']} is informational={kind.get('informational')} but its page layout {layout} decides={shell_sql.layout_decides(layout)}")


def example(layout: str, **changes) -> dict:
    with open(os.path.join(ROOT, "agent", "app_shell", "examples", f"{layout}.json"), encoding="utf-8") as handle:
        page = json.load(handle)
    page.update(changes)
    return page


def act_on(s, page_id: str, values=None):
    body = {"page": page_id, "record_keys": ["k1"], "values": values or {"action_status": "Done"}, "seen": {"k1": "101"}}
    return call(s, "POST", "records/act", headers=EDITOR, body=body)


DECIDE = dict(SETTINGS, options=dict(SETTINGS["options"], decisions=True))
OFF = dict(SETTINGS, options=dict(SETTINGS["options"], decisions=False))


@pytest.mark.parametrize("layout", INFORMATIONAL)
def test_an_informational_page_shows_no_actions_and_refuses_every_decision_route_before_any_sql(tmp_path, layout):
    page = example(layout)
    s, ws, _made = shell(tmp_path, settings=dict(DECIDE, pages=[page["id"]]), pages=[page])
    label = LAYOUTS[layout]["label"].lower()
    for values in ({"action_status": "Done"}, {"action_status": "Dismissed", "dismiss_reason": "not ours"}, {"snooze_until": "2026-12-01"}):
        status, out = act_on(s, page["id"], values)
        assert status == 403 and out["error"] == (
            f"page {page['id']} is a {label} page: it shows information only, so people record no decisions on it"), out
    status, out = call(s, "POST", "records/undo", headers=EDITOR, body={"page": page["id"], "batch_id": REQUEST})
    assert status == 403 and "shows information only" in out["error"]
    assert ws.queries("MERGE INTO") == [] and ws.queries("action_batch") == []
    shown = call(s, "GET", "app", headers=EDITOR)[1]["pages"][0]
    assert shown["layout"]["decides"] is False and shown["layout"]["informational"] is True


def test_a_dashboard_page_with_a_records_list_still_records_no_decision(tmp_path):
    s, ws, _made = shell(tmp_path, settings=DECIDE, pages=[edit_page(layout="dashboard", charts=example("dashboard")["charts"],
                                                                          datasets=edit_page()["datasets"] + example("dashboard")["datasets"])])
    status, out = act(s, values={"action_status": "Done"})
    assert status == 403 and "is a dashboard page: it shows information only" in out["error"]
    assert ws.queries("MERGE INTO") == []
    assert records(s)[1]["actions"] is False


@pytest.mark.parametrize("layout", DECIDING)
def test_a_deciding_page_of_every_layout_records_decisions_when_the_app_records_them(tmp_path, layout):
    page = example(layout) if layout != "decision_queue" else edit_page()
    s, ws, _made = shell(tmp_path, settings=dict(DECIDE, pages=[page["id"]]), pages=[page])
    status, out = act_on(s, page["id"])
    assert status == 200 and out["written"] == ["k1"], out
    assert len(ws.queries("MERGE INTO")) == 1
    shown = call(s, "GET", "app", headers=EDITOR)[1]["pages"][0]
    assert shown["layout"]["decides"] is True and shown["layout"]["informational"] is False


@pytest.mark.parametrize("layout", DECIDING)
def test_an_app_whose_maker_turned_decisions_off_keeps_them_off_on_a_deciding_page(tmp_path, layout):
    page = example(layout) if layout != "decision_queue" else edit_page()
    s, ws, _made = shell(tmp_path, settings=dict(OFF, pages=[page["id"]]), pages=[page])
    status, out = act_on(s, page["id"])
    assert status == 403 and out["error"] == "this App does not let people record decisions on its records", out
    assert ws.queries("MERGE INTO") == []
    shown = call(s, "GET", "app", headers=EDITOR)[1]
    assert shown["options"]["decisions"] is False and shown["pages"][0]["layout"]["decides"] is True


@pytest.mark.parametrize("layout", INFORMATIONAL)
def test_an_informational_page_names_its_layout_even_when_decisions_are_off(tmp_path, layout):
    page = example(layout)
    s, ws, _made = shell(tmp_path, settings=dict(OFF, pages=[page["id"]]), pages=[page])
    status, out = act_on(s, page["id"])
    assert status == 403 and "shows information only" in out["error"], out
    assert ws.queries("MERGE INTO") == []


def test_a_request_id_becomes_the_batch_id_so_the_act_can_be_undone_by_it(tmp_path):
    s, ws, _made = shell(tmp_path, ws=Replaying())
    status, out = act_with(s)
    assert status == 200 and out["batch_id"] == REQUEST and ws.batch == REQUEST and "replayed" not in out
    assert len(ws.queries("MERGE INTO")) == 1


def test_retrying_an_act_with_the_same_request_id_saves_nothing_twice(tmp_path):
    s, ws, _made = shell(tmp_path, ws=Replaying(made=made(n=2), keys=["k1", "k2"]))
    status, out = act_with(s, keys=["k1", "k2", "k3"])
    assert status == 200 and out == {"written": ["k1", "k2"], "conflicts": [], "conflicts_count": 0, "left_out": 0, "batch_id": REQUEST,
                                     "replayed": True}
    assert ws.queries("MERGE INTO") == [], "a replay writes no second version"
    match = {"filters": {}, "view": {}, "as_of_us": "1730000000000000"}
    status, out = act_with(s, keys=(), record_keys=None, seen=None, match=match)
    assert status == 200 and out["written"] == 2 and out["matched"] == 2 and out["replayed"] is True
    assert ws.queries("MERGE INTO") == []


def test_a_request_id_of_another_person_or_of_an_undone_act_is_refused_and_nothing_is_written(tmp_path):
    s, ws, _made = shell(tmp_path, ws=Replaying(made=made(editor=OTHER)))
    status, out = act_with(s)
    assert status == 409 and "another person's act already used this request_id" in out["error"]
    (tmp_path / "undone").mkdir()
    s, ws2, _made = shell(tmp_path / "undone", ws=Replaying(made=made(undone=1)))
    status, out = act_with(s)
    assert status == 409 and "saved and then undone" in out["error"]
    assert ws.queries("MERGE INTO") == [] and ws2.queries("MERGE INTO") == []


@pytest.mark.parametrize("request_id", ["", "x" * 32, REQUEST.upper(), REQUEST[:-1], 7, "0123456789abcdef0123456789abcdef'--"])
def test_a_malformed_request_id_is_a_400_before_any_sql(tmp_path, request_id):
    s, ws, _made = shell(tmp_path, ws=Replaying())
    status, out = act_with(s, request=request_id)
    assert status == 400 and "request_id is 32 lowercase hex characters" in out["error"]
    assert ws.sql == []


def test_without_a_request_id_every_act_gets_a_fresh_batch_and_no_replay_lookup(tmp_path):
    s, ws, _made = shell(tmp_path, ws=Replaying(made=made()))
    status, out = act_with(s, request=None)
    assert status == 200 and out["batch_id"] != REQUEST and "replayed" not in out
    assert not [sql for sql, _p, _l in ws.sql if sql.startswith("SELECT b.`action_batch` AS `batch_id`")]


class SlowWrite(Replaying):
    def __init__(self, **kwargs):
        super().__init__(**kwargs)
        self.writing, self.release = threading.Event(), threading.Event()

    def answer(self, sql, params):
        if sql.startswith("MERGE INTO"):
            self.writing.set()
            assert self.release.wait(10), "the test never let the write finish"
        return super().answer(sql, params)


def test_reads_answer_while_a_slow_write_is_still_open_and_the_write_lands_after(tmp_path):
    s, ws, _made = shell(tmp_path, ws=SlowWrite())
    done = {}
    writer = threading.Thread(target=lambda: done.update(act=act_with(s)))
    writer.start()
    try:
        assert ws.writing.wait(5), "the act never reached its MERGE"
        reads = {}
        reader = threading.Thread(target=lambda: reads.update(list=records(s), again=records(s, offset=0, limit=25)))
        reader.start()
        reader.join(5)
        assert not reader.is_alive(), "a records read waited on the open write"
        assert reads["list"][0] == 200 and reads["again"][0] == 200
        assert "act" not in done, "the write is still open while the reads answered"
    finally:
        ws.release.set()
        writer.join(10)
    status, out = done["act"]
    assert status == 200 and out["batch_id"] == REQUEST
    assert len(ws.queries("MERGE INTO")) == 1
