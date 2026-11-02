"""v1.2.0 GATES lane: E0 catalog drift (E-20), dead Phase O body (E-21), the table
utilization report and the executive-summary highlights.

E-20: the drift check issued one information_schema query per cited table and interpolated the
LLM-written schema/table names into the SQL text. It must issue one parameterized query per
catalog, read metadata only, and never report a table as drifted when it could not check it.
"""
import ast
import logging
import os
import sys
import types

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from _agentload import agent_source, load_agent_namespace, method_node  # noqa: E402


@pytest.fixture(scope="module")
def ns():
    return load_agent_namespace()


def make(ns, **attrs):
    cls = ns["DatabricksInspire"]
    obj = cls.__new__(cls)
    obj.logger = logging.getLogger("v120_misc")
    obj.processing_honesty = {}
    obj.data_loader = None
    for k, v in attrs.items():
        setattr(obj, k, v)
    return obj


class FakeDF:
    def __init__(self, rows):
        self.rows = rows

    def collect(self):
        return list(self.rows)


class Row(types.SimpleNamespace):
    def __getitem__(self, k):
        return getattr(self, k)


class FakeSpark:
    def __init__(self, uc_rows, existing, denied=()):
        self.uc_rows = uc_rows
        self.existing = existing
        self.denied = set(denied)
        self.queries = []

    def sql(self, query, args=None):
        self.queries.append((query, dict(args or {})))
        if "information_schema" in query:
            cat = query.split("FROM", 1)[1].strip().split(".", 1)[0].strip("`")
            if cat in self.denied:
                raise PermissionError("PERMISSION_DENIED: information_schema")
            schemas = set((args or {}).values())
            rows = [Row(table_schema=s, table_name=t) for (c, s, t) in self.existing if c == cat and s in schemas]
            return FakeDF(rows)
        return FakeDF(self.uc_rows)


class TestE0CatalogDrift:
    def _rows(self):
        return [
            Row(id="N01-U01", use_case="a", tables_involved="main.shop.orders, main.shop.customers"),
            Row(id="N01-U02", use_case="b", tables_involved="`main`.`shop`.`orders`, main.shop.dropped_table"),
            Row(id="N01-U03", use_case="c", tables_involved="other.crm.accounts"),
            Row(id="N01-U04", use_case="d", tables_involved="locked.fin.ledger"),
            Row(id="N01-U05", use_case="e", tables_involved="main.shop.orders"),
        ]

    def _spark(self):
        existing = {("main", "shop", "orders"), ("main", "shop", "customers"), ("other", "crm", "accounts")}
        return FakeSpark(self._rows(), existing, denied={"locked"})

    def test_drift_detected_with_one_parameterized_query_per_catalog(self, ns, caplog):
        spark = self._spark()
        o = make(ns, spark=spark, _tracking_table_name="main.inspire.__inspire_usecases")
        with caplog.at_level(logging.WARNING, logger="v120_misc"):
            drifted = o._phaseE0_catalog_drift_check(42)
        assert [d["id"] for d in drifted] == ["N01-U02"]
        assert drifted[0]["table"] == "main.shop.dropped_table"
        info_q = [(q, a) for q, a in spark.queries if "information_schema" in q]
        assert len(info_q) == 3
        for q, a in info_q:
            assert "shop" not in q and "crm" not in q and "orders" not in q
            assert a, "schema names must travel as named parameters"
        assert any("locked" in r.getMessage() for r in caplog.records)

    def test_uncheckable_catalog_is_not_reported_as_drift(self, ns):
        spark = self._spark()
        o = make(ns, spark=spark, _tracking_table_name="main.inspire.__inspire_usecases")
        drifted = o._phaseE0_catalog_drift_check(42)
        assert "N01-U04" not in [d["id"] for d in drifted]

    def test_session_id_is_cast_and_no_tracking_table_short_circuits(self, ns):
        o = make(ns, spark=self._spark(), _tracking_table_name="")
        assert o._phaseE0_catalog_drift_check(1) == []
        o2 = make(ns, spark=self._spark(), _tracking_table_name="main.inspire.__inspire_usecases")
        with pytest.raises((ValueError, TypeError)):
            o2._phaseE0_catalog_drift_check("1 OR 1=1")


