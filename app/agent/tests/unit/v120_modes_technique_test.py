"""v1.2.0 MODES lane: technique relabel targets are registry labels (scope item 8).

The catch-all relabel in Phase G2 writes `_technique_label(family)` onto a use case. Seven family
labels (Topic Modeling, Summarization, Information Extraction, NLP Classification, Text Analytics,
Market Basket Analysis, Ranking) were not TECHNIQUE_IMPLEMENTATION_GUIDANCE keys, so every relabelled
use case logged [TECHNIQUE_UNKNOWN] in the final pass and its Genie prompt got no technique mandate.
Only the labels change; the family keys, aliases and method lists are untouched.
"""
import logging

import pytest

RETIRED_LABELS = ("Topic Modeling", "Summarization", "Information Extraction", "NLP Classification",
                  "Text Analytics", "Market Basket Analysis", "Ranking")
EXPECTED = {
    "text_topic": "Clustering",
    "text_summarization": "Document Processing",
    "text_extraction": "Extraction",
    "text_classification": "Classification",
    "text_analytics": "Document Processing",
    "association": "Recommendation",
    "ranking": "Pareto Analysis",
}


class CapturingLogger:
    def __init__(self):
        self.records = []

    def _log(self, level, msg, *a, **k):
        self.records.append((level, str(msg)))

    def debug(self, msg, *a, **k):
        self._log("DEBUG", msg)

    def info(self, msg, *a, **k):
        self._log("INFO", msg)

    def warning(self, msg, *a, **k):
        self._log("WARNING", msg)

    def error(self, msg, *a, **k):
        self._log("ERROR", msg)


def _obj(ns):
    DI = ns["DatabricksInspire"]
    obj = DI.__new__(DI)
    obj.logger = CapturingLogger()
    return obj


def test_every_family_label_is_a_registry_label(agent_ns):
    registry = set(agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"])
    families = agent_ns["DatabricksInspire"]._TECHNIQUE_FAMILIES
    labels = {label for _key, label, _aliases, _methods in families}
    assert labels <= registry, labels - registry
    assert "AI Analysis" not in labels
    assert not labels & set(RETIRED_LABELS)


def test_relabel_targets_map_to_the_agreed_registry_labels(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    for family, label in EXPECTED.items():
        assert cls._technique_label(family) == label, family


def test_family_detection_is_unchanged(agent_ns):
    cls = agent_ns["DatabricksInspire"]
    keys = [key for key, _l, _a, _m in cls._TECHNIQUE_FAMILIES]
    assert len(keys) == len(set(keys)) == 25
    assert cls._technique_family("BERTopic topic model") == "text_topic"
    assert cls._technique_family("market basket analysis") == "association"
    assert cls._technique_family("Top-N ranking") == "ranking"
    assert cls._technique_family("information extraction") == "text_extraction"


@pytest.mark.parametrize("design,label", [
    ("Run BERTopic over `review_text` to surface complaint themes.", "Clustering"),
    ("Call ai_summarize on `ticket_body` to brief the duty manager.", "Document Processing"),
    ("Use ai_extract on `contract_text` to pull renewal dates.", "Extraction"),
    ("Mine baskets with FP-Growth on `order_id` and `sku`.", "Recommendation"),
    ("Order stores with percent_rank over `net_sales`.", "Pareto Analysis"),
])
def test_relabelled_use_case_is_canonical_and_never_logs_unknown(agent_ns, design, label):
    obj = _obj(agent_ns)
    uc = {"No": "N01-U01", "Name": "Act on findings", "Analytics Technique": "AI Analysis",
          "Solution": design, "High Level Design": design}
    kept = obj._phaseG_validate_no_catchall_technique([uc])
    assert kept and kept[0]["Analytics Technique"] == label
    assert obj._canonical_analytics_technique(kept[0]["Analytics Technique"], "N01-U01", "Selected use case") == label
    assert not [m for lvl, m in obj.logger.records if "[TECHNIQUE_UNKNOWN]" in m]


def test_genie_guidance_exists_for_every_relabel_target(agent_ns):
    guidance = agent_ns["TECHNIQUE_IMPLEMENTATION_GUIDANCE"]
    registry = agent_ns["TECHNIQUE_EXECUTION_FAMILY"]
    for label in set(EXPECTED.values()):
        assert guidance[label].startswith("Method: "), label
        assert label in registry, label
