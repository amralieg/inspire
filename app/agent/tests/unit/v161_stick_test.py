"""MVPs people keep using: a team capacity on Act now, a run that is not reliable yet says so and keeps its alert quiet, one row of
the result means the use case's subject, and the weekly email reports what people acted on and what it was worth."""
import re
import sqlite3
import types
import zlib

import pytest

from v120_artifacts_support import FakeSpark
from v142_scd_test import CORE, GOOD_PROFILE, HISTORY, OUTCOME, QUOTED, QUOTED_STAGE, QUOTED_SUMMARY, STAGE, SUMMARY, TABLE, _describe

sqlglot = pytest.importorskip("sqlglot")

ACTIONS = [("action_owner", "string"), ("action_status", "string"), ("action_due", "date"), ("action_note", "string"),
           ("dismiss_reason", "string"), ("action_outcome", "string"), ("realized_value", "double"), ("realized_note", "string")]


def _crc32(text):
    return zlib.crc32(str(text).encode("utf-8"))


def _sqlite_rows(sql, tables):
    tree = sqlglot.parse_one(sql, read="databricks")
    for table in tree.find_all(sqlglot.exp.Table):
        table.set("catalog", None)
        table.set("db", None)
    db = sqlite3.connect(":memory:")
    db.create_function("CRC32", 1, _crc32)
    for name, rows in tables.items():
        columns = list(rows[0])
        db.execute(f'CREATE TABLE "{name}" ({", ".join(chr(34) + c + chr(34) for c in columns)})')
        db.executemany(f'INSERT INTO "{name}" VALUES ({", ".join("?" for _ in columns)})', [tuple(r[c] for c in columns) for r in rows])
    cursor = db.execute(tree.sql(dialect="sqlite"))
    names = [c[0] for c in cursor.description]
    return [dict(zip(names, row)) for row in cursor.fetchall()]


def _stage_row(entity, rank, tier):
    return {"entity_id": entity, "rank": rank, "priority_tier": tier, "use_case_id": "N01-U01"}


STAGE_ROWS = [_stage_row("e6", 6, "Act now"), _stage_row("e1", 1, "Act now"), _stage_row("e2", 2, "Act now"),
              _stage_row("e3", 3, "Act now"), _stage_row("e4", 4, "Act now"), _stage_row("e5", 5, "Act now"),
              _stage_row("e7", 7, "Review"), _stage_row("e8", 8, "Monitor")]
TARGET_ROWS = [{"record_key": "e2", "use_case_id": "N01-U01", "is_current": 1, "change_source": "action", "action_status": "Dismissed"},
               {"record_key": "e3", "use_case_id": "N01-U01", "is_current": 0, "change_source": "action", "action_status": "Dismissed"},
               {"record_key": "e4", "use_case_id": "N01-U02", "is_current": 1, "change_source": "action", "action_status": "Dismissed"}]
COLUMNS = ["entity_id", "rank", "priority_tier", "use_case_id"]


def test_the_capacity_keeps_the_top_n_by_rank_and_never_counts_a_dismissed_or_held_back_record(agent_ns):
    seats = agent_ns["inspire_capacity_seats_sql"](STAGE, COLUMNS, ("entity_id",), 0.0, TABLE, "N01-U01")
    moved = agent_ns["inspire_capacity_merge_sql"](STAGE, COLUMNS, ("entity_id",), 3, seats)
    tables = {"churn_out_inspire_stage": STAGE_ROWS, "churn_out": TARGET_ROWS}
    picked = _sqlite_rows(f"SELECT k, seat FROM ({seats}) AS q ORDER BY seat", tables)
    assert [(r["k"], r["seat"]) for r in picked] == [("e1", 1), ("e3", 2), ("e4", 3), ("e5", 4), ("e6", 5)], \
        "e2 is dismissed now, so it never takes a seat; e3 was dismissed only in a closed version and e4 in another use case"
    over = _sqlite_rows(moved.split(" USING (", 1)[1].rsplit(") AS c ON ", 1)[0], tables)
    assert sorted(r["k"] for r in over) == ["e5", "e6"]
    assert moved.startswith(f"MERGE INTO {QUOTED_STAGE} AS t USING (SELECT k FROM (")
    assert moved.endswith("AS q WHERE seat > 3) AS c ON CAST(t.`entity_id` AS STRING) = c.k WHEN MATCHED THEN UPDATE SET `priority_tier` = 'Review'")
    share = 0.5
    held = {r["entity_id"] for r in STAGE_ROWS if _crc32(f"N01-U01|{r['entity_id']}") % 10000 < 5000}
    with_holdout = agent_ns["inspire_capacity_seats_sql"](STAGE, COLUMNS, ("entity_id",), share)
    got = [r["k"] for r in _sqlite_rows(f"SELECT k FROM ({with_holdout}) AS q ORDER BY seat", {"churn_out_inspire_stage": STAGE_ROWS})]
    expected = [r["entity_id"] for r in sorted(STAGE_ROWS, key=lambda r: r["rank"]) if r["priority_tier"] == "Act now" and r["entity_id"] not in held]
    assert held and got == expected, "a record the holdout keeps off the list never takes one of the team's seats"


def test_the_capacity_is_read_from_the_run_controls_and_only_a_whole_number_of_one_or_more_counts(agent_ns):
    read = agent_ns["inspire_act_now_capacity"]
    assert [read({"act_now_capacity": v}) for v in (25, 1, 0, -3, "25", 2.5, True, None)] == [25, 1, None, None, None, None, None, None]
    assert read({}) is None


