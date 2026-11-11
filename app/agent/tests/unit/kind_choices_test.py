import json
from pathlib import Path

import pytest

import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from _agentload import load_agent_namespace  # noqa: E402

from v141_app_shell_test import shell_sql  # noqa: E402

APP_SHELL = Path(__file__).resolve().parents[2] / "agent" / "app_shell"
FRAUD_WORDS = {"Block", "Investigate", "Not a ring"}


@pytest.fixture
def ns():
    return load_agent_namespace()


def _kinds():
    return {k["id"]: k for k in json.loads((APP_SHELL / "kinds.json").read_text(encoding="utf-8"))["kinds"]}


def _labels(choices):
    return {c["label"] for c in choices}


def test_entity_matching_and_network_dependency_offer_their_own_words(ns):
    kinds = _kinds()
    for kind_id in ("entity_matching", "network_dependency"):
        choices = kinds[kind_id].get("choices")
        assert choices, f"{kind_id} has no choices of its own"
        assert not (_labels(choices) & FRAUD_WORDS), f"{kind_id} offers fraud words {_labels(choices) & FRAUD_WORDS}"
        assert shell_sql.choice_problems({"records": {"choices": choices}}) == [], kind_id


def test_duplicate_choices_read_as_duplicate_decisions(ns):
    labels = _labels(_kinds()["entity_matching"]["choices"])
    assert labels == {"Merge", "Needs review", "Keep separate"}


def test_generated_page_carries_its_kind_choices(ns):
    choices = _kinds()["entity_matching"]["choices"]
    page = {"records": {"title": "Merge candidates", "label": "entity_label"}, "layout": "network_explorer"}
    out = ns["implement_app_page"](page, "N06-U02", {}, "main.master.accounts_out", None, None, "", "network_explorer", choices)
    assert [c["id"] for c in out["records"]["choices"]] == ["merge", "review_later", "not_duplicate"]
    assert out["records"]["title"] == "Merge candidates"
    assert page["records"].get("choices") is None, "the caller's page is not changed"


def test_a_page_without_kind_choices_keeps_the_layout_choices(ns):
    page = {"records": {"title": "Risk rings"}, "layout": "network_explorer"}
    out = ns["implement_app_page"](page, "N05-U01", {}, "main.risk.ring_out", None, None, "", "network_explorer", None)
    assert "choices" not in out["records"]


def test_generated_entity_page_names_its_undo_as_unmerge(ns):
    kind = _kinds()["entity_matching"]
    assert kind["undo_label"] == "Unmerge"
    page = {"records": {"title": "Merge candidates", "label": "entity_label"}, "layout": "network_explorer"}
    out = ns["implement_app_page"](page, "N06-U02", {}, "main.master.accounts_out", None, None, "", "network_explorer", kind["choices"],
                                   undo=kind["undo_label"])
    assert out["records"]["undo"] == "Unmerge"
    plain = ns["implement_app_page"](page, "N05-U01", {}, "main.risk.ring_out", None, None, "", "network_explorer", None)
    assert "undo" not in plain["records"], "a page whose kind names no undo word keeps the generic Undo"


def test_undo_word_is_checked_as_a_short_text(ns):
    records = {"title": "Merge candidates", "label": "entity_label", "key": "entity_id", "rank": "rank",
               "columns": [{"column": "centrality", "label": "Match strength", "format": "number"}], "detail": []}
    base = shell_sql._records_problems(records, True)
    assert shell_sql._records_problems(dict(records, undo="Unmerge"), True) == base
    assert any("undo" in p for p in shell_sql._records_problems(dict(records, undo="x" * 200), True))


def test_generated_entity_page_names_its_group_action(ns):
    kind = _kinds()["entity_matching"]
    assert kind["group"] == {"column": "community", "choice": "merge", "label": "Merge group", "undo": "Unmerge group"}
    page = {"records": {"title": "Merge candidates", "label": "entity_label"}, "layout": "network_explorer"}
    out = ns["implement_app_page"](page, "N06-U02", {}, "main.master.accounts_out", None, None, "", "network_explorer", kind["choices"],
                                   undo=kind["undo_label"], group=kind["group"])
    assert out["records"]["group"] == kind["group"]
    plain = ns["implement_app_page"](page, "N05-U01", {}, "main.risk.ring_out", None, None, "", "network_explorer", None)
    assert "group" not in plain["records"]


def test_group_config_must_name_a_column_a_choice_and_its_words(ns):
    records = {"title": "Merge candidates", "label": "entity_label", "key": "entity_id", "rank": "rank",
               "columns": [{"column": "centrality", "label": "Match strength", "format": "number"}], "detail": []}
    base = shell_sql._records_problems(records, True)
    good = {"column": "community", "choice": "merge", "label": "Merge group", "undo": "Unmerge group"}
    assert shell_sql._records_problems(dict(records, group=good), True) == base
    assert shell_sql._records_problems(dict(records, group=dict(good, choice="")), True)
    assert shell_sql._records_problems(dict(records, group=dict(good, column="")), True)
    assert shell_sql._records_problems(dict(records, group="community"), True)
