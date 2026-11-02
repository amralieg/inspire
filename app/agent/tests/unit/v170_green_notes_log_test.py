"""Every fact Inspire turns into an info note is logged at INFO through one note path and never at WARNING, offline."""
import contextlib

from v120_artifacts_support import CapturingLogger, FakeSpark
from v140_implement_test import _inspire
from v143_vibes_test import _locked, _run

MOVED = "Dashboard: this use case is now part of the dashboard d9; the dashboard d1 keeps what Inspire built there before"


def _tiers(agent_ns, facts):
    inst = _inspire(agent_ns, FakeSpark())
    inst.logger = CapturingLogger()
    inst._implement_tier_counts = lambda table: {"Monitor": 4}
    inst._implement_run_facts = lambda uc_id, table, run_id=None: dict(facts)
    inst._implement_latest_run_profile = lambda table: None
    inst._implement_latest_run_methods = lambda table: None
    inst._implement_emit = lambda *a, **k: None
    return inst, inst._implement_tier_warning("N01-U01", "main.inspire.churn_out", "", "r-1")


def test_a_decision_list_with_nobody_to_act_on_is_never_logged_as_a_warning(agent_ns):
    inst, said = _tiers(agent_ns, {})
    assert said.startswith(agent_ns["IMPLEMENT_DECISION_LIST_LEAD"])
    assert said == agent_ns["implement_tier_mix_warning"]({"Monitor": 4})
    assert [r for r in inst.logger.records if r[0] == "WARNING"] == []


def test_a_run_marked_not_reliable_is_still_logged_as_a_warning(agent_ns):
    inst, said = _tiers(agent_ns, {"not_reliable": "AUC 0.55 is below 0.60."})
    assert said.startswith("Not reliable yet: ")
    assert inst.logger.matching("Not reliable yet: ", "WARNING")


def _version(agent_ns, tier="", fields=None):
    inst, previous = _locked(agent_ns)
    inst.logger = CapturingLogger()
    inst._implement_runner = lambda uc: "genie"
    inst._implement_tier_warning = lambda uc_id, table, url, run_id=None: tier
    inst._implement_dashboard = lambda context, runner: dict({"dashboard_id": "d9", "dashboard_url": "https://h/d"}, **(fields or {}))
    status = _run(inst, dict(previous, retry_outputs=["dashboard"]))
    return status, inst.logger


def test_the_decision_list_note_is_logged_at_info_through_the_note_path(agent_ns):
    mix = agent_ns["implement_tier_mix_warning"]({"Monitor": 4})
    status, logger = _version(agent_ns, tier=mix)
    told = mix.removeprefix(agent_ns["IMPLEMENT_DECISION_LIST_LEAD"])
    assert status == "ready"
    assert logger.matching(f"[IMPLEMENT-NOTE] N01-U01: Decision list: {told}", "INFO")
    assert not [r for r in logger.records if r[0] == "WARNING" and "nobody to act on" in r[1]]


def test_the_decision_list_fact_is_logged_once(agent_ns):
    mix = agent_ns["implement_tier_mix_warning"]({"Monitor": 4})
    told = mix.removeprefix(agent_ns["IMPLEMENT_DECISION_LIST_LEAD"])
    _status, logger = _version(agent_ns, tier=mix)
    assert [level for level, message in logger.records if told in message] == ["INFO"]


def test_an_app_made_again_is_logged_once_and_a_sync_warning_beside_it_once(agent_ns):
    fact = agent_ns["implement_app_remade_text"]("desk")
    _outcome, _emitted, logger = _remade(agent_ns, real_emit=True)
    assert [level for level, message in logger.records if fact in message] == ["INFO"]
    synced = "App: the Lakebase sync task could not be removed from the job: PERMISSION_DENIED"
    _outcome, _emitted, logger = _remade(agent_ns, synced=synced, real_emit=True)
    assert [level for level, message in logger.records if fact in message] == ["INFO"]
    assert [level for level, message in logger.records if "sync task could not be removed" in message] == ["WARNING"]


def test_a_note_a_part_returns_is_logged_at_info_and_a_warning_beside_it_at_warning(agent_ns):
    status, logger = _version(agent_ns, fields={"_notes": [MOVED]})
    assert status == "ready"
    assert logger.matching(f"[IMPLEMENT-NOTE] N01-U01: {MOVED}", "INFO")
    assert not [r for r in logger.records if r[0] == "WARNING" and "now part of the dashboard" in r[1]]


def test_an_older_app_version_kept_on_lakebase_is_logged_at_info(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    inst.logger = CapturingLogger()
    asset_status = {"app": {"state": "ready", "spec_version": 3}}
    before = {"app": {"id": "desk-v2", "url": "https://h/a", "title": "Desk", "version": 2, "backend": "lakebase"}}
    assert inst._implement_keep_side((5150, "N01-U01", 3), ["app"], before, {"app": "desk-v3"}, asset_status) == []
    assert inst.logger.matching("[IMPLEMENT-NOTE] N01-U01: App: the App of v2 keeps its Lakebase copy as it is now", "INFO")
    assert [r for r in inst.logger.records if r[0] == "WARNING"] == []


def _remade(agent_ns, synced="", real_emit=False):
    inst = _inspire(agent_ns, FakeSpark())
    inst.logger, emitted = CapturingLogger(), []
    inst._implement_asset_lock = lambda *a, **k: contextlib.nullcontext()
    inst._implement_api = lambda method, path, *a, **k: {"name": "desk", "create_time": "2026-10-02T00:00:00Z"}
    inst._implement_lakebase_owned = lambda status, left="": ["sync"]
    inst._implement_lakebase_sync_off = lambda job_id, owned, status: (synced, [])
    if not real_emit:
        inst._implement_emit = lambda uc_id, step, message, state, *a, **k: emitted.append((step, message, state))
    outcome = inst._implement_delete_output("app", "desk", (5150, "N01-U01", 3), job_id=77 if synced else None, clear=False,
                                            status={"state": "ready", "created": "2026-10-01T00:00:00Z"})
    return outcome, emitted, inst.logger


def test_an_app_made_again_by_someone_else_is_an_info_note_at_delete(agent_ns):
    fact = agent_ns["implement_app_remade_text"]("desk")
    outcome, emitted, logger = _remade(agent_ns)
    assert (outcome["state"], outcome["warnings"]) == ("released", [])
    assert emitted == [("App", f"App: {fact}, and Inspire left it as it is", "ended_success")]
    assert logger.matching(f"[IMPLEMENT-NOTE] N01-U01: App: {fact}", "INFO")
    assert not [r for r in logger.records if r[0] == "WARNING" and fact in r[1]]


def test_a_sync_warning_beside_the_app_made_again_is_the_warning_and_the_fact_stays_info(agent_ns):
    fact = agent_ns["implement_app_remade_text"]("desk")
    synced = "App: the Lakebase sync task could not be removed from the job: PERMISSION_DENIED"
    outcome, emitted, logger = _remade(agent_ns, synced=synced)
    assert outcome["warnings"] == [synced]
    assert emitted == [("App", synced, "ended_warning")]
    assert logger.matching(f"[IMPLEMENT-NOTE] N01-U01: App: {fact}", "INFO")
    assert not [r for r in logger.records if r[0] == "WARNING" and fact in r[1]]
