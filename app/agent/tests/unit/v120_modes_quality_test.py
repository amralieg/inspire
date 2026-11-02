"""v1.2.0 MODES lane, WS5: the Good / High / Ultra High quality modes.

Covers the canonical parser and its legacy-alias matrix, the __init__ filter map (never keep-all,
never a silent Balanced fallback: D1-02, D1-09), the canonical value reaching the session row
(D1-13), the removal of the unused `min_use_cases_for_selection` attribute, and the single
generation gate shared by every mode (QUALITY_GATE_GOOD / QUALITY_GATE_VERY_HIGH /
QUALITY_GATE_GENERATION_BLOCKS deleted).
"""
import ast
import logging
import os
import shutil
import sys
import uuid

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, method_node  # noqa: E402

CANONICAL = ("Good", "High", "Ultra High")
LEGACY = {
    "Coverage Mode (All)": "Good",
    "Balanced": "Good",
    "Good Quality": "Good",
    "High Quality": "Good",
    "Strict Quality": "High",
    "Very High Quality": "High",
}
ACCEPTABLE = {
    "Good": {"Medium", "High", "Very High", "Ultra High"},
    "High": {"High", "Very High", "Ultra High"},
    "Ultra High": {"High", "Very High", "Ultra High"},
}


@pytest.fixture
def restore_root_logger():
    root = logging.getLogger()
    saved = (list(root.handlers), root.level, list(root.filters))
    yield
    root.handlers[:] = saved[0]
    root.setLevel(saved[1])
    root.filters[:] = saved[2]


def _construct(ns, tmp_path, **kwargs):
    sid = str(uuid.uuid4().int % 10 ** 12)
    obj = ns["DatabricksInspire"](business=f"ModesProbe{sid}", generation_path=str(tmp_path / "out"),
                                  session_id=sid, **kwargs)
    return obj


def _cleanup(obj):
    try:
        obj.ai_agent.cleanup_llm_cache()
    except Exception:
        pass
    shutil.rmtree(obj.local_log_output_dir, ignore_errors=True)


# ---------------------------------------------------------------- canonical parser and aliases


def test_canonical_modes_are_exactly_good_high_ultra_high(agent_ns):
    assert agent_ns["USE_CASES_QUALITY_VALID"] == CANONICAL
    assert agent_ns["USE_CASES_QUALITY_DEFAULT"] == "Good"


def test_alias_table_is_the_behavior_preserving_contract(agent_ns):
    assert agent_ns["USE_CASES_QUALITY_ALIASES"] == LEGACY


@pytest.mark.parametrize("raw,expected", sorted(LEGACY.items()))
def test_every_legacy_label_maps_to_its_canonical_mode(agent_ns, raw, expected):
    parse = agent_ns["canonical_use_cases_quality"]
    assert parse(raw) == expected
    assert parse(raw.upper()) == expected
    assert parse(f"  {raw.lower()}  ") == expected


@pytest.mark.parametrize("mode", CANONICAL)
def test_canonical_values_pass_through_case_insensitively(agent_ns, mode):
    parse = agent_ns["canonical_use_cases_quality"]
    assert parse(mode) == mode
    assert parse(mode.lower()) == mode
    assert parse(f" {mode.upper()} ") == mode


def test_ultra_high_is_reachable_only_by_choosing_it(agent_ns):
    parse = agent_ns["canonical_use_cases_quality"]
    assert "Ultra High" not in set(agent_ns["USE_CASES_QUALITY_ALIASES"].values())
    assert parse("Very High Quality") == "High"
    assert {parse(label) for label in LEGACY} == {"Good", "High"}


@pytest.mark.parametrize("blank", [None, "", "   "])
def test_missing_value_uses_the_documented_default(agent_ns, blank):
    assert agent_ns["canonical_use_cases_quality"](blank) == "Good"


