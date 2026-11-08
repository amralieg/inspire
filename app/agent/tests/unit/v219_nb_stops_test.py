"""v2.1.9 NB STOPS: a build on empty or thin data ends as a working MVP instead of a crash or a wasted repair.

Each test names the stop it guards: 0-row tables, metric views read as tables, a missing secondary table, a
first-run scope with no values, an alert on no rows, a Genie answer without a query, a pre-flight surprise,
and the text these paths write.
"""
import copy
import types

import pytest

from v120_artifacts_support import CapturingLogger, FakeSpark, make_inspire
from v120_modes_main_test import run_main
from v140_implement_test import _FakeRunner, _FileRunner, _fill, _flow_inspire, _output_context, _space
from v142_merge_test import _dashboard_inspire
from v206_genie_self_repair_test import _family, _run, _spec, _stopped
from v218_genie_dimension_test import GOOD_EXAMPLE, LIVE_EXAMPLE, PAGE, _room

EMPTY = "The source table main.sales.orders holds no rows yet."


def test_a_zero_row_genie_stop_spends_no_repair_round_and_ends_written_with_no_rows(agent_ns):
    inst = _family(_flow_inspire(agent_ns, [({"status": "stopped", "stop_reason": EMPTY}, 11, 101)]), "A")
    runner = _FakeRunner([{"exit": 0, "final": _stopped(EMPTY)}])
    outcome, _job, _f = _run(agent_ns, inst, runner, _spec(agent_ns))
    assert len(runner.prompts) == 1, "no repair round is spent on a 0-row shortfall"
    assert outcome["status"] == "written" and outcome["rows_written"] == 0
    assert outcome["no_data"] == agent_ns["INSPIRE_NO_DATA_YET"] == "No data yet; it fills in when rows arrive."
    assert any("[NO-DATA FIRED]" in m for _level, m in inst.logger.records)


def test_a_zero_row_preview_stop_is_kept_as_built_and_a_real_shortfall_is_not(agent_ns):
    inst = _family(_flow_inspire(agent_ns, [({"status": "stopped", "stop_reason": EMPTY}, 11, 101)]), "A")
    outcome, _job, _f = _run(agent_ns, inst, _FakeRunner([{"exit": 0, "final": _fill()}]), _spec(agent_ns))
    assert outcome["status"] == "written" and outcome["rows_written"] == 0 and outcome["no_data"]
    no_data = agent_ns["implement_no_data"]
    assert no_data(EMPTY) and no_data("There are too few usable rows (0); at least 50 are needed.")
    assert not no_data("History holds too few past examples of the outcome (11); at least 200 are needed to learn from.")


def test_the_stop_repair_returns_empty_for_no_rows_and_a_repair_for_a_count_shortfall(agent_ns):
    inst = _flow_inspire(agent_ns, [])
    inst._genie_involved_tables = lambda uc: ["main.sales.orders"]
    spec = _spec(agent_ns)
    empty = inst._implement_stop_repair("N01-U01", {}, spec, {"family": "A"}, EMPTY, _fill(), {})
    assert empty == {"kind": "empty", "no_data": agent_ns["INSPIRE_NO_DATA_YET"]}
    short = inst._implement_stop_repair("N01-U01", {}, spec, {"family": "A"},
                                        "History holds too few past examples of the outcome (11); at least 200 are needed to learn from.",
                                        _fill(), {})
    assert short.get("kind") != "empty" and short.get("feedback")


def test_an_expected_data_refusal_never_ends_as_an_internal_error(agent_ns):
    texts = agent_ns["IMPLEMENT_ORIGIN_TEXT"]
    assert texts["refusal"] == "stopped on a data or settings check"
    assert all("person error" not in str(t) for t in texts.values())


def test_plurals_follow_the_count(agent_ns):
    noun = agent_ns["implement_shortfall_noun"]
    one, many = agent_ns["IMPLEMENT_SHORTFALL_NOUN_ONE"], agent_ns["IMPLEMENT_SHORTFALL_NOUNS"]
    name = next(n for n in one if n in many)
    assert noun({"name": name}, 1) == one[name] and noun({"name": name}, 2) == many[name] and one[name] != many[name]


