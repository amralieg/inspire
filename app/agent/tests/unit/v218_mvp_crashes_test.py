import json
import re

import pytest

from v120_artifacts_support import CapturingLogger, FakeSpark, make_inspire
from v142_dash_test import RESULT
from v200_kinds_artifacts_test import _allowed, _kinds, _registry, _spec, _type


def _status_with_list_records():
    ready = {"state": "ready", "resource_id": "r1"}
    return {"notebook": dict(ready), "dashboard": dict(ready), "dashboard:loss": dict(ready), "genie_space": dict(ready),
            "app": dict(ready, placement="shared"), "app:page:n01_u01": dict(ready), "ai_reasoning": {"state": "ready_with_warnings"},
            "value_formula": dict(ready), "vibe": {"state": "routed", "asked": "a vibe"},
            "checklist": [{"item": "an item", "done": True}], "checklist_summary": {"done": 1, "total": 1},
            "settings": [{"name": "a_setting", "value": "1"}], "kept": {"dashboard": "r1"}, "grants": {"granted": []},
            "target_kpi": {"name": "a kpi"}, "data": ["a list where a dict was read"], "held": [], "published_held": []}


def _inspire(ns, **attrs):
    attrs.setdefault("inspire_database", "main.inspire")
    return make_inspire(ns, spark=FakeSpark(), session_id=5150, **attrs)


def test_carried_status_reads_list_valued_records_without_crashing(agent_ns):
    inst = _inspire(agent_ns)
    failed = dict(_status_with_list_records(), dashboard={"state": "deleted"})
    rows = [{"asset_status": json.loads(json.dumps(failed)), "dashboard_id": "d_old", "genie_space_id": "g1"},
            {"asset_status": _status_with_list_records(), "dashboard_id": "d_older", "genie_space_id": "g0"}]
    inst._implement_carried_rows = lambda target, through_own: rows
    carried, status = inst._implement_carried({"use_case_id": "N01-U01", "spec_version": 4})
    assert "checklist" not in status and status["settings"][0]["name"] == "a_setting" and status["kept"] == {"dashboard": "r1"}
    assert status["dashboard"] == {"state": "deleted"} and carried.get("genie_space_id") == "g1"
    assert "dashboard_id" not in carried, "a stopped output is not carried even when its row also holds list records"


def test_every_asset_status_reader_skips_list_valued_records(agent_ns):
    status = _status_with_list_records()
    entries = dict(agent_ns["implement_asset_entries"](status))
    assert "checklist" not in entries and "settings" not in entries and "data" not in entries
    assert entries["dashboard"]["state"] == "ready"
    readers = [name for name, value in agent_ns.items() if callable(value) and name.startswith("implement_")
               and getattr(value, "__code__", None) is not None and value.__code__.co_argcount == 1
               and value.__code__.co_varnames[:1] == ("asset_status",)]
    assert readers, "the sweep found the one-argument asset_status readers"
    for name in readers:
        try:
            agent_ns[name](json.loads(json.dumps(status)))
        except AttributeError as error:
            pytest.fail(f"{name} reads a list-valued record as a dict: {error}")


@pytest.mark.parametrize("name,family,check", [("min_positives", "A", "positives"),
                                               ("min_outcome_windows", "A", "outcome_windows"),
                                               ("min_seasonal_cycles", "E", "seasonal_cycles")])
def test_a_fallback_that_needs_none_of_a_count_can_declare_zero_and_is_never_sent_back(agent_ns, name, family, check):
    allowed = agent_ns["genie_allowed_text"](agent_ns["GENIE_WIDGET_ALLOWED"][name])
    assert allowed == "whole number, at least 0"
    core = [{"name": name, "default": str(agent_ns["GENIE_READINESS_THRESHOLDS"][family][name]), "allowed": allowed}]
    fill = {"widgets": [{"name": name, "type": "text", "default": "0", "allowed": allowed}],
            "readiness": [{"check": check, "measured": "0"}]}
    assert agent_ns["implement_widget_default_fixes"](fill, core) == []
    assert agent_ns["implement_declared_setting_problems"](fill, family) == []
    fill["widgets"][0]["default"] = core[0]["default"]
    assert len(agent_ns["implement_declared_setting_problems"](fill, family)) == 1
    fill["widgets"][0]["default"] = "-1"
    assert agent_ns["implement_widget_default_fixes"](fill, core)[0][2] == core[0]["default"]


def test_widget_default_outside_its_range_takes_inspire_default_or_nearest_bound(agent_ns):
    fix = agent_ns["implement_widget_default_fix"]
    assert fix("min_rows", "0", "whole number, at least 1", "1") == "1"
    assert fix("min_rows", "0", "whole number, at least 1") == "1"
    assert fix("min_rows", "0", "whole number, at least 1", "0") == "1"
    assert fix("lookback_months", "500", "whole number, 1 to 120") == "120"
    assert fix("act_now_share", "1.5", "0 to 1") == "1"
    assert fix("min_rows", "many", "whole number, at least 1", "25") == "25"
    assert fix("min_rows", "many", "whole number, at least 1") is None
    assert fix("holdout_fraction", "0", "above 0 and below 1") is None
    assert fix("min_rows", "1", "whole number, at least 1", "25") is None, "a valid default is never changed"
    assert fix("min_rows", "0", "", "1") is None, "a widget with no range is never changed"


