"""A decision list with nobody to act on is a note, the folder of a page inside Inspire is found when its record cannot name it, and
a use case added to an App names its own owners, offline."""
import pytest

from v120_artifacts_support import FakeSpark
from v143_vibes_test import _locked, _run

MIX = "Decision list: no row of the latest run reached Act now or Review (4 Monitor), so it has nobody to act on yet; no row is flagged"
NOT_RELIABLE = ("Not reliable yet: the latest run marked its results not reliable and wrote why in not_reliable of main.inspire.out, "
                "which the App shows")


def _version(agent_ns, tier):
    inst, previous = _locked(agent_ns)
    inst._implement_runner = lambda uc: "genie"
    inst._implement_tier_warning = lambda uc_id, table, url, run_id=None: tier
    inst._implement_dashboard = lambda context, runner: {"dashboard_id": "d1", "dashboard_url": "https://h/d"}
    status = _run(inst, dict(previous, retry_outputs=["dashboard"]))
    return status, inst.updates[-1], inst.emitted


def test_a_decision_list_with_nobody_to_act_on_is_a_note_and_the_use_case_stays_ready(agent_ns):
    status, final, emitted = _version(agent_ns, MIX)
    told = MIX.removeprefix("Decision list: ")
    assert status == "ready" and final["status"] == "ready"
    assert final["asset_status"][agent_ns["IMPLEMENT_DECISION_LIST"]] == {"notes": [told], "spec_version": 3}
    assert "nobody to act on" not in final["status_message"]
    steps = [e for e in emitted if e.get("step_name") == "Decision list"]
    assert [(e["status"], e["result_json"]["notes"]) for e in steps] == [("ended_success", [told])]
    assert [e for e in emitted if e.get("step_name") == "Done"][-1]["status"] == "ended_success"
    assert agent_ns["IMPLEMENT_DECISION_LIST"] == "decision_list", "the App reads the notes of this record"


def test_a_run_marked_not_reliable_stays_a_warning_and_leaves_no_decision_list_note(agent_ns):
    status, final, emitted = _version(agent_ns, NOT_RELIABLE)
    assert status == "ready_with_warnings" and NOT_RELIABLE in final["status_message"]
    assert agent_ns["IMPLEMENT_DECISION_LIST"] not in final["asset_status"]
    assert [e for e in emitted if e.get("step_name") == "Done"][-1]["status"] == "ended_warning"
    status, final, _emitted = _version(agent_ns, "")
    assert status == "ready" and agent_ns["IMPLEMENT_DECISION_LIST"] not in final["asset_status"]


def _hosted(agent_ns, listed=None, missing=False):
    from v140_implement_test import _inspire
    inst = _inspire(agent_ns, FakeSpark())
    seen = {"listed": [], "deleted": []}

    def objects(folder):
        seen["listed"].append(folder)
        if missing:
            raise RuntimeError(f"RESOURCE_DOES_NOT_EXIST: {folder} does not exist")
        return listed if listed is not None else [{"path": f"{folder}/v1", "object_type": "DIRECTORY"}]

    inst._implement_folder_objects = objects
    inst._implement_delete_path = lambda path, what: seen["deleted"].append(path) or ""
    return inst, seen


BAD = {"id": "n01-u01-5150", "source": "/somewhere/else"}


def test_a_page_inside_inspire_whose_record_names_no_folder_is_found_in_its_mvp_folder_and_deleted(agent_ns):
    inst, seen = _hosted(agent_ns)
    assert inst._implement_app_hosted_remove(BAD, ["/W/mvp"]) == []
    assert seen["listed"] == ["/W/mvp/apps/n01-u01-5150"]
    assert seen["deleted"] == ["/W/mvp/apps/n01-u01-5150/v1", "/W/mvp/apps/n01-u01-5150"]
    inst, seen = _hosted(agent_ns, missing=True)
    assert inst._implement_app_hosted_remove(BAD, ["/W/mvp"]) == [] and seen["deleted"] == [], "nothing is there, so nothing is left"


def test_a_page_inside_inspire_with_no_folder_inspire_can_find_names_the_action(agent_ns):
    inst, seen = _hosted(agent_ns)
    assert inst._implement_app_hosted_remove(BAD) == [
        "App: Inspire could not tell the folder of the page inside Inspire from /somewhere/else, so it deleted nothing; delete the "
        "folder apps/n01-u01-5150 in this use case's MVP folder in the workspace"]
    assert seen == {"listed": [], "deleted": []}


def test_a_live_app_takes_the_page_inside_inspire_out_of_the_use_cases_mvp_folder(agent_ns):
    inst, seen = _hosted(agent_ns)
    inst._implement_mvp_dirs = lambda use_case, key: {"mvp": "/W/mvp"}
    hosted = dict(BAD, version=1)
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 3), "use_case": {},
               "asset_status": {"app": {"placement": "inspire", "hosted": hosted}}}
    assert inst._implement_app_left_inspire(context) == []
    assert seen["deleted"][-1] == "/W/mvp/apps/n01-u01-5150"


@pytest.mark.parametrize("owners,merged", [(["owner@example.com"], "hub-desk"), ([], "hub-desk"), (["owner@example.com"], "")])
def test_a_use_case_added_to_an_app_names_its_own_owners(agent_ns, owners, merged):
    from v140_implement_test import VALID
    spec = dict(VALID, outputs=dict(VALID["outputs"], app=True, app_owners=owners, merge=dict(VALID["outputs"].get("merge") or {}, app=merged)))
    clean, errors = agent_ns["validate_implement_spec"](spec)
    assert not [e for e in errors if "owner" in e.lower()] and clean["outputs"]["app_owners"] == owners, errors
    assert "IMPLEMENT_JOINED_OWNERS" not in agent_ns, "each use case of a shared App names its own owners"
