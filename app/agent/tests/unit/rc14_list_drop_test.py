"""REQ-118 (rc14 L5), list level: a use case whose key measure has no rows and no measurable variant is left out of the
final list with a reason. A swapped measure rewrites the title and statement to the measure used and notes the swap.
A user-named or user-requested use case is never dropped or renamed."""
from unittest.mock import MagicMock

from v120_genie_support import build_inspire

NO_ROWS = "customer_segment = 'first-time buyers' matches no rows and no value close to it has rows"


def _kpi(name, computable=True, reason=None, swapped_from=None, value="first time buyers"):
    spec = {"name": name, "computable": computable, "filter_column": "customer_segment", "filter_value": value}
    if reason:
        spec["unmeasurable_reason"] = reason
    if swapped_from:
        spec["swapped_from"] = swapped_from
    return spec


def _uc(no, name, kpis, **extra):
    return dict({"No": no, "Name": name, "usecase": name, "Statement": f"Act on {name}.", "KPIs": kpis}, **extra)


def _inst(agent_ns, protected=()):
    inst = build_inspire(agent_ns)
    gate = MagicMock()
    inst._ai_gate = lambda: gate
    inst.gate = gate
    inst._user_protected_use_cases = lambda use_cases: {id(uc): "the instructions name it" for uc in use_cases if uc in protected}
    return inst


def test_a_use_case_whose_key_measure_has_no_rows_is_left_out_with_a_reason_in_the_summary(agent_ns):
    inst = _inst(agent_ns)
    gone = _uc("N03-U03", "Follow up with first-time buyers", [_kpi("open first-time buyers", computable=False, reason=NO_ROWS)])
    kept = _uc("N01-U01", "Win back lapsed passengers", [_kpi("lapsed passengers")])
    assert inst._drop_unmeasurable_use_cases([gone, kept]) == [kept]
    assert gone["selection_drop_reason"] == ("left out: Follow up with first-time buyers, its measure open first-time buyers has no rows")
    inst.gate.register.assert_called_once_with(gone["selection_drop_reason"])


def test_a_user_named_or_requested_use_case_is_never_left_out_and_a_non_row_problem_is_not_a_row_drop(agent_ns):
    requested = _uc("N02-U01", "Keep this", [_kpi("open first-time buyers", computable=False, reason=NO_ROWS)], user_request="r1")
    inst = _inst(agent_ns, protected=[requested])
    assert inst._drop_unmeasurable_use_cases([requested]) == [requested], "the user's request wins over the zero-row rule"
    other = _uc("N04-U01", "Not a row problem", [_kpi("margin", computable=False, reason="the formula needs a column")])
    assert inst._drop_unmeasurable_use_cases([other]) == [other], "only a zero-row measure is left out by this rule"


def test_a_swapped_measure_rewrites_the_title_and_statement_and_notes_the_swap(agent_ns):
    inst = _inst(agent_ns)
    swapped = _uc("N03-U03", "Follow up with first-time buyers", [_kpi("open first-time buyers", swapped_from="first-time buyers")],
                  Statement="Reach the first-time buyers who have not bought again.")
    named = _uc("N05-U01", "Our own name", [_kpi("open first-time buyers", swapped_from="first-time buyers")],
                user_named="Our own name", Statement="Reach the first-time buyers.")
    inst._apply_measure_swap_text([swapped, named])
    assert swapped["Name"] == swapped["usecase"] == "Follow up with first time buyers"
    assert swapped["Statement"] == "Reach the first time buyers who have not bought again."
    assert swapped["key_measure_note"] == "measured on first time buyers because first-time buyers has no rows"
    assert named["Name"] == "Our own name" and named["Statement"] == "Reach the first-time buyers.", "a renamed use case is never rewritten"
    assert "key_measure_note" not in named


def test_the_rewrite_keeps_the_text_and_the_swap_marks_what_it_replaced(agent_ns):
    rewrite = agent_ns["rewrite_swapped_measure"]
    assert rewrite("Follow up with First-Time Buyers", "first-time buyers", "first time buyers") == "Follow up with first time buyers"
    assert rewrite("Win back lapsed passengers", "first-time buyers", "first time buyers") == "Win back lapsed passengers"
    inst = _inst(agent_ns)

    class _Deep:
        def _read(self, kind, table, sql, args=None, budget="evidence", scopes=None):
            return [{"v": "first time buyers", "n": 7}]

        def measure_kpi(self, spec, scopes=None):
            return 7.0

    spec = _kpi("open first-time buyers", value="first-time buyers")
    spec["table"], spec["filter_column"] = "main.s.orders", "customer_segment"
    assert inst._key_measure_swap(spec, _Deep()) == 7.0
    assert spec["swapped_from"] == "first-time buyers", "the swap records the value it replaced"
