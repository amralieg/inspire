"""v2.1.8 second review fixes.

1. The lead check counted history from the first to the last period, so 8 weekly rows read as 7.0 weeks and 56 daily
   rows as 7.9: both were refused against a minimum of 8. History now counts both ends, using the series gap, and the
   group-comparison check counts its history the same way.
2. A leading-indicators use case with no date column is refused in plain words, and the build names the next step:
   add a date column or a key that joins to one.
3. A placeholder domain summary that Inspire writes with a grouped count (1,234 use cases) is recognised as a placeholder.
4. A redeploy keeps a problem the saved pages already had only when the number in it is not worse; when Inspire cannot
   tell which way is worse, any changed number is a new problem.
5. The saved pages of an App on Lakebase are checked on Lakebase, so a problem only Lakebase finds compares with the
   saved pages' own Lakebase problems.
"""
import json
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_artifacts_support import CapturingLogger, FakeSpark, make_inspire, make_uc  # noqa: E402
from v140_implement_test import _app_shell, _churn_page, _inspire, _output_context  # noqa: E402
from v200_kinds_signal_test import LEDGER, answer, deep_inspire, standard_inspire, uc  # noqa: E402

LEAD = {"time": "event_time", "measure": "units"}
IMPACT = {"group": "store", "time": "event_time"}


def lead_uc(uc_id, **extra):
    return uc(uc_id, "Correlation Analysis", "leading_indicators", **extra)


def lead_row(periods, gap, first, last):
    return {"periods": periods, "median_gap": gap, "first_period": first, "last_period": last, "lag1": 0.3, "lag7": 0.3}


@pytest.mark.parametrize("row,weeks,passed", [
    (lead_row(8, 7, "2024-01-01", "2024-02-19"), 8.0, True),
    (lead_row(56, 1, "2024-01-01", "2024-02-25"), 8.0, True),
    (lead_row(7, 7, "2024-01-01", "2024-02-12"), 7.0, False),
    (lead_row(7, 7, "2024-01-01", "2024-02-19"), 8.0, True),
    (lead_row(5, 1, "2024-01-01", "2024-02-03"), 4.9, False),
    (lead_row(1, None, "2024-01-01", "2024-01-01"), 0.1, False),
], ids=["8_weekly", "56_daily", "7_weekly_refused", "weekly_with_a_missing_week", "daily_with_a_month_gap_refused", "one_day"])
def test_the_lead_check_counts_both_ends_of_the_history_using_the_series_gap(agent_ns, row, weeks, passed):
    measures = agent_ns["deep_signal_measures"]("lead", row, {"roles": LEAD})
    assert measures["lead_weeks"] == weeks
    verdict, text = agent_ns["deep_signal_verdict"]("F", measures, {"measure": "units"}, check="lead")
    assert verdict is passed, text
    if not passed and row["periods"] > 1:
        assert text.startswith(f"History covers {weeks:.1f} weeks of") and "at least 8 are needed" in text


def test_discovery_keeps_a_lead_of_exactly_eight_weekly_rows(agent_ns):
    ucs = [lead_uc("N02-U01")]
    rows = {"AS median_gap": lead_row(8, 7, "2024-01-01", "2024-02-19")}
    inst, _agent, _spark = deep_inspire(agent_ns, [{"results": [answer("N02-U01", LEAD)]}], rows)
    kept, dropped = inst._check_data_signal(ucs, [])
    assert [u["No"] for u in kept] == ["N02-U01"] and dropped == []
    assert ucs[0]["data_signal"]["reason"].startswith("History covers 8.0 weeks of weekly totals")


@pytest.mark.parametrize("row,weeks,passed", [
    ({"span_days": 55, "span_gap": 1}, 8.0, True),
    ({"span_days": 49, "span_gap": 7}, 8.0, True),
    ({"span_days": 42, "span_gap": 7}, 7.0, False),
    ({"span_days": 55}, 8.0, True),
], ids=["56_days", "8_weeks", "7_weeks_refused", "no_gap_counts_one_day"])
def test_the_impact_check_counts_both_ends_of_the_compared_history(agent_ns, row, weeks, passed):
    full = dict({"n": 1000, "compared_groups": 2, "control_rows": 400, "periods": 56}, **row)
    measures = agent_ns["deep_signal_measures"]("impact", full, {"roles": IMPACT})
    assert measures["history_weeks"] == weeks
    assert agent_ns["deep_signal_verdict"]("I", measures, {"group": "store"}, check="impact")[0] is passed


