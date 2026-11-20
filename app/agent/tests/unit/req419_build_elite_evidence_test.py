"""REQ-419: a build run (MVP) has no scan loader, so data_loader is None. Its data-signal check reads the metadata evidence of the use case's
tables through the metadata-only loader Genie already uses, instead of failing with AttributeError on None."""
import copy
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from v120_livefix_test import EVIDENCE, uc  # noqa: E402


class Loader:
    def __init__(self):
        self.requests = []

    def get_metadata_evidence(self, tables):
        self.requests.append(sorted(tables))
        return {t: copy.deepcopy(EVIDENCE[t]) for t in tables if t in EVIDENCE}


def build_run(ns):
    obj = ns["DatabricksInspire"].__new__(ns["DatabricksInspire"])
    obj.logger = logging.getLogger("req419")
    obj.data_loader = None
    return obj


def test_a_build_run_reads_the_metadata_evidence_through_the_metadata_only_loader(agent_ns, caplog):
    obj = build_run(agent_ns)
    loader = Loader()
    obj._genie_metadata_only_loader = loader
    with caplog.at_level(logging.WARNING, logger="req419"):
        evidence = obj._load_elite_evidence([uc("Forecasting", "c.s.channel_lines")])
    assert loader.requests == [["c.s.channel_lines"], ["c.s.date_dim", "c.s.item_dim", "c.s.party"]]
    assert set(evidence) == {"c.s.channel_lines", "c.s.date_dim", "c.s.item_dim", "c.s.party"}
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR], "no AttributeError is logged on a build run"


def test_a_build_run_with_no_loader_at_all_returns_no_evidence_and_logs_no_error(agent_ns, caplog, monkeypatch):
    obj = build_run(agent_ns)
    monkeypatch.setattr(obj, "_ensure_genie_metadata_loader", lambda: None)
    with caplog.at_level(logging.WARNING, logger="req419"):
        assert obj._load_elite_evidence([uc("Forecasting", "c.s.channel_lines")]) == {}
    assert not [r for r in caplog.records if r.levelno >= logging.ERROR]


def test_a_discover_run_keeps_reading_through_its_own_scan_loader(agent_ns):
    obj = build_run(agent_ns)
    scan = Loader()
    obj.data_loader = scan
    obj._genie_metadata_only_loader = Loader()
    evidence = obj._load_elite_evidence([uc("Forecasting", "c.s.channel_lines")])
    assert scan.requests and obj._genie_metadata_only_loader.requests == []
    assert "c.s.channel_lines" in evidence
