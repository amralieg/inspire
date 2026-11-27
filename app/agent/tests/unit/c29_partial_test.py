"""c29_partial: one part of a generated app that cannot be built never fails the whole build step (class of c24_dashshape).

The App and the Dashboard already left out one chart that cannot run, after Genie's repair round. The same defect sat in the other parts of
the build: a KPI tile or a table of the page that fails its query refused the whole page, a second chart left out broke the page's
minimum count, and one Genie Agent benchmark, SQL measure, filter, expression or join spec that cannot run refused the whole Genie
Agent. Now each such part is left out with one plain warning that names it, after Genie's repair round; the rest is built. When every
part of its kind fails, the step still fails."""
import json
import os
import sys

import pytest

pytest.importorskip("sqlglot")

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

from rc2_zero_drivers_test import ALLOWED, RESULT, _monitor_page  # noqa: E402
from v140_implement_test import _FileRunner, _app_flow, _app_shell, _output_context  # noqa: E402
from v142_genie_test import _definition, _deploy_inspire, _posted_space, _rich_space  # noqa: E402
from v197_genie_question_rows_test import _answers  # noqa: E402

PLAIN_BANS = ("Genie round", "chart:", "kpi:", "table:", "rounds", "RuntimeError", "UNRESOLVED", "Traceback")
MISSING = ("[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column, variable, or function parameter with name `value_at_stake` cannot be "
           "resolved. Did you mean one of the following? [`open_items`]")
PAGE_FILE = "pages/n01_u01.json"
KIND_WORD = {"kpis": "kpi", "charts": "chart", "tables": "table"}


def _table(page):
    """A page table that reads the dataset of the first chart."""
    dataset = page["charts"][0]["dataset"]
    return {"id": "open_items", "title": "Open items", "dataset": dataset, "columns": [{"column": "entity_id", "label": "Item"}]}


def _app(ns, tmp_path, failing, page=None):
    """The App round with the real Genie loop. The App check refuses every part in `failing` ({(group, id): message}) while it is in the files."""
    inst, context, seen = _app_flow(ns, tmp_path, write=False, assets={"genie_space": "g1"})
    inst.__dict__.pop("_implement_genie_loop", None)
    context.update(app_layout="monitor_triage", result_table=RESULT, allowed=list(ALLOWED))
    page = page or _monitor_page()

    def check(work, files, modules, warehouse):
        inst._implement_app_speeds = {}
        written = json.loads(files[PAGE_FILE])
        seen["checked"].append(files)
        return [f"page n01_u01: {KIND_WORD[group]}:{ident} failed: {message}" for (group, ident), message in failing.items()
                if any(item.get("id") == ident for item in written.get(group) or [])]

    inst._implement_app_check = check
    runner = _FileRunner([{"exit": 0}] * 3, [{"page.json": json.dumps(page)}] * 3)
    return inst, context, seen, runner, page


def _deployed(seen):
    return json.loads(seen["deployed"][0][1][PAGE_FILE])


def _title(page, group, ident):
    return next(item.get("title") or item.get("label") for item in page[group] if item["id"] == ident)


def _count_problems(ns, tmp_path, page):
    shell_sql = _app_shell(ns, tmp_path)[1]["shell_sql"]
    return [p for p in shell_sql.spec_problems(page) if "needs" in p and ("KPI" in p or "chart" in p)]


def test_one_app_kpi_that_cannot_run_is_left_out_with_a_plain_warning_and_the_app_deploys(agent_ns, tmp_path):
    inst, context, seen, runner, page = _app(agent_ns, tmp_path, {("kpis", page_kpi := "exposure"): MISSING})
    fields = inst._implement_app(context, runner)
    assert seen["deployed"], "one bad KPI tile never fails the App"
    deployed = _deployed(seen)
    assert page_kpi not in [k["id"] for k in deployed["kpis"]]
    assert {k["id"] for k in deployed["kpis"]} == {k["id"] for k in page["kpis"]} - {page_kpi}, "every other KPI stays"
    assert len(runner.seen) == 2, "Genie repairs once, then the KPI is left out"
    told = " | ".join(fields.get("_warnings") or [])
    assert _title(page, "kpis", page_kpi) in told and "left out" in told and "value_at_stake" in told, told
    assert not any(ban in told for ban in PLAIN_BANS), told
    assert not _count_problems(agent_ns, tmp_path, deployed), "the page without the KPI is still a valid page"