def test_the_impact_query_reads_the_gap_of_the_group_with_the_shortest_history(agent_ns):
    impact, _ = agent_ns["DeepEvidence"].signal_sql("impact", "`t`", {"roles": IMPACT}, None, 25)
    assert "PARTITION BY g ORDER BY d" in impact and "percentile(gap, 0.5)" in impact
    assert "(SELECT gap FROM t ORDER BY span ASC, k DESC LIMIT 1) AS span_gap" in impact
    assert "(SELECT MIN(span) FROM t) AS span_days" in impact


NO_DATE = ("From the column types alone: none of its tables (main.s.ledger) has a date or timestamp column, or a key that joins "
           "to one, so there is no history to test whether a measure moves ahead of the outcome.")
NO_DATE_CHOICES = ("Your choices: add a date or timestamp column to main.s.ledger, or a key that joins it to a table that has one, "
                   "then rebuild, or build another use case the data supports.")


def no_date_inspire(agent_ns):
    no_date = {"time": "", "measure": "amount"}
    answers = [{"results": [answer("N02-U01", no_date, LEDGER)]}, {"results": [answer("N02-U01", no_date, LEDGER)]}]
    inst, _agent, spark = standard_inspire(agent_ns, answers, user_business_domains=[])
    return inst, spark


def test_a_leading_indicators_use_case_with_no_date_column_is_dropped_in_plain_words(agent_ns):
    inst, spark = no_date_inspire(agent_ns)
    ucs = [lead_uc("N02-U01", **{"Tables Involved": LEDGER})]
    kept, dropped = inst._check_data_signal(ucs, [])
    assert kept == [] and spark.statements == []
    assert ucs[0]["data_signal"]["status"] == "failed" and ucs[0]["data_signal"]["reason"] == NO_DATE
    assert dropped[0]["selection_drop_reason"] == f"the data shows no signal: {NO_DATE}"


def test_the_build_refuses_a_lead_with_no_date_column_and_names_the_next_step(agent_ns):
    inst, _spark = no_date_inspire(agent_ns)
    use_case = lead_uc("N02-U01", **{"Tables Involved": LEDGER})
    inst._check_data_signal([use_case], [])
    inst.updates = []
    inst._implement_update = lambda key, **fields: inst.updates.append(fields)
    inst._implement_emit = lambda *a, **k: None
    inst._implement_stop_repair = lambda *a, **k: pytest.fail("a missing date column is not sent to Genie")
    status = {}
    with pytest.raises(agent_ns["ImplementBlocked"]) as stopped:
        inst._implement_data_minimum((5150, "N02-U01", 3), {"config": {"widgets": {}}}, use_case, status)
    said = str(stopped.value)
    assert said == f"{agent_ns['IMPLEMENT_DATA_MINIMUM_LEAD']}: {NO_DATE} {NO_DATE_CHOICES}"
    assert "the minimum above" not in said
    assert status["data"]["state"] == "failed" and status["data"]["data_minimum"] == NO_DATE


def test_the_data_minimum_choices_name_the_tables_only_for_a_missing_date(agent_ns):
    choices = agent_ns["implement_data_minimum_choices"]
    assert choices({}, "F", ["main.s.ledger", "main.s.branches"]) == (
        "Your choices: add a date or timestamp column to main.s.ledger or main.s.branches, or a key that joins them to a table "
        "that has one, then rebuild, or build another use case the data supports.")
    assert choices({}, "F") == "Your choices: Rebuild once the data has the minimum above, or build another use case the data supports."


