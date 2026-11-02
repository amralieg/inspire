import base64
import logging
import os
import time
import types

import pytest

from v120_artifacts_support import FakeSpark, make_inspire
from v140_implement_test import _delete_app_inspire, _inspire, _output_context
from v142_merge_test import DASH, _dashboard_inspire, _merge_flow, _page_runner

KEY = "implement-asset::app::inspire-hub-acme"
WAIT = ("waiting for use case N01-U01 of session 5150 to finish changing the App inspire-hub-acme, so neither build overwrites the "
        "other's changes")
FREE = "the App inspire-hub-acme is free, so this build changes it now"


class LockTable:
    def __init__(self):
        self.rows = {}
        self.events = []

    def writer(self, holder, fail=None):
        table = self

        class Writer:
            def acquire_lock(self, key, ttl_seconds=None, holder_note="", max_attempts=None):
                table.events.append(("acquire", holder, key))
                if fail == "acquire":
                    raise RuntimeError("[TABLE_OR_VIEW_NOT_FOUND] __inspire_lock")
                table.rows.setdefault(key, {})[holder] = holder_note
                return set(table.rows[key]) == {holder}

            def release_lock(self, key):
                table.events.append(("release", holder, key))
                if fail == "release":
                    raise RuntimeError("warehouse stopped")
                table.rows.get(key, {}).pop(holder, None)

            def lock_notes(self, key):
                if fail == "notes":
                    raise RuntimeError("warehouse stopped")
                return list(table.rows.get(key, {}).values())

        return Writer()


def _builds(ns, table, second_fail=None):
    first, second = _inspire(ns, FakeSpark()), _inspire(ns, FakeSpark())
    first.atomic_writer, second.atomic_writer = table.writer("A"), table.writer("B", second_fail)
    second.steps = []
    second._implement_emit = lambda uc, label, message, status, extra=None, step_id=None: second.steps.append(
        (uc, label, message, status, step_id)) or 7
    return first, second


def _clock(monkeypatch, on_sleep):
    now, slept = [1000.0], []

    def sleep(seconds):
        slept.append(seconds)
        now[0] += seconds
        on_sleep(len(slept))

    monkeypatch.setattr(time, "time", lambda: now[0])
    monkeypatch.setattr(time, "sleep", sleep)
    return slept


def test_a_second_build_waits_for_the_build_changing_the_same_app_and_says_which_use_case_it_waits_for(agent_ns, monkeypatch):
    table = LockTable()
    first, second = _builds(agent_ns, table)
    slept = _clock(monkeypatch, lambda n: n == 3 and table.rows[KEY].pop("A"))
    inside = []
    with first._implement_asset_lock("app", "inspire-hub-acme", "N01-U01", 6):
        assert table.rows[KEY] == {"A": "operation=Implement Use Cases session=5150 uc=N01-U01 spec=6"}
        with second._implement_asset_lock("app", "inspire-hub-acme", "N02-U01", 3):
            inside.append(dict(table.rows[KEY]))
    assert inside == [{"B": "operation=Implement Use Cases session=5150 uc=N02-U01 spec=3"}], "only one build changes the App at a time"
    assert len(slept) == 3 and all(agent_ns["IMPLEMENT_LOCK_POLL_S"] <= s <= 2 * agent_ns["IMPLEMENT_LOCK_POLL_S"] for s in slept)
    assert second.steps == [("N02-U01", "App", WAIT, "started", None), ("N02-U01", "App", FREE, "ended_success", 7)], \
        "the wait shows once in the feed, and its step ends when the App is free"
    assert table.events == [("acquire", "A", KEY)] + [("acquire", "B", KEY), ("release", "B", KEY)] * 3 + [
        ("acquire", "B", KEY), ("release", "B", KEY), ("release", "A", KEY)], "a waiting build never keeps its own row while it waits"
    assert table.rows[KEY] == {}


