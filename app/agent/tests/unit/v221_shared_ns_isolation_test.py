import pytest

pytest.importorskip("pandas")


def test_a_grouping_run_on_the_shared_namespace_records_its_grouping(agent_ns):
    import pandas as pd
    records = pd.DataFrame({"store": [1, 2] * 5, "paid": [1.0] * 10})
    agent_ns["inspire_group_records"](records, group_by="store", out=lambda *_a: None)
    agent_ns["V221_PROBE"] = "set"
    assert agent_ns["INSPIRE_RUN_GROUPING"]["group_by"] == ["store"]


def test_the_next_test_never_sees_the_grouping_or_names_the_last_test_added(agent_ns):
    assert "INSPIRE_RUN_GROUPING" not in agent_ns
    assert "V221_PROBE" not in agent_ns
