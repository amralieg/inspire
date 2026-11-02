"""v1.3.0 Route 1 scope: a Generate run regenerates only the flagged use cases of its own session, or of its own
business when the caller gave no session; flagged rows of other sessions and businesses are never read. A Generate
run that finds nothing to regenerate, or cannot read where it looks, fails and names why instead of reporting SUCCESS."""
import os
import sys
import types
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_genie_support import build_inspire

FLAGGED = [{"session_id": 1001, "id": "N03-U06"}, {"session_id": 2002, "id": "N01-U04"}, {"session_id": 3003, "id": "N02-U01"}]
BUSINESS_OF = {1001: "Acme", 2002: "Acme", 3003: "Other Corp"}


class ScopedSpark:
    def __init__(self):
        self.calls = []

    def sql(self, statement, args=None):
        self.calls.append((statement, dict(args or {})))
        rows = list(FLAGGED)
        if "session_id = :sid" in statement:
            rows = [r for r in rows if r["session_id"] == args["sid"]]
        elif "business_name = :biz" in statement:
            rows = [r for r in rows if BUSINESS_OF[r["session_id"]] == args["biz"]]
        return types.SimpleNamespace(collect=lambda: rows)


def scoped(agent_ns, **attrs):
    inst = build_inspire(agent_ns, **attrs)
    inst.logger = MagicMock()
    inst.spark = ScopedSpark()
    inst._tracking_table_name = "`main`.`inspire`.`__inspire_usecases`"
    return inst


def test_a_run_with_a_session_regenerates_only_that_session(agent_ns):
    inst = scoped(agent_ns, session_id=1001, _user_provided_session_id=True)
    rows = inst._fetch_flagged_use_cases_route1()
    assert [r["id"] for r in rows] == ["N03-U06"], "flagged rows of other sessions are never regenerated"
    statement, args = inst.spark.calls[0]
    assert "session_id = :sid" in statement and args == {"sid": 1001} and "1001" not in statement
    assert "[ROUTE1-SCOPE] 1 flagged use case in session 1001" in " ".join(str(c) for c in inst.logger.info.call_args_list)


def test_a_run_without_a_session_stays_inside_its_business(agent_ns):
    inst = scoped(agent_ns, session_id=9999, _user_provided_session_id=False, business_name="Acme")
    rows = inst._fetch_flagged_use_cases_route1()
    assert sorted(r["id"] for r in rows) == ["N01-U04", "N03-U06"]
    assert "N02-U01" not in [r["id"] for r in rows], "another business's flagged rows are never read"
    statement, args = inst.spark.calls[0]
    assert "`main`.`inspire`.`__inspire_session`" in statement and args == {"biz": "Acme"} and "Acme" not in statement


def test_a_failed_scan_returns_nothing(agent_ns):
    inst = scoped(agent_ns, session_id=1001, _user_provided_session_id=True)

    def boom(statement, args=None):
        raise RuntimeError("warehouse down")

    inst.spark.sql = boom
    assert inst._fetch_flagged_use_cases_route1() == []
    assert "Route 1 DB scan failed" in " ".join(str(c) for c in inst.logger.error.call_args_list)
    assert [f["step"] for f in inst.failed_steps] == ["Route 1 scan"] and "warehouse down" in inst.failed_steps[0]["error"]
    assert any("Route 1 scan" in w for w in inst._run_outcome_warnings()), "a failed scan never ends the run as a clean success"


def generate_run(agent_ns, marked=(), route2_rows=(), tracking=True, **attrs):
    inst = scoped(agent_ns, operation="Generate Use Cases", session_id=1001, _user_provided_session_id=True, **attrs)
    if not tracking:
        inst._tracking_table_name = None
    inst._phaseE0_catalog_drift_check = lambda sid: []
    inst._scan_notebooks_for_generation_flag = lambda: list(marked)
    inst.regenerated, inst.merged = [], []
    inst._regenerate_genie_for_flagged_rows = lambda rows, label: inst.regenerated.extend(rows) or list(rows)
    inst._merge_regenerated_ucs_into_tracking = lambda regen: inst.merged.extend(regen)
    if route2_rows:
        inst._fetch_flagged_use_cases_route2 = lambda: (setattr(inst, "_route2_marked_count", len(marked)), list(route2_rows))[1]
    return inst


def test_a_generate_run_with_nothing_flagged_fails_and_says_why(agent_ns):
    inst = generate_run(agent_ns)
    inst.spark.sql = lambda statement, args=None: types.SimpleNamespace(collect=lambda: [])
    with pytest.raises(RuntimeError) as err:
        inst._run_generate_mode()
    message = str(err.value)
    assert message.startswith("Genie regeneration found nothing to regenerate: ")
    assert "no use case in session 1001 is flagged generate_genie_code_instruction = 'Yes'" in message
    assert "no notebook under /Workspace/out/notebooks is marked generate_genie_code_instruction = True" in message
    assert "run again" in message and inst.regenerated == [], "a run that regenerated nothing never reports success"


