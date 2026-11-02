import os

from v120_artifacts_support import FakeSpark
from v142_edits_test import edit_page
from v142_scd_test import CORE, HISTORY, QUOTED, TABLE, _describe, _Tables
from v148_app_hub_test import HISTORY_TYPES

import shell_alerts
import shell_sql

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
LISTED = {"record_key", "entity_id", "entity_label", "priority_tier", "rank"}
BARE = ("record_key", "entity_id", "entity_label", "priority_tier", "rank", "use_case_id", "run_id", "as_of_date")
GONE_SHELL = ("history_problems", "action_problems", "unkept_action_columns", "_columns_problems", "HISTORY_TYPES", "keeps_runs")
GONE_AGENT = ("inspire_ensure_history", "inspire_ensure_actions", "inspire_history_backfill_sql", "inspire_history_pending_sql")
GONE_TEXTS = ("keeps no change history yet", "keeps no actions yet", "rebuild the use case so its runs write", "Rebuild the use case so people",
              "keeps no {', '.join(unkept)} yet", "cannot tell its runs apart to keep their change history", "has no {' or '.join(missing)}",
              "keeps no history of its runs", "rebuild the MVP so its notebook keeps that history")


def _fields(*names, typed=None):
    return shell_sql.change_fields([{"name": n, "type": (typed or {}).get(n, "STRING")} for n in names])


def _read(*parts):
    return open(os.path.join(ROOT, *parts), encoding="utf-8").read()


def test_the_checks_for_tables_an_older_inspire_built_are_gone_from_the_agent_and_the_app_shell(agent_ns):
    assert [n for n in GONE_AGENT if n in agent_ns] == [], "the agent keeps no migration for a result table an older Inspire built"
    assert [n for n in GONE_SHELL if hasattr(shell_sql, n)] == [], "the App shell keeps no check for a result table an older Inspire built"
    server = "".join(_read("agent", "app_shell", "server", f) for f in ("shell_sql.py", "shell_core.py", "shell_alerts.py"))
    web = "".join(_read("agent", "app_shell", "web", "src", f) for f in ("impact.js", "Home.jsx", "hub.js", "Page.jsx"))
    assert [t for t in GONE_TEXTS if t in server + web] == []
    assert "entry.actions" not in web and "entry.closing" not in web and "e.actions" not in web


def test_the_columns_every_result_table_has_are_the_same_in_the_run_and_the_app(agent_ns):
    assert HISTORY_TYPES == {n: k.upper() for n, k in agent_ns["INSPIRE_HISTORY_COLUMNS"]}
    assert {**shell_sql.ACTION_TYPES, **shell_sql.CLOSE_TYPES} == dict(agent_ns["INSPIRE_ACTION_COLUMNS"])
    assert shell_sql.KEPT_TYPES == dict(agent_ns["INSPIRE_KEPT_COLUMNS"])
    created = agent_ns["inspire_history_create_sql"](TABLE, "main.inspire.churn_out_inspire_stage", [n for n, _k in CORE], ("entity_id",))
    for name, kind in agent_ns["INSPIRE_ACTION_COLUMNS"] + agent_ns["INSPIRE_KEPT_COLUMNS"]:
        value = "current_timestamp()" if name == agent_ns["INSPIRE_JOINED_AT"] else f"CAST(NULL AS {kind})"
        assert f"{value} AS `{name}`" in created, name
    for name in shell_sql.HISTORY_COLUMNS:
        assert f" AS {name}" in created, name


def test_the_app_shell_reads_every_column_a_result_table_always_has_without_looking_for_it():
    context = shell_sql.list_context(edit_page(), LISTED, _fields(*BARE), True)
    assert (context["join"], context["actions"], context["changes"], context["unjoined"]) == ("record_key", True, True, "")
    assert "kept" not in context, "the tag column is read on every list, never looked up first"
    request = shell_sql.list_request(edit_page(), {}, context)
    rows = shell_sql.list_queries(edit_page(), {}, request, context, "pat")["rows"][0]
    assert "CAST(`not_listed_since` AS TIMESTAMP) AS `_inspire_missing`" in rows and "`action_owner` AS `_inspire_owner`" in rows
    assert "kept_n" in shell_sql.list_summary_queries(context)["kept"][0]
    page = dict(edit_page(), use_case_id="N01-U05")
    impact = shell_sql.impact_query(page, _fields(*BARE), "2026-10-01")[0]
    for column in ("`realized_value`", "`realized_note`", "`not_listed_since`", "`action_status`", "`use_case_id` = :p0"):
        assert column in impact, column
    digest = shell_sql.digest_query(page["result_table"], _fields(*BARE), use_case="N01-U05")
    assert "`realized_value`" in digest and "acted_n" in digest and "'Records people mark fixed" not in digest
    assert "`as_of_date`" in shell_sql.runs_query(page, _fields("entity_id"))[0]
    added = shell_sql.version_write(page["result_table"], _fields(*BARE), "add", [("k9", None)], "pat", {"entity_id": "k9"})[0]
    assert "ORDER BY `as_of_date` DESC NULLS LAST, `valid_from` DESC LIMIT 1" in added
    used = shell_sql.usage_query(page, "2026-10-01")[0]
    assert "`use_case_id` = :p0 AND" in used


