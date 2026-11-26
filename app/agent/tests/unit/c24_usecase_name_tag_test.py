"""REQ-340 (REQ-557): the notebook's name tag for a 200-char name equals the JS encoder's rule (whole words within the cloud limit), and a tag encodes to itself."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import load_agent_namespace  # noqa: E402


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def test_spaces_ampersand_and_accents_encode_and_a_tag_encodes_to_itself(ns):
    tag = ns["inspire_usecase_name_tag"]
    for name, slug in (("  Predict   Customer  Churn ", "predict_customer_churn"),
                       ("Sales & Marketing: Q3 / Q4 uplift", "sales_marketing_q3_q4_uplift"),
                       ("Café Résumé Scoring", "cafe_resume_scoring")):
        assert tag(name) == slug
        assert tag(slug) == slug


def test_a_200_char_name_fits_the_tag_limit_on_a_word_boundary(ns):
    long = " ".join(f"word{i}" for i in range(40))[:200]
    assert len(long) == 200
    value = ns["inspire_usecase_name_tag"](long)
    assert 0 < len(value) <= ns["JobLauncher"].tag_value_max()
    assert long.replace(" ", "_").startswith(value + "_") or value == long.replace(" ", "_")
    assert ns["inspire_usecase_name_tag"](value) == value
