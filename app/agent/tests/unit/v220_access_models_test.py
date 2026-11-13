"""v2.2.0 a live walk on a workspace where the App's identity could read nothing and Genie Code hit its rate limit.

A 429 from Genie Code ended a build round at once, so three rate-limited rounds in thirty seconds ended the build; it now
waits with backoff, jitter and any Retry-After the error names, and asks again without using a round. The quality bar
said use cases meet the bar on data it never read, the warning said the readable tables went ahead when none was read,
the value text said AI Enhanced Discovery reads a KPI it did not read, Discover listed one GRANT per table where one
schema grant does, dedup logs named provisional ids the final ranking reuses, and the live log started a minute after the
run did. Two hard-coded model names stood behind no caller.
"""
import ast
import io
import json
import types

import pytest

from _agentload import agent_source, method_node
from v120_artifacts_support import CapturingLogger, FakeSpark, make_inspire

APP_ID = "a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d"
BUSY = ("exceeded retry limit, last status: 429 Too Many Requests: REQUEST_LIMIT_EXCEEDED: Exceeded workspace input "
        "tokens per minute rate limit")


class _Proc:
    def __init__(self, code, error=""):
        line = json.dumps({"type": "error", "message": error}) + "\n" if error else ""
        self.stdout = io.StringIO(line)
        self.stderr = io.StringIO("")
        self.code = code
        self.pid = 999999

    def wait(self):
        return self.code

    def kill(self):
        pass


def _runner(ns, tmp_path, procs, waits):
    ns["_cancellable_sleep"] = lambda seconds, poll_interval=1.0: waits.append(seconds) or False
    calls = []

    def popen(command, **kw):
        calls.append(command)
        return procs[len(calls) - 1]

    runner = ns["GenieCodeRunner"]("https://workspace.example.com/", "tok-123", CapturingLogger(), root=str(tmp_path),
                                   popen=popen)
    runner.genie_path, runner.cli_dir = "/bin/genie", str(tmp_path / "cli")
    return runner, calls


def test_a_rate_limited_genie_waits_and_asks_again_inside_the_same_round(fresh_ns, tmp_path):
    waits = []
    runner, calls = _runner(fresh_ns, tmp_path, [_Proc(1, BUSY), _Proc(1, BUSY), _Proc(0)], waits)
    result = runner.run("build it", str(tmp_path / "w"), label="build")
    assert result["exit"] == 0 and len(calls) == 3
    assert len(waits) == 2 and 20 <= waits[0] <= 25 and 40 <= waits[1] <= 50
    fired = [m for lvl, m in runner.logger.records if "[GENIE-BUSY-RETRY FIRED]" in m]
    assert len(fired) == 2 and "without using a build round" in fired[0] and "attempt 2/5" in fired[0]


def test_a_genie_failure_that_is_not_a_rate_limit_returns_at_once(fresh_ns, tmp_path):
    waits = []
    runner, calls = _runner(fresh_ns, tmp_path, [_Proc(1, "the notebook has a syntax error")], waits)
    result = runner.run("build it", str(tmp_path / "w"), label="build")
    assert result["exit"] == 1 and len(calls) == 1 and waits == []


def test_a_genie_that_stays_rate_limited_gives_up_after_the_attempts(fresh_ns, tmp_path):
    waits = []
    attempts = fresh_ns["GENIE_CODE_BUSY_ATTEMPTS"]
    runner, calls = _runner(fresh_ns, tmp_path, [_Proc(1, BUSY) for _ in range(attempts)], waits)
    result = runner.run("build it", str(tmp_path / "w"))
    assert result["exit"] == 1 and len(calls) == attempts and len(waits) == attempts - 1
    assert max(waits) <= fresh_ns["GENIE_CODE_BUSY_MAX_S"]


def test_the_retry_wait_honours_retry_after_and_otherwise_backs_off_with_jitter(agent_ns):
    wait = agent_ns["inspire_retry_wait"]
    assert wait(1, "429 Too Many Requests, Retry-After: 37") == 37.0
    assert wait(3, "rate limited, please try again in 12s") == 12.0
    assert wait(1, "Retry-After: 900", cap=60) == 60.0
    samples = [wait(2, "429 Too Many Requests", base=10, cap=120) for _ in range(200)]
    assert all(20 <= s <= 25 for s in samples) and len(set(samples)) > 1
    assert wait(9, "503", base=10, cap=120) == 120.0


def test_retry_handler_waits_what_the_service_asks_for(fresh_ns):
    waits = []
    fresh_ns["time"] = types.SimpleNamespace(sleep=waits.append)
    import time as real_time
    original = real_time.sleep
    real_time.sleep = waits.append
    try:
        tries = []

        def call():
            tries.append(1)
            if len(tries) == 1:
                raise RuntimeError("429 Too Many Requests; Retry-After: 7")
            return "ok"

        assert fresh_ns["RetryHandler"].execute_with_retry(call, max_attempts=3, base_delay=1.0) == "ok"
    finally:
        real_time.sleep = original
    assert waits == [7.0]


