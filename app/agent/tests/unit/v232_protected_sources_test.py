import json
import os
import sys
import types

import pytest

from v120_artifacts_support import CapturingLogger
from v140_implement_test import _inspire, _spec

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
SERVER = os.path.join(ROOT, "agent", "app_shell", "server")
if SERVER not in sys.path:
    sys.path.insert(0, SERVER)

import shell_core  # noqa: E402
import shell_db  # noqa: E402

SOURCE = "main.s.orders_v2"
RESULT = "main.inspire.churn_out"
SUMMARY = "main.inspire.churn_summary"
OWN = "main.sec.own_rows"
MASK = "main.sec.mask_ssn"
BOUND_FILTER = "ALTER TABLE `main`.`inspire`.`churn_out` SET ROW FILTER main.sec.own_rows ON (`owner`)"
BOUND_MASK = "ALTER TABLE `main`.`inspire`.`churn_out` ALTER COLUMN `ssn` SET MASK main.sec.mask_ssn USING COLUMNS (`region`)"


def _table(columns, kind="MANAGED", filters=(), masks=(), view=False):
    rows = [{"kind": "table", "function_name": "VIEW" if view else kind, "column_name": None, "columns": None}]
    rows += [{"kind": "column", "function_name": None, "column_name": c, "columns": None} for c in columns]
    rows += [{"kind": "row_filter", "function_name": fn, "column_name": None, "columns": cols} for fn, cols in filters]
    rows += [{"kind": "column_mask", "function_name": fn, "column_name": col, "columns": using} for col, fn, using in masks]
    return rows


def _protection(ns, *args, policies=(), **kw):
    return ns["implement_protection"](_table(*args, **kw), policies)


def _source(ns, policies=()):
    return {SOURCE: _protection(ns, ["owner", "ssn", "region", "amount"], filters=[(OWN, "owner")],
                                masks=[("ssn", MASK, "region")], policies=policies)}


def test_the_protection_read_parses_filters_masks_views_and_abac_policies(agent_ns):
    sql = agent_ns["implement_protection_sql"]()
    for name in ("row_filters", "column_masks", "tables", "columns"):
        assert f"system.information_schema.{name} WHERE table_catalog = lower(:c)" in sql
    policies = agent_ns["implement_abac_policies"]({"policies": [
        {"name": "pii_hide", "policy_type": "POLICY_TYPE_COLUMN_MASK"}, {"name": "eu_only", "policy_type": "POLICY_TYPE_ROW_FILTER"},
        {"name": "odd", "policy_type": "POLICY_TYPE_OTHER"}, {"policy_type": "POLICY_TYPE_ROW_FILTER"}, "junk"]})
    assert policies == [{"name": "pii_hide", "kind": "column_mask"}, {"name": "eu_only", "kind": "row_filter"}]
    assert agent_ns["implement_abac_policies"]({}) == [] and agent_ns["implement_abac_policies"](None) == []
    p = _protection(agent_ns, ["owner", "ssn"], filters=[(OWN, "owner, `region`")], masks=[("SSN", MASK, None)], policies=policies)
    assert p["found"] and not p["view"] and p["columns"] == ["owner", "ssn"]
    assert p["row_filters"] == [{"function": OWN, "columns": ["owner", "region"]}]
    assert p["masks"] == {"ssn": {"column": "SSN", "function": MASK, "using": []}}
    assert agent_ns["implement_protection_words"](p) == "a row filter, a column mask on SSN and 2 ABAC policies"
    assert _protection(agent_ns, ["a"], view=True)["view"]
    assert agent_ns["implement_protection"]([])["found"] is False
    assert not agent_ns["implement_is_protected"](_protection(agent_ns, ["a"]))


def test_a_result_that_lacks_the_filter_column_is_refused_so_every_viewer_does_not_see_all_rows(agent_ns):
    plan = agent_ns["implement_protection_plan"](_source(agent_ns), {RESULT: _protection(agent_ns, ["entity_id", "value"])})
    assert plan["apply"] == []
    assert plan["refuse"] == [f"{RESULT} has no column owner, so it cannot keep the row filter {OWN} of {SOURCE}, and every viewer "
                              "would see all its rows"]
    reason = agent_ns["implement_protection_refusal"](plan)
    assert reason.startswith("Inspire did not publish, because the results would show rows or values their sources hide: ")
    assert reason.endswith("then press Check again") and reason.count(". ") == 1


