import copy
import hashlib
import json
import os

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire
from v164_settings_decisions_test import BUILT, INSTRUCTION, SPEC_NB, Reached, _spec

CASES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "fixtures", "implement_table_change_cases.json")
CASES_SHA256 = "2d40224cdfd77be218d86b938db336cb53b64d8ec6cd9fdacdc89bad5005d01e"
OWNER, OTHER = "lee.chan@x.co", "sam.ortiz@x.co"
OLD, NEW = "main.s.orders", "main.s.orders_v2"
SWAP = {"original": OLD, "replaced": OLD, "chosen": NEW}
COLUMNS = [{"column_name": "order_id", "data_type": "STRING"}, {"column_name": "amount", "data_type": "DECIMAL(10,2)"},
           {"column_name": "status", "data_type": "STRING"}]
CODE = f'orders = spark.sql("SELECT order_id, amount FROM {OLD} WHERE amount > 0")\n'
MISSED = ("[UNRESOLVED_COLUMN.WITH_SUGGESTION] A column, variable, or function parameter with name `amount` cannot be resolved. Did you "
          "mean one of the following? [`order_id`, `total`]")
TITLES = ("Genie Code instruction", "Run controls (Inspire, do not edit)")


def _cell(source, title=""):
    meta = {"application/vnd.databricks.v1+cell": {"title": title}} if title else {}
    return {"cell_type": "code", "source": source.splitlines(keepends=True), "metadata": meta}


def _text(cell):
    return "".join(cell["source"])


def _notebook(code=CODE):
    return json.dumps({"cells": [_cell(f"print({OLD!r})", TITLES[0]), _cell(code), _cell(f"run_controls({OLD!r})", TITLES[1])]})


def _data(tables):
    return {"tables": dict(tables), "filters": [], "run_profile": "preview"}


def _swapped(tables=None):
    spec = _spec({"act_now_share": "0.05"})
    spec["data"] = _data({OLD: NEW} if tables is None else tables)
    return spec


def _kept():
    spec = _spec({"act_now_share": "0.05"})
    spec["data"] = _data({})
    return spec


def test_the_agent_classifies_every_shared_table_change_case_as_the_app_does(agent_ns):
    raw = open(CASES, "rb").read()
    assert hashlib.sha256(raw).hexdigest() == CASES_SHA256, "the agent runs the App's table change cases byte for byte"
    cases = json.loads(raw)["cases"]
    assert len(cases) == 19
    for case in cases:
        assert agent_ns["implement_table_change"](case["previous"], case["next"], case["used"], case["columns"]) == case["expected"], case["name"]


def test_a_compatible_swap_is_a_settings_change_that_re_points_and_anything_else_is_a_data_change(agent_ns):
    validate, plan = agent_ns["validate_implement_spec"], agent_ns["implement_plan"]
    before, after = validate(_kept())[0], validate(_swapped())[0]
    same, other = {"class": "settings", "missing": []}, {"class": "data", "missing": []}
    assets = {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "preview_run_id": 9}
    assert agent_ns["classify_implement_change"](before, after, BUILT, same) == ["settings"]
    assert agent_ns["classify_implement_change"](before, after, BUILT, other) == agent_ns["classify_implement_change"](before, after, BUILT) == ["data"]
    swapped = plan(before, after, assets, has_built_notebook=True, built=BUILT, table_change=same)
    assert (swapped["classes"], swapped["refill"], swapped["preview"], swapped["build"], swapped["refresh"]) == (["settings"], False, True, [], [])
    assert swapped["retable"] == [SWAP]
    rebuilt = plan(before, after, assets, has_built_notebook=True, built=BUILT, table_change=other)
    assert (rebuilt["classes"], rebuilt["refill"], rebuilt["retable"]) == (["data"], True, [])
    unbuilt = plan(before, after, assets, has_built_notebook=False, built=BUILT, table_change=same)
    assert unbuilt["refill"] is True and unbuilt["retable"] == [], "with no built notebook to point at the table, Genie builds one"
    kept = plan(before, after, assets, has_built_notebook=True, built=BUILT, table_change=dict(same, repoint=False))
    assert (kept["classes"], kept["refill"], kept["retable"]) == (["settings"], True, []), \
        "a compatible swap stays a settings change when Genie, not Inspire, points the notebook at the table"
    assert plan(before, before, assets, has_built_notebook=True, built=BUILT)["retable"] == []


