"""v1.2.0 GENIE lane: regenerated instructions persist through one parameter-safe MERGE (G-11), Route 2 lookups are
parameterized, the tracking row restores the elite card, and the live JobLauncher is built from the single embedded
source (G-14 / H-14)."""
import ast
import os
import re
import sys
import threading
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from _agentload import agent_ast, agent_source, method_node
from v120_genie_support import build_inspire, make_uc, tracking_row


class FakeDataFrame:
    def __init__(self, spark, rows, schema):
        self.spark, self.rows, self.schema = spark, rows, schema

    def createOrReplaceTempView(self, name):
        self.spark.views[name] = self.rows


class FakeSpark:
    def __init__(self, fail_on=None, result_rows=None):
        self.sql_calls = []
        self.views = {}
        self.dropped = []
        self.fail_on = fail_on
        self.result_rows = result_rows or []
        spark = self

        class _Catalog:
            @staticmethod
            def dropTempView(name):
                spark.dropped.append(name)

        self.catalog = _Catalog()

    def createDataFrame(self, rows, schema=None):
        return FakeDataFrame(self, rows, schema)

    def sql(self, text, args=None):
        self.sql_calls.append((text, dict(args or {})))
        if self.fail_on and self.fail_on in text:
            raise RuntimeError("DELTA_CONCURRENT_APPEND")
        return MagicMock(collect=MagicMock(return_value=list(self.result_rows)))


def _tracking_inst(agent_ns, spark):
    return build_inspire(agent_ns, spark=spark, _tracking_table_name="main.inspire.__inspire_usecases",
                         _tracking_lock=threading.Lock(), _tracking_unique_view=lambda prefix: f"_inspire_{prefix}_4242_1")


HOSTILE = "Use 'quoted' text; DROP TABLE x; -- \\ backslash \"\"\" and {braces} " + "y" * 200000


def test_regenerated_instructions_merge_through_a_dataframe_view_not_sql_text(agent_ns):
    spark = FakeSpark()
    inst = _tracking_inst(agent_ns, spark)
    ucs = [dict(make_uc("N01-U01"), _source_session_id=7, genie_instruction=HOSTILE, notebook_path="/nb/it's.ipynb"),
           dict(make_uc("N01-U02"), _source_session_id=8, genie_instruction="ok " * 50, notebook_path="/nb/b.ipynb")]
    assert inst._merge_regenerated_ucs_into_tracking(ucs) == 2
    assert len(spark.sql_calls) == 1
    statement = spark.sql_calls[0][0]
    assert statement.startswith("MERGE INTO main.inspire.__inspire_usecases AS t USING _inspire_genie_regen_4242_1 AS s")
    for clause in ("t.has_genie_code = 'Y'", "t.generate_genie_code_instruction = 'No'", "t.genie_instruction = s.genie_instruction",
                   "t.notebook_path = s.notebook_path", "ON t.session_id = s.session_id AND t.id = s.id"):
        assert clause in statement, clause
    assert "DROP TABLE x" not in statement and "it's" not in statement
    assert spark.views["_inspire_genie_regen_4242_1"] == [(7, "N01-U01", HOSTILE, "/nb/it's.ipynb"), (8, "N01-U02", "ok " * 50, "/nb/b.ipynb")]
    assert spark.dropped == ["_inspire_genie_regen_4242_1"]


def test_merge_source_has_one_row_per_session_and_use_case(agent_ns):
    spark = FakeSpark()
    inst = _tracking_inst(agent_ns, spark)
    first = dict(make_uc(), _source_session_id=7, genie_instruction="first " * 40, notebook_path="/nb/a.ipynb")
    second = dict(make_uc(), _source_session_id=7, genie_instruction="second " * 40, notebook_path="/nb/a.ipynb")
    assert inst._merge_regenerated_ucs_into_tracking([first, second]) == 1
    assert spark.views["_inspire_genie_regen_4242_1"] == [(7, "N01-U01", "second " * 40, "/nb/a.ipynb")]


def test_merge_failure_is_raised_and_the_view_is_still_dropped(agent_ns):
    spark = FakeSpark(fail_on="MERGE INTO")
    inst = _tracking_inst(agent_ns, spark)
    with pytest.raises(RuntimeError, match="CONCURRENT"):
        inst._merge_regenerated_ucs_into_tracking([dict(make_uc(), _source_session_id=7, genie_instruction="x" * 200)])
    assert spark.dropped == ["_inspire_genie_regen_4242_1"]