def test_a_placeholder_summary_with_a_grouped_count_never_reaches_a_domain_page(agent_ns):
    obj = make_inspire(agent_ns)
    payload = obj._catalog_json_payload({"Sales": [make_uc(f"N01-U{i:04d}") for i in range(1, 1235)]}, {}, "", "Acme Use Cases Catalog")
    written = payload["domains"][0]["summary"]
    assert written == "Domain: Sales with 1,234 use cases"
    obj.logger = CapturingLogger()
    assert obj._domain_summary_paragraphs({"Sales": written}, "Sales") == []
    assert obj._domain_summary_paragraphs({"Sales": "Domain: Sales with 12 use cases."}, "Sales") == []
    assert not [m for _level, m in obj.logger.records if "count-dropped" in m], "a placeholder is not reported as a count sentence"
    real = "Sales drives most of the revenue through repeat orders."
    assert obj._domain_summary_paragraphs({"Sales": real}, "Sales") == [real], "a real summary is kept"
    mixed = f"{real} It holds 1,234 use cases."
    assert obj._domain_summary_paragraphs({"Sales": mixed}, "Sales") == [real]
    assert [m for _level, m in obj.logger.records if "count-dropped" in m], "a real count sentence is still dropped and reported"


def test_every_count_pattern_inspire_reads_back_accepts_a_grouped_count(agent_ns):
    pattern = agent_ns["DatabricksInspire"]._DOC_SUMMARY_PLACEHOLDERS[1]
    assert pattern.search("Domain: Sales with 1,234,567 use cases")
    assert not pattern.search("Domain: Sales with many use cases")
    assert not pattern.search("Domain: Sales with 1,234 use cases, led by churn")


SLOW_OLD = "page n01_u01: the decision list took 45 s at the default filters; read fewer rows: filter on the result table's clustered columns"
ROWS_OLD = ("page n01_u01: the list section of a decision page shows at least 10 rows; the decision list returned 6 at the default "
            "filters, so widen what it selects")
SEGMENTS_OLD = "page n01_u01: 2 segment filters offer 2 or more values; region (North) offer one, so they slice nothing"
FAILS_OLD = "page n01_u01: 3 failed checks on the Impact page"
GAP_OLD = "page n01_u01: the KPI and the list differ by a gap of 1,200 rows at the default filters"
CHART_OLD = "page n01_u01: chart c1 groups 40 rows into 38 bars by region at the default filters, so nearly every bar is one record"


@pytest.mark.parametrize("old,new,kept", [
    (SLOW_OLD, SLOW_OLD, True),
    (SLOW_OLD, SLOW_OLD.replace("45 s", "32 s"), True),
    (SLOW_OLD, SLOW_OLD.replace("45 s", "61 s"), False),
    (ROWS_OLD, ROWS_OLD.replace("returned 6", "returned 8"), True),
    (ROWS_OLD, ROWS_OLD.replace("returned 6", "returned 2"), False),
    (SEGMENTS_OLD, SEGMENTS_OLD.replace("2 segment", "1 segment"), False),
    (FAILS_OLD, FAILS_OLD.replace("3 failed", "2 failed"), True),
    (FAILS_OLD, FAILS_OLD.replace("3 failed", "5 failed"), False),
    (GAP_OLD, GAP_OLD.replace("1,200", "900"), True),
    (GAP_OLD, GAP_OLD.replace("1,200", "1,500"), False),
    (CHART_OLD, CHART_OLD.replace("38 bars", "39 bars"), False),
    (CHART_OLD, CHART_OLD.replace("38 bars", "37 bars"), False),
    (SLOW_OLD, ROWS_OLD, False),
], ids=["same", "faster", "slower", "more_rows", "fewer_rows", "fewer_slicing_filters", "fewer_failures", "more_failures",
        "smaller_gap", "larger_gap", "unknown_direction_up", "unknown_direction_down", "another_problem"])
def test_a_problem_is_kept_only_when_its_numbers_are_not_worse(agent_ns, old, new, kept):
    assert agent_ns["implement_problem_kept"](new, [old]) is kept


def test_a_problem_matches_any_saved_problem_of_its_shape_that_it_does_not_worsen(agent_ns):
    kept = agent_ns["implement_problem_kept"]
    slower = SLOW_OLD.replace("45 s", "50 s")
    assert kept(slower, [SLOW_OLD.replace("45 s", "30 s"), SLOW_OLD.replace("45 s", "55 s")]) is True
    assert kept(slower, [SLOW_OLD.replace("45 s", "30 s")]) is False
    assert kept(slower, []) is False