def test_a_traceable_result_gets_the_same_filter_and_mask_bound_to_its_own_columns(agent_ns):
    plan = agent_ns["implement_protection_plan"](_source(agent_ns), {RESULT: _protection(agent_ns, ["Owner", "ssn", "region", "value"])})
    assert plan == {"apply": [BOUND_FILTER.replace("`owner`", "`Owner`"), BOUND_MASK], "refuse": [], "blocked": []}
    kept = _protection(agent_ns, ["owner", "ssn", "region"], filters=[(OWN, "owner")], masks=[("ssn", MASK, "region")])
    assert agent_ns["implement_protection_plan"](_source(agent_ns), {RESULT: kept}) == {"apply": [], "refuse": [], "blocked": []}


def test_a_view_over_the_source_is_left_alone_because_it_keeps_the_source_filters(agent_ns):
    plan = agent_ns["implement_protection_plan"](_source(agent_ns), {RESULT: _protection(agent_ns, ["value"], view=True)})
    assert plan == {"apply": [], "refuse": [], "blocked": []}


@pytest.mark.parametrize("result,fragment", [
    ({"filters": [("main.sec.other", "owner")]}, "already has the row filter main.sec.other, not main.sec.own_rows"),
    ({"masks": [("ssn", "main.sec.other_mask", "region")]}, "already has the mask main.sec.other_mask, not main.sec.mask_ssn"),
])
def test_a_result_with_a_different_filter_or_mask_is_refused(agent_ns, result, fragment):
    plan = agent_ns["implement_protection_plan"](_source(agent_ns), {RESULT: _protection(agent_ns, ["owner", "ssn", "region"], **result)})
    assert any(fragment in r for r in plan["refuse"]), plan


def test_a_mask_whose_using_column_is_missing_is_refused(agent_ns):
    plan = agent_ns["implement_protection_plan"](_source(agent_ns), {RESULT: _protection(agent_ns, ["owner", "ssn"])})
    assert plan["apply"] == [BOUND_FILTER]
    assert plan["refuse"] == [f"{RESULT} has no column region, which the mask {MASK} of {SOURCE}.ssn reads, so it cannot keep that "
                              "mask on ssn"]


def test_two_sources_with_different_row_filters_are_refused(agent_ns):
    sources = dict(_source(agent_ns), **{"main.s.other": _protection(agent_ns, ["team"], filters=[("main.sec.team_rows", "team")])})
    plan = agent_ns["implement_protection_plan"](sources, {RESULT: _protection(agent_ns, ["owner", "team", "ssn", "region"])})
    assert any("which have different row filters, and a table keeps only one row filter" in r for r in plan["refuse"])


def test_a_masked_column_the_notebook_reads_but_no_result_carries_is_refused(agent_ns):
    sources = {SOURCE: _protection(agent_ns, ["ssn"], masks=[("ssn", MASK, None)])}
    results = {RESULT: _protection(agent_ns, ["entity_id", "value"])}
    refused = agent_ns["implement_protection_plan"](sources, results, notebook_text="SELECT upper(ssn) AS code FROM t")["refuse"]
    assert refused == [f"The notebook reads ssn, which {SOURCE} masks, but no result table has a column ssn, so Inspire cannot tell "
                       "which result column carries it and keep the mask on it"]
    assert agent_ns["implement_protection_plan"](sources, results, notebook_text="SELECT ssn_count FROM t")["refuse"] == []


def test_totals_over_a_row_filtered_source_are_blocked_but_totals_over_masked_only_sources_are_not(agent_ns):
    results = {RESULT: _protection(agent_ns, ["owner", "ssn", "region"], filters=[(OWN, "owner")], masks=[("ssn", MASK, "region")]),
               SUMMARY: _protection(agent_ns, ["tier", "n"])}
    assert agent_ns["implement_protection_plan"](_source(agent_ns), results, [SUMMARY])["blocked"] == [SUMMARY]
    masked = {SOURCE: _protection(agent_ns, ["ssn"], masks=[("ssn", MASK, None)])}
    assert agent_ns["implement_protection_plan"](masked, {SUMMARY: _protection(agent_ns, ["tier", "n"])}, [SUMMARY]) == {
        "apply": [], "refuse": [], "blocked": []}
    abac = {SOURCE: _protection(agent_ns, ["a"], policies=[{"name": "eu_only", "kind": "row_filter"}])}
    assert agent_ns["implement_protection_plan"](abac, {SUMMARY: _protection(agent_ns, ["n"])}, [SUMMARY])["blocked"] == [SUMMARY]