def test_regeneration_flags_reset_in_the_same_statement_not_a_second_update():
    src = agent_source()
    assert "def _update_flag_to_no" not in src
    generate_mode = ast.unparse(method_node("DatabricksInspire", "_run_generate_mode"))
    assert "_update_flag_to_no" not in generate_mode and "_merge_regenerated_ucs_into_tracking(regen)" in generate_mode


def test_route2_lookups_bind_ids_as_parameters(agent_ns):
    hostile_id = "N01-U01' OR '1'='1"
    spark = FakeSpark()
    inst = _tracking_inst(agent_ns, spark)
    inst._scan_notebooks_for_generation_flag = lambda: [
        {"notebook_path": "/nb/a", "use_case_id": hostile_id, "session_id": 7},
        {"notebook_path": "/nb/b", "use_case_id": "N02-U01", "session_id": None},
    ]
    inst._fetch_flagged_use_cases_route2()
    assert len(spark.sql_calls) == 2
    for text, args in spark.sql_calls:
        assert hostile_id not in text and "'1'='1" not in text
    assert hostile_id in spark.sql_calls[0][1].values() and 7 in spark.sql_calls[0][1].values()
    assert "N02-U01" in spark.sql_calls[1][1].values()


def test_row_to_uc_restores_the_elite_card_fields(agent_ns):
    inst = build_inspire(agent_ns)
    row = tracking_row(quality="Very High", quality_mode="Ultra High", elite_status="ELITE", elite_score=8.4,
                       elite_assessment='{"decision": "weekly retention offers", "join_path": ["a", "b"]}',
                       selection_flags='{"coverage_pick_reason": "keeps Sales", "gate_flags": []}')
    uc = inst._row_to_uc(row)
    assert uc["Quality"] == "Very High" and uc["quality_mode"] == "Ultra High" and uc["elite_status"] == "ELITE"
    assert uc["elite_score"] == 8.4 and uc["elite_assessment"]["decision"] == "weekly retention offers"
    assert uc["coverage_pick_reason"] == "keeps Sales"
    broken = inst._row_to_uc(tracking_row(elite_assessment="{not json"))
    assert "elite_assessment" not in broken


def test_live_job_launcher_is_built_from_the_embedded_source(agent_ns):
    module_classes = [n.name for n in agent_ast().body if isinstance(n, ast.ClassDef)]
    assert "JobLauncher" not in module_classes
    assert agent_source().count("class JobLauncher:") == 1
    live = agent_ns["JobLauncher"]
    embedded_ns = {"dbutils": None, "spark": None}
    exec(compile(agent_ns["DatabricksInspire"]._JOB_LAUNCHER_CLASS_SOURCE, "<embedded>", "exec"), embedded_ns)
    embedded = embedded_ns["JobLauncher"]
    live_methods = {k for k, v in vars(live).items() if callable(v) or isinstance(v, staticmethod)}
    embedded_methods = {k for k, v in vars(embedded).items() if callable(v) or isinstance(v, staticmethod)}
    assert live_methods == embedded_methods and "verify_run_alive" in live_methods
    assert "cleanup_job" not in live_methods and {"persistent_job_name", "wait_for_run", "plan_next_scheduled_run"} <= live_methods
    result = {"job_name": "dbx_inspire_ai_acme", "run_name": "dbx_inspire_ai_acme", "run_id": 42, "job_url": "https://h/jobs/1/runs/42"}
    strip = lambda s: re.sub(r"Launched At:\s+\S+ \S+", "Launched At: <ts>", s)
    assert strip(live("/Workspace/nb", {})._build_banner_str(result)) == strip(embedded("/Workspace/nb", {})._build_banner_str(result))
    assert live._sanitize_tag("a b/c") == embedded._sanitize_tag("a b/c") == "a_b_c"


def test_live_job_launcher_banner_is_ascii_like_the_genie_copy(agent_ns):
    banner = agent_ns["JobLauncher"]("/Workspace/nb", {})._build_banner_str({"job_name": "j", "run_name": "j", "run_id": 1, "job_url": ""})
    assert banner.isascii() and "JOB LAUNCHED SUCCESSFULLY" in banner