@pytest.mark.parametrize("bad", ["Ultra", "Very High", "Strict", "Premium", "Good Qualityy", "Balanced Mode"])
def test_unknown_value_raises_naming_valid_options_and_legacy_labels(agent_ns, bad):
    with pytest.raises(ValueError) as exc:
        agent_ns["canonical_use_cases_quality"](bad)
    message = str(exc.value)
    assert repr(bad) in message
    for mode in CANONICAL:
        assert repr(mode) in message, mode
    for legacy in LEGACY:
        assert repr(legacy) in message, legacy
    assert "mapped to 'Good'" in message and "mapped to 'High'" in message


def test_quality_constants_are_defined_before_create_widgets_runs():
    tree = ast.parse(agent_source())
    body = tree.body
    call_idx = next(i for i, n in enumerate(body)
                    if isinstance(n, ast.Assign) and isinstance(n.value, ast.Call)
                    and getattr(n.value.func, "id", None) == "create_widgets")
    defined = {}
    for i, n in enumerate(body):
        if isinstance(n, ast.Assign):
            for t in n.targets:
                if isinstance(t, ast.Name):
                    defined.setdefault(t.id, i)
        elif isinstance(n, ast.FunctionDef):
            defined.setdefault(n.name, i)
    for name in ("USE_CASES_QUALITY_VALID", "USE_CASES_QUALITY_DEFAULT", "USE_CASES_QUALITY_ALIASES",
                 "canonical_use_cases_quality", "_defer_stale_widget", "recreate_deferred_widgets"):
        assert defined[name] < call_idx, name


# ---------------------------------------------------------------- __init__: filter map, ValueError, session row


@pytest.mark.parametrize("raw,expected", [(m, m) for m in CANONICAL] + sorted(LEGACY.items()) + [("", "Good"), (None, "Good")])
def test_init_canonicalizes_and_maps_the_filter(fresh_ns, tmp_path, restore_root_logger, raw, expected):
    kwargs = {} if raw is None else {"use_cases_quality": raw}
    obj = _construct(fresh_ns, tmp_path, **kwargs)
    try:
        assert obj.use_cases_quality == expected
        assert obj.quality_filter_acceptable == ACCEPTABLE[expected]
        assert obj.quality_filter_acceptable is not None
        assert obj.atomic_writer.widget_values["use_cases_quality"] == expected
        assert obj.atomic_writer._widget_to_columns_map()["use_cases_quality"] == expected
    finally:
        _cleanup(obj)


def test_init_filter_sets_are_not_shared_between_instances(fresh_ns, tmp_path, restore_root_logger):
    first = _construct(fresh_ns, tmp_path, use_cases_quality="High")
    second = _construct(fresh_ns, tmp_path, use_cases_quality="High")
    try:
        first.quality_filter_acceptable.discard("High")
        assert second.quality_filter_acceptable == ACCEPTABLE["High"]
    finally:
        _cleanup(first)
        _cleanup(second)


@pytest.mark.parametrize("bad", ["Ultra", "Premium", "Coverage"])
def test_init_rejects_unknown_quality_instead_of_balanced_or_keep_all(fresh_ns, tmp_path, restore_root_logger, bad):
    with pytest.raises(ValueError) as exc:
        _construct(fresh_ns, tmp_path, use_cases_quality=bad)
    assert "Valid options: 'Good', 'High', 'Ultra High'" in str(exc.value)


@pytest.mark.parametrize("kwargs,attr,expected", [
    ({}, "operation", "Discover Use Cases"),
    ({"operation": ""}, "operation", "Discover Use Cases"),
    ({"operation": "Generate Use Cases"}, "operation", "Generate Use Cases"),
    ({}, "table_election_mode", "Let Inspire Decides"),
    ({"table_election_mode": "Transactional Only"}, "table_election_mode", "Transactional Only"),
])
def test_init_keeps_valid_and_defaults_missing_run_settings(fresh_ns, tmp_path, restore_root_logger, kwargs, attr, expected):
    obj = _construct(fresh_ns, tmp_path, **kwargs)
    try:
        assert getattr(obj, attr) == expected
    finally:
        _cleanup(obj)


