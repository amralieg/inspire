"""The job's cron and the notebook's baked schedule_cron come from one value: the schedule the user chose on the use case's spec. A
use case with no chosen schedule keeps the cadence the Genie decision implies, so the two can never disagree."""
import pytest

from _agentload import agent_source
from v120_genie_support import build_inspire, make_uc

DAILY = "0 0 6 * * ?"
QUARTERLY = "0 0 6 1 1,4,7,10 ?"


@pytest.mark.parametrize("schedule, cadence, expected", [
    ({"cron": DAILY}, QUARTERLY, DAILY),
    ({"cron": DAILY, "enabled": False}, QUARTERLY, ""),
    ({}, QUARTERLY, QUARTERLY),
    (None, QUARTERLY, QUARTERLY),
    ({"cron": ""}, "", ""),
])
def test_the_chosen_schedule_wins_and_the_cadence_is_the_fallback(agent_ns, schedule, cadence, expected):
    assert agent_ns["implement_schedule_cron"](schedule, cadence) == expected


def test_the_baked_schedule_cron_follows_the_chosen_schedule_not_the_decision_cadence(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc(**{"Analytics Technique": "Classification", "genie_instruction": "x", "genie_instruction_status": "success"})
    uc["_implement_schedule"] = {"cron": DAILY, "enabled": True}
    assert inst._genie_notebook_spec(uc)["schedule_cron"] == DAILY


def test_without_a_chosen_schedule_the_baked_value_is_the_decision_cadence(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc(**{"Analytics Technique": "Classification", "genie_instruction": "x", "genie_instruction_status": "success"})
    spec = inst._genie_notebook_spec(uc)
    cadence = inst._genie_cadence({key: text for key, _label, text in inst._genie_decision_contract(uc)}["cadence"])["cron"]
    assert spec["schedule_cron"] == (cadence or "")


def test_the_job_launch_paths_read_the_same_function_and_no_stale_fallback(agent_ns):
    src = agent_source()
    assert 'schedule_cron=implement_schedule_cron(spec["schedule"], spec_nb["schedule_cron"])' in src
    assert 'bool(implement_schedule_cron(spec["schedule"], spec_nb["schedule_cron"]))' in src
    assert 'spec["schedule"]["cron"] or spec_nb["schedule_cron"]' not in src
    assert '_implement_write_notebook' in src and 'use_case["_implement_schedule"] = dict(spec.get("schedule") or {})' in src


def test_a_wizard_weekly_schedule_reaches_the_baked_run_and_the_job_launch(agent_ns):
    from v130_genie_run_controls_test import _notebook, _text
    wizard = {"enabled": True, "cron": "0 0 6 ? * MON", "timezone": "UTC", "failure_emails": []}
    _inst, _uc, nb = _notebook(agent_ns, "Classification", _implement_schedule=wizard)
    assert "'schedule_cron': '0 0 6 ? * MON'" in _text(nb["cells"][-1]), "the baked run carries the wizard's cron"
    assert agent_ns["implement_schedule_cron"](wizard, "0 0 6 1 1,4,7,10 ?") == "0 0 6 ? * MON", "the job launch reads the same value"


def test_a_schedule_the_user_turned_off_bakes_no_cron_so_no_later_run_can_re_enable_it(agent_ns):
    from v130_genie_run_controls_test import _notebook, _text
    off = {"enabled": False, "cron": DAILY, "timezone": "UTC", "failure_emails": []}
    _inst, _uc, nb = _notebook(agent_ns, "Classification", _implement_schedule=off)
    assert "'schedule_cron': ''" in _text(nb["cells"][-1])
    assert agent_ns["implement_schedule_cron"](off, QUARTERLY) == ""