class _CapTables:
    def __init__(self, ns, seats, target=None, outcome=None):
        self.ns, self.seats, self.target = ns, seats, target
        self.outcome = OUTCOME if outcome is None else outcome
        self.spark = FakeSpark(responder=self.respond)

    def respond(self, statement):
        if statement == f"DESCRIBE TABLE {QUOTED_STAGE}":
            return _describe(CORE)
        if statement == f"DESCRIBE TABLE {QUOTED}":
            if self.target is None:
                raise RuntimeError(f"[TABLE_OR_VIEW_NOT_FOUND] The table or view {QUOTED} cannot be found.")
            return _describe(self.target)
        if statement == f"DESCRIBE TABLE {QUOTED_SUMMARY}":
            return _describe(SUMMARY)
        if statement.startswith("SELECT COUNT(*) AS seats FROM ("):
            return [{"seats": self.seats}]
        if statement.startswith("SELECT COUNT_IF(t.`priority_tier` = 'Act now') AS act_now_records"):
            return [self.outcome]
        if statement.startswith("SELECT COUNT(*) AS row_count, COUNT(DISTINCT use_case_id)"):
            return [GOOD_PROFILE]
        if statement.startswith("SELECT COUNT(*) AS kept"):
            return [{"kept": 0}]
        if statement == "SELECT unix_micros(current_timestamp()) AS now":
            return [{"now": 1_793_000_000_000_000}]
        if statement.startswith("DESCRIBE HISTORY"):
            return [{"version": 7}]
        if statement.startswith("MERGE INTO") and QUOTED in statement.split(" USING ")[0]:
            return [{"num_inserted_rows": 3, "num_updated_rows": 0}]
        return []

    def run(self, **kw):
        printed = []
        self.ns["inspire_merge_run"](self.spark, TABLE, STAGE, out=printed.append, **kw)
        return self.spark.statements, printed

    def summary_merge(self):
        return next(s for s in self.spark.statements if s.startswith(f"MERGE INTO {QUOTED_SUMMARY} ") and "`act_now_records`" in s)


def test_a_run_over_the_team_capacity_moves_the_rest_to_review_and_records_how_many_wait(agent_ns):
    tables = _CapTables(agent_ns, seats=5, target=CORE + HISTORY + ACTIONS)
    statements, printed = tables.run(capacity=3)
    seats = [s for s in statements if s.startswith("SELECT COUNT(*) AS seats FROM (")]
    assert len(seats) == 1 and "action_status = 'Dismissed'" in seats[0], "an existing table's dismissed records never take a seat"
    moved = [s for s in statements if s.startswith(f"MERGE INTO {QUOTED_STAGE} ")]
    assert len(moved) == 1 and "WHERE seat > 3" in moved[0] and moved[0].endswith("UPDATE SET `priority_tier` = 'Review'")
    assert statements.index(moved[0]) < statements.index(next(s for s in statements if s.startswith(f"MERGE INTO {QUOTED} "))), \
        "the stage is capped before the run's rows become the current records"
    assert ("Team capacity: 5 records passed the Act now test and the team acts on 3 each run, so the top 3 records by rank stay Act "
            "now and the other 2 records move to Review, where the App says the capacity holds them back") in printed
    merge = tables.summary_merge()
    assert "`act_now_capacity` = 3, `over_capacity_records` = 2" in merge and "`not_reliable`" not in merge


def test_a_run_within_the_capacity_or_without_one_changes_no_tier(agent_ns):
    within = _CapTables(agent_ns, seats=2, target=None)
    statements, printed = within.run(capacity=3)
    seats = [s for s in statements if s.startswith("SELECT COUNT(*) AS seats FROM (")]
    assert seats and "Dismissed" not in seats[0], "a first run has no dismissed records to leave out"
    assert not [s for s in statements if s.startswith(f"MERGE INTO {QUOTED_STAGE} ")]
    assert "Team capacity: 2 records passed the Act now test, within the 3 the team acts on each run" in printed
    assert "`act_now_capacity` = 3, `over_capacity_records` = 0" in within.summary_merge()
    uncapped = _CapTables(agent_ns, seats=99, target=CORE + HISTORY)
    statements, printed = uncapped.run()
    assert not [s for s in statements if "AS seats" in s or s.startswith(f"MERGE INTO {QUOTED_STAGE} ")]
    assert not [p for p in printed if p.startswith("Team capacity")] and "`act_now_capacity`" not in uncapped.summary_merge()


def test_a_run_whose_model_missed_acceptance_writes_no_actionable_row_and_says_it_is_not_reliable_yet(agent_ns):
    given = "The best candidate's out-of-time AUC was 0.58 and this use case needs 0.70."
    tables = _CapTables(agent_ns, seats=9, target=CORE + HISTORY, outcome={"act_now_records": 0, "review_records": 0, "records": 3})
    statements, printed = tables.run(capacity=3, accepted=False, nothing_to_act=given)
    update = f"UPDATE {QUOTED_STAGE} SET `priority_tier` = 'Monitor' WHERE `priority_tier` IN ('Act now', 'Review')"
    assert update in statements and statements.index(update) < statements.index(
        next(s for s in statements if s.startswith(f"MERGE INTO {QUOTED} "))), "the run's own tiers never reach the list"
    assert not [s for s in statements if "AS seats" in s], "a run that is not reliable has no Act now row to cap"
    merge = tables.summary_merge()
    assert f"`not_reliable` = '{given.replace(chr(39), chr(92) + chr(39))}'" in merge and "`act_now_capacity`" not in merge
    assert ("Not reliable yet: the run passed accepted=False, so Inspire writes its 'Act now' and 'Review' rows as 'Monitor'") in printed
    assert next(p for p in printed if p.startswith("Business output: 0 Act now")) == (
        "Business output: 0 Act now and 0 Review of 3 current records, so the App shows the run as not reliable yet, "
        f"and its alert and weekly email say so too: {given}")