def test_a_build_that_waits_an_hour_stops_without_changing_the_app_and_leaves_no_row(agent_ns, monkeypatch):
    table = LockTable()
    first, second = _builds(agent_ns, table)
    _clock(monkeypatch, lambda n: None)
    assert agent_ns["IMPLEMENT_LOCK_WAIT_S"] == 3600
    with first._implement_asset_lock("app", "inspire-hub-acme", "N01-U01", 6):
        with pytest.raises(agent_ns["ImplementBlocked"], match="the App inspire-hub-acme stayed busy with use case N01-U01 of session 5150 "
                                                               "for 60 minutes, so Inspire did not change it; build again once that build ends"):
            with second._implement_asset_lock("app", "inspire-hub-acme", "N02-U01", 3):
                pytest.fail("the App is never changed while another build holds it")
        assert table.rows[KEY] == {"A": "operation=Implement Use Cases session=5150 uc=N01-U01 spec=6"}
    assert [s[3] for s in second.steps] == ["started"]


def test_the_lock_is_taken_once_per_asset_and_never_for_an_asset_with_no_name(agent_ns):
    table = LockTable()
    build = _builds(agent_ns, table)[0]
    with build._implement_asset_lock("app", "inspire-hub-acme", "N01-U01", 6):
        with build._implement_asset_lock("app", "inspire-hub-acme", "N01-U01", 6):
            pass
        assert table.rows[KEY], "the inner use of the same App keeps the outer lock"
    with build._implement_asset_lock("dashboard", "", "N01-U01", 6), build._implement_asset_lock("app", "  ", "N01-U01", 6):
        pass
    assert table.events == [("acquire", "A", KEY), ("release", "A", KEY)]
    with build._implement_asset_lock("app", "inspire-hub-acme", "N01-U01", 6):
        with build._implement_asset_lock("genie_space", "g1", "N01-U01", 6):
            assert set(table.rows) == {KEY, "implement-asset::genie_space::g1"}
    assert agent_ns["implement_asset_lock_key"]("dashboard", " dA ") == "implement-asset::dashboard::dA"


def test_an_unreachable_lock_table_is_logged_and_the_build_goes_on_without_releasing_a_lock_it_never_took(agent_ns):
    table = LockTable()
    build = _inspire(agent_ns, FakeSpark())
    build.atomic_writer = table.writer("A", "acquire")
    ran = []
    with build._implement_asset_lock("app", "inspire-hub-acme", "N01-U01", 6):
        ran.append(True)
    assert ran == [True] and table.events == [("acquire", "A", KEY)]
    assert build.logger.matching(f"[IMPLEMENT-ASSET-LOCK UNVERIFIED] {KEY}")
    assert not build.logger.matching("RELEASE FAILED")
    build.atomic_writer = table.writer("A", "release")
    with build._implement_asset_lock("app", "inspire-hub-acme", "N01-U01", 6):
        pass
    assert build.logger.matching(f"[IMPLEMENT-ASSET-LOCK RELEASE FAILED] {KEY}: warehouse stopped")


def test_a_holder_that_cannot_be_read_is_named_another_build(agent_ns, monkeypatch):
    table = LockTable()
    first, second = _builds(agent_ns, table, second_fail="notes")
    _clock(monkeypatch, lambda n: table.rows[KEY].pop("A", None))
    with first._implement_asset_lock("app", "inspire-hub-acme", "N01-U01", 6):
        with second._implement_asset_lock("app", "inspire-hub-acme", "N02-U01", 3):
            pass
    assert second.steps[0][2].startswith("waiting for another build to finish changing the App inspire-hub-acme")
    assert second.logger.matching(f"[IMPLEMENT-ASSET-LOCK] {KEY}: the build holding it could not be read: warehouse stopped")


