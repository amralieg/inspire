"""REQ-586a C: one value spec, locked runners. app/shared/value_spec.schema.json is the JSON Schema that the agent
(inspire_value_calculate) and the App (valueFormula.js) validate a spec against before it runs. The schema checks shape only;
the calculator checks meaning. A spec the schema rejects is never one the calculator accepts. Fixtures and runner come from
a04_value_spec_test (one loader, one comparison)."""
import copy
import json
import os

import jsonschema
import pytest

from a04_value_spec_test import CASES, calculator, same

HERE = os.path.dirname(os.path.abspath(__file__))
SCHEMA_PATH = os.path.normpath(os.path.join(HERE, "..", "..", "..", "shared", "value_spec.schema.json"))
SCHEMA = json.load(open(SCHEMA_PATH, encoding="utf-8"))
VALIDATOR = jsonschema.Draft202012Validator(SCHEMA)
EXPECTED_KEYS = {"annual_exposure", "balance", "break_even_effect", "bucket", "flags", "ok", "one_percent", "period", "problems",
                 "scenarios", "unit"}
# Refused fixtures whose spec breaks the schema itself (an unknown mechanism, a sourced range without its source).
SCHEMA_REFUSED = {"mechanism_unknown_refused", "source_missing_refused"}
BY_ID = {case["id"]: case for case in CASES}


def errors(spec):
    return sorted(error.message for error in VALIDATOR.iter_errors(spec))


def test_the_schema_is_a_valid_draft_2020_12_schema():
    assert SCHEMA["$schema"] == "https://json-schema.org/draft/2020-12/schema"
    jsonschema.Draft202012Validator.check_schema(SCHEMA)
    assert SCHEMA["required"] == ["mechanism", "currency", "flow_or_stock", "horizon_years", "measured", "sourced"]
    assert SCHEMA["additionalProperties"] is False and "cost" in SCHEMA["properties"] and "cost" not in SCHEMA["required"]


@pytest.mark.parametrize("case", [case for case in CASES if case["id"] not in SCHEMA_REFUSED], ids=lambda case: case["id"])
def test_every_fixture_spec_validates(case):
    assert errors(case["spec"]) == [], case["id"]


@pytest.mark.parametrize("case_id", sorted(SCHEMA_REFUSED))
def test_a_schema_refused_fixture_is_also_refused_by_the_calculator(agent_ns, case_id):
    case = BY_ID[case_id]
    assert errors(case["spec"]), f"{case_id}: the schema accepts a spec it should refuse"
    out = calculator(agent_ns)(copy.deepcopy(case["spec"]))
    assert out["ok"] is False and out["problems"] == case["expected"]["problems"], (case_id, out)


def test_the_schema_never_rejects_a_spec_the_calculator_accepts(agent_ns):
    calc = calculator(agent_ns)
    for case in CASES:
        if errors(case["spec"]):
            assert not calc(copy.deepcopy(case["spec"]))["ok"], case["id"]


def _spec(case_id="revenue_at_margin"):
    return copy.deepcopy(BY_ID[case_id]["spec"])


def _drop(spec, key):
    spec.pop(key)
    return spec


def _drop_tier(spec, tier):
    spec["cost"]["tiers"].pop(tier)
    return spec


def _set(spec, path, value):
    node = spec
    for key in path[:-1]:
        node = node[key]
    node[path[-1]] = value
    return spec


INVALID = {
    "missing_required_mechanism": lambda: _drop(_spec(), "mechanism"),
    "missing_required_measured": lambda: _drop(_spec(), "measured"),
    "missing_required_currency_key": lambda: _drop(_spec(), "currency"),
    "bad_enum_mechanism": lambda: _set(_spec(), ["mechanism"], "growth"),
    "bad_enum_flow_or_stock": lambda: _set(_spec(), ["flow_or_stock"], "both"),
    "bad_enum_source": lambda: _set(_spec(), ["sourced", "effect", "source"], "guess"),
    "bad_enum_cost_source": lambda: _set(_spec(), ["cost", "source"], "guess"),
    "wrong_type_horizon_string": lambda: _set(_spec(), ["horizon_years"], "3"),
    "wrong_type_horizon_float": lambda: _set(_spec(), ["horizon_years"], 2.5),
    "wrong_type_exposure": lambda: _set(_spec(), ["measured", "exposure"], "12000000"),
    "wrong_type_currency": lambda: _set(_spec(), ["currency"], 840),
    "horizon_out_of_range": lambda: _set(_spec(), ["horizon_years"], 11),
    "effect_above_one": lambda: _set(_spec(), ["sourced", "effect", "high"], 1.5),
    "negative_cost": lambda: _set(_spec(), ["cost", "tiers", "S", "implementation"], -1),
    "cost_tier_missing": lambda: _drop_tier(_spec(), "L"),
    "unknown_top_level_key": lambda: _set(_spec(), ["total"], 1),
}


@pytest.mark.parametrize("name", sorted(INVALID))
def test_a_hand_built_invalid_spec_is_rejected(name):
    spec = INVALID[name]()
    assert errors(spec), f"{name}: the schema accepted {spec!r}"


def test_cost_is_optional():
    assert errors(_drop(_spec(), "cost")) == []


@pytest.mark.parametrize("case", CASES, ids=lambda case: case["id"])
def test_the_calculator_matches_every_expected_key_of_every_fixture(agent_ns, case):
    held = set(case["expected"])
    assert held <= EXPECTED_KEYS and (held == EXPECTED_KEYS or not case["expected"]["ok"]), (case["id"], sorted(held ^ EXPECTED_KEYS))
    out = calculator(agent_ns)(copy.deepcopy(case["spec"]))
    assert EXPECTED_KEYS <= set(out), (case["id"], sorted(EXPECTED_KEYS - set(out)))
    same(case["expected"], out, case["id"])


def test_the_file_schema_and_the_notebook_schema_agree_on_required_keys_and_enums(agent_ns):
    held = agent_ns.get("INSPIRE_VALUE_SPEC_SCHEMA")
    assert isinstance(held, dict), "the notebook defines no INSPIRE_VALUE_SPEC_SCHEMA"
    props, mine = held["properties"], SCHEMA["properties"]
    assert held["required"] == SCHEMA["required"]
    assert sorted(props["mechanism"]["enum"]) == sorted(mine["mechanism"]["enum"])
    assert sorted(props["flow_or_stock"]["enum"]) == sorted(mine["flow_or_stock"]["enum"])
    assert sorted(props["cost"]["properties"]["source"]["enum"]) == sorted(SCHEMA["$defs"]["source"]["enum"])
    assert sorted(props["sourced"]["properties"]) == sorted(mine["sourced"]["properties"])