def test_the_plan_says_builds_on_a_first_build_and_rebuilds_only_when_one_exists(agent_ns):
    message = agent_ns["implement_plan_message"]
    assert message({"refill": True, "classes": ["initial"]}) == "Genie builds the notebook"
    assert message({"refill": True, "classes": ["notebook"]}) == "Genie rebuilds the notebook"


def test_a_long_engine_failure_is_cut_short_without_jvm_text(agent_ns):
    raw = ("[INTERNAL_ERROR] The Spark SQL phase analysis failed with an internal error. You hit a bug in Spark. "
           + "at org.apache.spark.sql.Foo(Foo.scala:12) " * 40 + "JVM stacktrace: py4j.protocol.Py4JJavaError")
    assert len(raw) > 900
    brief = agent_ns["implement_brief_error"](raw)
    assert "org.apache" not in brief and "py4j" not in brief.lower() and "JVM" not in brief
    assert brief.startswith("Spark stopped") and len(brief) < 400 and brief.endswith("The full error is in the run log")
    assert agent_ns["implement_brief_error"]("the column x is missing") == "the column x is missing"


def test_the_name_style_reason_has_its_own_code_r25(agent_ns):
    texts = agent_ns["DatabricksInspire"]._BELOW_BAR_RULE_TEXTS
    assert texts["R25"] == "its title breaks the name rules"
    assert texts["R20"] == "its main table {detail} has no rows yet"


def test_a_metric_view_is_never_read_as_rows(agent_ns):
    spark = FakeSpark()
    ev = agent_ns["DeepEvidence"](spark, None, CapturingLogger(), metric_views=["`main`.`s`.`kpis`"])
    assert ev.is_metric_view("main.s.kpis") and not ev.is_metric_view("main.s.orders")
    with pytest.raises(ValueError, match="metric view"):
        ev.measure_kpi({"table": "main.s.kpis", "column": "amount", "aggregation": "SUM"})
    assert ev.profile_table("`main`.`s`.`kpis`", "main.s.kpis", [("amount", "double")]) is None
    assert not [s for s in spark.statements if "kpis" in s], "no statement reads the metric view's rows"


def test_a_missing_metric_view_is_probed_with_describe_and_a_table_with_limit_0(agent_ns):
    spark = FakeSpark()
    inst = make_inspire(agent_ns, spark=spark)
    inst._metric_views_of = lambda tables: {"main.s.kpis": {}}
    assert inst._implement_missing_tables(["main.s.kpis", "main.s.orders"]) == []
    assert [s for s in spark.statements if "kpis" in s] == ["DESCRIBE TABLE `main`.`s`.`kpis`"]
    assert [s for s in spark.statements if "orders" in s] == ["SELECT * FROM `main`.`s`.`orders` LIMIT 0"]


def test_discover_prefers_the_base_table_and_keeps_the_metric_view_as_a_related_source(agent_ns):
    inst = make_inspire(agent_ns, discovery_evidence={"metric_views": [{"fqn": "main.s.kpis", "source": "main.s.orders"}]})
    assert inst._base_table_first(["main.s.kpis", "main.s.lines"]) == ["main.s.lines", "main.s.kpis"]
    assert inst._base_table_first(["main.s.kpis"], available={"main.s.orders"}) == ["main.s.orders", "main.s.kpis"]
    assert inst._base_table_first(["main.s.lines", "main.s.kpis"]) == ["main.s.lines", "main.s.kpis"]


