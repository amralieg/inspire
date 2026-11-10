"""A driver breakdown use case keeps its decision list: its page takes the decision layout, and a missing companion view is left out, not the list."""
from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire
from v200_kinds_artifacts_test import RESULT


def test_a_driver_breakdown_use_case_takes_its_decision_layout_even_when_it_was_stored_as_the_dashboard(agent_ns):
    kind = agent_ns["_inspire_kind"]("driver_breakdown")
    assert kind["layout"] == "dashboard" and kind["decision_layout"] == "performance_explainer"
    assert agent_ns["implement_app_layout"]({"use_case_kind": "driver_breakdown"})[0] == "performance_explainer"
    assert agent_ns["implement_app_layout"]({"use_case_kind": "driver_breakdown", "app_layout": "dashboard"})[0] == "performance_explainer"
    assert agent_ns["implement_app_layout"]({"use_case_kind": "driver_breakdown", "app_layout": "planner"})[0] == "planner"


def test_a_decision_layout_with_missing_companion_views_keeps_its_decision_list_and_drops_only_those_views(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    warnings = []
    use_case = {"use_case_kind": "driver_breakdown", "app_layout": "dashboard"}
    layout, tables = inst._implement_app_layout("N04-U05", use_case, {}, RESULT, warnings, lambda table: None)
    assert layout == "performance_explainer", "the decision list is kept even though no companion view table exists"
    assert tables == {}
    assert any("keeps its decision list" in text for text in warnings)


def test_a_layout_without_a_decision_list_still_falls_back_to_the_dashboard_when_its_tables_are_missing(agent_ns):
    inst = _inspire(agent_ns, FakeSpark())
    layout, tables = inst._implement_app_layout("N01-U01", {"use_case_kind": "forecast"}, {}, RESULT, [], lambda table: None)
    assert layout == agent_ns["INSPIRE_DEFAULT_LAYOUT"] and tables == {}
