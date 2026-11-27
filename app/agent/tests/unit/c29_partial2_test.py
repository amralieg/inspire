"""c29_partial2: the last two "one bad part fails the whole step" sites of the generated-app build (class of c29_partial).

The Dashboard ran every dataset after the page check and refused the Dashboard on the first dataset that could not run, though a dataset
backs several widgets. The Genie Agent read the columns of every input table and refused the space on the first table it could not
read. Now, after Genie's repair round, the Dashboard leaves out that dataset and every widget that reads it, and the Genie Agent leaves out
that table and every join spec, SQL snippet, example SQL and benchmark that names it; one plain warning names the part and what went with
it, and the rest is built. When no dataset or table is left, the step still fails with a plain reason."""
import json
import os
import sys

import pytest

pytest.importorskip("sqlglot")

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

from v140_implement_test import _FileRunner, _churn_page, _output_context  # noqa: E402
from v142_dash_test import _doc, _flow, _published, _runner  # noqa: E402
from v142_genie_test import _definition, _deploy_inspire, _posted_space, _rich_space  # noqa: E402
from v197_genie_question_rows_test import _answers  # noqa: E402

PLAIN_BANS = ("Genie round", "rounds", "RuntimeError", "Traceback", "datasetName", "chart:", "failed:")
MISSING = ("[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column, variable, or function parameter with name `value_at_stake` cannot be "
           "resolved. Did you mean one of the following? [`loss`]")
TREND_WIDGETS = ("Loss to discounts", "Loss rate", "Loss to discounts by month", "Loss by channel over time")


def _fail_datasets(ns, tmp_path, names, pages=3, mended_after=None):
    """A Dashboard flow whose check query of each dataset in `names` fails (until Genie has written `mended_after` pages, when given)."""
    page = _churn_page(ns)
    dry, dry_context, dry_seen = _flow(ns, tmp_path)  # the dataset check queries come from the dashboard the page converts to
    dry._implement_dashboard(dry_context, _runner(page))
    bad = {ns["implement_dashboard_check_sql"](d) for d in _doc(dry_seen)["datasets"] if d["name"] in names}
    inst, context, seen = _flow(ns, tmp_path)
    runner = _runner(*[page] * pages)
    inner = inst._implement_run_query_check

    def query(sql, require_rows=False, limit=20):
        if sql in bad and (mended_after is None or len(runner.prompts) < mended_after):
            raise RuntimeError(MISSING)
        return inner(sql, require_rows=require_rows, limit=limit)

    inst._implement_run_query_check = query
    return inst, context, seen, runner


def _reads(doc):
    """(widget name, dataset) for every query of every widget of the dashboard."""
    return [(i["widget"]["name"], q["query"]["datasetName"]) for p in doc["pages"] for i in p.get("layout", [])
            for q in i["widget"].get("queries") or []]


def _titles(doc):
    return {(i["widget"].get("spec") or {}).get("frame", {}).get("title") for p in doc["pages"] for i in p.get("layout", [])}


def test_one_dashboard_dataset_that_cannot_run_is_left_out_with_its_widgets_and_the_dashboard_publishes(agent_ns, tmp_path):
    inst, context, seen, runner = _fail_datasets(agent_ns, tmp_path, {"trend"})
    fields = inst._implement_dashboard(context, runner)
    assert fields["dashboard_id"] == "d9", "one bad dataset never fails the Dashboard"
    assert len(runner.prompts) == 2, "Genie repairs the page once, then the dataset is left out"
    doc = _doc(seen)
    assert {d["name"] for d in doc["datasets"]} == {"records", "run_health", "chart_3_parts"}, "the other datasets stay"
    assert "trend" not in {ds for _w, ds in _reads(doc)}, "no widget reads the dataset that cannot run"
    shown = _titles(doc)
    assert not (set(TREND_WIDGETS) & shown), "every widget that read the dataset is gone"
    assert {"Items on the list", "How concentrated the loss is", "Where the loss sits", "Decision list", "Run date"} <= shown, \
        "every widget of the other datasets stays, and so do the filters"
    told = " | ".join(fields.get("_warnings") or [])
    assert "trend" in told and "left out" in told and all(t in told for t in TREND_WIDGETS), told
    assert not any(ban in told for ban in PLAIN_BANS), told


def test_a_dashboard_dataset_is_not_left_out_before_genie_has_had_its_repair_round(agent_ns, tmp_path):
    inst, context, seen, runner = _fail_datasets(agent_ns, tmp_path, {"trend"}, pages=2, mended_after=2)
    fields = inst._implement_dashboard(context, runner)
    assert len(runner.prompts) == 2 and fields["dashboard_id"] == "d9"
    assert not any("left out" in w for w in fields.get("_warnings") or []), "Genie repaired it, so nothing was left out"
    assert {d["name"] for d in _doc(seen)["datasets"]} >= {"trend"} and "Loss rate" in _titles(_doc(seen))


def test_when_every_dashboard_dataset_fails_the_dashboard_fails_with_one_plain_sentence(agent_ns, tmp_path):
    inst, context, seen, runner = _fail_datasets(agent_ns, tmp_path, {"trend", "records", "run_health", "chart_3_parts"})
    with pytest.raises(RuntimeError) as raised:
        inst._implement_dashboard(context, runner)
    assert "none of the datasets could be run" in str(raised.value), str(raised.value)[:300]
    assert not any(ban in str(raised.value) for ban in ("RuntimeError", "Traceback", "datasetName", "failed:")), str(raised.value)[:300]
    assert _published(seen) == [], "nothing publishes"