@pytest.mark.parametrize("found,accepted,given,reason", [
    ({"records": 4}, False, "", "No model passed this use case's acceptance check in the last run; the run did not say which threshold "
     "the model missed or what it measured, so build the notebook again with Vibe/Add/Remove Features on the Build page so it names them."),
    ({"records": 4}, False, "the candidate did not clear the out-of-time acceptance thresholds",
     "the candidate did not clear the out-of-time acceptance thresholds; the run did not say which threshold the model missed or what it "
     "measured, so build the notebook again with Vibe/Add/Remove Features on the Build page so it names them."),
    ({"records": 4}, False, "  AUC 0.55 is below 0.60.  ", "AUC 0.55 is below 0.60."),
    ({"records": 3, "flagged_records": 3, "top_flag": "data ends 2026-08-31"}, None, "",
     "Every record has a data quality issue, most often: data ends 2026-08-31."),
    ({"records": 3, "flagged_records": 3}, True, "", "Every record has a data quality issue."),
    ({"records": 3, "flagged_records": 2}, None, "", None),
    ({"records": 0}, True, "", None),
    ({"records": 4}, None, "No record passed.", None),
])
def test_a_run_is_not_reliable_when_acceptance_failed_or_every_record_is_flagged(agent_ns, found, accepted, given, reason):
    assert agent_ns["inspire_not_reliable"](found, accepted, given) == reason


def test_the_write_hands_the_run_s_acceptance_to_the_merge(fresh_ns):
    seen = []
    fresh_ns["inspire_merge_run"] = lambda spark, table, stage, **kw: seen.append(kw.get("accepted")) or 3
    frame = types.SimpleNamespace(schema=types.SimpleNamespace(fields=[]), write=types.SimpleNamespace(
        mode=lambda *_a: types.SimpleNamespace(option=lambda *_b: types.SimpleNamespace(saveAsTable=lambda *_c: None))))
    for accepted in (None, True, False):
        assert fresh_ns["inspire_write_result"](frame, TABLE, spark_session=FakeSpark(), out=lambda *_a: None, accepted=accepted) == 3
    assert seen == [None, True, False]


def _write_missed(fresh_ns, widgets, **kw):
    seen = []
    fresh_ns["INSPIRE_SETTINGS_APPLIED"] = widgets
    fresh_ns["inspire_merge_run"] = lambda spark, table, stage, **given: seen.append(given.get("nothing_to_act")) or 3
    frame = types.SimpleNamespace(schema=types.SimpleNamespace(fields=[]), write=types.SimpleNamespace(
        mode=lambda *_a: types.SimpleNamespace(option=lambda *_b: types.SimpleNamespace(saveAsTable=lambda *_c: None))))
    fresh_ns["inspire_write_result"](frame, TABLE, spark_session=FakeSpark(), out=lambda *_a: None, **kw)
    return seen[0]


def test_a_run_that_missed_acceptance_names_each_threshold_it_missed_with_the_bar_and_the_measured_value(fresh_ns):
    said = _write_missed(fresh_ns, {"min_auc": "0.7", "max_mase": "1"}, accepted=False, missed={"min_auc": 0.58, "max_mase": 1.25},
                         nothing_to_act="the candidate did not clear the out-of-time acceptance thresholds")
    assert said == ("No model passed this use case's acceptance check in the last run: Minimum AUC to accept a model is 0.7, and this "
                    "run measured 0.58; Maximum MASE to accept a forecast is 1, and this run measured 1.25.")
    assert fresh_ns["inspire_not_reliable"]({"records": 4}, False, said) == said
    assert _write_missed(fresh_ns, {}, accepted=False, nothing_to_act="AUC 0.55 is below 0.60.") == "AUC 0.55 is below 0.60."


@pytest.mark.parametrize("widgets,kw,error", [
    ({"min_auc": "0.7"}, {"accepted": True, "missed": {"min_auc": 0.58}}, "takes missed= only with accepted=False"),
    ({"min_auc": "0.7"}, {"accepted": False, "missed": {}}, "takes missed={<threshold widget>: <measured value>}"),
    ({"min_auc": "0.7"}, {"accepted": False, "missed": {"auc": 0.58}}, "keyed by a threshold widget"),
    ({"min_auc": "0.7"}, {"accepted": False, "missed": {"min_auc": "0.58"}}, "with a number, not '0.58'"),
    ({"min_auc": "0.7"}, {"accepted": False, "missed": {"min_auc": float("nan")}}, "with a number"),
    ({}, {"accepted": False, "missed": {"min_auc": 0.58}}, "has no min_auc widget holding a number"),
    ({"min_auc": "0.7"}, {"accepted": False, "missed": {"min_auc": 0.71}}, "it measured 0.71 and the bar is 0.7, which it meets"),
    ({"max_mase": "1"}, {"accepted": False, "missed": {"max_mase": 0.9}}, "it measured 0.9 and the bar is 1, which it meets"),
])
def test_a_missed_threshold_the_run_cannot_back_with_a_bar_and_a_failing_value_stops_the_write(fresh_ns, widgets, kw, error):
    with pytest.raises(ValueError, match=re.escape(error)):
        _write_missed(fresh_ns, widgets, **kw)


