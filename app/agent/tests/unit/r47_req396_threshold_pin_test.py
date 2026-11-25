"""REQ-396: a repair may not change a minimum the person set, and every change Genie makes is named, never silent.

Live evidence (rc7, joined segmentation use case N02-U02): Genie set the per-entity minimum from 10 (or 20) to 1 and passed on rule-based
tiers. Ruling (coordinator, 2026-11-17): only a value the PERSON set is pinned, like the grouping, scope and measure (REQ-346): a change to
it is refused and the refusal says what Genie wanted. A family default that Genie lowers is allowed, and the build names it with the old and
new values (implement_genie_change_notes -> warnings). A method or technique change is allowed and named. Unparseable cells go back to Genie.
"""
import os
import sys

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)

from v203_kind_companion_gate_test import TABLE as SEG_TABLE, _gates  # noqa: E402
from v140_implement_test import _inspire  # noqa: E402
from v120_artifacts_support import FakeSpark  # noqa: E402

GROUPING = {"columns": ["city"], "one_model": False}
CORE = [{"name": "group_by", "default": "city"}, {"name": "min_entities_per_k", "default": "10"},
        {"name": "min_numeric_features", "default": "3"}, {"name": "min_join_coverage", "default": "0.8"}]
STATED = {"min_entities_per_k": 10, "min_numeric_features": 3, "min_join_coverage": 0.8}


def fill(widgets=(), changes=()):
    return {"status": "built", "changes": list(changes), "widgets": [{"name": n, "default": d} for n, d in widgets]}


def method_change(was, now):
    return {"what": "the segmentation method", "why": "the data is thin", "cause": "rule", "method_was": was, "method_now": now,
            "setting": "", "value_was": "", "value_now": ""}


def test_a_stated_threshold_is_pinned_next_to_the_grouping(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE, None, STATED)
    assert pinned == {"group_by": "city", "min_entities_per_k": 10, "min_numeric_features": 3, "min_join_coverage": 0.8}, pinned


def test_a_threshold_loosened_by_a_repair_is_refused_and_named(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE, None, STATED)
    moved = agent_ns["implement_choice_changes"]([fill([("min_entities_per_k", "1")])], pinned)
    assert moved == ["the threshold min_entities_per_k from 10 to 1"], moved


def test_the_refusal_says_what_genie_wanted_to_change_and_that_the_threshold_is_kept(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE, None, STATED)
    moved = agent_ns["implement_choice_changes"]([fill([("min_entities_per_k", "1")])], pinned)
    text = agent_ns["implement_choice_refusal"](GROUPING, moved)
    assert text == ("could not keep the thresholds you set: a repair tried to change them (the threshold min_entities_per_k from 10 to 1), "
                    "and Inspire keeps every threshold the use case states; change the threshold on the Use case page, then build again"), text


def test_a_threshold_kept_at_its_stated_value_in_any_number_form_is_not_refused(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE, None, STATED)
    kept = fill([("min_entities_per_k", "10.0"), ("min_numeric_features", "3"), ("min_join_coverage", "0.80")])
    assert agent_ns["implement_choice_changes"]([kept], pinned) == [], "the same number, written another way, is not a change (must-keep)"


def test_a_threshold_the_use_case_leaves_empty_is_not_pinned_so_genie_may_fill_it(agent_ns):
    pinned = agent_ns["implement_choice_pinned"]([{"name": "min_rows", "default": ""}], None, {"min_rows": None, "min_join_coverage": ""})
    assert pinned == {}, "an empty stated threshold is for Genie to fill (must-exclude)"
    assert agent_ns["implement_choice_changes"]([fill([("min_rows", "5")])], pinned) == []


def test_a_method_change_and_a_grouping_change_keep_their_req346_behaviour(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE, None, STATED)
    method = method_change("KMeans segmentation with quantile fallback", "Rule-based spend-gap tiers")
    assert agent_ns["implement_choice_changes"]([fill(changes=[method], widgets=[("min_entities_per_k", "10")])], pinned) == [], \
        "a method change passes under REQ-346 (must-pass)"
    moved = agent_ns["implement_choice_changes"]([fill([("group_by", "all"), ("min_entities_per_k", "1")])], pinned)
    assert len(moved) == 2, moved
    assert agent_ns["implement_choice_refusal"](GROUPING, moved).startswith("could not group by city: a repair tried to change it"), moved