def test_holder_notes_name_each_use_case_with_its_session(agent_ns):
    holders = agent_ns["implement_lock_holder_use_cases"]
    assert holders(["operation=Implement Use Cases session=5150 uc=N01-U01 spec=6|run=11|holder=ab12",
                    "operation=Implement Use Cases session=7 uc=N01-U01 spec=2|run=12|holder=cd34",
                    "operation=Implement Use Cases session=5150 uc=N01-U01 spec=6|run=11|holder=ab12"]) == [
        "N01-U01 of session 5150", "N01-U01 of session 7"], "the same use case id in two sessions is two builds"
    assert holders(["operation=Implement Use Cases uc=N02-U01 spec=1"]) == ["N02-U01"]
    assert holders(["operation=Generate session=5150", "", None]) == []
    assert holders(None) == []


UC_WAIT = "waiting for the other build of this use case to finish, because both write the same notebook and result table"
UC_FREE = "the other build of this use case ended, so this build starts now"


def _use_case_builds(ns, table, second_session=5150):
    first, second = _builds(ns, table)
    second.session_id = second_session
    second.updates = []
    second._implement_update = lambda key, **fields: second.updates.append((key, fields))
    return first, second


def _while_first_builds(first, second, second_target, seen):
    def build(target, key, inflight):
        seen["rows"] = {k: dict(v) for k, v in first.atomic_writer_table.rows.items()}
        seen["second"] = second._implement_one(second_target)
        seen["after"] = {k: dict(v) for k, v in first.atomic_writer_table.rows.items()}
        return "ready"

    first._implement_one_locked = build
    return first._implement_one({"session_id": 5150, "use_case_id": second_target["use_case_id"], "spec_version": 2})


def test_the_same_use_case_id_in_another_session_of_the_same_business_builds_at_once(agent_ns, monkeypatch):
    table = LockTable()
    first, second = _use_case_builds(agent_ns, table, second_session=6160)
    first.atomic_writer_table = table
    assert first.business_name == second.business_name
    slept = _clock(monkeypatch, lambda n: pytest.fail("a build of another session never waits"))
    built, seen = [], {}
    second._implement_one_locked = lambda target, key, inflight: built.append(key) or "ready"
    assert _while_first_builds(first, second, {"session_id": 6160, "use_case_id": "N02-U01", "spec_version": 1}, seen) == "ready"
    assert seen["second"] == "ready" and built == [(6160, "N02-U01", 1)] and slept == [] and second.steps == []
    assert table.rows == {"implement::5150::N02-U01": {}, "implement::6160::N02-U01": {}}


