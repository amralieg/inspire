"""A tagged scheduled run carries the Inspire session of the run that made it: its stored job parameters name the session, and the
child run names that session in its output, so its log lines and its outcome can be traced to that session."""
from v130_genie_run_controls_test import _controls, _dbutils, _launcher
from v140_implement_test import _spec


def test_the_tagged_job_stores_and_launches_with_the_session_of_the_run_that_made_it(agent_ns):
    ns, _call = _controls(agent_ns)
    session = ns["INSPIRE_RUN"]["job_tags"]["dbx_inspire_ai_session_id"]
    assert session and ns["INSPIRE_RUN"]["session_id"] == session
    launcher, calls = _launcher(ns)
    dbu = _dbutils(result_table="main.inspire.n01_u01_churn_out")
    dbu.notebook.exit = dbu.notebook.exits.append
    ns["inspire_run_controls"](ns["INSPIRE_RUN"], dbu=dbu, launcher_cls=launcher, out=lambda *_a: None)
    assert calls["launch"]["run_parameters"]["14_session_id"] == session, calls["launch"]["run_parameters"]
    assert calls["launch"]["base"]["14_session_id"] == session, "the scheduled child runs with the stored parameters, so the session must be stored"


def test_the_child_run_names_its_session_in_the_output_it_writes(agent_ns):
    ns, _call = _controls(agent_ns)
    session = ns["INSPIRE_RUN"]["job_tags"]["dbx_inspire_ai_session_id"]
    dbu = _dbutils(**{agent_ns["INSPIRE_CHILD_MARKER"]: "1", "14_session_id": session})
    out = []
    result = ns["inspire_run_controls"](ns["INSPIRE_RUN"], dbu=dbu, launcher_cls=None, out=out.append)
    assert result == {"execution": "child"}
    assert any(f"Inspire session {session}" in line for line in out), out


def test_the_implement_job_parameters_carry_the_session_that_owns_the_spec_on_both_profiles(agent_ns):
    spec = _spec(agent_ns)[0]
    for profile in ("full", "preview"):
        params = agent_ns["implement_job_parameters"](["result_table"], spec, profile, "5150")
        assert params["14_session_id"] == "5150" and params["run_profile"] == profile
    assert "14_session_id" not in agent_ns["implement_job_parameters"](["result_table"], spec, "full")