def test_empty_scanned_tables_skip_metric_views_and_the_message_is_short(agent_ns):
    profiles = {f"main.s.t{i}": {"rows": 0} for i in range(9)}
    profiles.update({"main.s.kpis": {"rows": 0}, "main.s.full": {"rows": 7}})
    inst = make_inspire(agent_ns, discovery_evidence={"profiles": profiles, "metric_views": [{"fqn": "main.s.kpis"}]})
    empty = inst._empty_scanned_tables()
    assert empty == sorted(f"main.s.t{i}" for i in range(9))
    assert inst._empty_tables_note(empty) == "9 tables have no rows yet (main.s.t0, main.s.t1, main.s.t2 +6 more)"
    assert inst._empty_tables_note(["main.s.t0"]) == "1 table has no rows yet (main.s.t0)"


def test_the_summary_is_honest_when_no_use_case_meets_the_bar(agent_ns):
    inst = make_inspire(agent_ns, quality_bar_outcome={"mode": "Balanced", "meets": 0, "message": "None of the 4 use cases found meets"})
    section = inst._summary_quality_bar_section()
    assert section and "None of the 4 use cases found meets" in section and "Balanced" in section
    inst.quality_bar_outcome = {"mode": "Balanced", "meets": 3, "message": "3 of 4"}
    assert inst._summary_quality_bar_section() == ""


def test_business_context_names_the_schema_it_was_given(agent_ns):
    inst = make_inspire(agent_ns, catalogs_str="", schemas_str="main.sales", tables_str="",
                        data_loader=types.SimpleNamespace(all_table_tuples=[("main", "sales", "orders")]))
    scope = inst._business_context_data_scope()
    assert scope == "schemas: main.sales; tables: main.sales.orders"
    inst.schemas_str, inst.data_loader = "", types.SimpleNamespace(all_table_tuples=[])
    assert inst._business_context_data_scope() == agent_ns["CONTEXT_NOT_PROVIDED_MARKER"]
    assert "{data_scope}" in agent_ns["PROMPT_TEMPLATES"]["BUSINESS_CONTEXT_WORKER_PROMPT"]


def _source_inspire(ns, missing):
    inst = make_inspire(ns)
    inst._implement_missing_tables = lambda tables: [{"table": t, "reason": "missing", "error": ""} for t in missing]
    inst._genie_involved_tables = lambda uc: ["main.s.orders", "main.s.returns"]
    inst._genie_table_names = lambda value: [value] if value else []
    inst._implement_role_problems = lambda spec, uc: []
    inst.minimum = []
    inst._implement_data_minimum = lambda key, spec, uc, status, adapt: inst.minimum.append(key)
    inst.updated = []
    inst._implement_update = lambda key, **kw: inst.updated.append(kw)
    inst._implement_builder = lambda: "someone@x"
    inst._implement_builder_label = lambda: "someone"
    return inst


def test_a_missing_secondary_table_is_dropped_with_a_warning_and_only_the_primary_blocks(agent_ns):
    inst = _source_inspire(agent_ns, ["main.s.returns"])
    spec, use_case = {"data": {}}, {"Primary Table": "main.s.orders"}
    inst._implement_source_checks((5150, "N01-U01", 1), spec, use_case, {})
    assert spec["data"]["dropped_tables"] == ["main.s.returns"] and inst.minimum
    assert "main.s.returns is missing or unreadable, so the build leaves it out" in use_case["_implement_source_note"]
    inst._implement_source_checks((5150, "N01-U01", 1), spec, use_case, {})
    assert spec["data"]["dropped_tables"] == ["main.s.returns"], "a rebuild never lists a dropped table twice"
    inst = _source_inspire(agent_ns, ["main.s.orders"])
    status = {}
    with pytest.raises(agent_ns["ImplementBlocked"]):
        inst._implement_source_checks((5150, "N01-U01", 1), {"data": {}}, {"Primary Table": "main.s.orders"}, status)
    assert status["data"]["state"] == "failed" and not inst.minimum