def test_a_second_build_of_the_same_use_case_waits_for_the_first_then_builds_and_says_why(agent_ns, monkeypatch):
    table = LockTable()
    first, second = _use_case_builds(agent_ns, table)
    first.atomic_writer_table = table
    key = "implement::5150::N01-U01"
    _clock(monkeypatch, lambda n: n == 2 and table.rows[key].pop("A"))
    built, seen = [], {}
    second._implement_one_locked = lambda target, k, inflight: built.append(dict(table.rows[key])) or "ready"
    _while_first_builds(first, second, {"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3}, seen)
    assert seen["rows"] == {key: {"A": "operation=Implement Use Cases session=5150 uc=N01-U01 spec=2"}}
    assert seen["second"] == "ready"
    assert built == [{"B": "operation=Implement Use Cases session=5150 uc=N01-U01 spec=3"}], "it builds only once the first build ended"
    assert second.steps == [("N01-U01", "Implement", UC_WAIT, "started", None), ("N01-U01", "Implement", UC_FREE, "ended_success", 7)]
    assert second.updates == [] and table.rows[key] == {}


def test_a_build_still_blocked_after_the_wait_is_marked_failed_with_the_reason_and_never_left_queued(agent_ns, monkeypatch):
    table = LockTable()
    first, second = _use_case_builds(agent_ns, table)
    first.atomic_writer_table = table
    key = "implement::5150::N01-U01"
    _clock(monkeypatch, lambda n: None)
    second._implement_one_locked = lambda *args: pytest.fail("a use case another build still holds is never built")
    seen = {}
    _while_first_builds(first, second, {"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 3}, seen)
    reason = ("another build of this use case was still running after 60 minutes, so Inspire did not start this one; build again once "
              "it ends")
    assert seen["second"] == "failed"
    assert second.updates == [((5150, "N01-U01", 3), {"status": "failed", "status_message": reason})]
    assert second.steps == [("N01-U01", "Implement", UC_WAIT, "started", None), ("N01-U01", "Implement", reason, "ended_error", None)]
    assert seen["after"] == {key: {"A": "operation=Implement Use Cases session=5150 uc=N01-U01 spec=2"}}, "the first build keeps its lock"
    assert table.rows[key] == {}, "the first build releases its lock when it ends"


def _recording(inst, table, holder="A"):
    inst.atomic_writer = table.writer(holder)
    api = inst._implement_api

    def recorded(method, path, *args, **kwargs):
        table.events.append(("api", method, path))
        return api(method, path, *args, **kwargs)

    inst._implement_api = recorded


def _between(events, key, method, path):
    taken = events.index(("acquire", "A", key))
    released = len(events) - 1 - events[::-1].index(("release", "A", key))
    return taken < events.index(("api", method, path)) < released


def test_a_dashboard_merge_reads_patches_and_publishes_the_host_while_holding_its_lock(agent_ns, tmp_path):
    routes = {("GET", "/api/2.0/lakeview/dashboards/dA"): DASH, ("PATCH", "/api/2.0/lakeview/dashboards/dA"): {"etag": "e2"},
              ("POST", "/api/2.0/lakeview/dashboards/dA/published"): {}}
    inst, _calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    table = LockTable()
    _recording(inst, table)
    inst._implement_dashboard(_output_context(agent_ns, merge={"dashboard": "dA"}), _page_runner(agent_ns))
    key = "implement-asset::dashboard::dA"
    assert _between(table.events, key, "PATCH", "/api/2.0/lakeview/dashboards/dA")
    assert _between(table.events, key, "POST", "/api/2.0/lakeview/dashboards/dA/published")
    assert table.rows[key] == {}


def test_a_new_dashboard_of_its_own_takes_no_lock(agent_ns, tmp_path):
    routes = {("POST", "/api/2.0/lakeview/dashboards"): {"dashboard_id": "d9"}, ("POST", "/api/2.0/lakeview/dashboards/d9/published"): {}}
    inst, _calls = _dashboard_inspire(agent_ns, tmp_path, routes)
    table = LockTable()
    _recording(inst, table)
    inst._implement_dashboard(_output_context(agent_ns), _page_runner(agent_ns))
    assert not [e for e in table.events if e[0] != "api"]


def test_an_app_build_holds_the_lock_of_the_app_it_changes_for_the_whole_step(agent_ns):
    table = LockTable()
    inst = _inspire(agent_ns, FakeSpark())
    inst.atomic_writer = table.writer("A")
    seen = []
    inst._implement_app_name = lambda context, name: name
    inst._implement_app_locked = lambda context, runner, name: seen.append(
        (name, {k: dict(v) for k, v in table.rows.items()})) or {"app_name": name}
    context = _output_context(agent_ns, app=True, app_name="churn-desk", merge={"app": "inspire-hub-acme"})
    assert inst._implement_app(context, None) == {"app_name": "inspire-hub-acme"}
    assert seen == [("inspire-hub-acme", {KEY: {"A": "operation=Implement Use Cases session=5150 uc=N01-U01 spec=2"}})]
    assert table.rows[KEY] == {}
    seen.clear()
    assert inst._implement_app(_output_context(agent_ns, app=True, app_name="churn-desk"), None) == {"app_name": "churn-desk"}
    assert [k for k, v in seen[0][1].items() if v] == ["implement-asset::app::churn-desk"], "its own App is locked too, so a hub joining it waits"
    inst._implement_app_locked = lambda *a: (_ for _ in ()).throw(RuntimeError("deploy failed"))
    with pytest.raises(RuntimeError, match="deploy failed"):
        inst._implement_app(context, None)
    assert table.rows[KEY] == {}, "a failed App step releases the lock"


def test_a_page_joining_a_hub_locks_only_the_app_and_never_the_hub_s_genie_agent(agent_ns, tmp_path, monkeypatch):
    inst, context, seen, _calls = _merge_flow(agent_ns, tmp_path, monkeypatch, assets={"genie_space": "gB"})
    table = LockTable()
    _recording(inst, table)
    inst._implement_app(context, None)
    assert len(seen["deployed"]) == 1
    assert [e[2] for e in table.events if e[0] == "acquire"] == ["implement-asset::app::sales-desk"]
    assert table.rows["implement-asset::app::sales-desk"] == {}


def test_deleting_a_shared_output_waits_for_its_lock_and_an_alert_takes_none(agent_ns):
    inst = _delete_app_inspire(agent_ns, {"description": "Inspire use case N01-U01 (session 5150): Predict churn"})
    table = LockTable()
    _recording(inst, table)
    assert inst._implement_delete_output("app", "churn-desk", (5150, "N01-U01", 3))["warnings"] == []
    assert _between(table.events, "implement-asset::app::churn-desk", "DELETE", "/api/2.0/apps/churn-desk")
    table.events.clear()
    inst._implement_delete_output("alert", "a1", (5150, "N01-U01", 3))
    assert not [e for e in table.events if e[0] != "api"]


def _log_run(ns, tmp_path, operation, monkeypatch):
    monkeypatch.setattr(ns["workspace"], "ImportFormat", types.SimpleNamespace(AUTO="AUTO"), raising=False)
    log_path = tmp_path / "log.txt"
    log_path.write_text("run log line\n", encoding="utf-8")
    handler = logging.FileHandler(str(log_path))
    logging.root.handlers.insert(0, handler)
    out_dir = tmp_path / "out"
    obj = make_inspire(ns, base_output_dir=str(out_dir), sanitized_customer_name=f"inspire_log_dir_{tmp_path.name}")
    obj.operation = operation
    obj.session_id = 5150
    obj._implement_root_dir = "/Workspace/Users/me/inspire"
    imported = []
    obj._import_workspace_file = lambda path, content, fmt, overwrite=True: imported.append((path, base64.b64decode(content)))
    obj.w_client = types.SimpleNamespace(workspace=types.SimpleNamespace(get_status=lambda p: types.SimpleNamespace(path=p)))
    try:
        obj._upload_log_file()
    finally:
        logging.root.removeHandler(handler)
        handler.close()
        backup = os.path.join("/tmp", obj.sanitized_customer_name)
        if os.path.isdir(backup):
            for leaf in os.listdir(backup):
                os.unlink(os.path.join(backup, leaf))
            os.rmdir(backup)
    return obj, imported, out_dir


def test_an_implement_run_puts_its_log_in_the_session_folder_of_the_inspire_app_and_none_in_the_discovery_folder(agent_ns, tmp_path, monkeypatch):
    obj, imported, out_dir = _log_run(agent_ns, tmp_path, agent_ns["IMPLEMENT_OPERATION"], monkeypatch)
    [(path, data)] = imported
    assert os.path.dirname(path) == os.path.join(agent_ns["implement_session_dir"]("/Workspace/Users/me/inspire", "acme", 5150), "logs")
    assert os.path.dirname(path) == "/Workspace/Users/me/inspire/acme/session_5150/logs"
    assert data == b"run log line\n"
    assert not os.path.exists(out_dir / "log.txt"), "the discovery folder is never written by an Implement run"
    assert not obj.logger.matching("Failed to upload log file")


def test_a_discovery_run_keeps_its_log_in_its_own_folders(agent_ns, tmp_path, monkeypatch):
    obj, imported, out_dir = _log_run(agent_ns, tmp_path, "Discover Use Cases", monkeypatch)
    [(path, _data)] = imported
    assert os.path.dirname(path) == obj.docs_output_dir
    assert (out_dir / "log.txt").read_bytes() == b"run log line\n"
