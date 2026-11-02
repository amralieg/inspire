import copy

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire
from v141_app_shell_test import call
from v142_edits_test import edit_page
from v144_app_ops_test import DANA, JOB, JobsWorkspace, LEE, OWNER, SAM, ops_settings, ops_shell, signed
import shell_core

A, B = "n01_u05", "n02_u01_s9"
OTHER_JOB = "4343"
REFUSED = {"settings": "Only the owners of this use case can change its settings",
           "run": "Only the owners of this use case can run it now",
           "assumptions": "Only the owners of this use case can change its assumptions"}
UNNAMED = "No one can change the settings of this use case, because the App names no owner of it; build it again with Vibe/Add/Remove Features on Inspire's Build page"


def _hub_settings(**changes):
    out = ops_settings(pages=[A, B], jobs={A: OTHER_JOB, B: JOB}, admin=OWNER, use_case_owners={A: [OWNER, DANA], B: [SAM]})
    out.update(changes)
    return out


def _pages():
    return [edit_page(), edit_page(id=B, use_case_id="N02-U01", title="Second use case")]


def _hub(tmp_path, **changes):
    return ops_shell(tmp_path, JobsWorkspace(), settings=_hub_settings(**changes), pages=_pages())


def test_on_a_shared_app_an_owner_of_one_use_case_is_refused_on_another_s_settings_and_runs(tmp_path):
    s, sp, _now = _hub(tmp_path)
    status, out = call(s, "GET", "settings", query={"page": B}, headers=signed(OWNER))
    assert status == 200 and (out["editable"], out["why"], out["can_run"]) == (False, REFUSED["settings"], False)
    assert call(s, "POST", "settings/save", headers=signed(OWNER), body={"page": B, "name": "act_now_amount", "value": "1", "was": "0"}) == (
        403, {"error": REFUSED["settings"]})
    assert call(s, "POST", "settings/run", headers=signed(OWNER), body={"page": B}) == (403, {"error": REFUSED["run"]})
    assert call(s, "POST", "refresh", headers=signed(DANA), body={"page": B}) == (403, {"error": REFUSED["run"]}), \
        "an App owner named by another use case cannot refresh this one"
    assert sp.jobs_calls("run-now") == [], "nothing started for a person who owns another use case"
    page_a, page_b = s.page(A), s.page(B)
    assert s.owner_refusal(signed(OWNER), page_a, shell_core.SETTING_WORDS) == ""
    assert s.owner_refusal(signed(DANA), page_a, shell_core.SETTING_WORDS) == ""
    assert s.owner_refusal(signed(SAM), page_a, shell_core.SETTING_WORDS) == REFUSED["settings"]
    assert s.owner_refusal(signed(SAM), page_b, shell_core.SETTING_WORDS) == ""
    assert s.assumption_refusal(signed(OWNER), page_b, {"recomputes": True}) == REFUSED["assumptions"]
    assert s.assumption_refusal(signed(SAM.upper()), page_b, {"recomputes": True}) == ""
    assert s.requester(signed(OWNER), page_a) == (OWNER, 0, "")
    assert s.requester(signed(OWNER), page_b) == (OWNER, 403, REFUSED["run"])
    status, out = call(s, "POST", "settings/run", headers=signed(SAM), body={"page": B})
    assert status == 200 and sp.jobs_calls("run-now") == [("run-now", JOB, {"refresh_requested_by": SAM})]


def test_the_app_s_admin_keeps_its_other_rights_on_a_shared_app(tmp_path):
    s, _sp, _now = _hub(tmp_path)
    assert s.alerts.admin(signed(OWNER)) is True and s.alerts.admin(signed(SAM)) is False
    assert s.alerts.can_change({"kind": "assigned", "owner": SAM}, OWNER, s.alerts.admin(signed(OWNER))) is True
    assert s.owner_refusal(signed(OWNER), s.page(A), shell_core.RUN_WORDS) == "", "the admin still runs the use case it owns"
    assert call(s, "GET", "app")[0] == 200