class TestDeadCodeRemoved:
    def test_e21_phase_o_body_is_gone(self, ns):
        assert not hasattr(ns["DatabricksInspire"], "_phaseO_persist_run_artifacts")
        assert "_phaseO_persist_run_artifacts" not in agent_source()

    def test_no_unreachable_statements_after_return_in_owned_gates(self, ns):
        cls = [n for n in ast.parse(agent_source()).body
               if isinstance(n, ast.ClassDef) and n.name == "DatabricksInspire"][0]
        owned_prefixes = ("_phaseG", "_phaseQ", "_phaseL", "_phaseE0")
        for fn in cls.body:
            if isinstance(fn, ast.FunctionDef) and fn.name.startswith(owned_prefixes):
                body = [s for s in fn.body if not (isinstance(s, ast.Expr) and isinstance(getattr(s, "value", None), ast.Constant))]
                for i, stmt in enumerate(body[:-1]):
                    assert not isinstance(stmt, ast.Return), f"{fn.name}: statements after return"


class TestTableStatistics:
    def test_report_uses_the_discovered_table_universe(self, ns, caplog):
        loader = types.SimpleNamespace(all_table_tuples=[("main", "shop", "orders"), ("main", "shop", "customers"),
                                                          ("main", "shop", "stores"), ("main", "shop", "items")])
        o = make(ns, data_loader=loader)
        ucs = [{"Tables Involved": "main.shop.orders, `main`.`shop`.`customers`"},
               {"Tables Involved": "main.shop.orders, main.shop.ghost"}]
        with caplog.at_level(logging.INFO, logger="v120_misc"):
            o._report_table_statistics(ucs)
        msgs = [r.getMessage() for r in caplog.records]
        assert any("Table Statistics: 2/4 tables included (50.0%), 2 excluded (50.0%)" in m for m in msgs), msgs
        assert not any("No available tables found" in m for m in msgs)


class TestExecutiveSummary:
    def _agent(self, seen):
        def run_worker(step_name, worker_prompt_path, prompt_vars, response_schema, **kw):
            seen.append(prompt_vars)
            return ('"Type","Summary","TransliteratedBusinessName"\n'
                    '"Executive","Exec text","Acme"\n"Sales","Sales text",""\n')
        return types.SimpleNamespace(run_worker=run_worker)

    def test_none_business_value_does_not_force_the_fallback_summary(self, ns):
        seen = []
        o = make(ns, ai_agent=self._agent(seen))
        grouped = {"Sales": [{"Name": "Forecast Demand", "Business Value": None, "Inspire Score": 8.1},
                             {"Name": None, "Business Value": "Cuts stockouts.", "Inspire Score": 6.0}]}
        tr = {"pdf_fallback_summary_p1": "{total_cases} {business_name}", "pdf_fallback_summary_p2": "p2"}
        summary, name = o._get_salesy_summary(grouped, "Acme", "English", tr)
        assert summary.get("Executive") == "Exec text"
        assert seen, "the LLM must still be called"

    def test_highlights_rank_by_inspire_score_not_stale_priority(self, ns):
        seen = []
        o = make(ns, ai_agent=self._agent(seen))
        grouped = {"Sales": [
            {"Name": "Low Score High Priority", "Business Value": "x", "Inspire Score": 4.0, "Priority": 9.5},
            {"Name": "Best Inspire Score", "Business Value": "y", "Inspire Score": 9.0, "Priority": 2.0},
        ]}
        tr = {"pdf_fallback_summary_p1": "{total_cases} {business_name}", "pdf_fallback_summary_p2": "p2"}
        o._get_salesy_summary(grouped, "Acme", "English", tr)
        hl = seen[0]["domain_use_case_highlights"]
        assert hl.index("Best Inspire Score") < hl.index("Low Score High Priority")