def test_an_abac_policy_that_does_not_cover_the_result_is_refused(agent_ns):
    sources = {SOURCE: _protection(agent_ns, ["a"], policies=[{"name": "pii_hide", "kind": "column_mask"}])}
    refused = agent_ns["implement_protection_plan"](sources, {RESULT: _protection(agent_ns, ["a"])})["refuse"]
    assert refused == [f"{SOURCE} is guarded by the ABAC policy pii_hide, which does not cover {RESULT}, so every viewer would see what "
                       "that policy hides"]
    covered = {RESULT: _protection(agent_ns, ["a"], policies=[{"name": "PII_HIDE", "kind": "column_mask"}])}
    assert agent_ns["implement_protection_plan"](sources, covered)["refuse"] == []


def test_unprotected_sources_need_nothing(agent_ns):
    sources = {SOURCE: _protection(agent_ns, ["owner"])}
    assert agent_ns["implement_protection_plan"](sources, {RESULT: _protection(agent_ns, ["v"])}, [SUMMARY]) == {
        "apply": [], "refuse": [], "blocked": []}
    assert agent_ns["implement_protected_tables"](sources) == {}


@pytest.mark.parametrize("outputs,fragment", [
    ({"app": True, "app_access": "sp"}, "so it cannot read through its service principal"),
    ({"app": True, "app_access": "user", "app_backend": "lakebase"}, "Lakebase does not carry Unity Catalog row filters"),
])
def test_service_principal_or_lakebase_apps_over_protected_tables_are_refused(agent_ns, outputs, fragment):
    protected = agent_ns["implement_protected_tables"](_source(agent_ns))
    assert protected == {SOURCE: "a row filter and a column mask on ssn"}
    refused = agent_ns["implement_protected_access_refusal"](protected, outputs)
    assert refused.startswith(f"The App reads {SOURCE} (a row filter and a column mask on ssn)") and fragment in refused
    assert agent_ns["implement_known_repair"](agent_ns["ImplementStopped"](refused), refused)["kind"] == "stop"


@pytest.mark.parametrize("outputs", [{"app": True, "app_access": "user", "app_backend": "delta"}, {"app": False, "app_access": "sp"}])
def test_viewer_delta_apps_and_no_app_pass_the_access_check(agent_ns, outputs):
    protected = agent_ns["implement_protected_tables"](_source(agent_ns))
    assert agent_ns["implement_protected_access_refusal"](protected, outputs) == ""
    assert agent_ns["implement_protected_access_refusal"]({}, {"app": True, "app_access": "sp"}) == ""


def test_the_app_settings_name_the_protected_and_blocked_tables(agent_ns):
    files = {"inspire_app.json": json.dumps({"auth": "user", "protected": {"a.b.c": "a row filter"}, "blocked": ["a.b.z"]})}
    out = agent_ns["implement_app_mark_protected"](files, {SOURCE: "a column mask on ssn"}, [SUMMARY])
    settings = json.loads(out["inspire_app.json"])
    assert settings["protected"] == {"a.b.c": "a row filter", SOURCE: "a column mask on ssn"}
    assert settings["blocked"] == sorted(["a.b.z", SUMMARY])
    assert agent_ns["implement_app_mark_protected"](files, {}, ()) is files
    assert shell_core.protected_problems(settings) == []
    assert shell_core.protected_problems(dict(settings, auth="sp")) != []


def test_a_refusal_record_carries_the_sql_and_whether_check_again_can_clear_it(agent_ns):
    assert agent_ns["implement_protection_record"]("no", 3, [BOUND_FILTER, BOUND_FILTER]) == {
        "state": "failed", "spec_version": 3, "reason": "no", "sql": [BOUND_FILTER + ";"], "check": True}
    assert agent_ns["implement_protection_record"]("no", 3, check=False)["check"] is False


class _CatalogSpark:
    def __init__(self, tables, fail=()):
        self.tables, self.fail, self.statements = tables, fail, []

    def sql(self, statement, args=None):
        text = " ".join(str(statement).split())
        self.statements.append(text)
        if any(text.startswith(f) for f in self.fail):
            raise RuntimeError("PERMISSION_DENIED: User does not have MANAGE on Table")
        if text.startswith("ALTER TABLE `main`.`inspire`.`churn_out` SET ROW FILTER"):
            self.tables[RESULT] += [{"kind": "row_filter", "function_name": OWN, "column_name": None, "columns": "owner"}]
        if text.startswith("ALTER TABLE `main`.`inspire`.`churn_out` ALTER COLUMN `ssn` SET MASK"):
            self.tables[RESULT] += [{"kind": "column_mask", "function_name": MASK, "column_name": "ssn", "columns": "region"}]
        rows = self.tables.get(f"{args['c']}.{args['s']}.{args['t']}", []) if args else []
        return types.SimpleNamespace(collect=lambda: list(rows))