def test_one_app_table_that_cannot_run_is_left_out_with_a_plain_warning_and_the_app_deploys(agent_ns, tmp_path):
    page = _monitor_page()
    page["tables"] = [_table(page)]
    inst, context, seen, runner, page = _app(agent_ns, tmp_path, {("tables", "open_items"): MISSING}, page)
    context["spec"]["outputs"]["app_purpose"] = "A table of open items"
    fields = inst._implement_app(context, runner)
    assert seen["deployed"], "one bad table never fails the App"
    deployed = _deployed(seen)
    assert deployed["tables"] == [] and len(deployed["charts"]) == len(page["charts"]), "only the table is left out"
    told = " | ".join(fields.get("_warnings") or [])
    assert "Open items" in told and "left out" in told and "value_at_stake" in told, told
    assert not any(ban in told for ban in PLAIN_BANS), told


def test_two_app_charts_left_out_still_leave_a_valid_page(agent_ns, tmp_path):
    page = _monitor_page()
    ids = [c["id"] for c in page["charts"]]
    inst, context, seen, runner, page = _app(agent_ns, tmp_path, {("charts", ids[0]): MISSING, ("charts", ids[1]): MISSING}, page)
    fields = inst._implement_app(context, runner)
    assert seen["deployed"], "two bad charts never fail the App"
    deployed = _deployed(seen)
    assert [c["id"] for c in deployed["charts"]] == ids[2:]
    assert not _count_problems(agent_ns, tmp_path, deployed), "the minimum counts relax by the parts that were left out"
    assert len([w for w in fields.get("_warnings") or [] if "left out" in w]) == 2


def test_an_app_whose_every_kpi_fails_still_fails_with_a_plain_reason(agent_ns, tmp_path):
    page = _monitor_page()
    failing = {("kpis", k["id"]): MISSING for k in page["kpis"]}
    inst, context, seen, runner, page = _app(agent_ns, tmp_path, failing, page)
    with pytest.raises(Exception) as raised:
        inst._implement_app(context, runner)
    assert not seen["deployed"], "no part of its kind could be built, so the App is not deployed"
    assert "KPI" in str(raised.value) or "kpi" in str(raised.value), str(raised.value)[:300]


# ---- the Genie Agent: one benchmark, SQL snippet or join spec that cannot run ----

SNIPPET = {"measures": "COUNT_IF", "expressions": "DATE_TRUNC", "filters": "`orders`.`status`"}


def _genie(ns, tmp_path, spaces, **answers):
    inst, calls, ran = _deploy_inspire(ns, tmp_path)
    _answers(inst, ran, **answers)
    runner = _FileRunner([{"exit": 0}] * len(spaces), [{"genie_space.json": _definition(s)} for s in spaces])
    return inst, calls, runner


def _kept(space, kind):
    instructions, benchmarks = space["instructions"], space["benchmarks"]["questions"]
    return {"benchmarks": [q["id"] for q in benchmarks], "join_specs": [j["id"] for j in instructions["join_specs"]],
            "measures": [m["id"] for m in instructions["sql_snippets"]["measures"]],
            "expressions": [m["id"] for m in instructions["sql_snippets"]["expressions"]],
            "filters": [m["id"] for m in instructions["sql_snippets"]["filters"]]}[kind]


def _rich_with_distinct_benchmark():
    space = _rich_space()
    space["benchmarks"]["questions"][1]["answer"][0]["content"] = ["SELECT COUNT(DISTINCT entity_id) FROM " + RESULT_TABLE]
    return space


RESULT_TABLE = "main.inspire.churn_out"


