"""v1.3.0: a Discover run that finds nothing to analyze fails and names why. It used to log a warning and return, so
the job ended SUCCESS and the session was finalized as complete with no use case."""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_run_offline_smoke_test import _build, _Loader, quiet_root_logger  # noqa: E402,F401


def scorer(uc_id):
    return {"use_case_id": uc_id, "quality_label": "High", "quality_score": 4.0, "priority_score": 7.0}


def empty_run(agent_ns, tmp_path, unavailable=()):
    obj = _build(agent_ns, tmp_path, "Good", {"High", "Very High"}, scorer)
    obj.schemas_str = "cat.sch"
    obj.data_loader = _Loader([])
    obj.data_loader._batches = []
    obj.data_loader.metadata_unavailable_report = lambda: {"count": len(unavailable), "tables": list(unavailable)}
    obj.generated = []
    obj._process_batch_with_retry = lambda *a, **kw: obj.generated.append(a) or []
    return obj


def test_a_discover_run_with_no_table_to_analyze_fails(agent_ns, tmp_path, quiet_root_logger):
    obj = empty_run(agent_ns, tmp_path)
    with pytest.raises(RuntimeError) as err:
        obj.run()
    message = str(err.value)
    assert message.startswith("Discovery found nothing to analyze in the UC metadata (schemas: cat.sch): "
                              "no table with columns was found.")
    assert "run again" in message
    assert obj.generated == [] and obj.recorded["tracking"] == [] and obj.recorded["docs"] == []


def test_a_discover_run_whose_tables_could_not_be_loaded_names_them(agent_ns, tmp_path, quiet_root_logger):
    lost = [{"table": "cat.sch.orders", "reason": "PERMISSION_DENIED"}, {"table": "cat.sch.items", "reason": "TIMEOUT"}]
    obj = empty_run(agent_ns, tmp_path, unavailable=lost)
    with pytest.raises(RuntimeError) as err:
        obj.run()
    assert ("2 tables could not be loaded: cat.sch.orders (PERMISSION_DENIED); cat.sch.items (TIMEOUT)") in str(err.value)
    assert "no table with columns was found" not in str(err.value)


def test_a_discover_run_without_a_data_loader_fails(agent_ns, tmp_path, quiet_root_logger):
    obj = empty_run(agent_ns, tmp_path)
    obj.data_loader = None
    obj.schemas_str = ""
    with pytest.raises(RuntimeError) as err:
        obj.run()
    assert str(err.value).startswith("Discovery found nothing to analyze in the UC metadata "
                                     "(no catalog, schema or table given): no table with columns was found.")


def test_a_discover_run_with_tables_still_generates(agent_ns, tmp_path, quiet_root_logger):
    obj = _build(agent_ns, tmp_path, "Good", {"High", "Very High"}, scorer)
    obj.run()
    assert obj.recorded["gen_kwargs"], "a run with readable tables reaches generation"
