import json

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import VALID, _inspire, _left_by
from v143_vibes_test import LIVE, _run
from v152_mvp_vibe_test import _llm
from v162_one_vibe_box_test import APP_ASK, CARRIED, _rebuild, _vibe_step
from v163_hold_gate_test import CHART, _held_row, _publishing

REGION = "Show the region on every row"
PAGE = "app:page:n01_u01"
CHECKLIST = [{"n": 1, "requirement": REGION, "part": PAGE, "where": "App page n01_u01", "status": "met",
              "evidence": "the page shows a region column", "rounds": 1, "tried": [], "checks": [], "published_anyway": None}]
SUMMARY = {"met": 1, "total": 1}
VIBE = {"state": "routed", "text": REGION, "previous": "remove", "routes": {PAGE: REGION}, "not_routed": [], "spec_version": 3}
GRANTS = {"app": {"churn-desk": {"people": [{"name": "planner@example.com", "kind": "user"}],
                                 "service_principal": {"name": "", "sql": [], "genie": []}}}}
SETTINGS = [{"source": "widget", "name": "top_k", "value": "25"}]
KEPT = {"state": "kept", "assets": []}
TARGET_KPI = {"name": "Customers at risk", "source": "inspire", "picked_by": "inspire", "computable": False}
DATA = {"state": "failed", "missing_tables": [], "spec_version": 3}
HELD = {"parts": ["dashboard"], "reason": "held", "candidates": ["dashboard"], "notebook": "", "unmet": []}
PUBLISHED = {"version": 2, "by": "owner@example.com", "at": "2026-01-01T00:00:00Z"}
ASSETS_V3 = {"genie_space": {"state": "ready", "spec_version": 3, "title": "Churn agent"},
             "dashboard": {"state": "ready", "spec_version": 3, "title": "Churn board"},
             "dashboard:by_region": {"state": "ready", "spec_version": 3, "title": "Customers by region"},
             "app": {"state": "ready", "spec_version": 3, "title": "Churn desk"},
             PAGE: {"state": "ready", "spec_version": 3, "title": "Churn desk",
                    "vibes_checks": [{"ask": REGION, "status": "done", "evidence": "the page shows a region column"}]},
             "value_formula": {"state": "ready", "spec_version": 3, "title": "Money formula"}}
ONE_VERSION = {"data": DATA, "vibe": VIBE, "held": HELD, "published_held": PUBLISHED, "checklist": CHECKLIST,
               "checklist_summary": SUMMARY}
ACROSS = {"kept": KEPT, "grants": GRANTS, "settings": SETTINGS, "target_kpi": TARGET_KPI}


def _copy(value):
    return json.loads(json.dumps(value))


def _v3_status(**records):
    return _left_by(3, {**_copy(ASSETS_V3), **_copy(records)})


def _rows_select(rows, seen=None):
    def select(where, args, order=""):
        if seen is not None:
            seen.append((where, dict(args)))
        assert "spec_version <" in where, where
        keep = (lambda v: v <= args["v"]) if "spec_version <=" in where else (lambda v: v < args["v"])
        return [_copy(row) for row in sorted(rows, key=lambda r: -r["spec_version"]) if keep(row["spec_version"])]

    return select


def _ready_row(version, asset_status, **columns):
    row = dict(CARRIED, session_id=5150, use_case_id="N01-U01", spec_version=version, status="ready", asset_status=asset_status,
               genie_widgets=[], data_profiles={}, suggested_schedule={})
    row.update(columns)
    return row


def _copying_updates(inst):
    inst._implement_update = lambda key, **fields: inst.updates.append(json.loads(json.dumps(fields, default=str)))


def test_an_edit_after_a_version_with_a_vibe_checklist_carries_it_runs_the_vibe_step_and_builds(agent_ns):
    calls = []
    inst = _rebuild(agent_ns, calls)
    del inst._implement_carried
    seen = []
    inst._implement_select = _rows_select([_ready_row(3, _v3_status(checklist=CHECKLIST, checklist_summary=SUMMARY, vibe=VIBE,
                                                                     grants=GRANTS))], seen)
    inst._implement_previous = lambda target: {"spec_version": 3, "spec_json": _copy(VALID)}
    _copying_updates(inst)
    _llm(inst, {"app": APP_ASK})
    assert _run(inst, dict(VALID, vibes=APP_ASK, vibe_previous="remove"), 4) in ("ready", "ready_with_warnings"), inst.updates[-1]
    assert seen and all(args["v"] == 4 for _where, args in seen), "the carry read the versions before v4"
    step = _vibe_step(inst)
    assert (step["status"], step["message"]) == ("ended_success", f"sent to App: {APP_ASK}"), "the Vibe step ran on v4"
    assert [call[0] for call in calls if call[0] in ("genie_space", "dashboard", "app", "alert")] == ["app"]
    start = next(update for update in inst.updates if update.get("status") == "filling")["asset_status"]
    assert set(agent_ns["IMPLEMENT_VERSION_RECORDS"]).isdisjoint(start), f"v3's own records reached v4's start: {sorted(start)}"
    assert start["grants"] == GRANTS and start[PAGE]["spec_version"] == 3, "the use case's grants and v3's assets carry into v4"
    final = inst.updates[-1]["asset_status"]
    assert final["vibe"]["spec_version"] == 4 and final["vibe"]["text"] == APP_ASK, "v4 records its own vibe, never v3's"
    assert [entry["requirement"] for entry in final["checklist"]] == [APP_ASK] and final["checklist_summary"] == {"met": 1, "total": 1}
    assert final["grants"] == GRANTS


