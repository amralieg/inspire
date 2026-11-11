"""An add-column vibe on a table adds the column. A dataset that only gains a select item for that column does not change the
filters, KPIs and tables that read it, so the untargeted guard never puts the shared dataset back and holds the version."""
import copy

import pytest

from v120_artifacts_support import FakeSpark
from v140_implement_test import _inspire
import shell_sql

ASSET = "app:page:n01_u01"
RECORDS = "records"
RECORDS_SQL = ("SELECT record_key, entity_label, priority_tier FROM main.inspire.n01_out "
               "WHERE run_id = (SELECT MAX(run_id) FROM main.inspire.n01_out)")
WIDENED_SQL = ("SELECT record_key, entity_label, priority_tier, loyalty_tier FROM main.inspire.n01_out "
               "WHERE run_id = (SELECT MAX(run_id) FROM main.inspire.n01_out)")
FILTERED_SQL = RECORDS_SQL + " AND priority_tier IS NOT NULL"
LOYALTY = {"column": "loyalty_tier", "label": "Loyalty tier", "format": "text"}
ASK = {"ask": "Add a Loyalty tier column next to each traveler profile in the match review table.", "where": "the match review table",
       "draws": "table", "keep": False, "check": {"kind": "column", "value": "Loyalty tier"}}


def _page(records_sql=RECORDS_SQL, extra_columns=()):
    return {"id": "n01_u01", "use_case_id": "N01-U01", "title": "Traveler match review", "result_table": "main.inspire.n01_out",
            "datasets": [{"name": RECORDS, "sql": records_sql}],
            "filters": [{"id": "priority", "type": "multi_select", "label": "Priority", "columns": {RECORDS: "priority_tier"}}],
            "kpis": [{"id": "flagged", "label": "Flagged", "dataset": RECORDS, "expression": "COUNT(*)", "format": "number"}],
            "charts": [], "tables": [],
            "records": {"title": "Traveler match review", "key": "record_key", "label": "entity_label", "rank": "rank",
                        "tier": "priority_tier", "columns": [{"column": "entity_label", "label": "Traveler", "format": "text"}]
                        + list(extra_columns), "detail": []}}


def _widened():
    return _page(WIDENED_SQL, [LOYALTY])


@pytest.mark.parametrize("old, new", [
    (RECORDS_SQL, WIDENED_SQL),
    ("SELECT a FROM t", "SELECT a, b FROM t"),
    ("SELECT a, COALESCE(x, y) AS c FROM t", "SELECT a, COALESCE(x, y) AS c, d FROM t"),
    ("SELECT * FROM t", "SELECT *, b FROM t"),
    ("SELECT a, b FROM t", "SELECT b, a, c FROM t"),
])
def test_a_query_that_only_adds_select_items_is_widened(agent_ns, old, new):
    assert agent_ns["implement_query_widened"](old, new) is True


@pytest.mark.parametrize("old, new", [
    ("SELECT a FROM t", "SELECT a FROM t"),
    ("SELECT a, b FROM t", "SELECT a, c FROM t"),
    ("SELECT a, b FROM t", "SELECT a FROM t"),
    ("SELECT a FROM t", "SELECT a, b FROM t WHERE b > 0"),
    ("SELECT a FROM t WHERE x = 1", "SELECT a, b FROM t WHERE x = 2"),
    ("SELECT DISTINCT a FROM t", "SELECT DISTINCT a, b FROM t"),
    ("SELECT a FROM t", "SELECT DISTINCT a, b FROM t"),
    ("WITH c AS (SELECT a FROM t) SELECT a FROM c", "WITH c AS (SELECT a FROM t) SELECT a, b FROM c"),
    ("SELECT EXTRACT(YEAR FROM d) AS y FROM t", "SELECT EXTRACT(YEAR FROM d) AS y, b FROM t"),
    ("", "SELECT a FROM t"),
    (None, "SELECT a, b FROM t"),
])
def test_a_query_that_changes_rows_or_drops_an_item_is_not_widened(agent_ns, old, new):
    assert agent_ns["implement_query_widened"](old, new) is False


