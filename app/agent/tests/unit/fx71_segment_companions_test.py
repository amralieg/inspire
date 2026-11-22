"""REQ-264, REQ-250: a use case's own result companions count as the use case's tables, and a page reads only companions the run wrote.

The App-fit check, the dashboard check and the alert check each asked a different list. The page check accepted every companion of
every kind (so a segment page read __segments although the run had not written it, and the App failed when it ran); the dashboard and
alert checks took the bare allowed list, so a companion the notebook writes beside the result table (assumptions, plans, ...) was
"outside this use case". One list now serves all three: implement_written_reads = the allowed tables (which hold the companions the
layout found written) plus the result's base companions. A companion of the kind contract that the run has not written is named as
unwritten, not as another use case's table.
"""
import json
import pathlib

RESULT = "inspire_kinds_rc7._inspire.segment_results"
OTHER_RESULT = "inspire_kinds_rc7._inspire.other_results"
SOURCE = "inspire_kinds_rc7._inspire.sales_customers"
NOTEBOOK = pathlib.Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"


class ShellSql:
    RECORDS_DATASET = "records"

    def spec_problems(self, page, stored):
        return []

    def decision_problems(self, page):
        return []

    def quality_problems(self, page, event_date, fanning):
        return []

    def driver_charts(self, page):
        return []


def _page(*reads):
    return {"id": "seg", "title": "Segments", "result_table": RESULT, "use_case_id": "UC-A",
            "datasets": [{"name": f"d{i}", "sql": f"SELECT * FROM {table}"} for i, table in enumerate(reads)], "kpis": [], "charts": []}


def _problems(ns, page, allowed):
    return ns["implement_app_page_problems"](page, ShellSql(), allowed, False, many=(), written_only=True)


def _outside(problems):
    return [p for p in problems if "outside this use case" in p]


def _unwritten(problems):
    return [p for p in problems if "not written" in p]


def test_page_reading_a_companion_the_run_has_not_written_is_named_unwritten(agent_ns):
    problems = _problems(agent_ns, _page(f"{RESULT}__segments"), [RESULT, SOURCE])
    assert _unwritten(problems) and f"{RESULT}__segments" in _unwritten(problems)[0], problems
    assert _outside(problems) == [], problems


def test_page_reading_a_written_companion_is_accepted(agent_ns):
    allowed = [RESULT, SOURCE, f"{RESULT}__segments", f"{RESULT}__assign"]
    problems = _problems(agent_ns, _page(f"{RESULT}__segments", f"{RESULT}__assign"), allowed)
    assert _outside(problems) == [] and _unwritten(problems) == [], problems


def test_page_reads_a_base_companion_the_notebook_writes_with_the_result(agent_ns):
    plans = agent_ns["inspire_plans_table"](RESULT)
    problems = _problems(agent_ns, _page(plans), [RESULT, SOURCE])
    assert _outside(problems) == [] and _unwritten(problems) == [], problems


def test_page_still_refuses_another_use_cases_companion_and_an_unrelated_table(agent_ns):
    """Must-keep: only this result's companions are the use case's."""
    for table in (f"{OTHER_RESULT}__segments", "inspire_kinds_rc7._inspire.sales_regions"):
        problems = _problems(agent_ns, _page(table), [RESULT, SOURCE, f"{RESULT}__segments"])
        assert _outside(problems) and table in _outside(problems)[0], (table, problems)
        assert _unwritten(problems) == [], problems


def test_alert_sql_may_read_a_base_companion_and_not_an_unwritten_one(agent_ns):
    reads = agent_ns["implement_written_reads"]([RESULT, SOURCE], RESULT)
    plans = agent_ns["inspire_plans_table"](RESULT)
    ok = f"SELECT COUNT(*) > 0 AS triggered FROM {plans}"
    assert agent_ns["check_alert_condition_sql"](ok, reads) == []
    bad = f"SELECT COUNT(*) > 0 AS triggered FROM {RESULT}__segments"
    assert [e for e in agent_ns["check_alert_condition_sql"](bad, reads) if "outside this use case" in e]


def test_written_reads_hold_this_results_base_companions_only(agent_ns):
    reads = {r.lower() for r in agent_ns["implement_written_reads"]([RESULT, SOURCE], RESULT)}
    assert agent_ns["inspire_plans_table"](RESULT).lower() in reads and SOURCE.lower() in reads
    assert f"{RESULT}__segments".lower() not in reads
    assert not [r for r in reads if r.startswith(OTHER_RESULT)]


def test_no_check_is_handed_the_bare_allowed_list():
    """Closing grep: the page, dashboard and alert checks all take implement_written_reads, never context["allowed"] itself."""
    source = "".join(json.loads(NOTEBOOK.read_text())["cells"][1]["source"])
    for call in ("check_dashboard_definition(", "check_alert_condition_sql(", "implement_app_page_problems("):
        sites = [i for i in range(len(source)) if source.startswith(call, i) and not source[max(0, i - 4):i] == "def "]
        assert sites, call
        for i in sites:
            window = source[i:i + 700]
            assert 'context["allowed"]' not in window.replace('implement_written_reads(context["allowed"]', ""), (call, window[:300])
