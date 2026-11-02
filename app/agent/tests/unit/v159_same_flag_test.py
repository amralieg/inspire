import re

import pytest

from v120_artifacts_support import FakeSpark
from v130_genie_value_test import meaning, spec_and_mandate
from v140_implement_test import VALID, _FakeRunner, _fill, _flow_inspire
from v149_ai_output_checks_test import _preview

POOLED = "sparse history, forecast from pooled zips"
SHARED_SQL = re.compile(r"^SELECT COUNT\(\*\) AS n, COUNT\(DISTINCT coalesce\(data_quality_flag, ''\)\) AS kinds, "
                        r"MIN\(coalesce\(data_quality_flag, ''\)\) AS flag, COUNT_IF\(value IS NULL\) AS valueless "
                        r"FROM `main`\.`inspire`\.`churn_out` WHERE use_case_id = 'N01-U01' AND run_id = '([^']+)'$")


def _shared_preview(ns, previews, found, refill=True, rounds=3, fail=False):
    inst = _flow_inspire(ns, previews)
    asked = []

    def respond(statement):
        match = SHARED_SQL.match(statement)
        if not match:
            return []
        asked.append(match.group(1))
        if fail:
            raise RuntimeError("TABLE_OR_VIEW_NOT_FOUND")
        return [found[match.group(1)]] if match.group(1) in found else []

    inst.spark = FakeSpark(responder=respond)
    runner = _FakeRunner([{"exit": 0, "final": _fill()} for _ in range(rounds)])
    spec = ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _fill_out = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {"result_table": "main.inspire.churn_out"},
                                                                spec, None, "/W/nb", ["result_table", "run_profile"], runner, refill)
    return outcome, runner, inst, asked


def test_a_preview_whose_every_row_carries_one_flag_and_a_value_goes_back_to_genie_to_state_it_once(agent_ns):
    shared = {"n": 21504, "kinds": 1, "flag": POOLED, "valueless": 0}
    outcome, runner, inst, asked = _shared_preview(agent_ns, [_preview("r-1"), _preview("r-2")], {"r-1": shared})
    assert outcome == {"status": "written", "rows_written": 40, "run_id": "r-2"} and len(runner.prompts) == 2 and asked == ["r-1", "r-2"]
    sent = runner.prompts[1]
    assert ("all 21504 rows of run r-1 carry the same data_quality_flag other than 'ok', and a value, so the flag tells no row apart "
            "and holds every row at 'Monitor'") in sent
    assert POOLED not in sent, "the flag the rows hold never leaves the agent"
    assert ("state it once in the summary step and set data_quality_flag to 'ok' on each row, keeping a reason only on a row whose "
            "own inputs fall short where other rows' do not") in sent
    assert "a row the method gives no result of its own, such as a unit below the test's minimum, has a NULL value and keeps its flag" in sent
    assert "Keep the decision test and its thresholds as they are." in sent, "Genie never loosens the test to clear the flag"
    assert "The user's Implementation Choices still win over this." in sent
    assert any(e.get("message") == "the preview run gave all 21504 rows the same data_quality_flag, which tells no row apart, "
               "sent back to Genie to state it once for the run" for e in inst.emitted)
    assert not any(POOLED in str(e) for e in inst.emitted), "the flag the rows hold never reaches an event"