def test_a_scope_or_measure_only_pin_set_is_unchanged_by_the_threshold_pins(agent_ns):
    pinned = agent_ns["implement_choice_pinned"]([{"name": "currency", "default": "USD"}], None)
    assert pinned == {"currency": "USD"}, "no thresholds passed, so only the REQ-346 choices are pinned (must-exclude)"


def test_numbers_are_compared_as_numbers_and_text_as_text(agent_ns):
    same = agent_ns["implement_choice_same"]
    assert same("0.80", 0.8) and same("1", 1.0) and same("ALL", "all"), "equal numbers and equal text are the same choice"
    assert not same("1", "2") and not same("recent", "all"), "different values are a change (must-fail)"


# REQ-396, item 1: the preview gate and the App publish step must agree on a companion table the run honestly skipped. Segmentation
# (rc7 N02-U02): __migration counts the members that moved since the previous assignment, so the first run has no rows to write and
# its page layout (segment_explorer) needs only __segments. A skip the run printed must not send Genie back to write it.

SEG = {"result_table": SEG_TABLE, "use_case_kind": "segmentation"}
SEG_SEGMENTS = ["segment_id", "label", "size", "value", "profile"]
SEG_ASSIGN = ["entity", "segment", "x", "y"]
SEG_MIGRATION_WHY = "there is no earlier assignment to compare with"


def test_a_skipped_companion_the_layout_does_not_need_is_not_sent_back_to_genie(agent_ns):
    tables = {f"{SEG_TABLE}__segments": SEG_SEGMENTS, f"{SEG_TABLE}__assign": SEG_ASSIGN}
    skips = {"__migration": SEG_MIGRATION_WHY}
    assert _gates(agent_ns, tables, SEG, skips) == [], "a printed skip for a table the layout can do without passes the gate (must-pass)"


def test_a_skipped_companion_the_layout_needs_is_still_sent_back(agent_ns):
    tables = {f"{SEG_TABLE}__assign": SEG_ASSIGN, f"{SEG_TABLE}__migration": ["from_segment", "to_segment", "count"]}
    [gate] = _gates(agent_ns, tables, SEG, {"__segments": "fewer than 3 segments"})
    assert gate["problems"] == [f"run r-1 did not write the companion tables its page draws: {SEG_TABLE}__segments does not exist "
                                "(the run printed: fewer than 3 segments)"], gate["problems"]


def test_a_missing_companion_without_a_printed_skip_is_still_sent_back_and_the_skipped_one_is_not_named(agent_ns):
    tables = {f"{SEG_TABLE}__segments": SEG_SEGMENTS}
    [gate] = _gates(agent_ns, tables, SEG, {"__migration": SEG_MIGRATION_WHY})
    assert gate["problems"] == [f"run r-1 did not write the companion tables its page draws: {SEG_TABLE}__assign does not exist"], \
        gate["problems"]
    assert f"{SEG_TABLE}__assign:" in gate["feedback"] and f"{SEG_TABLE}__migration:" not in gate["feedback"], \
        "Genie is told the columns of the table it must write, never of the skipped one (must-keep)"


def test_a_skip_for_a_table_the_run_did_write_changes_nothing(agent_ns):
    tables = {f"{SEG_TABLE}__segments": SEG_SEGMENTS, f"{SEG_TABLE}__assign": SEG_ASSIGN,
              f"{SEG_TABLE}__migration": ["from_segment", "to_segment", "count"]}
    assert _gates(agent_ns, tables, SEG, {"__migration": "not needed"}) == [], "a written table passes with or without a skip (must-keep)"


