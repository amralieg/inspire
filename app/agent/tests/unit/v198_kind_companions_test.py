"""Companion tables of the use-case kind contracts: the notebook instruction lists them, the readiness rules name them, and the
Run controls writer refuses a companion frame that misses a contract column or holds no rows."""
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_genie_support import build_inspire, make_uc  # noqa: E402
from v142_scd_test import _Frame  # noqa: E402

PROCESS = {"__transitions": ["from_step", "to_step", "cases", "median_hours", "p90_hours", "rework"],
           "__cases": ["case_id", "step", "age_hours", "breach_risk"]}


def mandate_of(agent_ns, **fields):
    inst = build_inspire(agent_ns)
    spec = inst._genie_notebook_spec(make_uc(**fields))
    return spec, inst._build_code_structure_mandate(spec), inst._genie_threshold_text(spec)


@pytest.mark.parametrize("technique, suffixes", [
    ("Process Mining", ["__transitions", "__cases"]),
    ("Geospatial Analysis", ["__geo"]),
    ("Network Analysis", ["__nodes", "__edges"]),
])
def test_a_kind_with_a_contract_names_its_companion_tables_from_the_registry(agent_ns, technique, suffixes):
    companions = agent_ns["inspire_kind_companions"]({"Analytics Technique": technique})
    assert sorted(companions) == sorted(suffixes)
    contract = agent_ns["inspire_use_case_kind"]({"Analytics Technique": technique})["contract"]
    assert companions == agent_ns["_inspire_kinds"]()["contracts"][contract]["suffixes"]


def test_the_kind_a_use_case_names_wins_over_its_technique_and_a_kind_without_a_contract_has_none(agent_ns):
    companions = agent_ns["inspire_kind_companions"]
    assert companions({"Analytics Technique": "Geospatial Analysis", "use_case_kind": "process_mining"}) == PROCESS
    assert companions({"Analytics Technique": "Data Agent"}) == {}
    assert companions({"Analytics Technique": "Not a technique"}) == {}
    assert companions(None) == {}


def test_the_instruction_lists_each_companion_table_with_its_columns_and_meaning_and_its_readiness_rule(agent_ns, capsys):
    spec, mandate, readiness = mandate_of(agent_ns, **{"Analytics Technique": "Process Mining"})
    assert spec["companions"] == PROCESS
    table = spec["result_table"]
    assert agent_ns["GENIE_COMPANION_RULE"] in mandate
    assert f"* {table}__transitions: from_step, to_step, cases, median_hours, p90_hours, rework; one row per move" in mandate
    assert f"* {table}__cases: case_id, step, age_hours, breach_risk; one row per open case" in mandate
    assert "wins over this rule" in agent_ns["GENIE_COMPANION_RULE"]
    assert f"- companion `__transitions`: the data fills {table}__transitions" in readiness
    assert "still write the decision list" in readiness
    fired = capsys.readouterr().out
    assert f"[KIND-CONTRACT FIRED] {spec['use_case_id']}: companion tables" in fired
    assert all(suffix in fired.split("[KIND-CONTRACT FIRED]")[1].splitlines()[0] for suffix in PROCESS)


def test_a_use_case_whose_kind_has_no_contract_gets_no_companion_rule(agent_ns, capsys):
    spec, mandate, readiness = mandate_of(agent_ns, **{"Analytics Technique": "Data Agent"})
    assert spec["companions"] == {}
    assert agent_ns["GENIE_COMPANION_RULE"] not in mandate and "companion table" not in readiness
    assert "KIND-CONTRACT FIRED" not in capsys.readouterr().out


class _Counted(_Frame):
    def __init__(self, fields, rows):
        super().__init__(fields)
        self.rows = rows

    def count(self):
        return self.rows


CASES = [("case_id", "string"), ("step", "string"), ("age_hours", "double"), ("breach_risk", "double"), ("region", "void")]


def test_the_companion_writer_writes_the_table_next_to_the_result_table_and_keeps_extra_columns(agent_ns):
    frame, printed = _Counted(CASES, 24), []
    rows = agent_ns["inspire_write_companion"](frame, "main.ops.order_flow_out", "__cases", PROCESS["__cases"],
                                               spark_session=types.SimpleNamespace(), out=printed.append)
    assert rows == 24
    assert frame.saved == [("mode", "overwrite"), ("option", "overwriteSchema", "true"),
                           ("saveAsTable", agent_ns["inspire_table_name"]("main.ops.order_flow_out__cases"))]
    assert frame.cast == [("region", "region::string")]
    assert printed == ["[COMPANION-WRITE FIRED] main.ops.order_flow_out__cases: 24 rows"]


@pytest.mark.parametrize("fields, rows, suffix, columns, fragment", [
    (CASES[:2], 24, "__cases", PROCESS["__cases"], "needs the columns age_hours, breach_risk"),
    (CASES, 0, "__cases", PROCESS["__cases"], "holds no rows"),
    (CASES, 24, "cases", PROCESS["__cases"], "suffix of a companion table"),
    (CASES, 24, "__cases; DROP", PROCESS["__cases"], "suffix of a companion table"),
    (CASES, 24, "__cases", [], "the columns the companion table must hold"),
])
def test_the_companion_writer_refuses_a_missing_column_an_empty_frame_and_a_bad_suffix_before_any_write(agent_ns, fields, rows, suffix,
                                                                                                         columns, fragment):
    frame = _Counted(fields, rows)
    with pytest.raises(ValueError, match=fragment):
        agent_ns["inspire_write_companion"](frame, "main.ops.order_flow_out", suffix, columns, spark_session=types.SimpleNamespace(),
                                            out=lambda _: None)
    assert frame.saved == []


def test_every_notebook_run_controls_cell_carries_the_companion_writer(agent_ns):
    inst = build_inspire(agent_ns)
    uc = make_uc(**{"Analytics Technique": "Process Mining"})
    spec = inst._genie_notebook_spec(uc)
    source = inst._genie_run_controls_source(uc, spec, str(uc.get("genie_instruction") or ""))
    assert "def inspire_write_companion(" in source and source.index("def inspire_write_companion(") < source.index("\ninspire_main()")