def test_a_failed_scan_with_nothing_marked_fails_with_the_scan_error(agent_ns):
    inst = generate_run(agent_ns)

    def boom(statement, args=None):
        raise RuntimeError("PERMISSION_DENIED on __inspire_usecases")

    inst.spark.sql = boom
    with pytest.raises(RuntimeError) as err:
        inst._run_generate_mode()
    message = str(err.value)
    assert "the Route 1 scan of `main`.`inspire`.`__inspire_usecases` failed (PERMISSION_DENIED on __inspire_usecases)" in message
    assert "is flagged" not in message, "a failed scan is never reported as nothing flagged"


def test_marked_notebooks_without_a_database_fail_with_the_reason(agent_ns):
    marked = [{"use_case_id": "N01-U01", "session_id": 1001}, {"use_case_id": "N01-U02", "session_id": 1001}]
    inst = generate_run(agent_ns, marked=marked, tracking=False)
    with pytest.raises(RuntimeError) as err:
        inst._run_generate_mode()
    message = str(err.value)
    assert "an Inspire database is needed to load the use cases of the 2 marked notebooks under /Workspace/out/notebooks" in message
    assert "is flagged" not in message and "no notebook under" not in message


def test_marked_notebooks_that_match_no_use_case_fail_with_the_reason(agent_ns):
    inst = generate_run(agent_ns, marked=[{"use_case_id": "N09-U09", "session_id": 1001}])
    inst.spark.sql = lambda statement, args=None: types.SimpleNamespace(collect=lambda: [])
    with pytest.raises(RuntimeError) as err:
        inst._run_generate_mode()
    assert "no use case in `main`.`inspire`.`__inspire_usecases` matches the 1 marked notebook under /Workspace/out/notebooks" in str(err.value)


def test_marked_notebooks_still_regenerate_when_nothing_is_flagged(agent_ns):
    rows = [{"session_id": 1001, "id": "N01-U01"}]
    inst = generate_run(agent_ns, marked=[{"use_case_id": "N01-U01", "session_id": 1001}], route2_rows=rows)
    inst.spark.sql = lambda statement, args=None: types.SimpleNamespace(collect=lambda: [])
    inst._run_generate_mode()
    assert inst.regenerated == rows and inst.merged == rows
    assert not getattr(inst, "failed_steps", [])


def test_an_unreadable_notebook_folder_is_named_in_the_failure(agent_ns):
    inst = generate_run(agent_ns)
    del inst._scan_notebooks_for_generation_flag
    inst.spark.sql = lambda statement, args=None: types.SimpleNamespace(collect=lambda: [])

    def denied(path):
        raise PermissionError(f"PERMISSION_DENIED: cannot list {path}")

    inst.w_client.workspace.list = denied
    with pytest.raises(RuntimeError) as err:
        inst._run_generate_mode()
    message = str(err.value)
    assert ("the notebook scan could not read 1 item (first: list /Workspace/out/notebooks: PERMISSION_DENIED: cannot list "
            "/Workspace/out/notebooks)") in message
    assert [f["step"] for f in inst.failed_steps] == ["Route 2 scan"]


def test_a_failed_lookup_is_named_in_the_failure(agent_ns):
    inst = generate_run(agent_ns, marked=[{"use_case_id": "N01-U01", "session_id": 1001}])

    def sql(statement, args=None):
        if "generate_genie_code_instruction" in statement:
            return types.SimpleNamespace(collect=lambda: [])
        raise RuntimeError("TABLE_OR_VIEW_NOT_FOUND")

    inst.spark.sql = sql
    with pytest.raises(RuntimeError) as err:
        inst._run_generate_mode()
    message = str(err.value)
    assert "matches the 1 marked notebook under /Workspace/out/notebooks" in message
    assert "could not read 1 item (first: lookup N01-U01 in session 1001: TABLE_OR_VIEW_NOT_FOUND)" in message


def test_marked_notebooks_regenerate_and_warn_when_a_notebook_could_not_be_read(agent_ns):
    rows = [{"session_id": 1001, "id": "N01-U01"}]
    inst = generate_run(agent_ns)
    inst.spark.sql = lambda statement, args=None: types.SimpleNamespace(collect=lambda: [])
    inst._fetch_flagged_use_cases_route2 = lambda: (setattr(inst, "_route2_errors", ["export /Workspace/out/notebooks/a: boom"]), rows)[1]
    inst._run_generate_mode()
    assert inst.regenerated == rows
    assert any("Route 2 scan" in w for w in inst._run_outcome_warnings())


def test_a_failed_scan_with_marked_notebooks_regenerates_them_and_warns(agent_ns):
    rows = [{"session_id": 1001, "id": "N01-U01"}]
    inst = generate_run(agent_ns, marked=[{"use_case_id": "N01-U01", "session_id": 1001}], route2_rows=rows)

    def boom(statement, args=None):
        raise RuntimeError("warehouse down")

    inst.spark.sql = boom
    inst._run_generate_mode()
    assert inst.regenerated == rows
    assert any("Route 1 scan" in w for w in inst._run_outcome_warnings())