def test_the_threshold_labels_come_from_the_widget_labels_and_ship_in_the_run_controls(agent_ns):
    labels = agent_ns["INSPIRE_THRESHOLD_LABELS"]
    assert labels["min_auc"] == agent_ns["GENIE_WIDGET_LABELS"]["min_auc"] and "result_table" not in labels
    assert all(name.startswith(("min_", "max_")) for name in labels) and len(labels) >= 20
    source = agent_ns["IMPLEMENT_RESULT_HISTORY_SOURCE"]
    assert "INSPIRE_THRESHOLD_LABELS = {}" in source, "a run without the labels still loads"
    for rule in (agent_ns["GENIE_PREDICTED_ACCEPTED_RULE"], agent_ns["GENIE_MEASURED_TIER_RULE"]):
        assert "missed={'min_auc': 0.58}" in rule and "the metrics that missed" not in rule
    note = agent_ns["IMPLEMENT_UNRELIABLE_NOTE"].format(reason="r.", method="m")
    assert "inspire_write_result(..., accepted=False, missed={<threshold widget>: <measured value>})" in note


def test_a_stopped_run_records_why_it_is_not_reliable_yet_for_the_app_the_alert_and_the_email(agent_ns):
    spark, printed = FakeSpark(responder=lambda s: _describe(SUMMARY) if s == f"DESCRIBE TABLE {QUOTED_SUMMARY}" else []), []
    run = {"result_table": TABLE, "use_case_id": "N01-U01"}
    reason = "No usable rows were found for this use case: 12 rows, at least 200 needed."
    stopped = {"status": "stopped", "stop_reason": f"  {reason} "}
    assert agent_ns["inspire_record_stop"](run, stopped, spark, printed.append) == reason
    merge = [s for s in spark.statements if s.startswith(f"MERGE INTO {QUOTED_SUMMARY} ")]
    assert len(merge) == 1 and f"`not_reliable` = '{reason}', `nothing_to_act` = '{reason}'" in merge[0]
    run_id = re.search(r"'(stopped-[0-9a-f-]{36})' AS run_id\) AS n ON", merge[0]).group(1)
    assert printed == [f"Not reliable yet: run {run_id} stopped before it wrote any record, so the App, the alert and the weekly email "
                       f"show the use case as not reliable yet: {reason}"], "a stop gets its own run row, so it is the latest one"
    plain = FakeSpark()
    assert agent_ns["inspire_record_stop"](run, {"status": "stopped"}, plain, lambda *_a: None) == agent_ns["INSPIRE_NOT_RELIABLE_STOPPED"]
    for outcome, where in (({"status": "written", "run_id": "r-1"}, run), (None, run), (stopped, {"result_table": TABLE})):
        quiet = FakeSpark()
        assert agent_ns["inspire_record_stop"](where, outcome, quiet, lambda *_a: None) is None and quiet.statements == []
    broken, said = FakeSpark(responder=lambda s: (_ for _ in ()).throw(RuntimeError("PERMISSION_DENIED")) if s.startswith("MERGE") else []), []
    assert agent_ns["inspire_record_stop"](run, stopped, broken, said.append) is None
    assert said and said[0].startswith("Not reliable yet: run stopped-") and "could not record why" in said[0]


def test_the_run_controls_record_a_stop_right_after_the_use_case_returns(agent_ns):
    template = agent_ns["GENIE_RUN_CONTROLS_TEMPLATE"]
    assert ("                try:\n                    outcome = inspire_run_use_case(use_case, globals().get(\"spark\"))\n                except InspireRunStop as stop:\n"
            "                    outcome = {\"status\": \"stopped\", \"stop_reason\": str(stop)}\n                    out(str(stop))\n"
            "                except Exception as caught:\n                    missing = inspire_failure_text(caught)\n"
            "                    out(f\"Use case outcome: {missing}.\")\n                    raise InspireOutcomeMissing(missing) from caught\n"
            "                missing = inspire_outcome_problem(outcome)\n                if missing:\n"
            "                    out(f\"Use case outcome: {missing}.\")\n                    raise InspireOutcomeMissing(missing)\n"
            "                inspire_record_stop(run, outcome, out=out)\n") in template


def test_the_summary_table_holds_the_capacity_and_the_reliability_of_each_run(agent_ns):
    added = [name for name, _kind in agent_ns["INSPIRE_SUMMARY_ADDED_COLUMNS"]]
    assert added[-4:] == ["act_now_capacity", "over_capacity_records", "not_reliable", "run_facts"]
    assert "act_now_capacity BIGINT, over_capacity_records BIGINT, not_reliable STRING, run_facts STRING, updated_at TIMESTAMP)" in \
        agent_ns["inspire_ai_summary_create_sql"](TABLE)


def test_a_measured_run_that_misses_acceptance_is_told_to_pass_accepted_false_and_leave_the_tiers_to_inspire(agent_ns):
    rule = agent_ns["GENIE_MEASURED_TIER_RULE"]
    assert "a candidate or a baseline that misses acceptance, or a test that is not significant, never moves a row to Monitor" not in rule
    assert ("When the method has an acceptance rule, pass `accepted` to inspire_write_result, True when the model or rule whose rows the "
            "run writes passed it and False when none did") in rule
    assert "inspire_write_result then writes every 'Act now' and 'Review' row as 'Monitor'" in rule and "not reliable yet" in rule


from v140_implement_test import VALID, _spec  # noqa: E402