def test_the_app_names_no_owner_of_a_use_case_it_holds_no_record_for_and_never_falls_back_to_its_admin(tmp_path):
    s, _sp, _now = _hub(tmp_path, use_case_owners={A: [OWNER]})
    assert s.owner_refusal(signed(OWNER), s.page(B), shell_core.SETTING_WORDS) == UNNAMED
    assert s.owner_refusal(signed(OWNER), s.page(A), shell_core.SETTING_WORDS) == ""
    unrecorded = _hub_settings()
    unrecorded.pop("use_case_owners")
    (tmp_path / "unrecorded").mkdir()
    s, sp, _now = ops_shell(tmp_path / "unrecorded", JobsWorkspace(), settings=unrecorded, pages=_pages())
    assert s.page_editors(s.page(A)) == set() and s.page_editors(s.page(B)) == set()
    assert s.owner_refusal(signed(OWNER), s.page(A), shell_core.SETTING_WORDS) == UNNAMED, "the admin is no owner of a use case"
    assert call(s, "POST", "refresh", headers=signed(OWNER), body={"page": A}) == (
        403, {"error": "No one can run this use case from the App, because the App names no owner of it; build it again with Vibe/Add/Remove Features on Inspire's Build page"})
    assert sp.jobs_calls("run-now") == []


@pytest.mark.parametrize("listed,ok", [
    ({A: [OWNER], B: [SAM, DANA]}, True),
    ({}, True),
    (None, True),
    ({"gone_page": [OWNER]}, False),
    ({A: OWNER}, False),
    ({A: [""]}, False),
    ({A: [7]}, False),
    ({A: ["x" * 255]}, False),
    ({A: [f"p{i}@example.com" for i in range(shell_core.OWNERS_MAX + 1)]}, True),
    ({A: [f"p{i}@example.com" for i in range(shell_core.OWNERS_MAX + 2)]}, False),
    ([OWNER], False),
])
def test_the_app_checks_its_record_of_each_use_case_s_owners(listed, ok):
    settings = _hub_settings(use_case_owners=listed)
    if listed is None:
        settings.pop("use_case_owners")
    problems = shell_core.settings_problems(settings, [edit_page(), edit_page(id=B, use_case_id="N02-U01")])
    named = [p for p in problems if "use_case_owners" in p]
    assert named == ([] if ok else [f"the App use_case_owners must be an object of page id to a list of at most "
                                    f"{shell_core.USE_CASE_OWNERS_MAX} user names, the person who asked for that use case and the App "
                                    "owners it names, who may change its settings and run it"]), problems


def _held(ns, page_ids, admin=OWNER, use_case_owners=None):
    held = ns["implement_app_settings"](shell_core.SETTINGS_VERSION, "N01-U05 Sales desk", page_ids, None, "off", "t1", {"app_access": "sp"},
                                       jobs={p: JOB for p in page_ids}, admin=admin)
    if use_case_owners is not None:
        held["use_case_owners"] = use_case_owners
    return held


def _joiner(ns, owners=()):
    return ns["implement_app_settings"](shell_core.SETTINGS_VERSION, "N02-U01 Second", ["n02_u01"], None, "off", "t1",
                                        {"app_access": "sp", "app_owners": list(owners)}, jobs={"n02_u01": JOB}, admin=SAM)


def _host(ns, held, pages, merged=True):
    host = ns["implement_app_host"]("sales-desk")
    host.update(merged=merged, owner=("N01-U05", "777"), settings=held, pages=[{"id": p, "use_case_id": p.upper()} for p in pages])
    return host


def _owners(ns, by, named=()):
    return ns["implement_owners"]({"created_by": by, "spec_json": {"outputs": {"app_owners": list(named)}}})


def test_a_use_case_joining_a_shared_app_records_its_own_owners_and_keeps_the_others(agent_ns):
    merge = agent_ns["implement_app_merge"]
    held = _held(agent_ns, [A], use_case_owners={A: [OWNER, DANA]})
    merged, pages, page = merge(_host(agent_ns, held, [A]), _joiner(agent_ns, [LEE]), {"id": "n02_u01", "use_case_id": "N02-U01"}, 9, {},
                                "", "", _owners(agent_ns, SAM, [LEE]))
    assert [p["id"] for p in pages] == [A, page["id"]]
    assert merged["use_case_owners"] == {A: [OWNER, DANA], page["id"]: [SAM, LEE]}
    assert not {"owners", "page_owners"} & set(merged), "the App keeps one record of who owns each use case"
    assert merged["admin"] == OWNER, "the App's admin stays the person who built it"
    assert not [p for p in shell_core.settings_problems(merged, [{"id": A}, {"id": page["id"]}]) if "owners" in p]
    left, kept = agent_ns["implement_app_take_out"](merged, pages, page["id"])
    assert [p["id"] for p in kept] == [A] and left["use_case_owners"] == {A: [OWNER, DANA]}, "a use case that leaves takes its owners out"