def test_a_first_run_scope_with_no_values_falls_back_to_all_with_a_note(agent_ns, monkeypatch):
    def empty(spark, chosen, run=None):
        raise agent_ns["InspireScopeEmpty"]("MVP Test Run on groups found no value of region in main.s.t; choose all on the Run page")
    monkeypatch.setitem(agent_ns, "inspire_scope_resolve", empty)
    monkeypatch.setitem(agent_ns, "inspire_scope_choice", lambda run, scope, out: {"scope": "groups", "table": "main.s.t"})
    said, scope = [], {}
    chosen = agent_ns["inspire_scope_start"](FakeSpark(), {"scope": {"table": "main.s.t"}}, scope, said.append)
    assert chosen["scope"] == "all" and chosen["fallback"] == "MVP Test Run on groups found no value of region in main.s.t"
    assert said[0] == ("MVP Test Run on groups found no value of region in main.s.t, so this run covers all records instead. Choose "
                       "the MVP Test Run again on the Run page to narrow it")
    assert scope["INSPIRE_SCOPE"] is chosen


def test_a_misconfigured_first_run_scope_still_stops_instead_of_reading_every_row(agent_ns, monkeypatch):
    def broken(spark, chosen, run=None):
        raise ValueError("First run group region names region through a join that is named only in part; choose the groups again")
    monkeypatch.setitem(agent_ns, "inspire_scope_resolve", broken)
    monkeypatch.setitem(agent_ns, "inspire_scope_choice", lambda run, scope, out: {"scope": "groups", "table": "main.s.t"})
    with pytest.raises(ValueError, match="named only in part"):
        agent_ns["inspire_scope_start"](FakeSpark(), {"scope": {"table": "main.s.t"}}, {}, lambda m: None)


def _rows_inspire(ns, result_rows):
    spark = FakeSpark(responder=lambda s: result_rows if s.startswith("SELECT 1 FROM") else [])
    inst = make_inspire(ns, spark=spark)

    def check(sql, require_rows=False, limit=20):
        raise RuntimeError(ns["IMPLEMENT_QUERY_NO_ROWS"])
    inst._implement_run_query_check = check
    return inst


def test_an_alert_on_an_empty_result_table_is_saved_with_a_no_rows_note(agent_ns):
    note = agent_ns["IMPLEMENT_ALERT_NO_ROWS"]
    inst = _rows_inspire(agent_ns, [])
    assert inst._implement_rows_or_empty("SELECT * FROM x", "main.inspire.churn_out", 5, note) == ([], note)
    assert any("[NO-DATA FIRED]" in m for _level, m in inst.logger.records)
    inst = _rows_inspire(agent_ns, [{"1": 1}])
    with pytest.raises(RuntimeError):
        inst._implement_rows_or_empty("SELECT * FROM x", "main.inspire.churn_out", 5, note)


def _genie_build(ns, tmp_path, smoke, space_id):
    inst, _calls = _dashboard_inspire(ns, tmp_path, {("POST", "/api/2.0/genie/spaces"): {"space_id": space_id}})
    inst._implement_run_query_check = lambda sql, require_rows=False, limit=20: [{"n": 1}]
    inst._implement_genie_smoke = smoke
    return inst._implement_genie_space(_output_context(ns), _FileRunner([{"exit": 0}], [{"genie_space.json": _space(grounded=True)}]))


def test_genie_tries_the_next_sample_question_then_keeps_the_agent_with_a_warning(agent_ns, tmp_path):
    asked = []

    def once(space_id, question, **kw):
        asked.append(question)
        if len(asked) == 1:
            raise agent_ns["ImplementGenieNoQuery"]("Genie answered without a query")
        return {"attachments": [{"query": {"query": "SELECT 1"}}]}

    fields = _genie_build(agent_ns, tmp_path, once, "g9")
    assert len(asked) == 2 and asked[0] != asked[1] and fields["genie_space_id"] == "g9"
    assert agent_ns["implement_genie_no_query_warning"]([asked[0]], True) in (fields.get("_notes") or []) + (fields.get("_warnings") or [])

    def never(space_id, question, **kw):
        asked.append(question)
        raise agent_ns["ImplementGenieNoQuery"]("Genie answered without a query")

    asked.clear()
    fields = _genie_build(agent_ns, tmp_path / "b", never, "g8")
    assert fields["genie_space_id"] == "g8" and len(asked) == 2
    assert agent_ns["implement_genie_no_query_warning"](asked, False) in fields["_warnings"]


