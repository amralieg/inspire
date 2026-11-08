"""The MVP Test Run limits only the records a run scores: training rows are read with purpose='training' and are never narrowed by it,
each run records both scopes and says what it trained on and what it scored, a first build whose run is not reliable publishes the
App with a Results not trusted yet banner while an App already live and trusted is still held back, and a not reliable reason
names the MVP Test Run or Grouping setting only when the facts show that setting caused it."""
import json

import pytest

import v207_unreliable_app_test as v207
from v120_artifacts_support import FakeSpark
from v143_vibes_test import BUILT, LIVE, _left_by
from v177_first_run_test import ORDERS, STORES, FIXTURE, Session
from v207_unreliable_app_test import REASON, _build

COLUMNS = {"`main`.`sales`.`orders`": ["order_id", "region"], "`main`.`sales`.`stores`": ["store_id"]}
RECORDS = {"scope": "records", "table": ORDERS, "records": 1000, "key": "order_id"}
NARROWED = {"started_us": None, "trigger": "schedule", "written": [], "scope": RECORDS,
            "reads": {ORDERS: {"where": "", "limit": 1000}}}
COARSE = {"mode": "columns", "group_by": ["region"], "minimum": 30, "levels": [{"level": "region", "records": 48000, "groups": 4}]}


def test_a_training_read_is_never_narrowed_by_the_mvp_test_run_and_a_scoring_read_is(fresh_ns):
    fresh_ns["INSPIRE_SCOPE"] = dict(RECORDS)
    fresh_ns["INSPIRE_RUN_LOG"] = {}
    read = fresh_ns["inspire_read_source"]
    assert read(ORDERS, spark=Session(COLUMNS)).steps == [("orderBy", "order_id"), ("limit", 1000)]
    assert read(ORDERS, spark=Session(COLUMNS), purpose="training").steps == [], "the training profile reads the full history"
    fresh_ns["INSPIRE_SCOPE"] = {"scope": "groups", "table": ORDERS, "column": "region", "values": ["EMEA"]}
    assert read(ORDERS, spark=Session(COLUMNS), purpose="training").steps == []
    assert read(ORDERS, spark=Session(COLUMNS), purpose="scoring").steps == [("where", "CAST(`region` AS STRING) IN ('EMEA')")]
    log = fresh_ns["INSPIRE_RUN_LOG"]
    assert log["training_reads"] == {ORDERS: {"where": "", "limit": None}}
    assert log["reads"][ORDERS]["where"] == "CAST(`region` AS STRING) IN ('EMEA')"
    with pytest.raises(ValueError, match="purpose"):
        read(ORDERS, spark=Session(COLUMNS), purpose="everything")


def test_each_run_records_the_scope_it_scored_and_the_full_history_it_trained_on(fresh_ns):
    fresh_ns["INSPIRE_RUN"] = {"source_tables": [ORDERS, STORES], "segments": [], "scope": dict(FIXTURE["spec"])}
    fresh_ns["INSPIRE_RUN_LOG"] = dict(NARROWED, reads={ORDERS: {"where": "", "limit": 1000}},
                                       training_reads={ORDERS: {"where": "", "limit": None}, STORES: {"where": "", "limit": None}})

    def respond(statement):
        if statement.startswith("SELECT COUNT(*) AS n FROM (SELECT * FROM `main`.`sales`.`orders`"):
            return [{"n": 1000}]
        if statement.startswith("SELECT COUNT(*) AS n FROM `main`.`sales`.`orders`"):
            return [{"n": 48000}]
        return [{"n": 12}] if statement.startswith("SELECT COUNT(*)") else []
    printed = []
    values = fresh_ns["inspire_save_run_log"](FakeSpark(responder=respond), "main.inspire.churn_out", "N01-U01", "r-9", printed.append)
    tables = {t["table"]: t for t in json.loads(values["run_tables"][1:-1].replace("''", "'"))}
    assert tables[ORDERS]["training_read"] is True and tables[ORDERS]["training_scoped"] is False
    assert tables[ORDERS]["training_rows"] == 48000 == tables[ORDERS]["rows_total"]
    assert tables[STORES]["read_by_helper"] is True and tables[STORES]["training_read"] is True
    assert "the model trained on the full history; it scored the MVP Test Run scope" in printed[-1]