def test_the_re_point_rewrites_every_full_name_of_the_table_in_genie_s_cells_and_refuses_what_it_cannot_rewrite(agent_ns):
    cells = agent_ns["implement_retable_cells"]
    for code, shown in ((CODE, CODE.replace(OLD, NEW)),
                        ("SELECT * FROM `main`.`s`.`orders` o", "SELECT * FROM `main`.`s`.`orders_v2` o"),
                        ("x = spark.table('MAIN.S.ORDERS')", f"x = spark.table('{NEW}')")):
        text, problems = cells(_notebook(code), [SWAP], TITLES)
        written = json.loads(text)["cells"]
        assert (problems, "".join(written[1]["source"])) == ([], shown), code
        assert [_text(c) for c in (written[0], written[2])] == [f"print({OLD!r})", f"run_controls({OLD!r})"], "Inspire's cells stay as written"
    refused = {"SELECT a FROM s.orders": ["it still names the replaced table in a way Inspire cannot rewrite", "it does not name the new table by its full name"],
               f"USE CATALOG main;\nSELECT a FROM {OLD}": ["it picks its catalog or schema with USE, so a table name in it may stand for another table"],
               "SELECT a FROM main.s.orders_model": ["it does not name the new table by its full name"],
               "SELECT a FROM `main`.`s`.orders": ["it still names the replaced table in a way Inspire cannot rewrite", "it does not name the new table by its full name"]}
    for code, problems in refused.items():
        assert cells(_notebook(code), [SWAP], TITLES)[1] == problems, code
    assert agent_ns["implement_retarget_instruction"]("FROM a.b.c_model JOIN a.b.c", "a.b.c", "x.y.z") == "FROM x.y.z_model JOIN x.y.z"
    assert agent_ns["implement_rename_table"]("FROM a.b.c_model JOIN a.b.c", "a.b.c", "x.y.z") == "FROM a.b.c_model JOIN x.y.z"


def test_a_built_notebook_records_the_columns_it_reads_of_each_source_table(agent_ns):
    reads = agent_ns["implement_notebook_reads"]
    columns = {NEW: COLUMNS, "Main.S.Customers": [{"column_name": "Customer ID", "data_type": "STRING"}, {"column_name": "tier"}]}
    assert reads(CODE + "c = spark.sql('SELECT `customer id` FROM main.s.customers')", columns) == {
        NEW: ["order_id", "amount"], "main.s.customers": ["Customer ID"]}
    for whole in ("SELECT * FROM t", "df = spark.table('t')", "for name in df.columns:\n    pass", "df.select('*')", None):
        assert reads(whole, columns) == {NEW: ["order_id", "amount", "status"], "main.s.customers": ["Customer ID", "tier"]}, whole


class Runner:
    pass