def _notebook(default="0", other=""):
    genie = {"cell_type": "code", "metadata": {}, "source": [
        "dbutils.widgets.text(\"result_table\", \"main.inspire.out\", \"Business output table\")\n",
        f"dbutils.widgets.text(\"min_rows\", \"{default}\", \"Minimum usable rows\")\n", other]}
    owned = {"cell_type": "code", "source": ["dbutils.widgets.text(\"min_rows\", \"0\")\n"],
             "metadata": {"application/vnd.databricks.v1+cell": {"title": "Run controls (Inspire, do not edit)"}}}
    return {"cells": [genie, owned], "metadata": {}, "nbformat": 4, "nbformat_minor": 5}


def _fill(default="0"):
    return {"widgets": [{"name": "result_table", "type": "text", "default": "main.inspire.out", "allowed": ""},
                        {"name": "min_rows", "type": "text", "default": default, "allowed": "any"},
                        {"name": "run_profile", "type": "dropdown", "default": "full", "choices": ["preview", "full"]}],
            "changes": [{"setting": "min_rows", "value_was": "1", "value_now": default}]}


def _repairing(ns, notebook):
    inst = _inspire(ns)
    inst.logger = CapturingLogger()
    written = []
    inst._implement_export_text = lambda path: json.dumps(notebook)
    inst._implement_import_notebook = lambda path, text: written.append(json.loads(text))
    return inst, written


def test_build_repairs_an_out_of_range_widget_default_in_the_notebook_and_the_fill(agent_ns):
    core = [{"name": "min_rows", "default": "1", "allowed": "whole number, at least 1"}]
    inst, written = _repairing(agent_ns, _notebook())
    fill = _fill()
    assert agent_ns["normalize_genie_fill_widgets"](fill, core) == []
    assert agent_ns["validate_genie_fill_result"](json.loads(json.dumps(fill)), ["result_table", "min_rows"]) == [
        "the default of widget min_rows is '0'; allowed: whole number, at least 1"]
    repaired = inst._implement_repair_widget_defaults("N01-U01", "/W/nb", fill, core)
    assert repaired == ["min_rows from 0 to 1 (whole number, at least 1)"]
    assert agent_ns["validate_genie_fill_result"](fill, ["result_table", "min_rows"]) == []
    assert len(written) == 1
    genie_text, owned_text = ("".join(cell["source"]) for cell in written[0]["cells"])
    assert "dbutils.widgets.text(\"min_rows\", \"1\", \"Minimum usable rows\")" in genie_text
    assert "\"main.inspire.out\"" in genie_text and owned_text == "dbutils.widgets.text(\"min_rows\", \"0\")\n"
    assert agent_ns["implement_genie_change_notes"](fill) == []
    assert any("[IMPLEMENT-WIDGET-REPAIR FIRED] N01-U01" in message for _level, message in inst.logger.records)


def test_build_keeps_the_problem_when_the_notebook_default_cannot_be_found_once(agent_ns):
    core = [{"name": "min_rows", "default": "1", "allowed": "whole number, at least 1"}]
    for notebook in (_notebook(default="5"), _notebook(other="dbutils.widgets.text('min_rows', '0')\n")):
        inst, written = _repairing(agent_ns, notebook)
        fill = _fill()
        agent_ns["normalize_genie_fill_widgets"](fill, core)
        assert inst._implement_repair_widget_defaults("N01-U01", "/W/nb", fill, core) == [] and written == []
        assert agent_ns["validate_genie_fill_result"](fill, ["result_table", "min_rows"]) == [
            "the default of widget min_rows is '0'; allowed: whole number, at least 1"]


def test_widget_default_patch_reads_keyword_and_single_quoted_calls(agent_ns):
    patch = agent_ns["implement_widget_default_patch"]
    cells = [{"cell_type": "code", "source": ["dbutils.widgets.text(name='min_rows', defaultValue='0', label='Rows')\n"]}]
    assert patch(cells, "min_rows", "0", "1") is True
    assert cells[0]["source"] == ["dbutils.widgets.text(name='min_rows', defaultValue='1', label='Rows')\n"]
    assert patch(cells, "min_rows", "0", "1") is False


def test_the_fill_round_repairs_widget_defaults_before_it_checks_them(agent_ns):
    from _agentload import agent_source
    source = agent_source()
    repair = source.index("self._implement_repair_widget_defaults(uc_id, notebook_path, fill, core_widgets)")
    assert source.index("reply = normalize_genie_fill_widgets(fill, core_widgets)") < repair < source.index(
        "reply += validate_genie_fill_result(fill, widget_names[:-1])")


ROW_COUNT_KINDS = 10


