"""REQ-539 lane W-1: the focus spec validator. Same cases as web/test/focusSpec.test.mjs (shared fixture)."""
import json
import os
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
SHELL = os.path.join(HERE, "..", "agent", "app_shell")
SERVER = os.path.join(SHELL, "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import focus_spec  # noqa: E402
import shell_agent  # noqa: E402

CASES = json.load(open(os.path.join(HERE, "fixtures", "focus_spec_cases.json")))["cases"]
DEFAULTS = json.load(open(os.path.join(SHELL, "focus_defaults.json")))
KINDS = json.load(open(os.path.join(SHELL, "kinds.json")))
KIND_IDS = sorted(set(KINDS["technique_kind"].values()))
BLOCKS = ["bridge", "strip", "histogram", "trend_band", "ranked_bars", "small_multiples", "share_shift", "before_after",
          "funnel", "network", "map_pin", "gauge", "timeline", "cohort_cards"]
MOTIONS = ["build", "count_up", "morph", "pulse", "slide", "fill", "trace", "split_merge", "zoom", "reveal"]


def got(case):
    r = focus_spec.validate(case["spec"], case["columns"], case.get("actions"))
    return r, sorted(f"{e['path']}: {e['rule']}" for e in r["errors"])


def test_fixture_has_20_cases():
    assert len(CASES) == 20


def test_every_fixture_case_gets_the_expected_verdict_and_rules():
    for case in CASES:
        r, rules = got(case)
        assert rules == case["expect"], case["name"]
        assert r["ok"] == (not case["expect"]), case["name"]


def test_every_rejection_names_the_field_path_and_the_rule():
    for case in CASES:
        for e in got(case)[0]["errors"]:
            assert e["path"] and e["rule"] and e["message"], case["name"]
            assert e["path"] in e["message"] or e["rule"] in e["message"], case["name"]


def test_block_and_motion_ids_are_exactly_the_plan_set():
    assert list(focus_spec.BLOCKS) == BLOCKS
    assert list(focus_spec.MOTIONS) == MOTIONS


def test_default_actions_are_the_app_record_actions():
    assert tuple(focus_spec.DEFAULT_ACTIONS) == tuple(shell_agent.OFFER_ACTIONS)


def test_every_technique_kind_has_a_default_spec_the_validator_accepts():
    assert len(KIND_IDS) == 38
    for kind in KIND_IDS:
        spec = DEFAULTS["defaults"].get(kind)
        assert spec is not None, f"no default focus spec for {kind}"
        assert spec["technique_kind"] == kind
        r = focus_spec.validate(spec, DEFAULTS["columns"])
        assert r["ok"], (kind, r["errors"])


def test_defaults_hold_no_kind_outside_kinds_json():
    assert set(DEFAULTS["defaults"]) == set(KIND_IDS)