def test_the_team_capacity_is_checked_and_kept_on_the_spec_only_when_the_wizard_sends_it(agent_ns):
    out, errors = _spec(agent_ns)
    assert errors == [] and "capacity" not in out, "a spec that sends no capacity cleans to the same spec the App builds"
    assert _spec(agent_ns, capacity={"act_now": 50, "source": "user"})[0]["capacity"] == {"act_now": 50, "source": "user"}
    assert _spec(agent_ns, capacity={"act_now": " 40 "})[0]["capacity"] == {"act_now": 40, "source": "default"}
    assert _spec(agent_ns, capacity={"act_now": None, "source": "default"})[0]["capacity"] == {"act_now": None, "source": "default"}
    assert _spec(agent_ns, capacity={"act_now": "", "source": "USER"})[0]["capacity"] == {"act_now": None, "source": "user"}
    for capacity, error in (({"act_now": 0}, "capacity act_now 0 must be a whole number of rows from 1 to 1000000, or empty for no cap"),
                            ({"act_now": -5}, "capacity act_now -5 must be a whole number of rows from 1 to 1000000"),
                            ({"act_now": 2.5}, "capacity act_now 2.5 must be a whole number of rows"),
                            ({"act_now": "ten"}, "capacity act_now 'ten' must be a whole number of rows"),
                            ({"act_now": True}, "capacity act_now true must be a whole number of rows"),
                            ({"act_now": 1000001}, "capacity act_now 1000001 must be a whole number of rows from 1 to 1000000"),
                            ({"act_now": 5, "source": "guess"}, "capacity source 'guess' must be one of default, user"),
                            ("50", "capacity must be an object")):
        assert error in " ".join(_spec(agent_ns, capacity=capacity)[1]), capacity
    limit = agent_ns["implement_act_now_capacity"]
    assert [limit(c) for c in ({"act_now": 50}, {"act_now": None}, {}, None, {"act_now": "50"}, {"act_now": True})] == \
        [50, None, None, None, None, None]


def test_a_capacity_only_edit_is_its_own_change_and_rebuilds_nothing(agent_ns):
    classes = agent_ns["IMPLEMENT_CHANGE_CLASSES"]
    assert classes[classes.index("holdout"):classes.index("holdout") + 3] == ("holdout", "capacity", "outputs")
    before = _spec(agent_ns, capacity={"act_now": 50, "source": "default"})[0]
    after = _spec(agent_ns, capacity={"act_now": 20, "source": "user"})[0]
    classify, plan = agent_ns["classify_implement_change"], agent_ns["implement_plan"]
    assert classify(before, after) == ["capacity"]
    assert classify(before, _spec(agent_ns, capacity={"act_now": 50, "source": "user"})[0]) == [], "only the number changes the runs"
    assert classify(_spec(agent_ns)[0], _spec(agent_ns, capacity={"act_now": None, "source": "default"})[0]) == [], \
        "an uncapped spec is the same as one that never sent a capacity"
    assets = {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "preview_run_id": 7}
    out = plan(before, after, assets, has_built_notebook=True)
    assert (out["classes"], out["refill"], out["preview"], out["build"], out["refresh"]) == (["capacity"], False, False, [], [])


def test_the_run_controls_bake_the_team_capacity_into_the_notebook(agent_ns):
    import ast as _ast
    inst = agent_ns["DatabricksInspire"].__new__(agent_ns["DatabricksInspire"])
    inst.business_name = "Acme"
    spec = {"job_slug": "s", "job_tags": {}, "schedule_cron": "", "wait_minutes": 5, "result_table": TABLE, "use_case_id": "N01-U01",
            "decision_basis": "predicted", "value_type": "score", "action_target": "the list"}
    inst._genie_widget_names = lambda instruction, spec: []
    inst._genie_involved_tables = lambda uc: []
    for capacity, expected in (({"act_now": 40, "source": "user"}, 40), ({"act_now": None, "source": "default"}, None), (None, None)):
        use_case = {"Name": "Desk", "Business Value": "Margin", **({"_implement_capacity": capacity} if capacity is not None else {})}
        run = inst._genie_run_controls_source(use_case, spec, "Build").split("\nINSPIRE_RUN = ", 1)[1].split("\n\n\n", 1)[0]
        assert _ast.literal_eval(run)["act_now_capacity"] == expected, capacity
    from _agentload import agent_source
    assert 'use_case["_implement_capacity"] = spec.get("capacity") or {}' in agent_source(), "the build hands the spec's capacity on"


def test_the_notebook_choices_name_the_capacity_and_the_entity_the_person_picked(agent_ns):
    spec = agent_ns["validate_implement_spec"](dict(VALID, capacity={"act_now": 25, "source": "user"}, data=dict(
        VALID["data"], column_roles={"entity_id": "main.s.orders_v2.customer_id"})))[0]
    text = agent_ns["implement_choices_markdown"](spec)
    assert ("- Team capacity: the team acts on at most 25 rows in 'Act now' each run. Write each row's tier by the use case's rule and "
            "never cap the tiers yourself: inspire_write_result keeps the top 25 by rank in 'Act now' and moves the rest to 'Review', "
            "and the App says how many the capacity holds back.") in text
    assert ("- Use `main.s.orders_v2.customer_id` as the entity id column: the user chose it, so one row of the business output is one "
            "`customer_id`; when `main.s.orders_v2` holds several rows for one `customer_id`, group them into that one row and build "
            "its values from all of them.") in text
    plain = agent_ns["implement_choices_markdown"](agent_ns["validate_implement_spec"](dict(VALID, capacity={"act_now": None}))[0])
    assert "Team capacity" not in plain and "as the entity id column" not in plain