def _run(agent_ns, requester=OWNER, code=CODE, columns=None, outcome=None, repair=None):
    inst = _inspire(agent_ns, FakeSpark())
    seen = {"genie": 0, "written": [], "imported": [], "missing": [], "fills": [], "updates": [], "steps": [], "columns": [], "warnings": None}
    status = {"notebook": {"spec_version": 1, "result_history": agent_ns["IMPLEMENT_RESULT_HISTORY"], "state": "ready"}, "settings": BUILT}
    inst._implement_previous = lambda t: {"spec_version": 1, "spec_json": _kept(), "created_by": OWNER}
    carried = {"notebook_path": "/Workspace/nb", "job_id": 7, "dashboard_id": "d1", "genie_space_id": "g1", "app_name": "churn-desk",
               "last_preview_run_id": 99}
    inst._implement_carried = lambda t, through_own=False: (dict(carried), copy.deepcopy(status))
    inst._implement_update = lambda key, **f: seen["updates"].append(copy.deepcopy(f))
    inst._implement_emit = lambda *a, **k: seen["steps"].append(a)
    inst._implement_use_case_row = lambda sid, uc: {"No": "N01-U01", "Primary Table": OLD, "genie_instruction": INSTRUCTION}
    inst._row_to_uc = lambda row: dict(row)
    inst._genie_involved_tables = lambda uc: [OLD]
    inst._genie_notebook_spec = lambda uc: dict(SPEC_NB)
    inst._implement_folder_access = lambda *a, **k: []
    held = {"/Workspace/nb": _notebook(code)}
    known = columns if columns is not None else {OLD: COLUMNS, NEW: COLUMNS + [{"column_name": "channel", "data_type": "STRING"}]}
    inst._implement_uc_columns = lambda table: seen["columns"].append(table) or copy.deepcopy(known.get(table, []))
    inst._implement_export_text = lambda path: held[path]
    inst._implement_import_notebook = lambda path, text: seen["imported"].append(path) or held.__setitem__(path, text)
    inst._implement_claim_notebook = lambda use_case, spec, key, asset_status, current="": "/Workspace/nb_v2"
    inst._implement_notebook_before = lambda path: None
    inst._implement_notebook_modified_at = lambda path: 1700000000

    def write(use_case, spec, previous_spec, key, current=""):
        seen["written"].append((current, previous_spec is not None))
        held["/Workspace/nb_v2"] = held[current]
        return "/Workspace/nb_v2"

    inst._implement_write_notebook = write
    inst._implement_runner = lambda uc: seen.__setitem__("genie", seen["genie"] + 1) or Runner()
    inst._implement_recover_instruction = lambda row, uc_id, use_case, warnings: use_case
    inst._implement_refresh_run_controls = lambda *a, **k: None
    inst._implement_missing_tables = lambda tables: seen["missing"].append(list(tables)) or []
    inst._implement_keep_edits_setting = lambda *a, **k: None
    inst._implement_settings = lambda *a, **k: BUILT

    def fill(uc_id, key, use_case, spec, previous_spec, notebook_path, widget_names, runner, refill):
        seen["fills"].append({"path": notebook_path, "refill": refill, "genie": runner is not None,
                              "note": use_case.get("_implement_repair_note") or ""})
        return dict(outcome or {"status": "written", "rows_written": 3}), 7, {}

    inst._implement_fill_and_preview = fill

    def stop(uc_id, result_table, spec, warnings):
        seen["warnings"] = list(warnings)
        raise Reached("past the notebook")

    inst._implement_result_history = stop
    target = {"session_id": 5150, "use_case_id": "N01-U01", "spec_version": 2, "spec_json": _swapped(), "created_by": requester,
              **({"_implement_repair": repair} if repair else {})}
    inflight = {}
    return inst, seen, inflight, lambda: inst._implement_one_locked(target, (5150, "N01-U01", 2), inflight)


def _plan(seen):
    return next(step[4]["plan"] for step in seen["steps"] if step[1] == "Plan")


def test_an_owner_s_compatible_swap_points_the_notebook_at_the_new_table_with_no_genie_and_runs_it(agent_ns):
    inst, seen, inflight, run = _run(agent_ns)
    with pytest.raises(Reached, match="past the notebook"):
        run()
    plan = _plan(seen)
    assert (plan["classes"], plan["refill"], plan["retable"]) == (["settings"], False, [SWAP])
    assert seen["genie"] == 0 and seen["fills"] == [{"path": "/Workspace/nb_v2", "refill": False, "genie": False, "note": ""}]
    assert seen["written"] == [("/Workspace/nb", True)] and seen["imported"] == ["/Workspace/nb_v2"]
    code = inst._implement_cells_text(inst._implement_export_text("/Workspace/nb_v2"))
    assert NEW in code and f"{OLD} " not in code and json.loads(inst._implement_export_text("/Workspace/nb"))["cells"][1]["source"] == [CODE]
    assert seen["missing"] == [[NEW]], "the run still checks it can read the new table"
    assert sorted(set(seen["columns"])) == [OLD, NEW]
    notebook = next(u["asset_status"]["notebook"] for u in reversed(seen["updates"]) if "notebook" in (u.get("asset_status") or {}))
    assert notebook["reads"] == {NEW: ["order_id", "amount"]} and notebook["spec_version"] == 2
    assert inflight["notebook_current"] == "/Workspace/nb" and inflight.get("notebook_path") is None
    assert seen["warnings"] == []
    assert ("N01-U01", "Notebook", "only tables with the same columns changed: Inspire points the notebook at main.s.orders_v2 in place of "
            "main.s.orders and runs it, without Genie", "started", {"spec_version": 2}) in seen["steps"]