def _gate(ns, result_columns, outputs=None, fail=()):
    spark = _CatalogSpark({SOURCE: _table(["owner", "ssn", "region"], filters=[(OWN, "owner")], masks=[("ssn", MASK, "region")]),
                           RESULT: _table(result_columns), SUMMARY: _table(["tier", "n"])}, fail)
    inst = _inspire(ns, spark)
    inst.logger = CapturingLogger()
    inst._implement_api = lambda method, path, body=None, query=None: {}
    inst._genie_involved_tables = lambda use_case: ["main.s.orders"]
    inst._implement_notebook_cells_text = lambda path: ""
    inst._implement_retried = lambda fn, label: fn()
    inst.updates = []
    inst._implement_update = lambda key, **kw: inst.updates.append(kw)
    spec = _spec(ns)[0]
    spec["outputs"].update(outputs or {"app_access": "user"})
    context = {"spec": spec, "key": (5150, "N01-U01", 2), "use_case": {}, "asset_status": {}, "result_table": RESULT,
               "summary_table": SUMMARY, "allowed": [RESULT, SUMMARY, "main.s.orders_v2"]}
    return inst, context


def test_the_gate_binds_the_source_filter_and_mask_then_checks_they_show_and_blocks_totals(agent_ns):
    inst, context = _gate(agent_ns, ["owner", "ssn", "region", "value"])
    inst._implement_protection_gate(context, [])
    assert [s for s in inst.spark.statements if s.startswith("ALTER")] == [BOUND_FILTER, BOUND_MASK]
    assert context["protected"] == {SOURCE: "a row filter and a column mask on ssn", RESULT: "a row filter and a column mask on ssn"}
    assert context["blocked"] == [SUMMARY] and context["allowed"] == [RESULT, "main.s.orders_v2"]
    lines = [m for _, m in inst.logger.records]
    assert any("[IMPLEMENT-PROTECTION-BOUND FIRED]" in m for m in lines)
    assert any("[IMPLEMENT-PROTECTION-BLOCKED FIRED]" in m for m in lines)


def test_the_gate_refuses_to_publish_when_a_result_cannot_keep_the_filter(agent_ns):
    inst, context = _gate(agent_ns, ["entity_id", "value"])
    with pytest.raises(agent_ns["ImplementStopped"]) as stop:
        inst._implement_protection_gate(context, [])
    assert str(stop.value).startswith("Inspire did not publish") and not any(s.startswith("ALTER") for s in inst.spark.statements)
    record = context["asset_status"]["protection"]
    assert record["state"] == "failed" and record["spec_version"] == 2 and record["check"] is True and record["sql"] == []
    assert inst.updates[-1]["asset_status"]["protection"] is record
    assert any("[IMPLEMENT-PROTECTION-REFUSED FIRED]" in m for _, m in inst.logger.records)


def test_the_gate_refuses_with_the_sql_to_copy_when_it_may_not_bind_the_filter(agent_ns):
    inst, context = _gate(agent_ns, ["owner", "ssn", "region"], fail=("ALTER TABLE",))
    with pytest.raises(agent_ns["ImplementStopped"]):
        inst._implement_protection_gate(context, [])
    assert context["asset_status"]["protection"]["sql"] == [BOUND_FILTER + ";", BOUND_MASK + ";"]


def test_a_service_principal_app_over_a_protected_source_stops_before_the_notebook_is_built(agent_ns):
    inst, context = _gate(agent_ns, ["owner"], outputs={"app_access": "sp"})
    with pytest.raises(agent_ns["ImplementStopped"]) as stop:
        inst._implement_source_protection(context["key"], context["spec"], context["use_case"], context["asset_status"], [])
    assert "cannot read through its service principal" in str(stop.value)
    assert context["asset_status"]["protection"]["check"] is False
    assert any("[IMPLEMENT-PROTECTED-ACCESS FIRED]" in m for _, m in inst.logger.records)


def test_a_failed_protection_read_is_named_and_counts_as_protected(agent_ns):
    inst, context = _gate(agent_ns, ["owner"])
    inst.spark.sql = lambda statement, args=None: (_ for _ in ()).throw(RuntimeError("TABLE_OR_VIEW_NOT_FOUND"))
    warnings = []
    read = inst._implement_protections([SOURCE], warnings)
    assert read[SOURCE]["unread"].startswith("TABLE_OR_VIEW_NOT_FOUND") and agent_ns["implement_is_protected"](read[SOURCE])
    assert warnings and warnings[0].startswith(f"Sharing: Inspire could not read the row filters and column masks of {SOURCE}")


