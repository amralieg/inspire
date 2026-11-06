"""A change Genie made is put down to a data shortfall only when it is tied to that shortfall, and the shortfall it names is the one
the same build's readiness step measured, so the user never reads that Genie found 0 records when the build counted 61."""
from v206_genie_self_repair_test import _family, _FakeRunner, _fill, _flow_inspire, _spec

UC, KEY, PATH, NAMES = "N01-U01", (5150, "N01-U01", 1), "/W/nb", ["result_table", "run_profile"]
SHORT_ZERO = "History holds too few past examples of the outcome (0); at least 50 are needed to learn from."
FIELDS = ("what", "why", "method_was", "method_now", "setting", "value_was", "value_now")
LIVE = [
    {"setting": "min_positives", "value_was": "200", "value_now": "50",
     "why": "The readiness preview found 61 positives, so 200 would knowingly fail", "cause": "data_shortfall"},
    {"method_was": "Python g formatting", "method_now": "Numeric significant-figure rounding",
     "why": "the number helpers cell asks for significant figures", "cause": "rule"},
    {"method_was": "No grouping helper call", "method_now": "inspire_group_records before modeling",
     "why": "the grouping rule asks for the helper", "cause": "rule"},
    {"setting": "min_positives", "value_was": "50", "value_now": "0",
     "why": "The transparent rule requires no positive labels", "cause": "other"},
]
PLAIN = [
    "Genie set Minimum positive outcomes to 50, not 200: The readiness preview found 61 positives, so 200 would knowingly fail.",
    "Genie used Numeric significant-figure rounding instead of Python g formatting: the number helpers cell asks for significant figures.",
    "Genie used inspire_group_records before modeling instead of No grouping helper call: the grouping rule asks for the helper.",
    "Genie set Minimum positive outcomes to 0, not 50: The transparent rule requires no positive labels.",
]


def _change(**fields):
    return {**{name: "" for name in FIELDS}, "cause": "other", **fields}


def _short(ns, reason=SHORT_ZERO):
    return ns["implement_readiness_shortfall"](reason, "A")


def _with(changes, readiness=()):
    return dict(_fill(), changes=[_change(**c) for c in changes], readiness=list(readiness))


def test_the_four_live_notes_are_not_put_down_to_a_shortfall_the_same_build_measured_away(agent_ns):
    notes = agent_ns["implement_genie_change_notes"](_with(LIVE, [{"check": "positives", "measured": "61"}]), _short(agent_ns))
    assert notes == PLAIN
    assert not any(note.startswith("Genie found") for note in notes)


def test_changes_genie_did_not_tie_to_the_data_keep_the_plain_wording_even_while_the_data_is_short(agent_ns):
    notes = agent_ns["implement_genie_change_notes"](_with(LIVE[1:]), _short(agent_ns))
    assert notes == PLAIN[1:]


def test_a_shortfall_driven_method_change_still_tells_the_user_to_rebuild_after_more_history(agent_ns):
    short = _short(agent_ns, "History holds too few past examples of the outcome (11); at least 200 are needed to learn from.")
    fill = _with([{"method_was": "gradient boosted trees", "method_now": "a rules-based score", "why": "11 outcomes are too few",
                   "cause": "data_shortfall"}], [{"check": "positives", "measured": "11"}])
    assert agent_ns["implement_genie_change_notes"](fill, short) == [
        "Genie found 11 past examples of the outcome, fewer than the 200 the first method needs, so it used a rules-based score instead. "
        "Results will be less precise; Rebuild after more history arrives to use gradient boosted trees."]


def test_the_shortfall_takes_the_count_the_same_build_measured_when_it_is_still_short(agent_ns):
    fill = _with([{"setting": "min_positives", "value_was": "50", "value_now": "30", "why": "30 is what history holds",
                   "cause": "data_shortfall"}], [{"check": "`Positives`", "measured": "30"}])
    assert agent_ns["implement_genie_change_notes"](fill, _short(agent_ns)) == [
        "Genie found 30 past examples of the outcome, fewer than the 50 the setting asked for, so it set Minimum positive outcomes to 30, "
        "not 50: 30 is what history holds."]