def test_a_person_who_owns_nothing_cannot_make_a_compatible_swap_because_it_is_a_settings_change(agent_ns):
    inst, seen, _inflight, run = _run(agent_ns, requester=OTHER)
    with pytest.raises(agent_ns["ImplementStopped"], match="Only the owners of this use case can change its settings"):
        run()
    assert seen["fills"] == [] and seen["imported"] == [] and seen["genie"] == 0


@pytest.mark.parametrize("columns", [
    {OLD: COLUMNS, NEW: COLUMNS[:1]},
    {OLD: COLUMNS, NEW: [dict(COLUMNS[0]), {"column_name": "amount", "data_type": "DOUBLE"}, dict(COLUMNS[2])]},
    {OLD: COLUMNS},
    {NEW: COLUMNS},
], ids=["dropped_column", "changed_type", "new_table_unreadable", "old_table_unreadable"])
def test_a_swap_that_does_not_keep_every_column_is_a_data_change_that_genie_rebuilds(agent_ns, columns):
    _inst, seen, _inflight, run = _run(agent_ns, columns=columns)
    with pytest.raises(Reached, match="past the notebook"):
        run()
    plan = _plan(seen)
    assert (plan["classes"], plan["refill"], plan["retable"]) == (["data"], True, [])
    assert seen["genie"] == 1 and seen["fills"][0]["refill"] is True and seen["imported"] == []


def test_a_notebook_inspire_cannot_point_at_the_new_table_is_rebuilt_by_genie_with_a_plain_warning(agent_ns):
    _inst, seen, _inflight, run = _run(agent_ns, code="orders = spark.sql('SELECT order_id, amount FROM s.orders')\n")
    with pytest.raises(Reached, match="past the notebook"):
        run()
    plan = _plan(seen)
    assert (plan["classes"], plan["refill"], plan["retable"]) == (["settings"], True, []) and seen["genie"] == 1
    _inst, refused, _inflight, run = _run(agent_ns, requester=OTHER, code="orders = spark.sql('SELECT order_id FROM s.orders')\n")
    with pytest.raises(agent_ns["ImplementStopped"], match="Only the owners of this use case can change its settings"):
        run()
    assert refused["genie"] == 0, "it stays a settings change, so only an owner can ask for it"
    assert seen["warnings"] == [f"Notebook: Inspire could not point the built notebook at the swapped source tables by itself, because it still names the replaced table in a "
                                f"way Inspire cannot rewrite; it does not name the new table by its full name, so Genie rebuilds it"]


def test_a_re_pointed_run_that_misses_a_column_falls_back_to_a_genie_rebuild_with_a_plain_warning(agent_ns):
    inst, seen, inflight, run = _run(agent_ns, outcome={"status": "failed", "error": MISSED})
    told = (f"Inspire pointed the notebook at {NEW} with no rebuild, but its run could not find a column it reads there, so Genie rebuilds it "
            f"for the new table: {MISSED}")
    with pytest.raises(agent_ns["ImplementRetableMissed"]) as missed:
        run()
    assert str(missed.value) == told
    assert inflight["notebook_current"] == "/Workspace/nb" and inflight["notebook_path"] == "/Workspace/nb_v2", \
        "the undo after a failed attempt points the job back at the live notebook"
    repair = agent_ns["implement_known_repair"](missed.value, str(missed.value))
    assert repair == {"kind": "rebuild_with_error", "why": agent_ns["IMPLEMENT_RETABLE_REBUILD"], "wait_s": 0, "retable": True}
    _inst, again, _inflight, rerun = _run(agent_ns, repair=dict(repair, error=told))
    with pytest.raises(Reached, match="past the notebook"):
        rerun()
    plan = _plan(again)
    assert (plan["classes"], plan["refill"], plan["retable"]) == (["settings"], True, []) and again["genie"] == 1
    assert again["fills"][0]["refill"] is True and told in again["fills"][0]["note"], "Genie is told what the re-pointed run could not find"
    assert again["warnings"] == [f"Notebook: {told}"]
    assert again["imported"] == [], "the rebuild never points the old notebook by hand"


def test_a_stopped_or_other_failure_of_a_re_pointed_run_is_not_called_a_missing_column(agent_ns):
    for outcome in ({"status": "stopped", "stop_reason": MISSED}, {"status": "failed", "error": "the warehouse is stopped"}):
        _inst, _seen, _inflight, run = _run(agent_ns, outcome=outcome)
        with pytest.raises(Exception) as failed:
            run()
        assert not isinstance(failed.value, agent_ns["ImplementRetableMissed"]), outcome