def test_one_genie_benchmark_that_cannot_run_is_left_out_with_a_plain_warning_and_the_space_is_saved(agent_ns, tmp_path):
    space = _rich_with_distinct_benchmark()
    inst, calls, runner = _genie(agent_ns, tmp_path, [space] * 2, failing=("COUNT(DISTINCT entity_id)",))
    fields = inst._implement_genie_space(_output_context(agent_ns), runner)
    assert len(runner.prompts) == 2, "Genie repairs the space once, then the benchmark is left out"
    posted = _posted_space(calls)
    assert _kept(posted, "benchmarks") == [q for q in _kept(space, "benchmarks") if q != space["benchmarks"]["questions"][1]["id"]]
    told = " | ".join(fields["_warnings"])
    assert "How many rows are in the latest run?" in told and "left out" in told, told
    assert not any(ban in told for ban in PLAIN_BANS), told


def test_one_genie_benchmark_that_cannot_run_is_not_left_out_before_genie_has_had_its_repair_round(agent_ns, tmp_path):
    bad, good = _rich_with_distinct_benchmark(), _rich_space()
    inst, calls, runner = _genie(agent_ns, tmp_path, [bad, good], failing=("COUNT(DISTINCT entity_id)",))
    fields = inst._implement_genie_space(_output_context(agent_ns), runner)
    assert len(runner.prompts) == 2 and not any("left out" in w for w in fields["_warnings"]), "Genie repaired it, so nothing was left out"
    assert len(_kept(_posted_space(calls), "benchmarks")) == 3


@pytest.mark.parametrize("kind", ["measures", "expressions", "filters"])
def test_one_genie_sql_snippet_that_cannot_run_is_left_out_and_the_rest_of_the_space_is_saved(agent_ns, tmp_path, kind):
    space = _rich_space()
    inst, calls, runner = _genie(agent_ns, tmp_path, [space] * 2, failing=(SNIPPET[kind],))
    fields = inst._implement_genie_space(_output_context(agent_ns), runner)
    posted = _posted_space(calls)
    assert _kept(posted, kind) == [], f"the {kind[:-1]} that cannot run is not in the saved space"
    for other in set(SNIPPET) - {kind}:
        assert _kept(posted, other) == _kept(space, other), "every other snippet stays"
    assert _kept(posted, "join_specs") == _kept(space, "join_specs") and len(_kept(posted, "benchmarks")) == 3
    told = " | ".join(fields["_warnings"])
    assert kind[:-1] in told and "left out" in told, told
    assert not any(ban in told for ban in PLAIN_BANS), told


def test_one_genie_join_spec_that_cannot_run_is_left_out_and_the_rest_of_the_space_is_saved(agent_ns, tmp_path):
    space = _rich_space()
    space["instructions"]["join_specs"].append(dict(space["instructions"]["join_specs"][0], id="b" * 32,
                                                    right={"identifier": "main.inspire.churn_out", "alias": "r2"},
                                                    sql=["`o`.`customer_id` = `r2`.`entity_id`\n", "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_MANY--"]))
    inst, calls, runner = _genie(agent_ns, tmp_path, [space] * 2, failing=("AS `r2`",))
    fields = inst._implement_genie_space(_output_context(agent_ns), runner)
    posted = _posted_space(calls)
    assert _kept(posted, "join_specs") == ["4" * 32], "only the join spec that cannot run leaves the space"
    told = " | ".join(fields["_warnings"])
    assert "join spec o to r2" in told and "left out" in told, told
    assert not any(ban in told for ban in PLAIN_BANS), told


def test_a_genie_space_whose_every_instruction_part_fails_is_still_refused(agent_ns, tmp_path):
    inst, calls, runner = _genie(agent_ns, tmp_path, [_rich_space()] * 3,
                                 failing=("COUNT(*)", "COUNT_IF", "DATE_TRUNC", "`orders`.`status`", "AS joined"))
    with pytest.raises(Exception) as raised:
        inst._implement_genie_space(_output_context(agent_ns), runner)
    assert "the benchmark SQL for" in str(raised.value) and ("POST", "/api/2.0/genie/spaces") not in [c[:2] for c in calls]
