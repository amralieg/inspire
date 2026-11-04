"""v1.4.0 kinds demo: every use case the App's kinds demo shows takes its kind and its title from the agent itself."""
import copy
import gzip
import json
import os

import pytest

from v120_gate_recalibration_test import make

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
BUNDLE = os.path.join(os.path.dirname(ROOT), "backend", "showcase", "kinds-retail.json.gz")
KIND_FIELDS = ("use_case_kind", "kind_family", "app_layout", "serving_summary", "method_summary", "value_source", "name_with_technique")


@pytest.fixture(scope="module")
def demo():
    with gzip.open(BUNDLE, "rt", encoding="utf-8") as handle:
        bundle = json.load(handle)
    return bundle["inspire"][f"GET /api/inspire/usecases?session_id={bundle['session_id']}"]["body"]["usecases"]


@pytest.fixture(scope="module")
def agent(agent_ns):
    return make(agent_ns)


def _bare(uc):
    return {k: v for k, v in copy.deepcopy(uc).items() if k not in KIND_FIELDS}


def test_the_demo_carries_one_use_case_per_kind(demo):
    assert len(demo) == 17
    assert len({u["use_case_kind"] for u in demo}) == 17


def test_every_demo_name_passes_the_agent_name_check_and_its_title_is_the_agent_formatter(demo, agent):
    for uc in demo:
        assert not agent._use_case_name_issues(_bare(uc)), uc["id"]
        assert agent._inspire_name_with_technique(_bare(uc)) == uc["name_with_technique"], uc["id"]


def test_every_demo_kind_carries_the_family_and_layout_the_agent_gives_that_kind(demo, agent_ns):
    for uc in demo:
        row = _bare(uc)
        row["use_case_kind"] = uc["use_case_kind"]
        assert agent_ns["inspire_apply_use_case_kind"](row), uc["id"]
        assert row["use_case_kind"] == uc["use_case_kind"], uc["id"]
        assert row["app_layout"] == uc["app_layout"], uc["id"]
        assert row["kind_family"] == uc["kind_family"], uc["id"]


def test_a_changed_technique_changes_the_title_so_the_check_can_fail(demo, agent):
    row = _bare(demo[0])
    row["Analytics Technique"] = "Regression"
    assert agent._inspire_name_with_technique(row) != demo[0]["name_with_technique"]