def test_a_written_notebook_that_no_longer_names_the_table_is_handed_to_genie_instead_of_running(agent_ns):
    inst, seen, _inflight, run = _run(agent_ns)
    inst._implement_write_notebook = (lambda use_case, spec, previous_spec, key, current="":
                                      inst._implement_import_notebook("/Workspace/nb_v2", _notebook("print(1)\n")) or "/Workspace/nb_v2")
    with pytest.raises(agent_ns["ImplementRetableMissed"]) as missed:
        run()
    assert str(missed.value) == (f"Inspire could not point the built notebook at the swapped source tables by itself, because it does not name the new table by its full "
                                 "name, so Genie rebuilds it")
    assert seen["fills"] == [] and agent_ns["implement_known_repair"](missed.value, str(missed.value)) == {
        "kind": "rebuild_with_error", "why": "pointing the notebook at the new table did not work, so Genie rebuilds it for that table",
        "wait_s": 0, "retable": True}, "the repair names what went wrong for a notebook Inspire could not rewrite and one that missed a column"


RESULT = "main.inspire.churn_out"
SPACE = {"title": "Churn desk", "serialized_space": {
    "data_sources": {"tables": [{"identifier": RESULT}, {"identifier": OLD}]},
    "instructions": {"example_question_sqls": [{"sql": ["SELECT status, COUNT(*) FROM `main`.`s`.`orders` GROUP BY status"]}]}}}
PAGE = {"id": "n01_u01", "datasets": [{"name": "records", "query": f"SELECT * FROM {RESULT}"}]}
CHECKS = [{"ask": "Answer in plain words", "status": "done", "evidence": "plain words"}]
RECORDS = {"genie_space": {"state": "ready", "spec_version": 1, "snapshot": True, "vibes_checks": CHECKS},
           "dashboard": {"state": "ready", "spec_version": 1, "snapshot": True}, "app": {"state": "ready", "spec_version": 1}}
SAVED = {"genie_space": {"artifact": SPACE, "vibes": "", "spec_version": 1, "merged_into": ""},
         "dashboard": {"artifact": PAGE, "vibes": "", "spec_version": 1, "merged_into": ""}}


def test_an_output_artifact_is_pointed_at_the_new_table_wherever_it_names_the_old_one_by_its_full_name(agent_ns):
    retable = agent_ns["implement_retable_artifact"]
    renamed, named, problems = retable(dict(SPACE, reads={OLD: ["amount"]}), [SWAP])
    assert (named, problems) == ([SWAP], [])
    assert renamed == dict(SPACE, reads={NEW: ["amount"]}, serialized_space={
        "data_sources": {"tables": [{"identifier": RESULT}, {"identifier": NEW}]},
        "instructions": {"example_question_sqls": [{"sql": ["SELECT status, COUNT(*) FROM `main`.`s`.`orders_v2` GROUP BY status"]}]}})
    assert SPACE["serialized_space"]["data_sources"]["tables"][1] == {"identifier": OLD}, "the saved copy itself is never changed"
    for untouched in (PAGE, {"query": "SELECT a FROM main.s.orders_model"}, {"n": 3, "flag": True, "none": None}, None):
        assert retable(untouched, [SWAP]) == (untouched, [], []), untouched
    assert retable({"query": "SELECT a FROM s.orders"}, [SWAP])[1:] == ([SWAP], [
        "it still names the replaced table in a way Inspire cannot rewrite", "it does not name the new table by its full name"])
    back = {"original": NEW, "replaced": NEW, "chosen": OLD}
    assert retable({"query": f"SELECT a FROM {OLD} JOIN {NEW}"}, [SWAP, back])[2] == [
        "it still names the replaced table in a way Inspire cannot rewrite", "it does not name the new table by its full name"], \
        "two tables swapped for each other are refused, never renamed into one"


