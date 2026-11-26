"""c24_rc7mvp: one generated part that fails validation never kills the whole MVP (live build of a revenue-driver use case).

Item 1: a Dashboard page with no Drivers chart is repaired deterministically, never failed for that alone.
Item 2: one App chart that reads a column its table lacks is dropped with a plain warning; the App still deploys.
Item 3: a notebook row filter on a column the person's scope does not keep is removed from the generated cell.
Item 4: a build with no vibe of its own never lists the asks of an earlier vibe as unmet."""
import json
import os
import sys

import pytest

pytest.importorskip("sqlglot")

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

from rc2_zero_drivers_test import ALLOWED, EXAMPLE, RESULT, _monitor_page  # noqa: E402
from v140_implement_test import _FileRunner, _app_flow, _churn_page  # noqa: E402
from v142_dash_test import _doc, _flow, _published, _runner  # noqa: E402
from v143_vibes_test import _locked, _run  # noqa: E402
from v152_mvp_vibe_test import RISKY, _llm  # noqa: E402

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
PLAIN_BANS = ("Genie round", "chart:", "rounds", "RuntimeError")


def _no_drivers(ns, drop=()):
    """The default-layout page of the live run: its charts break the result down by a category, and Genie marked none as drivers."""
    page = _churn_page(ns)
    page["charts"] = [c for c in page["charts"] if c["id"] not in drop]
    for chart in page["charts"]:
        chart.pop("driver", None)
    return page