def test_the_latest_round_that_measured_the_check_wins_over_an_earlier_one(agent_ns):
    early = _with([], [{"check": "positives", "measured": "0"}])
    late = _with([{"method_was": "gradient boosted trees", "method_now": "a rules-based score", "why": "w", "cause": "data_shortfall"}],
                 [{"check": "positives", "measured": "61"}])
    notes = agent_ns["implement_genie_change_notes"](late, _short(agent_ns), [early, late])
    assert notes == ["Genie used a rules-based score instead of gradient boosted trees: w."]
    assert agent_ns["implement_current_shortfall"](_short(agent_ns), [late, early])["observed"] == "0"
    assert agent_ns["implement_current_shortfall"](_short(agent_ns), [early, late]) == {}


def test_only_the_shortfall_setting_gets_the_shortfall_wording(agent_ns):
    fill = _with([{"setting": "min_outcome_windows", "value_was": "6", "value_now": "3", "why": "w", "cause": "data_shortfall"},
                  {"setting": "min_positives", "value_was": "50", "value_now": "0", "why": "v", "cause": "data_shortfall"}])
    assert agent_ns["implement_genie_change_notes"](fill, _short(agent_ns)) == [
        "Genie set Minimum closed outcome windows to 3, not 6: w.",
        "Genie found 0 past examples of the outcome, fewer than the 50 the setting asked for, so it set Minimum positive outcomes to 0, "
        "not 50: v."]


def test_a_shortfall_without_a_named_check_is_kept_as_measured(agent_ns):
    short = agent_ns["implement_readiness_shortfall"]("There were too few cases (12), at least 30 are needed")
    assert agent_ns["implement_current_shortfall"](short, [_with([], [{"check": "cases", "measured": "40"}])]) == short
    assert agent_ns["implement_current_shortfall"]({}, [_with([])]) == {}


def test_genie_is_asked_for_the_cause_of_every_change(agent_ns):
    causes = agent_ns["IMPLEMENT_GENIE_CHANGE_CAUSES"]
    item = agent_ns["GENIE_FILL_RESULT_SCHEMA"]["properties"]["changes"]["items"]
    assert "cause" in item["required"] and item["properties"]["cause"] == {"type": "string", "enum": list(causes)}
    assert set(causes) == {"data_shortfall", "rule", "other"}
    rule = agent_ns["IMPLEMENT_GENIE_CAUSE_RULE"]
    assert all(cause in rule for cause in causes)
    assert rule in agent_ns["IMPLEMENT_DATA_REPAIR"] and rule in agent_ns["IMPLEMENT_STOP_REPAIR"]
    assert rule in agent_ns["DatabricksInspire"]._IMPLEMENT_FILL_PROMPT


def test_a_build_that_measured_61_positives_after_inspire_counted_0_reports_plain_changes(agent_ns):
    inst = _family(_flow_inspire(agent_ns, [({"status": "written", "rows_written": 40}, 11, 101)]), "A")
    runner = _FakeRunner([{"exit": 0, "final": _with(LIVE, [{"check": "positives", "measured": "61"}])}])
    repaired, spec = {}, _spec(agent_ns)
    first = inst._implement_stop_repair(UC, {}, spec, {"family": "A"}, SHORT_ZERO, None, repaired, agent_ns["IMPLEMENT_DATA_REPAIR_BEFORE"])
    use_case = {"_implement_measured_short": {"feedback": first["feedback"], "short": first["short"], "repaired": repaired}}
    outcome, _job, _f = inst._implement_fill_and_preview(UC, KEY, use_case, spec, None, PATH, NAMES, runner, True)
    assert outcome["status"] == "written" and outcome["genie_changes"] == PLAIN
    assert "data_shortfall" in runner.prompts[0]