def test_the_asset_entries_are_only_dict_entries_whose_name_is_not_a_record(agent_ns):
    entries = agent_ns["implement_asset_entries"]
    status = {**_copy(ASSETS_V3), **_copy(ONE_VERSION), **_copy(ACROSS), "notes": "free text", "nothing": None, "pages": ["n01_u01"],
              "count": 3}
    assert dict(entries(status)) == ASSETS_V3, "lists, text, numbers, None and every record are never an asset entry"
    assert all(isinstance(entry, dict) for _name, entry in entries(status))
    for record in (*agent_ns["IMPLEMENT_VERSION_RECORDS"], *agent_ns["IMPLEMENT_CARRIED_RECORDS"]):
        assert entries({record: {"state": "deleted"}}) == [], f"the {record} record is never an asset, even shaped like one"
    for odd in (None, [], ["app"], "app", 7, [("app", {"state": "ready"})]):
        assert entries(odd) == [], repr(odd)
    assert entries({"app": {"state": "ready"}}) == [("app", {"state": "ready"})]


def test_the_records_are_named_once_and_never_overlap_an_asset_or_part_name(agent_ns):
    version, across = agent_ns["IMPLEMENT_VERSION_RECORDS"], agent_ns["IMPLEMENT_CARRIED_RECORDS"]
    status_records = agent_ns["IMPLEMENT_STATUS_RECORDS"]
    assert list(status_records) == list(dict.fromkeys(version + across)) and len(set(status_records)) == len(status_records)
    assert set(across) == {"kept", "grants", "settings", "target_kpi"}
    for name in status_records:
        assert agent_ns["implement_asset_owner"](name) == "" and agent_ns["implement_part"](name) is None, name