def test_the_training_text_says_it_trained_on_a_sample_and_scored_the_scope(fresh_ns):
    text = fresh_ns["inspire_training_text"]
    fresh_ns["INSPIRE_PREVIEW_SAMPLE"] = 20000
    log = dict(NARROWED, training_reads={ORDERS: {"where": "", "limit": None}})
    said = text(log)
    assert said.startswith("the model trained on a sample of 20,000 records from the full history; it scored the MVP Test Run scope"), said
    fresh_ns.pop("INSPIRE_PREVIEW_SAMPLE")
    assert text(dict(log, scope={"scope": "all"}, reads={})) == "the model trained on the full history"


def test_a_small_mvp_test_run_that_shrank_training_is_named_with_where_to_change_it(fresh_ns):
    cause = fresh_ns["inspire_unreliable_cause"](False, NARROWED, COARSE, {"trains_model": True})
    assert cause.startswith(fresh_ns["INSPIRE_CAUSE_LEAD"]) and "MVP Test Run" in cause
    assert "choose all for MVP Test Run on the Run page" in cause and "Vibe/Add/Remove Features on the Build page" in cause
    fresh_ns["INSPIRE_RUN_LOG"], fresh_ns["INSPIRE_RUN_GROUPING"] = NARROWED, COARSE
    said = fresh_ns["inspire_with_cause"]("no model passed its acceptance check", False)
    assert said.startswith("no model passed its acceptance check. This may come from a setting you can change:"), said


@pytest.mark.parametrize("log", [
    dict(NARROWED, scope={"scope": "all"}, reads={ORDERS: {"where": "", "limit": None}}),
    dict(NARROWED, training_reads={ORDERS: {"where": "", "limit": None}}),
], ids=["full_scope", "training_read_unnarrowed"])
def test_no_setting_is_blamed_when_the_facts_do_not_support_it(fresh_ns, log):
    assert fresh_ns["inspire_unreliable_cause"](False, log, COARSE, {"trains_model": True}) == ""
    fresh_ns["INSPIRE_RUN_LOG"], fresh_ns["INSPIRE_RUN_GROUPING"] = log, COARSE
    assert fresh_ns["inspire_with_cause"]("no model passed", False) == "no model passed"


def test_a_scope_that_trains_nothing_is_not_blamed(fresh_ns):
    assert fresh_ns["inspire_unreliable_cause"](None, NARROWED, COARSE, {}) == ""


def test_grouping_into_tiny_groups_is_named_with_where_to_change_it(fresh_ns):
    fine = {"mode": "columns", "group_by": ["store_id"], "minimum": 30, "levels": [{"level": "store_id", "records": 4000, "groups": 100}]}
    cause = fresh_ns["inspire_unreliable_cause"](False, dict(NARROWED, scope={"scope": "all"}, reads={}), fine, {"trains_model": True})
    assert "Grouping by store_id" in cause and "100 groups of about 40 records" in cause
    assert "change the Grouping on the Run page to fewer columns or all" in cause and "MVP Test Run scope" not in cause
    spilled = {"mode": "columns", "group_by": ["store_id"], "minimum": 30, "levels": [
        {"level": "store_id", "records": 2000, "groups": 10}, {"level": "all", "records": 2000, "groups": 1}]}
    said = fresh_ns["inspire_unreliable_cause"](False, NARROWED, spilled, {"trains_model": True})
    assert "leaves 2,000 of 4,000 records in groups of fewer than 30 records" in said
    assert "in the MVP Test Run scope" in said and "or choose a wider MVP Test Run there" in said


def test_coarse_grouping_over_the_full_history_names_nothing(fresh_ns):
    assert fresh_ns["inspire_small_groups_text"](COARSE) == ""
    assert fresh_ns["inspire_small_groups_text"]({"mode": "none"}) == ""