def test_the_left_out_helper_keeps_every_missing_table_the_layout_needs(agent_ns):
    left_out = agent_ns["implement_skipped_companions_left_out"]
    missing = {f"{SEG_TABLE}__segments": "does not exist", f"{SEG_TABLE}__migration": "does not exist"}
    assert left_out(missing, SEG_TABLE, {"__segments": "x", "__migration": "y"}, "segment_explorer") == \
        {f"{SEG_TABLE}__segments": "does not exist"}, "the layout's required companion stays in the gate (must-fail)"
    assert left_out(missing, SEG_TABLE, None, "segment_explorer") == missing, "no printed skip, no exemption (must-keep)"



# REQ-396 follow-up: only the person's own minimums are pinned; a family default is named, not refused.
def test_only_a_minimum_the_person_set_is_user_input(agent_ns):
    pick = agent_ns["implement_user_thresholds"]
    assert pick(STATED, {"min_entities_per_k": "10"}) == {"min_entities_per_k": 10}, "a family default is not user input (must-exclude)"
    assert pick(STATED, None) == {} and pick(None, {"min_entities_per_k": "10"}) == {}


def test_a_family_default_lowered_by_a_repair_is_not_refused_and_is_named_with_both_values(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE, None, agent_ns["implement_user_thresholds"](STATED, {}))
    assert "min_entities_per_k" not in pinned, pinned
    lowered = {"what": "", "why": "no segment has 10 entities", "cause": "data_shortfall", "method_was": "", "method_now": "",
               "setting": "min_entities_per_k", "value_was": "10", "value_now": "1"}
    assert agent_ns["implement_choice_changes"]([fill(changes=[lowered], widgets=[("min_entities_per_k", "1")])], pinned) == [], \
        "a family default may be lowered (must-pass)"
    notes = agent_ns["implement_genie_change_notes"](fill(changes=[lowered]), None)
    assert notes == ["Genie set Minimum entities per segment to 1, not 10: no segment has 10 entities."], notes


def test_a_user_set_minimum_lowered_by_a_repair_is_refused_not_just_named(agent_ns):
    pinned = agent_ns["implement_choice_pinned"](CORE, None, agent_ns["implement_user_thresholds"](STATED, {"min_entities_per_k": "10"}))
    moved = agent_ns["implement_choice_changes"]([fill([("min_entities_per_k", "1")])], pinned)
    assert moved == ["the threshold min_entities_per_k from 10 to 1"], moved


def test_a_method_change_with_an_inspire_rule_cause_is_named_not_silent(agent_ns):
    method = {"what": "the segmentation method", "why": "the grouping rule asks for it", "cause": "rule",
              "method_was": "KMeans segmentation", "method_now": "Rule-based spend-gap tiers", "setting": "", "value_was": "", "value_now": ""}
    assert agent_ns["implement_genie_change_notes"](fill(changes=[method]), None) == [
        "Genie used Rule-based spend-gap tiers instead of KMeans segmentation: the grouping rule asks for it. "
        "This follows Inspire's rules, so there is nothing to fix."]  # RC3-03 (4f1ef7115) rule-cause suffix


APPLIES = dict(GROUPING, applies=True)  # the guard reads only a use case whose Grouping applies


# REQ-396 item 2: group_by must be set in a scope the call can see; the guard names the call and the fix.
GROUP_OK = ('def _fit_step(records):\n'
            '    group_by = dbutils.widgets.get("group_by")\n'
            '    records = inspire_group_records(records, group_by=group_by)\n'
            '    return records.groupby("inspire_group").size()\n')
GROUP_SHARED_BY_ANOTHER_FUNCTION = ('def _fit_step(records):\n'
                                    '    group_by = dbutils.widgets.get("group_by")\n'
                                    '    return records\n'
                                    '\n'
                                    'def _score_step(scoring):\n'
                                    '    grouped = inspire_group_records(scoring, group_by=group_by)\n'
                                    '    return grouped.groupby("inspire_group").size()\n')
GROUP_WIDGET_READ_INLINE = ('def _score_step(scoring):\n'
                            '    grouped = inspire_group_records(scoring, group_by=dbutils.widgets.get("group_by"))\n'
                            '    return grouped.groupby("inspire_group").size()\n')
GROUP_MODULE_LEVEL = ('group_by = dbutils.widgets.get("group_by")\n'
                      'def _score_step(scoring):\n'
                      '    return inspire_group_records(scoring, group_by=group_by).groupby("inspire_group").size()\n')