def test_an_add_column_ask_on_the_table_leaves_the_filter_and_kpi_on_its_dataset_unchanged(agent_ns):
    prior, new = _page(), _widened()
    targets = agent_ns["implement_untargeted_targets"]("app", [(ASSET, ASK)], prior, new, RECORDS, shell_sql)
    assert targets["keys"] == {"records"}, targets
    assert agent_ns["implement_untargeted_changes"]("app", prior, new, targets, RECORDS) == []


def test_restoring_an_add_column_keeps_the_new_column_and_its_dataset_and_blocks_nothing(agent_ns):
    prior, new = _page(), _widened()
    targets = agent_ns["implement_untargeted_targets"]("app", [(ASSET, ASK)], prior, new, RECORDS, shell_sql)
    changes = agent_ns["implement_untargeted_changes"]("app", prior, new, targets, RECORDS)
    merged, restored, blocked = agent_ns["implement_restore_untargeted"]("app", prior, new, changes, targets, RECORDS)
    assert blocked == [] and restored == []
    assert [c["column"] for c in merged["records"]["columns"]] == ["entity_label", "loyalty_tier"]
    assert [d["sql"] for d in merged["datasets"]] == [WIDENED_SQL]


def test_a_change_to_the_rows_a_filter_reads_still_holds_the_version(agent_ns):
    prior = _page()
    new = _page(FILTERED_SQL, [LOYALTY])
    targets = agent_ns["implement_untargeted_targets"]("app", [(ASSET, ASK)], prior, new, RECORDS, shell_sql)
    changes = agent_ns["implement_untargeted_changes"]("app", prior, new, targets, RECORDS)
    assert sorted(c["label"] for c in changes) == ["Flagged KPI", "Priority filter"], changes
    _merged, _restored, blocked = agent_ns["implement_restore_untargeted"]("app", prior, new, changes, targets, RECORDS)
    assert sorted(c["label"] for c in blocked) == ["Flagged KPI", "Priority filter"]


def test_a_filter_on_a_dataset_the_table_does_not_read_is_still_guarded_when_its_column_moves(agent_ns):
    prior = _page()
    new = _widened()
    new["filters"][0]["columns"] = {RECORDS: "entity_label"}
    targets = agent_ns["implement_untargeted_targets"]("app", [(ASSET, ASK)], prior, new, RECORDS, shell_sql)
    changes = agent_ns["implement_untargeted_changes"]("app", prior, new, targets, RECORDS)
    assert [(c["key"], c["change"]) for c in changes] == [("filters:priority", "changed")], changes


def test_the_live_guard_keeps_an_add_column_on_the_table_and_reports_no_held_part(agent_ns, monkeypatch):
    inst = _inspire(agent_ns, FakeSpark())
    prior, new = _page(), _widened()
    context = {"uc_id": "N01-U01", "guarded": ["app"], "asset_status": {"app": {"spec_version": 2}},
               "genie_round": {}, "genie_rounds": {}}
    monkeypatch.setattr(inst, "_implement_previous_artifact", lambda ctx, name, record: copy.deepcopy(prior), raising=False)
    monkeypatch.setattr(inst, "_implement_app_shell", lambda: (None, {"shell_sql": shell_sql}), raising=False)
    monkeypatch.setattr(inst, "_implement_output_asks", lambda ctx, name: [(ASSET, ASK)], raising=False)
    kept = inst._implement_keep_untargeted(context, "app", copy.deepcopy(new))
    assert context.get("untargeted", {}).get("app") is None, context.get("untargeted")
    assert [c["column"] for c in kept["records"]["columns"]] == ["entity_label", "loyalty_tier"]
    assert kept["datasets"][0]["sql"] == WIDENED_SQL


def test_the_built_page_with_the_added_column_meets_the_ask_on_its_table(agent_ns):
    from v168_vibe_audit_scope_test import _round
    checks, _judged = _round(agent_ns, ASSET, ASK["ask"], [ASK], _widened(), before=_page())
    assert checks[0]["status"] == "done", checks
