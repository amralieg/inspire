"""REQ-183 (items 2 and 3 of the walk fix): a repeated identical notebook refusal stops the Genie rounds the way the App loop does
(REQ-181, [REPEAT-REFUSAL STOP]); a failed read of group_by is logged and a grouping proof run stops on it, while a failed read of
a widget whose default is harmless keeps the default silently. Offline, through the real round loop and widget reader."""
from unittest.mock import MagicMock

import pytest

from v140_implement_test import VALID, _FakeRunner, _fill, _flow_inspire
import json

from rc14_space_sql_scope_test import TABLE, _scopes
from rc16_f_filter_cols_test import SALES, make_inspire, scope, scoped, use_case  # noqa: F401 (fixture)
from v120_docs_design_test import docs  # noqa: F401 (fixture)


def test_a_notebook_refusal_repeated_with_the_same_problems_stops_after_the_round_it_repeats_in(agent_ns, monkeypatch):
    inst = _flow_inspire(agent_ns, [({"status": "written", "rows_written": 5}, 3, 4)] * 3)
    gate = agent_ns["implement_gate"]("notebook", ["the Grouping names paymentMethod, but its records were grouped by all into 1 group"],
                                      "group by paymentMethod", "groups ignore the Grouping", "groups ignore the Grouping")
    monkeypatch.setattr(inst, "_implement_preview_gates", lambda *a, **k: [gate], raising=False)
    inst.logger = MagicMock()
    runner = _FakeRunner([{"exit": 0, "final": _fill()}] * 3)
    spec = agent_ns["validate_implement_spec"](VALID)[0]
    outcome, _job, _fill_out = inst._implement_fill_and_preview("N01-U01", (5150, "N01-U01", 1), {}, spec, None, "/W/nb",
                                                                ["result_table", "run_profile"], runner, True)
    assert len(runner.prompts) == 2, "round 2 repeats round 1's refusal, so no third Genie round is sent"
    assert any("[REPEAT-REFUSAL STOP]" in str(c) for c in inst.logger.warning.call_args_list), "the stop is logged"
    assert outcome.get("gate_problems"), "the repeated problem is still reported as not fixed"


def test_a_failed_read_of_group_by_is_logged_and_keeps_its_default_outside_a_proof(agent_ns, monkeypatch, capsys):
    class Widgets:
        def get(self, name):
            raise RuntimeError(f"No input widget named {name}")

    monkeypatch.setitem(agent_ns, "dbutils", type("D", (), {"widgets": Widgets()})())
    assert agent_ns["inspire_widget"]("group_by", "all") == "all"
    assert "[WIDGET-READ FAILED] group_by: " in capsys.readouterr().out


def test_a_failed_read_of_group_by_in_a_grouping_proof_run_stops_with_a_plain_reason(agent_ns, monkeypatch):
    class Widgets:
        def get(self, name):
            if name == agent_ns["INSPIRE_GROUP_PROOF_MARK"]:
                return "1"
            raise RuntimeError(f"No input widget named {name}")

    monkeypatch.setitem(agent_ns, "dbutils", type("D", (), {"widgets": Widgets()})())
    with pytest.raises(BaseException) as caught:
        agent_ns["inspire_widget"]("group_by", "all")
    assert "could not be read" in str(caught.value) and "grouped by all" in str(caught.value)


def test_a_failed_read_of_a_harmless_widget_keeps_its_default_without_a_log(agent_ns, monkeypatch, capsys):
    class Widgets:
        def get(self, name):
            raise RuntimeError(f"No input widget named {name}")

    monkeypatch.setitem(agent_ns, "dbutils", type("D", (), {"widgets": Widgets()})())
    assert agent_ns["inspire_widget"]("run_profile", "full") == "full"
    assert "WIDGET-READ FAILED" not in capsys.readouterr().out


def test_a_data_filter_reads_its_own_use_case_scope_even_when_the_run_global_is_empty(agent_ns, monkeypatch):
    monkeypatch.setitem(agent_ns, "INSPIRE_TABLE_SCOPES", {})
    scopes = _scopes(agent_ns)
    uc = {"Primary Table": TABLE, "Tables Involved": TABLE, "_data_filter_scopes": scopes}
    assert agent_ns["use_case_data_filters"](uc) == [("status", TABLE, "=", ["gold"])]  # REQ-244: the third item is the op, not an exception flag
    other = {"Primary Table": "main.s.customers", "Tables Involved": "main.s.customers"}
    assert agent_ns["use_case_data_filters"](other) == [], "a use case without its own scope gets no filter from a global"



def test_the_excel_carries_the_picked_filter_column_from_the_use_cases_own_scope_when_the_run_global_is_empty(scoped):
    own = scoped["parse_table_scopes"](json.dumps(scope(SALES, ["sku", "product"], [{"column": "product", "op": "=", "values": ["Tokyo Tidbits"]}])))
    assert scoped["INSPIRE_TABLE_SCOPES"] == {}, "the run's Table Scope is empty"
    uc = use_case("N01-U01", [SALES], _data_filter_scopes=own)
    headers, rows, _numeric = make_inspire(scoped)._catalog_export_table({"Sales": [uc]}, {}, "English")
    assert "product" in headers, headers
    assert rows and rows[0][headers.index("product")] == "Tokyo Tidbits", rows[0]
