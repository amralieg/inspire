import json
import re
from pathlib import Path

import pytest

NOTEBOOK = Path(__file__).resolve().parents[2] / "agent" / "dbx_inspire_ai_agent.ipynb"


def _code() -> str:
    cells = json.loads(NOTEBOOK.read_text(encoding="utf-8"))["cells"]
    return "\n".join("".join(c["source"]) for c in cells if c["cell_type"] == "code")


def test_no_pipeline_step_a_person_reads_carries_an_internal_code_such_as_uc_or_p2():
    names = re.findall(r'_pipeline_step\(\s*"[^"]+",\s*f?"([^"]+)"', _code())
    assert len(names) >= 4
    coded = [n for n in names if re.search(r"\bUC\b|\bP\d_|_", n.replace("{batch_num_inner}", "1"))]
    assert coded == []


def test_a_batch_and_the_theme_step_read_as_plain_words_on_the_live_status_line(agent_ns):
    agent = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    _stage, step, live = agent._story_pipeline_labels("Use Cases Generation", "Writing More Use Cases, Batch 1", "Writing More Use Cases, Batch 1",
                                                       "started", "")
    assert (step, live) == ("Inspire is working on writing more use cases, batch 1", "In progress: writing more use cases, batch 1")
    assert agent_ns["PROMPT_STORY_TITLES"]["THEME_ASSIGNMENT_PROMPT"] == ("Use Case Prioritization", "Grouping Use Cases Into Themes")
    assert '"step_name": "Idea Themes"' not in _code() and '"step_name": "Grouping Use Cases Into Themes"' in _code()


@pytest.mark.parametrize("measures", [
    {"row_count": 5000, "positives": 900, "class_rate": 0.18, "separation": 0.0, "signal": "net_profit"},
    {"row_count": 5000, "correlation": 0.0, "signal": "net_profit"},
])
def test_a_prediction_without_a_signal_says_what_is_missing_and_what_to_do_without_statistics_words(agent_ns, measures):
    passed, text = agent_ns["deep_signal_verdict"]("A", measures, {"measure": "net_profit"})
    assert passed is False
    assert "so a model has nothing to learn from: add a column" in text and "or pick a table that has one" in text
    assert not re.search(r"standard deviation|correlation is|signal column", text), text


def test_the_one_group_scope_text_is_one_short_sentence_without_the_count_twice(agent_ns):
    chosen = {"scope": "records", "table": "main.sales.tx", "records": 1000, "column": "product", "whole_groups": True,
              "values": ["Big"], "group_records": {"Big": 5687}}
    said = agent_ns["inspire_scope_text"](chosen)
    assert said == "5,687 records of main.sales.tx, all of product = Big, the smallest group, since every group holds more than 1,000 records"
    assert said.count("5,687") == 1 and "no group is cut" not in said


@pytest.mark.parametrize("family,measures,names,action", [
    ("D", {"row_count": 9000, "interactions": 9000, "users": 2000, "items": 300, "multi_item_baskets": 900, "supported_pairs": 12,
           "pair_lift": 1.01}, {"basket": "order", "top_items": 20, "pair_baskets": 20}, "pick a table with more"),
    ("E", {"row_count": 60, "periods": 60, "cadence": "daily", "seasonal_cycles": 8.57, "missing_period_rate": 0.0,
           "autocorrelation": 0.05}, {}, "use a longer history"),
    ("H", {"row_count": 1000, "lever_values": 40, "lever_effect": 0.0006}, {"outcome": "units", "lever": "price", "group": "store"}, "pick a lever that changes it"),
])
def test_every_no_signal_verdict_names_what_to_do_and_no_statistics_term(agent_ns, family, measures, names, action):
    passed, text = agent_ns["deep_signal_verdict"](family, measures, names)
    assert passed is False and action in text, text
    assert not re.search(r"autocorrelation|correlation|lift of|standard deviation", text), text