def test_the_weekly_email_is_on_unless_the_person_turns_it_off(agent_ns):
    alert = {**VALID["outputs"], "alert": True, "alert_recipients": ["owner@example.com"]}
    out, errors = _spec(agent_ns, outputs=alert)
    assert errors == [] and "alert_digest" not in out["outputs"], "a spec that sends no choice cleans to the same spec the App builds"
    assert _spec(agent_ns, outputs=dict(alert, alert_digest=False))[0]["outputs"]["alert_digest"] is False
    assert _spec(agent_ns, outputs=dict(alert, alert_digest=True))[0]["outputs"]["alert_digest"] is True
    assert "outputs.alert_digest must be true or false, not 'no'" in _spec(agent_ns, outputs=dict(alert, alert_digest="no"))[1]
    assert "alert_digest" not in _spec(agent_ns, outputs=dict(VALID["outputs"], alert_digest=False))[0]["outputs"], "no alert, no email"
    digest = agent_ns["implement_alert_digest"]
    assert [digest(o) for o in ({}, None, {"alert_digest": True}, {"alert_digest": False})] == [True, True, True, False]
    classify, plan = agent_ns["classify_implement_change"], agent_ns["implement_plan"]
    before, after = _spec(agent_ns, outputs=alert)[0], _spec(agent_ns, outputs=dict(alert, alert_digest=False))[0]
    assert classify(before, after) == ["outputs"]
    assert classify(before, _spec(agent_ns, outputs=dict(alert, alert_digest=True))[0]) == [], "on by default and on by choice are the same"
    assets = {"dashboard": "d1", "genie_space": "g1", "app": "churn-desk", "alert": "al-1", "preview_run_id": 7}
    assert plan(before, after, assets, has_built_notebook=True)["refresh"] == ["alert"]


from v140_implement_test import ALERT, SHELL_SQL, _alert_inspire, _output_context  # noqa: E402

SUMMARY_NAME = "churn_out_summary"


def _result_row(entity, tier):
    return {"entity_id": entity, "priority_tier": tier, "is_current": 1, "change_source": "run", "use_case_id": "N01-U01",
            "run_id": "r-2", "as_of_date": "2026-10-20"}


def _summary_row(run, at, unreliable=None, use_case="N01-U01", **counts):
    return dict({"use_case_id": use_case, "run_id": run, "updated_at": at, "not_reliable": unreliable, "nothing_to_act": None,
                 "act_now_records": None, "over_capacity_records": None, "act_now_capacity": None}, **counts)


@pytest.mark.parametrize("summary,fired", [
    ([_summary_row("r-1", "2026-10-01 06:00:00"), _summary_row("r-2", "2026-10-02 06:00:00", "AUC 0.55 is below 0.60.")], 0),
    ([_summary_row("r-1", "2026-10-03 06:00:00"), _summary_row("r-2", "2026-10-02 06:00:00", "AUC 0.55 is below 0.60.")], 1),
    ([_summary_row("r-1", "2026-10-01 06:00:00"), _summary_row("r-9", "2026-10-05 06:00:00", "Too few rows.", use_case="N01-U02")], 1),
    ([_summary_row("r-0", "2026-09-01 06:00:00", use_case="N01-U02")], 1),
])
def test_the_alert_never_fires_on_a_run_that_is_not_reliable_yet(agent_ns, summary, fired):
    outputs = _spec(agent_ns, outputs={**VALID["outputs"], **ALERT})[0]["outputs"]
    built = agent_ns["implement_alert_query"](SHELL_SQL, TABLE, outputs, "", "N01-U01")
    assert (built["column"], built["operator"], built["threshold"]) == ("alert_value", "GREATER_THAN_OR_EQUAL", 1.0)
    tables = {"churn_out": [_result_row("a", "Act now"), _result_row("b", "Act now")], SUMMARY_NAME: summary}
    row = _sqlite_rows(built["query"], tables)[0]
    assert (row["alert_value"], bool(row["not_reliable"])) == (fired, not fired), summary
    either = agent_ns["implement_alert_query"](SHELL_SQL, TABLE, outputs, "SELECT TRUE AS triggered", "N01-U01")
    assert _sqlite_rows(either["query"], tables)[0]["alert_value"] == fired, "the person's own condition is quiet on that run too"
    plain = agent_ns["implement_alert_query"](SHELL_SQL, TABLE, outputs)
    assert plain["column"] == "tier_rows" and "not_reliable" not in plain["query"], "without a summary table the alert is as before"


def test_the_alert_build_reads_the_run_summary_and_says_it_stays_quiet_on_a_run_that_is_not_reliable(agent_ns, tmp_path):
    inst, calls, queries = _alert_inspire(agent_ns, tmp_path)
    context = dict(_output_context(agent_ns, **ALERT), summary_table="main.inspire.churn_out_summary")
    inst._implement_alert(context, None)
    [alert] = [b for m, p, b, _q in calls if (m, p) == ("POST", "/api/2.0/alerts")]
    assert alert["evaluation"]["source"]["name"] == "alert_value"
    assert ("SELECT `not_reliable` IS NOT NULL FROM `main`.`inspire`.`churn_out_summary` WHERE `use_case_id` = 'N01-U01' ORDER BY "
            "`updated_at` DESC NULLS LAST LIMIT 1") in alert["query_text"] and queries[0] == alert["query_text"]
    assert ("Quiet when not reliable: it never fires on a run Inspire marks not reliable yet, such as one whose model or rule missed "
            "its acceptance check or one that stopped on too little data.") in alert["custom_description"]
    texts = agent_ns["implement_alert_texts"](__import__("shell_alerts"), "N01-U01", {"Name": "Predict churn"},
                                              _output_context(agent_ns, **ALERT)["spec"]["outputs"])
    assert "Quiet when not reliable" in texts[1]