def test_the_asker_and_the_most_app_owners_a_spec_can_name_all_own_the_use_case_in_the_app_as_in_inspire(agent_ns, tmp_path):
    named = [f"owner{i}@example.com" for i in range(agent_ns["IMPLEMENT_APP_OWNERS_MAX"])]
    held = _held(agent_ns, [A], use_case_owners={A: [OWNER]})
    row = {"created_by": SAM, "spec_json": {"outputs": {"app_owners": named}}}
    merged, pages, page = agent_ns["implement_app_merge"](_host(agent_ns, held, [A]), _joiner(agent_ns, named),
                                                       {"id": "n02_u01", "use_case_id": "N02-U01"}, 9, {}, "", "", agent_ns["implement_owners"](row))
    assert merged["use_case_owners"][page["id"]] == [SAM] + named
    assert not [p for p in shell_core.settings_problems(merged, pages) if "owners" in p], "the App accepts every owner Inspire records"
    s, _sp, _now = ops_shell(tmp_path, JobsWorkspace(), settings=_hub_settings(pages=[A, B], use_case_owners={A: [OWNER], B: [SAM] + named}),
                             pages=_pages())
    assert s.page_editors(s.page(B)) == set(agent_ns["implement_owners"](row)), "the App and Inspire name the same owners"
    assert s.owner_refusal(signed(named[-1]), s.page(B), shell_core.SETTING_WORDS) == "", "the last App owner a spec can name keeps the right"
    assert s.owner_refusal(signed(named[-1]), s.page(A), shell_core.SETTING_WORDS) == REFUSED["settings"]
    assert shell_core.USE_CASE_OWNERS_MAX == agent_ns["IMPLEMENT_APP_OWNERS_MAX"] + 1


def test_a_shared_app_whose_settings_hold_no_record_names_no_owner_of_its_other_pages(agent_ns):
    held = _held(agent_ns, [A, "n03_u02_s4"])
    assert "use_case_owners" not in held
    merged, _pages, page = agent_ns["implement_app_merge"](_host(agent_ns, held, [A, "n03_u02_s4"]), _joiner(agent_ns),
                                                       {"id": "n02_u01", "use_case_id": "N02-U01"}, 9, {}, "", "", _owners(agent_ns, SAM))
    assert merged["use_case_owners"] == {page["id"]: [SAM]}, "nothing is made up for a page Inspire recorded no owners of"


def test_a_restyle_or_repoint_records_the_live_version_s_owners_for_its_own_page(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst._implement_app_own_page = lambda context, host: A
    inst._implement_alert_link = lambda context: ""
    inst._implement_builder = lambda: "inspire@example.com"
    held = _held(agent_ns, [A, B], use_case_owners={A: [OWNER], B: [SAM]})
    context = {"requested_by": DANA, "job_id": JOB, "spec": {"outputs": {"app_owners": [LEE, "dana@EXAMPLE.com"]}}}
    settings = inst._implement_app_kept_settings(context, _host(agent_ns, held, [A, B], merged=False), shell_core)
    assert settings["use_case_owners"] == {A: [DANA, LEE], B: [SAM]}
    unnamed = inst._implement_app_kept_settings(dict(context, requested_by=""), _host(agent_ns, copy.deepcopy(held), [A, B], merged=False),
                                                shell_core)
    assert unnamed["use_case_owners"] == {A: [LEE, DANA], B: [SAM]}, "the App records the owners as Inspire names them"
    nobody = inst._implement_app_kept_settings(dict(context, requested_by="", spec={"outputs": {}}),
                                               _host(agent_ns, copy.deepcopy(held), [A, B], merged=False), shell_core)
    assert nobody["use_case_owners"] == {B: [SAM]}


def test_refresh_needs_an_owner_of_the_use_case_and_never_the_person_who_built_the_app(tmp_path):
    s, sp, _now = _hub(tmp_path, admin="", auth="user")
    assert call(s, "POST", "refresh", headers=signed(SAM, "tok-s"), body={"page": B})[0] == 200
    assert sp.jobs_calls("run-now") == [("run-now", JOB, {"refresh_requested_by": SAM})]