def test_a_non_idempotent_call_is_asked_again_only_when_it_was_rate_limited(fresh_ns):
    import time as real_time
    original = real_time.sleep
    real_time.sleep = lambda s: None
    try:
        inst = make_inspire(fresh_ns)
        replies = [RuntimeError("429 Too Many Requests"), {"message_id": "m1"}]
        sent = []

        def do(method, path, body=None, query=None):
            sent.append(path)
            reply = replies[len(sent) - 1]
            if isinstance(reply, Exception):
                raise reply
            return reply

        inst.w_client = types.SimpleNamespace(api_client=types.SimpleNamespace(do=do))
        assert inst._implement_api("POST", "/api/2.0/genie/spaces/s1/start-conversation", {"content": "q"}) == {"message_id": "m1"}
        assert len(sent) == 2
        sent.clear()
        replies[:] = [RuntimeError("500 Internal Server Error")]
        with pytest.raises(RuntimeError):
            inst._implement_api("POST", "/api/2.0/genie/spaces/s1/start-conversation", {"content": "q"})
        assert len(sent) == 1, "a server error on a call that is not idempotent may have run, so it is not sent twice"
    finally:
        real_time.sleep = original


def test_the_llm_client_waits_with_the_shared_backoff():
    src = agent_source()
    assert "min(2 ** attempt * 5, 120)" not in src
    assert "wait_time = round(inspire_retry_wait(attempt, e, 10.0, 120.0), 1)" in src


def test_the_value_text_says_what_the_run_read(agent_ns):
    money = {"name": "Ticket revenue", "column": "fare", "aggregation": "AVG", "table": "c.s.t", "unit": "currency"}
    estimate = agent_ns["inspire_value_estimate"]
    unread = estimate({"KPIs": [dict(money)], "Tables Involved": "c.s.t"})
    read = estimate({"KPIs": [dict(money, baseline=None)], "Tables Involved": "c.s.t"})
    assert unread["text"] == ("Value not measured yet: measure Ticket revenue by running its KPI query "
                              "(this run did not read the data for it).")
    assert read["text"] == "Value not measured yet: measure Ticket revenue by running its KPI query (this run ran it and got no value)."


def test_discover_asks_for_one_schema_grant_where_several_tables_of_a_schema_are_unreadable(agent_ns):
    tables = [f"cat.sales.t{i}" for i in range(5)] + ["cat.other.x"]
    grants = agent_ns["inspire_read_grants"](tables, APP_ID, per_schema=True)
    assert grants == [f"GRANT USE CATALOG ON CATALOG `cat` TO `{APP_ID}`",
                      f"GRANT USE SCHEMA, SELECT ON SCHEMA `cat`.`sales` TO `{APP_ID}`",
                      f"GRANT USE SCHEMA ON SCHEMA `cat`.`other` TO `{APP_ID}`",
                      f"GRANT SELECT ON TABLE `cat`.`other`.`x` TO `{APP_ID}`"]
    per_table = agent_ns["inspire_read_grants"](tables[:2], APP_ID)
    assert f"GRANT SELECT ON TABLE `cat`.`sales`.`t0` TO `{APP_ID}`" in per_table, "the Implement preview keeps the least grant"
    assert not any("ON SCHEMA `cat`.`sales` TO" in g and "SELECT" in g for g in per_table)


def test_discover_names_the_schema_grant_in_its_unreadable_text():
    src = agent_source()
    assert 'reads="Discover reads source tables", per_schema=True' in src


def _bar(agent_ns, unreadable, read=()):
    obj = make_inspire(agent_ns, use_cases_quality="Good",
                       discovery_evidence={"profiles": {}, "data_access": {"tables_unreadable": unreadable,
                                                                           "unreadable_reason": "cannot read" if unreadable else "",
                                                                           "tables_read": list(unreadable) + list(read)}})
    obj.emitted = []
    obj._emit_pipeline_status = lambda **kw: obj.emitted.append(kw)
    ucs = [{"No": "U1", "Name": "One", "Tables Involved": "c.s.a", "meets_quality_bar": "Y"},
           {"No": "U2", "Name": "Two", "Tables Involved": "c.s.b", "meets_quality_bar": "Y"},
           {"No": "U3", "Name": "Three", "Tables Involved": "c.s.a", "meets_quality_bar": "N"}]
    return obj, obj._record_quality_bar_outcome("Good", ucs)


def test_the_bar_never_says_a_use_case_meets_it_on_data_it_did_not_read(agent_ns):
    _obj, outcome = _bar(agent_ns, ["c.s.a"])
    assert outcome["message"] == ("2 of 3 use cases meet the Good quality bar on table metadata only: Discover could not read "
                                  "1 table, so 1 use case was not checked against its data")
    _obj, outcome = _bar(agent_ns, ["c.s.a", "c.s.b"])
    assert outcome["message"].endswith("could not read 2 tables, so 2 use cases were not checked against their data")
    _obj, outcome = _bar(agent_ns, [])
    assert outcome["message"] == "2 of 3 use cases meet the Good quality bar"