def test_the_deploy_refuses_a_service_principal_app_over_protected_tables_before_any_call(agent_ns):
    inst, context = _gate(agent_ns, ["owner"], outputs={"app_access": "sp"})
    calls = []
    inst._implement_api = lambda *a, **k: calls.append(a)
    inst._implement_access_rows = lambda table: []
    context["protected"] = {SOURCE: "a row filter"}
    with pytest.raises(agent_ns["ImplementStopped"]):
        inst._implement_deploy_app(context, "churn-desk", {"inspire_app.json": "{}"}, [SOURCE])
    assert calls == []


def test_the_shell_refuses_service_principal_mode_over_protected_tables_and_checks_the_shapes():
    base = {"auth": "user", "protected": {SOURCE: "a row filter"}}
    assert shell_core.protected_problems(base) == []
    refused = shell_core.protected_problems(dict(base, auth="sp"))
    assert refused == [f"the App reads {SOURCE} (a row filter), so it must sign each viewer in as themselves: its auth must be user, "
                       "because its service principal would show every viewer the rows and values only it may see"]
    assert shell_core.protected_problems(dict(base, auth="sp", protected={})) == []
    assert shell_core.protected_problems(dict(base, protected=["x"])) != []
    assert shell_core.protected_problems(dict(base, protected={SOURCE: " "})) != []
    assert shell_core.protected_problems(dict(base, blocked="x")) != []
    assert shell_core.blocked_tables({"blocked": ["`Main`.`Inspire`.`S`", " ", "a.b.c"]}) == ("a.b.c", "main.inspire.s")


def test_the_shell_settings_check_runs_the_protection_rule():
    settings = {"version": 2, "auth": "sp", "protected": {SOURCE: "a row filter"}}
    assert any(SOURCE in p and "auth must be user" in p for p in shell_core.settings_problems(settings, []))
    assert not any("auth must be user, because its service" in p for p in shell_core.settings_problems(dict(settings, auth="user"), []))


def test_the_shell_does_not_run_sql_over_a_blocked_table_but_runs_other_tables():
    ws = shell_db.Workspace.__new__(shell_db.Workspace)
    ws.blocked = (SUMMARY,)
    ws.clock = lambda: 0.0
    sent = []

    def call(method, path, body=None):
        sent.append(body["statement"])
        raise shell_db.QueryError("sent")

    ws.call = call
    with pytest.raises(shell_db.QueryError) as refused:
        ws.run_sql("wh1", "SELECT tier, n FROM `main`.`Inspire`.`churn_summary` LIMIT 5")
    assert str(refused.value) == shell_db.BLOCKED_TEXT and sent == []
    for sql in ("SELECT * FROM main.inspire.churn_summary_v2", "SELECT * FROM x.main.inspire.churn_summary", "SELECT * FROM main.inspire.churn_out"):
        with pytest.raises(shell_db.QueryError) as other:
            ws.run_sql("wh1", sql)
        assert str(other.value) == "sent"
    assert len(sent) == 3


def test_a_viewer_workspace_carries_the_blocked_tables_from_the_settings():
    shell = shell_core.Shell.__new__(shell_core.Shell)
    shell.settings, shell.env = {"auth": "user", "blocked": [SUMMARY.upper()]}, {"DATABRICKS_HOST": "h"}
    shell.user_factory = lambda host, token: types.SimpleNamespace(blocked=())
    ws, who = shell.workspace({"x-forwarded-access-token": "t", "x-forwarded-email": "a@b"})
    assert ws.blocked == (SUMMARY,) and who == "user:a@b"


def test_the_abac_read_names_the_table_as_one_quoted_path_segment(agent_ns):
    inst, _context = _gate(agent_ns, ["owner"])
    calls = []
    inst._implement_api = lambda method, path, body=None, query=None: calls.append((method, path, query)) or {
        "policies": [{"name": "pii_rows", "policy_type": "POLICY_TYPE_ROW_FILTER"}]}
    warnings = []
    assert type(inst)._implement_abac(inst, "`main`.`s`.`or#ders`", warnings) == [{"name": "pii_rows", "kind": "row_filter"}], warnings
    assert calls == [("GET", "/api/2.1/unity-catalog/policies/table/main.s.or%23ders", {"include_inherited": "true"})]