@pytest.mark.parametrize("kwargs,needle", [
    ({"operation": "Generate use cases"}, "'Discover Use Cases', 'Generate Use Cases'"),
    ({"operation": "Regenerate"}, "'Discover Use Cases', 'Generate Use Cases'"),
    ({"table_election_mode": "Everything"}, "'Let Inspire Decides', 'All Tables', 'Transactional Only'"),
])
def test_init_rejects_unknown_run_settings_instead_of_silently_defaulting(fresh_ns, tmp_path, restore_root_logger,
                                                                          kwargs, needle):
    with pytest.raises(ValueError) as exc:
        _construct(fresh_ns, tmp_path, **kwargs)
    assert needle in str(exc.value)


def test_init_never_falls_back_to_balanced_or_keep_all():
    src = ast.unparse(method_node("DatabricksInspire", "__init__"))
    assert "Balanced" not in src and "Coverage Mode" not in src and "Strict Quality" not in src
    assert ".get(self.use_cases_quality)" not in src
    assert "canonical_use_cases_quality(" in src


def test_min_use_cases_for_selection_attribute_removed(fresh_ns, tmp_path, restore_root_logger):
    obj = _construct(fresh_ns, tmp_path)
    try:
        assert not hasattr(obj, "min_use_cases_for_selection")
    finally:
        _cleanup(obj)
    src = agent_source()
    assert "self.min_use_cases_for_selection" not in src


# ---------------------------------------------------------------- one generation gate for every mode


def test_retired_generation_gates_are_deleted(agent_ns):
    for name in ("QUALITY_GATE_GOOD", "QUALITY_GATE_VERY_HIGH", "QUALITY_GATE_GENERATION_BLOCKS"):
        assert name not in agent_ns, name
        assert name not in agent_source(), name
    assert "QUALITY_GATE_HIGH" in agent_ns


def test_single_gate_names_no_retired_mode(agent_ns):
    gate = agent_ns["QUALITY_GATE_HIGH"]
    assert "BALANCED MODE" not in gate
    for retired in ("Coverage Mode", "Strict Quality", "Balanced"):
        assert retired not in gate, retired
    assert "One broad generation pass feeds every quality mode" in gate


def test_generation_size_estimate_uses_the_single_gate_for_every_mode(agent_ns):
    DI = agent_ns["DatabricksInspire"]
    sizes = set()
    for mode in CANONICAL:
        obj = DI.__new__(DI)
        obj.use_cases_quality = mode
        obj._prompt_overhead_chars = lambda name, template=None: 1000
        sizes.add(obj._generation_prompt_base_size(("abc",)))
    assert sizes == {1000 + len(agent_ns["QUALITY_GATE_HIGH"]) + 3}


def test_generation_prompt_does_not_depend_on_the_mode():
    node = method_node("DatabricksInspire", "_process_batch_with_retry")
    src = ast.unparse(node)
    assert "use_cases_quality" not in src
    assert "'quality_gate_block': QUALITY_GATE_HIGH" in src
    size_src = ast.unparse(method_node("DatabricksInspire", "_generation_prompt_base_size"))
    assert "use_cases_quality" not in size_src and "QUALITY_GATE_HIGH" in size_src


def test_every_mode_sends_the_identical_generation_prompt(agent_ns):
    from v120_modes_context_test import gen_harness, GEN_HEADER, gen_row
    prompts = []
    for mode in CANONICAL:
        obj = gen_harness(agent_ns, [GEN_HEADER + "\n" + gen_row("N1-1")], use_cases_quality=mode)
        obj._process_batch_with_retry([("c", "s", "orders", "id", "bigint", "")], 1)
        prompts.append(obj.ai_agent.calls[0]["vars"])
    assert prompts[0] == prompts[1] == prompts[2]
    assert prompts[0]["quality_gate_block"] == agent_ns["QUALITY_GATE_HIGH"]