def test_the_warning_never_says_readable_tables_went_ahead_when_none_was_read(agent_ns):
    obj, _outcome = _bar(agent_ns, ["c.s.a"])
    obj.failed_steps, obj.translation_gaps = [], {}
    obj._metadata_unavailable_report = lambda: {"tables": []}
    warnings = obj._run_outcome_warnings()
    assert any("no table was read, so no use case was checked against its data: cannot read" in w for w in warnings)
    assert not any("went ahead" in w for w in warnings)
    obj.discovery_evidence["data_access"]["tables_read"] += ["c.s.r1", "c.s.r2", "c.s.r3", "c.s.r4"]
    assert any("the evidence covers only the 4 tables it could read" in w for w in obj._run_outcome_warnings())


def test_dedup_and_kind_twin_logs_name_titles_with_their_provisional_ids():
    twins = ast.unparse(method_node("DatabricksInspire", "_collapse_kind_twins"))
    dedup = ast.unparse(method_node("DatabricksInspire", "_dedup_canonical_titles"))
    assert "provisional ids, the final ranking numbers the catalog again" in twins
    assert "titles" in twins and "self._uc_title(use_cases[j])" in twins
    assert "removed from the catalog" in dedup and "self._uc_title(uc)" in dedup


def test_the_hard_veto_log_says_the_use_cases_left_the_bar_not_the_catalog():
    src = ast.unparse(method_node("DatabricksInspire", "_drop_hard_veto_ucs"))
    assert "Dropped" not in src and "left the bar" in src


def test_the_live_log_starts_before_the_model_probes_and_starts_once():
    init = ast.unparse(method_node("DatabricksInspire", "__init__"))
    assert init.index("self._start_live_log_flush_thread()") < init.index("_apply_auto_detected_endpoints(self.logger)")
    assert init.index("self._ensure_inspire_database_exists()") < init.index("self._start_live_log_flush_thread()")
    start = ast.unparse(method_node("DatabricksInspire", "_start_live_log_flush_thread"))
    assert "running.is_alive()" in start


def test_starting_the_live_log_twice_keeps_one_thread(agent_ns, tmp_path):
    obj = make_inspire(agent_ns, local_log_output_dir=str(tmp_path), base_output_dir=str(tmp_path / "out"),
                       operation="Discover Use Cases", generate_genie_instructions=False)
    (tmp_path / "log.txt").write_text("hello\n")
    obj.spark = FakeSpark()
    obj._resolve_live_log_target = lambda: {"dst_path": str(tmp_path / "live.log"), "kind": "volume",
                                            "parent_dir": str(tmp_path)}
    obj._ailogs_live_copy_source = lambda: ""
    obj._start_live_log_flush_thread()
    first = obj._volume_log_thread
    obj._start_live_log_flush_thread()
    try:
        assert obj._volume_log_thread is first
    finally:
        obj._volume_log_stop.set()
        first.join(timeout=5)
    assert (tmp_path / "live.log").read_text() == "hello\n"


def test_no_hard_coded_model_stands_behind_a_dead_name():
    src = agent_source()
    assert "AI_MODEL_NAME" not in src
    assert 'if all_models else "databricks-gpt-oss-20b"' not in src
    assert "worker_llm_config" not in src and "judge_llm_config" not in src


def test_the_delivery_order_puts_every_use_case_that_meets_the_bar_before_any_below_it(agent_ns):
    obj = make_inspire(agent_ns)
    obj.data_loader = types.SimpleNamespace(foreign_key_graph={}, metadata_unavailable_report=lambda: {"count": 0, "tables": []})
    obj.discovery_evidence = {"history_joins": []}
    below = {"elite_status": "FALLBACK_BELOW_BAR"}
    ucs = [{"No": "B1", "Tables Involved": "c.s.a", "Inspire Score": 9.5, **below},
           {"No": "M1", "Tables Involved": "c.s.a", "Inspire Score": 7.0},
           {"No": "B2", "Tables Involved": "c.s.a", "Inspire Score": 9.0, **below},
           {"No": "M2", "Tables Involved": "c.s.b", "Inspire Score": 6.0, "elite_status": "ELITE"},
           {"No": "M3", "Tables Involved": "c.s.a", "Inspire Score": 6.5}]
    foundations = obj._build_data_foundations(ucs)
    assert obj.delivery_order == ["M1", "M3", "M2", "B1", "B2"]
    assert foundations[0]["use_cases"] == ["M1", "M3", "B1", "B2"]
    assert agent_ns["DatabricksInspire"]._final_rank_key(ucs[0]) > agent_ns["DatabricksInspire"]._final_rank_key(ucs[3])
