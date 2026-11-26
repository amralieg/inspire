"""RC6-D-02 / RC6-D-03 (rc.6 walk, T-VIB-02): the vibe ask check counts asks that were done and gives plain reasons for the rest.

D-03  a column ask matches a written column after case, underscores, spaces and camelCase are normalized; a note (text block) ask at the top
      of a page is met by a text block at the top, whatever page name the ask carries.
D-02  an unmet ask's reason is one plain sentence (no kind, place or block); a method change that follows Inspire's rules is information,
      not a warning.
"""
import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire
from v164_vibe_checklist_test import _ask, _judge

ASSET = "app:page:n01_u01"
PAGE = {"id": "n01_u01", "title": "Sales desk", "question": "Which items sell best?", "hue": "teal",
        "records": {"title": "Fix plan", "key": "record_key", "label": "entity_label", "rank": "rank", "tier": "priority_tier",
                    "columns": [{"column": "paymentMethod", "label": "paymentMethod"}]},
        "blocks": [{"id": "shift_note", "kind": "text", "place": {"where": "top"}, "width": "full", "align": "left",
                    "content": "Revenue moved this month."}]}
BARE = {"id": "n01_u01", "title": "Sales desk", "question": "Which items sell best?", "hue": "teal",
        "records": {"title": "Fix plan", "key": "record_key", "label": "entity_label", "rank": "rank", "tier": "priority_tier",
                    "columns": [{"column": "channel", "label": "Channel"}]}, "blocks": []}


def _check(agent_ns, ask, check, page):
    inst = _inspire(agent_ns, FakeSpark())
    _judge(inst, {ask: [_ask(ask, check)]}, [{"status": "done", "evidence": "x"}])
    return inst._implement_vibes_checks({}, ASSET, ask, page)[0]


def test_a_column_ask_is_met_by_the_same_column_in_another_spelling(agent_ns):
    found = _check(agent_ns, "Add a column for payment method", {"kind": "column", "value": "payment_method"}, PAGE)
    assert found["status"] == "done", found


def test_a_note_ask_at_the_top_of_a_page_is_met_by_a_text_block_at_the_top(agent_ns):
    ask = "Add a plain note at the top of the home page"
    found = _check(agent_ns, ask, {"kind": "block", "value": {"kind": "text", "place": "top", "of": "home page"}}, PAGE)
    assert found["status"] == "done", found


def test_a_note_ask_still_fails_when_no_text_block_is_there(agent_ns):
    ask = "Add a plain note at the top of the home page"
    found = _check(agent_ns, ask, {"kind": "block", "value": {"kind": "text", "place": "top", "of": "home page"}}, BARE)
    assert found["status"] == "missing"


def test_a_truly_missing_column_stays_unmet_and_its_reason_is_plain(agent_ns):
    found = _check(agent_ns, "Add a column for refund reason", {"kind": "column", "value": "refund_reason"}, BARE)
    assert found["status"] == "missing"
    reason = agent_ns["implement_plain_reason"](found["evidence"])
    assert "refund reason" in reason.lower(), reason
    assert not {"kind", "place", "block"} & set(reason.lower().replace(",", " ").replace(";", " ").split()), reason
    assert "names no column" not in reason


def test_a_missing_note_reason_is_plain_too(agent_ns):
    found = _check(agent_ns, "Add a plain note at the top of the home page",
                   {"kind": "block", "value": {"kind": "text", "place": "top", "of": "home page"}}, BARE)
    reason = agent_ns["implement_plain_reason"](found["evidence"])
    assert "note" in reason and not {"kind", "place", "block", "blocks"} & set(reason.lower().replace(",", " ").replace(";", " ").split()), reason


def test_the_person_checklist_and_warnings_show_the_plain_reason(agent_ns):
    raw = "the built App page Sales desk names no column refund_reason"
    assert "refund reason" in agent_ns["implement_checklist_texts"](raw)["evidence"].lower()
    assert "names no column" not in agent_ns["implement_checklist_texts"](raw)["evidence"]
    [warning] = agent_ns["implement_vibes_warnings"](ASSET, [{"ask": "Add it", "status": "missing", "evidence": raw}], 3)
    assert "names no column" not in warning and "refund reason" in warning.lower(), warning


def test_used_x_instead_of_y_notes_that_follow_the_rules_are_information_not_warnings(agent_ns):
    rule = ("Genie used model B instead of model A. This follows Inspire's rules, so there is nothing to fix.")
    other = "Genie used model B instead of model A: the data is small."
    warnings, info = agent_ns["implement_genie_note_split"]([rule, other])
    assert warnings == [other] and info == [rule]
    assert agent_ns["implement_genie_note_split"]([]) == ([], [])