def test_a_dropped_example_also_drops_its_sample_question(agent_ns, capsys):
    room = _room(examples=[LIVE_EXAMPLE, GOOD_EXAMPLE])
    room["config"] = {"sample_questions": [{"question": copy.deepcopy(LIVE_EXAMPLE["question"])}]}
    space, changed = agent_ns["implement_genie_page_kpis"](room, "N01-U01", PAGE)
    shown = ["".join(q["question"]) for q in space["config"]["sample_questions"]]
    assert changed and shown == ["".join(GOOD_EXAMPLE["question"])]
    assert "action=sample question removed with its SQL" in capsys.readouterr().out


def test_an_unexpected_preflight_error_is_logged_and_the_run_continues(agent_ns, monkeypatch, capsys):
    def boom(spark, database, log_print_fn=None):
        raise RuntimeError("unexpected catalog hiccup")
    monkeypatch.setitem(agent_ns, "_ensure_inspire_database_ready", boom)
    captured = run_main(agent_ns, monkeypatch, True, **{"02_inspire_database": "main.inspire"})
    assert captured["inspire"], "the run starts"
    assert "[PREFLIGHT-CONTINUE FIRED]" in capsys.readouterr().out


def test_the_data_minimum_on_empty_source_data_marks_it_empty_and_spends_no_repair(agent_ns):
    inst = make_inspire(agent_ns)
    inst._implement_signal_record = lambda key, spec, uc: {"status": "failed", "family": "A",
                                                           "reason": "There are too few usable rows (0); at least 50 are needed."}
    inst._signal_check_of = lambda uc: ("A", "outcome")
    inst.updated, inst.emitted = [], []
    inst._implement_update = lambda key, **kw: inst.updated.append(kw)
    inst._implement_emit = lambda *a, **kw: inst.emitted.append(a)
    use_case, status = {}, {}
    inst._implement_data_minimum((5150, "N01-U01", 1), {}, use_case, status)
    assert status["data"] == {"state": "empty", "data_minimum": agent_ns["INSPIRE_NO_DATA_YET"], "spec_version": 1}
    assert use_case["_implement_no_data"].startswith("There are too few usable rows (0)")
    assert inst.emitted[0][3] == "ended_warning" and inst.emitted[0][2].startswith(agent_ns["INSPIRE_NO_DATA_YET"])


def _implement_run(ns, refused):
    inst = make_inspire(ns, inspire_database="main.inspire", atomic_writer=types.SimpleNamespace(_ensure_implement_table=lambda: None))
    inst._implement_targets = lambda: [{"use_case_id": "N01-U01"}]

    def one(target):
        if refused:
            inst.__dict__.setdefault("_implement_refused", set()).add(target["use_case_id"])
        return "failed"
    inst._implement_one = one
    inst.failed_steps = []
    inst._record_failed_step = lambda *a: inst.failed_steps.append(a)
    return inst


def test_a_build_refused_on_a_data_check_never_fails_the_run_but_a_crash_does(agent_ns):
    inst = _implement_run(agent_ns, refused=True)
    inst._run_implement_mode()
    assert inst.failed_steps and any("[IMPLEMENT-REFUSED]" in m for _level, m in inst.logger.records)
    with pytest.raises(RuntimeError, match="The use case MVP failed for N01-U01"):
        _implement_run(agent_ns, refused=False)._run_implement_mode()


def test_an_mvp_test_run_on_all_chosen_in_the_wizard_stays_all(agent_ns):
    chosen = agent_ns["implement_scope_chosen"]({"run_scope": "all"})
    default = agent_ns["inspire_scope_default"]
    assert default({"table": "main.s.t", "default": agent_ns["INSPIRE_FIRST_RUN_DEFAULT"], "chosen": chosen}) == "all"
    assert default({"table": "main.s.t", "default": "all"}) == agent_ns["INSPIRE_FIRST_RUN_DEFAULT"]
