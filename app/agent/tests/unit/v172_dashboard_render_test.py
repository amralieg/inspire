"""What the dashboard snapshot of a live use case showed, pinned offline: reasons that carry each record's numbers group by their
wording into a readable reasons bar, and a counter's target is its change text, empty until the result table holds a previous run,
so a first run never draws null and a later run shows its change with no rebuild."""
import os
import re
import sys

TESTS = os.path.dirname(os.path.abspath(__file__))
SERVER = os.path.join(os.path.dirname(os.path.dirname(TESTS)), "agent", "app_shell", "server")
for folder in (SERVER, TESTS):
    if folder not in sys.path:
        sys.path.insert(0, folder)

import shell_sql  # noqa: E402
from v142_dash_test import RESULT, _canvas, _palettes  # noqa: E402
from v171_dashboard_runs_test import _change, _check, _doc, _runs_page, _schema  # noqa: E402

REASONS = ["forecast 2.2 pickups, against 3 the same hour last week", "forecast 1.82 pickups, against 0 the same hour last week",
           "mean fare 10.7 USD per trip, against a mean of 11 for all zips", "95% interval 1.18 to 4.05 pickups",
           "mean fare 1,234.50 USD per trip, against a mean of 9 for all zips"]


def _key(text):
    return re.sub(shell_sql.REASON_NUMBERS, shell_sql.REASON_NUMBER_MARK, text.strip())


def test_reasons_that_carry_each_record_s_numbers_group_by_their_wording(agent_ns):
    keys = [_key(r) for r in REASONS]
    assert keys == ["forecast \u2026 pickups, against \u2026 the same hour last week",
                    "forecast \u2026 pickups, against \u2026 the same hour last week",
                    "mean fare \u2026 USD per trip, against a mean of \u2026 for all zips", "\u2026% interval \u2026 to \u2026 pickups",
                    "mean fare \u2026 USD per trip, against a mean of \u2026 for all zips"]
    assert len(set(keys)) == 3 < len(set(REASONS))
    assert _key("Fare above 42.5 for 1,200 trips") == "Fare above \u2026 for \u2026 trips"
    assert not [k for k in keys if "#" in k], "a person never reads a # in a reason"
    sql = shell_sql.reasons_sql("`main`.`inspire`.`churn_out`", "top_reasons", ["as_of_date"])
    assert f"{shell_sql.reason_wording('r.`reason`')} AS `reason`" in sql
    assert shell_sql.reason_wording("x") == f"regexp_replace(TRIM(CAST(x AS STRING)), '{shell_sql.REASON_NUMBERS}', '\u2026')"
    assert "'#'" not in sql
    assert "r.`reason` IS NOT NULL" in sql, "an empty reason is no bar"


def test_one_build_serves_a_first_run_and_every_later_run_without_null(agent_ns):
    doc = _doc(agent_ns, _schema(agent_ns))
    assert _check(agent_ns, doc) == []
    layout = _canvas(doc)[0]["layout"]
    shown = [item["widget"] for item in layout if (item["widget"].get("spec") or {}).get("widgetType") == "counter"]
    compared = [w for w in shown if set(w["spec"]["encodings"]) == {"value", "target"}]
    assert len(compared) == len([k for k in _runs_page(agent_ns)["kpis"] if k["compare"]]) and len(compared) < len(shown)
    assert f"{shell_sql.RECORDS_DATASET}_runs" in [d["name"] for d in doc["datasets"]]
    assert [p["name"] for p in _canvas(doc)] == ["overview", "trend", "run_health"]
    assert (_change(1, "COUNT(*)"), _change(2, "COUNT(*)")) == ("", f"\u25b2 50.0% {shell_sql.COMPARE_RUN}"), \
        "the same counter is blank on a first run and shows its change once a second run writes its rows"
    assert "implement_result_runs_sql" not in agent_ns, "the build never counts runs, so nothing needs a rebuild after the second run"
    assert "result_runs" not in agent_ns["implement_dashboard_from_page"].__code__.co_varnames