def test_the_build_requires_and_accepts_a_training_read_for_a_model_on_a_first_run(agent_ns):
    problems = agent_ns["implement_training_read_problems"]
    good = [("Cell 3", f"train = inspire_read_source('{ORDERS}', purpose='training')\nscore = inspire_read_source('{ORDERS}')")]
    assert problems(good) == []
    missing = problems([("Cell 3", f"df = inspire_read_source('{ORDERS}')")])
    assert missing and "purpose='training'" in missing[0]
    assert problems([("Cell 3", f"df = inspire_read_source('{ORDERS}')")], required=False) == []
    assert agent_ns["implement_source_read_problems"](good, [ORDERS]) == [], "a training read is still a read through the helper"
    checked = agent_ns["implement_training_read_checked"]
    assert checked({}, {"first_run": dict(FIXTURE["spec"])}, True) is True
    assert checked({}, {"first_run": dict(FIXTURE["spec"])}, False) is False
    assert checked({}, {}, True) is False


def test_the_genie_rules_tell_a_model_to_read_training_rows_unnarrowed(agent_ns):
    rule = agent_ns["GENIE_TRAINING_READ_RULE"]
    assert "purpose='training'" in rule and "MVP Test Run" in rule


def _first_build(agent_ns, reason, counts=None):
    original, plain_latest = v207._locked, v207._latest

    def locked(ns, previous_outputs=None, responder=None):
        inst, previous = original(ns, previous_outputs, responder)
        built = {k: v for k, v in BUILT.items() if k != "app_name"}
        live = {k: v for k, v in json.loads(json.dumps(LIVE)).items() if k != "app"}
        inst._implement_carried = lambda target: (built, _left_by(2, live))
        return inst, previous
    def latest(inst, said, asked):
        plain = inst.spark.sql

        def sql(text, *args, **kw):
            if "ORDER BY updated_at DESC NULLS LAST LIMIT 1" in text and "not_reliable" in text:
                asked.append(text)
                return v207._Rows([v207._Row(not_reliable=said, **(counts or {}))])
            return plain(text, *args, **kw)
        inst.spark.sql = sql
    v207._locked, v207._latest = locked, latest
    try:
        return _build(agent_ns, "", {"not_reliable": reason, "nothing_to_act": ""})
    finally:
        v207._locked, v207._latest = original, plain_latest


def test_a_first_build_whose_run_is_not_reliable_publishes_the_app_with_the_banner(agent_ns):
    status, final, emitted, built = _first_build(agent_ns, REASON, {"act_now_records": 0, "review_records": 0, "records": 940})
    assert "app" in built and "dashboard" in built, built
    held = final["asset_status"][agent_ns["IMPLEMENT_NOT_RELIABLE"]]
    assert held["reason"] == REASON and held["app"] == "published" and held["monitor"] is True
    assert final["asset_status"]["app"][agent_ns["IMPLEMENT_UNTRUSTED_APP"]] is True
    said = agent_ns["implement_untrusted_app_text"](REASON, True)
    assert said in final["status_message"] and "Results not trusted yet" in said and "every row in Monitor" in said
    messages = [str(e.get("message") or e.get("result_json") or e) for e in emitted if e.get("step_name") == "App"]
    assert any("[UNTRUSTED-PUBLISH FIRED]" in m for m in messages) and not any("[UNRELIABLE-HOLD FIRED]" in m for m in messages)


@pytest.mark.parametrize("counts", [{"act_now_records": 3, "review_records": 0, "records": 940}, {"records": None}, {}],
                         ids=["rows_still_act_now", "stopped_before_rows", "older_summary"])
def test_a_first_build_never_claims_every_row_is_monitor_unless_the_run_shows_it(agent_ns, counts):
    _status, final, _emitted, built = _first_build(agent_ns, REASON, counts)
    held = final["asset_status"][agent_ns["IMPLEMENT_NOT_RELIABLE"]]
    assert "app" in built and held["app"] == "published" and "monitor" not in held
    said = agent_ns["implement_untrusted_app_text"](REASON)
    assert said in final["status_message"] and "Monitor" not in said


def test_a_first_build_whose_run_is_reliable_publishes_without_the_banner(agent_ns):
    _status, final, _emitted, built = _first_build(agent_ns, "")
    assert "app" in built and agent_ns["IMPLEMENT_NOT_RELIABLE"] not in final["asset_status"]
    assert agent_ns["IMPLEMENT_UNTRUSTED_APP"] not in final["asset_status"]["app"]


