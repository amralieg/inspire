import copy

from v140_implement_test import _app_shell, _churn_page
from v142_dash_test import RESULT

KIND_CHOICES = [{"id": "merge", "label": "Merge", "status": "Done"},
                {"id": "review_later", "label": "Review later", "status": "In progress"},
                {"id": "not_duplicate", "label": "Not a duplicate", "status": "Dismissed", "reasons": ["Data error"]}]
PAGE_CHOICES = [{"id": "block", "label": "Block", "status": "Done"},
                {"id": "investigate", "label": "Investigate", "status": "In progress"},
                {"id": "not_ring", "label": "Not a ring", "status": "Dismissed", "reasons": ["Known partner"]}]


def _with_choices(ns, choices):
    raw = _churn_page(ns)
    raw["records"] = dict(raw["records"], choices=copy.deepcopy(choices))
    return raw


def test_a_vibe_that_adds_a_column_keeps_the_record_choices_the_page_already_carries(agent_ns, tmp_path):
    shell_sql = _app_shell(agent_ns, tmp_path)[1]["shell_sql"]
    raw = _with_choices(agent_ns, PAGE_CHOICES)
    raw["records"]["columns"] = list(raw["records"].get("columns") or []) + [{"column": "loyalty_tier", "label": "Loyalty tier"}]
    page = agent_ns["implement_app_page"](raw, "N01-U01", {}, RESULT, choices=KIND_CHOICES)
    assert [c["id"] for c in page["records"]["choices"]] == ["block", "investigate", "not_ring"]
    problems = agent_ns["implement_app_page_problems"](page, shell_sql, [RESULT, "main.s.orders"], False, stored=["block"])
    assert not [p for p in problems if "choice" in p], problems


def test_a_page_without_choices_still_takes_the_kind_choices(agent_ns, tmp_path):
    raw = _churn_page(agent_ns)
    raw["records"] = {k: v for k, v in raw["records"].items() if k != "choices"}
    page = agent_ns["implement_app_page"](raw, "N01-U01", {}, RESULT, choices=KIND_CHOICES)
    assert [c["id"] for c in page["records"]["choices"]] == ["merge", "review_later", "not_duplicate"]


def test_dropping_a_choice_the_records_carry_is_still_caught_when_the_vibe_did_not_ask_for_it(agent_ns, tmp_path):
    shell_sql = _app_shell(agent_ns, tmp_path)[1]["shell_sql"]
    dropped = _with_choices(agent_ns, PAGE_CHOICES[1:])
    page = agent_ns["implement_app_page"](dropped, "N01-U01", {}, RESULT, choices=KIND_CHOICES)
    problems = agent_ns["implement_app_page_problems"](page, shell_sql, [RESULT, "main.s.orders"], False, stored=["block"])
    assert any("drop block" in p for p in problems), problems