def test_turning_the_weekly_email_off_deletes_the_one_built_and_builds_none(agent_ns, tmp_path):
    inst, calls, _q = _alert_inspire(agent_ns, tmp_path)
    del inst._implement_digest
    inst._implement_app_shell = lambda: (None, {"shell_sql": SHELL_SQL, "shell_alerts": __import__("shell_alerts")})
    inst.spark = FakeSpark()
    context = dict(_output_context(agent_ns, **ALERT, alert_digest=False), asset_status={"alert": {"state": "ready", "digest_id": "dg-7"}})
    fields = inst._implement_alert(context, None)
    assert [p for m, p, _b, _q2 in calls if m == "DELETE"] == ["/api/2.0/alerts/dg-7"]
    assert len([p for m, p, _b, _q2 in calls if (m, p) == ("POST", "/api/2.0/alerts")]) == 1, "only the alert itself is saved"
    assert "digest_id" not in fields["_asset"] and "_warnings" not in fields
    assert any("weekly impact email is off" in m for _l, m in inst.logger.records)


def _digest_workspace(summary):
    import v149_impact_test as impact
    ws = impact.Workspace()
    names = list(_summary_row("r", "t"))
    ws.db.execute(f'CREATE TABLE "loss_desk_out_summary" ({", ".join(chr(34) + n + chr(34) for n in names)})')
    ws.db.executemany(f'INSERT INTO "loss_desk_out_summary" VALUES ({", ".join("?" for _ in names)})',
                      [tuple(r[n] for n in names) for r in summary])
    return impact, ws


@pytest.mark.parametrize("summary,status", [
    ([_summary_row("r3", "2026-10-13 06:00:00", act_now_records=4), _summary_row("r4", "2026-10-20 06:00:00", "AUC 0.55 is below 0.60.",
                                                                                  use_case="N01-U05")],
     ("Not reliable yet", "Not reliable yet: AUC 0.55 is below 0.60.")),
    ([_summary_row("r4", "2026-10-20 06:00:00", use_case="N01-U05", act_now_records=50, over_capacity_records=2950, act_now_capacity=50)],
     ("50 to act on now", "50 records to act on now; 2,950 more records would qualify for Act now, but the team capacity of 50 a run "
                          "holds them in Review.")),
    ([_summary_row("r4", "2026-10-20 06:00:00", use_case="N01-U05", act_now_records=1, over_capacity_records=1, act_now_capacity=1)],
     ("1 to act on now", "1 record to act on now; 1 more record would qualify for Act now, but the team capacity of 1 a run holds it "
                         "in Review.")),
    ([_summary_row("r4", "2026-10-20 06:00:00", use_case="N01-U05", act_now_records=0,
                   nothing_to_act="No record passed this use case's decision test in the last run.")],
     ("Nothing to act on yet", "Nothing to act on yet, because no record passed this use case's decision test in the last run.")),
    ([_summary_row("r4", "2026-10-20 06:00:00", use_case="N01-U05", act_now_records=0, nothing_to_act="AUC was 0.51.")],
     ("Nothing to act on yet", "Nothing to act on yet, because AUC was 0.51.")),
    ([_summary_row("r9", "2026-10-20 06:00:00", "Other use case.")], ("Not run yet", "No run of this use case has written its results yet.")),
])
def test_the_weekly_email_opens_with_the_latest_run_and_reports_what_people_acted_on_and_its_money(agent_ns, summary, status):
    impact, ws = _digest_workspace(summary)
    fields = impact.shell_sql.change_fields([{"name": c, "type": impact.TYPES.get(c, "STRING")} for c in impact.COLUMNS])
    week = impact.shell_sql.digest_query(impact.TABLE, fields, label="entity_label", use_case="N01-U05", impact={"kind": "money", "unit": "USD"},
                                         since="CAST('2026-10-06' AS DATE)", status_table="main.pricing.loss_desk_out_summary")
    rows = ws.run_sql("wh1", week, [])["rows"]
    assert [(r["figure"], r["amount"]) for r in rows][:3] == [("Latest run", status[0]), ("Money at stake now (estimated)", "1,550 USD"),
                                                              ("Acted on this week", "1,250 USD")]
    assert rows[0]["how"] == status[1]
    assert rows[2]["how"] == "3 records people marked fixed or could not fix this week, with this much at stake on them when they did"
    assert [r["figure"] for r in rows][3:] == ["Reported by people this week", "Measured by later runs this week", "Closed this week",
                                               "Recommendations people said were wrong", "Held back to measure impact"]
    plain = impact.shell_sql.digest_query(impact.TABLE, fields, label="entity_label", use_case="N01-U05", impact={"kind": "money", "unit": "USD"},
                                          since="CAST('2026-10-06' AS DATE)")
    assert "Latest run" not in plain and "loss_desk_out_summary" not in plain, "without the summary table the email has no status row"


def test_the_weekly_email_says_what_its_new_rows_mean_and_the_build_hands_it_the_summary_table(agent_ns, tmp_path):
    import shell_alerts
    shell = {"shell_sql": SHELL_SQL, "shell_alerts": shell_alerts}
    body = agent_ns["implement_digest_body"](shell, "N01-U01", {"Name": "Predict churn"}, "SELECT 1", "wh1",
                                             [{"user_name": "owner@example.com"}], {}, "")
    assert ("Latest run: whether the last run gives a list to act on, and if not, why: Not reliable yet or Nothing to act on yet, "
            "with the reason.") in body["custom_description"]
    assert ("Acted on this week: the money at stake on the records people marked fixed or could not fix this week, when they did."
            ) in body["custom_description"]
    from _agentload import agent_source
    assert 'status_table=context.get("summary_table") or ""' in agent_source()