def test_a_settings_swap_plans_to_re_point_each_output_that_names_the_table_and_genie_rebuilds_only_what_inspire_cannot(agent_ns):
    validate, plan = agent_ns["validate_implement_spec"], agent_ns["implement_plan"]
    before, after = validate(_kept())[0], validate(_swapped())[0]
    assets = {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "preview_run_id": 9}
    change = {"class": "settings", "missing": [], "repoint": True, "outputs": {"genie_space": {"version": 1, "entry": {}}},
              "refused": {"dashboard": "no copy of the one built in v1 was saved"}}
    out = plan(before, after, assets, has_built_notebook=True, built=BUILT, table_change=change)
    assert (out["refill"], out["retable"], out["retable_outputs"], out["build"], out["refresh"]) == (False, [SWAP], {"genie_space": 1}, [],
                                                                                                    ["dashboard"])
    assert out["repoint"] == ["app"] and out["sharing"] is True, "a re-pointed Genie Agent is one the App asks again, as after a rollback"
    rolled = plan(before, dict(after, rollback_outputs={"genie_space": 1}), assets, has_built_notebook=True, built=BUILT, table_change=change)
    assert (rolled["rollback"], rolled["retable_outputs"]) == ({"genie_space": 1}, {}), "a rollback the person asked for wins"
    for other in (dict(change, repoint=False), dict(change, **{"class": "data"})):
        rebuilt = plan(before, after, assets, has_built_notebook=True, built=BUILT, table_change=other)
        assert (rebuilt["refill"], rebuilt["retable"], rebuilt["retable_outputs"]) == (True, [], {})
        assert sorted(rebuilt["refresh"]) == ["app", "dashboard", "genie_space"], "a rebuilt notebook refreshes every output with Genie"
    assert plan(before, before, assets, has_built_notebook=True, built=BUILT, table_change=change)["retable_outputs"] == {}