def test_the_carry_keeps_assets_and_use_case_records_and_drops_every_record_of_one_version(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    v2 = _left_by(2, {"dashboard": {"state": "ready", "spec_version": 2}, "checklist": _copy(CHECKLIST), "settings": [{"source": "widget",
                                                                                                                         "name": "old"}]})
    v3 = _v3_status(**ONE_VERSION, **ACROSS)
    v4 = _left_by(4, {"app": {"state": "ready", "spec_version": 4}, "checklist": [], "data": {"state": "failed", "spec_version": 4}})
    inst._implement_select = _rows_select([_ready_row(2, v2), _ready_row(3, v3), _ready_row(4, v4)])
    carried, status = inst._implement_carried({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 5})
    assert carried["app_name"] == "churn-desk" and carried["dashboard_id"] == "d1"
    assert set(ONE_VERSION).isdisjoint(status), f"a record of one version was carried: {sorted(set(ONE_VERSION) & set(status))}"
    assert {name: status[name] for name in ACROSS} == ACROSS, "the newest kept, grants, settings and target KPI carry"
    assert status["app"] == {"state": "ready", "spec_version": 4} and status["dashboard"] == ASSETS_V3["dashboard"]
    assert status[PAGE] == ASSETS_V3[PAGE] and status["notebook"]["spec_version"] == 4


def test_the_carry_stops_only_at_a_deleted_or_released_asset_and_never_at_a_record_that_looks_like_one(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    older = _ready_row(2, {"dashboard": {"state": "ready"}}, dashboard_id="d2")
    newer = _ready_row(3, {"checklist": [{"state": "deleted"}], "data": {"state": "deleted"}, "kept": {"state": "released"},
                           "app": {"state": "released"}}, dashboard_id=None, app_name=None, app_url=None)
    inst._implement_select = _rows_select([older, newer])
    carried, status = inst._implement_carried({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 4})
    assert carried["dashboard_id"] == "d2", "a record whose state reads deleted never stops an asset from carrying"
    assert "app_name" not in carried, "a released App still stops the carry"
    assert status["kept"] == {"state": "released"} and "data" not in status and "checklist" not in status


def test_the_repair_attempt_takes_the_use_case_records_of_its_own_row_and_none_of_its_version_records(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    own = _ready_row(4, _left_by(4, {"app": {"state": "failed", "spec_version": 4}, "grants": _copy(GRANTS), "checklist": _copy(CHECKLIST),
                                     "vibe": dict(VIBE, spec_version=4)}), status="filling")
    inst._implement_select = _rows_select([_ready_row(3, _v3_status(**ONE_VERSION)), own])
    _carried, status = inst._implement_carried({"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 4}, through_own=True)
    assert status["grants"] == GRANTS and status["app"]["spec_version"] == 4
    assert set(ONE_VERSION).isdisjoint(status)


def test_publish_anyway_copies_the_held_version_s_checklist_and_never_an_older_built_one(agent_ns):
    held = _held_row()
    built = dict(_held_row(version=2, status="ready"), **CARRIED)
    built["asset_status"] = _left_by(2, {**_copy(LIVE), "checklist": [dict(CHECKLIST[0], requirement="An older ask")],
                                         "checklist_summary": SUMMARY, "vibe": dict(VIBE, spec_version=2)})
    inst, target, deployed, _snapshots = _publishing(agent_ns, held, rows=[held, built])
    del inst._implement_carried
    assert inst._implement_one_locked(target, (5150, "N01-U01", 4)) == "ready_with_warnings"
    assert deployed == [CHART]
    final = inst.updates[-1]["asset_status"]
    assert [entry["requirement"] for entry in final["checklist"]] == [held["asset_status"]["checklist"][0]["requirement"]]
    assert final["checklist_summary"] == {"met": 0, "total": 1} and "vibe" not in final, "only the held version's checklist is copied"


def test_publish_anyway_copies_only_dict_parts_of_the_held_candidates(agent_ns):
    held = _held_row()
    held["asset_status"].update({"dashboard:by_region": {"state": "ready", "spec_version": 3}, "dashboard:odd": ["not", "an", "entry"],
                                 "app:page:n01_u01": {"state": "ready", "spec_version": 3}})
    inst, target, _deployed, _snapshots = _publishing(agent_ns, held)
    _copying_updates(inst)
    assert inst._implement_one_locked(target, (5150, "N01-U01", 4)) == "ready_with_warnings"
    start = next(update for update in inst.updates if update.get("status") == "filling")["asset_status"]
    assert start["dashboard:by_region"] == {"state": "ready", "spec_version": 3}, "a dict part of a held output is copied"
    assert "dashboard:odd" not in start, "a part that is not a dict is never copied as an asset"
    assert "app:page:n01_u01" not in start, "a part whose output was not held is not copied"
    assert [entry["requirement"] for entry in start["checklist"]] == [held["asset_status"]["checklist"][0]["requirement"]]
    assert "held" not in start and "vibe" not in start


def test_the_holder_check_reads_a_holder_whose_newest_version_has_a_checklist(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    holder_rows = [{"session_id": 777, "use_case_id": "N01-U07", "spec_version": 3, "status": "ready", "created_by": "planner@example.com",
                    "spec_json": {"use_case_name": "Sales", "outputs": {}}}]
    status = _left_by(3, {"dashboard": {"state": "ready", "spec_version": 3, "merged_into": "dA"}, "checklist": _copy(CHECKLIST),
                          "checklist_summary": SUMMARY, "settings": _copy(SETTINGS),
                          "grants": {"dashboard": {"dA": {"people": [{"name": "planner@example.com"}]}}}})
    carry_rows = [dict(_ready_row(3, status, dashboard_id="dA"), session_id=777, use_case_id="N01-U07")]

    def select(where, args, order=""):
        if "spec_version <" in where:
            return [_copy(row) for row in carry_rows if row["spec_version"] < args["v"]]
        return _copy(holder_rows)

    inst._implement_select = select
    [holder] = inst._implement_output_holders("dashboard", "dA", (5150, "N01-U01", 3))
    assert (holder["session_id"], holder["use_case_id"], holder["joining"]) == (777, "N01-U07", False)
    assert holder["grants"] == {"people": [{"name": "planner@example.com"}]}
    assert holder["status"] == {"state": "ready", "spec_version": 3, "merged_into": "dA"}


@pytest.mark.parametrize("record", ["checklist", "settings"])
def test_a_list_record_under_any_status_reader_never_raises(agent_ns, record):
    status = _v3_status(**{record: _copy(CHECKLIST if record == "checklist" else SETTINGS)})
    assert agent_ns["implement_vibes_seed"](status) == {}
    assert set(agent_ns["implement_vibe_targets"](status, {"app": True, "dashboard": True})) >= {"app", "dashboard", PAGE}
    assert agent_ns["implement_live_unmet"](status, dict(VALID, outputs={**VALID["outputs"], f"{PAGE}_vibes": REGION})) == {}