def test_a_group_by_set_in_the_same_function_passes(agent_ns):
    assert agent_ns["implement_grouping_problems"]([("cell 2", GROUP_OK)], APPLIES) == [], "set where the call reads it (must-pass)"


def test_a_group_by_set_only_in_another_function_is_named_with_the_line(agent_ns):
    problems = agent_ns["implement_grouping_problems"]([("cell 2", GROUP_SHARED_BY_ANOTHER_FUNCTION)], APPLIES)
    assert problems == ['cell 2 line 6 calls inspire_group_records with the group_by variable, but the function around the call never sets it: '
                        'inside that function read the group_by widget into the variable, `group_by = dbutils.widgets.get("group_by")`, then '
                        'pass group_by=group_by; a variable set in another function is not visible there'], problems


def test_an_inline_widget_read_is_still_named_as_unread(agent_ns):
    problems = agent_ns["implement_grouping_problems"]([("cell 3", GROUP_WIDGET_READ_INLINE)], APPLIES)
    assert len(problems) == 1 and problems[0].startswith("cell 3 line 2 calls inspire_group_records without the group_by variable"), problems
    assert "inside the function that makes the call, read the widget into the variable first" in problems[0], problems


def test_a_module_level_group_by_is_visible_to_every_function(agent_ns):
    assert agent_ns["implement_grouping_problems"]([("cell 2", GROUP_MODULE_LEVEL)], APPLIES) == [], "module scope is shared (must-keep)"


# REQ-396 side finding: a cell that does not parse is a problem sent back to Genie, not a silent skip.
def test_an_unparseable_python_cell_is_named_with_its_line(agent_ns):
    problems = agent_ns["implement_unparseable_cell_problems"]([("cell 2", "x = 1\ndef f(:\n    pass\n")])
    assert len(problems) == 1 and problems[0].startswith("cell 2 line 2 does not parse as Python ("), problems
    assert problems[0].endswith("so Inspire cannot check the rest of the cell: fix the syntax at that line"), problems


def test_sql_markdown_and_pip_cells_are_not_parsed_as_python(agent_ns):
    cells = [("cell 3", "%sql\nSELECT 1 FROM\n"), ("cell 4", "%md\n# title (not python)\n"), ("cell 5", "%pip install x\nx = 1\n")]
    assert agent_ns["implement_unparseable_cell_problems"](cells) == [], "non-Python magics and valid Python with a magic line pass (must-keep)"


def test_the_cell_gate_reports_an_unparseable_cell_before_any_other_check(agent_ns):
    inst = _inspire(agent_ns, FakeSpark(responder=lambda statement: []))
    inst._implement_genie_cells = lambda path, purpose: [("cell 2", "def f(:\n    pass\n")]
    problems = inst._implement_cell_problems("/W/nb")
    assert problems and problems[0].startswith("cell 2 line 1 does not parse as Python"), problems


def test_a_rule_caused_technique_change_reaches_the_build_outcome_as_a_named_change(agent_ns):
    # REQ-396 ruling: a technique change is allowed and named. The outcome's genie_changes feed the build warnings
    # (implement_build warnings += "Notebook: <note>" for each note).
    from v206_genie_self_repair_test import _adapted, _family, _FakeRunner, _flow_inspire, _run
    inst = _family(_flow_inspire(agent_ns, [({"status": "written", "rows_written": 40}, 11, 101)]), "D")
    change = _adapted(method_was="KMeans segmentation", method_now="Rule-based spend-gap tiers",
                      why="the grouping rule asks for it", cause="rule")
    runner = _FakeRunner([{"exit": 0, "final": change}])
    outcome, _job, _fill_out = _run(agent_ns, inst, runner)
    assert outcome["status"] == "written"
    assert outcome["genie_changes"] == ["Genie used Rule-based spend-gap tiers instead of KMeans segmentation: the grouping rule asks for it. "
        "This follows Inspire's rules, so there is nothing to fix."]  # RC3-03 (4f1ef7115) rule-cause suffix