PAGE_PROBLEM = "page n01_u01: the decision list repeats keys: 30 rows carry 29 distinct keys, so the page cannot tell its rows apart"
LAKEBASE_BACKEND = {"kind": "lakebase", "pipeline_id": "p1", "tables": {}, "datasets": {}}


def _lakebase_redeploy(agent_ns, tmp_path, held_design, own_backend):
    payload, modules = _app_shell(agent_ns, tmp_path)
    core = modules["shell_core"]
    inst = _inspire(agent_ns, FakeSpark())
    inst.logger = CapturingLogger()
    inst.local_log_output_dir = str(tmp_path)
    checks, deployed = [], []

    def check(work, files, modules, warehouse, lakebase_env=None):
        settings = json.loads(files[core.SETTINGS_FILE])
        checks.append((settings.get("accent"), (settings.get("backend") or {}).get("kind"), lakebase_env))
        if lakebase_env and settings.get("accent") == "old":
            inst._implement_app_design = list(held_design)
        return []

    inst._implement_app_check = check
    inst._implement_app_warehouse = lambda context: "wh-new"
    inst._implement_app_lakebase = lambda *a, **k: {"kind": "lakebase", "env": {"PGHOST": "lakebase.example"}, "files": {},
                                                     "page_problems": [PAGE_PROBLEM]}
    inst._implement_deploy_app = lambda *a, **k: deployed.append(a) or {"app_name": "churn-desk"}
    inst._implement_lakebase_after = lambda context, fields, lakebase: None
    page = agent_ns["implement_app_page"](_churn_page(agent_ns), "N01-U01", {}, "main.inspire.churn_out")
    base = {"version": core.SETTINGS_VERSION, "pages": [page["id"]]}
    host = {"name": "churn-desk", "settings": dict(base, accent="old", backend=own_backend), "pages": [page],
            "app": {"resources": [{"name": "sql-warehouse", "sql_warehouse": {"id": "wh-old", "permission": "CAN_USE"}}]}}
    out = inst._implement_app_redeploy(_output_context(agent_ns), host, dict(base, accent="new", backend=own_backend), [page], payload,
                                       modules, "app_restyle", "")
    return inst, out, checks, deployed


def test_the_saved_pages_of_an_app_on_lakebase_are_checked_on_lakebase(agent_ns, tmp_path):
    inst, (fields, problems, _lakebase), checks, deployed = _lakebase_redeploy(agent_ns, tmp_path, [PAGE_PROBLEM], LAKEBASE_BACKEND)
    assert problems == [] and len(deployed) == 1, "the saved pages had the same Lakebase problem, so the redeploy keeps it"
    assert [c for c in checks if c[0] == "old"] == [("old", "lakebase", {"PGHOST": "lakebase.example"})]
    assert any(PAGE_PROBLEM in w for w in fields["_warnings"])
    assert inst._implement_app_design is None, "the saved pages' check leaves the redeploy's own results as they were"


def test_a_lakebase_problem_the_saved_pages_did_not_have_still_sends_the_pages_back(agent_ns, tmp_path):
    _inst, (fields, problems, _lakebase), checks, deployed = _lakebase_redeploy(agent_ns, tmp_path, [], LAKEBASE_BACKEND)
    assert (fields, problems) == (None, [PAGE_PROBLEM]) and deployed == []
    worse = PAGE_PROBLEM.replace("29 distinct", "28 distinct")
    _inst, (fields, problems, _lakebase), _checks, deployed = _lakebase_redeploy(agent_ns, tmp_path / "worse", [worse], LAKEBASE_BACKEND)
    assert problems == [PAGE_PROBLEM] and deployed == [], "a changed number of unknown direction is a new problem"


def test_an_app_on_delta_keeps_comparing_its_saved_pages_on_delta(agent_ns, tmp_path):
    _inst, (fields, problems, _lakebase), checks, deployed = _lakebase_redeploy(agent_ns, tmp_path, [PAGE_PROBLEM], {"kind": "delta"})
    assert [c for c in checks if c[0] == "old"] == [("old", "delta", None)]
    assert problems == [PAGE_PROBLEM] and deployed == [], "the saved pages never ran on Lakebase, so a Lakebase problem is new"