def _kind_space(ns, kind):
    spec = _spec(ns, kind["id"])
    space = {"data_sources": {"tables": [{"identifier": RESULT}]}, "instructions": {}}
    data, added, bound, dropped = ns["implement_genie_kind_space"]({"serialized_space": json.dumps(space)}, spec, [RESULT])
    columns = {RESULT.lower(): [(c, t, "") for c, t in ns["INSPIRE_CORE_COLUMNS"]]}
    columns.update({info["table"].lower(): [(c, _type(c), "") for c in info["columns"]] for info in spec["tables"].values()})
    return spec, data["serialized_space"], columns, dropped


def test_every_count_star_kind_measure_binds_a_column_and_passes_the_genie_check(agent_ns):
    counted = [k for k in _kinds(agent_ns) if any(m.replace(" ", "").lower() in ("count(*)", "count(1)") for m in k["genie"]["measures"])]
    assert len(counted) == ROW_COUNT_KINDS
    for kind in counted:
        spec, space, columns, dropped = _kind_space(agent_ns, kind)
        assert dropped == [], kind["id"]
        measures = space["instructions"]["sql_snippets"]["measures"]
        row_count = [m for m in measures if m["display_name"] == f"{kind['label']}: count(*)"]
        assert len(row_count) == 1 and agent_ns["implement_sql_column_refs"](row_count[0]["sql"][0]), (kind["id"], row_count)
        problems = agent_ns["implement_genie_space_grounding"](space, columns, RESULT, _allowed(spec))
        assert not [p for p in problems if "names no column" in p or "measure" in p.lower()], (kind["id"], problems)


def test_a_kind_row_count_binds_to_the_first_table_that_has_columns(agent_ns):
    row_count = agent_ns["implement_kind_row_count"]
    assert row_count("count(*)", "entity") == "count(entity)" and row_count("COUNT( 1 )", "entity") == "count(entity)"
    assert row_count("count(*)", "") == ""
    spec = _spec(agent_ns, "forecast")
    spec["kind"] = dict(spec["kind"], genie=dict(spec["kind"]["genie"], measures=["count(*)"]))
    spec["tables"] = {suffix: dict(info, columns={}) for suffix, info in spec["tables"].items()}
    kept, dropped = agent_ns["implement_kind_measures"](spec, agent_ns["implement_genie_aliases"](_allowed(spec)))
    assert [m["sql"][0] for m in kept] == [f"count(`{agent_ns['implement_genie_aliases']([RESULT])[agent_ns['_implement_plain_table'](RESULT).lower()]}`.`{agent_ns['INSPIRE_CORE_COLUMNS'][0][0]}`)"] and dropped == []


def _snippet_problems(ns, sql, tables):
    real = {table: {"amount": ("amount", "double", ""), "record_key": ("record_key", "string", "")} for table in tables}
    aliases = {f"t{index}": table for index, table in enumerate(tables)}
    instructions = {"sql_snippets": {"measures": [{"alias": "m", "display_name": "A measure", "sql": [sql]}]}}
    return ns["_implement_genie_snippet_problems"](instructions, real, aliases)


def test_the_snippet_check_accepts_every_aggregate_shape_and_a_bare_row_count_over_one_table(agent_ns):
    one, two = ["main.s.a"], ["main.s.a", "main.s.b"]
    for sql in ("COUNT(*)", "count(1)", "COUNT(DISTINCT `t0`.`record_key`)", "COUNT_IF(`t0`.`amount` > 0)", "SUM(`t0`.`amount`)",
                "AVG(`t0`.`amount`) FILTER (WHERE `t0`.`amount` > 0)", "percentile_approx(`t0`.`amount`, 0.5)",
                "SUM(CASE WHEN `t0`.`amount` > 0 THEN 1 ELSE 0 END)", "MAX(`t0`.`amount` / NULLIF(`t0`.`amount`, 0))"):
        assert _snippet_problems(agent_ns, sql, one) == [], sql
    for sql in ("COUNT(*)", "count(1)"):
        assert _snippet_problems(agent_ns, sql, two) == [
            "the measure 'A measure' names no column: name each column as `table`.`column`, and count rows as "
            "COUNT(`table`.`key column`) so Genie knows which table it counts"], sql
    assert _snippet_problems(agent_ns, "SUM(1)", one) == ["the measure 'A measure' names no column: name each column as `table`.`column`"]
    assert _snippet_problems(agent_ns, "COUNT(*)", two)[0].startswith("the measure"), "a bare row count over two tables stays a problem"


def test_no_family_or_technique_tells_genie_to_process_only_rows_a_previous_run_left_unprocessed(agent_ns):
    texts = {f"family {family}": spec["pattern"] for family, spec in agent_ns["GENIE_FAMILY_SPECS"].items()}
    texts.update({f"technique {name}": text for name, text in agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"].items()})
    incremental = re.compile(r"watermark|newer than the latest|since the last run|already in the business output", re.IGNORECASE)
    assert [name for name, text in texts.items() if incremental.search(text)] == []
    assert "writes the same rows" in agent_ns["GENIE_FAMILY_SPECS"]["G"]["pattern"]