# ---- the Genie Agent: one input table that cannot be read ----

ITEMS = "main.s.items"
ITEM_COLUMNS = [("item_key", "string", "the item key"), ("price", "double", "the item price")]


def _three_table_space():
    space = _rich_space()
    space["data_sources"]["tables"].append({"identifier": ITEMS, "description": "One row per item."})
    instructions = space["instructions"]
    instructions["join_specs"].append(dict(instructions["join_specs"][0], id="b" * 32, left={"identifier": ITEMS, "alias": "i"},
                                           sql=["`i`.`item_key` = `c`.`entity_id`\n", "--rt=FROM_RELATIONSHIP_TYPE_MANY_TO_MANY--"]))
    instructions["sql_snippets"]["measures"].append({"id": "c" * 32, "alias": "item_total", "display_name": "Item total",
                                                     "sql": ["SUM(`items`.`price`)"], "synonyms": ["item sum"]})
    space["benchmarks"]["questions"].append({"id": "d" * 32, "question": ["How many items are there?"], "answer": [{
        "format": "SQL", "content": [f"SELECT COUNT(*) FROM {ITEMS}"]}]})
    return space


def _genie(ns, tmp_path, spaces, unreadable, mended_after=None):
    """A Genie Agent flow whose columns of each table in `unreadable` cannot be read (until Genie has written `mended_after` spaces)."""
    inst, calls, ran = _deploy_inspire(ns, tmp_path)
    _answers(inst, ran)
    inner = inst._implement_space_columns
    runner = _FileRunner([{"exit": 0}] * len(spaces), [{"genie_space.json": _definition(s)} for s in spaces])

    def columns(tables):
        gone = [t for t in tables if t.lower() in unreadable]
        if gone and (mended_after is None or len(runner.prompts) < mended_after):
            raise RuntimeError(f"the columns of {gone[0]} could not be read: [PERMISSION_DENIED] no access to {gone[0]}")
        return {t.lower(): ITEM_COLUMNS if t.lower() == ITEMS else inner([t])[t.lower()] for t in tables}

    inst._implement_space_columns = columns
    context = _output_context(ns)
    context["allowed"] = context["allowed"] + [ITEMS]
    return inst, calls, context, runner


def _ids(space):
    instructions = space["instructions"]
    return {"tables": [t["identifier"] for t in space["data_sources"]["tables"]],
            "joins": [j["id"] for j in instructions["join_specs"]],
            "measures": [m["id"] for m in instructions["sql_snippets"]["measures"]],
            "benchmarks": [q["id"] for q in space["benchmarks"]["questions"]]}


def test_one_genie_input_table_that_cannot_be_read_is_left_out_with_what_names_it_and_the_space_is_saved(agent_ns, tmp_path):
    space = _three_table_space()
    inst, calls, context, runner = _genie(agent_ns, tmp_path, [space] * 3, {ITEMS})
    fields = inst._implement_genie_space(context, runner)
    assert len(runner.prompts) == 2, "Genie repairs the space once, then the table is left out"
    before, posted = _ids(space), _ids(_posted_space(calls))
    assert ITEMS not in posted["tables"] and len(posted["tables"]) == len(before["tables"]) - 1, "only the table leaves the space"
    assert posted["joins"] == ["4" * 32], "the join spec that names the table is left out, the other stays"
    assert "c" * 32 not in posted["measures"] and len(posted["measures"]) == len(before["measures"]) - 1, "so is the snippet on it"
    assert "d" * 32 not in posted["benchmarks"] and len(posted["benchmarks"]) == len(before["benchmarks"]) - 1, "and the benchmark"
    told = " | ".join(fields["_warnings"])
    assert ITEMS in told and "left out" in told, told
    assert not any(ban in told for ban in PLAIN_BANS), told


def test_a_genie_input_table_is_not_left_out_before_genie_has_had_its_repair_round(agent_ns, tmp_path):
    inst, calls, context, runner = _genie(agent_ns, tmp_path, [_three_table_space()] * 2, {ITEMS}, mended_after=2)
    fields = inst._implement_genie_space(context, runner)
    assert len(runner.prompts) == 2 and not any("left out" in w for w in fields["_warnings"]), "Genie repaired it, so nothing was left out"
    assert ITEMS in _ids(_posted_space(calls))["tables"] and len(_ids(_posted_space(calls))["joins"]) == 2


def test_a_genie_space_whose_every_input_table_cannot_be_read_still_fails_with_a_plain_reason(agent_ns, tmp_path):
    every = {"main.inspire.churn_out", "main.s.orders", ITEMS}
    inst, calls, context, runner = _genie(agent_ns, tmp_path, [_three_table_space()] * 3, every)
    with pytest.raises(Exception) as raised:
        inst._implement_genie_space(context, runner)
    assert "could not be read" in str(raised.value) and "none of the tables" in str(raised.value), str(raised.value)[:300]
    assert "RuntimeError" not in str(raised.value) and "Traceback" not in str(raised.value)
    assert ("POST", "/api/2.0/genie/spaces") not in [c[:2] for c in calls], "nothing is saved"