def test_the_outputs_to_re_point_come_from_the_copy_saved_when_each_was_built(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    validate, key = agent_ns["validate_implement_spec"], (5150, "N01-U01", 2)
    previous, spec = validate(_kept())[0], validate(_swapped())[0]
    assets, change, read = {"genie_space": "g1", "dashboard": "d1", "app": "churn-desk"}, {"class": "settings", "missing": [], "repoint": True}, []

    def snapshot(key, name, version):
        read.append((name, version))
        if name not in SAVED:
            raise agent_ns["ImplementBlocked"](f"v{version} has no saved App to roll back to")
        return copy.deepcopy(SAVED[name])

    inst._implement_snapshot = snapshot
    records = copy.deepcopy(RECORDS)
    records["app"]["snapshot"] = True
    out = inst._implement_retable_outputs(key, records, assets, previous, spec, change)
    renamed = agent_ns["implement_retable_artifact"](SPACE, [SWAP])[0]
    assert out == dict(change, outputs={"genie_space": {"version": 1, "entry": dict(SAVED["genie_space"], artifact=renamed, retable=NEW)}},
                       refused={"app": "no copy of the one built in v1 was saved"})
    assert read == [("genie_space", 1), ("dashboard", 1), ("app", 1)]
    read.clear()
    odd = {"genie_space": {"state": "ready", "spec_version": 1}, "dashboard": {"state": "failed", "spec_version": 1, "snapshot": True},
           "app": {"state": "ready", "spec_version": 2, "snapshot": True}}
    assert inst._implement_retable_outputs(key, odd, assets, previous, spec, change) == dict(
        change, outputs={}, refused={"genie_space": "no copy of the one built in v1 was saved"})
    assert read == [], "a failed output, one already built in this version and one with no saved copy read no snapshot"

    def broken(key, name, version):
        raise RuntimeError("the warehouse is stopped")

    inst._implement_snapshot = broken
    assert inst._implement_retable_outputs(key, {"genie_space": RECORDS["genie_space"]}, assets, previous, spec, change)["refused"] == {
        "genie_space": "its saved copy could not be read (the warehouse is stopped)"}
    inst._implement_snapshot = lambda key, name, version: pytest.fail("nothing to re-point reads no snapshot")
    for kept in ({"class": "data", "missing": []}, dict(change, repoint=False), None):
        assert inst._implement_retable_outputs(key, RECORDS, assets, previous, spec, kept) == kept
    assert inst._implement_retable_outputs(key, RECORDS, assets, previous, previous, change) == change


def _outputs_run(agent_ns, columns=None, failing=None):
    inst, seen, _inflight, run = _run(agent_ns, columns=columns)
    base = inst._implement_carried
    inst._implement_carried = lambda t, through_own=False: (base(t)[0], dict(base(t)[1], **copy.deepcopy(RECORDS)))
    seen.update(built=[], snapshots=[])

    def snapshot(key, name, version):
        seen["snapshots"].append((name, version))
        return copy.deepcopy(SAVED[name])

    def builder(name, field, asset):
        def build(context, runner):
            replay = (context.get("replay") or {}).get(name)
            seen["built"].append({"name": name, "replay": copy.deepcopy(replay), "genie": runner is not None, "allowed": list(context["allowed"])})
            if replay and name in (failing or {}):
                raise RuntimeError(failing[name])
            context.setdefault("artifacts", {})[name] = copy.deepcopy(replay[1]["artifact"] if replay else {"title": f"new {name}"})
            return {field: asset}

        return build

    inst._implement_snapshot = snapshot
    inst._implement_genie_space = builder("genie_space", "genie_space_id", "g1")
    inst._implement_dashboard = builder("dashboard", "dashboard_id", "d1")
    inst._implement_app = builder("app", "app_name", "churn-desk")
    inst._implement_repair = lambda *a, **k: {"kind": "stop"}
    inst._implement_result_history = lambda uc_id, table, spec, warnings: seen.__setitem__("warnings", list(warnings))
    inst._implement_reasons_view = inst._implement_summary_table = lambda table, warnings: ""
    inst._implement_fallback_warning = inst._implement_tier_warning = lambda *a: ""
    inst._implement_record_notebook_parts = inst._implement_record_ai_checks = inst._implement_vibe_checklist = lambda context: None
    inst._implement_notebook_vibes = lambda context: []
    inst._implement_record_parts = lambda context, name, artifact: None
    inst._implement_recheck_vibes = lambda context, warnings: []
    inst._implement_keep_side = inst._implement_app_owner_sync = lambda *a: []
    inst._implement_share = lambda *a, **k: []
    inst._implement_app_hosted_prune = inst._implement_schedule = lambda *a: None
    return seen, run


def _final(seen):
    return next(u for u in reversed(seen["updates"]) if u.get("status", "").startswith("ready"))


REFUSED_APP = f"App: Inspire could not point it at the swapped source tables by itself, because no copy of the one built in v1 was saved, so Genie rebuilds it"


def test_a_settings_swap_re_points_each_built_output_that_reads_the_table_from_its_saved_copy_with_no_genie(agent_ns):
    seen, run = _outputs_run(agent_ns)
    status = run()
    assert [(b["name"], b["replay"] is not None, b["genie"], b["allowed"]) for b in seen["built"]] == [
        ("genie_space", True, False, [RESULT, NEW]), ("app", False, True, [RESULT, NEW])]
    assert status == "ready_with_warnings"
    plan = _plan(seen)
    assert (plan["classes"], plan["refill"], plan["retable_outputs"], plan["refresh"], plan["repoint"]) == (["settings"], False,
                                                                                                         {"genie_space": 1}, ["app"], [])
    message = next(step[2] for step in seen["steps"] if step[1] == "Plan")
    assert message.endswith(f"; refresh app; point the notebook at {NEW}; point the Genie Agent at {NEW}"), message
    renamed = agent_ns["implement_retable_artifact"](SPACE, [SWAP])[0]
    assert seen["built"] == [
        {"name": "genie_space", "replay": (1, dict(SAVED["genie_space"], artifact=renamed, retable=NEW)), "genie": False, "allowed": [RESULT, NEW]},
        {"name": "app", "replay": None, "genie": True, "allowed": [RESULT, NEW]}]
    assert seen["genie"] == 1 and seen["snapshots"] == [("genie_space", 1), ("dashboard", 1)], "the dashboard reads no input table"
    assert seen["warnings"] == [REFUSED_APP]
    final = _final(seen)
    assert final["status_message"] == REFUSED_APP
    space = final["asset_status"]["genie_space"]
    assert (space["state"], space["spec_version"], space["snapshot"], space["vibes_checks"]) == ("ready", 2, True, CHECKS), \
        "the Genie Agent pointed at the new table keeps the checks of the asks it was built with"
    assert final["asset_status"]["dashboard"] == RECORDS["dashboard"], "an output that does not read the table stays as it was"
    stored = [json.loads(u["asset_snapshots"]) for u in seen["updates"] if "asset_snapshots" in u]
    assert stored[0]["genie_space"] == {"artifact": renamed, "vibes": "", "spec_version": 2, "merged_into": ""}, \
        "the copy saved for later is the one that reads the new table"


def test_an_output_that_fails_its_checks_on_the_new_table_falls_back_to_a_genie_refresh_with_a_plain_warning(agent_ns):
    error = "[UNRESOLVED_COLUMN] A column with name `status` cannot be resolved"
    seen, run = _outputs_run(agent_ns, failing={"genie_space": error})
    status = run()
    assert [(b["name"], b["replay"] is not None, b["genie"]) for b in seen["built"]] == [
        ("genie_space", True, False), ("genie_space", False, True), ("app", False, True)]
    assert status == "ready_with_warnings"
    missed = f"Genie Agent: Inspire could not point it at {NEW} with no Genie round, so Genie rebuilds it: {error}"
    final = _final(seen)
    assert final["status_message"] == f"{REFUSED_APP}; {missed}"
    space = final["asset_status"]["genie_space"]
    assert (space["state"], space["spec_version"], space["warnings"]) == ("ready", 2, [missed.removeprefix("Genie Agent: ")])
    assert "vibes_checks" not in space, "a Genie Agent Genie rebuilt carries no checks from the one it replaced"
    assert seen["genie"] == 1, "the Genie fallback and the App refresh share one Genie Code install"


def test_a_data_swap_rebuilds_every_output_with_genie_and_no_output_may_read_the_replaced_table(agent_ns):
    seen, run = _outputs_run(agent_ns, columns={OLD: COLUMNS, NEW: COLUMNS[:1]})
    status = run()
    assert [(b["name"], b["replay"], b["genie"], b["allowed"]) for b in seen["built"]] == [
        (name, None, True, [RESULT, NEW]) for name in ("genie_space", "dashboard", "app")]
    assert status == "ready"
    plan = _plan(seen)
    assert (plan["classes"], plan["refill"], plan["retable_outputs"]) == (["data"], True, {})
    assert seen["snapshots"] == [], "a rebuild reads no saved copy"


def test_the_re_point_of_an_output_says_what_it_points_at_and_never_calls_itself_a_rollback(agent_ns, tmp_path):
    inst = _inspire(agent_ns, FakeSpark())
    updates, steps = [], []
    inst._implement_update = lambda key, **f: updates.append(f)
    inst._implement_emit = lambda *a, **k: steps.append(a) or "step-1"
    inst._implement_work_dir = lambda uc_id, name: str(tmp_path / name)
    entry = dict(SAVED["dashboard"], retable=NEW)
    context = {"uc_id": "N01-U01", "key": (5150, "N01-U01", 2), "replay": {"dashboard": (1, entry)}}
    written = []

    def deploy(work):
        written.append(json.load(open(os.path.join(work, agent_ns["IMPLEMENT_APP_PAGE_FILE"]))))
        return {"dashboard_id": "d1", "_asset": {}}

    assert inst._implement_replay(context, "dashboard", deploy) == {"dashboard_id": "d1", "_asset": {}}
    assert written == [PAGE] and updates == [{"status_message": f"Dashboard: pointing v1 at {NEW}"}]
    assert steps == [("N01-U01", "Dashboard", f"pointing the Dashboard built in v1 at {NEW}, with no Genie round; its checks run against the "
                      "current tables first", "started", {"spec_version": 2, "retable_of": 1}),
                     ("N01-U01", "Dashboard", f"Dashboard now reads {NEW}", "ended_success", {"dashboard_id": "d1", "spec_version": 2,
                                                                                            "retable_of": 1})]

    def failing(work):
        raise RuntimeError("[UNRESOLVED_COLUMN] status cannot be resolved")

    with pytest.raises(agent_ns["ImplementBlocked"]) as raised:
        inst._implement_replay(context, "dashboard", failing)
    assert str(raised.value) == f"the Dashboard of v1 pointed at {NEW} does not pass its checks: [UNRESOLVED_COLUMN] status cannot be resolved"
    assert steps[-1][2:] == (f"pointing it at {NEW} failed: {raised.value}", "ended_error", {"spec_version": 2, "retable_of": 1})
    context["replay"]["dashboard"] = (1, SAVED["dashboard"])
    inst._implement_replay(context, "dashboard", lambda work: {"dashboard_id": "d1"})
    assert updates[-1] == {"status_message": "Dashboard: rolling back to v1"}
    assert steps[-1][2:] == ("Dashboard rolled back to v1", "ended_success", {"dashboard_id": "d1", "spec_version": 2, "rollback_to": 1})