def test_item1_a_dashboard_page_without_a_drivers_chart_is_repaired_and_published_not_failed(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    runner = _runner(*[_no_drivers(agent_ns)] * 3)
    fields = inst._implement_dashboard(context, runner)
    assert fields["dashboard_id"] == "d9", "the Dashboard publishes: a missing Drivers mark is repaired, not refused"
    assert len(runner.prompts) == 1, "the repair needs no second Genie round"
    page = context["page_spec"]
    assert [c["id"] for c in page["charts"] if c.get("driver") is True] == ["by_category"], \
        "the chart that breaks the result down by a category is marked as the driver"
    assert _published(seen) and "drivers_header" in json.dumps(_doc(seen))


def test_item1_a_page_with_no_chart_to_mark_publishes_with_a_plain_warning(agent_ns, tmp_path):
    inst, context, seen = _flow(agent_ns, tmp_path)
    runner = _runner(*[_no_drivers(agent_ns, drop=("by_category",))] * 3)
    fields = inst._implement_dashboard(context, runner)
    assert fields["dashboard_id"] == "d9", "a Dashboard is never failed only for a missing Drivers section"
    told = " | ".join(fields.get("_warnings") or [])
    assert "Drivers" in told, told
    assert not any(ban in told for ban in PLAIN_BANS), told


def _two_round_app(ns, tmp_path, check_error):
    """The App round with the real Genie loop; the App check refuses `by_age` until it is gone from the files."""
    inst, context, seen = _app_flow(ns, tmp_path, write=False, assets={"genie_space": "g1"})
    inst.__dict__.pop("_implement_genie_loop", None)
    context.update(app_layout="monitor_triage", result_table=RESULT, allowed=list(ALLOWED))
    page = _monitor_page()

    def check(work, files, modules, warehouse):
        inst._implement_app_speeds = {}
        charts = json.loads(files["pages/n01_u01.json"])["charts"]
        seen["checked"].append(files)
        return [check_error] if any(c["id"] == "by_age" for c in charts) else []

    inst._implement_app_check = check
    runner = _FileRunner([{"exit": 0}] * 3, [{"page.json": json.dumps(page)}] * 3)
    return inst, context, seen, runner, page


def test_item2_one_app_chart_on_a_missing_column_is_dropped_with_a_plain_warning_and_the_app_deploys(agent_ns, tmp_path):
    error = ("page n01_u01: chart:by_age failed: [UNRESOLVED_COLUMN.WITH_SUGGESTION] A column, variable, or function parameter "
             "with name `value_at_stake` cannot be resolved. Did you mean one of the following? [`open_items`]")
    inst, context, seen, runner, page = _two_round_app(agent_ns, tmp_path, error)
    fields = inst._implement_app(context, runner)
    assert seen["deployed"], "one bad chart never fails the App"
    deployed = json.loads(seen["deployed"][0][1]["pages/n01_u01.json"])
    assert "by_age" not in [c["id"] for c in deployed["charts"]]
    assert {c["id"] for c in deployed["charts"]} == {c["id"] for c in page["charts"]} - {"by_age"}, "every other chart stays"
    assert len(runner.seen) == 2, "Genie repairs once, then the chart is dropped"
    title = next(c["title"] for c in page["charts"] if c["id"] == "by_age")
    told = " | ".join(fields.get("_warnings") or [])
    assert title in told and "left out" in told, told
    assert not any(ban in told for ban in PLAIN_BANS), told


CELL = "\n".join(
    ["import pyspark.sql.functions as F"] + [f"# step {n}" for n in range(2, 20)]
    + ['sales = spark.table("main.s.sales")',
       "shifts = (",
       "    sales",
       '    .filter(F.col("region") == "EMEA")',
       '    .filter(F.col("product") == "a data value")',
       '    .groupBy("region", "month")',
       '    .agg(F.sum("revenue").alias("revenue"))',
       ")", ""])
SCOPE = {"region": ["EMEA"], "month": None, "revenue": None}
COLUMNS = {"region", "month", "revenue", "product"}


def test_item3_a_filter_on_a_column_the_scope_does_not_keep_is_removed_from_the_cell(agent_ns):
    problems = agent_ns["implement_row_filter_problems"]([("cell 6", CELL)], SCOPE, COLUMNS)
    assert len(problems) == 1 and "cell 6 line 24 filters `product`" in problems[0], problems
    fixed, dropped = agent_ns["implement_drop_scope_filters"](CELL, SCOPE, COLUMNS)
    assert agent_ns["implement_row_filter_problems"]([("cell 6", fixed)], SCOPE, COLUMNS) == []
    compile(fixed, "cell 6", "exec")
    assert 'F.col("region") == "EMEA"' in fixed and 'groupBy("region", "month")' in fixed, "the kept row condition stays"
    assert "product" not in fixed and len(dropped) == 1


@pytest.mark.parametrize("source", [
    'df = spark.table("main.s.sales")\ndf = df[df["product"] == "Widget"]\n',
    'df = spark.sql("SELECT * FROM main.s.sales WHERE product = \'Widget\' AND region = \'EMEA\'")\n',
    'df = spark.table("main.s.sales").where((F.col("product") == "Widget") & (F.col("region") == "EMEA"))\n',
])
def test_item3_the_same_class_in_other_filter_forms(agent_ns, source):
    fixed, dropped = agent_ns["implement_drop_scope_filters"](source, SCOPE, COLUMNS)
    assert dropped and agent_ns["implement_row_filter_problems"]([("cell 2", fixed)], SCOPE, COLUMNS) == []
    compile(fixed, "cell 2", "exec")


def test_item4_a_build_with_no_vibe_of_its_own_never_lists_earlier_asks_as_unmet(agent_ns, monkeypatch):
    inst, previous = _locked(agent_ns, previous_outputs={"dashboard_vibes": RISKY})
    inst._implement_runner = lambda uc: "genie"
    monkeypatch.setattr(agent_ns["time"], "sleep", lambda seconds: None)

    def dashboard(context, runner):
        raise RuntimeError("the warehouse is stopped")

    inst._implement_dashboard = dashboard
    _llm(inst, {})
    spec = dict(previous, outputs=dict(previous["outputs"], dashboard_name="Churn desk, second look"))
    assert "vibes" not in spec and spec["outputs"]["dashboard_vibes"] == RISKY, "the earlier ask is carried; this build brings no vibe"
    _run(inst, spec)
    final = inst.updates[-1]
    assert "unmet ask" not in final["status_message"], final["status_message"]