def test_the_columns_a_feature_adds_are_still_read_only_when_the_feature_is_on():
    page = dict(edit_page(), use_case_id="N01-U05")
    plain = shell_sql.impact_query(page, _fields(*BARE), "2026-10-01")[0]
    assert "held_back" not in plain and "value_at_stake" not in plain, "no holdout and no amount at stake, so neither is read"
    held = shell_sql.impact_query(page, _fields(*BARE, "held_back", "run_tier", typed={"held_back": "BOOLEAN"}), "2026-10-01")[0]
    assert "`held_back`" in held and "`run_tier`" in held
    context = shell_sql.list_context(edit_page(), LISTED, _fields(*BARE), True)
    assert context["ai"] == [] and context["categories"] == []
    explained = shell_sql.list_context(edit_page(), LISTED, _fields(*BARE, "ai_explanation", "ai_cat_driver"), True)
    assert explained["ai"] == ["ai_explanation", "ai_cat_driver"]
    untiered = shell_sql.list_context(edit_page(), LISTED, _fields(*(n for n in BARE if n != "priority_tier")), True)
    assert untiered["tier"] is None


def test_an_alert_baseline_needs_no_run_columns_and_still_needs_a_dataset_over_the_result_table(monkeypatch):
    class Alerts(shell_alerts.Alerts):
        def __init__(self, names):
            self.names_seen = names

        def names(self, page):
            return self.names_seen

    page = {"result_table": TABLE, "filters": [], "datasets": [{"name": "records", "sql": f"SELECT * FROM {TABLE}"},
                                                              {"name": "orders", "sql": "SELECT * FROM main.s.orders"}]}
    measures = [{"id": "m", "label": "Loss", "format": "number", "currency": "", "dataset": "records", "expression": "SUM(loss)"},
                {"id": "o", "label": "Orders", "format": "number", "currency": "", "dataset": "orders", "expression": "COUNT(*)"}]
    monkeypatch.setattr(shell_sql, "watch_measures", lambda p: measures)
    loss, orders = Alerts({"loss"}).measures(page)
    assert loss["baseline"] is True and loss["baseline_note"] == "", \
        "run_id and as_of_date are on every result table, so no check asks for them"
    assert orders["baseline"] is False and "does not read the result table" in orders["baseline_note"]
    assert [m["baseline_note"] for m in Alerts(set()).measures(page)] == ["Inspire could not read the result table"] * 2


def test_the_run_still_adds_the_columns_a_feature_or_a_rebuilt_notebook_brings(agent_ns):
    ai = agent_ns["inspire_ensure_ai"]
    spark = FakeSpark()
    added = ai(spark, TABLE, CORE + HISTORY, {"categories": {}, "fingerprint": "f"}, out=lambda *_a: None)
    assert added and spark.statements[0].startswith(f"ALTER TABLE {QUOTED} ADD COLUMNS (ai_explanation STRING"), \
        "AI reasoning is a feature: its columns come when it is turned on"
    statement, names = agent_ns["inspire_add_columns_sql"](TABLE, CORE + HISTORY, CORE + [("new_measure", "DOUBLE")])
    assert names == ["new_measure"] and statement == f"ALTER TABLE {QUOTED} ADD COLUMNS (`new_measure` DOUBLE)", \
        "a notebook rebuilt with a new business column gets it"
    derived, kinds = agent_ns["inspire_holdout_derived"]([n for n, _k in CORE], ("entity_id",), 0.0, CORE + HISTORY + [("held_back", "boolean")])
    assert set(derived) == {"held_back", "run_tier"} and kinds == {"held_back": "BOOLEAN", "run_tier": "STRING"}, \
        "a table that held records back keeps writing the holdout columns after the holdout is turned off"
    assert agent_ns["inspire_holdout_derived"]([n for n, _k in CORE], ("entity_id",), 0.0, CORE + HISTORY) == ({}, {})


def test_the_summary_is_created_with_every_column_and_never_read_or_altered(agent_ns):
    spark = FakeSpark(responder=lambda s: _describe([("use_case_id", "string")]) if s.startswith("DESCRIBE") else [])
    agent_ns["inspire_ensure_summary"](spark, TABLE)
    assert spark.statements == [agent_ns["inspire_ai_summary_create_sql"](TABLE)]
    for name, kind in agent_ns["INSPIRE_SUMMARY_ADDED_COLUMNS"]:
        assert f"{name} {kind}" in spark.statements[0], name


def test_the_result_table_of_a_run_is_never_given_columns_it_lacks(agent_ns):
    tables = _Tables(agent_ns, target=CORE)
    tables.run()
    assert not [s for s in tables.spark.statements if s.startswith(f"ALTER TABLE {QUOTED} ADD COLUMNS")]
    assert not [s for s in tables.spark.statements if "INSERT OVERWRITE" in s or "is_current IS NULL" in s]
