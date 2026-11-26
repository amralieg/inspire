"""c24_dashshape: one chart of the Dashboard that cannot be drawn never fails the whole Dashboard (same class as c24_rc7mvp item 2).

The Dashboard's own chart loop in `deploy` ran every chart query again after the page check and raised on the first bad one. Now Genie
repairs the page once; after that the chart is left out with the plain warning of the App, the rest publishes, and the App reuses the
page without it. If no chart is left, the Dashboard fails with one plain sentence."""
import datetime
import json
import os
import sys

import pytest

pytest.importorskip("sqlglot")

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

from v140_implement_test import _churn_page  # noqa: E402
from v142_dash_test import _doc, _flow, _published, _runner, _shell  # noqa: E402

PLAIN_BANS = ("Genie round", "chart:", "rounds", "RuntimeError")
MISSING = ("[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column, variable, or function parameter with name `value_at_stake` cannot be resolved. "
           "Did you mean one of the following? [`loss`]")


def _chart_sql(ns, tmp_path, chart_id):
    return _shell(ns, tmp_path).chart_query(_churn_page(ns), chart_id, {})[0]


def _break_charts(inst, sqls, error=None, rows=None):
    """The chart queries in `sqls` fail with `error`, or return `rows`; every other query runs as before."""
    inner = inst._implement_run_query_check

    def query(sql, require_rows=False, limit=20):
        if sql in sqls:
            if rows is not None:
                return rows
            raise RuntimeError(error)
        return inner(sql, require_rows=require_rows, limit=limit)

    inst._implement_run_query_check = query


def _title(ns, chart_id):
    return next(c["title"] for c in _churn_page(ns)["charts"] if c["id"] == chart_id)


def test_one_chart_whose_query_fails_is_left_out_with_a_plain_warning_and_the_rest_publishes(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    _break_charts(inst, {_chart_sql(agent_ns, tmp_path, "channel_mix")}, MISSING)
    runner = _runner(*[_churn_page(agent_ns)] * 3)
    fields = inst._implement_dashboard(context, runner)
    assert fields["dashboard_id"] == "d9", "one bad chart never fails the Dashboard"
    assert len(runner.prompts) == 2, "Genie repairs the page once, then the chart is left out"
    shown = json.dumps(_doc(seen))
    gone, kept = _title(agent_ns, "channel_mix"), [_title(agent_ns, c) for c in ("loss_trend", "by_category", "pareto")]
    assert json.dumps(gone) not in shown, "the chart that cannot run is not on the published Dashboard"
    assert all(json.dumps(t) in shown for t in kept), "every other chart stays"
    assert [c["id"] for c in context["page_spec"]["charts"]] == ["loss_trend", "by_category", "pareto"], \
        "the App reuses the page without the chart"
    told = " | ".join(fields.get("_warnings") or [])
    assert gone in told and "left out" in told and "value_at_stake" in told, told
    assert not any(ban in told for ban in PLAIN_BANS), told


def test_the_chart_is_not_left_out_before_genie_has_had_its_repair_round(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    _break_charts(inst, {_chart_sql(agent_ns, tmp_path, "channel_mix")}, MISSING)
    fixed = _churn_page(agent_ns)
    fixed["charts"] = [c for c in fixed["charts"] if c["id"] != "channel_mix"]
    runner = _runner(_churn_page(agent_ns), fixed)
    fields = inst._implement_dashboard(context, runner)
    assert len(runner.prompts) == 2 and fields["dashboard_id"] == "d9"
    assert not any("left out" in w for w in fields.get("_warnings") or []), "Genie repaired it, so nothing was left out"


def test_a_chart_that_draws_a_date_as_a_height_is_left_out_the_same_way(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    rows = [{"x": "Books", "y0": datetime.date(2026, 1, 5), "total": datetime.date(2026, 1, 5)}]
    _break_charts(inst, {_chart_sql(agent_ns, tmp_path, "pareto")}, rows=rows)
    fields = inst._implement_dashboard(context, _runner(*[_churn_page(agent_ns)] * 3))
    assert fields["dashboard_id"] == "d9", "an unsupported chart shape never fails the Dashboard"
    assert json.dumps(_title(agent_ns, "pareto")) not in json.dumps(_doc(seen))
    told = " | ".join(fields.get("_warnings") or [])
    assert _title(agent_ns, "pareto") in told and "left out" in told, told
    assert not any(ban in told for ban in PLAIN_BANS), told


def test_when_every_chart_fails_the_dashboard_fails_with_one_plain_sentence(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    page = _churn_page(agent_ns)
    _break_charts(inst, {_shell(agent_ns, tmp_path).chart_query(page, c["id"], {})[0] for c in page["charts"]}, MISSING)
    with pytest.raises(RuntimeError) as raised:
        inst._implement_dashboard(context, _runner(*[page] * 3))
    assert "none of the charts could be drawn" in str(raised.value), str(raised.value)
    assert _published(seen) == [], "nothing publishes"
    assert "chart:" not in str(raised.value) and "RuntimeError" not in str(raised.value)
