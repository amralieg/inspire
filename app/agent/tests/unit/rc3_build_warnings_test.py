"""RC3-03 (rc3 live walk, build run 799370920396931, N01-U01 on the bakehouse sample): the build ended "MVP READY WITH WARNINGS" with
8 warnings. Three classes are fixed here, offline through the notebook namespace and the App shell's shell_sql:

W1/W2  group_by and run_scope are Inspire's own choice settings (IMPLEMENT_CHOICE_KINDS), not numeric widgets. When they are not in
       _genie_core_widgets (run_scope never is; group_by only when the grouping applies), normalize_genie_fill_widgets reads Genie's
       "allowed" text ("product", "records") as a numeric range form, finds none, and sends Genie a repair it cannot satisfy; the last
       round leaves it "unfixed" and it lands as a warning.
W3-W6  a method change Genie made because an Inspire rule asked for it (cause "rule") is named as a warning (REQ-396 ruling, kept), but
       it reads as a deviation with nothing for the person to do. The note must say it follows Inspire's rules and that there is
       nothing to fix. (The [GENIE-RULE-METHODS FIRED] log line also says these are "kept out of the build's warnings", which is false.)
W7/W8  the row-minimum note for a page whose data holds fewer records than the layout's minimum is correct behaviour on a small sample,
       but it reads in internal words ("the variance_table section of a performance_explainer page is meant to show at least 10 rows,
       and the decision list shows 3") and does not say there is nothing to fix.
"""
import os
import sys

TESTS = os.path.dirname(os.path.abspath(__file__))
if TESTS not in sys.path:
    sys.path.insert(0, TESTS)
ROOT = os.path.dirname(os.path.dirname(TESTS))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_sql  # noqa: E402
from v206_genie_self_repair_test import _fill  # noqa: E402

FIELDS = ("what", "why", "method_was", "method_now", "setting", "value_was", "value_now")
RANGE_PROBLEM = "has an allowed range Inspire cannot read"


# ---- W1/W2: Inspire's choice settings are never read as numeric ranges ----

def test_rc3_w1_w2_must_fail_choice_settings_are_not_sent_back_as_unreadable_ranges(agent_ns):
    # The live fill: Genie listed group_by (default product) and run_scope (default records) with their value as the allowed text.
    fill = dict(_fill(), widgets=[{"name": "group_by", "type": "text", "default": "product", "choices": [], "allowed": "product", "label": "Group by"},
                                  {"name": "run_scope", "type": "text", "default": "records", "choices": [], "allowed": "records", "label": "First run"}])
    problems = agent_ns["normalize_genie_fill_widgets"](fill, [])
    assert not [p for p in problems if RANGE_PROBLEM in p], problems
    for widget in fill["widgets"]:
        assert widget["allowed"] != widget["default"], f"{widget['name']}: the value text is not kept as a range form"


def test_rc3_w1_w2_must_fail_every_inspire_choice_setting_is_covered(agent_ns):
    # Class: every name in IMPLEMENT_CHOICE_KINDS that is a text choice (grouping and scope), not only the two seen live.
    names = [n for n, kind in agent_ns["IMPLEMENT_CHOICE_KINDS"].items() if kind in ("grouping", "scope")]
    assert {"group_by", "run_scope", "scope_groups"} <= set(names)
    fill = dict(_fill(), widgets=[{"name": n, "type": "text", "default": "x", "choices": [], "allowed": "some words", "label": n} for n in names])
    problems = agent_ns["normalize_genie_fill_widgets"](fill, [])
    assert not [p for p in problems if RANGE_PROBLEM in p], problems


def test_rc3_w1_w2_must_keep_a_genie_numeric_widget_with_an_unreadable_range_is_still_sent_back(agent_ns):
    fill = dict(_fill(), widgets=[{"name": "min_line_move", "type": "text", "default": "0.25", "choices": [], "allowed": "0 to 1, or empty", "label": "m"},
                                  {"name": "run_scope", "type": "text", "default": "records", "choices": [], "allowed": "records", "label": "First run"}])
    problems = agent_ns["normalize_genie_fill_widgets"](fill, [])
    assert [p for p in problems if RANGE_PROBLEM in p and "widget min_line_move" in p], problems


# ---- W3-W6: a rule-caused method change reads as information ----

def _rule_fill(cause, why="All reads must honor Inspire's selected run scope"):
    change = {**{f: "" for f in FIELDS}, "method_was": "Direct Spark table reads", "method_now": "One literal inspire_read_source call",
              "why": why, "cause": cause}
    return dict(_fill(), changes=[change])


def test_rc3_w3_w6_must_fail_a_rule_caused_method_change_says_it_follows_inspire_rules_and_needs_no_fix(agent_ns):
    [note] = agent_ns["implement_genie_change_notes"](_rule_fill("rule"))
    assert note.startswith("Genie used One literal inspire_read_source call instead of Direct Spark table reads"), note  # REQ-396 kept
    assert "Inspire's rules" in note and "nothing to fix" in note, note


def test_rc3_w3_w6_must_fail_the_rule_note_is_kept_when_genie_s_reason_is_dropped(agent_ns):
    # The why text that names the person is dropped by the filter; the information sentence still tells the person why and what to do.
    [note] = agent_ns["implement_genie_change_notes"](_rule_fill("rule", why="the user asked for scoped reads"))
    assert "Inspire's rules" in note and "nothing to fix" in note, note


def test_rc3_w3_w6_must_keep_a_change_genie_chose_itself_is_not_called_an_inspire_rule(agent_ns):
    [note] = agent_ns["implement_genie_change_notes"](_rule_fill("other"))
    assert note == "Genie used One literal inspire_read_source call instead of Direct Spark table reads: All reads must honor Inspire's selected run scope."
    assert "Inspire's rules" not in note


# ---- W7/W8: the small-data row note says why and that nothing is missing ----

def _explainer():
    return {"id": "p1", "layout": "performance_explainer", "records": {"key": "record_key"}}


def _variance_minimum():
    found = [(s, low, src) for s, low, src in shell_sql.row_minimums(_explainer()) if s == "variance_table"]
    assert found, "performance_explainer has a variance_table row minimum"
    return found[0]


def test_rc3_w7_w8_must_fail_the_small_data_note_reads_in_plain_words_and_says_nothing_to_fix():
    section, low, source = _variance_minimum()
    problems, notes = shell_sql.row_shortfalls(_explainer(), {source: 3}, {source: 3})
    assert problems == [] and len(notes) == 1, (problems, notes)
    note = notes[0]
    assert "every record the data holds" in note and "nothing to fix" in note, note
    for internal in ("variance_table", "performance_explainer", "section of a", "decision list", "is meant to show"):
        assert internal not in note, f"internal word {internal!r} in: {note}"
    assert " 3 " in f" {note} " and shell_sql.shown_number(low) in note, note


def test_rc3_w7_w8_must_keep_a_real_shortfall_is_still_a_problem_not_a_note():
    section, low, source = _variance_minimum()
    problems, notes = shell_sql.row_shortfalls(_explainer(), {source: 3}, {source: 40})
    assert notes == [] and len(problems) == 1 and "widen what it selects" in problems[0], (problems, notes)