@pytest.mark.parametrize("found,why", [
    ({"n": 10, "kinds": 1, "flag": "test flags every series", "valueless": 0},
     "the significance rule sets this flag on every row when the test flags every series"),
    ({"n": 21504, "kinds": 1, "flag": "data ends 2016-02-29", "valueless": 0},
     "a failed staleness check sets this flag on every row by design"),
    ({"n": 40, "kinds": 1, "flag": "too few tickets", "valueless": 40},
     "units below the test's minimum have no value of their own, so their flag is honest"),
    ({"n": 40, "kinds": 1, "flag": "too few tickets", "valueless": 1},
     "a row without a value of its own makes the shared flag a fact about that row"),
    ({"n": 40, "kinds": 2, "flag": "missing covariate", "valueless": 0}, "two flags tell rows apart"),
    ({"n": 40, "kinds": 1, "flag": "ok", "valueless": 0}, "every row 'ok' is the healthy case"),
    ({"n": 1, "kinds": 1, "flag": POOLED, "valueless": 0}, "one row cannot be told apart from others"),
    ({"n": 40, "kinds": 1, "flag": "", "valueless": 0}, "an empty flag is the NULL flag rule's to report"),
    (None, "a run with no rows in the table has nothing to check"),
], ids=["significance", "staleness", "too_few_all_null", "too_few_one_null", "two_flags", "all_ok", "one_row", "empty", "no_rows"])
def test_a_shared_flag_the_rules_allow_is_never_sent_back(agent_ns, found, why):
    outcome, runner, _inst, asked = _shared_preview(agent_ns, [_preview("r-1")], {"r-1": found} if found else {})
    assert outcome["run_id"] == "r-1" and len(runner.prompts) == 1 and asked == ["r-1"], why


def test_the_shared_flag_check_runs_only_while_genie_has_a_round_left_and_a_failed_read_never_breaks_the_build(agent_ns):
    shared = {"n": 40, "kinds": 1, "flag": POOLED, "valueless": 0}
    last, runner, _inst, asked = _shared_preview(agent_ns, [_preview("r-1"), _preview("r-2"), _preview("r-3")],
                                                 {run: shared for run in ("r-1", "r-2", "r-3")})
    assert last["run_id"] == "r-3" and len(runner.prompts) == 3 and asked == ["r-1", "r-2", "r-3"], \
        "the last round still ships its run, with the shared flag as a defect Genie could not fix"
    assert last["gate_rounds"] == 3 and last["gate_problems"] == [
        "all 40 rows of run r-3 carry the same data_quality_flag other than 'ok', and a value, so the flag tells no row apart and holds "
        "every row at 'Monitor'"]
    plain, runner, _inst, asked = _shared_preview(agent_ns, [_preview("r-1")], {"r-1": shared}, refill=False, rounds=0)
    assert plain["run_id"] == "r-1" and runner.prompts == [] and asked == ["r-1"] and plain["gate_rounds"] == 0, \
        "a refresh without a Genie build is never refused, only warned to build again"
    nameless, runner, _inst, asked = _shared_preview(agent_ns, [({"status": "written", "rows_written": 40}, 11, 100)], {})
    assert len(runner.prompts) == 1 and asked == [], "a run that returned no run_id is never looked up"
    broken, runner, inst, asked = _shared_preview(agent_ns, [_preview("r-1")], {}, fail=True)
    assert broken["run_id"] == "r-1" and len(runner.prompts) == 1 and asked == ["r-1"]
    assert any(level == "WARNING" and "[IMPLEMENT-SHARED-FLAG] N01-U01: could not read the data_quality_flag of run r-1" in message
               for level, message in inst.logger.records)


def test_every_flag_the_rules_set_on_every_row_is_one_the_check_allows(agent_ns):
    allowed = agent_ns["INSPIRE_RUN_WIDE_FLAGS"]
    for key, flag in agent_ns["INSPIRE_FLAG_ONLY_READINESS"].items():
        assert flag.split("<")[0] in allowed, key
    assert all(f"'{flag}'" in agent_ns["GENIE_SIGNIFICANCE_RULE"] for flag in allowed if not flag.endswith(" ")), \
        "the significance rule's run-wide flag is one the check allows"


def test_the_notebook_mandate_says_a_flag_on_every_row_with_a_value_says_nothing(agent_ns):
    _, _, mandate = spec_and_mandate(agent_ns, **{"Analytics Technique": "Time Series Forecasting"})
    flag = meaning(mandate, "data_quality_flag")
    assert ("never one flag on every row of a run whose rows all have a value, such as 'sparse history' on every row a pooled "
            "forecast scores, which tells no row apart and holds every row at 'Monitor', so the summary step states it once and the "
            "rows keep 'ok'") in flag
    assert "which the summary step states once" in flag, "the round 38 rule stays"