def test_an_app_live_and_trusted_is_still_held_back(agent_ns):
    _status, final, emitted, built = _build(agent_ns, "", {"not_reliable": REASON, "nothing_to_act": ""})
    assert "app" not in built and "app" not in final["asset_status"][agent_ns["IMPLEMENT_NOT_RELIABLE"]]
    assert any("[UNRELIABLE-HOLD FIRED]" in str(e.get("message") or e.get("result_json") or e) for e in emitted)


def test_only_a_live_app_without_the_banner_counts_as_trusted(agent_ns):
    live = agent_ns["implement_trusted_app_live"]
    assert live({"app": "a"}, {"app": {"state": "ready"}}) is True
    assert live({"app": "a"}, {"app": {"state": "ready", agent_ns["IMPLEMENT_UNTRUSTED_APP"]: True}}) is False
    assert live({}, {}) is False and live({}, {}, {"app": {"id": "a"}}) is True
    assert agent_ns["IMPLEMENT_UNTRUSTED_APP"] in agent_ns["IMPLEMENT_KEPT_ASSET_KEYS"]


def test_the_run_page_says_the_model_trained_on_the_full_history_and_the_scope_limited_only_scoring():
    import shell_core
    import shell_sql
    scope = {"scope": "records", "table": ORDERS, "records": 1000, "key": "records:x", "text": "the first 1,000 records of main.sales.orders"}
    trained = [{"table": ORDERS, "rows": 1000, "rows_total": 48000, "scoped": True, "training_read": True, "training_rows": 48000}]
    facts = shell_sql.scope_facts(scope, trained, 240, 20000)
    assert facts["trained"] == ("The model trained on a sample of 20,000 records from the full history; the MVP Test Run limited only "
                                "the records it scored.")
    assert shell_sql.scope_facts(scope, trained, 240)["trained"].startswith("The model trained on the full history;")
    assert "trained" not in shell_sql.scope_facts(scope, [dict(trained[0], training_read=False)], 240), "no training read, no claim"
    assert "trained" not in shell_sql.scope_facts({"scope": "all", "key": "all"}, trained, 240)
    view = shell_core.run_view({"run_id": "r3"}, {"run_segments": json.dumps([scope]), "run_tables": json.dumps(trained),
                                                  "run_started_at": None, "preview_sample_entities": 20000}, {"filters": []})
    assert view["tables"][0]["training_read"] is True and view["tables"][0]["training_rows"] == 48000
    assert view["facts"]["trained"].startswith("The model trained on a sample of 20,000 records")
    plain = shell_core.run_view({"run_id": "r3"}, {"run_segments": json.dumps([scope]), "run_tables": json.dumps(
        [{"table": ORDERS, "rows": 1000, "rows_total": 48000}])}, {"filters": []})
    assert "training_read" not in plain["tables"][0] and "trained" not in plain["facts"]


def test_the_run_summary_is_told_what_the_model_trained_on_and_what_it_scored(fresh_ns):
    asked = []

    def reply(statement):
        if "ai_query(" in statement:
            asked.append(statement)
            return [{"r": {"result": "Forty bills need a call now.", "errorMessage": None}}]
        return []
    write = lambda: fresh_ns["inspire_write_summary"]({"act_now": "40 bills"}, "main.inspire.churn_out", "r-1", "2099-01-01",
                                                      spark_session=FakeSpark(responder=reply), endpoint="ep", context="", out=lambda m: None)
    fresh_ns["INSPIRE_PREVIEW_SAMPLE"] = 20000
    fresh_ns["INSPIRE_RUN_LOG"] = dict(NARROWED, training_reads={ORDERS: {"where": "", "limit": None}})
    write()
    assert ("Training and scoring: the model trained on a sample of 20,000 records from the full history; it scored the MVP Test Run "
            "scope, the first 1,000 records of main.sales.orders.") in asked[0].replace("''", "'")
    fresh_ns["INSPIRE_RUN_LOG"] = dict(NARROWED)
    write()
    assert "Training and scoring" not in asked[1], "no training read, no training claim"
