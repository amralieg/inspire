"""NB-1: the value disclaimer is held in the notebook next to the App settings (no extra asset) and equals the backend JSON."""
import json
import os

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
DISCLAIMER_JSON = os.path.join(os.path.dirname(ROOT), "backend", "lib", "valueDisclaimer.json")


def test_the_notebook_constant_equals_the_backend_json(agent_ns):
    with open(DISCLAIMER_JSON, encoding="utf-8") as handle:
        assert agent_ns["INSPIRE_VALUE_DISCLAIMER"] == json.load(handle)


def test_the_disclaimer_is_not_a_pinned_asset(agent_ns):
    assert "value_disclaimer" not in agent_ns["INSPIRE_NOTEBOOK_ASSETS"]


def test_settings_built_with_a_basis_carry_the_disclaimer(agent_ns):
    basis = {"amount": 5.0, "currency": "USD"}
    got = agent_ns["inspire_value_basis_by_page"](basis, "p1")
    settings = agent_ns["implement_app_settings"](1, "T", ["p1"], None, "", "2026-11-22T00:00:00Z", {"app_access": "sp"}, value_basis=got)
    assert settings["value_basis"]["p1"] == dict(basis, disclaimer=agent_ns["INSPIRE_VALUE_DISCLAIMER"])
    assert agent_ns["inspire_value_basis_by_page"](None, "p1") is None