def test_the_dashboard_says_plainly_whether_the_latest_run_can_be_acted_on(agent_ns, tmp_path):
    from v142_dash_test import _canvas, _page, _palettes, _shell
    shell_sql = _shell(agent_ns, tmp_path)
    page = _page(agent_ns)
    plain = agent_ns["implement_dashboard_from_page"](page, shell_sql, "main.inspire.churn_out", {})
    assert "run_status" not in [d["name"] for d in plain["datasets"]]
    doc = agent_ns["implement_dashboard_from_page"](page, shell_sql, "main.inspire.churn_out", {}, status_table="main.inspire.churn_out_summary",
                                                    theme=agent_ns["implement_dashboard_theme"](_palettes()))
    dataset = next(d for d in doc["datasets"] if d["name"] == "run_status")
    sql = "".join(dataset["queryLines"])
    assert sql == shell_sql.run_status_query("main.inspire.churn_out_summary", page["use_case_id"])
    sqlglot.parse_one(sql, read="databricks")
    overview = _canvas(doc)[0]["layout"]
    status = next(w for w in overview if w["widget"]["name"] == "run_status")
    assert [(c["fieldName"], c["displayName"]) for c in status["widget"]["spec"]["encodings"]["columns"]] == [
        ("headline", "Latest run"), ("sentence", "What it means")]
    assert status["position"]["y"] == 2 and status["position"]["width"] == 12, "it sits right under the page title"
    names = [w["widget"]["name"] for w in overview]
    assert names.index("run_status") < names.index("records")
    assert agent_ns["check_dashboard_definition"](doc, ["main.inspire.churn_out", "main.s.orders", "main.inspire.churn_out_summary"],
                                                  shell_sql.RECORDS_DATASET)[1] == []


def test_the_build_warns_not_reliable_yet_with_the_reason_the_run_recorded(agent_ns):
    from v120_genie_support import build_inspire
    inst = build_inspire(agent_ns)
    reason = "The best candidate's out-of-time AUC was 0.58 and this use case needs 0.70."
    rows = {"SELECT nothing_to_act, not_reliable FROM": [{"nothing_to_act": reason, "not_reliable": reason}]}
    inst.spark = FakeSpark(responder=lambda s: next((v for k, v in rows.items() if s.startswith(k)), []))
    inst._implement_tier_counts = lambda table: {"Monitor": 4}
    inst._implement_emit = lambda *a, **k: None
    said = ("Not reliable yet: the latest run marked its results not reliable and wrote why in not_reliable of "
            f"{agent_ns['inspire_ai_summary_table'](TABLE)}, which the App shows")
    assert inst._implement_tier_warning("N01-U01", TABLE, "", "r-9") == said and "0.58" not in said
    assert agent_ns["implement_not_reliable_text"](TABLE) == said
    rows["SELECT nothing_to_act, not_reliable FROM"] = [{"nothing_to_act": "No record has 1,000 USD or more at stake.", "not_reliable": None}]
    assert inst._implement_tier_warning("N01-U01", TABLE, "", "r-9") == "", "a reliable run with nothing to act on is not a warning"


def test_the_app_reads_the_reliability_and_the_capacity_of_the_latest_run(tmp_path):
    import v147_app_ai_test as ai
    run = dict(ai.RUN, not_reliable="AUC 0.55 is below 0.60.", act_now_capacity=50, over_capacity_records=2950)
    s, _ws, _made = ai.shell(tmp_path, ws=ai.AiWorkspace(summary=run))
    status, out = ai.call(s, "GET", "summary", query={"page": "n01_u05"})
    assert status == 200
    assert (out["run"]["not_reliable"], out["run"]["act_now_capacity"], out["run"]["over_capacity_records"]) == ("AUC 0.55 is below 0.60.", 50, 2950)


def test_a_stopped_run_keeps_the_money_and_ai_settings_of_the_run_before_so_the_app_still_explains_its_money(agent_ns):
    before = {"currency": "USD", "decision_basis": "measured", "act_now_amount": 5000.0, "review_amount": 1000.0,
              "value_formula": "{loss:money} lost", "value_expression": None, "value_assumptions": "[]", "ai_endpoint": "ep",
              "ai_config": "{\"categories\": {}}", "accepted": True}

    def respond(statement):
        if statement.startswith("SELECT `currency`, `decision_basis`"):
            return [before]
        return _describe(SUMMARY) if statement == f"DESCRIBE TABLE {QUOTED_SUMMARY}" else []
    spark = FakeSpark(responder=respond)
    run = {"result_table": TABLE, "use_case_id": "N01-U01"}
    agent_ns["inspire_record_stop"](run, {"status": "stopped", "stop_reason": "Too few rows."}, spark, lambda *_a: None)
    read = next(s for s in spark.statements if s.startswith("SELECT `currency`"))
    assert read.endswith(f"FROM {QUOTED_SUMMARY} WHERE use_case_id = 'N01-U01' ORDER BY updated_at DESC NULLS LAST LIMIT 1")
    merge = next(s for s in spark.statements if s.startswith(f"MERGE INTO {QUOTED_SUMMARY} "))
    assert ("`currency` = 'USD', `decision_basis` = 'measured', `act_now_amount` = 5000.0, `review_amount` = 1000.0, `value_formula` = "
            "'{loss:money} lost', `value_assumptions` = '[]', `ai_endpoint` = 'ep', `ai_config` = '{\"categories\": {}}', `not_reliable` = "
            "'Too few rows.', `nothing_to_act` = 'Too few rows.'") in merge
    assert "`value_expression`" not in merge and "`accepted`" not in merge, "only what is set is carried, and never the last run's verdict"
